/**
 * การทบทวนหลังทำ — ต่อฐานข้อมูล
 *
 * `change-review.ts` ตัดสินว่ารับได้หรือไม่ · ไฟล์นี้หาข้อมูลรอบตัวมาให้มันตัดสิน
 * แล้วเขียนลงฐานข้อมูลพร้อมร่องรอย
 *
 * **หนึ่งการเปลี่ยนแปลง หนึ่งการทบทวน** — `upsert` ไม่ใช่ `create` · กดบันทึกซ้ำ
 * ด้วยค่าเดิมต้องได้ผลเดิม ไม่ใช่มีสองใบ (กติกาเดียวกับ `setWindow`)
 */
import { systemClock, toUtcDate, type TenantContext, type UtcDate } from '@itsm/types';

import { auditedTransaction, change } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan } from '../permission';
import {
  REVIEW_OUTCOME_LABEL,
  normalizeReview,
  type ReviewOutcome,
} from './change-review';

export class WorkItemNotFoundForReviewError extends Error {
  constructor(itemKey: string) {
    super(`ไม่พบงาน ${itemKey}`);
    this.name = 'WorkItemNotFoundForReviewError';
  }
}

export interface ReviewView {
  outcome: ReviewOutcome;
  outcomeLabel: string;
  rolledBack: boolean;
  notes: string | null;
  reviewedBy: string;
  reviewedAt: string;
  updatedAt: string;
}

export interface ReviewInputBody {
  outcome: ReviewOutcome;
  /** `null` = ยังไม่ตอบ — เอนจินปฏิเสธเมื่อผลไม่ใช่ "สำเร็จ" */
  rolledBack: boolean | null;
  notes: string;
}

async function itemFor(
  ctx: TenantContext,
  itemKey: string,
  permission: 'BROWSE_PROJECT' | 'EDIT_ITEM',
): Promise<{ id: bigint }> {
  const item = await tenantScoped(ctx).workItem.findFirst({
    where: { itemKey },
    select: { id: true, projectId: true },
  });
  if (item === null) throw new WorkItemNotFoundForReviewError(itemKey);
  await assertCan(ctx, item.projectId, permission);
  return { id: item.id };
}

export interface ReviewState {
  /** `null` = ยังไม่เคยทบทวน — ไม่ใช่ error · "ยังไม่ได้ทำ" กับ "ไม่มีงานใบนี้" คนละคำตอบ */
  review: ReviewView | null;
  /**
   * ทบทวนได้ตั้งแต่เมื่อไร — `null` = ยังไม่ได้กำหนดช่วงเวลาดำเนินการ
   *
   * **หน้าจอต้องบอกได้ว่าทำไมยังทบทวนไม่ได้** ไม่ใช่ซ่อนปุ่มเฉย ๆ แล้วให้คนเดา
   * · ค่านี้มาจากเซิร์ฟเวอร์ เพราะเงื่อนไขเดียวกับที่ `normalizeReview` ใช้
   * ตัดสิน — ถ้าหน้าจอคำนวณเอง สองที่จะเพี้ยนจากกันในวันที่กติกาเปลี่ยน
   */
  reviewableFrom: string | null;
}

