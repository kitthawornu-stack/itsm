/**
 * หน้าต่างเวลาดำเนินการเปลี่ยนแปลง — ต่อเอนจินเข้ากับฐานข้อมูล
 *
 * ตรรกะทั้งหมดอยู่ใน `change-window.ts` ซึ่งเป็นฟังก์ชันบริสุทธิ์ · ไฟล์นี้
 * อ่านของที่เอนจินต้องใช้ แล้วเขียนผลลัพธ์ตามที่เอนจินบอก
 *
 * ## ทำไมอ่านช่วงกว้างกว่าที่ถาม
 *
 * MySQL ใช้ index ได้แค่คอลัมน์เดียวของช่วงเวลา · คิวรีจึงคัดด้วย
 * `plannedStart` ในกรอบที่กว้างพอ (`MAX_WINDOW_DAYS` ก่อนหน้า) แล้วให้
 * เอนจินตัดสินการคาบเกี่ยวจริงในหน่วยความจำ — งานที่เริ่มก่อนหน้านั้น
 * จบไปแล้วแน่นอน เพราะไม่มีหน้าต่างไหนยาวเกินเพดาน
 */
import { systemClock, toUtcDate, type TenantContext, type UtcDate } from '@itsm/types';

import { auditedTransaction, change } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import {
  BackwardWindowError,
  MAX_WINDOW_DAYS,
  WindowTooLongError,
  assessWindow,
  type FreezeWindow,
  type ScheduledChange,
  type WindowAssessment,
} from './change-window';

export { BackwardWindowError, WindowTooLongError };

export class WorkItemNotFoundForWindowError extends Error {
  constructor(readonly itemKey: string) {
    super(`ไม่พบงาน ${itemKey}`);
    this.name = 'WorkItemNotFoundForWindowError';
  }
}

/**
 * อยู่ในช่วงห้ามเปลี่ยนแปลงโดยไม่ได้ให้เหตุผล
 *
 * ข้อความบอกชื่อและเหตุผลของช่วงห้าม เพื่อให้ผู้ขอตัดสินใจได้เองว่าจะเลื่อน
 * หรือจะขอข้าม — การบอกแค่ "ทำไม่ได้" ทำให้เขาต้องไปถามคน
 */
