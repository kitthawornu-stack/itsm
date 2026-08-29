/**
 * จัดการกฎอัตโนมัติจากหน้าจอ
 *
 * ## กฎที่บันทึกลงไปแล้วไม่ทำงาน คือความเสียหายที่ตามยากที่สุด
 *
 * `conditions` และ `actions` เก็บเป็น JSON ฐานข้อมูลจึงตรวจให้ไม่ได้ ·
 * ถ้าไฟล์นี้ยอมรับ `{"kind":"assgin"}` ที่พิมพ์ผิด กฎจะถูกบันทึก แสดงบนหน้าจอ
 * เหมือนกฎปกติ และ**ไม่ทำอะไรเลยตลอดไป** โดยไม่มี error สักบรรทัด
 *
 * ผู้ดูแลจะสรุปว่า "ระบบอัตโนมัติใช้ไม่ได้" แล้วเลิกใช้ทั้งชุด — ซึ่งแย่กว่า
 * การถูกปฏิเสธตอนกดบันทึกอย่างเทียบกันไม่ได้
 *
 * **ทุกค่าจึงตรวจกับรายการของเอนจินเอง** (`TRIGGERS` · `CONDITION_FIELDS` ·
 * `ACTION_KINDS`) ไม่ใช่กับรายการที่คัดลอกมาไว้ที่นี่ — รายการที่คัดลอกมา
 * จะไม่ตรงกันในวันที่มีคนแก้แค่ฝั่งเดียว
 *
 * ## เตือนเรื่องกฎที่ปลุกตัวเอง แต่ไม่ห้าม
 *
 * กฎที่ทำงานเมื่อ "สถานะเปลี่ยน" แล้วสั่ง "เปลี่ยนสถานะ" มีเจตนาที่ถูกต้องอยู่
 * ("ปิดงานแล้วให้ปิดงานลูกด้วย") การห้ามจึงผิด · แต่ผู้ดูแลควรรู้ว่าตัวเอง
 * กำลังเขียนอะไร — จึงคืนคำเตือนไปให้หน้าจอแสดง และเอนจินยังหยุดที่เพดานอยู่ดี
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertTenantAdmin } from '../permission';
import { readActions, readConditions } from './automation.service';
import {
  ACTION_KINDS,
  CONDITION_FIELDS,
  CONDITION_OPS,
  MAX_DEPTH,
  TRIGGERS,
  type Action,
  type Condition,
  type TriggerKind,
} from './automation-engine';

export class RuleNotFoundError extends Error {
  constructor(id: bigint) {
    super(`ไม่พบกฎ #${id.toString()}`);
    this.name = 'RuleNotFoundError';
  }
}

export class InvalidRuleError extends Error {
  constructor(readonly problem: string) {
    super(problem);
    this.name = 'InvalidRuleError';
  }
}

export class DuplicateRuleNameError extends Error {
  constructor(readonly given: string) {
    super(`มีกฎชื่อ "${given}" อยู่แล้ว`);
    this.name = 'DuplicateRuleNameError';
  }
}

export interface RuleInput {
  name: string;
  trigger: string;
  projectKey?: string | null;
  isEnabled?: boolean;
  sortOrder?: number;
  conditions: readonly { field?: unknown; op?: unknown; value?: unknown }[];
  actions: readonly { kind?: unknown; value?: unknown }[];
}

export interface RuleView {
  id: string;
  name: string;
  trigger: string;
  projectKey: string | null;
  isEnabled: boolean;
  sortOrder: number;
  conditions: Condition[];
  actions: Action[];
  /** ผลของกฎครั้งล่าสุด — ว่างแปลว่ายังไม่เคยทำงานเลย ซึ่งเป็นข้อมูลสำคัญ */
  lastRun: { at: string; outcome: string; reason: string | null } | null;
  warnings: string[];
}

