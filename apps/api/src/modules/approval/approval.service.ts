/**
 * การอนุมัติขั้นเดียว
 *
 * คำขอบริการจำนวนมากต้องมีคนเห็นชอบก่อนทีมจะลงมือ — ซื้อของ ขอสิทธิ์เข้าระบบ
 * เปลี่ยนแปลงที่กระทบคนอื่น · ถ้าไม่มีที่บันทึก การอนุมัติจะเกิดใน LINE หรือ
 * ในห้องประชุม แล้วไม่มีใครตอบได้ว่าใครอนุมัติเมื่อไรด้วยเหตุผลอะไร
 *
 * **เก็บเป็นประวัติ ไม่ใช่แถวเดียวที่ถูกเขียนทับ** — คำขอที่ถูกปฏิเสธแล้วขอใหม่
 * ต้องตอบได้ว่าเคยถูกปฏิเสธเพราะอะไร (บทเรียนเดียวกับ `breachAt`/`breachedAt`)
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { auditedTransaction, change } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

export class WorkItemNotFoundForApprovalError extends Error {
  constructor(readonly itemKey: string) {
    super(`ไม่พบงาน ${itemKey}`);
    this.name = 'WorkItemNotFoundForApprovalError';
  }
}

export class AlreadyPendingError extends Error {
  constructor() {
    super('เรื่องนี้มีคำขออนุมัติที่ยังรออยู่แล้ว');
    this.name = 'AlreadyPendingError';
  }
}

export class NoPendingApprovalError extends Error {
  constructor() {
    super('ไม่มีคำขออนุมัติที่รอการตัดสินใจ');
    this.name = 'NoPendingApprovalError';
  }
}

/**
 * ไม่ได้อยู่ในกลุ่มผู้อนุมัติ
 *
 * ไม่บอกว่ากลุ่มไหนอนุมัติได้ — การไล่บอกคือการวาดแผนที่ให้คนที่กำลังลอง
 * (กติกาเดียวกับข้อความปฏิเสธของโมดูล permission)
 */
export class NotAnApproverError extends Error {
  constructor() {
    super('คุณไม่มีสิทธิ์ตัดสินคำขอนี้');
    this.name = 'NotAnApproverError';
  }
}

/**
 * ผู้ขอเป็นคนอนุมัติเอง
 *
 * แยกจาก `NotAnApproverError` เพราะเป็นคนละเรื่อง: คนนี้ **อยู่ในกลุ่มผู้อนุมัติจริง**
 * แต่กำลังอนุมัติคำขอของตัวเอง · การอนุมัติที่ผู้ขอกดเองไม่ใช่การอนุมัติ
 * และถ้าปล่อยผ่าน ทุกคำขอของคนในกลุ่มผู้อนุมัติจะผ่านอัตโนมัติโดยไม่มีใครเห็น
 */
export class SelfApprovalError extends Error {
  constructor() {
    super('อนุมัติคำขอของตัวเองไม่ได้ — ต้องให้คนอื่นในกลุ่มเป็นคนตัดสิน');
    this.name = 'SelfApprovalError';
  }
}

export class RejectionNeedsReasonError extends Error {
  constructor() {
    // การปฏิเสธที่ไม่บอกเหตุผลคือทางตันของผู้ขอ — เขาไม่รู้ว่าต้องแก้อะไร
    super('การปฏิเสธต้องระบุเหตุผล');
    this.name = 'RejectionNeedsReasonError';
  }
}

export type ApprovalState = 'none' | 'pending' | 'approved' | 'rejected';

