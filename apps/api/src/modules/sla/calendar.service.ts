/**
 * ปฏิทินวันหยุด — รายการต่อปี และการยืนยันว่าตรงกับประกาศจริง
 *
 * `assertVerified()` มีมาตั้งแต่ต้นและเขียนไว้ชัดว่าห้ามใช้ปฏิทินที่ยังไม่ตรวจสอบ
 * บน production · **แต่ไม่เคยมีโค้ดเส้นไหนเรียกมันเลย นอกจากเทสต์ของตัวเอง**
 * และไม่เคยมีหน้าจอหรือคำสั่งไหนที่ทำให้คนยืนยันได้ กลไกที่ทำตามไม่ได้
 * ไม่ได้ป้องกันอะไร มันแค่ทำให้รู้สึกว่าป้องกันแล้ว
 *
 * สามข้อที่ไฟล์นี้แก้:
 *   1. การยืนยันเป็น **รายปี** — วันหยุดเปลี่ยนทุกปี บูลีนต่อปฏิทินถูกได้ปีเดียว
 *   2. การยืนยันมี **ชื่อคนและชื่อประกาศ** — คำยืนยันที่ไม่มีใครเซ็น ตอบไม่ได้
 *      ว่าใครรับผิดชอบเมื่อตัวเลข SLA ผิดทั้งปี
 *   3. การแก้รายการวันหยุด **ล้างการยืนยันของปีนั้นทิ้ง** — คำยืนยันผูกกับข้อมูล
 *      ที่ถูกตรวจ ไม่ใช่กับปฏิทินโดยรวม
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import {
  auditedTransaction,
  type AuditEntry,
} from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { coverageOfYear, needsHolidayVerification, type YearCoverage } from './thai-holidays';

export class CalendarNotFoundError extends Error {
  constructor(id: bigint) {
    super(`ไม่พบปฏิทิน #${id.toString()}`);
    this.name = 'CalendarNotFoundError';
  }
}

export class VerificationSourceRequiredError extends Error {
  constructor() {
    super('ต้องระบุประกาศที่ใช้ตรวจ เช่น "มติ ครม. 4 พ.ย. 2568"');
    this.name = 'VerificationSourceRequiredError';
  }
}

export class EmptyYearError extends Error {
  constructor(readonly year: number) {
    super(`ยืนยันปี ${String(year)} ไม่ได้ เพราะยังไม่มีวันหยุดสักวันในรายการ`);
    this.name = 'EmptyYearError';
  }
}

export class UnverifiedYearError extends Error {
  constructor(
    readonly calendarName: string,
    readonly year: number,
  ) {
    super(
      `ปฏิทิน "${calendarName}" ปี ${String(year)} ยังไม่ได้ยืนยันกับประกาศจริง — ` +
        'ตัวเลข SLA ที่คำนวณจากปฏิทินนี้เชื่อไม่ได้',
    );
    this.name = 'UnverifiedYearError';
  }
}

export interface HolidayEntry {
  date: string;
  name: string;
}

export interface YearStatus extends YearCoverage {
  year: number;
  /** ปฏิทินใบนี้ต้องยืนยันไหม — 24×7 ไม่ต้อง เพราะไม่มีวันหยุดให้ผิด */
  required: boolean;
  verified: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  source: string | null;
  holidays: HolidayEntry[];
}

const SOURCE_MAX = 255;
const isYear = (y: number): boolean => Number.isInteger(y) && y >= 2000 && y <= 2999;

async function loadCalendar(
  ctx: TenantContext,
  calendarId: bigint,
): Promise<{ id: bigint; name: string; weekly: unknown }> {
  const row = await tenantScoped(ctx).slaCalendar.findFirst({
    where: { id: calendarId },
    select: { id: true, name: true, weekly: true },
  });
  if (row === null) throw new CalendarNotFoundError(calendarId);
  // ส่ง weekly ต่อไปดิบ ๆ — needsHolidayVerification เป็นคนตรวจรูปร่างเอง
  // คอลัมน์ JSON ไม่รับประกันรูปร่าง การ cast ตรงนี้จึงเป็นการโกหกชนิด
  return { id: row.id, name: row.name, weekly: row.weekly };
}

