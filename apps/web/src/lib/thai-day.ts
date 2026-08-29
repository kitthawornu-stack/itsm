/**
 * ขอบเขตของ "วัน" ตามเวลาไทย
 *
 * เซิร์ฟเวอร์เดินด้วย UTC · การใช้ `new Date().toISOString().slice(0, 10)`
 * ทำให้ **ช่วงเวลา 00:00–07:00 ตามเวลาไทยถูกนับเป็นวันก่อนหน้า** ซึ่งเป็น
 * ช่วงที่งานเปลี่ยนแปลงส่วนใหญ่ทำกันพอดี (นอกเวลาทำการ)
 *
 * ตัวช่วยชุดนี้จึงเลื่อนไปเจ็ดชั่วโมงก่อนตัดวัน แล้วเลื่อนกลับ ·
 * ทุกฟังก์ชันรับ "ตอนนี้" เข้ามาได้ เพื่อให้ทดสอบวันข้ามปีได้โดยไม่ต้องรอ
 */

/** ระยะห่างของเวลาไทยจาก UTC — ประเทศไทยไม่มี daylight saving จึงคงที่ */
const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;

/** `2569-01-10` ตามปฏิทินไทย → คีย์ ISO ของวันนั้น เช่น `2026-01-10` */
export function thaiDayKey(at: Date): string {
  return new Date(at.getTime() + THAI_OFFSET_MS).toISOString().slice(0, 10);
}

/** เที่ยงคืนตามเวลาไทยของวันที่กำหนด — คืนเป็น `Date` ที่เป็น UTC จริง */
export function thaiMidnight(dayKey: string): Date {
  return new Date(Date.parse(`${dayKey}T00:00:00.000Z`) - THAI_OFFSET_MS);
}

/** เลื่อนคีย์วันไปข้างหน้า/ข้างหลังตามจำนวนวัน */
export function shiftDay(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const SHORT_MONTH = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

const WEEKDAY = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/**
 * `2026-01-10` → `เสาร์ 10 ม.ค. 2569`
 *
 * ชื่อวันอยู่หน้าสุดเพราะ **วันเสาร์กับวันอาทิตย์คือข้อมูลที่คนหาในปฏิทิน
 * การเปลี่ยนแปลง** — งานส่วนใหญ่ถูกนัดไว้สุดสัปดาห์
 */
export function thaiDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-');
  const at = new Date(Date.parse(`${dayKey}T00:00:00.000Z`));
  const year = Number(y) + 543;
  return (
    `${WEEKDAY[at.getUTCDay()] ?? ''} ${String(Number(d))} ` +
    `${SHORT_MONTH[Number(m) - 1] ?? ''} ${String(year)}`
  );
}

/** เวลาบนนาฬิกาไทย เช่น `02:00` — ใช้ในบรรทัดที่มีวันกำกับอยู่แล้ว */
export function thaiClock(iso: string): string {
  const d = new Date(Date.parse(iso) + THAI_OFFSET_MS);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** วันทั้งหมดที่ช่วงเวลาหนึ่งกินพื้นที่ — `[start, end)` จึงไม่รวมวันที่จบพอดีเที่ยงคืน */
export function daysCovered(startIso: string, endIso: string): string[] {
  const first = thaiDayKey(new Date(startIso));
  const end = new Date(endIso);
  // ปลายเป็น exclusive — งานที่จบเที่ยงคืนพอดีไม่กินวันถัดไป
  const lastMs = end.getTime() - 1;
  const last = thaiDayKey(new Date(lastMs));
  const out: string[] = [];
  for (let k = first; k <= last; k = shiftDay(k, 1)) {
    out.push(k);
    // กันลูปไม่รู้จบเมื่อข้อมูลเพี้ยน — หน้าต่างยาวสุด 14 วัน ช่วงห้ามยาวสุด 90
    if (out.length > 400) break;
  }
  return out;
}
