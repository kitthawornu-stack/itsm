/**
 * แก้ workflow จากหน้าจอ — สถานะและเส้นทาง
 *
 * เกณฑ์ผ่าน Phase 0 ข้อแรกคือ "แอดมินสร้าง workflow 5 สถานะได้จาก UI โดยไม่แตะโค้ด"
 * ซึ่งยังไม่ผ่านมาตลอด — เพิ่มสถานะหนึ่งอันต้องเขียน SQL
 *
 * ⚠️ **ยังแก้กฎของ transition (CONDITION / VALIDATOR / POST_FUNCTION) ไม่ได้**
 * ไฟล์นี้สร้างเครื่องสถานะได้ แต่ยังตั้งไม่ได้ว่า "ปิดงานต้องระบุผลการแก้ไข"
 * — ส่วนนั้นลึกที่สุดและควรมีรอบของตัวเอง · หน้าจอบอกข้อจำกัดนี้ไว้แล้ว
 *
 * **การแก้ workflow ที่ใช้งานอยู่ กระทบตั๋วที่เปิดอยู่ทันที** ไม่ใช่เฉพาะตั๋วใหม่
 * ทุกฟังก์ชันที่นี่จึงตอบได้ว่ากระทบกี่ใบ ก่อนจะให้กด
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

export type StatusCategoryName = 'TODO' | 'IN_PROGRESS' | 'DONE';
export const STATUS_CATEGORIES: readonly StatusCategoryName[] = ['TODO', 'IN_PROGRESS', 'DONE'];

export class WorkflowNotFoundError extends Error {
  constructor(id: bigint) {
    super(`ไม่พบ workflow #${id.toString()}`);
    this.name = 'WorkflowNotFoundError';
  }
}

export class StatusNotFoundError extends Error {
  constructor(id: bigint) {
    super(`ไม่พบสถานะ #${id.toString()}`);
    this.name = 'StatusNotFoundError';
  }
}

export class NameRequiredError extends Error {
  constructor(what: string) {
    super(`ต้องระบุชื่อ${what}`);
    this.name = 'NameRequiredError';
  }
}

export class DuplicateNameError extends Error {
  constructor(readonly given: string) {
    super(`มี "${given}" อยู่แล้วใน workflow นี้`);
    this.name = 'DuplicateNameError';
  }
}

export class StatusInUseError extends Error {
  constructor(
    readonly statusName: string,
    readonly itemCount: number,
  ) {
    super(
      `ลบสถานะ "${statusName}" ไม่ได้ เพราะมีงานอยู่ในสถานะนี้ ${String(itemCount)} เรื่อง — ` +
        'ย้ายงานออกก่อน ไม่งั้นงานเหล่านั้นจะชี้ไปยังสถานะที่ไม่มีอยู่',
    );
    this.name = 'StatusInUseError';
  }
}

export class StatusHasTransitionsError extends Error {
  constructor(
    readonly statusName: string,
    readonly count: number,
  ) {
    super(
      `ลบสถานะ "${statusName}" ไม่ได้ เพราะมีเส้นทาง ${String(count)} เส้นเชื่อมอยู่ — ลบเส้นทางนั้นก่อน`,
    );
    this.name = 'StatusHasTransitionsError';
  }
}

export class InitialStatusRequiredError extends Error {
  constructor() {
    super(
      'workflow ต้องมีสถานะเริ่มต้นหนึ่งสถานะเสมอ — ไม่มีสถานะเริ่มต้นแปลว่าแจ้งเรื่องใหม่ไม่ได้เลย',
    );
    this.name = 'InitialStatusRequiredError';
  }
}

const NAME_MAX = 64;

function cleanName(v: unknown, what: string): string {
  const s = (typeof v === 'string' ? v : '').trim();
  if (s === '') throw new NameRequiredError(what);
  return s.slice(0, NAME_MAX);
}

async function loadWorkflow(
  ctx: TenantContext,
  workflowId: bigint,
): Promise<{ id: bigint; name: string }> {
  const row = await tenantScoped(ctx).workflow.findFirst({
    where: { id: workflowId },
    select: { id: true, name: true },
  });
  if (row === null) throw new WorkflowNotFoundError(workflowId);
  return row;
}

// ============================================================
// workflow
// ============================================================

/**
 * สร้าง workflow ใหม่พร้อมสถานะเริ่มต้นหนึ่งสถานะ
 *
 * สร้างเปล่าไม่ได้โดยตั้งใจ — workflow ที่ไม่มีสถานะเริ่มต้นผูกกับโปรเจกต์แล้ว
 * ทำให้แจ้งเรื่องใหม่ล้มเหลว และ `createProject` ก็ปฏิเสธมันอยู่แล้ว
 * การให้สร้างของที่ใช้ไม่ได้ไว้ก่อนแล้วค่อยเติม คือการเปิดช่องให้มีของพังค้างไว้
 */
