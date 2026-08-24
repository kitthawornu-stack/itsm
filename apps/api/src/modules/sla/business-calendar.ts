/**
 * ปฏิทินเวลาทำการ — ฐานของการคำนวณ SLA ทั้งหมด
 *
 * ทำไมไฟล์นี้อันตราย: ถ้าคำนวณเวลาทำการผิด **ตัวเลข SLA ทั้งระบบผิดตาม**
 * และมันจะผิดแบบเงียบ ๆ — ไม่มี error ให้เห็น มีแต่รายงานที่เชื่อถือไม่ได้
 * ซึ่งจะทำลายความน่าเชื่อถือของทั้งโครงการ (ดู master-plan Part 10)
 *
 * ข้อกำหนดที่ต้องรักษาไว้เสมอ:
 *   - เวลาเข้าและออกเป็น UTC เสมอ (INVARIANT 6) แปลง timezone ที่นี่เท่านั้น
 *   - เป็น pure function ทั้งหมด — ไม่อ่านนาฬิกาเอง ไม่แตะฐานข้อมูล
 *   - ปฏิทินคนละ tenant คนละ timezone ได้
 */
import type { UtcDate } from '@itsm/types';
import { toUtcDate } from '@itsm/types';

/** ช่วงเวลาทำการในหนึ่งวัน — นาทีนับจากเที่ยงคืนตามเวลาท้องถิ่นของปฏิทิน */
export interface WorkingWindow {
  /** นาทีจากเที่ยงคืน เช่น 8*60 = 480 คือ 08:00 */
  startMinute: number;
  endMinute: number;
}

export interface BusinessCalendar {
  name: string;
  /** IANA timezone เช่น "Asia/Bangkok" */
  timezone: string;
  /**
   * เวลาทำการรายวัน · index 0 = อาทิตย์ ถึง 6 = เสาร์
   * รายการว่างหมายถึงไม่ทำงานวันนั้น
   */
  weekly: readonly (readonly WorkingWindow[])[];
  /** วันหยุด รูปแบบ YYYY-MM-DD ตามเวลาท้องถิ่นของปฏิทิน */
  holidays: ReadonlySet<string>;
}

export const HOURS_24_7: BusinessCalendar = {
  name: '24×7',
  timezone: 'UTC',
  weekly: Array.from({ length: 7 }, () => [{ startMinute: 0, endMinute: 24 * 60 }]),
  holidays: new Set(),
};

/** เวลาทำการมาตรฐาน จันทร์–ศุกร์ 08:30–17:30 เวลาไทย */
export function officeHoursThai(holidays: readonly string[] = []): BusinessCalendar {
  const office = [{ startMinute: 8 * 60 + 30, endMinute: 17 * 60 + 30 }];
  return {
    name: '8×5 (จ–ศ 08:30–17:30)',
    timezone: 'Asia/Bangkok',
    weekly: [[], office, office, office, office, office, []],
    holidays: new Set(holidays),
  };
}

// ============================================================
// การแปลง timezone
// ============================================================

/**
 * แตกเวลา UTC ออกเป็นส่วนประกอบตาม timezone ที่กำหนด
 *
 * ใช้ `Intl.DateTimeFormat` ไม่ใช่การบวกลบชั่วโมงเอง — เพราะประเทศที่มี
 * daylight saving เปลี่ยน offset กลางปี การ hard-code +07:00 จะผิดทันที
 * ที่ระบบถูกใช้นอกประเทศไทย ซึ่งเป็นสิ่งที่โหมด SaaS ตั้งใจรองรับ
 */
interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = อาทิตย์ */
  weekday: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timezone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsCache.set(timezone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function toLocalParts(at: UtcDate, timezone: string): LocalParts {
  const parts = formatter(timezone).formatToParts(at);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS[get('weekday')] ?? 0,
  };
}

