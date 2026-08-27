/**
 * ตั้งค่าผลการแก้ไข — เฉพาะผู้ดูแล tenant
 *
 * ทุกทางล้มเหลวมีรหัสสถานะของตัวเอง หน้าจอต้องบอกได้ว่าต้องทำอะไรต่อ
 * ไม่ใช่แค่ว่า "ผิดพลาด"
 */
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { assertTenantAdmin } from '../permission';
import {
  DuplicateLookupNameError,
  LastActiveLookupError,
  LookupNameRequiredError,
  LookupNotFoundError,
  createResolution,
  listResolutionsAdmin,
  renameResolution,
  setResolutionActive,
} from './lookup.service';

function mapError(e: unknown): never {
  if (e instanceof LookupNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (
    e instanceof DuplicateLookupNameError ||
    e instanceof LookupNameRequiredError ||
    e instanceof LastActiveLookupError
  ) {
    // 422 — คำขอถูกรูปแบบ แต่ข้อมูลใช้ไม่ได้ · ข้อความอ่านรู้เรื่องอยู่แล้ว
    throw new HttpException(
      { error: 'invalid', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw e;
}

function idOf(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new HttpException({ message: 'รหัสไม่ถูกต้อง' }, HttpStatus.BAD_REQUEST);
  }
  return n;
}

@Controller('admin/resolutions')
export class LookupController {
  @Get()
  async list(@Ctx() ctx: TenantContext): Promise<{ rows: unknown[] }> {
    await assertTenantAdmin(ctx);
    return { rows: await listResolutionsAdmin(ctx) };
  }

  @Post()
  async create(@Ctx() ctx: TenantContext, @Body() body: { name?: unknown }): Promise<unknown> {
    await assertTenantAdmin(ctx);
    try {
      return await createResolution(ctx, typeof body.name === 'string' ? body.name : '');
    } catch (e) {
      return mapError(e);
    }
  }

  @Post(':id/rename')
  async rename(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { name?: unknown },
  ): Promise<{ ok: true }> {
    await assertTenantAdmin(ctx);
    try {
      await renameResolution(ctx, idOf(id), typeof body.name === 'string' ? body.name : '');
      return { ok: true };
    } catch (e) {
      return mapError(e);
    }
  }

  @Post(':id/active')
  async active(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { isActive?: unknown },
  ): Promise<{ ok: true }> {
    await assertTenantAdmin(ctx);
    try {
      await setResolutionActive(ctx, idOf(id), body.isActive === true);
      return { ok: true };
    } catch (e) {
      return mapError(e);
    }
  }
}
