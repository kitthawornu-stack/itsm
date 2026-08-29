/**
 * บันทึกเวลาทำงาน
 *
 * ## สิทธิ์ — ไม่เพิ่มคีย์ใหม่โดยตั้งใจ
 *
 * ใครที่เปิดเรื่องได้ ก็บันทึกเวลาของตัวเองกับเรื่องนั้นได้ · ทีมไอทีขนาดเล็ก
 * ช่วยกันทำเรื่องเดียวกันเป็นปกติ และการบังคับให้ต้องเป็นผู้รับผิดชอบก่อน
 * จะทำให้เวลาที่คนอื่นช่วยหายไปจากรายงานทั้งหมด
 *
 * **แก้และลบได้เฉพาะของตัวเอง** (ผู้ดูแลระบบแก้ได้ทุกใบ) — บันทึกเวลาของคนอื่น
 * เป็นข้อมูลที่ใช้ประเมินเขา การให้ใครก็แก้ได้ทำให้ตัวเลขไม่มีความหมาย
 *
 * การเพิ่มคีย์สิทธิ์ใหม่แตะโมดูล permission ซึ่งต้องให้ Tech Lead อนุมัติ
 * (CLAUDE.md §4) · เลือกใช้กติกาที่อธิบายได้ด้วยสิทธิ์ที่มีอยู่แล้วแทน
 *
 * ## `startedAt` คือเวลาที่ทำงาน ไม่ใช่เวลาที่บันทึก
 *
 * คนบันทึกงานของวันศุกร์ในเช้าวันจันทร์เป็นเรื่องปกติ · รายงานที่ใช้
 * `createdAt` จะทำให้ทุกสัปดาห์ผิด และผิดไปทางที่ดูสมเหตุสมผลด้วย
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { auditedTransaction, change } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan, isTenantAdmin } from '../permission';
import { formatDuration, parseDuration, remainingAfter } from './duration';

export class WorkLogNotFoundError extends Error {
  constructor(id: bigint) {
    super(`ไม่พบบันทึกเวลา #${id.toString()}`);
    this.name = 'WorkLogNotFoundError';
  }
}

export class NotYourWorkLogError extends Error {
  constructor() {
    super('แก้ได้เฉพาะบันทึกเวลาของตัวเอง');
    this.name = 'NotYourWorkLogError';
  }
}

export class WorkLogInFutureError extends Error {
  constructor(readonly startedAt: string) {
    super(`บันทึกเวลาในอนาคตไม่ได้ (${startedAt})`);
    this.name = 'WorkLogInFutureError';
  }
}

export class ItemNotFoundForWorkLogError extends Error {
  constructor(readonly itemKey: string) {
    super(`ไม่พบเรื่อง ${itemKey}`);
    this.name = 'ItemNotFoundForWorkLogError';
  }
}

export interface WorkLogView {
  id: string;
  spentMinutes: number;
  spentText: string;
  startedAt: string;
  note: string | null;
  author: { id: string; displayName: string };
  /** ผู้เรียกแก้/ลบใบนี้ได้ไหม — หน้าจอไม่ต้องเดาเอง */
  canEdit: boolean;
}

export interface TimeSummary {
  originalEstimateMinutes: number | null;
  remainingMinutes: number | null;
  spentMinutes: number;
  originalText: string | null;
  remainingText: string | null;
  spentText: string;
  logs: WorkLogView[];
}

async function loadItem(
  ctx: TenantContext,
  itemKey: string,
): Promise<{ id: bigint; projectId: bigint; remainingMinutes: number | null }> {
  const item = await tenantScoped(ctx).workItem.findFirst({
    where: { itemKey },
    select: { id: true, projectId: true, remainingMinutes: true },
  });
  if (item === null) throw new ItemNotFoundForWorkLogError(itemKey);
  return item;
}