/** ตัวเลือกที่หน้าจอเอาไปสร้างฟอร์ม — มาจากเอนจิน ไม่ใช่จากรายการที่พิมพ์ซ้ำ */
export function ruleVocabulary(): {
  triggers: readonly TriggerKind[];
  fields: readonly Condition['field'][];
  ops: readonly Condition['op'][];
  actions: readonly Action['kind'][];
  maxDepth: number;
} {
  return {
    triggers: TRIGGERS,
    fields: CONDITION_FIELDS,
    ops: CONDITION_OPS,
    actions: ACTION_KINDS,
    maxDepth: MAX_DEPTH,
  };
}

/**
 * รับเฉพาะสตริง · อย่างอื่นกลายเป็นค่าว่างแล้วถูกปฏิเสธพร้อมเหตุผล
 *
 * ไม่ใช้ `String(v)` เพราะ object จะกลายเป็น `"[object Object]"` แล้วผ่าน
 * การตรวจ "ไม่ว่าง" ไปได้ — ข้อความ error จะพูดถึงค่าที่ผู้ใช้ไม่เคยส่งมา
 */
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function cleanName(given: string): string {
  const name = given.trim();
  if (name === '') throw new InvalidRuleError('ต้องตั้งชื่อกฎ');
  if (name.length > 128) throw new InvalidRuleError('ชื่อกฎยาวเกิน 128 ตัวอักษร');
  return name;
}

/**
 * ตรวจรูปร่างของกฎกับรายการที่เอนจินรู้จักจริง
 *
 * ปฏิเสธทั้งใบ ไม่ตัดข้อที่ผิดทิ้งเงียบ ๆ — การตัดเงียบทำให้ผู้ดูแลเชื่อว่า
 * บันทึกครบแล้ว ทั้งที่เงื่อนไขหายไปหนึ่งข้อ ซึ่งกลับความหมายของกฎได้ทั้งข้อ
 */
function validate(input: RuleInput): { conditions: Condition[]; actions: Action[] } {
  if (!TRIGGERS.includes(input.trigger as TriggerKind)) {
    throw new InvalidRuleError(
      `ไม่รู้จักเหตุการณ์ "${input.trigger}" — มีให้เลือก: ${TRIGGERS.join(', ')}`,
    );
  }

  const conditions = input.conditions.map((c, i) => {
    const at = `เงื่อนไขข้อที่ ${String(i + 1)}`;
    const field = asString(c.field);
    const op = asString(c.op);
    const value = asString(c.value);
    if (!CONDITION_FIELDS.includes(field as Condition['field'])) {
      throw new InvalidRuleError(`${at}: ไม่รู้จักฟิลด์ "${field}"`);
    }
    if (!CONDITION_OPS.includes(op as Condition['op'])) {
      throw new InvalidRuleError(`${at}: ไม่รู้จักการเปรียบเทียบ "${op}"`);
    }
    /*
      ค่าว่างไม่ใช่เงื่อนไข · `is` กับค่าว่างจะไม่ตรงกับอะไรเลยตลอดกาล
      ซึ่งอ่านบนหน้าจอเหมือนเงื่อนไขปกติทุกอย่าง
    */
    if (value.trim() === '') throw new InvalidRuleError(`${at}: ต้องระบุค่าที่จะเทียบ`);
    /*
      `at-least` เทียบตัวเลขเท่านั้น · เกณฑ์ที่ไม่ใช่ตัวเลขทำให้เงื่อนไขเป็นเท็จ
      ตลอดกาล — กฎจะถูกบันทึก แสดงบนหน้าจอเหมือนกฎปกติ แล้วเงียบตลอดไป
      ปฏิเสธตั้งแต่ตอนบันทึกจึงเป็นทางเดียวที่ผู้ดูแลจะรู้
    */
    if (op === 'at-least' && !Number.isFinite(Number(value.trim()))) {
      throw new InvalidRuleError(`${at}: "${value.trim()}" ไม่ใช่ตัวเลข — "อย่างน้อย" เทียบได้เฉพาะตัวเลข`);
    }
    return { field, op, value: value.trim() } as Condition;
  });

  if (input.actions.length === 0) {
    throw new InvalidRuleError('กฎที่ไม่มีการกระทำ จะทำงานทุกครั้งโดยไม่เกิดอะไรขึ้น');
  }
  const actions = input.actions.map((a, i) => {
    const at = `การกระทำข้อที่ ${String(i + 1)}`;
    const kind = asString(a.kind);
    const value = asString(a.value);
    if (!ACTION_KINDS.includes(kind as Action['kind'])) {
      throw new InvalidRuleError(
        `${at}: ไม่รู้จักการกระทำ "${kind}" — มีให้เลือก: ${ACTION_KINDS.join(', ')}`,
      );
    }
    if (value.trim() === '') throw new InvalidRuleError(`${at}: ต้องระบุค่า`);
    return { kind, value: value.trim() } as Action;
  });

  return { conditions, actions };
}

