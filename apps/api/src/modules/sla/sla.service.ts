/**
 * SLA Service — ต่อเอนจินเข้ากับฐานข้อมูล
 *
 * แหล่งความจริงของนาฬิกาคือตาราง `sla_event` (append-only)
 * คอลัมน์บน `work_item_sla` เป็นค่า denormalise เพื่อให้หน้าคิวเรนเดอร์ได้
 * โดยไม่ต้องคำนวณใหม่ทุกแถว — คำนวณใหม่จากเหตุการณ์ได้เสมอเมื่อจำเป็น
 *
 * ทำไมต้อง denormalise: หน้าคิวแสดง 50 แถว ถ้าคำนวณสดทุกแถวจะต้องอ่าน
 * เหตุการณ์ทั้งหมดของทุกงาน — เป็นปัญหาแบบเดียวกับ EAV ใน ADR-001
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { tenantScoped, tenantTransaction } from '../../infrastructure/prisma/tenant-scope';
import {
  HOURS_24_7,
  type BusinessCalendar,
  type WorkingWindow,
} from './business-calendar';
import { computeSla, notificationTimes, type SlaEvent, type SlaStatus } from './sla-engine';
import { SLA_THRESHOLDS, planSlaJobs, type PlannedJob } from './sla-scheduler';

export class NoSlaPolicyError extends Error {
  constructor(projectKey: string) {
    super(`โปรเจกต์ ${projectKey} ยังไม่ได้ตั้งค่า SLA Policy`);
    this.name = 'NoSlaPolicyError';
  }
}

interface GoalMatch {
  priorityRanks?: number[];
  issueTypeNames?: string[];
}

/** โหลดปฏิทินจากฐานข้อมูลให้อยู่ในรูปที่เอนจินใช้ได้ */
async function loadCalendar(ctx: TenantContext, calendarId: bigint): Promise<BusinessCalendar> {
  const db = tenantScoped(ctx);
  const row = await db.slaCalendar.findFirst({
    where: { id: calendarId },
    include: { holidays: { select: { date: true } } },
  });
  if (row === null) return HOURS_24_7;

  const weekly = Array.isArray(row.weekly)
    ? (row.weekly as unknown as WorkingWindow[][])
    : (HOURS_24_7.weekly as unknown as WorkingWindow[][]);

  return {
    name: row.name,
    timezone: row.timezone,
    weekly,
    holidays: new Set(row.holidays.map((h) => h.date)),
  };
}

/**
 * เลือก goal ที่เข้าเงื่อนไข — ใช้ตัวแรกที่ match ตามลำดับ position
 *
 * goal ที่ไม่มี `match` ถือเป็นค่าตั้งต้น (catch-all) และควรอยู่ position ท้ายสุด
 */
function goalMatches(match: GoalMatch | null, priorityRank: number | null, issueType: string): boolean {
  if (match === null) return true;
  if (match.priorityRanks !== undefined && match.priorityRanks.length > 0) {
    if (priorityRank === null || !match.priorityRanks.includes(priorityRank)) return false;
  }
  if (match.issueTypeNames !== undefined && match.issueTypeNames.length > 0) {
    if (!match.issueTypeNames.includes(issueType)) return false;
  }
  return true;
}

/**
 * ตัวส่งงานเข้าคิว — ฉีดเข้ามาแทนการ import BullMQ ตรง ๆ
 *
 * เหตุผล: `sla.service` เป็นโค้ดโดเมน ไม่ควรผูกกับ Redis · ทำให้เทสต์ที่มีอยู่
 * ไม่ต้องมี Redis และทำให้แยก worker ออกเป็นเซอร์วิสได้ตามเกณฑ์ใน ADR-004
 * โดยเปลี่ยนแค่ตัวที่ฉีดเข้ามา
 */
export interface SlaJobDispatcher {
  schedule(workItemSlaId: bigint, jobs: PlannedJob[], thresholds: readonly number[]): Promise<void>;
}

let dispatcher: SlaJobDispatcher | null = null;

export function setSlaJobDispatcher(d: SlaJobDispatcher | null): void {
  dispatcher = d;
}

export interface SlaSnapshot {
  goalKey: string;
  goalName: string;
  state: SlaStatus['state'];
  elapsedMs: number;
  targetMs: number;
  remainingMs: number;
  breachAt: string | null;
  /** เวลาที่หลุดไปแล้วจริง — null เมื่อยังไม่หลุด */
  breachedAt: string | null;
  ratio: number;
  isBreached: boolean;
}

/**
 * สร้างนาฬิกา SLA ให้งานใบหนึ่ง (ถ้ายังไม่มี) แล้วเริ่มนับ
 *
 * เรียกตอนสร้างงานใหม่ · เรียกซ้ำได้ ไม่สร้างซ้ำ
 */
