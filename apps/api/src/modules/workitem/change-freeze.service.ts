/**
 * ช่วงห้ามเปลี่ยนแปลง — ตั้งจากหน้าจอ
 *
 * ก่อนหน้านี้ตาราง `change_freeze` มีอยู่และเอนจินใช้จริง **แต่ไม่มีทางเข้า
 * ใด ๆ นอกจากเขียน SQL** — กลไกที่ไม่มีอะไรเรียกใช้ ป้องกันอะไรไม่ได้เลย
 * (CLAUDE.md §4) · ในทางปฏิบัติแปลว่าไม่มีองค์กรไหนเคยมีช่วงห้ามสักช่วง
 *
 * ## ลบแล้วกระทบใครบ้าง ต้องเห็นก่อนกด
 *
 * หน้าต่างเวลาที่ถูกบันทึกไว้ตอนที่ช่วงห้ามยังอยู่ **ไม่ถูกย้อนกลับ** เมื่อ
 * ช่วงห้ามหายไป — มันแค่กลายเป็นหน้าต่างธรรมดาที่มีเหตุผลข้ามค้างอยู่
 * ผู้ดูแลจึงต้องรู้จำนวนก่อนกดลบ ไม่ใช่รู้ตอนที่คำเตือนหายไปแล้ว
 */