/** สิ่งที่ควรรู้ก่อนเปิดกฎ — เตือน ไม่ห้าม */
function warningsFor(trigger: string, conditions: Condition[], actions: Action[]): string[] {
  const out: string[] = [];
  if (trigger === 'item.transitioned' && actions.some((a) => a.kind === 'transition')) {
    out.push(
      `กฎนี้ทำงานเมื่อสถานะเปลี่ยน แล้วสั่งเปลี่ยนสถานะ — มันจะปลุกตัวเอง · ` +
        `ระบบหยุดให้ที่ ${String(MAX_DEPTH)} ชั้น แต่ควรใส่เงื่อนไขกันไว้เองด้วย`,
    );
  }
  if (conditions.length === 0) {
    out.push('ไม่มีเงื่อนไขเลย — กฎนี้จะทำงานกับทุกเรื่องที่เกิดเหตุการณ์นี้');
  }
  if (trigger === 'item.idle' && !conditions.some((c) => c.field === 'idleDays')) {
    /*
      กฎที่ปลุกตามเวลาต่างจากกฎอื่นตรงที่ **ไม่มีใครเป็นคนจุดชนวน** · กฎที่
      ไม่ระบุจำนวนวันจะทำงานกับทุกเรื่องที่ยังเปิดอยู่ในรอบกวาดรอบเดียว
      ซึ่งอาจเป็นพันใบ และผู้ดูแลจะไม่ได้เห็นมันมาก่อนเลย
    */
    out.push('ยังไม่ได้ระบุจำนวนวัน — กฎนี้จะทำงานกับทุกเรื่องที่ยังเปิดอยู่ในรอบกวาดรอบเดียว');
  }
  return out;
}

async function projectIdOf(ctx: TenantContext, key: string | null | undefined): Promise<bigint | null> {
  if (key === null || key === undefined || key.trim() === '') return null;
  const p = await tenantScoped(ctx).project.findFirst({
    where: { key: key.trim() },
    select: { id: true },
  });
  if (p === null) throw new InvalidRuleError(`ไม่พบโปรเจกต์ "${key}"`);
  return p.id;
}

export async function listRules(ctx: TenantContext): Promise<RuleView[]> {
  await assertTenantAdmin(ctx);
  const rows = await tenantScoped(ctx).automationRule.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      trigger: true,
      isEnabled: true,
      sortOrder: true,
      conditions: true,
      actions: true,
      project: { select: { key: true } },
      runs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true, outcome: true, reason: true },
      },
    },
  });

  return rows.map((r) => {
    // อ่านด้วยตัวเดียวกับที่ตัวลงมือทำใช้ — หน้าจอต้องเห็นสิ่งที่กฎจะทำจริง
    // ไม่ใช่สิ่งที่ JSON เขียนไว้ · สองตัวอ่านที่ต่างกันคือสองความจริงที่ต่างกัน
    const conditions = readConditions(r.conditions);
    const actions = readActions(r.actions);
    const last = r.runs[0];
    return {
      id: r.id.toString(),
      name: r.name,
      trigger: r.trigger,
      projectKey: r.project?.key ?? null,
      isEnabled: r.isEnabled,
      sortOrder: r.sortOrder,
      conditions,
      actions,
      lastRun:
        last === undefined
          ? null
          : { at: last.createdAt.toISOString(), outcome: last.outcome, reason: last.reason },
      warnings: warningsFor(r.trigger, conditions, actions),
    };
  });
}

