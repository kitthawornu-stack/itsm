/**
 * เวลาทำงานของทีมในช่วงหนึ่ง
 *
 * "เดือนนี้ทีมใช้เวลาไปกับอะไร" — คำถามเดียวที่ทำให้การบันทึกเวลาคุ้มค่าที่จะ
 * ทำทุกวัน · ถ้าตอบไม่ได้ คนจะเลิกบันทึกภายในสองสัปดาห์
 *
 * ## กรองด้วย `startedAt` ไม่ใช่ `createdAt`
 *
 * บทเรียนเดียวกับตอนออกแบบตาราง แต่ตรงนี้คือที่ที่มันกัดจริง · คนลงงานของ
 * วันศุกร์ในเช้าวันจันทร์ · รายงานที่กรองด้วยเวลาที่บันทึกจะย้ายงานข้ามสัปดาห์
 * ทุกครั้ง แล้วสัปดาห์ที่แล้วดูว่างและสัปดาห์นี้ดูล้น โดยไม่มีอะไรฟ้อง
 *
 * ## จัดกลุ่มตามวันของไทย ไม่ใช่วัน UTC
 *
 * งานที่บันทึกตอนสามทุ่มไทย เป็น 14:00Z ของวันเดียวกัน — ยังไม่ข้ามวันทั้งสองฝั่ง
 * แต่งานที่บันทึกตอนตีหนึ่ง (18:00Z ของวันก่อน) จะตกไปอยู่วันก่อนหน้าถ้าใช้ UTC
 * · เจ็ดชั่วโมงของทุกวันไปอยู่ผิดถัง และยอดรวมยังถูกอยู่ จึงไม่มีใครสังเกต
 * ใช้ `thaiDayKey` ตัวเดียวกับรายงานอื่น
 */
import { toUtcDate, type TenantContext } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { browsableProjectIds, can } from '../permission';
import { formatDuration } from '../workitem';
import { daysIn, thaiDayKey, type ReportWindow } from './report-window';

export interface TimeDailyPoint {
  /** `2026-09-10` ตามปฏิทินไทย */
  day: string;
  minutes: number;
}

export interface TimeBucket {
  name: string;
  minutes: number;
  text: string;
}

export interface TimeReport {
  window: { from: string; to: string; label: string };
  /** โปรเจกต์ที่ตัวเลขชุดนี้นับรวม — ตัวเลขที่ไม่บอกว่านับจากอะไร ตรวจไม่ได้ */
  projects: string[];
  totalMinutes: number;
  totalText: string;
  /** จำนวนคนที่บันทึกเวลาในช่วงนี้ — 0 คนกับ 0 นาที เป็นคนละเรื่อง */
  contributors: number;
  daily: TimeDailyPoint[];
  byUser: TimeBucket[];
  byProject: TimeBucket[];
  /** เรื่องที่กินเวลามากที่สุด — จำกัดจำนวน และบอกว่าตัดไปเท่าไร */
  topItems: Array<TimeBucket & { itemKey: string }>;
  /** เรื่องที่ไม่ได้แสดงใน `topItems` — ตัดเงียบ ๆ อ่านเหมือนครอบทั้งหมด */
  itemsNotShown: number;
}

/** จำนวนเรื่องที่แสดงในตาราง "กินเวลามากที่สุด" */
export const TOP_ITEMS = 10;