export class InFreezeWindowError extends Error {
  constructor(readonly freezes: readonly FreezeWindow[]) {
    super(
      `อยู่ในช่วงห้ามเปลี่ยนแปลง: ${freezes.map((f) => `${f.name} (${f.reason})`).join(' · ')} ` +
        `— เลื่อนเวลา หรือระบุเหตุผลที่ต้องทำในช่วงนี้`,
    );
    this.name = 'InFreezeWindowError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WindowView {
  plannedStart: string;
  plannedEnd: string;
  freezeOverrideReason: string | null;
  createdBy: string;
  conflicts: Array<{ itemKey: string; summary: string; start: string; end: string }>;
  freezes: Array<{ name: string; reason: string; start: string; end: string }>;
  startsInPast: boolean;
  durationMs: number;
}

/** ช่วงห้ามทั้งหมดขององค์กร — เอนจินตัดสินเองว่าอันไหนคาบเกี่ยว */
async function freezesOf(ctx: TenantContext): Promise<FreezeWindow[]> {
  const rows = await tenantScoped(ctx).changeFreeze.findMany({
    orderBy: { startsAt: 'asc' },
    select: { name: true, reason: true, startsAt: true, endsAt: true },
  });
  return rows.map((f) => ({
    name: f.name,
    reason: f.reason,
    window: { start: toUtcDate(f.startsAt), end: toUtcDate(f.endsAt) },
  }));
}

/**
 * หน้าต่างของงานใบอื่นที่อาจชน
 *
 * `exceptWorkItemId` กันไม่ให้ใบที่กำลังแก้ **รายงานว่าชนกับตัวเอง** —
 * ซึ่งจะเกิดทุกครั้งที่กดบันทึกซ้ำโดยไม่เปลี่ยนเวลา แล้วคำเตือนจะไร้ความหมาย
 */
async function othersNear(
  ctx: TenantContext,
  window: { start: UtcDate; end: UtcDate },
  exceptWorkItemId: bigint | null,
): Promise<ScheduledChange[]> {
  const rows = await tenantScoped(ctx).changeWindow.findMany({
    where: {
      plannedStart: {
        gte: new Date(window.start.getTime() - MAX_WINDOW_DAYS * DAY_MS),
        lt: window.end,
      },
      ...(exceptWorkItemId === null ? {} : { workItemId: { not: exceptWorkItemId } }),
    },
    select: {
      plannedStart: true,
      plannedEnd: true,
      workItem: { select: { itemKey: true, summary: true } },
    },
  });
  return rows.map((r) => ({
    itemKey: r.workItem.itemKey,
    summary: r.workItem.summary,
    window: { start: toUtcDate(r.plannedStart), end: toUtcDate(r.plannedEnd) },
  }));
}

function toView(
  row: { plannedStart: Date; plannedEnd: Date; freezeOverrideReason: string | null },
  createdBy: string,
  a: WindowAssessment,
): WindowView {
  return {
    plannedStart: row.plannedStart.toISOString(),
    plannedEnd: row.plannedEnd.toISOString(),
    freezeOverrideReason: row.freezeOverrideReason,
    createdBy,
    conflicts: a.conflicts.map((c) => ({
      itemKey: c.itemKey,
      summary: c.summary,
      start: c.window.start.toISOString(),
      end: c.window.end.toISOString(),
    })),
    freezes: a.freezes.map((f) => ({
      name: f.name,
      reason: f.reason,
      start: f.window.start.toISOString(),
      end: f.window.end.toISOString(),
    })),
    startsInPast: a.startsInPast,
    durationMs: a.durationMs,
  };
}

/** หน้าต่างของงานใบหนึ่ง พร้อมการชนที่คำนวณสด — `null` เมื่อยังไม่ได้ตั้ง */
export async function windowOf(
  ctx: TenantContext,
  itemKey: string,
  now: UtcDate = systemClock.nowUtc(),
): Promise<WindowView | null> {
  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({ where: { itemKey }, select: { id: true } });
  if (item === null) throw new WorkItemNotFoundForWindowError(itemKey);

  const row = await db.changeWindow.findFirst({
    where: { workItemId: item.id },
    select: {
      plannedStart: true,
      plannedEnd: true,
      freezeOverrideReason: true,
      createdBy: { select: { displayName: true } },
    },
  });
  if (row === null) return null;

  /*
    **คำนวณการชนสดทุกครั้งที่อ่าน ไม่เก็บผลไว้** — งานใบอื่นถูกเลื่อนมาชน
    ทีหลังได้ · ผลที่เก็บไว้ตอนบันทึกจะบอกว่า "ไม่ชนใคร" ต่อไปตลอดกาล
    ทั้งที่ตอนนี้ชนแล้ว ซึ่งเป็นความเงียบชนิดที่ไม่มีใครสังเกต
  */
  const window = { start: toUtcDate(row.plannedStart), end: toUtcDate(row.plannedEnd) };
  const a = assessWindow({
    window,
    others: await othersNear(ctx, window, item.id),
    freezes: await freezesOf(ctx),
    now,
    ...(row.freezeOverrideReason === null ? {} : { overrideReason: row.freezeOverrideReason }),
  });
  return toView(row, row.createdBy.displayName, a);
}

export interface SetWindowInput {
  plannedStart: string;
  plannedEnd: string;
  freezeOverrideReason?: string | undefined;
}

/**
 * ตั้งหรือแก้หน้าต่างเวลา
 *
 * @throws {BackwardWindowError} `end <= start`
 * @throws {WindowTooLongError} ยาวเกิน `MAX_WINDOW_DAYS`
 * @throws {InFreezeWindowError} อยู่ในช่วงห้ามโดยไม่ได้ให้เหตุผล
 *
 * **การชนกับงานอื่นไม่โยน error** — คืนกลับไปให้หน้าจอแสดง · ห้ามเมื่อไร
 * คนจะไปนัดกันนอกระบบแล้วระบบจะไม่รู้อะไรเลย
 */
export async function setWindow(
  ctx: TenantContext,
  itemKey: string,
  input: SetWindowInput,
  now: UtcDate = systemClock.nowUtc(),
): Promise<WindowView> {
  if (ctx.actorId === null) throw new WorkItemNotFoundForWindowError(itemKey);
  const db = tenantScoped(ctx);

  const item = await db.workItem.findFirst({ where: { itemKey }, select: { id: true } });
  if (item === null) throw new WorkItemNotFoundForWindowError(itemKey);

  const start = toUtcDate(input.plannedStart);
  const end = toUtcDate(input.plannedEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BackwardWindowError();
  const window = { start, end };

  const reason = input.freezeOverrideReason?.trim();
  const a = assessWindow({
    window,
    others: await othersNear(ctx, window, item.id),
    freezes: await freezesOf(ctx),
    now,
    ...(reason === undefined || reason === '' ? {} : { overrideReason: reason }),
  });
  if (a.blocked) throw new InFreezeWindowError(a.freezes);

  const previous = await db.changeWindow.findFirst({
    where: { workItemId: item.id },
    select: { plannedStart: true, plannedEnd: true },
  });

  return auditedTransaction(ctx, 'change.window.set', async (tx) => {
    const row = await tx.changeWindow.upsert({
      where: { workItemId: item.id },
      create: {
        tenantId: ctx.tenantId,
        workItemId: item.id,
        plannedStart: start,
        plannedEnd: end,
        // เก็บเหตุผลเฉพาะเมื่อข้ามช่วงห้ามจริง — ไม่ใช่ทุกครั้งที่มีข้อความส่งมา
        freezeOverrideReason: a.overridden ? (reason ?? null) : null,
        createdById: ctx.actorId ?? BigInt(0),
      },
      update: {
        plannedStart: start,
        plannedEnd: end,
        freezeOverrideReason: a.overridden ? (reason ?? null) : null,
      },
      select: {
        plannedStart: true,
        plannedEnd: true,
        freezeOverrideReason: true,
        createdBy: { select: { displayName: true } },
      },
    });

    const before =
      previous === null
        ? null
        : `${previous.plannedStart.toISOString()} → ${previous.plannedEnd.toISOString()}`;
    return {
      result: toView(row, row.createdBy.displayName, a),
      audit: [
        change(
          item.id,
          'changeWindow',
          before,
          `${start.toISOString()} → ${end.toISOString()}` +
            (a.overridden ? ` (ข้ามช่วงห้าม: ${reason ?? ''})` : ''),
        ),
      ],
    };
  });
}

/** ถอนหน้าต่างเวลา — งานที่ยกเลิกไปแล้วไม่ควรไปชนกับใคร */
export async function clearWindow(ctx: TenantContext, itemKey: string): Promise<void> {
  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({ where: { itemKey }, select: { id: true } });
  if (item === null) throw new WorkItemNotFoundForWindowError(itemKey);

  const existing = await db.changeWindow.findFirst({
    where: { workItemId: item.id },
    select: { plannedStart: true, plannedEnd: true },
  });
  if (existing === null) return;

  await auditedTransaction(ctx, 'change.window.clear', async (tx) => {
    await tx.changeWindow.deleteMany({ where: { workItemId: item.id } });
    return {
      result: undefined,
      audit: [
        change(
          item.id,
          'changeWindow',
          `${existing.plannedStart.toISOString()} → ${existing.plannedEnd.toISOString()}`,
          null,
        ),
      ],
    };
  });
}

export interface CalendarEntry {
  itemKey: string;
  summary: string;
  start: string;
  end: string;
  overridden: boolean;
}

/**
 * ปฏิทินการเปลี่ยนแปลงในช่วงที่ขอ
 *
 * เรียงตามเวลาเริ่มจริง ไม่ใช่ตามที่ฐานข้อมูลคืนมา — ปฏิทินที่สลับลำดับ
 * ทำให้คนอ่านไม่ออกว่าอะไรมาก่อน
 */
export async function changeCalendar(
  ctx: TenantContext,
  fromIso: string,
  toIso: string,
): Promise<{ entries: CalendarEntry[]; freezes: WindowView['freezes'] }> {
  const from = toUtcDate(fromIso);
  const to = toUtcDate(toIso);
  const rows = await tenantScoped(ctx).changeWindow.findMany({
    where: {
      plannedStart: { gte: new Date(from.getTime() - MAX_WINDOW_DAYS * DAY_MS), lt: to },
    },
    orderBy: { plannedStart: 'asc' },
    select: {
      plannedStart: true,
      plannedEnd: true,
      freezeOverrideReason: true,
      workItem: { select: { itemKey: true, summary: true } },
    },
  });

  const entries = rows
    // กรองปลายช่วงในหน่วยความจำ — index ครอบได้แค่ `plannedStart`
    .filter((r) => r.plannedEnd.getTime() > from.getTime())
    .map((r) => ({
      itemKey: r.workItem.itemKey,
      summary: r.workItem.summary,
      start: r.plannedStart.toISOString(),
      end: r.plannedEnd.toISOString(),
      overridden: r.freezeOverrideReason !== null,
    }));

  const freezes = (await freezesOf(ctx))
    .filter((f) => f.window.end.getTime() > from.getTime() && f.window.start.getTime() < to.getTime())
    .map((f) => ({
      name: f.name,
      reason: f.reason,
      start: f.window.start.toISOString(),
      end: f.window.end.toISOString(),
    }));

  return { entries, freezes };
}