export async function reviewOf(ctx: TenantContext, itemKey: string): Promise<ReviewState> {
  const item = await itemFor(ctx, itemKey, 'BROWSE_PROJECT');
  const window = await tenantScoped(ctx).changeWindow.findFirst({
    where: { workItemId: item.id },
    select: { plannedStart: true },
  });
  const reviewableFrom = window === null ? null : window.plannedStart.toISOString();
  const row = await tenantScoped(ctx).changeReview.findFirst({
    where: { workItemId: item.id },
    select: {
      outcome: true,
      rolledBack: true,
      notes: true,
      reviewedAt: true,
      updatedAt: true,
      reviewedBy: { select: { displayName: true } },
    },
  });
  if (row === null) return { review: null, reviewableFrom };
  return {
    review: {
      outcome: row.outcome,
      outcomeLabel: REVIEW_OUTCOME_LABEL[row.outcome],
      rolledBack: row.rolledBack,
      notes: row.notes,
      reviewedBy: row.reviewedBy.displayName,
      reviewedAt: row.reviewedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    reviewableFrom,
  };
}

/**
 * บันทึกหรือแก้การทบทวน
 *
 * **อ่านช่วงเวลาดำเนินการมาให้เอนจินตัดสินว่าทบทวนได้หรือยัง** — ไม่ถามสถานะ
 * ของงาน · งานที่ล้มเหลวมักถูกเปิดใหม่ ถ้าใช้ "ปิดแล้ว" เป็นเงื่อนไข
 * การเปลี่ยนแปลงที่ล้มเหลว ซึ่งเป็นใบที่ต้องทบทวนที่สุด จะทบทวนไม่ได้เลย
 *
 * @throws {WorkItemNotFoundForReviewError} ไม่มีงาน หรือเปิดดูไม่ได้
 * @throws error จาก `normalizeReview` — ดู doc ของมัน
 */
export async function saveReview(
  ctx: TenantContext,
  itemKey: string,
  body: ReviewInputBody,
  now: UtcDate = systemClock.nowUtc(),
): Promise<ReviewView> {
  const actorId = ctx.actorId;
  if (actorId === null) throw new WorkItemNotFoundForReviewError(itemKey);
  const item = await itemFor(ctx, itemKey, 'EDIT_ITEM');
  const db = tenantScoped(ctx);

  const window = await db.changeWindow.findFirst({
    where: { workItemId: item.id },
    select: { plannedStart: true },
  });
  const normalized = normalizeReview({
    outcome: body.outcome,
    rolledBack: body.rolledBack,
    notes: body.notes,
    window: window === null ? null : { start: toUtcDate(window.plannedStart) },
    now,
  });

  const previous = await db.changeReview.findFirst({
    where: { workItemId: item.id },
    select: { outcome: true, rolledBack: true },
  });

  return auditedTransaction(ctx, 'change.review.save', async (tx) => {
    const row = await tx.changeReview.upsert({
      where: { workItemId: item.id },
      create: {
        tenantId: ctx.tenantId,
        workItemId: item.id,
        outcome: normalized.outcome,
        rolledBack: normalized.rolledBack,
        notes: normalized.notes,
        reviewedById: actorId,
        reviewedAt: now,
      },
      update: {
        outcome: normalized.outcome,
        rolledBack: normalized.rolledBack,
        notes: normalized.notes,
        // **คนที่ทบทวนล่าสุดคือคนที่รับผิดชอบคำตอบตอนนี้** ไม่ใช่คนแรกที่กด
        reviewedById: actorId,
        reviewedAt: now,
      },
      select: {
        outcome: true,
        rolledBack: true,
        notes: true,
        reviewedAt: true,
        updatedAt: true,
        reviewedBy: { select: { displayName: true } },
      },
    });

    /*
      ประวัติเก็บ "ผล + ย้อนกลับหรือไม่" เป็นข้อความเดียว ไม่ใช่สองแถว ·
      สองค่านี้ตอบคำถามเดียวกัน ("จบยังไง") การแยกแถวทำให้ไทม์ไลน์อ่านเหมือน
      มีการแก้สองครั้งทั้งที่คนกดบันทึกครั้งเดียว
    */
    const describe = (o: ReviewOutcome, r: boolean): string =>
      `${REVIEW_OUTCOME_LABEL[o]}${r ? ' · ย้อนกลับแล้ว' : ''}`;
    return {
      result: {
        outcome: row.outcome,
        outcomeLabel: REVIEW_OUTCOME_LABEL[row.outcome],
        rolledBack: row.rolledBack,
        notes: row.notes,
        reviewedBy: row.reviewedBy.displayName,
        reviewedAt: row.reviewedAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
      audit: [
        change(
          item.id,
          'changeReview',
          previous === null ? null : describe(previous.outcome, previous.rolledBack),
          describe(normalized.outcome, normalized.rolledBack),
        ),
      ],
    };
  });
}
