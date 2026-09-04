/**
 * ตารางเวลาส่งรายงาน — ต่อ `schedule.ts` เข้ากับฐานข้อมูล
 *
 * **ตารางเป็นของแต่ละคน และส่งให้เจ้าของคนเดียว** · "ส่งให้ทีม" เป็นคำที่
 * ไม่มีใครนิยาม และคำที่ไม่มีใครนิยามจะกลายเป็น "ทุกคน" ในโค้ดเสมอ
 * (CLAUDE.md) · ผู้รับหลายคนต้องมาเป็นแถวที่ระบุตัวบุคคลชัดเจน
 *
 * **ส่งด้วยขอบเขตสิทธิ์ของเจ้าของเสมอ** ไม่ใช่ของระบบ — ตารางที่ตั้งไว้
 * ตอนยังมีสิทธิ์ ต้องหยุดส่งเมื่อสิทธิ์ถูกถอน มิฉะนั้นการถอนสิทธิ์
 * จะไม่มีผลกับสิ่งที่ตั้งไว้แล้ว ซึ่งเป็นช่องที่ไม่มีใครนึกถึง
 */
import {
  InvalidScheduleError,
  nextRunAt,
  scheduleFromRow,
  toUtcDate,
  type Schedule,
  type UtcDate,
  type TenantContext,
} from '@itsm/types';

/*
  ย้ายไป `@itsm/types` แล้ว เพราะ worker ต้องแปลงแถวเป็นตารางเวลาด้วย
  กติกาเดียวกันตอนอ่านมาส่ง · ส่งต่อชื่อเดิมไว้
*/
export { InvalidScheduleError, scheduleFromRow };

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan, browsableProjectIds } from '../permission';

/** จำนวนตารางต่อคน · มากกว่านี้คือคนที่ควรใช้รายงานหน้าจอแทน */
export const MAX_SCHEDULES_PER_USER = 10;

export class ScheduleProjectNotFoundError extends Error {
  constructor() {
    super('ไม่พบโปรเจกต์นี้ หรือคุณยังเปิดดูไม่ได้');
  }
}

export class ScheduleNotFoundError extends Error {
  constructor() {
    super('ไม่พบตารางเวลานี้');
  }
}

export class TooManySchedulesError extends Error {
  constructor() {
    super(
      `ตั้งตารางเวลาได้ไม่เกิน ${String(MAX_SCHEDULES_PER_USER)} รายการต่อคน` +
        ' · ลบรายการที่ไม่ได้ใช้ออกก่อน',
    );
  }
}

export class NotSignedInError extends Error {
  constructor() {
    super('ต้องเข้าสู่ระบบก่อนจึงจะตั้งตารางเวลาได้');
  }
}

/** แถวที่ส่งออกให้ผู้เรียก · id เป็น string เสมอ (BigInt พัง `JSON.stringify`) */
export interface ScheduleRow {
  id: string;
  name: string;
  projectKey: string;
  schedule: Schedule;
  isEnabled: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  /** เวลาที่ควรส่งครั้งต่อไป — คำนวณจากเอนจิน ไม่ได้เก็บไว้ */
  nextRunAt: string;
}

async function projectOf(ctx: TenantContext, projectKey: string): Promise<bigint> {
  const allowed = await browsableProjectIds(ctx);
  const project =
    allowed.length === 0
      ? null
      : await tenantScoped(ctx).project.findFirst({
          where: { key: projectKey.trim(), id: { in: allowed } },
          select: { id: true },
        });
  if (project === null) throw new ScheduleProjectNotFoundError();
  return project.id;
}

function toRow(
  r: {
    id: bigint;
    name: string;
    kind: string;
    hour: number;
    minute: number;
    weekday: number | null;
    day: number | null;
    isEnabled: boolean;
    lastRunAt: Date | null;
    lastError: string | null;
    project: { key: string };
  },
  now: UtcDate,
): ScheduleRow {
  const s = scheduleFromRow(r);
  const last = r.lastRunAt === null ? null : toUtcDate(r.lastRunAt);
  return {
    id: r.id.toString(),
    name: r.name,
    projectKey: r.project.key,
    schedule: s,
    isEnabled: r.isEnabled,
    lastRunAt: r.lastRunAt === null ? null : r.lastRunAt.toISOString(),
    lastError: r.lastError,
    nextRunAt: nextRunAt(s, now, last).toISOString(),
  };
}

