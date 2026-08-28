/**
 * CSAT — ความพอใจของผู้แจ้ง
 *
 * **ถามได้ครั้งเดียวคือตอนเพิ่งปิด** ความรู้สึกต่อเรื่องที่ปิดไปสามเดือนแล้ว
 * ย้อนกลับไปถามไม่ได้ · ไม่เก็บตั้งแต่วันแรกคือไม่มีวันได้
 *
 * รายงานความพอใจมีค่าก็ต่อเมื่อ **เชื่อได้** ทุกกฎในไฟล์นี้มีไว้เพื่อข้อนั้น
 * ข้อเดียว — ตัวเลขที่ถูกถ่วงได้ แย่กว่าไม่มีตัวเลข เพราะมันถูกใช้ตัดสินใจ
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { auditedTransaction, change } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

export const RATING_MIN = 1;
export const RATING_MAX = 5;

export class NotTheReporterError extends Error {
  constructor() {
    // ไม่บอกว่าใครเป็นผู้แจ้ง — การไล่บอกคือการวาดแผนที่ให้คนที่กำลังลอง
    super('ให้คะแนนได้เฉพาะผู้แจ้งเรื่องนี้');
    this.name = 'NotTheReporterError';
  }
}

export class NotResolvedYetError extends Error {
  constructor() {
    super('ให้คะแนนได้เมื่อเรื่องปิดแล้วเท่านั้น');
    this.name = 'NotResolvedYetError';
  }
}

export class RatingOutOfRangeError extends Error {
  constructor(readonly given: number) {
    super(`คะแนนต้องอยู่ระหว่าง ${String(RATING_MIN)} ถึง ${String(RATING_MAX)}`);
    this.name = 'RatingOutOfRangeError';
  }
}

/**
 * มีคนอื่นให้คะแนนเรื่องนี้ไว้แล้ว
 *
 * ปกติเกิดไม่ได้ เพราะผู้แจ้งมีคนเดียว · แต่ผู้แจ้งเปลี่ยนได้ในอนาคต
 * และ unique index เป็นด่านสุดท้าย — ถ้าวันนั้นมาถึง ต้องมี error ที่อ่านออก
 * รออยู่ ไม่ใช่ให้ Prisma โยน P2002 ที่ไม่มีใครดักไว้
 */
export class AlreadyRatedByOtherError extends Error {
  constructor(readonly by: string) {
    super(`เรื่องนี้ถูกให้คะแนนไปแล้วโดย ${by}`);
    this.name = 'AlreadyRatedByOtherError';
  }
}

export interface RateInput {
  rating: number;
  comment?: string | undefined;
}

export interface SatisfactionView {
  rating: number;
  comment: string | null;
  respondedAt: string;
  /** แก้ได้ไหม — หน้าจอใช้ตัดสินว่าจะโชว์ปุ่มแก้หรือแค่แสดงผล */
  isMine: boolean;
}

/**
 * ให้คะแนน หรือแก้คะแนนเดิม
 *
 * **แก้ได้ แต่ไม่เพิ่มแถวใหม่** — ความเห็นเปลี่ยนได้ ควรให้เปลี่ยน
 * แต่ถ้าเพิ่มแถวได้ คนกดสิบครั้งจะถ่วงค่าเฉลี่ยได้สิบเท่า และไม่มีอะไร
 * บนหน้าจอบอกว่ากำลังเกิดขึ้น
 */
