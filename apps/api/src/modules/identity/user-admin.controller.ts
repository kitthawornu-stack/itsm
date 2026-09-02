/**
 * หน้าจัดการผู้ใช้ (ผู้ดูแลระบบ) และการเปลี่ยนรหัสผ่านของตัวเอง
 *
 * ทุก endpoint ที่ขึ้นต้นด้วย `/admin` ต้องเป็นผู้ดูแลระบบ ยกเว้น
 * `/me/password` ซึ่งเป็นการกระทำกับบัญชีตัวเอง — แยกออกมาโดยตั้งใจ
 * เพราะการเปลี่ยนรหัสผ่านตัวเองต้องทำได้โดยไม่ต้องมีสิทธิ์ผู้ดูแล
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { assertTenantAdmin } from '../permission';
import { PASSWORD_MIN_LENGTH, WeakPasswordError } from './password';
import {
  AlreadyErasedError,
  LastAdminError,
  StillAssignedError,
} from './personal-data';
import {
  NoActorError,
  UserNotFoundForPdpaError,
  erasePersonalData,
  exportPersonalData,
  exportMyPersonalData,
  type ErasureResult,
  type PersonalDataExport,
} from './personal-data.service';
import {
  CannotDeactivateSelfError,
  EmailInUseError,
  UserNotFoundError,
  WrongCurrentPasswordError,
  changeOwnPassword,
  createUser,
  listGroups,
  listUsers,
  setActive,
  setGroups,
  setPassword,
} from './user-admin.service';

/** แปลง error ของโดเมนเป็นรหัสสถานะ — ที่เดียวสำหรับทั้ง controller */
function toHttp(e: unknown): never {
  if (e instanceof WeakPasswordError) {
    throw new HttpException(
      { error: 'weak_password', message: e.message, minLength: PASSWORD_MIN_LENGTH },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (e instanceof EmailInUseError) {
    throw new HttpException({ error: 'email_in_use', message: e.message }, HttpStatus.CONFLICT);
  }
  if (e instanceof UserNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof CannotDeactivateSelfError) {
    throw new HttpException({ error: 'cannot_self', message: e.message }, HttpStatus.CONFLICT);
  }
  if (e instanceof WrongCurrentPasswordError) {
    // 401 ไม่ใช่ 403 — นี่คือการยืนยันตัวตนล้มเหลว ไม่ใช่ขาดสิทธิ์
    throw new HttpException({ error: 'wrong_password', message: e.message }, HttpStatus.UNAUTHORIZED);
  }
  throw e;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

@Controller('admin/users')
export class UserAdminController {
  @Get()
  async list(@Ctx() ctx: TenantContext): Promise<{ rows: unknown[] }> {
    await assertTenantAdmin(ctx);
    return { rows: await listUsers(ctx) };
  }

  @Get('groups')
  async groups(@Ctx() ctx: TenantContext): Promise<{ rows: unknown[] }> {
    await assertTenantAdmin(ctx);
    return { rows: await listGroups(ctx) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Ctx() ctx: TenantContext,
    @Body() body: { email?: unknown; displayName?: unknown; password?: unknown; groupIds?: unknown },
  ): Promise<unknown> {
    await assertTenantAdmin(ctx);
    const email = str(body.email).trim();
    if (email === '' || !email.includes('@')) {
      throw new HttpException(
        { error: 'validation_failed', message: 'ต้องระบุอีเมลที่ถูกต้อง' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      return await createUser(ctx, {
        email,
        displayName: str(body.displayName),
        password: str(body.password),
        groupIds: Array.isArray(body.groupIds) ? body.groupIds.map((g) => BigInt(String(g))) : [],
      });
    } catch (e) {
      toHttp(e);
    }
  }

  @Post(':id/password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { password?: unknown },
  ): Promise<unknown> {
    await assertTenantAdmin(ctx);
    try {
      return await setPassword(ctx, BigInt(id), str(body.password));
    } catch (e) {
      toHttp(e);
    }
  }

  @Post(':id/active')
  @HttpCode(HttpStatus.OK)
  async setActiveState(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { isActive?: unknown },
  ): Promise<unknown> {
    await assertTenantAdmin(ctx);
    try {
      return await setActive(ctx, BigInt(id), body.isActive === true || body.isActive === 'true');
    } catch (e) {
      toHttp(e);
    }
  }

  /**
   * สำเนาข้อมูลส่วนบุคคล (PDPA · สิทธิเข้าถึง)
   *
   * `GET` เพราะเป็นการอ่านล้วน · **แต่ถูกบันทึกใน `audit_log` ไม่ได้**
   * ด้วยกลไกปัจจุบันซึ่งผูกกับทรานแซกชันที่เขียนข้อมูล — ผู้ดูแลที่ดึงสำเนา
   * ของคนอื่นจึงยังไม่มีร่องรอย · เขียนไว้ตรงนี้ให้เห็น ไม่ใช่ปล่อยให้คิดว่ามี
   */
  @Get(':id/personal-data')
  async exportPersonal(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
  ): Promise<PersonalDataExport> {
    try {
      return await exportPersonalData(ctx, idOf(id));
    } catch (e) {
      return toPdpaHttp(e);
    }
  }

  /**
   * ทำให้เป็นนิรนามตามคำขอ (PDPA · สิทธิให้ลบ)
   *
   * **ไม่ลบแถว** — ประวัติของคนอื่นอ้างถึงคนคนนี้ · คำตอบมี `residual`
   * ที่บอกว่าข้อมูลส่วนบุคคลอาจยังเหลืออยู่ตรงไหนบ้าง หน้าจอต้องแสดงเสมอ
   */
  @Post(':id/erase')
  @HttpCode(HttpStatus.OK)
  async erasePersonal(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
  ): Promise<ErasureResult> {
    try {
      return await erasePersonalData(ctx, idOf(id));
    } catch (e) {
      return toPdpaHttp(e);
    }
  }

  @Post(':id/groups')
  @HttpCode(HttpStatus.OK)
  async updateGroups(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { groupIds?: unknown },
  ): Promise<unknown> {
    await assertTenantAdmin(ctx);
    const ids = Array.isArray(body.groupIds) ? body.groupIds.map((g) => BigInt(String(g))) : [];
    try {
      return await setGroups(ctx, BigInt(id), ids);
    } catch (e) {
      toHttp(e);
    }
  }
}

@Controller('me')
export class SelfServiceController {
  /**
   * เปลี่ยนรหัสผ่านของตัวเอง — ไม่ต้องเป็นผู้ดูแล
   *
   * ตัดเซสชันอื่นทั้งหมดรวมถึงของตัวเอง ผู้ใช้ต้องล็อกอินใหม่ ซึ่งเป็นสิ่งที่
   * คนคาดหวังหลังเปลี่ยนรหัสผ่าน และเป็นสิ่งที่ต้องเกิดถ้าเปลี่ยนเพราะถูกยึดบัญชี
   */
  /**
   * สำเนาข้อมูลส่วนบุคคล **ของตัวเอง** (PDPA · สิทธิขอเข้าถึง)
   *
   * **ไม่มีพารามิเตอร์ id เลย** — ไม่ใช่มีแล้วตรวจว่าตรงกับตัวเอง ·
   * พารามิเตอร์ที่ไม่มี คือพารามิเตอร์ที่ปลอมไม่ได้ · ตัวตนมาจากเซสชัน
   * ทางเดียว เหมือน `POST /me/password`
   */
  @Get('personal-data')
  async exportMine(@Ctx() ctx: TenantContext): Promise<PersonalDataExport> {
    try {
      return await exportMyPersonalData(ctx);
    } catch (e) {
      return toPdpaHttp(e);
    }
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Ctx() ctx: TenantContext,
    @Body() body: { currentPassword?: unknown; newPassword?: unknown },
  ): Promise<unknown> {
    try {
      return await changeOwnPassword(ctx, str(body.currentPassword), str(body.newPassword));
    } catch (e) {
      toHttp(e);
    }
  }
}

function idOf(raw: string): bigint {
  if (!/^[0-9]+$/.test(raw)) {
    throw new HttpException(
      { error: 'invalid_input', message: 'รหัสผู้ใช้ไม่ถูกต้อง' },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return BigInt(raw);
}

function toPdpaHttp(e: unknown): never {
  if (e instanceof NoActorError) {
    throw new HttpException({ error: 'unauthorized', message: e.message }, HttpStatus.UNAUTHORIZED);
  }
  if (e instanceof UserNotFoundForPdpaError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (
    e instanceof LastAdminError ||
    e instanceof StillAssignedError ||
    e instanceof AlreadyErasedError
  ) {
    /*
      422 — คำขอถูกต้องตามรูปแบบ แต่สภาพตอนนี้ทำไม่ได้ · ข้อความบอกเหตุผล
      เป็นภาษาคนพร้อมจำนวนอยู่แล้ว หน้าจอจึงแสดงตรง ๆ ได้
    */
    throw new HttpException(
      { error: 'invalid_state', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw e;
}