const SELECT = {
  id: true,
  name: true,
  kind: true,
  hour: true,
  minute: true,
  weekday: true,
  day: true,
  isEnabled: true,
  lastRunAt: true,
  lastError: true,
  project: { select: { key: true } },
} as const;

/** ตารางของ **ผู้เรียกเอง** เท่านั้น — ไม่มีใครเห็นของคนอื่น */
export async function mySchedules(ctx: TenantContext, now: UtcDate): Promise<ScheduleRow[]> {
  if (ctx.actorId === null) return [];
  const rows = await tenantScoped(ctx).reportSchedule.findMany({
    where: { ownerId: ctx.actorId },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: SELECT,
  });
  return rows.map((r) => toRow(r, now));
}

export async function createSchedule(
  ctx: TenantContext,
  projectKey: string,
  input: { name: string; schedule: Schedule },
  now: UtcDate,
): Promise<ScheduleRow> {
  const projectId = await projectOf(ctx, projectKey);
  if (ctx.actorId === null) throw new NotSignedInError();
  /*
    **ต้องมีสิทธิ์ดูรายงานตอนตั้ง** และจะถูกตรวจอีกครั้งตอนส่งทุกรอบ ·
    ตรวจแค่ตอนตั้งไม่พอ เพราะสิทธิ์ถูกถอนได้หลังจากนั้น
  */
  await assertCan(ctx, projectId, 'VIEW_REPORT');

  const name = input.name.trim();
  if (name === '') throw new InvalidScheduleError('ตั้งชื่อตารางเวลาก่อน');
  const s = input.schedule;

  const db = tenantScoped(ctx);
  const mine = await db.reportSchedule.count({ where: { ownerId: ctx.actorId } });
  if (mine >= MAX_SCHEDULES_PER_USER) throw new TooManySchedulesError();

  const created = await db.reportSchedule.create({
    data: {
      tenantId: ctx.tenantId,
      ownerId: ctx.actorId,
      projectId,
      name,
      kind: s.kind,
      hour: s.hour,
      minute: s.minute,
      weekday: s.kind === 'weekly' ? s.weekday : null,
      day: s.kind === 'monthly' ? s.day : null,
    },
    select: SELECT,
  });
  return toRow(created, now);
}

/** ลบตารางของตัวเอง · ลบด้วย id ที่ระบุแถวเดียว ไม่ใช่เงื่อนไขช่วง */
export async function deleteSchedule(ctx: TenantContext, id: string): Promise<void> {
  if (ctx.actorId === null) throw new NotSignedInError();
  if (!/^\d+$/.test(id)) throw new ScheduleNotFoundError();
  const db = tenantScoped(ctx);
  const row = await db.reportSchedule.findFirst({
    where: { id: BigInt(id), ownerId: ctx.actorId },
    select: { id: true },
  });
  if (row === null) throw new ScheduleNotFoundError();
  await db.reportSchedule.delete({ where: { id: row.id } });
}

/** เปิดหรือปิดตารางของตัวเอง — ปิดไว้ต่างจากลบทิ้ง */
export async function setScheduleEnabled(
  ctx: TenantContext,
  id: string,
  enabled: boolean,
  now: UtcDate,
): Promise<ScheduleRow> {
  if (ctx.actorId === null) throw new NotSignedInError();
  if (!/^\d+$/.test(id)) throw new ScheduleNotFoundError();
  const db = tenantScoped(ctx);
  const row = await db.reportSchedule.findFirst({
    where: { id: BigInt(id), ownerId: ctx.actorId },
    select: { id: true },
  });
  if (row === null) throw new ScheduleNotFoundError();
  const updated = await db.reportSchedule.update({
    where: { id: row.id },
    data: { isEnabled: enabled },
    select: SELECT,
  });
  return toRow(updated, now);
}