/** สถานะของปฏิทินหนึ่งใบในปีหนึ่ง — ใช้ทั้งหน้าจอและด่านตรวจ */
export async function calendarYearStatus(
  ctx: TenantContext,
  calendarId: bigint,
  year: number,
): Promise<YearStatus> {
  const db = tenantScoped(ctx);
  const cal = await loadCalendar(ctx, calendarId);
  const [holidays, mark] = await Promise.all([
    db.slaHoliday.findMany({
      where: { calendarId, date: { startsWith: `${String(year)}-` } },
      orderBy: { date: 'asc' },
      select: { date: true, name: true },
    }),
    db.slaCalendarYear.findFirst({
      where: { calendarId, year },
      include: { verifiedBy: { select: { displayName: true } } },
    }),
  ]);

  return {
    year,
    required: needsHolidayVerification(cal.weekly),
    // การมีแถวอยู่ = ยืนยันแล้ว · ไม่มีบูลีนให้ตั้งลอย ๆ
    verified: mark !== null,
    verifiedAt: mark?.verifiedAt.toISOString() ?? null,
    verifiedBy: mark?.verifiedBy?.displayName ?? null,
    source: mark?.source ?? null,
    holidays,
    ...coverageOfYear(holidays),
  };
}

/**
 * ด่านตรวจก่อนใช้ปฏิทินคำนวณตัวเลขที่มีผลกับคน
 *
 * ปฏิทินที่ไม่มีวันหยุดให้ผิด (24×7) ผ่านเสมอ — ไม่งั้นจะเป็นเสียงเตือน
 * ที่แก้ให้หายไม่ได้ ซึ่งสอนให้ทุกคนเลิกฟังเสียงเตือนทั้งหมด
 */
export async function assertCalendarYearVerified(
  ctx: TenantContext,
  calendarId: bigint,
  year: number,
): Promise<void> {
  const status = await calendarYearStatus(ctx, calendarId, year);
  if (!status.required || status.verified) return;
  const cal = await loadCalendar(ctx, calendarId);
  throw new UnverifiedYearError(cal.name, year);
}

/**
 * เชื่อปฏิทินของปีนี้ได้ไหม — เวอร์ชันที่ **ไม่โยน error**
 *
 * `assertCalendarYearVerified` มีไว้ปิดกั้นการกระทำ · ตัวนี้มีไว้ติดป้ายตัวเลข
 * แยกกันโดยตั้งใจ: การคำนวณ SLA ต้องไม่ล้มเพราะปฏิทินยังไม่ยืนยัน
 * เพราะการหยุดคำนวณทั้งระบบเสียหายกว่าการแสดงตัวเลขที่ติดป้ายว่าเชื่อไม่ได้
 */
export async function calendarYearTrusted(
  ctx: TenantContext,
  calendarId: bigint,
  year: number,
): Promise<boolean> {
  const status = await calendarYearStatus(ctx, calendarId, year);
  return !status.required || status.verified;
}

/**
 * ล้างธงความเชื่อถือของนาฬิกาทุกเรือนที่ผูกกับปฏิทินใบนี้
 *
 * เรียกหลังแก้รายการหรือหลังยืนยัน · ถ้าไม่ล้าง นาฬิกาที่คำนวณไว้ก่อนหน้า
 * จะยังพกธง `trusted: true` เดิมไปทั่วระบบ ทั้งที่คำยืนยันถูกเพิกถอนไปแล้ว
 *
 * ตั้งเป็น false เสมอ ไม่ใช่ตั้งตามสถานะใหม่ — "ต้องคำนวณใหม่" กับ "เชื่อได้"
 * เป็นคนละเรื่อง และการเดาไปทางเชื่อได้คือการเดาผิดทาง
 */
/*
  ไม่ export — ตัวนี้เป็นขั้นตอนภายในของการแก้และการยืนยัน ไม่ใช่สิ่งที่โมดูลอื่น
  ควรเรียกเอง · ADR-004 บอกให้ `index.ts` เปิดเฉพาะ Application Service
  และ `export *` ทำให้ตัวช่วยทุกตัวหลุดออกไปโดยไม่มีใครตั้งใจ
*/
async function invalidateTrustForCalendar(
  ctx: TenantContext,
  calendarId: bigint,
): Promise<number> {
  const r = await tenantScoped(ctx).workItemSla.updateMany({
    where: { goal: { policy: { calendarId } }, calendarTrusted: true },
    data: { calendarTrusted: false },
  });
  return r.count;
}

/**
 * แทนที่รายการวันหยุดของปีหนึ่งทั้งปี
 *
 * แทนที่ทั้งปี ไม่ใช่เพิ่มทีละวัน เพราะการตรวจกับประกาศเป็นการตรวจ **ทั้งรายการ**
 * ว่าครบและไม่เกิน · การเพิ่มทีละวันทำให้วันที่ถูกยกเลิกไปแล้วค้างอยู่เงียบ ๆ
 */