/** สรุปเวลาของเรื่องหนึ่ง พร้อมรายการบันทึกทั้งหมด */
export async function timeOf(ctx: TenantContext, itemKey: string): Promise<TimeSummary> {
  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({
    where: { itemKey },
    select: {
      id: true,
      projectId: true,
      originalEstimateMinutes: true,
      remainingMinutes: true,
      spentMinutes: true,
    },
  });
  if (item === null) throw new ItemNotFoundForWorkLogError(itemKey);
  await assertCan(ctx, item.projectId, 'BROWSE_PROJECT');

  const [logs, admin] = await Promise.all([
    db.workLog.findMany({
      where: { workItemId: item.id },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        spentMinutes: true,
        startedAt: true,
        note: true,
        userId: true,
        user: { select: { id: true, displayName: true } },
      },
    }),
    isTenantAdmin(ctx),
  ]);

  return {
    originalEstimateMinutes: item.originalEstimateMinutes,
    remainingMinutes: item.remainingMinutes,
    spentMinutes: item.spentMinutes,
    originalText:
      item.originalEstimateMinutes === null ? null : formatDuration(item.originalEstimateMinutes),
    remainingText: item.remainingMinutes === null ? null : formatDuration(item.remainingMinutes),
    spentText: formatDuration(item.spentMinutes),
    logs: logs.map((l) => ({
      id: l.id.toString(),
      spentMinutes: l.spentMinutes,
      spentText: formatDuration(l.spentMinutes),
      startedAt: l.startedAt.toISOString(),
      note: l.note,
      author: { id: l.user.id.toString(), displayName: l.user.displayName },
      canEdit: admin || l.userId === ctx.actorId,
    })),
  };
}

export interface LogWorkInput {
  itemKey: string;
  /** ข้อความอย่าง "2h 30m" หรือจำนวนนาที — `parseDuration` เป็นคนตัดสิน */
  spent: string;
  /** เวลาที่ลงมือทำ · ไม่ใส่ = ตอนนี้ */
  startedAt?: string;
  note?: string | null;
}

/**
 * บันทึกเวลาหนึ่งครั้ง
 *
 * โยน `InvalidDurationError` เมื่ออ่านระยะเวลาไม่ออก — ปฏิเสธ ไม่ใช่เดา
 */
export async function logWork(
  ctx: TenantContext,
  input: LogWorkInput,
  now: UtcDate = systemClock.nowUtc(),
): Promise<{ id: string; spentMinutes: number; spentText: string }> {
  const item = await loadItem(ctx, input.itemKey);
  await assertCan(ctx, item.projectId, 'BROWSE_PROJECT');
  if (ctx.actorId === null) throw new Error('ต้องเข้าสู่ระบบก่อนบันทึกเวลา');
  const actorId = ctx.actorId;

  const spentMinutes = parseDuration(input.spent);

  /*
    เวลาที่ยังไม่มาถึง ไม่ใช่เวลาที่ "ทำงานไปแล้ว" · ปล่อยผ่านแล้วรายงาน
    เดือนนี้จะนับงานของเดือนหน้าเข้ามาด้วย ซึ่งไม่มีใครสังเกตจนกว่าจะถึงเดือนหน้า
    แล้วตัวเลขหายไปเฉย ๆ
  */
  const startedAt = input.startedAt === undefined ? now : new Date(input.startedAt);
  if (Number.isNaN(startedAt.getTime())) throw new WorkLogInFutureError(input.startedAt ?? '');
  if (startedAt.getTime() > now.getTime()) throw new WorkLogInFutureError(startedAt.toISOString());

  const note = input.note?.trim() ?? '';

  return auditedTransaction(ctx, 'workitem.log-work', async (tx) => {
    const row = await tx.workLog.create({
      data: {
        tenantId: ctx.tenantId,
        workItemId: item.id,
        userId: actorId,
        spentMinutes,
        startedAt,
        note: note === '' ? null : note,
      },
      select: { id: true },
    });

    /*
      อัปเดตยอดรวมและเวลาที่เหลือในทรานแซกชันเดียวกัน · ยอดรวมเป็นสำเนา
      ที่คำนวณใหม่ได้จาก `work_log` เสมอ — แต่ถ้ามันเพี้ยนจากของจริง
      หน้าจอจะโกหกโดยไม่มีอะไรฟ้อง จึงต้องอยู่ในทรานแซกชันเดียวกัน
    */
    const updated = await tx.workItem.update({
      where: { id: item.id },
      data: {
        spentMinutes: { increment: spentMinutes },
        remainingMinutes: remainingAfter(item.remainingMinutes, spentMinutes),
      },
      select: { spentMinutes: true },
    });

    return {
      result: {
        id: row.id.toString(),
        spentMinutes: updated.spentMinutes,
        spentText: formatDuration(updated.spentMinutes),
      },
      audit: [change(item.id, 'worklog', null, `${formatDuration(spentMinutes)} · ${note}`)],
    };
  });
}