import { toUtcDate, type TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { BackwardWindowError, overlaps } from './change-window';

export { BackwardWindowError };

export class FreezeNameRequiredError extends Error {
  constructor() {
    super('ต้องตั้งชื่อช่วงห้าม');
    this.name = 'FreezeNameRequiredError';
  }
}

/**
 * ช่วงห้ามที่ไม่บอกเหตุผล
 *
 * เหตุผลไม่ใช่ของประดับ — คนที่จะขอข้ามต้องอ่านแล้วตัดสินใจได้เองว่าเรื่องของเขา
 * สำคัญพอไหม · ช่วงห้ามที่เขียนว่า "ห้าม" เฉย ๆ จะถูกข้ามทุกครั้งโดยไม่มีใครคิด
 */
export class FreezeReasonRequiredError extends Error {
  constructor() {
    super('ต้องบอกเหตุผลที่ห้าม — คนที่จะขอข้ามต้องอ่านแล้วตัดสินใจได้เอง');
    this.name = 'FreezeReasonRequiredError';
  }
}

export class FreezeNotFoundError extends Error {
  constructor() {
    super('ไม่พบช่วงห้ามที่ระบุ');
    this.name = 'FreezeNotFoundError';
  }
}

export class DuplicateFreezeError extends Error {
  // ตั้งชื่อ `freezeName` ไม่ใช่ `name` — `Error.name` มีอยู่แล้วและใช้บอกชนิด
  constructor(readonly freezeName: string) {
    super(`มีช่วงห้ามชื่อ "${freezeName}" ที่เริ่มเวลาเดียวกันอยู่แล้ว`);
    this.name = 'DuplicateFreezeError';
  }
}

export interface FreezeView {
  id: string;
  name: string;
  reason: string;
  startsAt: string;
  endsAt: string;
  /** หน้าต่างเวลาที่คาบเกี่ยวช่วงนี้ — ผู้ดูแลต้องเห็นก่อนแก้หรือลบ */
  affectedCount: number;
}

const MAX_FREEZE_DAYS = 90;

export class FreezeTooLongError extends Error {
  constructor(readonly days: number) {
    super(
      `ช่วงห้ามยาว ${String(Math.round(days))} วัน — เกิน ${String(MAX_FREEZE_DAYS)} วัน ` +
        `ช่วงห้ามที่ยาวกว่านี้คือการปิดระบบ ไม่ใช่ช่วงห้าม`,
    );
    this.name = 'FreezeTooLongError';
  }
}

interface FreezeInput {
  name: string;
  reason: string;
  startsAt: string;
  endsAt: string;
}

function validate(input: FreezeInput): { name: string; reason: string; start: Date; end: Date } {
  const name = input.name.trim();
  const reason = input.reason.trim();
  if (name === '') throw new FreezeNameRequiredError();
  if (reason === '') throw new FreezeReasonRequiredError();

  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BackwardWindowError();
  const ms = end.getTime() - start.getTime();
  if (ms <= 0) throw new BackwardWindowError();
  if (ms > MAX_FREEZE_DAYS * 24 * 60 * 60 * 1000) {
    throw new FreezeTooLongError(ms / (24 * 60 * 60 * 1000));
  }
  return { name, reason, start, end };
}

interface Freeze {
  id: bigint;
  startsAt: Date;
  endsAt: Date;
}

/** แคบชนิดให้ TypeScript รู้ว่ามีสมาชิกอย่างน้อยหนึ่งตัว — แทนการยืนยันด้วย `!` */
function isNonEmpty(v: readonly Freeze[]): v is readonly [Freeze, ...Freeze[]] {
  return v.length > 0;
}

/**
 * นับหน้าต่างเวลาที่คาบเกี่ยวช่วงห้ามแต่ละช่วง
 *
 * ใช้ `overlaps` จากเอนจินตัวเดียวกับที่ตัดสินตอนบันทึก — ถ้านับด้วยเงื่อนไข
 * ที่เขียนใหม่ตรงนี้ ตัวเลขบนหน้าจอจะไม่ตรงกับสิ่งที่ระบบกันจริงในวันที่
 * นิยาม `[start, end)` ถูกแก้
 */
async function affectedCounts(
  ctx: TenantContext,
  freezes: readonly [Freeze, ...Freeze[]] | readonly Freeze[],
): Promise<Map<bigint, number>> {
  const counts = new Map<bigint, number>();
  if (!isNonEmpty(freezes)) return counts;

  /*
    หากรอบที่กว้างที่สุดของทุกช่วงห้ามในครั้งเดียว แล้วอ่านหน้าต่างในกรอบนั้น
    รอบเดียว — ไม่ใช่ยิงคิวรีต่อหนึ่งช่วงห้าม ซึ่งกลายเป็น N+1 ทันทีที่องค์กร
    มีช่วงห้ามหลายช่วง
  */
  let earliest = freezes[0].startsAt;
  let latest = freezes[0].endsAt;
  for (const f of freezes) {
    if (f.startsAt < earliest) earliest = f.startsAt;
    if (f.endsAt > latest) latest = f.endsAt;
  }
  const windows = await tenantScoped(ctx).changeWindow.findMany({
    where: { plannedStart: { lt: latest }, plannedEnd: { gt: earliest } },
    select: { plannedStart: true, plannedEnd: true },
  });

  for (const f of freezes) {
    const fw = { start: toUtcDate(f.startsAt), end: toUtcDate(f.endsAt) };
    counts.set(
      f.id,
      windows.filter((w) =>
        overlaps(fw, { start: toUtcDate(w.plannedStart), end: toUtcDate(w.plannedEnd) }),
      ).length,
    );
  }
  return counts;
}

/** ช่วงห้ามทั้งหมด — ใหม่สุดก่อน เพราะช่วงที่กำลังจะถึงคือช่วงที่คนต้องดู */
export async function listFreezes(ctx: TenantContext): Promise<FreezeView[]> {
  const rows = await tenantScoped(ctx).changeFreeze.findMany({
    orderBy: { startsAt: 'desc' },
    select: { id: true, name: true, reason: true, startsAt: true, endsAt: true },
  });
  const counts = await affectedCounts(ctx, rows);
  return rows.map((f) => ({
    id: f.id.toString(),
    name: f.name,
    reason: f.reason,
    startsAt: f.startsAt.toISOString(),
    endsAt: f.endsAt.toISOString(),
    affectedCount: counts.get(f.id) ?? 0,
  }));
}

export async function createFreeze(ctx: TenantContext, input: FreezeInput): Promise<{ id: bigint }> {
  const v = validate(input);
  const db = tenantScoped(ctx);

  /*
    ตรวจซ้ำด้วยโค้ดก่อน แล้วปล่อยให้ unique index เป็นด่านสุดท้าย —
    ข้อความจากฐานข้อมูลอ่านไม่รู้เรื่องสำหรับผู้ดูแล
  */
  const clash = await db.changeFreeze.findFirst({
    where: { name: v.name, startsAt: v.start },
    select: { id: true },
  });
  if (clash !== null) throw new DuplicateFreezeError(v.name);

  return auditedTransaction(ctx, 'change.freeze.create', async (tx) => {
    const row = await tx.changeFreeze.create({
      data: {
        tenantId: ctx.tenantId,
        name: v.name,
        reason: v.reason,
        startsAt: v.start,
        endsAt: v.end,
      },
      select: { id: true },
    });
    return {
      result: { id: row.id },
      audit: [
        {
          kind: 'system' as const,
          action: 'change.freeze.create',
          entityType: 'change-freeze',
          entityId: row.id.toString(),
          payload: {
            name: v.name,
            startsAt: v.start.toISOString(),
            endsAt: v.end.toISOString(),
          },
        },
      ],
    };
  });
}

export async function updateFreeze(
  ctx: TenantContext,
  id: bigint,
  input: FreezeInput,
): Promise<void> {
  const v = validate(input);
  const db = tenantScoped(ctx);
  const existing = await db.changeFreeze.findFirst({
    where: { id },
    select: { id: true, name: true, startsAt: true, endsAt: true },
  });
  if (existing === null) throw new FreezeNotFoundError();

  const clash = await db.changeFreeze.findFirst({
    where: { name: v.name, startsAt: v.start, id: { not: id } },
    select: { id: true },
  });
  if (clash !== null) throw new DuplicateFreezeError(v.name);

  await auditedTransaction(ctx, 'change.freeze.update', async (tx) => {
    await tx.changeFreeze.update({
      where: { id },
      data: { name: v.name, reason: v.reason, startsAt: v.start, endsAt: v.end },
    });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'change.freeze.update',
          entityType: 'change-freeze',
          entityId: id.toString(),
          payload: {
            from: {
              name: existing.name,
              startsAt: existing.startsAt.toISOString(),
              endsAt: existing.endsAt.toISOString(),
            },
            to: { name: v.name, startsAt: v.start.toISOString(), endsAt: v.end.toISOString() },
          },
        },
      ],
    };
  });
}