export function localDateKey(at: UtcDate, timezone: string): string {
  const p = toLocalParts(at, timezone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** นาทีที่ผ่านไปนับจากเที่ยงคืนของวันนั้นตามเวลาท้องถิ่น */
function minutesIntoLocalDay(at: UtcDate, timezone: string): number {
  const p = toLocalParts(at, timezone);
  return p.hour * 60 + p.minute + p.second / 60;
}

/**
 * เวลา UTC ของ "เที่ยงคืนตามเวลาท้องถิ่น" ของวันที่เดียวกับ `at`
 *
 * คำนวณโดยหักนาทีที่ผ่านไปในวันนั้นออก — วิธีนี้ถูกต้องแม้ในวันที่ offset เปลี่ยน
 * เพราะอ่าน offset จาก `at` จริง ไม่ได้สมมติว่าคงที่
 */
function localMidnight(at: UtcDate, timezone: string): UtcDate {
  const mins = minutesIntoLocalDay(at, timezone);
  return toUtcDate(at.getTime() - Math.round(mins * 60_000));
}

// ============================================================
// แกนการคำนวณ
// ============================================================

const DAY_MS = 86_400_000;

interface DayWindows {
  /** เวลา UTC ของช่วงทำการในวันนั้น */
  ranges: Array<{ start: number; end: number }>;
  /** เที่ยงคืนของวันนั้น (UTC ms) */
  midnight: number;
}

function windowsForDay(cal: BusinessCalendar, anchor: UtcDate): DayWindows {
  const midnightDate = localMidnight(anchor, cal.timezone);
  const midnight = midnightDate.getTime();
  const key = localDateKey(anchor, cal.timezone);

  if (cal.holidays.has(key)) return { ranges: [], midnight };

  const parts = toLocalParts(anchor, cal.timezone);
  const windows = cal.weekly[parts.weekday] ?? [];
  return {
    ranges: windows.map((w) => ({
      start: midnight + w.startMinute * 60_000,
      end: midnight + w.endMinute * 60_000,
    })),
    midnight,
  };
}

export function isWorkingTime(cal: BusinessCalendar, at: UtcDate): boolean {
  const t = at.getTime();
  return windowsForDay(cal, at).ranges.some((r) => t >= r.start && t < r.end);
}

/**
 * เวลาทำการ (มิลลิวินาที) ระหว่าง `from` ถึง `to`
 *
 * ถ้า `to` มาก่อน `from` คืน 0 — ไม่ใช่ค่าติดลบ เพราะเวลาที่ใช้ไปติดลบไม่มีความหมาย
 * และการปล่อยให้ติดลบจะทำให้ยอดสะสมเพี้ยนโดยไม่มีใครสังเกต
 */
export function elapsedWorkingMs(cal: BusinessCalendar, from: UtcDate, to: UtcDate): number {
  if (to.getTime() <= from.getTime()) return 0;

  let total = 0;
  let cursor = localMidnight(from, cal.timezone).getTime();
  const target = to.getTime();
  const fromMs = from.getTime();

  // เดินทีละวันตามเวลาท้องถิ่น · +2 วันเผื่อกรณี offset เปลี่ยนทำให้วันคาบเกี่ยว
  const maxDays = Math.ceil((target - cursor) / DAY_MS) + 2;
  for (let i = 0; i < maxDays && cursor < target; i += 1) {
    const anchor = toUtcDate(cursor + 12 * 3_600_000); // เที่ยงวันเพื่อเลี่ยงขอบ DST
    const day = windowsForDay(cal, anchor);
    for (const r of day.ranges) {
      const start = Math.max(r.start, fromMs);
      const end = Math.min(r.end, target);
      if (end > start) total += end - start;
    }
    // ก้าวไปเที่ยงคืนของวันถัดไปตามเวลาท้องถิ่นจริง
    cursor = localMidnight(toUtcDate(day.midnight + DAY_MS + 12 * 3_600_000), cal.timezone).getTime();
  }
  return total;
}

/**
 * เวลาที่จะถึงเมื่อเดินหน้าไป `ms` มิลลิวินาที **ตามเวลาทำการ**
 *
 * ใช้หา `breach_at` — จุดที่ SLA จะหลุดถ้าไม่มีอะไรเปลี่ยน
 * ถ้า `from` อยู่นอกเวลาทำการ การนับเริ่มที่ต้นช่วงทำการถัดไป
 */
export function addWorkingMs(cal: BusinessCalendar, from: UtcDate, ms: number): UtcDate {
  if (ms <= 0) return from;

  let remaining = ms;
  let cursor = localMidnight(from, cal.timezone).getTime();
  const fromMs = from.getTime();

  // เพดาน 400 วันทำการ — ป้องกันวนไม่จบเมื่อปฏิทินไม่มีวันทำการเลย
  for (let i = 0; i < 400; i += 1) {
    const anchor = toUtcDate(cursor + 12 * 3_600_000);
    const day = windowsForDay(cal, anchor);
    for (const r of day.ranges) {
      const start = Math.max(r.start, fromMs);
      if (r.end <= start) continue;
      const available = r.end - start;
      if (available >= remaining) return toUtcDate(start + remaining);
      remaining -= available;
    }
    cursor = localMidnight(toUtcDate(day.midnight + DAY_MS + 12 * 3_600_000), cal.timezone).getTime();
  }

  throw new Error(
    `หา breach_at ไม่ได้ภายใน 400 วัน — ปฏิทิน "${cal.name}" อาจไม่มีเวลาทำการเลย`,
  );
}

/**
 * ต้นช่วงเวลาทำการถัดไปนับจาก `at` (คืน `at` เองถ้าอยู่ในเวลาทำการอยู่แล้ว)
 *
 * เวอร์ชันแรกเขียนเป็น `addWorkingMs(cal, at, 1)` ซึ่ง **คลาดไป 1 มิลลิวินาที**
 * เพราะมันเดินเข้าไปในช่วงทำการหนึ่งหน่วย แทนที่จะคืนจุดเริ่มพอดี
 * ความคลาดหนึ่งมิลลิวินาทีดูไม่สำคัญ แต่มันไปโผล่ในทุกค่า breach_at
 * และในทุกเวลาแจ้งเตือนของตั๋วที่เปิดนอกเวลาทำการ — ซึ่งคือตั๋วส่วนใหญ่
 */
export function nextWorkingMoment(cal: BusinessCalendar, at: UtcDate): UtcDate {
  if (isWorkingTime(cal, at)) return at;

  let cursor = localMidnight(at, cal.timezone).getTime();
  const atMs = at.getTime();

  for (let i = 0; i < 400; i += 1) {
    const anchor = toUtcDate(cursor + 12 * 3_600_000);
    const day = windowsForDay(cal, anchor);
    for (const r of day.ranges) {
      if (r.end <= atMs) continue;
      return toUtcDate(Math.max(r.start, atMs));
    }
    cursor = localMidnight(toUtcDate(day.midnight + DAY_MS + 12 * 3_600_000), cal.timezone).getTime();
  }

  throw new Error(
    `หาเวลาทำการถัดไปไม่ได้ภายใน 400 วัน — ปฏิทิน "${cal.name}" อาจไม่มีเวลาทำการเลย`,
  );
}
