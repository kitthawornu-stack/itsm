/**
 * รายงาน
 *
 * ไฟล์นี้ทำให้ `VIEW_REPORT` มีผลจริงเป็นครั้งแรก · ก่อนหน้านี้คีย์นี้แสดงบน
 * หน้าตั้งค่าโปรเจกต์ว่า "ดูรายงาน" แต่อยู่ใน `UNENFORCED_PERMISSIONS`
 * และโมดูลนี้ว่างเปล่า — รูปแบบเดียวกับ `BULK_EDIT` และ `LINK_ITEM`
 *
 * ## กติกาสามข้อของตัวเลขบนรายงาน
 *
 * 1. **นับจากเหตุการณ์ ไม่ใช่จากสถานะปัจจุบัน** — "เดือนนี้ปิดไปกี่ใบ" ต้องนับ
 *    จาก `resolvedAt` ที่ตกในช่วง ไม่ใช่นับใบที่ตอนนี้อยู่หมวด DONE ·
 *    ใบที่ปิดเดือนที่แล้วแล้วเปิดใหม่เดือนนี้ จะหายจากยอดของเดือนที่แล้วทันที
 *    ถ้านับจากสถานะ และรายงานเดือนที่แล้วจะเปลี่ยนย้อนหลังโดยไม่มีใครแตะมัน
 *
 * 2. **ค่าเฉลี่ยของศูนย์ใบคือ `null` ไม่ใช่ `0`** — "เวลาปิดเฉลี่ย 0 ชั่วโมง"
 *    อ่านว่าปิดทันที ซึ่งกลับความหมายของ "ยังไม่มีใบไหนปิดเลย"
 *
 * 3. **นับเฉพาะโปรเจกต์ที่ผู้อ่านเปิดดูได้** — ยอดรวมที่กินโปรเจกต์ที่มองไม่เห็น
 *    คือการรั่วข้อมูลแบบที่ตรวจยากที่สุด เพราะไม่มีคีย์เรื่องไหนโผล่ให้เห็น
 */
import { toUtcDate, type TenantContext } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan, browsableProjectIds, can } from '../permission';
import { daysIn, thaiDayKey, type ReportWindow } from './report-window';

export interface DailyPoint {
  /** `2026-08-28` ตามปฏิทินไทย */
  day: string;
  opened: number;
  resolved: number;
}

export interface ReportSummary {
  window: { from: string; to: string; label: string };
  /** โปรเจกต์ที่ตัวเลขชุดนี้นับรวม — ตัวเลขที่ไม่บอกว่านับจากอะไร ตรวจไม่ได้ */
  projects: string[];
  opened: number;
  resolved: number;
  /** ค้างอยู่ ณ ตอนนี้ — ไม่ใช่ค่าของช่วง จึงแยกป้ายให้ชัด */
  openNow: number;
  /** เวลาปิดเฉลี่ยเป็นชั่วโมง — `null` เมื่อไม่มีใบไหนปิดในช่วงนี้ */
  avgResolveHours: number | null;
  /** นาฬิกาที่หลุดกำหนดในช่วงนี้ — นับจาก `breachedAt` ไม่ใช่ `isBreached` */
  breached: number;
  daily: DailyPoint[];
  byPriority: Array<{ name: string; opened: number }>;
  byAssignee: Array<{ name: string; resolved: number }>;
}

/** โปรเจกต์ที่ผู้ใช้ทั้งเปิดดูได้ **และ** มีสิทธิ์ดูรายงาน */
async function reportableProjectIds(ctx: TenantContext): Promise<bigint[]> {
  const browsable = await browsableProjectIds(ctx);
  const out: bigint[] = [];
  for (const id of browsable) {
    if (await can(ctx, id, 'VIEW_REPORT')) out.push(id);
  }
  return out;
}

export class NoReportAccessError extends Error {
  constructor() {
    super('ยังไม่มีโปรเจกต์ไหนที่คุณดูรายงานได้');
    this.name = 'NoReportAccessError';
  }
}

/**
 * ยอดรวมของช่วงเวลาหนึ่ง
 *
 * `projectId` ที่ระบุมาต้องผ่าน `assertCan` ตรง ๆ — ไม่ใช่แค่ถูกกรองออกเงียบ ๆ
 * ผู้ใช้ที่ขอรายงานของโปรเจกต์ที่ไม่มีสิทธิ์ ต้องได้คำปฏิเสธ ไม่ใช่ได้ยอดศูนย์
 * ซึ่งอ่านว่า "โปรเจกต์นี้ไม่มีงานเลย"
 */
