/**
 * ประเภทงาน — เกณฑ์ผ่าน Phase 0 ส่วนที่สอง
 *
 * การผูกเข้ากับโปรเจกต์อยู่ที่นี่ด้วย เพราะประเภทงานที่ไม่ได้ผูกกับโปรเจกต์ไหนเลย
 * ไม่มีความหมาย — สร้างแล้วไม่มีใครเลือกได้
 */
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { assertTenantAdmin } from '../permission';
import {
  BindingInUseError,
  DuplicateIssueTypeError,
  IssueTypeInUseError,
  IssueTypeNameRequiredError,
  IssueTypeNotFoundError,
  WorkflowUnusableError,
  bindIssueType,
  createIssueType,
  listIssueTypes,
  removeIssueType,
  unbindIssueType,
} from './issue-type.service';
const idOf = (v: unknown): bigint | null =>
  typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : null;

function requireId(v: unknown, what: string): bigint {
  const id = idOf(v);
  if (id === null) {
    throw new HttpException({ error: 'invalid', message: `ต้องระบุ${what}` }, HttpStatus.BAD_REQUEST);
  }
  return id;
}

function mapIssueTypeError(e: unknown): never {
  if (e instanceof IssueTypeNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (
    e instanceof IssueTypeNameRequiredError ||
    e instanceof DuplicateIssueTypeError ||
    e instanceof WorkflowUnusableError
  ) {
    throw new HttpException(
      { error: 'invalid', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (e instanceof IssueTypeInUseError || e instanceof BindingInUseError) {
    // 409 — คำขอถูกต้อง แต่สถานะของข้อมูลตอนนี้ทำให้ทำไม่ได้
    throw new HttpException({ error: 'in_use', message: e.message }, HttpStatus.CONFLICT);
  }
  throw e;
}

/**
 * ประเภทงาน — เกณฑ์ผ่าน Phase 0 ส่วนที่สอง
 *
 * การผูกเข้ากับโปรเจกต์อยู่ที่นี่ด้วย เพราะประเภทงานที่ไม่ได้ผูกกับโปรเจกต์ไหนเลย
 * ไม่มีความหมาย — สร้างแล้วไม่มีใครเลือกได้
 */
@Controller('admin/issue-types')
export class IssueTypeController {
  @Get()
  async list(@Ctx() ctx: TenantContext): Promise<{ rows: unknown[] }> {
    await assertTenantAdmin(ctx);
    return { rows: await listIssueTypes(ctx) };
  }

  @Post()
  async create(
    @Ctx() ctx: TenantContext,
    @Body() body: { name?: unknown; isSubtask?: unknown },
  ): Promise<unknown> {
    await assertTenantAdmin(ctx);
    try {
      const t = await createIssueType(
        ctx,
        typeof body.name === 'string' ? body.name : '',
        body.isSubtask === true,
      );
      return { ok: true, id: t.id.toString(), name: t.name };
    } catch (e) {
      return mapIssueTypeError(e);
    }
  }

  @Post(':id/remove')
  async remove(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    await assertTenantAdmin(ctx);
    try {
      await removeIssueType(ctx, requireId(id, 'รหัสประเภทงาน'));
      return { ok: true };
    } catch (e) {
      return mapIssueTypeError(e);
    }
  }

  @Post(':id/bind')
  async bind(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { projectId?: unknown; workflowId?: unknown; unbind?: unknown },
  ): Promise<{ ok: true; changed?: boolean }> {
    await assertTenantAdmin(ctx);
    const typeId = requireId(id, 'รหัสประเภทงาน');
    const projectId = requireId(body.projectId, 'รหัสโปรเจกต์');
    try {
      if (body.unbind === true) {
        await unbindIssueType(ctx, projectId, typeId);
        return { ok: true };
      }
      const r = await bindIssueType(ctx, projectId, typeId, requireId(body.workflowId, 'workflow'));
      return { ok: true, changed: r.changed };
    } catch (e) {
      return mapIssueTypeError(e);
    }
  }
}
