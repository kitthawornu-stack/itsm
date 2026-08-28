/**
 * ตั้ง SLA Policy และ Goal จากหน้าจอ
 *
 * เอกสารสถานะระบุมาตลอดว่าส่วนนี้ยังต้องใช้ SQL · ส่วนนี้อันตรายกว่าที่อื่น
 * เพราะ **ความผิดพลาดไม่ทำให้ระบบพัง แต่ทำให้ระบบตอบผิดอย่างเงียบ ๆ**
 * ตัวเลขบนหน้าคิวยังขึ้นเหมือนเดิม แค่ผิด
 *
 * กติกาที่บังคับในไฟล์นี้ทั้งหมดมาจากพฤติกรรมจริงของเอนจิน ไม่ใช่ความชอบ:
 * เอนจินไล่ goal ตาม `position` แล้วใช้ **ตัวแรกที่เข้าเงื่อนไข**
 */
import { systemClock, type TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { Prisma, tenantScoped } from '../../infrastructure/prisma/tenant-scope';

export class PolicyAlreadyExistsError extends Error {
  constructor(readonly existing: string) {
    super(
      `โปรเจกต์นี้มีนโยบาย "${existing}" อยู่แล้ว — ` +
        'หนึ่งโปรเจกต์มีได้นโยบายเดียว แก้ของเดิมแทนการสร้างใหม่',
    );
    this.name = 'PolicyAlreadyExistsError';
  }
}

export class PolicyNotFoundError extends Error {
  constructor() {
    super('ไม่พบนโยบาย SLA ของโปรเจกต์นี้');
    this.name = 'PolicyNotFoundError';
  }
}

export class GoalNotFoundError extends Error {
  constructor() {
    super('ไม่พบเป้าหมายที่เลือก');
    this.name = 'GoalNotFoundError';
  }
}

export class InvalidTargetError extends Error {
  constructor(readonly given: number) {
    // เป้า 0 นาที = ทุกใบหลุดทันทีที่เปิด และไม่มีอะไรบนหน้าจอบอกว่าทำไม
    super('เป้าหมายเวลาต้องเป็นจำนวนเต็มนาทีที่มากกว่าศูนย์');
    this.name = 'InvalidTargetError';
  }
}

/**
 * เป้าที่ไม่มีเงื่อนไขต้องอยู่ท้ายสุด
 *
 * เอนจินใช้ **ตัวแรกที่เข้าเงื่อนไข** และเป้าที่ไม่มีเงื่อนไขเข้าเสมอ
 * วางไว้หน้าเมื่อไร เป้าที่เหลือทั้งหมดกลายเป็นโค้ดที่ไปไม่ถึง —
 * ตั้งไว้แล้วไม่มีผล ซึ่งอ่านบนหน้าจอเหมือนตั้งค่าเรียบร้อยแล้ว
 */
export class CatchAllMustBeLastError extends Error {
  constructor() {
    super('เป้าที่ไม่มีเงื่อนไขต้องอยู่ท้ายสุด — ถ้าอยู่หน้า เป้าที่เหลือจะไม่มีวันถูกใช้');
    this.name = 'CatchAllMustBeLastError';
  }
}

export class GoalInUseError extends Error {
  constructor(readonly clocks: number) {
    super(`ลบไม่ได้ — มีนาฬิกาผูกกับเป้านี้อยู่ ${clocks.toLocaleString('th-TH')} เรือน`);
    this.name = 'GoalInUseError';
  }
}

const MINUTE_MS = 60_000;

function assertTarget(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes <= 0) throw new InvalidTargetError(minutes);
}

/**
 * สร้างนโยบายของโปรเจกต์
 *
 * **หนึ่งโปรเจกต์หนึ่งนโยบาย** — `describeSlaPolicy` ใช้ `findFirst`
 * ใบที่สองจึงถูกมองข้ามเงียบ ๆ ผู้ดูแลจะแก้ใบที่ระบบไม่ได้ใช้ แล้วงงว่า
 * ทำไมไม่มีอะไรเปลี่ยน · สคีมาอนุญาตหลายใบ (unique ที่ชื่อ) จึงต้องกันที่นี่
 */