/**
 * ลบช่วงห้าม
 *
 * **หน้าต่างเวลาที่เคยถูกกั้นไม่ถูกย้อนกลับ** — มันถูกบันทึกไปแล้วและ
 * ยังอยู่ตามเดิม · สิ่งที่หายไปคือคำเตือนบนหน้าจอ ซึ่งเป็นเหตุผลที่ผู้ดูแล
 * ต้องเห็นจำนวนที่กระทบก่อนกด
 */
export async function deleteFreeze(ctx: TenantContext, id: bigint): Promise<void> {
  const db = tenantScoped(ctx);
  const existing = await db.changeFreeze.findFirst({
    where: { id },
    select: { id: true, name: true, startsAt: true, endsAt: true },
  });
  if (existing === null) throw new FreezeNotFoundError();

  const counts = await affectedCounts(ctx, [existing]);
  const affected = counts.get(existing.id) ?? 0;

  await auditedTransaction(ctx, 'change.freeze.delete', async (tx) => {
    await tx.changeFreeze.deleteMany({ where: { id } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'change.freeze.delete',
          entityType: 'change-freeze',
          entityId: id.toString(),
          /*
            บันทึกจำนวนที่กระทบไว้ในร่องรอย ไม่ใช่แค่บอกบนหน้าจอตอนกด —
            คำถาม "ทำไมใบนั้นถึงไม่มีคำเตือนแล้ว" ถามย้อนหลังเสมอ
          */
          payload: {
            name: existing.name,
            startsAt: existing.startsAt.toISOString(),
            endsAt: existing.endsAt.toISOString(),
            affectedWindows: affected,
          },
        },
      ],
    };
  });
}
