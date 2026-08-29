/**
 * ตัวลงมือทำของกฎอัตโนมัติ
 *
 * เอนจิน (`automation-engine.ts`) ตอบว่า "ควรทำอะไร" · ไฟล์นี้ลงมือทำจริง
 * และ **บันทึกทุกครั้งว่าเกิดอะไรขึ้น รวมถึงครั้งที่ไม่ได้ทำ**
 *
 * ## จองก่อนทำ ไม่ใช่บันทึกหลังทำ
 *
 * แถว `automation_run` ถูกสร้างด้วยสถานะ `pending` **ก่อน** เรียก service ใด ๆ
 * (กติกาเดียวกับ `notification_delivery`) · เครื่องที่ดับกลางทางต้องทิ้งร่องรอย
 * ว่าเคยตั้งใจทำอะไร ไม่ใช่เงียบไปเหมือนไม่เคยมีกฎอยู่
 *
 * ## ล้มทีละใบ ไม่ล้มทั้งรอบ
 *
 * กฎหนึ่งที่พัง (ผู้รับผิดชอบถูกลบ · ปุ่มถูกถอดจาก workflow) ต้องไม่ทำให้
 * กฎอีกสี่ข้อไม่ทำงาน · แต่ละการกระทำจับ error ของตัวเองแล้วบันทึกเป็น `failed`
 *
 * ## ทำงานด้วยสิทธิ์ของตัวเอง ไม่ใช่ของคนที่เผลอปลุกมัน
 *
 * ระบบอัตโนมัติเรียก service ตัวเดียวกับที่คนเรียก และ service เหล่านั้น
 * ตรวจสิทธิ์ทุกครั้ง · ผู้ใช้ระบบของ Automation จึงต้องอยู่ในกลุ่มที่มีสิทธิ์จริง
 * (CLAUDE.md — ให้สิทธิ์ผ่านกลุ่มเท่านั้น) · ถ้าไม่มี การกระทำจะถูกบันทึกเป็น
 * `failed` พร้อมเหตุผล — **มองเห็นได้ ไม่ใช่เงียบ** ซึ่งต่างจากการให้มันข้าม
 * การตรวจสิทธิ์ไปเลย ที่จะทำให้กฎทำสิ่งที่ไม่มีใครมีสิทธิ์ทำ
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { applyTransition, availableTransitions } from '../workflow';
import { addComment, assignWorkItem, bulkEditLabels, labelFields } from '../workitem';
import {
  plan,
  type AutomationEvent,
  type Condition,
  type PlannedAction,
  type Rule,
  type TriggerKind,
} from './automation-engine';

export type RunOutcome = 'pending' | 'applied' | 'skipped' | 'failed';

export interface RunRecord {
  ruleName: string;
  actionKind: string;
  outcome: RunOutcome;
  reason: string | null;
}

export interface AutomationResult {
  traceId: string;
  runs: RunRecord[];
}

/**
 * แปลงแถวในฐานข้อมูลเป็นกฎที่เอนจินอ่านได้
 *
 * JSON ที่รูปร่างไม่ถูกต้องต้องกลายเป็น **กฎที่ไม่มีการกระทำ** ไม่ใช่โยน error
 * ทิ้งทั้งรอบ — กฎเสียหนึ่งข้อไม่ควรทำให้ที่เหลือเงียบ · และกฎที่ไม่มีการกระทำ
 * ไม่ผลิตอะไรออกมาอยู่แล้ว จึงปลอดภัยโดยตัวมันเอง
 */
function toRule(row: {
  id: bigint;
  name: string;
  trigger: string;
  isEnabled: boolean;
  conditions: unknown;
  actions: unknown;
}): Rule {
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    id: row.id.toString(),
    name: row.name,
    trigger: row.trigger as TriggerKind,
    isEnabled: row.isEnabled,
    conditions: arr(row.conditions).map((c) => {
      const o = c as Record<string, unknown>;
      return { field: str(o.field), op: str(o.op), value: str(o.value) } as Condition;
    }),
    actions: arr(row.actions).map((a) => {
      const o = a as Record<string, unknown>;
      return { kind: str(o.kind), value: str(o.value) } as Rule['actions'][number];
    }),
  };
}

