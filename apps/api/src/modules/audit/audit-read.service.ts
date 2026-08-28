/**
 * อ่าน audit log
 *
 * INVARIANT 2 บังคับให้ทุก mutation เขียน `audit_log` — และ `auditedTransaction`
 * โยน error ถ้าไม่เขียน · แต่ **ไม่มีหน้าจอไหนอ่านมันเลย** ข้อมูลจึงถูกเขียน
 * อย่างเดียวมาตลอด ซึ่งเป็นรูปแบบเดียวกับกลไกที่ไม่มีอะไรเรียกใช้:
 * เราบังคับให้เก็บหลักฐาน แล้วไม่เคยเปิดดู
 *
 * ระบบ ITSM ที่ตอบไม่ได้ว่า "ใครเปลี่ยนอะไรเมื่อไร" จากหน้าจอ ไม่ต่างจาก
 * ระบบที่ไม่ได้เก็บ — เพราะคำตอบที่ต้องเปิดฐานข้อมูลถึงจะได้ ไม่มีใครไปหา
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

/** จำนวนสูงสุดต่อหน้า — ตรงกับหน้าคิว เพื่อให้เพดานทั้งระบบเป็นเลขเดียว */
export const AUDIT_PAGE_MAX = 50;

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  /** ชื่อคนที่ทำ — `null` แปลว่าระบบทำเอง ไม่ใช่ "ไม่รู้ว่าใคร" */
  actor: string | null;
  /** ผู้ใช้ถูกลบไปแล้ว แต่ร่องรอยยังอยู่ — ต่างจากระบบทำเอง */
  actorRemoved: boolean;
  payload: unknown;
  createdAt: string;
}

export interface AuditPage {
  rows: AuditRow[];
  /** ยอดรวมของเงื่อนไขนี้ ไม่ใช่จำนวนที่คืนมาในหน้านี้ */
  total: number;
  offset: number;
  /** ชนิดของการกระทำที่มีอยู่จริง — ให้หน้าจอสร้างตัวกรองจากของจริง ไม่ใช่เดา */
  actions: string[];
}

export interface AuditFilter {
  action?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  actorId?: bigint | undefined;
  since?: UtcDate | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * อ่านรายการ audit
 *
 * **ตัวกรองที่ไม่ตรงอะไรเลย ต้องแยกออกจาก "ไม่มีกิจกรรม"** — ผู้เรียกได้
 * `total` ของเงื่อนไขนั้นและ `actions` ของทั้งระบบ หน้าจอจึงบอกได้ว่า
 * "ไม่มีรายการที่ตรงเงื่อนไข" ไม่ใช่ "ระบบนี้ไม่เคยมีใครทำอะไร"
 */
export async function readAuditLog(
  ctx: TenantContext,
  filter: AuditFilter = {},
): Promise<AuditPage> {
  const db = tenantScoped(ctx);
  const take = Math.min(Math.max(1, filter.limit ?? AUDIT_PAGE_MAX), AUDIT_PAGE_MAX);
  const skip = Math.max(0, filter.offset ?? 0);

  const where = {
    ...(filter.action === undefined || filter.action === '' ? {} : { action: filter.action }),
    ...(filter.entityType === undefined || filter.entityType === ''
      ? {}
      : { entityType: filter.entityType }),
    ...(filter.entityId === undefined || filter.entityId === ''
      ? {}
      : { entityId: filter.entityId }),
    ...(filter.actorId === undefined ? {} : { actorId: filter.actorId }),
    ...(filter.since === undefined ? {} : { createdAt: { gte: filter.since } }),
  };

  const [rows, total, distinct] = await Promise.all([
    db.auditLog.findMany({
      where,
      // ใหม่สุดก่อน — คำถามที่คนถามคือ "เมื่อกี้ใครทำอะไร" ไม่ใช่ "ตอนเริ่มระบบ"
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: { actor: { select: { displayName: true } } },
    }),
    db.auditLog.count({ where }),
    /*
      ชนิดของการกระทำมาจากข้อมูลจริง ไม่ใช่รายการที่หน้าจอเขียนเอง —
      รายการที่ดูแลด้วยมือจะไม่ตรงกับความจริงในวันที่มีคนเพิ่ม action ใหม่
      แล้วตัวกรองจะซ่อนกิจกรรมนั้นไว้โดยไม่มีใครรู้
    */
    db.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id.toString(),
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      /*
        ชื่อจาก relation ก่อน แล้วค่อยตกไปที่ชื่อที่เก็บไว้ตอนเขียน

        `actorId` เป็น SetNull เมื่อผู้ใช้ถูกลบ · ถ้าพึ่ง relation อย่างเดียว
        ร่องรอยของคนที่ลาออกจะกลายเป็น "ระบบทำเอง" ซึ่งเป็นคำตอบที่ผิด
      */
      actor: r.actor?.displayName ?? r.actorName,
      // ชื่อยังอยู่แต่ไม่มีบัญชีแล้ว = คนทำแต่ถูกลบ · ต่างจากระบบทำเอง (ไม่มีทั้งคู่)
      actorRemoved: r.actorId === null && r.actorName !== null,
      payload: r.payload,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    offset: skip,
    actions: distinct.map((d) => d.action),
  };
}

/**
 * ร่องรอยของสิ่งหนึ่ง — ใช้ตอบว่า "เรื่องนี้/ชุดสิทธิ์นี้ ใครแตะบ้าง"
 *
 * แยกจาก `readAuditLog` เพราะเป็นคำถามคนละแบบ: อันนั้นคือ "เกิดอะไรขึ้นบ้าง"
 * อันนี้คือ "สิ่งนี้ผ่านอะไรมาบ้าง" · และ `entityId` เป็นสตริงในสคีมา
 * จึงต้องเทียบเป็นสตริง ไม่ใช่แปลงเป็นตัวเลข
 */
export async function auditTrailOf(
  ctx: TenantContext,
  entityType: string,
  entityId: string,
  limit = 20,
): Promise<AuditRow[]> {
  const page = await readAuditLog(ctx, { entityType, entityId, limit });
  return page.rows;
}

/** ช่วงเวลาที่หน้าจอเลือกได้ — คำนวณจากนาฬิกาที่ฉีดเข้ามา ไม่ใช่ `new Date()` */
export function sinceFromRange(
  range: 'today' | '7d' | '30d' | 'all',
  now: UtcDate = systemClock.nowUtc(),
): UtcDate | undefined {
  if (range === 'all') return undefined;
  const days = range === 'today' ? 1 : range === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 86_400_000) as UtcDate;
}
