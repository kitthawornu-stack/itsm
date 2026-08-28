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
  RuleConfigRequiredError,
  StatusHasTransitionsError,
  StatusInUseError,
  StatusNotFoundError,
  TransitionNotFoundError,
  UnknownRuleTypeError,
  WorkflowNotFoundError,
  addStatus,
  addTransition,
  addTransitionRule,
  createWorkflow,
  listWorkflowsAdmin,
  removeStatus,
  removeTransition,
  removeTransitionRule,
  ruleCatalog,
  rulesOf,
  setInitialStatus,
  statusesOf,
  transitionsOf,
  type StatusCategoryName,
} from './workflow-admin.service';

function mapError(e: unknown): never {
  if (e instanceof WorkflowNotFoundError || e instanceof StatusNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof TransitionNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (
    e instanceof NameRequiredError ||
    e instanceof DuplicateNameError ||
    e instanceof InitialStatusRequiredError ||
    // กฎที่ระบบไม่รู้จัก หรือ config ไม่ครบ = ข้อมูลที่ส่งมาใช้ไม่ได้ ไม่ใช่ระบบพัง
    e instanceof UnknownRuleTypeError ||
    e instanceof RuleConfigRequiredError
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
    /*
      ส่งกฎของทุกเส้นทางมาพร้อมกัน ไม่ให้หน้าจอยิงต่ออีกเส้นทางละคำขอ
      · และส่งรายการกฎที่เลือกได้มาด้วย เพราะมันมาจากเอนจิน ไม่ใช่จากหน้าจอ
    */
    const withRules = await Promise.all(
      transitions.map(async (t) => ({ ...t, rules: await rulesOf(ctx, BigInt(t.id)) })),
    );
    return { ...header, statuses, transitions: withRules, ruleCatalog: ruleCatalog() };
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

  @Post(':id/transitions/:transitionId/rules')
  async addRule(
    @Ctx() ctx: TenantContext,
    @Param('transitionId') transitionId: string,
    @Body()
    body: {
      kind?: unknown;
      ruleType?: unknown;
      fields?: unknown;
      groupIds?: unknown;
      goal?: unknown;
    },
  ): Promise<{ id: string }> {
    await assertTenantAdmin(ctx);
    const kind = body.kind;
    if (kind !== 'CONDITION' && kind !== 'VALIDATOR' && kind !== 'POST_FUNCTION') {
      throw new HttpException(
        { error: 'invalid_input', message: 'ชั้นของกฎไม่ถูกต้อง' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    try {
      const r = await addTransitionRule(ctx, {
        transitionId: requireId(transitionId, 'รหัสเส้นทาง'),
        kind,
        ruleType: typeof body.ruleType === 'string' ? body.ruleType : '',
        fields: strings(body.fields),
        groupIds: strings(body.groupIds),
        ...(typeof body.goal === 'string' ? { goal: body.goal } : {}),
      });
      return { id: r.id.toString() };
    } catch (e) {
      return mapError(e);
    }
  }

  @Post(':id/transitions/:transitionId/rules/:ruleId/remove')
  async dropRule(
    @Ctx() ctx: TenantContext,
    @Param('ruleId') ruleId: string,
  ): Promise<{ ok: true }> {
    await assertTenantAdmin(ctx);
    try {
      await removeTransitionRule(ctx, requireId(ruleId, 'รหัสกฎ'));
      return { ok: true };
    } catch (e) {
      return mapError(e);
    }
  }
}