export async function setHolidaysForYear(
  ctx: TenantContext,
  calendarId: bigint,
  year: number,
  entries: readonly HolidayEntry[],
): Promise<{ count: number }> {
  if (!isYear(year)) throw new EmptyYearError(year);
  const cal = await loadCalendar(ctx, calendarId);

  const seen = new Set<string>();
  const clean: HolidayEntry[] = [];
  for (const e of entries) {
    const date = typeof e.date === 'string' ? e.date.trim() : '';
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    // วันที่ต้องอยู่ในปีที่กำลังแก้จริง — ไม่งั้นการ "แทนที่ทั้งปี" จะทิ้งวันของปีอื่น
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(`${String(year)}-`)) continue;
    if (name === '' || seen.has(date)) continue;
    seen.add(date);
    clean.push({ date, name: name.slice(0, 255) });
  }
  clean.sort((a, b) => a.date.localeCompare(b.date));

  await auditedTransaction(ctx, 'sla.calendar.holidays', async (tx) => {
    await tx.slaHoliday.deleteMany({
      where: { calendarId, date: { startsWith: `${String(year)}-` } },
    });
    if (clean.length > 0) {
      await tx.slaHoliday.createMany({
        data: clean.map((h) => ({ tenantId: ctx.tenantId, calendarId, date: h.date, name: h.name })),
      });
    }
    /**
     * แก้รายการแล้ว = คำยืนยันเดิมใช้ไม่ได้อีก
     *
     * คนที่เซ็นชื่อไว้ตรวจ **รายการเดิม** ไม่ได้ตรวจรายการนี้ · ถ้าปล่อยให้
     * เครื่องหมายยืนยันค้างอยู่ ระบบจะอ้างชื่อคนนั้นรับรองข้อมูลที่เขาไม่เคยเห็น
     */
    await tx.slaCalendarYear.deleteMany({ where: { calendarId, year } });

    const audit: AuditEntry[] = [
      {
        kind: 'system',
        action: 'sla.calendar.holidays',
        entityType: 'sla_calendar',
        entityId: calendarId.toString(),
        payload: { calendar: cal.name, year, count: clean.length, verificationCleared: true },
      },
    ];
    return { result: undefined, audit };
  });

  await invalidateTrustForCalendar(ctx, calendarId);
  return { count: clean.length };
}

/**
 * ยืนยันว่ารายการของปีนั้นตรงกับประกาศจริง
 *
 * ต้องระบุประกาศที่ใช้ตรวจ · คำยืนยันที่ไม่บอกว่าเทียบกับอะไร
 * ตรวจซ้ำไม่ได้ และเถียงกันทีหลังไม่จบ
 */
export async function verifyCalendarYear(
  ctx: TenantContext,
  calendarId: bigint,
  year: number,
  rawSource: string,
  now: UtcDate = systemClock.nowUtc(),
): Promise<void> {
  const cal = await loadCalendar(ctx, calendarId);
  const source = typeof rawSource === 'string' ? rawSource.trim() : '';
  if (source === '') throw new VerificationSourceRequiredError();
  if (!isYear(year)) throw new EmptyYearError(year);

  const count = await tenantScoped(ctx).slaHoliday.count({
    where: { calendarId, date: { startsWith: `${String(year)}-` } },
  });
  // ปีที่ไม่มีวันหยุดสักวันแล้วยืนยันว่า "ตรวจแล้ว" คือการรับรองว่าทั้งปี
  // ไม่มีวันหยุดเลย ซึ่งไม่เคยเป็นความจริงสำหรับปฏิทินที่มีวันหยุด
  if (count === 0) throw new EmptyYearError(year);

  await auditedTransaction(ctx, 'sla.calendar.verify', async (tx) => {
    await tx.slaCalendarYear.deleteMany({ where: { calendarId, year } });
    await tx.slaCalendarYear.create({
      data: {
        tenantId: ctx.tenantId,
        calendarId,
        year,
        verifiedAt: now,
        verifiedById: ctx.actorId,
        source: source.slice(0, SOURCE_MAX),
      },
    });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'sla.calendar.verify',
          entityType: 'sla_calendar',
          entityId: calendarId.toString(),
          payload: { calendar: cal.name, year, source, holidayCount: count },
        },
      ],
    };
  });

  // นาฬิกาที่คำนวณไว้ก่อนหน้ายังพกธงเก่าอยู่ — บังคับให้คำนวณใหม่
  await invalidateTrustForCalendar(ctx, calendarId);
}

/** ปฏิทินทั้งหมดพร้อมสถานะของปีที่ระบุ — ใช้บนหน้าตั้งค่า */
export async function listCalendars(
  ctx: TenantContext,
  years: readonly number[],
): Promise<Array<{ id: string; name: string; timezone: string; years: YearStatus[] }>> {
  const cals = await tenantScoped(ctx).slaCalendar.findMany({ orderBy: { name: 'asc' } });
  const out = [];
  for (const c of cals) {
    const statuses = [];
    for (const y of years) statuses.push(await calendarYearStatus(ctx, c.id, y));
    out.push({ id: c.id.toString(), name: c.name, timezone: c.timezone, years: statuses });
  }
  return out;
}