export interface ApprovalView {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  approverGroup: string;
  requestedBy: string;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

const INCLUDE = {
  approverGroup: { select: { name: true } },
  requestedBy: { select: { displayName: true } },
  decidedBy: { select: { displayName: true } },
} as const;

/**
 * สถานะการอนุมัติล่าสุดของงานใบหนึ่ง
 *
 * `CANCELLED` ถือเป็น `none` — คำขอที่ถูกยกเลิกไม่ใช่การตัดสินใจของคน
 * และไม่ควรกั้นไม่ให้ขอใหม่
 */
export async function approvalStateOf(
  ctx: TenantContext,
  workItemId: bigint,
): Promise<ApprovalState> {
  const latest = await tenantScoped(ctx).approval.findFirst({
    where: { workItemId },
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  });
  if (latest === null) return 'none';
  switch (latest.status) {
    case 'PENDING':
      return 'pending';
    case 'APPROVED':
      return 'approved';
    case 'REJECTED':
      return 'rejected';
    default:
      return 'none';
  }
}

/** ประวัติการอนุมัติทั้งหมดของงานใบหนึ่ง — ใหม่สุดก่อน */
export async function approvalsFor(
  ctx: TenantContext,
  itemKey: string,
): Promise<ApprovalView[]> {
  const rows = await tenantScoped(ctx).approval.findMany({
    where: { workItem: { itemKey } },
    orderBy: { createdAt: 'desc' },
    include: INCLUDE,
  });
  return rows.map((a) => ({
    id: a.id.toString(),
    status: a.status,
    approverGroup: a.approverGroup.name,
    requestedBy: a.requestedBy.displayName,
    reason: a.reason,
    decidedBy: a.decidedBy?.displayName ?? null,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    decisionNote: a.decisionNote,
    createdAt: a.createdAt.toISOString(),
  }));
}

/**
 * ขออนุมัติ
 *
 * **หนึ่งคำขอที่ค้างอยู่ต่อหนึ่งเรื่อง** — MySQL ไม่มี partial index จึงบังคับ
 * ด้วยโค้ด · ถ้าปล่อยให้ขอซ้อนกันได้ จะมีคำขอสองใบที่คนละคนตัดสินคนละทาง
 * แล้วไม่มีใครตอบได้ว่าอันไหนคือคำตอบ
 */
export async function requestApproval(
  ctx: TenantContext,
  itemKey: string,
  approverGroupId: bigint,
  reason?: string,
): Promise<{ id: bigint }> {
  if (ctx.actorId === null) throw new NotAnApproverError();
  const db = tenantScoped(ctx);

  const item = await db.workItem.findFirst({
    where: { itemKey },
    select: { id: true, summary: true },
  });
  if (item === null) throw new WorkItemNotFoundForApprovalError(itemKey);

  if ((await approvalStateOf(ctx, item.id)) === 'pending') throw new AlreadyPendingError();

  const group = await db.userGroup.findFirst({
    where: { id: approverGroupId },
    select: { id: true, name: true, _count: { select: { members: true } } },
  });
  if (group === null) throw new NotAnApproverError();
  /*
    กลุ่มที่ไม่มีสมาชิกเลย = คำขอที่ไม่มีวันมีใครมาตัดสิน
    ต้องดังตอนขอ ไม่ใช่ปล่อยให้ค้างอยู่เงียบ ๆ แล้วผู้ขอรอไปเรื่อย ๆ
  */
  if (group._count.members === 0) throw new NotAnApproverError();

  return auditedTransaction(ctx, 'approval.request', async (tx) => {
    const row = await tx.approval.create({
      data: {
        tenantId: ctx.tenantId,
        workItemId: item.id,
        approverGroupId,
        requestedById: ctx.actorId ?? BigInt(0),
        reason: reason?.trim() === '' ? null : (reason?.trim() ?? null),
      },
      select: { id: true },
    });

    /*
      แจ้งทุกคนในกลุ่มผู้อนุมัติ **ในทรานแซกชันเดียวกับการสร้างคำขอ**
      คำขอที่ไม่มีใครรู้ว่ามี ก็คือคำขอที่ไม่มีวันได้รับการตัดสิน
      `dedupeKey` ไม่มีเวลาอยู่ในคีย์ — ประกอบจาก (คำขอ, ผู้รับ)
    */
    const members = await tx.groupMember.findMany({
      where: { groupId: approverGroupId },
      select: { userId: true },
    });
    await tx.notification.createMany({
      data: members
        // ไม่แจ้งผู้ขอเอง แม้เขาจะอยู่ในกลุ่ม — เขารู้อยู่แล้วว่าเพิ่งกดขอ
        .filter((m) => m.userId !== ctx.actorId)
        .map((m) => ({
          tenantId: ctx.tenantId,
          userId: m.userId,
          workItemId: item.id,
          kind: 'approval.requested',
          title: `${itemKey} รออนุมัติจาก ${group.name}`,
          body: item.summary,
          dedupeKey: `approval:${row.id.toString()}:${m.userId.toString()}`,
        })),
      skipDuplicates: true,
    });

    return {
      result: row,
      audit: [change(item.id, 'approval', null, `ขออนุมัติจาก ${group.name}`)],
    };
  });
}

export interface DecideInput {
  approve: boolean;
  note?: string | undefined;
}

/**
 * ตัดสินคำขอ
 *
 * ตรวจสามชั้นตามลำดับ: มีคำขอค้างอยู่ไหม → อยู่ในกลุ่มผู้อนุมัติไหม →
 * เป็นผู้ขอเองหรือเปล่า · ลำดับนี้สำคัญ เพราะคนที่ไม่อยู่ในกลุ่มไม่ควรรู้ว่า
 * มีคำขอค้างอยู่หรือไม่จากข้อความ error
 */
export async function decideApproval(
  ctx: TenantContext,
  itemKey: string,
  input: DecideInput,
  now: UtcDate = systemClock.nowUtc(),
): Promise<void> {
  if (ctx.actorId === null) throw new NotAnApproverError();
  const db = tenantScoped(ctx);

  const item = await db.workItem.findFirst({ where: { itemKey }, select: { id: true } });
  if (item === null) throw new WorkItemNotFoundForApprovalError(itemKey);

  const pending = await db.approval.findFirst({
    where: { workItemId: item.id, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    include: INCLUDE,
  });
  if (pending === null) throw new NoPendingApprovalError();

  const isMember = await db.groupMember.findFirst({
    where: { groupId: pending.approverGroupId, userId: ctx.actorId },
    select: { userId: true },
  });
  if (isMember === null) throw new NotAnApproverError();

  // อยู่ในกลุ่มจริง แต่เป็นคนขอเอง — คนละเรื่องกับไม่มีสิทธิ์
  if (pending.requestedById === ctx.actorId) throw new SelfApprovalError();

  const note = input.note?.trim() === '' ? null : (input.note?.trim() ?? null);
  // ปฏิเสธต้องบอกเหตุผล · อนุมัติไม่ต้อง — "อนุมัติ" อธิบายตัวเองอยู่แล้ว
  if (!input.approve && note === null) throw new RejectionNeedsReasonError();

  await auditedTransaction(ctx, 'approval.decide', async (tx) => {
    await tx.approval.update({
      where: { id: pending.id },
      data: {
        status: input.approve ? 'APPROVED' : 'REJECTED',
        decidedById: ctx.actorId,
        decidedAt: now,
        decisionNote: note,
      },
    });
    await tx.notification.createMany({
      data: [
        {
          tenantId: ctx.tenantId,
          userId: pending.requestedById,
          workItemId: item.id,
          kind: 'approval.decided',
          title: `${itemKey} ${input.approve ? 'ได้รับอนุมัติแล้ว' : 'ถูกปฏิเสธ'}`,
          body: note,
          dedupeKey: `approval-decided:${pending.id.toString()}`,
        },
      ],
      skipDuplicates: true,
    });
    return {
      result: undefined,
      audit: [
        change(
          item.id,
          'approval',
          'รออนุมัติ',
          input.approve ? 'อนุมัติแล้ว' : `ปฏิเสธ — ${note ?? ''}`,
        ),
      ],
    };
  });
}

/** กลุ่มที่เลือกเป็นผู้อนุมัติได้ — เฉพาะกลุ่มที่มีสมาชิกจริง */
export async function approverGroups(
  ctx: TenantContext,
): Promise<Array<{ id: string; name: string; memberCount: number }>> {
  const rows = await tenantScoped(ctx).userGroup.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, _count: { select: { members: true } } },
  });
  return rows
    .filter((g) => g._count.members > 0)
    .map((g) => ({ id: g.id.toString(), name: g.name, memberCount: g._count.members }));
}
