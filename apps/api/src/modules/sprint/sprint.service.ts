/**
 * Sprint — ทะเบียนรอบการทำงาน และ backlog
 *
 * ตรรกะการตัดสินอยู่ใน `sprint-plan.ts` ทั้งหมด · ไฟล์นี้อ่านสภาพจากฐานข้อมูล
 * ส่งให้เอนจิน แล้วเขียนผลลง — **ไม่ตัดสินอะไรเอง**
 *
 * ## ปิดสปรินต์ต้องบอกว่างานค้างไปไหน
 *
 * ไม่มีค่าปริยาย · ผู้เรียกต้องเลือกว่าจะส่งกลับ backlog หรือย้ายไปสปรินต์
 * ถัดไป — การเลือกให้เองแปลว่าวันหนึ่งจะมีคนกดปิดแล้วงานหายไปทางที่เขา
 * ไม่ได้ตั้งใจ และเขาจะไม่รู้จนกว่าจะมีคนถามหางานใบนั้น
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { auditedTransaction, change } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan } from '../permission';
import {
  assertCanComplete,
  assertCanStart,
  assertNotClosed,
  commitmentOf,
  completionOf,
  velocityOf,
  type SprintItem,
  type SprintSnapshot,
  type Velocity,
} from './sprint-plan';

const NAME_MAX = 128;
const GOAL_MAX = 500;
/** จำนวนรอบล่าสุดที่ใช้คำนวณความเร็ว — สามรอบคือช่วงที่ทีมยังจำบริบทได้ */
export const VELOCITY_WINDOW = 3;

export class SprintNameRequiredError extends Error {
  constructor() {
    super('ต้องตั้งชื่อสปรินต์');
    this.name = 'SprintNameRequiredError';
  }
}

export class DuplicateSprintNameError extends Error {
  constructor(readonly given: string) {
    super(`โปรเจกต์นี้มีสปรินต์ชื่อ "${given}" อยู่แล้ว`);
    this.name = 'DuplicateSprintNameError';
  }
}

export class SprintNotFoundError extends Error {
  constructor(id: bigint) {
    super(`ไม่พบสปรินต์ #${id.toString()}`);
    this.name = 'SprintNotFoundError';
  }
}

export class ProjectNotFoundForSprintError extends Error {
  constructor(readonly key: string) {
    super(`ไม่พบโปรเจกต์ "${key}"`);
    this.name = 'ProjectNotFoundForSprintError';
  }
}

export class ItemNotFoundForSprintError extends Error {
  constructor(readonly itemKey: string) {
    super(`ไม่พบงาน ${itemKey}`);
    this.name = 'ItemNotFoundForSprintError';
  }
}

export class ItemFromOtherProjectError extends Error {
  constructor(readonly itemKey: string) {
    super(`${itemKey} อยู่คนละโปรเจกต์กับสปรินต์นี้`);
    this.name = 'ItemFromOtherProjectError';
  }
}

export class InvalidStoryPointsError extends Error {
  constructor(readonly given: unknown) {
    super('แต้มต้องเป็นตัวเลขไม่ติดลบ หรือเว้นว่างเพื่อบอกว่ายังไม่ประเมิน');
    this.name = 'InvalidStoryPointsError';
  }
}

export interface SprintRow {
  id: string;
  name: string;
  goal: string | null;
  state: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  startedAt: string | null;
  completedAt: string | null;
  itemCount: number;
  /** แต้มของงานที่อยู่ในสปรินต์ **ตอนนี้** — ไม่ใช่ตอนรับปาก */
  points: number;
  unestimated: number;
  committedPoints: number | null;
  completedPoints: number | null;
  addedAfterStart: number | null;
}

export interface BacklogRow {
  itemKey: string;
  summary: string;
  statusName: string;
  statusCategory: string;
  priorityName: string | null;
  storyPoints: number | null;
  sprintId: string | null;
}

/** `Prisma.Decimal` คืนมาเป็น object ไม่ใช่ number — แปลงที่ขอบเสมอ */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanName(raw: unknown): string {
  const n = (typeof raw === 'string' ? raw : '').trim().slice(0, NAME_MAX);
  if (n === '') throw new SprintNameRequiredError();
  return n;
}

async function projectOf(ctx: TenantContext, key: string): Promise<bigint> {
  const p = await tenantScoped(ctx).project.findFirst({
    where: { key: key.trim() },
    select: { id: true },
  });
  if (p === null) throw new ProjectNotFoundForSprintError(key);
  return p.id;
}

