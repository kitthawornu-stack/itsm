/**
 * ผลการแก้ไข — รายการตัวเลือกตอนปิดงาน
 *
 * เคยสร้างได้จาก `bootstrap.js` ทางเดียว องค์กรที่เรียก "ซ้ำกับรายการอื่น"
 * ว่าอย่างอื่น หรืออยากได้ "ส่งต่อผู้ผลิต" เพิ่ม ต้องเข้าไปแก้ฐานข้อมูลเอง
 *
 * **ไม่มีการลบ** — `work_item.resolution_id` เป็น `onDelete: SetNull`
 * การลบแถวเดียวจึงล้างค่าบนงานที่ปิดไปแล้วทุกใบพร้อมกันโดยไม่มีอะไรเตือน
 * และกู้คืนไม่ได้ · การเลิกใช้เป็นการปิดไม่ให้ **เลือกใหม่** เท่านั้น
 * งานเก่ายังแสดงค่าเดิมได้ตลอดไป และปุ่มที่ตรึงค่าไว้ใน workflow ยังทำงานอยู่
 */
import type { TenantContext } from '@itsm/types';

import {
  auditedTransaction,
  type AuditEntry,
} from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

export const RESOLUTION_NAME_MAX = 64;

export class LookupNameRequiredError extends Error {
  constructor() {
    super('ต้องระบุชื่อ');
    this.name = 'LookupNameRequiredError';
  }
}

export class DuplicateLookupNameError extends Error {
  constructor(readonly given: string) {
    super(`มี "${given}" อยู่แล้ว`);
    this.name = 'DuplicateLookupNameError';
  }
}

export class LookupNotFoundError extends Error {
  constructor(readonly id: number) {
    super(`ไม่พบผลการแก้ไข #${String(id)}`);
    this.name = 'LookupNotFoundError';
  }
}

export class LastActiveLookupError extends Error {
  constructor() {
    super('ต้องเหลือผลการแก้ไขที่ใช้งานอยู่อย่างน้อยหนึ่งรายการ');
    this.name = 'LastActiveLookupError';
  }
}

export interface ResolutionRow {
  id: number;
  name: string;
  isActive: boolean;
  /** จำนวนงานที่ถือค่านี้อยู่ — ผู้ดูแลต้องเห็นว่าการเลิกใช้กระทบอะไร */
  inUse: number;
}

function cleanName(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s === '') throw new LookupNameRequiredError();
  return s.slice(0, RESOLUTION_NAME_MAX);
}

const logged = (action: string, id: number, payload: Record<string, unknown>): AuditEntry => ({
  kind: 'system',
  action,
  entityType: 'resolution',
  entityId: String(id),
  payload,
});

/**
 * ตัวเลือกที่เลือกได้ตอนนี้ — ใช้เติมฟอร์มปิดงาน
 *
 * ไม่รวมที่เลิกใช้แล้ว · แต่ `resolveResolution` ยังรับชื่อที่เลิกใช้ได้อยู่
 * โดยตั้งใจ เพราะปุ่มที่ตรึงผลการแก้ไขไว้ใน workflow ต้องไม่พังเพราะผู้ดูแล
 * ปิดตัวเลือกนั้นไป — ผู้ใช้เลือกเองไม่ได้ ก็พอแล้ว
 */
