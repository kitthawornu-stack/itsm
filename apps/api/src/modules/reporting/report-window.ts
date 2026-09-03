/**
 * ช่วงเวลาของรายงาน — คิดเป็นเวลาไทย เก็บและคิวรีเป็น UTC
 *
 * INVARIANT 6 บอกว่าเวลาทุกค่าเก็บและส่งเป็น UTC และแปลง timezone ที่ชั้นแสดงผล
 * **แต่รายงานพังกฎข้อนั้นในทางกลับกัน**: การหั่นช่วงเป็นเรื่องของ *คำถาม*
 * ไม่ใช่การแสดงผล · "เดือนนี้ปิดไปกี่ใบ" ของคนไทยหมายถึงเดือนตามปฏิทินไทย
 *
 * ถ้าหั่นตามเดือน UTC งานที่ปิดวันที่ 1 เวลา 00:30 น. ตามเวลาไทย
 * (= 17:30 UTC ของวันสิ้นเดือนก่อน) จะถูกนับเข้าเดือนที่แล้ว · ไม่มี error
 * ไม่มีอะไรผิดสังเกต แค่ยอดสองเดือนคลาดไปทีละไม่กี่ใบทุกเดือน และไม่มีใคร
 * ตรวจเจอ เพราะไม่มีใครนับด้วยมือมาเทียบ
 *
 * ไฟล์นี้จึงเป็นฟังก์ชันบริสุทธิ์ล้วน — ทดสอบได้โดยไม่ต้องมีฐานข้อมูล
 * และไม่อ่านนาฬิกาเอง (เวลา "ตอนนี้" ส่งเข้ามา) เหมือนกติกาของ SLA Engine
 */
import { THAI_OFFSET_MS, toUtcDate, type UtcDate } from '@itsm/types';

/**
 * ประเทศไทยเป็น UTC+7 ตลอดปี ไม่มี DST
 *
 * เขียนเป็นค่าคงที่ ไม่ใช่เรียก `Intl` เพราะ:
 *   1. ผลลัพธ์ต้องเท่ากันทุกเครื่อง ไม่ว่า TZ ของ OS จะตั้งไว้อย่างไร —
 *      เซิร์ฟเวอร์ on-prem ที่ตั้ง TZ ผิดไม่ควรทำให้รายงานผิดตาม
 *   2. `Intl` ในคอนเทนเนอร์ที่ไม่มี full-icu จะตกกลับไปเป็น UTC เงียบ ๆ
 */
/*
  ค่าคงที่เขตเวลาย้ายไปอยู่ที่ `@itsm/types` เพราะ worker ต้องใช้ด้วย
  และเรียกโค้ดของ api ไม่ได้ · ส่งต่อชื่อเดิมไว้เพื่อไม่ให้ผู้เรียกเดิมพัง
*/
export { THAI_OFFSET_MS };

export interface ReportWindow {
  /** รวมค่านี้ */
  from: UtcDate;
  /** ไม่รวมค่านี้ — ช่วงเป็น [from, to) เหมือนช่วงเวลาทำการของ SLA */
  to: UtcDate;
  /** ป้ายภาษาคน เช่น "สิงหาคม 2569" */
  label: string;
}

const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

/** วันที่ตามปฏิทินไทยของเวลา UTC ค่าหนึ่ง */
export function thaiParts(at: UtcDate): { year: number; month: number; day: number } {
  const shifted = new Date(at.getTime() + THAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** `2026-08-28` ตามปฏิทินไทย — ใช้เป็นคีย์ของกราฟรายวัน */
export function thaiDayKey(at: UtcDate): string {
  const p = thaiParts(at);
  return `${String(p.year)}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** เที่ยงคืนของวันตามเวลาไทย → UTC */
function thaiMidnightUtc(year: number, month: number, day: number): UtcDate {
  return toUtcDate(Date.UTC(year, month - 1, day) - THAI_OFFSET_MS);
}

/**
 * เดือนตามปฏิทินไทย
 *
 * `month` เป็น 1–12 · ธันวาคมล้นไปปีถัดไปเอง เพราะ `Date.UTC` รับ month 12
 * แล้วขยับปีให้ — ไม่ต้องเขียน `if (month === 12)` ซึ่งเป็นบรรทัดที่มักลืมทดสอบ
 */
export function thaiMonth(year: number, month: number): ReportWindow {
  const from = thaiMidnightUtc(year, month, 1);
  const to = thaiMidnightUtc(year, month + 1, 1);
  // ปีพุทธศักราชบนหน้าจอ — ผู้ใช้ไทยอ่าน 2569 ไม่ใช่ 2026
  return { from, to, label: `${THAI_MONTHS[month - 1] ?? ''} ${String(year + 543)}` };
}

/** ชนิดช่วงที่หน้าจอเลือกได้ */
export type RangeKey = 'this-month' | 'last-month' | 'last-7-days' | 'last-30-days';

export const RANGE_LABEL: Record<RangeKey, string> = {
  'this-month': 'เดือนนี้',
  'last-month': 'เดือนที่แล้ว',
  'last-7-days': '7 วันล่าสุด',
  'last-30-days': '30 วันล่าสุด',
};

/**
 * ช่วงที่หน้าจอเลือก → ขอบเขต UTC
 *
 * "7 วันล่าสุด" นับถึง**สิ้นวันนี้ตามเวลาไทย** ไม่ใช่ถึงนาทีนี้ — ถ้าตัดที่นาทีนี้
 * ยอดจะขยับทุกครั้งที่กดรีเฟรช และสองคนที่เปิดรายงานห่างกันสิบนาทีจะได้เลข
 * ไม่ตรงกัน แล้วเถียงกันว่าใครอ่านผิด
 */
export function windowFor(range: RangeKey, now: UtcDate): ReportWindow {
  const t = thaiParts(now);
  if (range === 'this-month') return thaiMonth(t.year, t.month);
  if (range === 'last-month') {
    return t.month === 1 ? thaiMonth(t.year - 1, 12) : thaiMonth(t.year, t.month - 1);
  }
  const days = range === 'last-7-days' ? 7 : 30;
  // สิ้นวันนี้ = เที่ยงคืนของวันพรุ่งนี้ (ช่วงเป็น [from, to) จึงไม่รวมค่านี้)
  const to = thaiMidnightUtc(t.year, t.month, t.day + 1);
  const from = toUtcDate(to.getTime() - days * 86_400_000);
  return { from, to, label: RANGE_LABEL[range] };
}

/**
 * ทุกวันในช่วง เรียงจากเก่าไปใหม่
 *
 * กราฟต้องมี **วันที่ไม่มีงานเลยด้วย** ไม่ใช่แค่วันที่มีข้อมูล · กราฟที่ข้ามวันว่าง
 * ทำให้ช่วงที่เงียบดูเหมือนช่วงที่ยุ่ง เพราะแท่งเบียดกันเป็นแท่งเดียว
 */
export function daysIn(win: ReportWindow): string[] {
  const out: string[] = [];
  for (let t = win.from.getTime(); t < win.to.getTime(); t += 86_400_000) {
    out.push(thaiDayKey(toUtcDate(t)));
  }
  return out;
}
