/**
 * การอนุมัติ
 *
 * คำขอบริการจำนวนมากต้องมีคนเห็นชอบก่อนทีมจะลงมือ — ซื้อของ ขอสิทธิ์เข้าระบบ
 * เปลี่ยนแปลงที่กระทบคนอื่น · ถ้าไม่มีที่บันทึก การอนุมัติจะเกิดใน LINE หรือ
 * ในห้องประชุม แล้วไม่มีใครตอบได้ว่าใครอนุมัติเมื่อไรด้วยเหตุผลอะไร
 *
 * **เก็บเป็นประวัติ ไม่ใช่แถวเดียวที่ถูกเขียนทับ** — คำขอที่ถูกปฏิเสธแล้วขอใหม่
 * ต้องตอบได้ว่าเคยถูกปฏิเสธเพราะอะไร (บทเรียนเดียวกับ `breachAt`/`breachedAt`)
 *
 * ## หนึ่งคำขอ = หนึ่ง **สาย** ที่มีได้หลายขั้น
 *
 * ทุกขั้นถูกสร้างในทรานแซกชันเดียวกันตั้งแต่ตอนขอ ขั้นที่ยังไม่ถึงเป็น `WAITING`
 * เพื่อให้ผู้ขอเห็นแต่แรกว่าเหลืออีกกี่ด่าน · ตรรกะการเดินสายอยู่ใน
 * `approval-chain.ts` เป็นฟังก์ชันบริสุทธิ์ ไฟล์นี้ทำแค่แปลงเป็นคำสั่งฐานข้อมูล
 *
 * **ลำดับขั้นอ่านจาก `stepNumber` เท่านั้น ไม่ใช่ `createdAt`** — ทุกขั้นถูกสร้าง
 * ในทรานแซกชันเดียวกัน เวลาที่บันทึกจึงเท่ากันได้ทั้งสาย
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { auditedTransaction, change } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { createNotifications } from '../notification';
import {
  AlreadyDecidedInChainError,
  NotYourTurnError,
  chainState,
  currentStep,
  planDecision,
  type ChainStep,
} from './approval-chain';

// ผู้เรียกนอกโมดูลต้องดักสองตัวนี้ได้ แต่ตรรกะอยู่ในไฟล์บริสุทธิ์ (ADR-004)
export { AlreadyDecidedInChainError, NotYourTurnError };

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

/**
 * สายที่ไม่มีขั้นเลย
 *
 * แยกจาก `NotAnApproverError` เพราะเป็นข้อมูลนำเข้าที่ผิด ไม่ใช่เรื่องสิทธิ์ ·
 * สายที่ไม่มีขั้นจะดูเหมือน "อนุมัติแล้ว" ทันทีที่สร้าง — งานเดินต่อได้
 * โดยไม่มีใครเคยกดอนุมัติสักครั้ง
 */
export class EmptyChainError extends Error {
  constructor() {
    super('ต้องเลือกกลุ่มผู้อนุมัติอย่างน้อยหนึ่งกลุ่ม');
    this.name = 'EmptyChainError';
  }
}

/**
 * กลุ่มเดียวกันซ้ำสองขั้นในสายเดียว
 *
 * สายที่ให้กลุ่มเดิมอนุมัติสองครั้งไม่ได้เพิ่มสายตาที่ดู — และเมื่อบวกกับกติกา
 * "คนเดิมตัดสินสองขั้นไม่ได้" มันจะกลายเป็นสายที่**ตันแน่นอน**ถ้ากลุ่มนั้น
 * มีสมาชิกคนเดียว · ต้องปฏิเสธตอนขอ ไม่ใช่ปล่อยให้ไปตันตอนตัดสิน
 */
