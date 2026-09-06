/**
 * โหวตสนับสนุนเรื่อง
 *
 * ในศูนย์บริการที่ทุกอย่างเป็น "ด่วน" ความสำคัญที่ผู้แจ้งเลือกเองไม่บอกอะไร ·
 * เสียงโหวตบอกสิ่งที่ต่างออกไป — **มีคนอื่นเจอปัญหาเดียวกันกี่คน**
 *
 * **ผู้แจ้งโหวตเรื่องของตัวเองไม่ได้** ถ้าโหวตได้ ทุกเรื่องจะเริ่มที่หนึ่งเสียง
 * เสมอ แล้วตัวเลขไม่แยกอะไรออกจากกัน — กติกาเดียวกับ "ผู้ขออนุมัติของตัวเอง
 * ไม่ได้" ในโมดูล approval
 *
 * โหวตได้ถ้าเปิดดูได้ ไม่ต้องมีสิทธิ์แก้ไข · ด่านอยู่ที่ `visibleItem` ที่เดียว
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { browsableProjectIds } from '../permission';

export class VoteTargetNotFoundError extends Error {
  constructor() {
    super('ไม่พบเรื่องที่ระบุ');
    this.name = 'VoteTargetNotFoundError';
  }
}

export class CannotVoteOwnItemError extends Error {
  constructor() {
    super('โหวตเรื่องที่ตัวเองแจ้งไม่ได้');
    this.name = 'CannotVoteOwnItemError';
  }
}

export interface VoteView {
  count: number;
  /** คนที่กำลังดูโหวตไปแล้วหรือยัง */
  voted: boolean;
  /** เป็นเรื่องของตัวเอง จึงโหวตไม่ได้ — หน้าจอใช้ตัดสินว่าจะแสดงปุ่มไหม */
  ownItem: boolean;
}

async function visibleItem(
  ctx: TenantContext,
  itemKey: string,
): Promise<{ id: bigint; projectId: bigint; reporterId: bigint }> {
  const allowed = await browsableProjectIds(ctx);
  const item =
    allowed.length === 0
      ? null
      : await tenantScoped(ctx).workItem.findFirst({
          where: { itemKey: itemKey.trim(), projectId: { in: allowed } },
          select: { id: true, projectId: true, reporterId: true },
        });
  // ไม่มีอยู่จริง กับ เปิดดูไม่ได้ ตอบเหมือนกัน — ไม่ยืนยันว่าคีย์นี้มีอยู่
  if (item === null) throw new VoteTargetNotFoundError();
  return item;
}

/**
 * สลับเสียงโหวตของตัวเอง · **กดซ้ำคือถอนเสียง ไม่ใช่ error** — ปุ่มที่ได้
 * error ตอนกดครั้งที่สองทำให้คนไม่กล้ากดครั้งแรก · คืนสถานะหลังกดเสมอ
 */
export async function toggleVote(ctx: TenantContext, itemKey: string): Promise<VoteView> {
  const actorId = ctx.actorId;
  if (actorId === null) throw new VoteTargetNotFoundError();
  /*
    ไม่เรียก `assertCan(BROWSE_PROJECT)` ซ้ำ · `visibleItem` กรองด้วย
    `browsableProjectIds` ซึ่งมาจากสิทธิ์เดียวกันโดยตรง — เขียนไว้ตอนแรก
    เพราะลอกมาจาก `watcher.service` แล้วการพิสูจน์ว่าเทสต์แดงได้จับเจอว่า
    ลบออกแล้วยังเขียวทั้งชุด (ด่านเดียวต่อเรื่องเดียว)
  */
  const item = await visibleItem(ctx, itemKey);
  if (item.reporterId === actorId) throw new CannotVoteOwnItemError();

  const db = tenantScoped(ctx);
  const existing = await db.workItemVote.findFirst({
    where: { workItemId: item.id, userId: actorId },
    select: { userId: true },
  });
  const adding = existing === null;

  await auditedTransaction(ctx, adding ? 'workitem.vote' : 'workitem.unvote', async (tx) => {
    if (adding) {
      await tx.workItemVote.create({
        data: { tenantId: ctx.tenantId, workItemId: item.id, userId: actorId },
      });
    } else {
      await tx.workItemVote.deleteMany({ where: { workItemId: item.id, userId: actorId } });
    }
    return {
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: adding ? 'workitem.vote' : 'workitem.unvote',
          entityType: 'work_item',
          entityId: item.id.toString(),
          payload: { itemKey: itemKey.trim() },
        },
      ],
    };
  });

  /*
    นับใหม่จากฐานข้อมูลหลังเขียน ไม่ใช่บวกลบจากค่าที่อ่านมาก่อนหน้า —
    สองคนกดพร้อมกันแล้วต่างฝ่ายต่างบวกจากเลขเดิม จะได้ตัวเลขที่ไม่ตรงกับแถวจริง
  */
  return voteOf(ctx, item.id, actorId, item.reporterId);
}

/** สถานะเสียงโหวตของเรื่องหนึ่ง — ใช้ทั้งตอนอ่านรายละเอียดและหลังกด */
export async function voteOf(
  ctx: TenantContext,
  workItemId: bigint,
  viewerId: bigint | null,
  reporterId: bigint,
): Promise<VoteView> {
  const db = tenantScoped(ctx);
  const count = await db.workItemVote.count({ where: { workItemId } });
  const voted =
    viewerId === null
      ? false
      : (await db.workItemVote.findFirst({
          where: { workItemId, userId: viewerId },
          select: { userId: true },
        })) !== null;
  return { count, voted, ownItem: viewerId !== null && viewerId === reporterId };
}