export async function createWorkflow(
  ctx: TenantContext,
  rawName: string,
  rawInitialStatus: string,
): Promise<{ id: bigint; name: string }> {
  const db = tenantScoped(ctx);
  const name = cleanName(rawName, 'workflow');
  const statusName = cleanName(rawInitialStatus, 'สถานะเริ่มต้น');
  if ((await db.workflow.findFirst({ where: { name }, select: { id: true } })) !== null) {
    throw new DuplicateNameError(name);
  }

  return auditedTransaction(ctx, 'workflow.create', async (tx) => {
    const wf = await tx.workflow.create({
      data: { tenantId: ctx.tenantId, name, version: 1, isActive: true },
      select: { id: true, name: true },
    });
    await tx.workflowStatus.create({
      data: {
        tenantId: ctx.tenantId,
        workflowId: wf.id,
        name: statusName,
        category: 'TODO',
        position: 1,
        isInitial: true,
      },
    });
    return {
      result: wf,
      audit: [
        {
          kind: 'system',
          action: 'workflow.create',
          entityType: 'workflow',
          entityId: wf.id.toString(),
          payload: { name, initialStatus: statusName },
        },
      ],
    };
  });
}

// ============================================================
// สถานะ
// ============================================================

export async function addStatus(
  ctx: TenantContext,
  workflowId: bigint,
  input: { name: string; category: StatusCategoryName; pausesSla?: boolean },
): Promise<{ id: bigint }> {
  const db = tenantScoped(ctx);
  const wf = await loadWorkflow(ctx, workflowId);
  const name = cleanName(input.name, 'สถานะ');
  if (!STATUS_CATEGORIES.includes(input.category)) {
    throw new NameRequiredError('หมวดของสถานะ');
  }
  if (
    (await db.workflowStatus.findFirst({ where: { workflowId, name }, select: { id: true } })) !==
    null
  ) {
    throw new DuplicateNameError(name);
  }
  const last = await db.workflowStatus.findFirst({
    where: { workflowId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  return auditedTransaction(ctx, 'workflow.status.add', async (tx) => {
    const st = await tx.workflowStatus.create({
      data: {
        tenantId: ctx.tenantId,
        workflowId,
        name,
        category: input.category,
        position: (last?.position ?? 0) + 1,
        // สถานะเริ่มต้นมีได้อันเดียว และตั้งผ่าน `setInitialStatus` เท่านั้น
        isInitial: false,
        pausesSla: input.pausesSla === true,
      },
      select: { id: true },
    });
    return {
      result: st,
      audit: [
        {
          kind: 'system',
          action: 'workflow.status.add',
          entityType: 'workflow',
          entityId: workflowId.toString(),
          payload: { workflow: wf.name, status: name, category: input.category },
        },
      ],
    };
  });
}

/**
 * ตั้งสถานะเริ่มต้น — ย้ายจากอันเดิมมาอันใหม่ในทรานแซกชันเดียว
 *
 * ไม่มีท่า "ยกเลิกสถานะเริ่มต้น" เพราะ workflow ที่ไม่มีสถานะเริ่มต้น
 * แจ้งเรื่องใหม่ไม่ได้ · การเปลี่ยนจึงเป็นการ **ย้าย** ไม่ใช่ปิดแล้วเปิด
 */
export async function setInitialStatus(
  ctx: TenantContext,
  workflowId: bigint,
  statusId: bigint,
): Promise<void> {
  const db = tenantScoped(ctx);
  const wf = await loadWorkflow(ctx, workflowId);
  const target = await db.workflowStatus.findFirst({
    where: { id: statusId, workflowId },
    select: { id: true, name: true, isInitial: true },
  });
  if (target === null) throw new StatusNotFoundError(statusId);
  if (target.isInitial) return;

  await auditedTransaction(ctx, 'workflow.status.initial', async (tx) => {
    await tx.workflowStatus.updateMany({ where: { workflowId }, data: { isInitial: false } });
    await tx.workflowStatus.update({ where: { id: statusId }, data: { isInitial: true } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'workflow.status.initial',
          entityType: 'workflow',
          entityId: workflowId.toString(),
          payload: { workflow: wf.name, status: target.name },
        },
      ],
    };
  });
}

/**
 * ลบสถานะ
 *
 * ปฏิเสธเมื่อมีงานอยู่ในสถานะนั้น หรือมีเส้นทางเชื่อมอยู่ · ทั้งสองอย่างทำให้เกิด
 * แถวที่ชี้ไปยังสิ่งที่ไม่มีอยู่ ซึ่งฐานข้อมูลกันไว้ด้วย `onDelete: Restrict` อยู่แล้ว
 * แต่ error ของฐานข้อมูลอ่านไม่รู้เรื่องสำหรับคนที่กดปุ่ม — ต้องตอบเป็นภาษาคน
 * พร้อมจำนวนที่กระทบ ไม่ใช่แค่ว่า "ลบไม่ได้"
 */
export async function removeStatus(
  ctx: TenantContext,
  workflowId: bigint,
  statusId: bigint,
): Promise<void> {
  const db = tenantScoped(ctx);
  const wf = await loadWorkflow(ctx, workflowId);
  const st = await db.workflowStatus.findFirst({
    where: { id: statusId, workflowId },
    select: { id: true, name: true, isInitial: true },
  });
  if (st === null) throw new StatusNotFoundError(statusId);
  if (st.isInitial) throw new InitialStatusRequiredError();

  const items = await db.workItem.count({ where: { statusId } });
  if (items > 0) throw new StatusInUseError(st.name, items);

  const links = await db.workflowTransition.count({
    where: { workflowId, OR: [{ fromStatusId: statusId }, { toStatusId: statusId }] },
  });
  if (links > 0) throw new StatusHasTransitionsError(st.name, links);

  await auditedTransaction(ctx, 'workflow.status.remove', async (tx) => {
    await tx.workflowStatus.delete({ where: { id: statusId } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'workflow.status.remove',
          entityType: 'workflow',
          entityId: workflowId.toString(),
          payload: { workflow: wf.name, status: st.name },
        },
      ],
    };
  });
}

// ============================================================
// เส้นทาง
// ============================================================

export async function addTransition(
  ctx: TenantContext,
  workflowId: bigint,
  input: { name: string; fromStatusId: bigint | null; toStatusId: bigint },
): Promise<{ id: bigint }> {
  const db = tenantScoped(ctx);
  const wf = await loadWorkflow(ctx, workflowId);
  const name = cleanName(input.name, 'ปุ่ม');

  const to = await db.workflowStatus.findFirst({
    where: { id: input.toStatusId, workflowId },
    select: { id: true, name: true },
  });
  if (to === null) throw new StatusNotFoundError(input.toStatusId);

  // `from` เป็น null ได้ = ทำได้จากทุกสถานะ · แต่ถ้าระบุมา ต้องอยู่ workflow เดียวกัน
  // ไม่งั้นจะได้เส้นทางที่ไม่มีวันปรากฏ เพราะสถานะปัจจุบันไม่มีทางตรงกับมัน
  let from: { id: bigint; name: string } | null = null;
  if (input.fromStatusId !== null) {
    from = await db.workflowStatus.findFirst({
      where: { id: input.fromStatusId, workflowId },
      select: { id: true, name: true },
    });
    if (from === null) throw new StatusNotFoundError(input.fromStatusId);
  }

  const clash = await db.workflowTransition.findFirst({
    where: { workflowId, name },
    select: { id: true },
  });
  if (clash !== null) throw new DuplicateNameError(name);

  const last = await db.workflowTransition.findFirst({
    where: { workflowId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  return auditedTransaction(ctx, 'workflow.transition.add', async (tx) => {
    const t = await tx.workflowTransition.create({
      data: {
        tenantId: ctx.tenantId,
        workflowId,
        name,
        fromStatusId: from?.id ?? null,
        toStatusId: to.id,
        position: (last?.position ?? 0) + 1,
      },
      select: { id: true },
    });
    return {
      result: t,
      audit: [
        {
          kind: 'system',
          action: 'workflow.transition.add',
          entityType: 'workflow',
          entityId: workflowId.toString(),
          payload: { workflow: wf.name, name, from: from?.name ?? 'ทุกสถานะ', to: to.name },
        },
      ],
    };
  });
}

export async function removeTransition(
  ctx: TenantContext,
  workflowId: bigint,
  transitionId: bigint,
): Promise<void> {
  const db = tenantScoped(ctx);
  const wf = await loadWorkflow(ctx, workflowId);
  const t = await db.workflowTransition.findFirst({
    where: { id: transitionId, workflowId },
    select: { id: true, name: true },
  });
  if (t === null) throw new StatusNotFoundError(transitionId);

  await auditedTransaction(ctx, 'workflow.transition.remove', async (tx) => {
    // กฎของเส้นทางถูกลบตาม (onDelete: Cascade บน transition_rule) ซึ่งถูกต้อง —
    // กฎที่ไม่มีเส้นทางไม่มีความหมาย
    await tx.workflowTransition.delete({ where: { id: transitionId } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'workflow.transition.remove',
          entityType: 'workflow',
          entityId: workflowId.toString(),
          payload: { workflow: wf.name, name: t.name },
        },
      ],
    };
  });
}

/** workflow ทั้งหมดพร้อมจำนวนที่กระทบ — ใช้บนหน้าตั้งค่า */
export async function listWorkflowsAdmin(ctx: TenantContext): Promise<
  Array<{
    id: string;
    name: string;
    statusCount: number;
    transitionCount: number;
    /** โปรเจกต์ที่ใช้ workflow นี้ — แก้ที่นี่กระทบตั๋วที่เปิดอยู่ในโปรเจกต์เหล่านั้นทันที */
    usedBy: string[];
  }>
> {
  const rows = await tenantScoped(ctx).workflow.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { statuses: true, transitions: true } },
      schemes: { include: { project: { select: { key: true } } } },
    },
  });
  return rows.map((w) => ({
    id: w.id.toString(),
    name: w.name,
    statusCount: w._count.statuses,
    transitionCount: w._count.transitions,
    usedBy: [...new Set(w.schemes.map((s) => s.project.key))].sort((a, b) => a.localeCompare(b)),
  }));
}

