/**
 * ตัวกวาดหาเรื่องที่ไม่มีความเคลื่อนไหว
 *
 * `item.idle` ต่างจาก trigger อีกสี่ตัวโดยสิ้นเชิง: **ไม่มีใครเป็นคนจุดชนวน**
 * มันเกิดจากการที่ไม่มีอะไรเกิดขึ้น · จึงต้องมีคนไล่กวาดหาเป็นรอบ
 *
 * ## ทำไมกวาดจากฐานข้อมูล ไม่ใช่จากคิว
 *
 * "คิวไม่ใช่ที่เก็บถาวร" (CLAUDE.md) — งานที่ตั้งค้างใน Redis หายได้ทั้งชุด ·
 * ตัวกวาดนี้อ่านสภาพจริงจากฐานข้อมูลทุกรอบ ไม่ได้จำอะไรไว้ในคิว การที่คิวหาย
 * จึงทำให้ช้าไปหนึ่งรอบเท่านั้น ไม่ใช่หายไปเงียบ ๆ ตลอดกาล
 *
 * ## ทำไมต้องกันไม่ให้ทำซ้ำ
 *
 * รอบกวาดวิ่งทุกไม่กี่นาที แต่ "ไม่มีความเคลื่อนไหว 2 วัน" เป็นจริงอยู่หลายวัน ·
 * ถ้าไม่กัน กฎจะยิงซ้ำทุกรอบจนกว่าจะมีคนขยับเรื่องนั้น — หลายร้อยครั้งต่อใบ
 *
 * ตัวกันคือ **ประวัติในฐานข้อมูล ไม่ใช่ตัวแปรในหน่วยความจำ**: ข้ามถ้ามีแถว
 * `automation_run` ของ (กฎ, เรื่อง) ที่ใหม่กว่า `updatedAt` ของเรื่องนั้น ·
 * กติกาข้อนี้ดูแลสองเคสพร้อมกัน
 *
 *   - กฎที่ทำสำเร็จและไปแตะเรื่อง → `updatedAt` ขยับ เรื่องเลิกค้าง ไม่เข้ารอบอีก
 *   - **กฎที่ล้ม** → ไม่ได้แตะเรื่อง `updatedAt` เท่าเดิม แต่มีแถว `failed`
 *     ที่ใหม่กว่าแล้ว จึงไม่ยิงซ้ำ · ถ้าไม่มีข้อนี้ กฎที่เขียนผิดหนึ่งข้อ
 *     จะผลิตแถว `failed` ทุกห้านาทีตลอดไป จนหน้าประวัติอ่านไม่ได้
 *
 * และเมื่อมีคนขยับเรื่องนั้นจริง `updatedAt` จะใหม่กว่าแถวเดิม กฎจึงกลับมา
 * ทำงานได้เองเมื่อเรื่องค้างอีกครั้ง — ไม่ต้องมีใครไปล้างอะไร
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { type Condition } from './automation-engine';
import { fireAutomation } from './automation-trigger';
import { readConditions } from './automation.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * เพดานจำนวนเรื่องต่อรอบ
 *
 * รอบแรกหลังเปิดกฎใหม่ อาจเจอเรื่องค้างสะสมเป็นพันใบพร้อมกัน · การยิงทั้งหมด
 * ในรอบเดียวทำให้ฐานข้อมูลและอีเมลรับไม่ไหว และผู้ดูแลจะเห็นผลกระทบทีเดียว
 * โดยไม่มีจังหวะกดหยุด · ที่เหลือไปรอบถัดไป — ตัวกันไม่ให้ทำซ้ำทำให้ปลอดภัย
 *
 * **จำนวนที่ถูกตัดออกต้องรายงานเสมอ** ไม่ใช่ตัดเงียบ ๆ (CLAUDE.md — ยอดที่
 * รายงานเพดานของตัวเอง อ่านเหมือนยอดจริง)
 */
export const SCAN_MAX = 200;

export interface ScanSummary {
  /** เรื่องที่เข้าเกณฑ์และถูกปลุกจริงในรอบนี้ */
  fired: number;
  /** เรื่องที่ข้ามเพราะกฎเคยทำไปแล้วตั้งแต่ครั้งที่เรื่องนี้ขยับล่าสุด */
  skipped: number;
  /** เรื่องที่เข้าเกณฑ์แต่เกินเพดานของรอบนี้ — ไปรอบถัดไป */
  deferred: number;
  /** กฎที่เปิดอยู่และเป็นชนิดปลุกตามเวลา */
  rules: number;
}

/** จำนวนวันเต็มที่ไม่มีความเคลื่อนไหว — ปัดลง เพราะ "ครบ 2 วัน" ต้องครบจริง */
export function idleDaysOf(updatedAt: Date, now: UtcDate): number {
  return Math.floor((now.getTime() - updatedAt.getTime()) / DAY_MS);
}

