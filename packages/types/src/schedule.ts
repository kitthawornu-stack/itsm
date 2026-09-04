/**
 * ตารางเวลาส่งรายงาน
 *
 * "ครั้งต่อไปเมื่อไร" เป็นคำถามที่ผิดแล้ว **ไม่มีใครเห็น** — รายงานที่ไม่ถูกส่ง
 * ไม่มีใครทวง เพราะไม่มีใครรู้ว่าควรได้รับ · และรายงานที่ส่งผิดเวลาก็ยังอ่านได้
 * ตามปกติ · ความผิดทั้งสองแบบจึงเงียบสนิท จึงต้องเป็นเอนจินบริสุทธิ์ที่ทดสอบได้
 *
 * **ไม่อ่านนาฬิกาเอง** — "ตอนนี้" ส่งเข้ามาเสมอ เหมือนเอนจิน SLA
 * ทำให้ทดสอบเคสข้ามเดือนข้ามปีได้โดยไม่ต้องรอจริง
 */
import { toUtcDate, type UtcDate } from './index';

/**
 * ประเทศไทยเป็น UTC+7 **ตลอดปี ไม่มีเวลาออมแสง**
 *
 * ย้ายมาอยู่ที่นี่เพราะทั้ง api และ worker ต้องใช้ · ของเดิมอยู่ใน
 * `report-window.ts` ของ api ซึ่ง worker เรียกไม่ได้ (คนละแอป) ·
 * ค่าคงที่ที่คัดลอกไปวางในแต่ละแอป คือค่าที่จะไม่ตรงกันในวันที่มีคนแก้
 * แค่ที่เดียว — และความไม่ตรงกันของเขตเวลาไม่มีทางเห็นจาก error
 */
export const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * รูปแบบตารางเวลา
 *
 * `hour`/`minute` เป็น **เวลาไทยเสมอ** ไม่ใช่ UTC · ผู้ใช้ตั้งเวลาที่เขา
 * มองเห็นบนนาฬิกาของตัวเอง — "ทุกวัน 08:00" ที่คิดเป็น UTC จะส่งตอนบ่ายสาม
 * โดยไม่มี error อะไรบอก มีแต่คนสงสัยว่าทำไมรายงานเช้ามาตอนบ่าย
 */
export type Schedule =
  | { kind: 'daily'; hour: number; minute: number }
  /** `weekday` 0 = อาทิตย์ … 6 = เสาร์ ตรงกับ `Date.getUTCDay()` */
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  /** `day` 1–31 · เดือนที่ไม่มีวันนั้น ใช้วันสุดท้ายของเดือน */
  | { kind: 'monthly'; day: number; hour: number; minute: number };

/**
 * เพดานการนับรอบที่ตกไป
 *
 * เครื่องที่ดับไปหนึ่งปีไม่ควรวนนับ 365 รอบทุกครั้งที่ตัวตั้งเวลาตื่น ·
 * ตัวเลขที่ชนเพดานยังบอกได้ว่า "อย่างน้อยเท่านี้" ซึ่งพอสำหรับการเตือน
 */
export const MAX_MISSED_COUNT = 400;