/**
 * สถานะของ workflow หนึ่งใบ พร้อมจำนวนงานที่ค้างอยู่ในแต่ละสถานะ
 *
 * ใช้ `describeProjectWorkflows` แทนไม่ได้ เพราะตัวนั้นเริ่มจากโปรเจกต์
 * และ workflow ที่ยังไม่ผูกโปรเจกต์ไหนเลยจะไม่ปรากฏ — ซึ่งเป็นสถานะปกติ
 * ของ workflow ที่เพิ่งสร้างและกำลังจะแก้
 */
export async function statusesOf(
  ctx: TenantContext,
  workflowId: bigint,
): Promise<
  Array<{
    id: string;
    name: string;
    category: string;
    isInitial: boolean;
    pausesSla: boolean;
    itemCount: number;
  }>
> {
  const rows = await tenantScoped(ctx).workflowStatus.findMany({
    where: { workflowId },
    orderBy: { position: 'asc' },
    include: { _count: { select: { workItems: true } } },
  });
  return rows.map((s) => ({
    id: s.id.toString(),
    name: s.name,
    category: s.category,
    isInitial: s.isInitial,
    pausesSla: s.pausesSla,
    itemCount: s._count.workItems,
  }));
}

export async function transitionsOf(
  ctx: TenantContext,
  workflowId: bigint,
): Promise<Array<{ id: string; name: string; from: string | null; to: string; ruleCount: number }>> {
  const rows = await tenantScoped(ctx).workflowTransition.findMany({
    where: { workflowId },
    orderBy: { position: 'asc' },
    include: {
      fromStatus: { select: { name: true } },
      toStatus: { select: { name: true } },
      _count: { select: { rules: true } },
    },
  });
  return rows.map((t) => ({
    id: t.id.toString(),
    name: t.name,
    // null = ทำได้จากทุกสถานะ · ต้องต่างจาก "ไม่รู้ว่ามาจากไหน"
    from: t.fromStatus?.name ?? null,
    to: t.toStatus.name,
    /**
     * กฎยังแก้จากหน้าจอไม่ได้ แต่ต้องบอกว่ามีอยู่กี่ข้อ
     *
     * `transition_rule` เป็น `onDelete: Cascade` — การลบเส้นทางลบกฎไปด้วย
     * ถ้าไม่แสดงจำนวน ผู้ดูแลจะลบเส้นทางที่มีเงื่อนไขสำคัญตั้งไว้
     * โดยไม่รู้ว่ากำลังลบอะไรไปพร้อมกัน
     */
    ruleCount: t._count.rules,
  }));
}