export async function listResolutions(ctx: TenantContext): Promise<string[]> {
  const rows = await tenantScoped(ctx).resolution.findMany({
    where: { isActive: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

/** รายการเต็มสำหรับหน้าตั้งค่า — รวมที่เลิกใช้แล้ว พร้อมจำนวนงานที่ใช้อยู่ */
export async function listResolutionsAdmin(ctx: TenantContext): Promise<ResolutionRow[]> {
  const db = tenantScoped(ctx);
  const rows = await db.resolution.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  // นับครั้งเดียวแล้วแจก ไม่ใช่ยิงหนึ่งคิวรีต่อหนึ่งแถว
  const used = await db.workItem.groupBy({ by: ['resolutionId'], _count: { _all: true } });
  const count = new Map(used.map((u) => [u.resolutionId, u._count._all]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isActive: r.isActive,
    inUse: count.get(r.id) ?? 0,
  }));
}

export async function createResolution(ctx: TenantContext, rawName: string): Promise<ResolutionRow> {
  const db = tenantScoped(ctx);
  const name = cleanName(rawName);
  if ((await db.resolution.findFirst({ where: { name }, select: { id: true } })) !== null) {
    throw new DuplicateLookupNameError(name);
  }
  const last = await db.resolution.findFirst({
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const row = await auditedTransaction(ctx, 'resolution.create', async (tx) => {
    const created = await tx.resolution.create({
      data: { tenantId: ctx.tenantId, name, position: (last?.position ?? 0) + 1 },
    });
    return { result: created, audit: [logged('resolution.create', created.id, { name })] };
  });
  return { id: row.id, name: row.name, isActive: row.isActive, inUse: 0 };
}

export async function renameResolution(
  ctx: TenantContext,
  id: number,
  rawName: string,
): Promise<void> {
  const db = tenantScoped(ctx);
  const name = cleanName(rawName);
  const current = await db.resolution.findFirst({ where: { id } });
  if (current === null) throw new LookupNotFoundError(id);
  // ส่งชื่อเดิมกลับมาไม่ใช่การแก้ไข — auditedTransaction โยนเมื่อไม่มีอะไรเปลี่ยน
  if (current.name === name) return;
  if ((await db.resolution.findFirst({ where: { name }, select: { id: true } })) !== null) {
    throw new DuplicateLookupNameError(name);
  }

  /**
   * เปลี่ยนชื่อ ไม่ใช่สร้างใหม่แล้วย้าย
   *
   * งานที่ปิดไปแล้วชี้มาที่แถวนี้ด้วย id · การเปลี่ยนชื่อจึงเปลี่ยนสิ่งที่งานเก่า
   * ทุกใบแสดงไปพร้อมกัน ซึ่งถูกต้องเมื่อเป็นการแก้คำผิด แต่ผิดเมื่อตั้งใจให้
   * เป็นความหมายใหม่ — audit เก็บทั้งชื่อเดิมและชื่อใหม่ไว้ให้ตามได้
   */
  await auditedTransaction(ctx, 'resolution.rename', async (tx) => {
    await tx.resolution.update({ where: { id }, data: { name } });
    return {
      result: undefined,
      audit: [logged('resolution.rename', id, { from: current.name, to: name })],
    };
  });
}

export async function setResolutionActive(
  ctx: TenantContext,
  id: number,
  isActive: boolean,
): Promise<void> {
  const db = tenantScoped(ctx);
  const current = await db.resolution.findFirst({ where: { id } });
  if (current === null) throw new LookupNotFoundError(id);
  if (current.isActive === isActive) return;

  /**
   * ปิดตัวสุดท้ายไม่ได้
   *
   * ตารางที่ไม่มีตัวเลือกที่ใช้งานอยู่เลย ทำให้ปิดงานไม่ได้ทั้งระบบ และสิ่งที่
   * ผู้ใช้เห็นคือ "ยังไม่ได้กรอก: resolution" พร้อมช่องเลือกที่ว่างเปล่า —
   * ทางตันที่ไม่มีหน้าจอไหนบอกได้ว่าเกิดจากอะไร
   */
  if (!isActive) {
    const others = await db.resolution.count({ where: { isActive: true, id: { not: id } } });
    if (others === 0) throw new LastActiveLookupError();
  }

  await auditedTransaction(ctx, 'resolution.active', async (tx) => {
    await tx.resolution.update({ where: { id }, data: { isActive } });
    return {
      result: undefined,
      audit: [logged('resolution.active', id, { name: current.name, isActive })],
    };
  });
}