export async function createRule(ctx: TenantContext, input: RuleInput): Promise<{ id: string }> {
  await assertTenantAdmin(ctx);
  const name = cleanName(input.name);
  const { conditions, actions } = validate(input);
  const projectId = await projectIdOf(ctx, input.projectKey);

  const clash = await tenantScoped(ctx).automationRule.findFirst({
    where: { name },
    select: { id: true },
  });
  if (clash !== null) throw new DuplicateRuleNameError(name);

  return auditedTransaction(ctx, 'automation.rule.create', async (tx) => {
    const rule = await tx.automationRule.create({
      data: {
        tenantId: ctx.tenantId,
        projectId,
        name,
        trigger: input.trigger,
        /*
          **ปิดไว้เสมอตอนสร้าง แม้หน้าจอจะส่ง true มา**

          กฎที่เพิ่งพิมพ์เสร็จยังไม่มีใครอ่านทวน · การเปิดพร้อมสร้างแปลว่า
          กฎที่ผิดเริ่มแตะตั๋วจริงในวินาทีเดียวกับที่พิมพ์ผิด · การเปิดเป็น
          การกระทำแยกที่มี audit ของตัวเอง จึงตอบได้ว่าใครเป็นคนเปิด
        */
        isEnabled: false,
        sortOrder: input.sortOrder ?? 0,
        conditions: conditions as never,
        actions: actions as never,
        createdById: ctx.actorId,
      },
      select: { id: true },
    });
    return {
      result: { id: rule.id.toString() },
      audit: [
        {
          kind: 'system' as const,
          action: 'automation.rule.create',
          entityType: 'automation_rule',
          entityId: rule.id.toString(),
          payload: { name, trigger: input.trigger, conditions, actions },
        },
      ],
    };
  });
}

export async function updateRule(
  ctx: TenantContext,
  id: bigint,
  input: RuleInput,
): Promise<{ id: string; warnings: string[] }> {
  await assertTenantAdmin(ctx);
  const db = tenantScoped(ctx);
  const before = await db.automationRule.findFirst({
    where: { id },
    select: { id: true, name: true, trigger: true, conditions: true, actions: true },
  });
  if (before === null) throw new RuleNotFoundError(id);

  const name = cleanName(input.name);
  const { conditions, actions } = validate(input);
  const projectId = await projectIdOf(ctx, input.projectKey);

  const clash = await db.automationRule.findFirst({
    where: { name, id: { not: id } },
    select: { id: true },
  });
  if (clash !== null) throw new DuplicateRuleNameError(name);

  return auditedTransaction(ctx, 'automation.rule.update', async (tx) => {
    await tx.automationRule.update({
      where: { id },
      data: {
        projectId,
        name,
        trigger: input.trigger,
        sortOrder: input.sortOrder ?? 0,
        conditions: conditions as never,
        actions: actions as never,
      },
    });
    return {
      result: { id: id.toString(), warnings: warningsFor(input.trigger, conditions, actions) },
      audit: [
        {
          kind: 'system' as const,
          action: 'automation.rule.update',
          entityType: 'automation_rule',
          entityId: id.toString(),
          // เก็บทั้งก่อนและหลัง — "แก้อะไรไป" ตอบไม่ได้ถ้าเก็บแต่ค่าใหม่
          payload: {
            before: { name: before.name, trigger: before.trigger, actions: before.actions },
            after: { name, trigger: input.trigger, actions },
          },
        },
      ],
    };
  });
}