/**
 * รหัสรอบ — ใช้เป็น `traceId` ของทุก mutation ที่รอบนี้ทำ
 *
 * ทำให้ join จาก `automation_run` ไป `work_item_history` ได้ตรงแถว คำถาม
 * "กฎข้อไหนเปลี่ยนสถานะใบนี้" จึงตอบได้ด้วยคิวรีเดียว ไม่ใช่ด้วยการเดาจาก
 * เวลาที่ใกล้กัน ซึ่งผิดทันทีที่มีสองรอบทำงานพร้อมกัน
 */
function newTraceId(now: UtcDate, itemKey: string, depth: number): string {
  return `auto-${String(now.getTime())}-${itemKey}-${String(depth)}`;
}

/**
 * ลงมือทำการกระทำหนึ่งข้อ
 *
 * คืน `null` = สำเร็จ · คืนข้อความ = ไม่สำเร็จ พร้อมเหตุผลที่ผู้ดูแลอ่านรู้เรื่อง
 */
async function execute(
  ctx: TenantContext,
  a: PlannedAction,
  e: AutomationEvent,
  actorId: bigint,
): Promise<string | null> {
  switch (a.kind) {
    case 'assign': {
      const id = /^\d+$/.test(a.value) ? BigInt(a.value) : null;
      if (id === null) return `ค่าผู้รับผิดชอบไม่ใช่รหัสผู้ใช้: "${a.value}"`;
      await assignWorkItem(ctx, e.item.itemKey, id);
      return null;
    }

    case 'comment': {
      await addComment(ctx, { itemKey: e.item.itemKey, body: a.value });
      return null;
    }

    case 'add-label': {
      /*
        กฎเก็บแค่ชื่อป้าย ไม่เก็บว่าเป็นฟิลด์ไหน เพราะผู้ดูแลคิดเป็น "ติดป้าย"
        ไม่ใช่ "เขียนค่าลงฟิลด์ที่ 12" · ระบบจึงต้องหาฟิลด์ให้เอง และ
        **ปฏิเสธเมื่อกำกวม** แทนที่จะเดาเอาฟิลด์แรก — การเดาผิดจะเขียนป้ายลง
        ฟิลด์ที่ไม่มีใครดู แล้วกฎจะดูเหมือนไม่ทำงานทั้งที่ทำไปแล้ว
      */
      const fields = await labelFields(ctx);
      const only = fields.length === 1 ? fields[0] : undefined;
      if (only === undefined) {
        return fields.length === 0
          ? 'ยังไม่มีฟิลด์ชนิดป้ายในระบบ'
          : `มีฟิลด์ป้ายมากกว่าหนึ่ง (${fields.map((f) => f.name).join(', ')}) — ระบุไม่ได้ว่าจะติดที่ไหน`;
      }
      const res = await bulkEditLabels(ctx, [e.item.itemKey], {
        fieldId: BigInt(only.id),
        add: [a.value],
      });
      const first = res.items[0];
      if (first === undefined) return 'ไม่ได้ผลลัพธ์กลับมา';
      return first.outcome === 'changed' || first.outcome === 'unchanged'
        ? null
        : (first.reason ?? first.outcome);
    }

    case 'transition': {
      const db = tenantScoped(ctx);
      const item = await db.workItem.findFirst({
        where: { itemKey: e.item.itemKey },
        select: { id: true },
      });
      if (item === null) return `ไม่พบเรื่อง ${e.item.itemKey}`;
      /*
        หาปุ่มจาก **รายการที่กดได้จริง** ไม่ใช่จากตารางตรง ๆ (เหมือนกระดาน) ·
        ปุ่มที่มีเงื่อนไขถูกกรองออกให้แล้ว กฎจึงข้ามเงื่อนไขของ workflow ไม่ได้
      */
      const list = await availableTransitions(ctx, item.id, actorId);
      const target = list.find((t) => t.name === a.value);
      if (target === undefined) {
        const names = list.map((t) => t.name).join(', ');
        return `จากสถานะ "${e.item.statusName}" ไม่มีปุ่ม "${a.value}" (มี: ${names === '' ? 'ไม่มีเลย' : names})`;
      }
      await applyTransition(ctx, item.id, target.id, actorId);
      return null;
    }

    default:
      // ชนิดที่ ACTION_KINDS ประกาศแต่ไม่มีสาขาไหนทำ — เทสต์เทียบสองฝั่งจับให้
      return `ยังไม่รองรับการกระทำชนิด "${String(a.kind)}"`;
  }
}