/** ส่วนประกอบของเวลาไทย ณ ขณะหนึ่ง */
function parts(at: UtcDate): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
} {
  const d = new Date(at.getTime() + THAI_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** เวลาไทยที่ระบุ → UTC */
function thaiAt(year: number, month: number, day: number, hour: number, minute: number): UtcDate {
  return toUtcDate(Date.UTC(year, month - 1, day, hour, minute) - THAI_OFFSET_MS);
}

/** จำนวนวันในเดือนนั้น — ใช้เลข 0 ของเดือนถัดไป ซึ่งคือวันสุดท้ายของเดือนนี้ */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * เวลาที่ควรส่งครั้งต่อไป
 *
 * **ตรงเวลาพอดีนับเป็นรอบนี้ ไม่ใช่ข้ามไปรอบหน้า** — ตัวตั้งเวลาที่ตื่น
 * ตรงวินาทีนั้นพอดี ต้องส่ง ไม่ใช่รอไปอีกรอบเต็ม
 *
 * `lastRunAt` ทำให้ **ครั้งต่อไปหลังครั้งล่าสุดเสมอ** · ถ้าไม่มีข้อนี้
 * ตัวตั้งเวลาที่รันทุกนาทีจะส่งซ้ำทุกนาทีจนหมดรอบ
 */
export function nextRunAt(s: Schedule, now: UtcDate, lastRunAt: UtcDate | null): UtcDate {
  const floor = lastRunAt === null ? now.getTime() : Math.max(now.getTime(), lastRunAt.getTime() + 1);
  const from = toUtcDate(floor);
  const p = parts(from);

  switch (s.kind) {
    case 'daily': {
      const today = thaiAt(p.year, p.month, p.day, s.hour, s.minute);
      if (today.getTime() >= from.getTime()) return today;
      return thaiAt(p.year, p.month, p.day + 1, s.hour, s.minute);
    }
    case 'weekly': {
      /*
        ระยะห่างเป็นวันไปยังวันที่ต้องการ · 0 = วันนี้ ซึ่งยังใช้ได้ถ้ายัง
        ไม่เลยเวลา — ต้องเช็กเวลาด้วย ไม่ใช่ดูแต่วัน
      */
      const ahead = (s.weekday - p.weekday + 7) % 7;
      const candidate = thaiAt(p.year, p.month, p.day + ahead, s.hour, s.minute);
      if (candidate.getTime() >= from.getTime()) return candidate;
      return thaiAt(p.year, p.month, p.day + ahead + 7, s.hour, s.minute);
    }
    case 'monthly': {
      /*
        **วันที่ที่ไม่มีในเดือนนั้น ใช้วันสุดท้ายของเดือน** · ปล่อยให้ล้นไป
        เดือนถัดไปทำให้รายงานเดือนกุมภาพันธ์มาถึงต้นเดือนมีนาคม ·
        ข้ามไปเลยทำให้เดือนนั้นไม่มีรายงานโดยไม่มีใครรู้
      */
      const inThis = Math.min(s.day, daysInMonth(p.year, p.month));
      const candidate = thaiAt(p.year, p.month, inThis, s.hour, s.minute);
      if (candidate.getTime() >= from.getTime()) return candidate;
      const nextMonth = p.month === 12 ? 1 : p.month + 1;
      const nextYear = p.month === 12 ? p.year + 1 : p.year;
      const inNext = Math.min(s.day, daysInMonth(nextYear, nextMonth));
      return thaiAt(nextYear, nextMonth, inNext, s.hour, s.minute);
    }
  }
}

/**
 * จำนวนรอบที่ควรส่งแต่ยังไม่ได้ส่ง
 *
 * **ไม่ส่งย้อนหลังทั้งกอง แต่ต้องบอกได้ว่าตกไปกี่รอบ** — เครื่องดับสามวัน
 * แล้วกลับมา ไม่ควรส่งรายงานสามฉบับพร้อมกัน ผู้รับจะเห็นเป็นสแปมแล้ว
 * เลิกอ่านทั้งหมด · แต่ถ้าเงียบไปเลย ก็ไม่มีใครรู้ว่าเคยมีรอบที่ไม่ได้ส่ง
 *
 * **ยังไม่เคยส่งเลย = ไม่นับว่าตก** — ตารางที่เพิ่งสร้างไม่ควรรายงานว่า
 * พลาดไปแล้วตั้งแต่ยังไม่เริ่ม
 */
export function missedRuns(s: Schedule, lastRunAt: UtcDate | null, now: UtcDate): number {
  if (lastRunAt === null) return 0;
  let n = 0;
  let cursor = lastRunAt;
  while (n < MAX_MISSED_COUNT) {
    const next = nextRunAt(s, cursor, cursor);
    if (next.getTime() > now.getTime()) break;
    n++;
    cursor = next;
  }
  return n;
}

/** ค่าที่ตั้งไม่ได้ — ข้อความบอกว่าผิดตรงไหน ไม่ใช่แค่ว่าผิด */
export class InvalidScheduleError extends Error {}

/**
 * ประกอบ `Schedule` จากแถวในฐานข้อมูล
 *
 * **แถวที่ข้อมูลไม่ครบต้องล้ม ไม่ใช่เดาค่าที่ขาด** — `weekly` ที่ไม่มี
 * `weekday` ถ้าเดาเป็นวันอาทิตย์ รายงานจะไปโผล่วันที่ไม่มีใครตั้ง
 * และไม่มีอะไรบอกว่าเพี้ยน
 */
export function scheduleFromRow(row: {
  kind: string;
  hour: number;
  minute: number;
  weekday: number | null;
  day: number | null;
}): Schedule {
  if (!Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23) {
    throw new InvalidScheduleError('ชั่วโมงต้องอยู่ระหว่าง 0 ถึง 23');
  }
  if (!Number.isInteger(row.minute) || row.minute < 0 || row.minute > 59) {
    throw new InvalidScheduleError('นาทีต้องอยู่ระหว่าง 0 ถึง 59');
  }
  switch (row.kind) {
    case 'daily':
      return { kind: 'daily', hour: row.hour, minute: row.minute };
    case 'weekly':
      if (row.weekday === null || row.weekday < 0 || row.weekday > 6) {
        throw new InvalidScheduleError('รายสัปดาห์ต้องระบุวันในสัปดาห์ (0 = อาทิตย์ ถึง 6 = เสาร์)');
      }
      return { kind: 'weekly', weekday: row.weekday, hour: row.hour, minute: row.minute };
    case 'monthly':
      if (row.day === null || row.day < 1 || row.day > 31) {
        throw new InvalidScheduleError('รายเดือนต้องระบุวันที่ระหว่าง 1 ถึง 31');
      }
      return { kind: 'monthly', day: row.day, hour: row.hour, minute: row.minute };
    default:
      throw new InvalidScheduleError(`ไม่รู้จักรอบ "${row.kind}" — ใช้ได้แค่ daily · weekly · monthly`);
  }
}