export class DuplicateGroupInChainError extends Error {
  constructor(readonly groupName: string) {
    super(`กลุ่ม ${groupName} ถูกเลือกซ้ำ — แต่ละขั้นต้องเป็นคนละกลุ่ม`);
    this.name = 'DuplicateGroupInChainError';
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
  status: 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  /** รอบที่เท่าไรของเรื่องนี้ · ขั้นที่เท่าไรในรอบนั้น · รอบนั้นมีกี่ขั้น */
  chainSeq: number;
  stepNumber: number;
  stepCount: number;
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

type ChainRow = ChainStep & { id: bigint; approverGroupId: bigint; requestedById: bigint };

/** ขั้นทั้งหมดของรอบล่าสุด เรียงตาม `stepNumber` */
async function latestChain(ctx: TenantContext, workItemId: bigint): Promise<ChainRow[]> {
  /*
    รอบล่าสุดคือ `MAX(chainSeq)` · อ่านรอบเดียวพอ — รอบก่อนหน้าเป็นประวัติ
    ที่ `approvalsFor` แสดง แต่ไม่มีผลต่อสถานะปัจจุบัน
  */
  const db = tenantScoped(ctx);
  const top = await db.approval.findFirst({
    where: { workItemId },
    orderBy: { chainSeq: 'desc' },
    select: { chainSeq: true },
  });
  if (top === null) return [];
  /*
    ไม่ต้อง `orderBy` ตรงนี้ — `ordered()` ในชั้นบริสุทธิ์เรียงด้วย `stepNumber`
    ให้ทุกครั้งอยู่แล้ว · เคยใส่ไว้ แล้วพบตอนลบทีละบรรทัดว่าเปลี่ยนเป็นเรียงด้วย
    `createdAt` ก็ยังเขียวทั้ง 42 เคส แปลว่ามันไม่ได้ป้องกันอะไร มีแต่จะทำให้
    คนอ่านเชื่อว่าลำดับมาจากคิวรี ทั้งที่ความถูกต้องอยู่ที่ชั้นบริสุทธิ์
  */
  const rows = await db.approval.findMany({
    where: { workItemId, chainSeq: top.chainSeq },
    select: {
      id: true,
      stepNumber: true,
      status: true,
      decidedById: true,
      approverGroupId: true,
      requestedById: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    stepNumber: r.stepNumber,
    status: r.status,
    // ตรรกะบริสุทธิ์เทียบผู้ตัดสินด้วย === — bigint คนละอินสแตนซ์เทียบไม่ตรง
    decidedById: r.decidedById === null ? null : r.decidedById.toString(),
    approverGroupId: r.approverGroupId,
    requestedById: r.requestedById,
  }));
}

/**
 * สถานะการอนุมัติของงานใบหนึ่ง — ดูจาก**รอบล่าสุดทั้งรอบ**
 *
 * `CANCELLED` ถือเป็น `none` — คำขอที่ถูกยกเลิกไม่ใช่การตัดสินใจของคน
 * และไม่ควรกั้นไม่ให้ขอใหม่ · สายที่มีขั้นถูกยกเลิกปนอยู่ก็ไม่ใช่สายที่อนุมัติแล้ว
 */
export async function approvalStateOf(
  ctx: TenantContext,
  workItemId: bigint,
): Promise<ApprovalState> {
  return chainState(await latestChain(ctx, workItemId));
}

/** ประวัติการอนุมัติทั้งหมดของงานใบหนึ่ง — รอบใหม่สุดก่อน ในรอบเรียงตามขั้น */
export async function approvalsFor(
  ctx: TenantContext,
  itemKey: string,
): Promise<ApprovalView[]> {
  /*
    **ในรอบเดียวกันเรียงตาม `stepNumber`** — เรียงด้วย `createdAt` อย่างเดียว
    จะได้ลำดับที่ไม่แน่นอนภายในรอบ เพราะทุกขั้นถูกสร้างพร้อมกัน
  */
  const rows = await tenantScoped(ctx).approval.findMany({
    where: { workItem: { itemKey } },
    orderBy: [{ chainSeq: 'desc' }, { stepNumber: 'asc' }],
    include: INCLUDE,
  });
  const stepCounts = new Map<number, number>();
  for (const r of rows) stepCounts.set(r.chainSeq, (stepCounts.get(r.chainSeq) ?? 0) + 1);
  return rows.map((a) => ({
    id: a.id.toString(),
    status: a.status,
    chainSeq: a.chainSeq,
    stepNumber: a.stepNumber,
    stepCount: stepCounts.get(a.chainSeq) ?? 1,
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
 * ขออนุมัติ — สร้างทั้งสายในทรานแซกชันเดียว
 *
 * **หนึ่งสายที่ค้างอยู่ต่อหนึ่งเรื่อง** — MySQL ไม่มี partial index จึงบังคับ
 * ด้วยโค้ด · ถ้าปล่อยให้ขอซ้อนกันได้ จะมีคำขอสองใบที่คนละคนตัดสินคนละทาง
 * แล้วไม่มีใครตอบได้ว่าอันไหนคือคำตอบ
 *
 * **ทุกขั้นถูกสร้างตั้งแต่ตอนนี้** ขั้นแรกเป็น `PENDING` ที่เหลือเป็น `WAITING` ·
 * ถ้าสร้างทีละขั้น ผู้ขอไม่รู้ว่าเหลืออีกกี่ด่าน และถ้านิยามกระบวนการถูกแก้
 * ระหว่างทาง สายจะเปลี่ยนรูปเงียบ ๆ กลางคัน
 */
export async function requestApproval(
  ctx: TenantContext,
  itemKey: string,
  approverGroupIds: readonly bigint[],
  reason?: string,
): Promise<{ id: bigint; steps: number }> {
  if (ctx.actorId === null) throw new NotAnApproverError();
  if (approverGroupIds.length === 0) throw new EmptyChainError();
  const db = tenantScoped(ctx);

  const item = await db.workItem.findFirst({
    where: { itemKey },
    // projectId ใช้ตัดสินสวิตช์แจ้งเตือนระดับโปรเจกต์
    select: { id: true, summary: true, projectId: true },
  });
  if (item === null) throw new WorkItemNotFoundForApprovalError(itemKey);

  if ((await approvalStateOf(ctx, item.id)) === 'pending') throw new AlreadyPendingError();

  const groups: Array<{ id: bigint; name: string }> = [];
  for (const groupId of approverGroupIds) {
    const group = await db.userGroup.findFirst({
      where: { id: groupId },
      select: { id: true, name: true, _count: { select: { members: true } } },
    });
    if (group === null) throw new NotAnApproverError();
    /*
      กลุ่มที่ไม่มีสมาชิกเลย = ขั้นที่ไม่มีวันมีใครมาตัดสิน · ต้องดังตอนขอ
      ไม่ใช่ปล่อยให้ค้างเงียบ ๆ แล้วผู้ขอรอไปเรื่อย ๆ
      ตรวจ**ทุกขั้น** ไม่ใช่แค่ขั้นแรก — ขั้นที่สามที่ว่างเปล่าก็ตันเหมือนกัน
      แค่ตันช้ากว่า และตอนนั้นไม่มีใครจำได้ว่าเลือกกลุ่มนี้ไว้ทำไม
    */
    if (group._count.members === 0) throw new NotAnApproverError();
    if (groups.some((g) => g.id === group.id)) throw new DuplicateGroupInChainError(group.name);
    groups.push({ id: group.id, name: group.name });
  }

  const previous = await db.approval.findFirst({
    where: { workItemId: item.id },
    orderBy: { chainSeq: 'desc' },
    select: { chainSeq: true },
  });
  const chainSeq = (previous?.chainSeq ?? 0) + 1;

  return auditedTransaction(ctx, 'approval.request', async (tx) => {
    const ids: bigint[] = [];
    for (const [i, group] of groups.entries()) {
      const row = await tx.approval.create({
        data: {
          tenantId: ctx.tenantId,
          workItemId: item.id,
          chainSeq,
          stepNumber: i + 1,
          approverGroupId: group.id,
          requestedById: ctx.actorId ?? BigInt(0),
          // ขั้นแรกเปิดให้ตัดสินทันที ที่เหลือรอคิว
          status: i === 0 ? 'PENDING' : 'WAITING',
          reason: reason?.trim() === '' ? null : (reason?.trim() ?? null),
        },
        select: { id: true },
      });
      ids.push(row.id);
    }

    const first = groups[0];
    const firstId = ids[0];
    /*
      แจ้ง**เฉพาะกลุ่มของขั้นแรก** ในทรานแซกชันเดียวกับการสร้างสาย ·
      แจ้งทุกกลุ่มพร้อมกันจะทำให้ผู้อนุมัติขั้นที่สามเปิดเข้ามาแล้วกดอะไรไม่ได้
      แล้วสรุปเองว่าระบบพัง · กลุ่มถัดไปถูกแจ้งตอนขั้นก่อนหน้าผ่าน
    */
    if (first !== undefined && firstId !== undefined) {
      await notifyStepApprovers(ctx, tx, {
        projectId: item.projectId,
        approvalId: firstId,
        groupId: first.id,
        groupName: first.name,
        workItemId: item.id,
        itemKey,
        summary: item.summary,
        step: 1,
        stepCount: groups.length,
        excludeUserId: ctx.actorId,
      });
    }

    const path = groups.map((g) => g.name).join(' → ');
    return {
      result: { id: firstId ?? BigInt(0), steps: groups.length },
      audit: [
        change(item.id, 'approval', null, `ขออนุมัติ ${String(groups.length)} ขั้น: ${path}`),
      ],
    };
  });
}

/** ผู้รับของทรานแซกชันที่ `auditedTransaction` ส่งให้ */
type Tx = Parameters<Parameters<typeof auditedTransaction<unknown>>[2]>[0];

/**
 * แจ้งกลุ่มผู้อนุมัติของขั้นหนึ่ง — ใช้ทั้งตอนขอและตอนเปิดขั้นถัดไป
 *
 * `dedupeKey` ไม่มีเวลาอยู่ในคีย์ — ประกอบจาก (ขั้น, ผู้รับ) เท่านั้น
 */
async function notifyStepApprovers(
  ctx: TenantContext,
  tx: Tx,
  o: {
    projectId: bigint;
    approvalId: bigint;
    groupId: bigint;
    groupName: string;
    workItemId: bigint;
    itemKey: string;
    summary: string;
    step: number;
    stepCount: number;
    excludeUserId: bigint | null;
  },
): Promise<void> {
  const members = await tx.groupMember.findMany({
    where: { groupId: o.groupId },
    select: { userId: true },
  });
  // บอกว่าอยู่ขั้นไหนของกี่ขั้น — "รออนุมัติ" เฉย ๆ ไม่บอกว่าเหลืออีกไกลแค่ไหน
  const where = o.stepCount > 1 ? ` (ขั้นที่ ${String(o.step)} จาก ${String(o.stepCount)})` : '';
  await createNotifications(
    ctx,
    tx,
    o.projectId,
    members
      // ไม่แจ้งผู้ขอเอง แม้เขาจะอยู่ในกลุ่ม — เขารู้อยู่แล้วว่าเพิ่งกดขอ
      .filter((m) => m.userId !== o.excludeUserId)
      .map((m) => ({
        userId: m.userId,
        workItemId: o.workItemId,
        kind: 'approval.requested',
        title: `${o.itemKey} รออนุมัติจาก ${o.groupName}${where}`,
        body: o.summary,
        dedupeKey: `approval:${o.approvalId.toString()}:${m.userId.toString()}`,
      })),
  );
}

export interface DecideInput {
  approve: boolean;
  note?: string | undefined;
}

/**
 * ตัดสินขั้นที่รออยู่
 *
 * ตรวจสามชั้นตามลำดับ: มีขั้นที่รออยู่ไหม → อยู่ในกลุ่มผู้อนุมัติของ**ขั้นนั้น**ไหม
 * → เป็นผู้ขอเองหรือเปล่า · ลำดับนี้สำคัญ เพราะคนที่ไม่อยู่ในกลุ่มไม่ควรรู้ว่า
 * มีคำขอค้างอยู่หรือไม่จากข้อความ error
 *
 * ผลของการตัดสิน (เปิดขั้นไหนต่อ · ยกเลิกขั้นไหน · จบสายหรือยัง) คำนวณด้วย
 * `planDecision` ซึ่งเป็นฟังก์ชันบริสุทธิ์ · ที่นี่แค่เขียนตามแผน
 */
export async function decideApproval(
  ctx: TenantContext,
  itemKey: string,
  input: DecideInput,
  now: UtcDate = systemClock.nowUtc(),
): Promise<void> {
  if (ctx.actorId === null) throw new NotAnApproverError();
  const db = tenantScoped(ctx);

  const item = await db.workItem.findFirst({
    where: { itemKey },
    select: { id: true, projectId: true, summary: true },
  });
  if (item === null) throw new WorkItemNotFoundForApprovalError(itemKey);

  const chain = await latestChain(ctx, item.id);
  const step = currentStep(chain);
  if (step === null) throw new NoPendingApprovalError();
  const row = chain.find((c) => c.stepNumber === step.stepNumber);
  if (row === undefined) throw new NoPendingApprovalError();

  const isMember = await db.groupMember.findFirst({
    where: { groupId: row.approverGroupId, userId: ctx.actorId },
    select: { userId: true },
  });
  if (isMember === null) throw new NotAnApproverError();

  // อยู่ในกลุ่มจริง แต่เป็นคนขอเอง — คนละเรื่องกับไม่มีสิทธิ์
  if (row.requestedById === ctx.actorId) throw new SelfApprovalError();

  const note = input.note?.trim() === '' ? null : (input.note?.trim() ?? null);
  // ปฏิเสธต้องบอกเหตุผล · อนุมัติไม่ต้อง — "อนุมัติ" อธิบายตัวเองอยู่แล้ว
  if (!input.approve && note === null) throw new RejectionNeedsReasonError();

  /*
    วางแผน**ก่อน**เปิดทรานแซกชัน · `planDecision` โยน `AlreadyDecidedInChainError`
    เมื่อคนเดิมเคยตัดสินขั้นก่อนหน้าของสายนี้ — ต้องโยนก่อนแตะฐานข้อมูล
    ไม่ใช่กลางทางที่มีแถวถูกแก้ไปแล้วบางส่วน
  */
  const plan = planDecision(chain, step.stepNumber, ctx.actorId.toString(), input.approve);
  const byStep = new Map(chain.map((c) => [c.stepNumber, c]));
  const nextRow = plan.opensNext === null ? null : (byStep.get(plan.opensNext) ?? null);
  const nextGroup =
    nextRow === null
      ? null
      : await db.userGroup.findFirst({
          where: { id: nextRow.approverGroupId },
          select: { id: true, name: true },
        });

  await auditedTransaction(ctx, 'approval.decide', async (tx) => {
    await tx.approval.update({
      where: { id: row.id },
      data: {
        status: input.approve ? 'APPROVED' : 'REJECTED',
        decidedById: ctx.actorId,
        decidedAt: now,
        decisionNote: note,
      },
    });

    /*
      ขั้นที่เหลือถูกยกเลิก ไม่ค้างเป็น `WAITING` ตลอดกาล · แถวที่ค้างทำให้
      ตอบไม่ได้ว่าสายนี้จบหรือยัง และคำขอใบใหม่จะถูกกันไว้โดยไม่มีใครเข้าใจ
    */
    for (const n of plan.cancels) {
      const target = byStep.get(n);
      if (target === undefined) continue;
      await tx.approval.update({
        where: { id: target.id },
        data: { status: 'CANCELLED', decisionNote: 'ยกเลิกเพราะขั้นก่อนหน้าถูกปฏิเสธ' },
      });
    }

    if (nextRow !== null && nextGroup !== null) {
      await tx.approval.update({ where: { id: nextRow.id }, data: { status: 'PENDING' } });
      await notifyStepApprovers(ctx, tx, {
        projectId: item.projectId,
        approvalId: nextRow.id,
        groupId: nextGroup.id,
        groupName: nextGroup.name,
        workItemId: item.id,
        itemKey,
        summary: item.summary,
        step: nextRow.stepNumber,
        stepCount: chain.length,
        // ผู้ตัดสินขั้นนี้อาจอยู่ในกลุ่มถัดไปด้วย แต่เขาตัดสินอีกขั้นไม่ได้อยู่แล้ว
        excludeUserId: ctx.actorId,
      });
    }

    /*
      แจ้งผู้ขอ**เฉพาะตอนสายจบ** · แจ้งทุกขั้นที่ผ่านจะกลายเป็นสามฉบับต่อหนึ่ง
      คำขอ ซึ่งกวนกว่าช่วย และทำให้ฉบับที่สำคัญจริงจมหายไป
    */
    if (plan.finishes) {
      await createNotifications(ctx, tx, item.projectId, [
        {
          userId: row.requestedById,
          workItemId: item.id,
          kind: 'approval.decided',
          title: `${itemKey} ${input.approve ? 'ได้รับอนุมัติแล้ว' : 'ถูกปฏิเสธ'}`,
          body: note,
          dedupeKey: `approval-decided:${row.id.toString()}`,
        },
      ]);
    }

    const at = chain.length > 1 ? `ขั้นที่ ${String(step.stepNumber)}/${String(chain.length)} ` : '';
    return {
      result: undefined,
      audit: [
        change(
          item.id,
          'approval',
          'รออนุมัติ',
          input.approve
            ? `${at}อนุมัติแล้ว${plan.finishes ? '' : ' — รอขั้นถัดไป'}`
            : `${at}ปฏิเสธ — ${note ?? ''}`,
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
