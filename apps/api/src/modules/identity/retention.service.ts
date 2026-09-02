/**
 * นโยบายระยะเวลาเก็บข้อมูล — ต่อกับฐานข้อมูล
 *
 * ## ทำไมไม่มีตัวตั้งเวลา และทำไมนั่นคือเจตนา
 *
 * ตัวลบที่ทำงานเองทุกคืนกับตารางที่กู้ไม่ได้ คือสิ่งที่โปรเจกต์นี้เจ็บมาแล้ว —
 * ตัวเก็บกวาดเซสชันลบเซสชันจริง 187 แถวทิ้งทั้งหมด และกู้ไม่ได้เพราะไม่มี
 * ตารางประวัติของเซสชัน
 *
 * ที่นี่จึงมีสามขั้นแยกกันชัดเจน: **ตั้งค่า → ดูว่าจะลบอะไร → กดลบ** ·
 * ขั้นที่สามต้องมีคนกด · การต่อตัวตั้งเวลาเป็นงานถัดไป และต้องทำหลังจาก
 * มีคนกดของจริงอย่างน้อยหนึ่งครั้งแล้วเห็นว่าตัวเลขตรงกับที่ประกาศไว้
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertTenantAdmin } from '../permission';

import {
  RETENTION_TARGETS,
  cutoffFor,
  planRetention,
  targetByKey,
  type RetentionStep,
} from './retention';

/** เพดานจำนวนแถวที่ลบได้ในการกดหนึ่งครั้ง — ลบเป็นชุด ไม่ล็อกตารางยาว */
const DELETE_BATCH = 5_000;

export interface RetentionView {
  /** ทุกตารางที่ตั้งได้ พร้อมสถานะปัจจุบัน — รวมตารางที่ยังไม่เคยตั้ง */
  rows: Array<{
    target: string;
    label: string;
    why: string;
    minKeepDays: number;
    keepDays: number | null;
    isEnabled: boolean;
    /** จำนวนแถวที่จะถูกลบถ้ากดตอนนี้ · `null` = ยังไม่ได้ตั้งนโยบาย */
    affected: number | null;
    problem: string | null;
    lastRunAt: string | null;
    lastDeleted: number | null;
  }>;
}

/** นับแถวที่เก่ากว่าเส้นแบ่งของแต่ละตาราง */
async function countOlderThan(
  ctx: TenantContext,
  target: string,
  cutoff: Date,
): Promise<number | null> {
  const db = tenantScoped(ctx);
  switch (target) {
    case 'notification':
      return db.notification.count({ where: { createdAt: { lt: cutoff } } });
    case 'notification_delivery':
      return db.notificationDelivery.count({ where: { createdAt: { lt: cutoff } } });
    case 'audit_log':
      return db.auditLog.count({ where: { createdAt: { lt: cutoff } } });
    case 'work_item_history':
      return db.workItemHistory.count({ where: { createdAt: { lt: cutoff } } });
    default:
      /*
        ตารางที่อยู่ใน `RETENTION_TARGETS` แต่ไม่มีที่นี่ = ตั้งค่าได้แต่
        ลบไม่ได้จริง · คืน `null` แล้วให้ `retentionSettings` รายงานเป็นปัญหา
        — ห้ามคืน 0 ซึ่งอ่านเหมือน "ไม่มีอะไรจะลบ"
      */
      return null;
  }
}