function toSnapshot(r: {
  id: bigint;
  state: string;
  startedAt: Date | null;
  completedAt: Date | null;
  committedPoints: unknown;
  items?: { id: bigint }[];
}): SprintSnapshot {
  return {
    id: r.id.toString(),
    state: r.state as SprintSnapshot['state'],
    startedAt: (r.startedAt ?? null) as UtcDate | null,
    completedAt: (r.completedAt ?? null) as UtcDate | null,
    committedItemIds: (r.items ?? []).map((i) => i.id.toString()),
    committedPoints: num(r.committedPoints) ?? 0,
  };
}

export async function listSprints(ctx: TenantContext, projectKey: string): Promise<SprintRow[]> {
  const projectId = await projectOf(ctx, projectKey);
  await assertCan(ctx, projectId, 'BROWSE_PROJECT');

  const rows = await tenantScoped(ctx).sprint.findMany({
    where: { projectId },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    include: { items: { select: { storyPoints: true } } },
  });

  return rows.map((s) => ({
    id: s.id.toString(),
    name: s.name,
    goal: s.goal,
    state: s.state,
    plannedStart: s.plannedStart?.toISOString() ?? null,
    plannedEnd: s.plannedEnd?.toISOString() ?? null,
    startedAt: s.startedAt?.toISOString() ?? null,
    completedAt: s.completedAt?.toISOString() ?? null,
    itemCount: s.items.length,
    points: s.items.reduce((a, i) => a + Math.max(0, num(i.storyPoints) ?? 0), 0),
    unestimated: s.items.filter((i) => i.storyPoints === null).length,
    committedPoints: num(s.committedPoints),
    completedPoints: num(s.completedPoints),
    addedAfterStart: s.addedAfterStart,
  }));
}

/**
 * งานที่ยังไม่อยู่ในสปรินต์ไหน — เรียงตาม LexoRank
 *
 * ไม่รวมงานที่ปิดแล้ว · backlog คือ "สิ่งที่ยังต้องทำ" ไม่ใช่ประวัติทั้งหมด
 * ของโปรเจกต์ · หน้าจอที่มีงานปิดแล้วปนอยู่ ทำให้คนเลิกใช้มันภายในสัปดาห์เดียว
 */
export async function backlogOf(
  ctx: TenantContext,
  projectKey: string,
  limit = 200,
): Promise<BacklogRow[]> {
  const projectId = await projectOf(ctx, projectKey);
  await assertCan(ctx, projectId, 'BROWSE_PROJECT');

  const rows = await tenantScoped(ctx).workItem.findMany({
    where: { projectId, sprintId: null, status: { category: { not: 'DONE' } } },
    orderBy: { rank: 'asc' },
    take: limit,
    select: {
      itemKey: true,
      summary: true,
      storyPoints: true,
      sprintId: true,
      status: { select: { name: true, category: true } },
      priority: { select: { name: true } },
    },
  });

  return rows.map((r) => ({
    itemKey: r.itemKey,
    summary: r.summary,
    statusName: r.status.name,
    statusCategory: r.status.category,
    priorityName: r.priority?.name ?? null,
    storyPoints: num(r.storyPoints),
    sprintId: r.sprintId?.toString() ?? null,
  }));
}