export async function createSlaPolicy(
  ctx: TenantContext,
  projectId: bigint,
  name: string,
  calendarId: bigint,
): Promise<{ id: bigint }> {
  const db = tenantScoped(ctx);
  const existing = await db.slaPolicy.findFirst({
    where: { projectId },
    select: { name: true },
  });
  if (existing !== null) throw new PolicyAlreadyExistsError(existing.name);

  const cal = await db.slaCalendar.findFirst({ where: { id: calendarId }, select: { id: true } });
  if (cal === null) throw new GoalNotFoundError();

  const trimmed = name.trim().slice(0, 255);
  if (trimmed === '') throw new InvalidTargetError(0);

  return auditedTransaction(ctx, 'sla.policy.create', async (tx) => {
    const row = await tx.slaPolicy.create({
      data: { tenantId: ctx.tenantId, projectId, name: trimmed, calendarId },
      select: { id: true },
    });
    return {
      result: row,
      audit: [
        {
          kind: 'system',
          action: 'sla.policy.create',
          entityType: 'sla_policy',
          entityId: row.id.toString(),
          payload: { name: trimmed, projectId: projectId.toString() },
        },
      ],
    };
  });
}

export interface AddGoalInput {
  key: string;
  name: string;
  targetMinutes: number;
  priorityRanks?: number[];
  issueTypeNames?: string[];
}

/**
 * เพิ่มเป้าหมาย
 *
 * **แทรกก่อน catch-all เสมอ** — ถ้าต่อท้ายเฉย ๆ เป้าใหม่จะอยู่หลังเป้าที่
 * ไม่มีเงื่อนไข แล้วไม่มีวันถูกใช้ · ผู้ดูแลจะเห็นเป้าบนหน้าจอครบทุกข้อ
 * แต่ระบบใช้แค่ข้อเดียว
 */
export async function addSlaGoal(
  ctx: TenantContext,
  policyId: bigint,
  input: AddGoalInput,
): Promise<{ id: bigint }> {
  assertTarget(input.targetMinutes);
  const db = tenantScoped(ctx);
  const policy = await db.slaPolicy.findFirst({ where: { id: policyId }, select: { id: true } });
  if (policy === null) throw new PolicyNotFoundError();

  const ranks = (input.priorityRanks ?? []).filter((r) => Number.isInteger(r));
  const types = (input.issueTypeNames ?? []).map((t) => t.trim()).filter((t) => t !== '');
  const isCatchAll = ranks.length === 0 && types.length === 0;
  /*
    `Prisma.DbNull` ไม่ใช่ `null` — Prisma แยก "ค่า JSON ที่เป็น null"
    ออกจาก "คอลัมน์เป็น NULL" · เอนจินเช็ก `match === null` ซึ่งหมายถึงอย่างหลัง
    ถ้าเขียน JSON null ลงไป เป้านั้นจะไม่ถูกมองว่าเป็น catch-all
    แล้วงานที่ไม่เข้าเงื่อนไขไหนเลยจะไม่มีนาฬิกา SLA — เงียบสนิท
  */
  const match = isCatchAll
    ? Prisma.DbNull
    : {
        ...(ranks.length > 0 ? { priorityRanks: ranks } : {}),
        ...(types.length > 0 ? { issueTypeNames: types } : {}),
      };

  const goals = await db.slaGoal.findMany({
    where: { policyId },
    orderBy: { position: 'asc' },
    select: { id: true, position: true, match: true },
  });

  /*
    ตำแหน่งของเป้าใหม่:
      · catch-all  → ท้ายสุดเสมอ
      · มีเงื่อนไข → ก่อน catch-all ตัวแรกที่เจอ (ถ้ามี) มิฉะนั้นท้ายสุด
  */
  const firstCatchAll = goals.find((g) => g.match === null);
  const position =
    isCatchAll || firstCatchAll === undefined
      ? (goals[goals.length - 1]?.position ?? 0) + 1
      : firstCatchAll.position;

  return auditedTransaction(ctx, 'sla.goal.add', async (tx) => {
    // เลื่อนตัวที่อยู่ตั้งแต่ตำแหน่งนั้นลงไปหนึ่งช่อง — ไล่จากท้ายมาหน้า
    // เพื่อไม่ให้ชน unique([policyId, key, position]) ระหว่างทาง
    const toShift = goals.filter((g) => g.position >= position).reverse();
    for (const g of toShift) {
      await tx.slaGoal.update({ where: { id: g.id }, data: { position: g.position + 1 } });
    }

    const row = await tx.slaGoal.create({
      data: {
        tenantId: ctx.tenantId,
        policyId,
        key: input.key.trim().slice(0, 64),
        name: input.name.trim().slice(0, 255),
        targetMs: input.targetMinutes * MINUTE_MS,
        position,
        match,
      },
      select: { id: true },
    });
    return {
      result: row,
      audit: [
        {
          kind: 'system',
          action: 'sla.goal.add',
          entityType: 'sla_goal',
          entityId: row.id.toString(),
          payload: { name: input.name, targetMinutes: input.targetMinutes, match },
        },
      ],
    };
  });
}