export async function startSlaFor(
  ctx: TenantContext,
  workItemId: bigint,
  now: UtcDate = systemClock.nowUtc(),
): Promise<SlaSnapshot | null> {
  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({
    where: { id: workItemId },
    include: { project: true, priority: true, issueType: true, status: true },
  });
  if (item === null) return null;

  const policy = await db.slaPolicy.findFirst({
    where: { projectId: item.projectId },
    include: { goals: { orderBy: { position: 'asc' } } },
  });
  if (policy === null) return null;

  const goal = policy.goals.find((g) =>
    goalMatches(g.match as GoalMatch | null, item.priority?.rank ?? null, item.issueType.name),
  );
  if (goal === undefined) return null;

  const existing = await db.workItemSla.findFirst({ where: { workItemId, goalId: goal.id } });
  if (existing === null) {
    await tenantTransaction(ctx, async (tx) => {
      const created = await tx.workItemSla.create({
        data: {
          tenantId: ctx.tenantId,
          workItemId,
          goalId: goal.id,
          state: 'running',
          elapsedMs: 0,
          targetMs: goal.targetMs,
        },
      });
      await tx.slaEvent.create({
        data: {
          tenantId: ctx.tenantId,
          workItemSlaId: created.id,
          kind: 'start',
          at: item.createdAt,
        },
      });

      // **สถานะปัจจุบันของงานต้องสะท้อนในนาฬิกาตั้งแต่แรก**
      //
      // งานที่อยู่สถานะ "รอลูกค้าตอบ" อยู่แล้วตอนสร้างนาฬิกา ต้องได้ pause ทันที
      // มิฉะนั้นนาฬิกาจะเดินทั้งที่สถานะบอกว่าหยุด — ซึ่งเกิดขึ้นจริงตอน
      // สร้างนาฬิกาย้อนหลังให้ข้อมูลเดิม และจะเกิดอีกทุกครั้งที่ import ข้อมูล
      if (item.status.pausesSla) {
        await tx.slaEvent.create({
          data: {
            tenantId: ctx.tenantId,
            workItemSlaId: created.id,
            kind: 'pause',
            at: item.updatedAt,
          },
        });
      } else if (item.status.category === 'DONE') {
        await tx.slaEvent.create({
          data: {
            tenantId: ctx.tenantId,
            workItemSlaId: created.id,
            kind: 'stop',
            at: item.resolvedAt ?? item.updatedAt,
          },
        });
      }
    });
  }

  return recomputeSla(ctx, workItemId, now);
}

/**
 * บันทึกเหตุการณ์แล้วคำนวณใหม่
 *
 * เหตุการณ์ต่อท้ายเสมอ ไม่แก้ของเดิม — ประวัติของนาฬิกาต้องตรวจสอบย้อนหลังได้
 */
export async function recordSlaEvent(
  ctx: TenantContext,
  workItemId: bigint,
  kind: SlaEvent['kind'],
  at: UtcDate,
  newTargetMs?: number,
): Promise<SlaSnapshot | null> {
  const db = tenantScoped(ctx);
  const clock = await db.workItemSla.findFirst({ where: { workItemId } });
  if (clock === null) return null;

  await tenantTransaction(ctx, async (tx) => {
    await tx.slaEvent.create({
      data: {
        tenantId: ctx.tenantId,
        workItemSlaId: clock.id,
        kind,
        at,
        newTargetMs: newTargetMs ?? null,
      },
    });
  });

  return recomputeSla(ctx, workItemId, at);
}