export async function createSprint(
  ctx: TenantContext,
  input: { projectKey: string; name: string; goal?: string; plannedStart?: string; plannedEnd?: string },
): Promise<{ id: bigint }> {
  const projectId = await projectOf(ctx, input.projectKey);
  await assertCan(ctx, projectId, 'MANAGE_SPRINT');

  const name = cleanName(input.name);
  const db = tenantScoped(ctx);
  const clash = await db.sprint.findFirst({ where: { projectId, name }, select: { id: true } });
  if (clash !== null) throw new DuplicateSprintNameError(name);

  const when = (v?: string): Date | null => {
    if (v === undefined || v.trim() === '') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  return auditedTransaction(ctx, 'sprint.create', async (tx) => {
    const s = await tx.sprint.create({
      data: {
        tenantId: ctx.tenantId,
        projectId,
        name,
        goal: input.goal?.trim().slice(0, GOAL_MAX) ?? null,
        plannedStart: when(input.plannedStart),
        plannedEnd: when(input.plannedEnd),
        state: 'planned',
      },
      select: { id: true },
    });
    return {
      result: s,
      audit: [
        {
          kind: 'system' as const,
          action: 'sprint.create',
          entityType: 'sprint',
          entityId: s.id.toString(),
          payload: { name, projectKey: input.projectKey },
        },
      ],
    };
  });
}

async function loadSprint(
  ctx: TenantContext,
  id: bigint,
): Promise<{ projectId: bigint; name: string; snapshot: SprintSnapshot; items: SprintItem[] }> {
  const s = await tenantScoped(ctx).sprint.findFirst({
    where: { id },
    include: {
      items: {
        select: {
          id: true,
          storyPoints: true,
          status: { select: { category: true } },
        },
      },
    },
  });
  if (s === null) throw new SprintNotFoundError(id);

  return {
    projectId: s.projectId,
    name: s.name,
    snapshot: toSnapshot(s),
    items: s.items.map((i) => ({
      id: i.id.toString(),
      points: num(i.storyPoints),
      done: i.status.category === 'DONE',
    })),
  };
}

/**
 * เริ่มสปรินต์ — เก็บภาพตอนเริ่มไว้ถาวร
 *
 * `committedItemIds` ของ snapshot ที่ส่งให้เอนจินตรวจ ยังเป็นรายการปัจจุบัน
 * เพราะยังไม่เคยเริ่ม · เอนจินไม่ได้ใช้มันในการตัดสินว่าเริ่มได้ไหม
 */
export async function startSprint(
  ctx: TenantContext,
  id: bigint,
  now: UtcDate = systemClock.nowUtc(),
): Promise<void> {
  const { projectId, name, snapshot, items } = await loadSprint(ctx, id);
  await assertCan(ctx, projectId, 'MANAGE_SPRINT');

  const others = await tenantScoped(ctx).sprint.findMany({
    where: { projectId, NOT: { id } },
    select: { id: true, state: true, startedAt: true, completedAt: true, committedPoints: true },
  });
  assertCanStart(snapshot, others.map((o) => toSnapshot(o)));

  const c = commitmentOf(items, now);
  await auditedTransaction(ctx, 'sprint.start', async (tx) => {
    await tx.sprint.update({
      where: { id },
      data: {
        state: 'active',
        startedAt: now,
        committedCount: c.committedItemIds.length,
        committedPoints: c.committedPoints,
      },
    });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'sprint.start',
          entityType: 'sprint',
          entityId: id.toString(),
          payload: {
            name,
            committedCount: c.committedItemIds.length,
            committedPoints: c.committedPoints,
            unestimated: c.unestimated,
          },
        },
      ],
    };
  });
}

export interface CompleteResult {
  doneCount: number;
  undoneCount: number;
  completedPoints: number;
  addedAfterStart: number;
}

/**
 * ปิดสปรินต์ — **ต้องบอกว่างานค้างไปไหน**
 *
 * `moveUndoneTo` เป็น `null` แปลว่าส่งกลับ backlog · เป็นรหัสสปรินต์
 * แปลว่าย้ายไปรอบนั้น · **ไม่มีค่าปริยาย** เพราะการเลือกให้เองแปลว่าวันหนึ่ง
 * จะมีคนกดปิดแล้วงานหายไปทางที่เขาไม่ได้ตั้งใจ
 */
export async function completeSprint(
  ctx: TenantContext,
  id: bigint,
  moveUndoneTo: bigint | null,
  now: UtcDate = systemClock.nowUtc(),
): Promise<CompleteResult> {
  const { projectId, name, snapshot, items } = await loadSprint(ctx, id);
  await assertCan(ctx, projectId, 'MANAGE_SPRINT');
  assertCanComplete(snapshot);

  if (moveUndoneTo !== null) {
    const target = await tenantScoped(ctx).sprint.findFirst({
      where: { id: moveUndoneTo, projectId },
      select: { id: true, state: true },
    });
    if (target === null) throw new SprintNotFoundError(moveUndoneTo);
  }

  const r = completionOf(snapshot, items, now);
  return auditedTransaction(ctx, 'sprint.complete', async (tx) => {
    /*
      ย้ายงานค้างก่อน แล้วค่อยปิด — ถ้าปิดก่อน แล้วการย้ายล้ม งานจะค้างอยู่ใน
      สปรินต์ที่ปิดไปแล้ว ซึ่งเป็นสถานะที่หน้าจอไม่มีที่แสดง
    */
    if (r.undoneIds.length > 0) {
      await tx.workItem.updateMany({
        where: { id: { in: r.undoneIds.map((x) => BigInt(x)) } },
        data: { sprintId: moveUndoneTo },
      });
    }
    await tx.sprint.update({
      where: { id },
      data: {
        state: 'completed',
        completedAt: now,
        completedCount: r.doneIds.length,
        completedPoints: r.completedPoints,
        addedAfterStart: r.addedAfterStartIds.length,
      },
    });
    return {
      result: {
        doneCount: r.doneIds.length,
        undoneCount: r.undoneIds.length,
        completedPoints: r.completedPoints,
        addedAfterStart: r.addedAfterStartIds.length,
      },
      audit: [
        {
          kind: 'system' as const,
          action: 'sprint.complete',
          entityType: 'sprint',
          entityId: id.toString(),
          payload: {
            name,
            done: r.doneIds.length,
            undone: r.undoneIds.length,
            completedPoints: r.completedPoints,
            addedAfterStart: r.addedAfterStartIds.length,
            removedAfterStart: r.removedAfterStartIds.length,
            movedUndoneTo: moveUndoneTo?.toString() ?? 'backlog',
          },
        },
      ],
    };
  });
}

