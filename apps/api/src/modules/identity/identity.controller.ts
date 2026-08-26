/**
 * ล็อกอิน / ออกจากระบบ / ดูว่าเป็นใคร
 *
 * โทเคนอยู่ใน **httpOnly cookie** ไม่ใช่ใน localStorage
 * เพราะ localStorage อ่านได้ด้วย JavaScript ทุกตัวในหน้า — XSS ครั้งเดียว
 * เท่ากับยกเซสชันให้ทั้งใบ · httpOnly ทำให้สคริปต์ในหน้าอ่านไม่ได้เลย
 *
 * ราคาที่ต้องจ่ายคือ CSRF ซึ่งกันด้วย `SameSite=Lax` — คำขอข้ามเว็บแบบ POST
 * จะไม่พาคุกกี้ไปด้วย · เมื่อมีฟอร์มที่ต้องข้ามโดเมนจริง ค่อยเพิ่ม CSRF token
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { withSystemScope } from '../../infrastructure/prisma/tenant-scope';
import {
  LoginFailedError,
  SESSION_TTL_MS,
  TooManyAttemptsError,
  login,
  resolveSession,
  revokeAllSessions,
  revokeSession,
} from './session.service';

export const SESSION_COOKIE = 'itsm_session';

function cookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // dev รันบน http จึงตั้ง secure ไม่ได้ — production ต้องเป็น true เสมอ
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

function tokenFrom(req: Request): string {
  const raw = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE];
  return typeof raw === 'string' ? raw : '';
}

@Controller('auth')
export class IdentityController {
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body() body: { email?: unknown; password?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (email === '' || password === '') {
      throw new HttpException(
        { error: 'validation_failed', message: 'ต้องกรอกอีเมลและรหัสผ่าน' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    /**
     * tenant มาจากไหนตอนยังไม่ล็อกอิน
     *
     * on-prem มี tenant เดียว จึงใช้ตัวที่ตั้งไว้ใน env
     * เมื่อขยายเป็น SaaS ต้องมาจากโดเมนย่อยหรือรหัสองค์กรในฟอร์ม — จุดนี้คือที่ที่ต้องแก้
     */
    const key = process.env['DEFAULT_TENANT_KEY'] ?? 'default';
    // ยังไม่รู้ tenant — นี่คือคิวรีที่หาว่า tenant ไหน จึงผูก scope ก่อนไม่ได้
    const tenant = await withSystemScope(
      'หา tenant จากคีย์ก่อนล็อกอิน — ยังไม่มีบริบทผู้ใช้ให้ผูก (ADR-003)',
      async (raw) => raw.tenant.findFirst({ where: { key }, select: { id: true } }),
    );
    if (tenant === null) {
      throw new HttpException({ message: 'ยังไม่ได้ตั้งค่าองค์กร' }, HttpStatus.SERVICE_UNAVAILABLE);
    }

    try {
      const result = await login({
        tenantId: tenant.id,
        email,
        password,
        userAgent: req.get('user-agent') ?? undefined,
        ipAddress: req.ip ?? undefined,
      });
      res.cookie(SESSION_COOKIE, result.token, cookieOptions());
      return {
        user: {
          id: result.user.id.toString(),
          email: result.user.email,
          displayName: result.user.displayName,
        },
        expiresAt: result.expiresAt.toISOString(),
      };
    } catch (e) {
      if (e instanceof TooManyAttemptsError) {
        res.setHeader('Retry-After', String(Math.ceil(e.retryAfterMs / 1000)));
        throw new HttpException(
          { error: 'too_many_attempts', message: e.message },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (e instanceof LoginFailedError) {
        // 401 เดียวกันทุกสาเหตุ — ไม่บอกว่าอีเมลนี้มีบัญชีอยู่หรือไม่
        throw new HttpException(
          { error: 'login_failed', message: e.message },
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async signOut(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await revokeSession(tokenFrom(req));
    // ล้างคุกกี้เสมอ แม้ไม่มีเซสชัน — การกดออกจากระบบต้องได้ผลเดียวกันทุกครั้ง
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  /** เพิกถอนทุกเครื่อง — ใช้ตอนสงสัยว่าบัญชีถูกยึด */
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async signOutEverywhere(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true; revoked: number }> {
    const session = await resolveSession(tokenFrom(req));
    if (session === null) {
      throw new HttpException({ error: 'unauthenticated' }, HttpStatus.UNAUTHORIZED);
    }
    const revoked = await revokeAllSessions(session.user.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true, revoked };
  }

  @Get('me')
  async me(@Req() req: Request): Promise<unknown> {
    const session = await resolveSession(tokenFrom(req));
    if (session === null) {
      throw new HttpException({ error: 'unauthenticated' }, HttpStatus.UNAUTHORIZED);
    }
    return {
      user: {
        id: session.user.id.toString(),
        email: session.user.email,
        displayName: session.user.displayName,
      },
      expiresAt: session.expiresAt.toISOString(),
    };
  }
}