/** ลบจริงเป็นชุด · คืนจำนวนที่ลบไป */
async function deleteOlderThan(
  ctx: TenantContext,
  target: string,
  cutoff: Date,
): Promise<number> {
  const db = tenantScoped(ctx);
  const where = { createdAt: { lt: cutoff } };
  switch (target) {
    case 'notification': {
      /*
        `notification_delivery` ชี้มาที่ `notification` แบบ Cascade อยู่แล้ว
        การลบแถวแม่จึงพาลูกไปด้วย — ไม่ต้องลบเองสองรอบ
      */
      const ids = await db.notification.findMany({
        where,
        select: { id: true },
        take: DELETE_BATCH,
      });
      if (ids.length === 0) return 0;
      const r = await db.notification.deleteMany({ where: { id: { in: ids.map((x) => x.id) } } });
      return r.count;
    }
    case 'notification_delivery': {
      const ids = await db.notificationDelivery.findMany({
        where,
        select: { id: true },
        take: DELETE_BATCH,
      });
      if (ids.length === 0) return 0;
      const r = await db.notificationDelivery.deleteMany({
        where: { id: { in: ids.map((x) => x.id) } },
      });
      return r.count;
    }
    case 'audit_log': {
      const ids = await db.auditLog.findMany({ where, select: { id: true }, take: DELETE_BATCH });
      if (ids.length === 0) return 0;
      const r = await db.auditLog.deleteMany({ where: { id: { in: ids.map((x) => x.id) } } });
      return r.count;
    }
    case 'work_item_history': {
      const ids = await db.workItemHistory.findMany({
        where,
        select: { id: true },
        take: DELETE_BATCH,
      });
      if (ids.length === 0) return 0;
      const r = await db.workItemHistory.deleteMany({
        where: { id: { in: ids.map((x) => x.id) } },
      });
      return r.count;
    }
    default:
      throw new Error(`ลบข้อมูลชนิด "${target}" ยังไม่รองรับ`);
  }
}

/**
 * สถานะปัจจุบันของทุกตาราง พร้อมจำนวนที่จะถูกลบถ้ากดตอนนี้
 *
 * **ไม่ลบอะไรเลย** — เรียกกี่ครั้งก็ได้
 */
export async function retentionSettings(
  ctx: TenantContext,
  now: Date,
): Promise<RetentionView> {
  await assertTenantAdmin(ctx);
  const db = tenantScoped(ctx);
  const saved = await db.retentionPolicy.findMany();
  const byTarget = new Map(saved.map((p) => [p.target, p]));

  /*
    นับก่อน แล้วค่อยวางแผน — `planRetention` เป็นฟังก์ชันบริสุทธิ์ จึงรับ
    จำนวนที่นับมาแล้ว ไม่ไปนับเอง
  */
  const counts = new Map<string, number>();
  for (const p of saved) {
    if (!p.isEnabled) continue;
    try {
      const cutoff = cutoffFor(p.target, p.keepDays, now);
      const n = await countOlderThan(ctx, p.target, cutoff);
      if (n !== null) counts.set(p.target, n);
    } catch {
      // ค่าที่ตั้งไว้ใช้ไม่ได้ — `planRetention` จะรายงานเหตุผลเอง
    }
  }

  const steps = new Map(
    planRetention(
      saved.map((p) => ({ target: p.target, keepDays: p.keepDays, isEnabled: p.isEnabled })),
      counts,
      now,
    ).map((s) => [s.target, s]),
  );

  return {
    /*
      เดินจาก `RETENTION_TARGETS` ไม่ใช่จากแถวที่มีอยู่ — ตารางที่ยังไม่เคย
      ตั้งต้องปรากฏบนหน้าจอด้วย มิฉะนั้นผู้ดูแลจะไม่รู้ว่ามันตั้งได้
    */
    rows: RETENTION_TARGETS.map((t) => {
      const p = byTarget.get(t.key);
      const s: RetentionStep | undefined = steps.get(t.key);
      return {
        target: t.key,
        label: t.label,
        why: t.why,
        minKeepDays: t.minKeepDays,
        keepDays: p?.keepDays ?? null,
        isEnabled: p?.isEnabled ?? false,
        affected: s?.affected ?? null,
        problem: s?.problem ?? null,
        lastRunAt: p?.lastRunAt?.toISOString() ?? null,
        lastDeleted: p?.lastDeleted ?? null,
      };
    }),
  };
}

/**
 * ตั้งหรือแก้นโยบายของตารางหนึ่ง
 *
 * ตรวจค่าด้วย `cutoffFor` ก่อนบันทึกเสมอ — ค่าที่บันทึกไปแล้วแล้วค่อยพบว่า
 * ใช้ไม่ได้ คือค่าที่ผู้ดูแลเชื่อว่าทำงานอยู่
 */
