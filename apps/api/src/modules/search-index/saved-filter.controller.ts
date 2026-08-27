/**
 * ตัวกรองที่บันทึกไว้ — ทุกคนที่ล็อกอินใช้ได้ ไม่ใช่เฉพาะผู้ดูแล
 *
 * ตัวกรองเป็นของผู้ใช้แต่ละคน · การแชร์ทำให้คนอื่น **เห็นและกดใช้** ได้
 * แต่แก้และลบได้เฉพาะเจ้าของ
 */
import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import {
  DuplicateFilterNameError,
  FilterNameRequiredError,
  FilterNotFoundError,
  InvalidFilterQueryError,
  NotFilterOwnerError,
  createSavedFilter,
  deleteSavedFilter,
  listSavedFilters,
  updateSavedFilter,
} from './saved-filter.service';

function mapError(e: unknown): never {
  if (e instanceof FilterNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof NotFilterOwnerError) {
    throw new HttpException({ error: 'not_owner', message: e.message }, HttpStatus.FORBIDDEN);
  }
  if (
    e instanceof FilterNameRequiredError ||
    e instanceof DuplicateFilterNameError ||
    e instanceof InvalidFilterQueryError
  ) {
    throw new HttpException(
      { error: 'invalid', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw e;
}

function idOf(raw: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new HttpException({ error: 'invalid', message: 'รหัสไม่ถูกต้อง' }, HttpStatus.BAD_REQUEST);
  }
  return BigInt(raw);
}

@Controller('filters')
export class SavedFilterController {
  @Get()
  async list(@Ctx() ctx: TenantContext): Promise<{ rows: unknown[] }> {
    return { rows: await listSavedFilters(ctx) };
  }

  @Post()
  async create(
    @Ctx() ctx: TenantContext,
    @Body() body: { name?: unknown; hql?: unknown; isShared?: unknown },
  ): Promise<unknown> {
    try {
      const f = await createSavedFilter(
        ctx,
        typeof body.name === 'string' ? body.name : '',
        typeof body.hql === 'string' ? body.hql : '',
        body.isShared === true,
      );
      return { ok: true, id: f.id.toString() };
    } catch (e) {
      return mapError(e);
    }
  }

  @Post(':id')
  async update(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { hql?: unknown; isShared?: unknown },
  ): Promise<{ ok: true }> {
    try {
      await updateSavedFilter(ctx, idOf(id), {
        ...(typeof body.hql === 'string' ? { hql: body.hql } : {}),
        ...(typeof body.isShared === 'boolean' ? { isShared: body.isShared } : {}),
      });
      return { ok: true };
    } catch (e) {
      return mapError(e);
    }
  }

  @Delete(':id')
  async remove(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    try {
      await deleteSavedFilter(ctx, idOf(id));
      return { ok: true };
    } catch (e) {
      return mapError(e);
    }
  }
}