/**
 * ย้ายงานเข้า/ออกสปรินต์
 *
 * `sprintId` เป็น `null` = ส่งกลับ backlog · งานที่อยู่สปรินต์อื่นอยู่แล้ว
 * จะ **ย้าย** ไม่ใช่อยู่สองที่ — ฐานข้อมูลบังคับอยู่แล้วเพราะเป็นคอลัมน์เดียว
 * แต่เขียนไว้เพราะเป็นสิ่งที่คนคาดหวังผิดบ่อย
 */
export async function moveItemToSprint(
  ctx: TenantContext,
  itemKey: string,
  sprintId: bigint | null,
): Promise<void> {
  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({
    where: { itemKey },
    select: { id: true, projectId: true, sprintId: true },
  });
  if (item === null) throw new ItemNotFoundForSprintError(itemKey);
  await assertCan(ctx, item.projectId, 'MANAGE_SPRINT');

  if (sprintId !== null) {
    const s = await db.sprint.findFirst({
      where: { id: sprintId },
      select: { id: true, projectId: true, state: true },
    });
    if (s === null) throw new SprintNotFoundError(sprintId);
    if (s.projectId !== item.projectId) throw new ItemFromOtherProjectError(itemKey);
    // สปรินต์ที่ปิดแล้วรับงานใหม่ไม่ได้ — ตัวเลขในรายงานจะเปลี่ยนย้อนหลัง
    // แต่สปรินต์ที่ยังไม่เริ่มรับได้ ซึ่งเป็นการเตรียมรอบถัดไปตามปกติ
    assertNotClosed({
      id: s.id.toString(),
      state: s.state as SprintSnapshot['state'],
      startedAt: null,
      completedAt: null,
      committedItemIds: [],
      committedPoints: 0,
    });
  }

  await auditedTransaction(ctx, 'sprint.move-item', async (tx) => {
    await tx.workItem.updateMany({ where: { id: item.id }, data: { sprintId } });
    return {
      result: undefined,
      audit: [
        change(
          item.id,
          'sprint',
          item.sprintId?.toString() ?? null,
          sprintId?.toString() ?? null,
        ),
      ],
    };
  });
}

/**
 * ตั้งแต้มของงาน
 *
 * `null` = ยังไม่ประเมิน ซึ่ง **ต่างจากประเมินแล้วได้ศูนย์** · ศูนย์แปลว่า
 * "ทำแล้วไม่มีขนาด" ส่วน `null` แปลว่า "ยังไม่มีใครดู"
 */
export async function setStoryPoints(
  ctx: TenantContext,
  itemKey: string,
  points: number | null,
): Promise<void> {
  if (points !== null && (!Number.isFinite(points) || points < 0)) {
    throw new InvalidStoryPointsError(points);
  }

  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({
    where: { itemKey },
    select: { id: true, projectId: true, storyPoints: true },
  });
  if (item === null) throw new ItemNotFoundForSprintError(itemKey);
  await assertCan(ctx, item.projectId, 'EDIT_ITEM');

  await auditedTransaction(ctx, 'sprint.points', async (tx) => {
    await tx.workItem.updateMany({ where: { id: item.id }, data: { storyPoints: points } });
    return {
      result: undefined,
      audit: [
        change(
          item.id,
          'storyPoints',
          num(item.storyPoints)?.toString() ?? null,
          points?.toString() ?? null,
        ),
      ],
    };
  });
}

/** ความเร็วของทีมในโปรเจกต์นี้ */
export async function velocityFor(ctx: TenantContext, projectKey: string): Promise<Velocity> {
  const projectId = await projectOf(ctx, projectKey);
  await assertCan(ctx, projectId, 'VIEW_REPORT');

  const rows = await tenantScoped(ctx).sprint.findMany({
    where: { projectId },
    orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      state: true,
      startedAt: true,
      completedAt: true,
      committedPoints: true,
      completedPoints: true,
    },
  });

  return velocityOf(
    rows.map((r) => toSnapshot(r)),
    rows
      .filter((r) => r.completedPoints !== null)
      .map((r) => ({ sprintId: r.id.toString(), completedPoints: num(r.completedPoints) ?? 0 })),
    VELOCITY_WINDOW,
  );
}
