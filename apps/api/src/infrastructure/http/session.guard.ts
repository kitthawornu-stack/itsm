/**
 * ด่านตรวจเซสชัน — แทนที่ `dev-tenant.guard` (ADR-003)
 *
 * ติดตั้งเป็น guard ระดับแอป จึง **ปิดทุก endpoint โดยปริยาย**
 * endpoint ที่เปิดสาธารณะต้องติด `@Public()` อย่างชัดเจน
 *
 * ทิศทางนี้สำคัญ: ถ้าให้เปิดเป็นค่าปริยายแล้วค่อยติด `@Auth()` ทีละอัน
 * endpoint ที่ลืมติดจะเปิดโล่งโดยไม่มีใครรู้ · แบบนี้ endpoint ที่ลืมติด
 * จะพังทันทีที่ทดสอบ ซึ่งเป็นความผิดพลาดที่มองเห็นได้
 */
import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { TenantContext } from '@itsm/types';

import { resolveSession } from '../../modules/identity';

export const SESSION_COOKIE = 'itsm_session';

const PUBLIC_KEY = 'itsm:public';

/** เปิดให้เข้าถึงได้โดยไม่ต้องล็อกอิน — ต้องระบุเหตุผลเสมอ */
export const Public = (reason: string): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_KEY, reason);

/** ผู้ใช้ที่ล็อกอินอยู่ พร้อมบริบท tenant ที่ผูกกับเซสชันนั้น */
export interface AuthenticatedRequest extends Request {
  itsmContext?: TenantContext;
  itsmUser?: { id: bigint; email: string; displayName: string };
}

@Injectable()
export class SessionGuard implements CanActivate {
  /**
   * ระบุ token ให้ชัด ไม่พึ่ง `design:paramtypes`
   *
   * TypeScript ตัด import ที่ถูกใช้เป็นชนิดอย่างเดียวทิ้ง metadata ของ
   * constructor parameter จึงกลายเป็น undefined และ Nest ฉีด `Reflector` ไม่ได้
   * — guard พังทุกคำขอ **แต่พังไปทางปฏิเสธ (500) ไม่ใช่ปล่อยผ่าน**
   * ซึ่งเป็นทิศทางที่ถูกต้องของความล้มเหลวสำหรับด่านตรวจ
   */
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<string | undefined>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic !== undefined) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const raw = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE];
    const token = typeof raw === 'string' ? raw : '';

    const session = await resolveSession(token);
    if (session === null) {
      // ข้อความเดียวทุกกรณี — ไม่บอกว่าไม่มีคุกกี้ หมดอายุ หรือถูกเพิกถอน
      throw new UnauthorizedException({
        error: 'unauthenticated',
        message: 'กรุณาเข้าสู่ระบบ',
      });
    }

    req.itsmContext = session.ctx;
    req.itsmUser = session.user;
    return true;
  }
}

/**
 * ดึงบริบทของผู้ใช้ปัจจุบันเข้ามาใน handler
 *
 * โยน error เมื่อไม่มีบริบท แทนที่จะคืน null — ถ้ามาถึง handler ได้แปลว่า
 * guard ปล่อยผ่านแล้ว การไม่มีบริบทตรงนี้จึงเป็นบั๊กของเรา ไม่ใช่กรณีปกติ
 * ที่ควรเขียนโค้ดรองรับ (endpoint สาธารณะต้องไม่ใช้ decorator นี้)
 */
export const Ctx = createParamDecorator((_data: unknown, context: ExecutionContext): TenantContext => {
  const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (req.itsmContext === undefined) {
    throw new Error(
      'ไม่มีบริบทผู้ใช้ใน request — endpoint นี้ติด @Public() แต่ใช้ @Ctx() ซึ่งขัดกันเอง',
    );
  }
  return req.itsmContext;
});