/**
 * ลบบันทึกเวลา
 *
 * **ยอดรวมต้องลดตาม** — ยอดที่ไม่ลดคือยอดที่โกหกทันทีที่มีคนลบใบแรก
 * และไม่มีอะไรบอกว่ามันเริ่มโกหกตั้งแต่เมื่อไร
 *
 * เวลาที่เหลือ **ไม่คืนกลับ** โดยตั้งใจ — คนที่ปรับเวลาที่เหลือด้วยมือหลังจากนั้น
 * จะโดนคืนค่าทับ · การลบบันทึกที่ลงผิดใบ ไม่ได้แปลว่างานเหลือมากขึ้น
 */
export async function deleteWorkLog(
  ctx: TenantContext,
  id: bigint,
): Promise<{ deleted: string; spentMinutes: number }> {
  const db = tenantScoped(ctx);
  const row = await db.workLog.findFirst({
    where: { id },
    select: { id: true, userId: true, spentMinutes: true, workItemId: true },
  });
  if (row === null) throw new WorkLogNotFoundError(id);

  const item = await db.workItem.findFirstOrThrow({
    where: { id: row.workItemId },
    select: { projectId: true },
  });
  await assertCan(ctx, item.projectId, 'BROWSE_PROJECT');

  if (row.userId !== ctx.actorId && !(await isTenantAdmin(ctx))) {
    throw new NotYourWorkLogError();
  }

  return auditedTransaction(ctx, 'workitem.delete-worklog', async (tx) => {
    await tx.workLog.delete({ where: { id: row.id } });
    const updated = await tx.workItem.update({
      where: { id: row.workItemId },
      data: { spentMinutes: { decrement: row.spentMinutes } },
      select: { spentMinutes: true },
    });
    return {
      result: { deleted: id.toString(), spentMinutes: updated.spentMinutes },
      audit: [
        change(row.workItemId, 'worklog', formatDuration(row.spentMinutes), null),
      ],
    };
  });
}

/**
 * ตั้งเวลาที่ประมาณไว้และเวลาที่เหลือ
 *
 * ส่งค่าว่างเพื่อล้างค่า — `null` (ไม่เคยประมาณ) ต่างจาก 0 (ประมาณแล้วหมดแล้ว)
 * และหน้าจอต้องแยกสองอย่างนี้ออกจากกันได้
 */
export async function setEstimate(
  ctx: TenantContext,
  itemKey: string,
  input: { original?: string | null; remaining?: string | null },
): Promise<{ originalMinutes: number | null; remainingMinutes: number | null }> {
  const item = await loadItem(ctx, itemKey);
  await assertCan(ctx, item.projectId, 'EDIT_ITEM');

  const read = (v: string | null | undefined): number | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v.trim() === '') return null;
    return parseDuration(v);
  };
  const original = read(input.original);
  const remaining = read(input.remaining);
  if (original === undefined && remaining === undefined) {
    return { originalMinutes: null, remainingMinutes: item.remainingMinutes };
  }

  const before = await tenantScoped(ctx).workItem.findFirstOrThrow({
    where: { id: item.id },
    select: { originalEstimateMinutes: true, remainingMinutes: true },
  });

  return auditedTransaction(ctx, 'workitem.estimate', async (tx) => {
    const updated = await tx.workItem.update({
      where: { id: item.id },
      data: {
        ...(original === undefined ? {} : { originalEstimateMinutes: original }),
        /*
          ตั้งเวลาประมาณครั้งแรก **ตั้งเวลาที่เหลือให้เท่ากันด้วย** ถ้ายังไม่เคยมี
          — งานที่ประมาณไว้ 4 ชั่วโมงแต่ "เหลือ null" อ่านบนหน้าจอเหมือนยังไม่ได้
          ประมาณ ทั้งที่ประมาณแล้ว
        */
        ...(remaining === undefined
          ? original !== undefined && before.remainingMinutes === null
            ? { remainingMinutes: original }
            : {}
          : { remainingMinutes: remaining }),
      },
      select: { originalEstimateMinutes: true, remainingMinutes: true },
    });

    return {
      result: {
        originalMinutes: updated.originalEstimateMinutes,
        remainingMinutes: updated.remainingMinutes,
      },
      audit: [
        change(
          item.id,
          'estimate',
          before.originalEstimateMinutes === null
            ? null
            : formatDuration(before.originalEstimateMinutes),
          updated.originalEstimateMinutes === null
            ? null
            : formatDuration(updated.originalEstimateMinutes),
        ),
      ],
    };
  });
}