/**
 * เกณฑ์วันที่น้อยที่สุดในบรรดากฎที่เปิดอยู่
 *
 * ใช้จำกัดขอบเขตคิวรี — ไม่งั้นต้องอ่านงานที่เปิดอยู่ทั้งหมดมาคำนวณในหน่วยความจำ
 * ซึ่งบนข้อมูลจริง 10,000 ใบคือการอ่านทั้งตารางทุกห้านาที
 *
 * กฎที่ไม่ระบุจำนวนวันเลยได้ 0 — มันตั้งใจครอบทุกใบ (และมีคำเตือนบนหน้าจอแล้ว)
 */
export function minIdleDays(conditionSets: readonly Condition[][]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const set of conditionSets) {
    let forThisRule = 0;
    for (const c of set) {
      if (c.field !== 'idleDays' || c.op !== 'at-least') continue;
      const n = Number(c.value);
      if (Number.isFinite(n)) forThisRule = Math.max(forThisRule, n);
    }
    min = Math.min(min, forThisRule);
  }
  return Number.isFinite(min) ? min : 0;
}

/**
 * กวาดหนึ่งรอบ
 *
 * `now` ส่งเข้ามา ไม่ใช่อ่านเอง — ทดสอบเคส "ค้างมา 30 วัน" ได้โดยไม่ต้องรอจริง
 * (กติกาเดียวกับ SLA Engine)
 */
export async function scanIdleItems(
  ctx: TenantContext,
  now: UtcDate = systemClock.nowUtc(),
): Promise<ScanSummary> {
  const db = tenantScoped(ctx);

  const rules = await db.automationRule.findMany({
    where: { trigger: 'item.idle', isEnabled: true },
    select: { id: true, projectId: true, conditions: true },
  });
  if (rules.length === 0) return { fired: 0, skipped: 0, deferred: 0, rules: 0 };

  const threshold = minIdleDays(rules.map((r) => readConditions(r.conditions)));
  const cutoff = new Date(now.getTime() - threshold * DAY_MS);

  /*
    เฉพาะงานที่ยังไม่จบ · การไปเตือนเรื่องที่ปิดไปแล้วเมื่อสองเดือนก่อน
    ทำให้คนเลิกเชื่อการแจ้งเตือนทั้งหมด ซึ่งแพงกว่าการไม่เตือนเลย
  */
  const candidates = await db.workItem.findMany({
    where: {
      updatedAt: { lte: cutoff },
      status: { category: { not: 'DONE' } },
      ...(rules.every((r) => r.projectId !== null)
        ? { projectId: { in: rules.map((r) => r.projectId).filter((p): p is bigint => p !== null) } }
        : {}),
    },
    orderBy: { updatedAt: 'asc' },
    // ขอเกินเพดานหนึ่งใบ เพื่อจะได้ตอบได้ว่า "ยังเหลือ" ไม่ใช่ตอบว่า "พอดี"
    take: SCAN_MAX + 1,
    select: { id: true, itemKey: true, projectId: true, updatedAt: true },
  });

  const deferred = Math.max(0, candidates.length - SCAN_MAX);
  const batch = candidates.slice(0, SCAN_MAX);

  let fired = 0;
  let skipped = 0;

  for (const item of batch) {
    const ruleIds = rules
      .filter((r) => r.projectId === null || r.projectId === item.projectId)
      .map((r) => r.id);
    if (ruleIds.length === 0) continue;

    /*
      ข้ามถ้ามีแถวของ (กฎใดก็ตามในชุดนี้, เรื่องนี้) ที่ใหม่กว่า `updatedAt`
      ของเรื่อง · ถามฐานข้อมูล ไม่ใช่จำไว้ในหน่วยความจำ — เครื่องที่รีสตาร์ต
      กลางทางต้องไม่ยิงซ้ำทั้งกอง
    */
    const already = await db.automationRun.findFirst({
      where: {
        workItemId: item.id,
        ruleId: { in: ruleIds },
        createdAt: { gt: item.updatedAt },
      },
      select: { id: true },
    });
    if (already !== null) {
      skipped += 1;
      continue;
    }

    /*
      ปลุกด้วย `fireAutomation` ตัวเดียวกับทางเข้าอื่น ไม่ประกอบเหตุการณ์เอง
      — สองที่ที่ประกอบเหตุการณ์คนละแบบ คือสองความจริงที่จะเริ่มต่างกันวันหนึ่ง
    */
    await fireAutomation(
      ctx,
      item.itemKey,
      'item.idle',
      { idleDays: idleDaysOf(item.updatedAt, now) },
      now,
    );
    fired += 1;
  }

  return { fired, skipped, deferred, rules: rules.length };
}