export async function rateWorkItem(
  ctx: TenantContext,
  itemKey: string,
  input: RateInput,
  now: UtcDate = systemClock.nowUtc(),
): Promise<void> {
  if (ctx.actorId === null) throw new NotTheReporterError();

  /*
    ตรวจช่วงคะแนนก่อนแตะฐานข้อมูล — ค่าที่ผิดเป็นความผิดของคำขอ
    ไม่ใช่ของงานใบนั้น และไม่ควรทำให้คะแนนเดิมหายไประหว่างทาง
  */
  if (
    !Number.isInteger(input.rating) ||
    input.rating < RATING_MIN ||
    input.rating > RATING_MAX
  ) {
    throw new RatingOutOfRangeError(input.rating);
  }

  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({
    where: { itemKey },
    select: { id: true, reporterId: true, resolvedAt: true },
  });
  // ไม่พบเรื่อง = ตอบเหมือนไม่ใช่ผู้แจ้ง — ไม่ยืนยันว่าเลขนี้มีอยู่จริง
  if (item === null) throw new NotTheReporterError();
  if (item.reporterId !== ctx.actorId) throw new NotTheReporterError();
  if (item.resolvedAt === null) throw new NotResolvedYetError();
  // จับค่าไว้นอก closure — TypeScript ไม่ยืนยันการ narrow ข้ามขอบเขต callback ให้
  const resolvedAt = item.resolvedAt;

  const existing = await db.satisfaction.findFirst({
    where: { workItemId: item.id },
    include: { respondent: { select: { displayName: true } } },
  });
  if (existing !== null && existing.respondentId !== ctx.actorId) {
    throw new AlreadyRatedByOtherError(existing.respondent.displayName);
  }

  const comment = input.comment?.trim() === '' ? null : (input.comment?.trim() ?? null);

  await auditedTransaction(ctx, 'workitem.rate', async (tx) => {
    await tx.satisfaction.upsert({
      where: { workItemId: item.id },
      create: {
        tenantId: ctx.tenantId,
        workItemId: item.id,
        respondentId: ctx.actorId ?? BigInt(0),
        rating: input.rating,
        comment,
        /*
          เก็บเวลาที่ปิด **ณ ตอนให้คะแนน** ไม่ใช่อ่านจากงานตอนทำรายงาน
          เรื่องที่ถูกเปิดใหม่ภายหลังจะมี resolvedAt เป็น null
          แล้วคะแนนเก่าจะลอยไม่มีที่อ้างอิงว่าให้กับการปิดรอบไหน
        */
        resolvedAt,
      },
      update: { rating: input.rating, comment },
    });
    return {
      result: undefined,
      audit: [
        change(
          item.id,
          'satisfaction',
          existing === null ? null : String(existing.rating),
          String(input.rating),
        ),
      ],
    };
  });
  void now;
}

/** คะแนนของเรื่องหนึ่ง — `null` เมื่อยังไม่มีใครตอบ ไม่ใช่ 0 คะแนน */
export async function satisfactionFor(
  ctx: TenantContext,
  itemKey: string,
): Promise<SatisfactionView | null> {
  const row = await tenantScoped(ctx).satisfaction.findFirst({
    where: { workItem: { itemKey } },
  });
  if (row === null) return null;
  return {
    rating: row.rating,
    comment: row.comment,
    respondedAt: row.updatedAt.toISOString(),
    isMine: row.respondentId === ctx.actorId,
  };
}

export interface SatisfactionSummary {
  responses: number;
  /** ค่าเฉลี่ย — 0 เมื่อยังไม่มีใครตอบ (ไม่ใช่ NaN ที่หน้าจอเรนเดอร์ไม่ได้) */
  average: number;
  byRating: Record<number, number>;
}

/**
 * สรุปความพอใจ
 *
 * **นับเฉพาะเรื่องที่มีคำตอบจริง** ไม่ใช่นับเรื่องที่ปิดทั้งหมดแล้วให้ที่ไม่ตอบ
 * เป็น 0 · ถ้านับแบบนั้น ค่าเฉลี่ยจะร่วงตามจำนวนงานที่ปิด ไม่ใช่ตามความพอใจจริง
 * แล้วตัวเลขจะดูแย่ลงทุกเดือนโดยไม่มีเหตุผล
 */
export async function satisfactionSummary(
  ctx: TenantContext,
  opts: { projectId?: bigint; since?: UtcDate } = {},
): Promise<SatisfactionSummary> {
  const rows = await tenantScoped(ctx).satisfaction.findMany({
    where: {
      ...(opts.projectId === undefined ? {} : { workItem: { projectId: opts.projectId } }),
      ...(opts.since === undefined ? {} : { createdAt: { gte: opts.since } }),
    },
    select: { rating: true },
  });

  const byRating: Record<number, number> = {};
  for (let r = RATING_MIN; r <= RATING_MAX; r += 1) byRating[r] = 0;
  let sum = 0;
  for (const row of rows) {
    byRating[row.rating] = (byRating[row.rating] ?? 0) + 1;
    sum += row.rating;
  }

  return {
    responses: rows.length,
    // ทศนิยมสองตำแหน่งพอ · 4.333333 บนหน้าจอไม่ได้บอกอะไรเพิ่ม
    average: rows.length === 0 ? 0 : Math.round((sum / rows.length) * 100) / 100,
    byRating,
  };
}