export async function setRetention(
  ctx: TenantContext,
  target: string,
  keepDays: number,
  isEnabled: boolean,
  now: Date,
): Promise<void> {
  await assertTenantAdmin(ctx);
  const t = targetByKey(target);
  // โยนออกไปให้ controller แปลเป็น 422 — ไม่กลืนแล้วบันทึกค่าที่ใช้ไม่ได้
  cutoffFor(target, keepDays, now);

  await auditedTransaction(ctx, 'identity.retention.set', async (tx) => {
    const before = await tx.retentionPolicy.findFirst({
      where: { tenantId: ctx.tenantId, target },
      select: { keepDays: true, isEnabled: true },
    });
    await tx.retentionPolicy.upsert({
      where: { tenantId_target: { tenantId: ctx.tenantId, target } },
      create: { tenantId: ctx.tenantId, target, keepDays, isEnabled },
      update: { keepDays, isEnabled },
    });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'identity.retention.set',
          entityType: 'retention_policy',
          entityId: target,
          // เก็บค่าเดิมไว้ด้วย — "เปลี่ยนเป็น 90 วัน" ตอบไม่ได้ว่าเปลี่ยนจากอะไร
          payload: {
            target,
            label: t.label,
            from: before === null ? null : { keepDays: before.keepDays, isEnabled: before.isEnabled },
            to: { keepDays, isEnabled },
          },
        },
      ],
    };
  });
}

export interface RetentionRunResult {
  deleted: Array<{ target: string; label: string; count: number }>;
  /** ยังเหลือให้ลบอีกไหม — ชุดเดียวลบได้สูงสุด `DELETE_BATCH` แถวต่อตาราง */
  moreLeft: boolean;
}

/**
 * ลบจริงตามนโยบายที่เปิดอยู่
 *
 * **ต้องมีคนกด** — ไม่มีตัวตั้งเวลาเรียกฟังก์ชันนี้โดยตั้งใจ (ดูหัวไฟล์)
 *
 * ลบทีละชุด ชุดละไม่เกิน `DELETE_BATCH` แถวต่อตาราง แล้วบอกว่ายังเหลือไหม —
 * ดีกว่าลบรวดเดียวแล้วล็อกตารางนานจนหน้าจอค้างทั้งระบบ
 */
export async function runRetention(
  ctx: TenantContext,
  now: Date,
): Promise<RetentionRunResult> {
  await assertTenantAdmin(ctx);
  const db = tenantScoped(ctx);
  const saved = await db.retentionPolicy.findMany({ where: { isEnabled: true } });

  const deleted: RetentionRunResult['deleted'] = [];
  let moreLeft = false;

  for (const p of saved) {
    let cutoff: Date;
    try {
      cutoff = cutoffFor(p.target, p.keepDays, now);
    } catch {
      // นโยบายที่ค่าใช้ไม่ได้ ต้องไม่ลบอะไรเลย · หน้าจอรายงานปัญหาอยู่แล้ว
      continue;
    }

    const count = await deleteOlderThan(ctx, p.target, cutoff);
    if (count >= DELETE_BATCH) moreLeft = true;

    /*
      **บันทึกทุกครั้ง แม้ลบ 0 แถว** — แถวที่ `lastRunAt` เป็น null ตลอด
      ทั้งที่นโยบายเปิดอยู่ คือความเงียบที่ตอบไม่ได้ว่าเคยทำงานหรือยัง
    */
    await auditedTransaction(ctx, 'identity.retention.run', async (tx) => {
      await tx.retentionPolicy.update({
        where: { id: p.id },
        data: { lastRunAt: now, lastDeleted: count },
      });
      return {
        result: undefined,
        audit: [
          {
            kind: 'system' as const,
            action: 'identity.retention.run',
            entityType: 'retention_policy',
            entityId: p.target,
            payload: {
              target: p.target,
              keepDays: p.keepDays,
              cutoff: cutoff.toISOString(),
              deleted: count,
            },
          },
        ],
      };
    });

    deleted.push({ target: p.target, label: targetByKey(p.target).label, count });
  }

  return { deleted, moreLeft };
}