/**
 * ปลุกกฎอัตโนมัติสำหรับเหตุการณ์หนึ่ง
 *
 * `ctx.actorId` ต้องเป็นผู้ใช้ระบบของ Automation ไม่ใช่คนที่กดปุ่ม — งานที่
 * ระบบทำเองต้องอ่านได้ว่าระบบทำ ไม่ใช่ว่าคนที่บังเอิญกดเป็นคนทำ
 *
 * **ไม่โยน error ออกไปหาผู้เรียก** — การแจ้งเรื่องต้องไม่ล้มเพราะกฎอัตโนมัติพัง
 */
export async function runAutomation(
  ctx: TenantContext,
  projectId: bigint,
  e: AutomationEvent,
  now: UtcDate = systemClock.nowUtc(),
): Promise<AutomationResult> {
  const traceId = newTraceId(now, e.item.itemKey, e.depth);
  const actorId = ctx.actorId;
  const db = tenantScoped(ctx);

  async function record(
    r: RunRecord & { ruleId: bigint | null; value: string; workItemId: bigint | null },
  ): Promise<void> {
    await db.automationRun.create({
      data: {
        tenantId: ctx.tenantId,
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        workItemId: r.workItemId,
        trigger: e.kind,
        actionKind: r.actionKind,
        actionValue: r.value,
        outcome: r.outcome,
        reason: r.reason,
        traceId,
        depth: e.depth,
      },
    });
  }

  if (actorId === null) {
    const failed: RunRecord = {
      ruleName: '—',
      actionKind: '—',
      outcome: 'failed',
      reason: 'ระบบอัตโนมัติไม่มีผู้ใช้ประจำตัว — ตั้งค่าผู้ใช้ระบบก่อน',
    };
    await record({ ...failed, ruleId: null, value: '', workItemId: null });
    return { traceId, runs: [failed] };
  }

  const rows = await db.automationRule.findMany({
    where: {
      trigger: e.kind,
      isEnabled: true,
      // null = ทุกโปรเจกต์ · ระบุ = เฉพาะโปรเจกต์นั้น
      OR: [{ projectId: null }, { projectId }],
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      trigger: true,
      isEnabled: true,
      conditions: true,
      actions: true,
    },
  });

  let planned: PlannedAction[];
  try {
    planned = plan(rows.map(toRule), e);
  } catch (err) {
    /*
      ลึกเกินเพดาน — บันทึกไว้ให้เห็น ไม่ใช่หยุดเงียบ ๆ · กฎที่วนคือกฎที่เขียนผิด
      และผู้ดูแลต้องเจอมันจากหน้าประวัติ ไม่ใช่จากภาระของเครื่อง
    */
    const stopped: RunRecord = {
      ruleName: '—',
      actionKind: '—',
      outcome: 'skipped',
      reason: err instanceof Error ? err.message : String(err),
    };
    await record({ ...stopped, ruleId: null, value: '', workItemId: null });
    return { traceId, runs: [stopped] };
  }

  const item = await db.workItem.findFirst({
    where: { itemKey: e.item.itemKey },
    select: { id: true },
  });

  const runs: RunRecord[] = [];
  for (const a of planned) {
    // จองก่อนทำ — เครื่องที่ดับตรงนี้ต้องทิ้งแถว pending ไว้ให้สืบได้
    const row = await db.automationRun.create({
      data: {
        tenantId: ctx.tenantId,
        ruleId: BigInt(a.ruleId),
        ruleName: a.ruleName,
        workItemId: item?.id ?? null,
        trigger: e.kind,
        actionKind: a.kind,
        actionValue: a.value,
        outcome: 'pending',
        reason: null,
        traceId,
        depth: e.depth,
      },
      select: { id: true },
    });

    let reason: string | null;
    try {
      // traceId ของรอบนี้ติดไปกับทุก mutation ที่ service เขียน
      reason = await execute({ ...ctx, traceId }, a, e, actorId);
    } catch (err) {
      // ล้มทีละใบ ไม่ล้มทั้งรอบ
      reason = err instanceof Error ? err.message : String(err);
    }

    const outcome: RunOutcome = reason === null ? 'applied' : 'failed';
    await db.automationRun.update({ where: { id: row.id }, data: { outcome, reason } });
    runs.push({ ruleName: a.ruleName, actionKind: a.kind, outcome, reason });
  }

  return { traceId, runs };
}