/** คำนวณใหม่จากเหตุการณ์ทั้งหมด แล้วอัปเดตค่า denormalise */
export async function recomputeSla(
  ctx: TenantContext,
  workItemId: bigint,
  now: UtcDate = systemClock.nowUtc(),
): Promise<SlaSnapshot | null> {
  const db = tenantScoped(ctx);
  const clock = await db.workItemSla.findFirst({
    where: { workItemId },
    include: {
      goal: { include: { policy: true } },
      /**
       * เรียงตามเวลา แล้วตามลำดับที่บันทึก
       *
       * เหตุการณ์สองรายการที่เวลาเดียวกันเป๊ะเกิดขึ้นได้จริง (เปลี่ยนสถานะรวดเดียว
       * แล้วบันทึกทั้ง reopen และ pause) · ถ้าเรียงด้วย `at` อย่างเดียว MySQL
       * เลือกลำดับเองได้ตามใจ แล้วผลการคำนวณจะสลับไปมาระหว่างการเรียกสองครั้ง
       * ที่ข้อมูลเหมือนกันทุกอย่าง — บั๊กที่ทำซ้ำไม่ได้คือบั๊กที่หาไม่เจอ
       */
      events: { orderBy: [{ at: 'asc' }, { id: 'asc' }] },
    },
  });
  if (clock === null) return null;

  const calendar = await loadCalendar(ctx, clock.goal.policy.calendarId);
  const events: SlaEvent[] = clock.events.map((e) => ({
    kind: e.kind as SlaEvent['kind'],
    at: e.at as UtcDate,
    ...(e.newTargetMs === null ? {} : { newTargetMs: e.newTargetMs }),
  }));

  const status = computeSla(calendar, clock.goal.targetMs, events, now);

  await db.workItemSla.update({
    where: { id: clock.id },
    data: {
      state: status.state,
      elapsedMs: Math.round(status.elapsedMs),
      targetMs: status.targetMs,
      breachAt: status.breachAt,
      breachedAt: status.breachedAt,
      isBreached: status.isBreached,
    },
  });

  // ตั้งงานแจ้งเตือนใหม่ทุกครั้งที่คำนวณใหม่
  //
  // การตั้งใหม่ **แทนที่** ของเดิมเสมอ ไม่ใช่เพิ่มซ้อน — ถ้าไม่ทำ ตั๋วที่ถูกพัก
  // สองวันแล้วกลับมาเดิน จะได้แจ้งเตือนตามเวลาเดิมที่ตั้งไว้ก่อนพัก
  // (พิสูจน์ไว้ใน apps/worker/src/smoke.ts ขั้นที่ 5)
  if (dispatcher !== null) {
    const jobs = planSlaJobs({
      tenantId: ctx.tenantId,
      workItemId,
      workItemSlaId: clock.id,
      state: status.state,
      notifications: notificationTimes(calendar, status, now, SLA_THRESHOLDS),
      now,
    });
    await dispatcher.schedule(clock.id, jobs, SLA_THRESHOLDS);
  }

  return {
    goalKey: clock.goal.key,
    goalName: clock.goal.name,
    state: status.state,
    elapsedMs: status.elapsedMs,
    targetMs: status.targetMs,
    remainingMs: status.remainingMs,
    breachAt: status.breachAt?.toISOString() ?? null,
    breachedAt: status.breachedAt?.toISOString() ?? null,
    ratio: status.ratio,
    isBreached: status.isBreached,
  };
}

/**
 * อ่านสถานะ SLA ของหลายงานพร้อมกัน — ใช้ในหน้าคิว
 *
 * อ่านจากค่า denormalise ไม่คำนวณใหม่ · ค่าที่ได้อาจช้ากว่าความจริงเล็กน้อย
 * ซึ่งยอมรับได้เพราะหน้าจอนับถอยหลังต่อเองจาก `breachAt`
 */
export async function slaForWorkItems(
  ctx: TenantContext,
  workItemIds: bigint[],
): Promise<Map<string, SlaSnapshot>> {
  if (workItemIds.length === 0) return new Map();
  const db = tenantScoped(ctx);
  const rows = await db.workItemSla.findMany({
    where: { workItemId: { in: workItemIds } },
    include: { goal: true },
  });

  const out = new Map<string, SlaSnapshot>();
  for (const r of rows) {
    out.set(r.workItemId.toString(), {
      goalKey: r.goal.key,
      goalName: r.goal.name,
      state: r.state as SlaStatus['state'],
      elapsedMs: r.elapsedMs,
      targetMs: r.targetMs,
      remainingMs: Math.max(0, r.targetMs - r.elapsedMs),
      breachAt: r.breachAt?.toISOString() ?? null,
      breachedAt: r.breachedAt?.toISOString() ?? null,
      ratio: r.targetMs === 0 ? 1 : r.elapsedMs / r.targetMs,
      isBreached: r.isBreached,
    });
  }
  return out;
}

/**
 * ข้อตกลงบริการของโปรเจกต์นี้ — null เมื่อยังไม่ได้ตั้ง
 *
 * โปรเจกต์ที่ไม่มี policy จะไม่มีนาฬิกาให้งานสักใบ ซึ่งไม่ผิดพลาดอะไร
 * แต่ต้องบอกให้เห็น ไม่ใช่แสดงพื้นที่ว่างที่ดูเหมือน "ยังไม่หลุด"
 */
export async function describeSlaPolicy(
  ctx: TenantContext,
  projectId: bigint,
): Promise<{
  name: string;
  calendar: string;
  calendarVerified: boolean;
  goals: Array<{ key: string; name: string; targetMs: number; match: unknown }>;
} | null> {
  const db = tenantScoped(ctx);
  const policy = await db.slaPolicy.findFirst({
    where: { projectId },
    include: {
      calendar: { select: { name: true, verified: true } },
      goals: { orderBy: { position: 'asc' } },
    },
  });
  if (policy === null) return null;
  return {
    name: policy.name,
    calendar: policy.calendar.name,
    // ปฏิทินที่ยังไม่ตรวจสอบใช้บน production ไม่ได้ (assertVerified) —
    // ผู้ดูแลต้องเห็นสถานะนี้ก่อนวันที่มันโยน error ใส่หน้า
    calendarVerified: policy.calendar.verified,
    goals: policy.goals.map((g) => ({
      key: g.key,
      name: g.name,
      targetMs: g.targetMs,
      match: g.match,
    })),
  };
}