/** เปิด/ปิดกฎ — แยกจากการแก้ เพราะเป็นคำถามคนละข้อและต้องตอบได้ว่าใครเปิด */
export async function setRuleEnabled(
  ctx: TenantContext,
  id: bigint,
  isEnabled: boolean,
): Promise<{ id: string; isEnabled: boolean }> {
  await assertTenantAdmin(ctx);
  const before = await tenantScoped(ctx).automationRule.findFirst({
    where: { id },
    select: { name: true, isEnabled: true },
  });
  if (before === null) throw new RuleNotFoundError(id);

  return auditedTransaction(ctx, 'automation.rule.toggle', async (tx) => {
    await tx.automationRule.update({ where: { id }, data: { isEnabled } });
    return {
      result: { id: id.toString(), isEnabled },
      audit: [
        {
          kind: 'system' as const,
          action: isEnabled ? 'automation.rule.enable' : 'automation.rule.disable',
          entityType: 'automation_rule',
          entityId: id.toString(),
          payload: { name: before.name, from: before.isEnabled, to: isEnabled },
        },
      ],
    };
  });
}

/**
 * ลบกฎ
 *
 * ประวัติการทำงานไม่หายไปด้วย — `automation_run.rule_id` เป็น `SetNull`
 * และเก็บ `ruleName` ไว้ในแถวแล้ว · "ตั๋วใบนี้ถูกกฎอะไรแตะ" ต้องตอบได้
 * แม้กฎนั้นจะถูกลบไปแล้ว มิฉะนั้นการลบกฎกลายเป็นการลบหลักฐาน
 */
export async function deleteRule(ctx: TenantContext, id: bigint): Promise<{ deleted: string }> {
  await assertTenantAdmin(ctx);
  const before = await tenantScoped(ctx).automationRule.findFirst({
    where: { id },
    select: { name: true },
  });
  if (before === null) throw new RuleNotFoundError(id);

  return auditedTransaction(ctx, 'automation.rule.delete', async (tx) => {
    await tx.automationRule.delete({ where: { id } });
    return {
      result: { deleted: before.name },
      audit: [
        {
          kind: 'system' as const,
          action: 'automation.rule.delete',
          entityType: 'automation_rule',
          entityId: id.toString(),
          payload: { name: before.name },
        },
      ],
    };
  });
}

export interface RunView {
  at: string;
  ruleName: string;
  itemKey: string | null;
  trigger: string;
  actionKind: string;
  actionValue: string;
  outcome: string;
  reason: string | null;
}

/**
 * ประวัติล่าสุดของระบบอัตโนมัติ
 *
 * เป็นหน้าจอที่ตอบคำถาม "ทำไมกฎไม่ทำงาน" ซึ่งผู้ดูแลถามบ่อยกว่าคำถามตรงข้าม ·
 * จึงแสดง `failed` และ `skipped` ปนกับ `applied` ไม่ใช่โชว์แต่ที่สำเร็จ
 */
export async function listRuns(ctx: TenantContext, limit = 50): Promise<RunView[]> {
  await assertTenantAdmin(ctx);
  const rows = await tenantScoped(ctx).automationRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
    select: {
      createdAt: true,
      ruleName: true,
      trigger: true,
      actionKind: true,
      actionValue: true,
      outcome: true,
      reason: true,
      workItem: { select: { itemKey: true } },
    },
  });
  return rows.map((r) => ({
    at: r.createdAt.toISOString(),
    ruleName: r.ruleName,
    itemKey: r.workItem?.itemKey ?? null,
    trigger: r.trigger,
    actionKind: r.actionKind,
    actionValue: r.actionValue,
    outcome: r.outcome,
    reason: r.reason,
  }));
}