export class NoTimeReportAccessError extends Error {
  constructor() {
    super('ยังไม่มีโปรเจกต์ไหนที่คุณดูรายงานได้');
    this.name = 'NoTimeReportAccessError';
  }
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

function bucket(map: Map<string, number>): TimeBucket[] {
  return [...map.entries()]
    .map(([name, minutes]) => ({ name, minutes, text: formatDuration(minutes) }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

/**
 * รายงานเวลาของช่วงหนึ่ง
 *
 * นับเฉพาะโปรเจกต์ที่ผู้เรียกเปิดดูได้จริง — ยอดรวมที่กินโปรเจกต์ที่เขาเห็น
 * ไม่ได้ ทำให้เขารู้ปริมาณงานของทีมอื่น และรายชื่อเรื่องยิ่งบอกมากกว่านั้นอีก
 */
export interface TimeReportOptions {
  projectId?: bigint;
  /**
   * เพดานของตาราง "กินเวลามากที่สุด"
   *
   * รับเป็นพารามิเตอร์เพื่อให้เทสต์วัดการรายงานส่วนที่ถูกตัดได้ โดยไม่ต้อง
   * สร้างข้อมูลสิบเอ็ดใบ — เพดานที่ทดสอบไม่ได้ คือเพดานที่ไม่มีใครรู้ว่าตัดจริงไหม
   */
  topItems?: number;
}

export async function timeReport(
  ctx: TenantContext,
  win: ReportWindow,
  options: TimeReportOptions = {},
): Promise<TimeReport> {
  const { projectId } = options;
  const limit = options.topItems ?? TOP_ITEMS;
  const allowed = await reportableProjectIds(ctx);
  const ids =
    projectId === undefined ? allowed : allowed.filter((id) => id === projectId);
  /*
    โปรเจกต์ที่ระบุมาแต่ไม่มีสิทธิ์ ได้ผลเดียวกับไม่มีสิทธิ์เลย — คือคำปฏิเสธ
    ไม่ใช่ยอดศูนย์ · ยอดศูนย์อ่านว่า "โปรเจกต์นี้ไม่มีใครบันทึกเวลาเลย"
    ซึ่งเป็นข้อมูลที่เขาไม่ควรได้
  */
  if (ids.length === 0) throw new NoTimeReportAccessError();

  const db = tenantScoped(ctx);
  const [projects, logs] = await Promise.all([
    db.project.findMany({
      where: { id: { in: ids } },
      select: { key: true },
      orderBy: { key: 'asc' },
    }),
    db.workLog.findMany({
      /*
        `startedAt` ไม่ใช่ `createdAt` — ดูหัวไฟล์ · ตัวกรองนี้คือทั้งหมด
        ของความถูกต้องในรายงานฉบับนี้
      */
      where: {
        startedAt: { gte: win.from, lt: win.to },
        workItem: { projectId: { in: ids } },
      },
      select: {
        spentMinutes: true,
        startedAt: true,
        userId: true,
        user: { select: { displayName: true } },
        workItem: {
          select: { itemKey: true, summary: true, project: { select: { key: true } } },
        },
      },
    }),
  ]);

  const daily = new Map<string, number>();
  // เตรียมทุกวันในช่วงไว้ก่อน รวมวันที่ไม่มีใครบันทึกเลย — วันว่างคือข้อมูล
  for (const day of daysIn(win)) daily.set(day, 0);

  const byUser = new Map<string, number>();
  const byProject = new Map<string, number>();
  const byItem = new Map<string, { minutes: number; summary: string }>();
  const contributors = new Set<string>();
  let totalMinutes = 0;

  for (const l of logs) {
    totalMinutes += l.spentMinutes;
    contributors.add(l.userId.toString());

    /*
      แปลงด้วย `toUtcDate` ไม่ใช่ `as never` — ค่าที่อ่านจากฐานข้อมูลเป็น
      `Date` ดิบ และการ cast ข้าม brand คือการกลบ ไม่ใช่การพิสูจน์
      (CLAUDE.md §8 · `toUtcDate` มีไว้สำหรับค่าที่อ่านจาก DB พอดี)
    */
    const day = thaiDayKey(toUtcDate(l.startedAt));
    /*
      **ไม่มี `if (daily.has(day))` โดยตั้งใจ**

      เคยเขียนไว้ แล้วรอบพิสูจน์ว่าเทสต์แดงได้จับว่าลบทิ้งก็ยังเขียวทั้ง 10 เคส
      — เพราะขอบของคิวรีกับ `daysIn(win)` มาจาก `win` ตัวเดียวกัน วันของไทย
      ของทุกแถวที่ผ่านตัวกรองจึงอยู่ในช่วงเสมอ · มันเป็นด่านที่ไปไม่ถึง
      ซึ่งอ่านเหมือนมีอะไรกันอยู่

      สิ่งที่กันจริงคือเทสต์ `daily` ต้องมี 30 วันพอดี — ถ้าวันหลุดออกมาได้
      จำนวนถังจะเกิน และเคสนั้นแดงทันที
    */
    daily.set(day, (daily.get(day) ?? 0) + l.spentMinutes);

    byUser.set(l.user.displayName, (byUser.get(l.user.displayName) ?? 0) + l.spentMinutes);
    const pkey = l.workItem.project.key;
    byProject.set(pkey, (byProject.get(pkey) ?? 0) + l.spentMinutes);
    const prev = byItem.get(l.workItem.itemKey);
    byItem.set(l.workItem.itemKey, {
      minutes: (prev?.minutes ?? 0) + l.spentMinutes,
      summary: l.workItem.summary,
    });
  }

  const items = [...byItem.entries()]
    .map(([itemKey, v]) => ({
      itemKey,
      name: v.summary,
      minutes: v.minutes,
      text: formatDuration(v.minutes),
    }))
    .sort((a, b) => b.minutes - a.minutes || a.itemKey.localeCompare(b.itemKey));

  return {
    window: { from: win.from.toISOString(), to: win.to.toISOString(), label: win.label },
    projects: projects.map((p) => p.key),
    totalMinutes,
    totalText: formatDuration(totalMinutes),
    contributors: contributors.size,
    daily: [...daily.entries()].map(([day, minutes]) => ({ day, minutes })),
    byUser: bucket(byUser),
    byProject: bucket(byProject),
    topItems: items.slice(0, limit),
    // ตัดเงียบ ๆ อ่านเหมือนครอบทั้งหมด — บอกจำนวนที่ตัดไปเสมอ
    itemsNotShown: Math.max(0, items.length - limit),
  };
}