export async function reportSummary(
  ctx: TenantContext,
  win: ReportWindow,
  projectId?: bigint,
): Promise<ReportSummary> {
  if (projectId !== undefined) await assertCan(ctx, projectId, 'VIEW_REPORT');
  const ids = projectId === undefined ? await reportableProjectIds(ctx) : [projectId];
  if (ids.length === 0) throw new NoReportAccessError();

  const db = tenantScoped(ctx);
  const scope = { projectId: { in: ids } };

  const [projects, openedRows, resolvedRows, openNow, breached] = await Promise.all([
    db.project.findMany({ where: { id: { in: ids } }, select: { key: true }, orderBy: { key: 'asc' } }),
    db.workItem.findMany({
      where: { ...scope, createdAt: { gte: win.from, lt: win.to } },
      select: { createdAt: true, priority: { select: { name: true, rank: true } } },
    }),
    /*
      นับจาก `resolvedAt` ที่ตกในช่วง ไม่ใช่จากสถานะปัจจุบัน
      ใบที่ปิดในช่วงนี้แล้วถูกเปิดใหม่ทีหลัง ยังต้องนับอยู่ — มันปิดไปจริง ๆ
      ในช่วงนั้น และรายงานที่เปลี่ยนย้อนหลังคือรายงานที่เชื่อไม่ได้
    */
    db.workItem.findMany({
      where: { ...scope, resolvedAt: { gte: win.from, lt: win.to } },
      select: {
        createdAt: true,
        resolvedAt: true,
        assignee: { select: { displayName: true } },
      },
    }),
    db.workItem.count({ where: { ...scope, resolvedAt: null } }),
    /*
      `breachedAt` ไม่ใช่ `isBreached` — คำถามคือ "หลุดกี่ใบ**ในช่วงนี้**"
      ซึ่ง `isBreached` ตอบไม่ได้เลยเพราะมันไม่รู้ว่าหลุดตอนไหน
      (บทเรียนที่ทำให้ต้องเพิ่มคอลัมน์นี้ตั้งแต่แรก — CLAUDE.md §8)
    */
    db.workItemSla.count({
      where: { workItem: scope, breachedAt: { gte: win.from, lt: win.to } },
    }),
  ]);

  const daily = new Map<string, DailyPoint>();
  // เตรียมทุกวันในช่วงไว้ก่อน รวมวันที่ไม่มีงานเลย
  for (const day of daysIn(win)) daily.set(day, { day, opened: 0, resolved: 0 });
  const bump = (at: Date, field: 'opened' | 'resolved'): void => {
    // `toUtcDate` ไม่ใช่ `as never` — ดูเหตุผลที่ time-report.service.ts
    const point = daily.get(thaiDayKey(toUtcDate(at)));
    if (point !== undefined) point[field] += 1;
  };
  for (const r of openedRows) bump(r.createdAt, 'opened');
  for (const r of resolvedRows) if (r.resolvedAt !== null) bump(r.resolvedAt, 'resolved');

  const spans = resolvedRows
    .filter((r) => r.resolvedAt !== null)
    .map((r) => (r.resolvedAt as Date).getTime() - r.createdAt.getTime())
    // เวลาติดลบแปลว่าข้อมูลเพี้ยน — ตัดออกดีกว่าดึงค่าเฉลี่ยให้ต่ำลงเงียบ ๆ
    .filter((ms) => ms >= 0);

  const priority = new Map<string, number>();
  for (const r of openedRows) {
    const name = r.priority?.name ?? 'ไม่ระบุ';
    priority.set(name, (priority.get(name) ?? 0) + 1);
  }

  const assignee = new Map<string, number>();
  for (const r of resolvedRows) {
    // งานที่ปิดโดยไม่มีผู้รับผิดชอบมีจริง และต้องนับ ไม่ใช่หายไปจากยอดรวม
    const name = r.assignee?.displayName ?? 'ไม่มีผู้รับผิดชอบ';
    assignee.set(name, (assignee.get(name) ?? 0) + 1);
  }

  return {
    window: { from: win.from.toISOString(), to: win.to.toISOString(), label: win.label },
    projects: projects.map((p) => p.key),
    opened: openedRows.length,
    resolved: resolvedRows.length,
    openNow,
    // ศูนย์ใบ = ไม่มีค่าเฉลี่ย ไม่ใช่เฉลี่ยศูนย์ชั่วโมง
    avgResolveHours:
      spans.length === 0
        ? null
        : Math.round((spans.reduce((a, b) => a + b, 0) / spans.length / 3_600_000) * 10) / 10,
    breached,
    daily: [...daily.values()],
    byPriority: [...priority.entries()]
      .map(([name, opened]) => ({ name, opened }))
      .sort((a, b) => b.opened - a.opened),
    byAssignee: [...assignee.entries()]
      .map(([name, resolved]) => ({ name, resolved }))
      .sort((a, b) => b.resolved - a.resolved),
  };
}