/** สลับลำดับเป้าขึ้นหรือลงหนึ่งช่อง — catch-all ต้องอยู่ท้ายสุดเสมอ */
export async function moveSlaGoal(
  ctx: TenantContext,
  goalId: bigint,
  direction: 'up' | 'down',
): Promise<void> {
  const db = tenantScoped(ctx);
  const goal = await db.slaGoal.findFirst({ where: { id: goalId } });
  if (goal === null) throw new GoalNotFoundError();

  const siblings = await db.slaGoal.findMany({
    where: { policyId: goal.policyId },
    orderBy: { position: 'asc' },
  });
  const at = siblings.findIndex((g) => g.id === goal.id);
  const swapWith = direction === 'up' ? siblings[at - 1] : siblings[at + 1];
  if (swapWith === undefined) return;

  // catch-all ขึ้นไม่ได้ และเป้าที่มีเงื่อนไขลงมาต่ำกว่า catch-all ก็ไม่ได้
  if (goal.match === null && direction === 'up') throw new CatchAllMustBeLastError();
  if (swapWith.match === null && direction === 'down') throw new CatchAllMustBeLastError();

  await auditedTransaction(ctx, 'sla.goal.move', async (tx) => {
    /*
      สลับผ่านตำแหน่งชั่วคราว — `unique([policyId, key, position])` จะชน
      ถ้าเขียนค่าใหม่ทับกันตรง ๆ ระหว่างสองแถวที่มี key เดียวกัน
    */
    const parked = -1 - goal.position;
    await tx.slaGoal.update({ where: { id: goal.id }, data: { position: parked } });
    await tx.slaGoal.update({ where: { id: swapWith.id }, data: { position: goal.position } });
    await tx.slaGoal.update({ where: { id: goal.id }, data: { position: swapWith.position } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'sla.goal.move',
          entityType: 'sla_goal',
          entityId: goal.id.toString(),
          payload: { name: goal.name, direction },
        },
      ],
    };
  });
}

/**
 * แก้เป้าหมายเวลา
 *
 * คืนจำนวนงานที่เปิดอยู่ซึ่งผูกกับเป้านี้ — **เอนจินคำนวณใหม่จากรายการเหตุการณ์
 * ทุกครั้ง** เป้าใหม่จึงเปลี่ยนผลของอดีต งานที่เคยอยู่ในเกณฑ์อาจกลายเป็นหลุด
 * ทันทีที่กดบันทึก · ผู้ดูแลต้องรู้ก่อน ไม่ใช่รู้ตอนมีคนมาถามว่าทำไมแดงหมด
 */
export async function updateSlaGoalTarget(
  ctx: TenantContext,
  goalId: bigint,
  targetMinutes: number,
): Promise<{ affectedOpenItems: number }> {
  assertTarget(targetMinutes);
  const db = tenantScoped(ctx);
  const goal = await db.slaGoal.findFirst({ where: { id: goalId } });
  if (goal === null) throw new GoalNotFoundError();

  const affectedOpenItems = await db.workItemSla.count({
    where: { goalId, workItem: { resolvedAt: null } },
  });

  await auditedTransaction(ctx, 'sla.goal.target', async (tx) => {
    await tx.slaGoal.update({
      where: { id: goalId },
      data: { targetMs: targetMinutes * MINUTE_MS },
    });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'sla.goal.target',
          entityType: 'sla_goal',
          entityId: goalId.toString(),
          payload: {
            name: goal.name,
            fromMinutes: Math.round(goal.targetMs / MINUTE_MS),
            toMinutes: targetMinutes,
            affectedOpenItems,
          },
        },
      ],
    };
  });
  return { affectedOpenItems };
}

/**
 * ลบเป้า
 *
 * ฐานข้อมูลกันไว้ด้วย `onDelete: Restrict` อยู่แล้ว แต่ error ของ FK อ่านไม่ออก
 * และไม่บอกว่ามีนาฬิกากี่เรือน ซึ่งเป็นสิ่งเดียวที่ผู้ดูแลต้องรู้เพื่อตัดสินใจ
 */
export async function removeSlaGoal(ctx: TenantContext, goalId: bigint): Promise<void> {
  const db = tenantScoped(ctx);
  const goal = await db.slaGoal.findFirst({ where: { id: goalId } });
  if (goal === null) throw new GoalNotFoundError();

  const clocks = await db.workItemSla.count({ where: { goalId } });
  if (clocks > 0) throw new GoalInUseError(clocks);

  await auditedTransaction(ctx, 'sla.goal.remove', async (tx) => {
    await tx.slaGoal.delete({ where: { id: goalId } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'sla.goal.remove',
          entityType: 'sla_goal',
          entityId: goalId.toString(),
          payload: { name: goal.name },
        },
      ],
    };
  });
  void systemClock;
}
