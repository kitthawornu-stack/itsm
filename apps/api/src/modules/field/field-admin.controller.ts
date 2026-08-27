/**
 * ตั้งค่าฟิลด์เพิ่มเติม — เฉพาะผู้ดูแล tenant
 *
 * เศษหนึ่งส่วนสามสุดท้ายของเกณฑ์ผ่าน Phase 0 ข้อแรก
 */
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query } from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { assertTenantAdmin } from '../permission';
import {
  DuplicateFieldError,
  FIELD_TYPES,
  FieldInUseError,
  FieldNotFoundError,
  InvalidFieldKeyError,
  OptionInUseError,
  OptionsRequiredError,
  SystemFieldError,
  createField,
  listFields,
  removeField,
  removeFieldConfig,
  setFieldConfig,
  setFieldOptions,
  type FieldTypeName,
} from './field-admin.service';
import { formFieldsFor } from './field-form.service';

function mapError(e: unknown): never {
  if (e instanceof FieldNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (
    e instanceof InvalidFieldKeyError ||
    e instanceof DuplicateFieldError ||
    e instanceof OptionsRequiredError
  ) {
    throw new HttpException(
      { error: 'invalid', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (e instanceof FieldInUseError || e instanceof OptionInUseError || e instanceof SystemFieldError) {
    // 409 — คำขอถูกต้อง แต่สถานะของข้อมูลตอนนี้ทำให้ทำไม่ได้
    throw new HttpException({ error: 'in_use', message: e.message }, HttpStatus.CONFLICT);
  }
  throw e;
}

function requireId(v: unknown, what: string): bigint {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) {
    throw new HttpException({ error: 'invalid', message: `ต้องระบุ${what}` }, HttpStatus.BAD_REQUEST);
  }
  return BigInt(v);
}

@Controller('admin/fields')
export class FieldAdminController {
  @Get()
  async list(@Ctx() ctx: TenantContext): Promise<{ rows: unknown[]; types: readonly string[] }> {
    await assertTenantAdmin(ctx);
    return { rows: await listFields(ctx), types: FIELD_TYPES };
  }

  /** ฟิลด์ที่ (โปรเจกต์ × ประเภทงาน) นี้ถามอยู่ — ใช้แสดงสถานะบนหน้าตั้งค่า */
  @Get('config')
  async config(
    @Ctx() ctx: TenantContext,
    @Query('projectId') projectId: string,
    @Query('issueTypeId') issueTypeId: string,
  ): Promise<{ rows: unknown[] }> {
    await assertTenantAdmin(ctx);
    return {
      rows: await formFieldsFor(
        ctx,
        requireId(projectId, 'รหัสโปรเจกต์'),
        requireId(issueTypeId, 'รหัสประเภทงาน'),
      ),
    };
  }

  @Post()
  async create(
    @Ctx() ctx: TenantContext,
    @Body() body: { key?: unknown; name?: unknown; type?: unknown; options?: unknown },
  ): Promise<unknown> {
    await assertTenantAdmin(ctx);
    try {
      const f = await createField(ctx, {
        key: typeof body.key === 'string' ? body.key : '',
        name: typeof body.name === 'string' ? body.name : '',
        type: body.type as FieldTypeName,
        options: body.options,
      });
      return { ok: true, id: f.id.toString(), key: f.key };
    } catch (e) {
      return mapError(e);
    }
  }

  @Post(':id/options')
  async options(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { options?: unknown },
  ): Promise<{ ok: true }> {
    await assertTenantAdmin(ctx);
    try {
      await setFieldOptions(ctx, requireId(id, 'รหัสฟิลด์'), body.options);
      return { ok: true };
    } catch (e) {
      return mapError(e);
    }
  }

  @Post(':id/remove')
  async remove(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    await assertTenantAdmin(ctx);
    try {
      await removeField(ctx, requireId(id, 'รหัสฟิลด์'));
      return { ok: true };
    } catch (e) {
      return mapError(e);
    }
  }

  @Post(':id/config')
  async setConfig(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body()
    body: {
      projectId?: unknown;
      issueTypeId?: unknown;
      isRequired?: unknown;
      isVisible?: unknown;
      remove?: unknown;
    },
  ): Promise<{ ok: true; changed?: boolean }> {
    await assertTenantAdmin(ctx);
    const fieldId = requireId(id, 'รหัสฟิลด์');
    const projectId = requireId(body.projectId, 'รหัสโปรเจกต์');
    const issueTypeId = requireId(body.issueTypeId, 'รหัสประเภทงาน');
    try {
      if (body.remove === true) {
        await removeFieldConfig(ctx, projectId, issueTypeId, fieldId);
        return { ok: true };
      }
      const r = await setFieldConfig(ctx, {
        projectId,
        issueTypeId,
        fieldId,
        isRequired: body.isRequired === true,
        isVisible: body.isVisible !== false,
      });
      return { ok: true, changed: r.changed };
    } catch (e) {
      return mapError(e);
    }
  }
}
