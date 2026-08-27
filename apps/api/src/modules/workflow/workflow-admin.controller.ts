/**
 * ตั้งค่า workflow — เฉพาะผู้ดูแล tenant
 *
 * ⚠️ ยังแก้กฎของ transition ไม่ได้ (ดูหัวไฟล์ workflow-admin.service.ts)
 */
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { assertTenantAdmin } from '../permission';
import {
  DuplicateNameError,
  InitialStatusRequiredError,
  NameRequiredError,
  StatusHasTransitionsError,
  StatusInUseError,
  StatusNotFoundError,
  WorkflowNotFoundError,
  addStatus,
  addTransition,
  createWorkflow,
  listWorkflowsAdmin,
  removeStatus,
  removeTransition,
  setInitialStatus,
  statusesOf,
  transitionsOf,
  type StatusCategoryName,
} from './workflow-admin.service';

function mapError(e: unknown): never {
  if (e instanceof WorkflowNotFoundError || e instanceof StatusNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (
    e instanceof NameRequiredError ||
    e instanceof DuplicateNameError ||
    e instanceof InitialStatusRequiredError
  ) {
    throw new HttpException(
      { error: 'invalid', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (e instanceof StatusInUseError || e instanceof StatusHasTransitionsError) {
    // 409 — คำขอถูกต้อง แต่สถานะของข้อมูลตอนนี้ทำให้ทำไม่ได้
    throw new HttpException({ error: 'in_use', message: e.message }, HttpStatus.CONFLICT);
  }
  throw e;
}

const idOf = (v: unknown): bigint | null =>
  typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : null;

function requireId(v: unknown, what: string): bigint {
  const id = idOf(v);
  if (id === null) {
    throw new HttpException({ error: 'invalid', message: `ต้องระบุ${what}` }, HttpStatus.BAD_REQUEST);
  }
  return id;
}

@Controller('admin/workflows')
export class WorkflowAdminController {
  @Get()
  async list(@Ctx() ctx: TenantContext): Promise<{ rows: unknown[] }> {
    await assertTenantAdmin(ctx);
    return { rows: await listWorkflowsAdmin(ctx) };
  }

  /** โครงเต็มของ workflow หนึ่งใบ — รวม workflow ที่ยังไม่ผูกโปรเจกต์ไหนเลย */
  @Get(':id')
  async detail(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<unknown> {
    await assertTenantAdmin(ctx);
    const wid = requireId(id, 'รหัส workflow');
    const rows = await listWorkflowsAdmin(ctx);
    const header = rows.find((w) => w.id === wid.toString());
    if (header === undefined) {
      throw new HttpException({ error: 'not_found', message: 'ไม่พบ workflow' }, HttpStatus.NOT_FOUND);
    }
    const statuses = await statusesOf(ctx, wid);
    const transitions = await transitionsOf(ctx, wid);
    return { ...header, statuses, transitions };
  }

  @Post()
  async create(
    @Ctx() ctx: TenantContext,
    @Body() body: { name?: unknown; initialStatus?: unknown },
  ): Promise<unknown> {
    await assertTenantAdmin(ctx);
    try {
      const wf = await createWorkflow(
        ctx,
        typeof body.name === 'string' ? body.name : '',
        typeof body.initialStatus === 'string' ? body.initialStatus : '',
      );
      return { ok: true, id: wf.id.toString(), name: wf.name };
    } catch (e) {
      return mapError(e);
    }
  }

  @Post(':id/statuses')
  async status(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { name?: unknown; category?: unknown; pausesSla?: unknown },
  ): Promise<unknown> {
    await assertTenantAdmin(ctx);
    try {
      const st = await addStatus(ctx, requireId(id, 'รหัส workflow'), {
        name: typeof body.name === 'string' ? body.name : '',
        category: body.category as StatusCategoryName,
        pausesSla: body.pausesSla === true,
      });
      return { ok: true, id: st.id.toString() };
    } catch (e) {
      return mapError(e);
    }
  }

  @Post(':id/statuses/:statusId/initial')
  async initial(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('statusId') statusId: string,
  ): Promise<{ ok: true }> {
    await assertTenantAdmin(ctx);
    try {
      await setInitialStatus(ctx, requireId(id, 'รหัส workflow'), requireId(statusId, 'รหัสสถานะ'));
      return { ok: true };
    } catch (e) {
      return mapError(e);
    }
  }

  @Post(':id/statuses/:statusId/remove')
  async dropStatus(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('statusId') statusId: string,
  ): Promise<{ ok: true }> {
    await assertTenantAdmin(ctx);
    try {
      await removeStatus(ctx, requireId(id, 'รหัส workflow'), requireId(statusId, 'รหัสสถานะ'));
      return { ok: true };
    } catch (e) {
      return mapError(e);
    }
  }

  @Post(':id/transitions')
  async transition(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { name?: unknown; fromStatusId?: unknown; toStatusId?: unknown },
  ): Promise<unknown> {
    await assertTenantAdmin(ctx);
    try {
      const t = await addTransition(ctx, requireId(id, 'รหัส workflow'), {
        name: typeof body.name === 'string' ? body.name : '',
        // ไม่ส่งมา = ทำได้จากทุกสถานะ · ต่างจากส่งรหัสที่ไม่มีอยู่ ซึ่งถูกปฏิเสธ
        fromStatusId: idOf(body.fromStatusId),
        toStatusId: requireId(body.toStatusId, 'สถานะปลายทาง'),
      });
      return { ok: true, id: t.id.toString() };
    } catch (e) {
      return mapError(e);
    }
  }

  @Post(':id/transitions/:transitionId/remove')
  async dropTransition(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('transitionId') transitionId: string,
  ): Promise<{ ok: true }> {
    await assertTenantAdmin(ctx);
    try {
      await removeTransition(
        ctx,
        requireId(id, 'รหัส workflow'),
        requireId(transitionId, 'รหัสเส้นทาง'),
      );
      return { ok: true };
    } catch (e) {
      return mapError(e);
    }
  }
}
