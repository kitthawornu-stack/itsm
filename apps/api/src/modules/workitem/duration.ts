/**
 * อ่านและแสดงระยะเวลาทำงาน
 *
 * เก็บเป็น **จำนวนนาทีเต็ม** เสมอ · การเก็บเป็นข้อความอย่าง `"2h 30m"` ทำให้
 * บวกกันไม่ได้ เรียงไม่ได้ และเปลี่ยนความหมายเมื่อมีคนแก้ตัวแปลงทีหลัง
 *
 * ## "หนึ่งวัน" คือแปดชั่วโมง ไม่ใช่ยี่สิบสี่
 *
 * กับดักคลาสสิกของการประมาณเวลา · คนพิมพ์ `2d` หมายถึงงานสองวันทำการ
 * ถ้าระบบแปลเป็น 48 ชั่วโมง ตัวเลขจะพองสามเท่าทั้งระบบโดยไม่มีใครสังเกต
 * เพราะมันยังดูเป็นตัวเลขที่สมเหตุสมผล
 *
 * ค่านี้ตายตัวไว้ก่อนโดยตั้งใจ — ทำให้ตั้งได้รายองค์กรเมื่อไร ต้องส่งค่าเข้ามา
 * เป็นพารามิเตอร์ ไม่ใช่อ่านจากที่ไหนก็ได้ (กติกาเดียวกับนาฬิกาของ SLA Engine)
 */

/** ชั่วโมงทำงานต่อวัน — `2d` = 16 ชั่วโมง ไม่ใช่ 48 */
export const HOURS_PER_DAY = 8;
/** วันทำงานต่อสัปดาห์ — `1w` = 5 วันทำการ */
export const DAYS_PER_WEEK = 5;

const MIN_PER_HOUR = 60;
const MIN_PER_DAY = HOURS_PER_DAY * MIN_PER_HOUR;
const MIN_PER_WEEK = DAYS_PER_WEEK * MIN_PER_DAY;

/**
 * เพดานของค่าเดียว — 10 ปีทำการ
 *
 * ไม่ใช่เพื่อกันคนพิมพ์เล่น แต่เพื่อกัน **ตัวเลขที่ล้นแล้วยังดูปกติ** ·
 * `999999999d` ที่ผ่านเข้าไปจะทำให้ยอดรวมของทั้งโปรเจกต์ไร้ความหมาย
 * และไม่มีใครรู้ว่ามาจากแถวไหน
 */
export const MAX_MINUTES = 10 * 52 * MIN_PER_WEEK;

export class InvalidDurationError extends Error {
  constructor(readonly given: string) {
    super(
      `อ่านระยะเวลา "${given}" ไม่ออก — ใช้รูปแบบ 2w 3d 4h 30m หรือใส่จำนวนนาทีเป็นตัวเลข`,
    );
    this.name = 'InvalidDurationError';
  }
}

export class DurationTooLargeError extends Error {
  constructor(readonly minutes: number) {
    super(`ระยะเวลายาวเกินไป (${String(minutes)} นาที) — เกินเพดานที่ระบบรับได้`);
    this.name = 'DurationTooLargeError';
  }
}

const UNIT_MINUTES: Record<string, number> = {
  w: MIN_PER_WEEK,
  d: MIN_PER_DAY,
  h: MIN_PER_HOUR,
  m: 1,
};

/**
 * อ่านข้อความเป็นจำนวนนาที
 *
 * รับ `"2w 3d 4h 30m"` ทุกส่วนไม่บังคับ · รับตัวเลขล้วนเป็นนาที
 *
 * **ปฏิเสธมากกว่าเดา** — ข้อความที่อ่านไม่ออกต้องโยน ไม่ใช่คืน 0 ·
 * การคืน 0 ทำให้คนที่พิมพ์ผิดเห็นว่า "บันทึกแล้ว" แล้วเวลาที่เขาทำงานหายไป
 * โดยไม่มีอะไรฟ้อง — ซึ่งเป็นสิ่งที่เขาจะรู้ตอนสิ้นเดือนเท่านั้น
 */
export function parseDuration(text: string): number {
  const raw = text.trim().toLowerCase();
  if (raw === '') throw new InvalidDurationError(text);

  // ตัวเลขล้วน = นาที · คนที่ชินกับการกรอกนาทีตรง ๆ ไม่ต้องเรียนรูปแบบใหม่
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n <= 0) throw new InvalidDurationError(text);
    if (n > MAX_MINUTES) throw new DurationTooLargeError(n);
    return n;
  }

  /*
    ต้องตรงทั้งสตริง ไม่ใช่แค่หาส่วนที่ตรงได้ · `matchAll` อย่างเดียวจะยอมรับ
    `"2h ครึ่ง"` เป็น 2 ชั่วโมงเงียบ ๆ แล้วครึ่งชั่วโมงหายไป
  */
  if (!/^(\d+\s*[wdhm]\s*)+$/.test(raw)) throw new InvalidDurationError(text);

  let total = 0;
  const seen = new Set<string>();
  for (const m of raw.matchAll(/(\d+)\s*([wdhm])/g)) {
    const unit = m[2] ?? '';
    // หน่วยซ้ำ (`"2h 3h"`) คือคนพิมพ์ผิด ไม่ใช่ 5 ชั่วโมง — ปฏิเสธ ไม่บวกให้
    if (seen.has(unit)) throw new InvalidDurationError(text);
    seen.add(unit);
    total += Number(m[1] ?? '0') * (UNIT_MINUTES[unit] ?? 0);
  }

  if (total <= 0) throw new InvalidDurationError(text);
  if (total > MAX_MINUTES) throw new DurationTooLargeError(total);
  return total;
}

/**
 * แสดงจำนวนนาทีเป็นข้อความที่คนอ่านออก
 *
 * ใช้หน่วยเดียวกับที่ `parseDuration` รับ — อ่านแล้วพิมพ์กลับเข้าไปได้เลย
 * โดยได้ค่าเดิม · สองฝั่งที่ใช้หน่วยคนละชุด คือที่มาของค่าที่เพี้ยนทีละนิด
 */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m';
  const parts: string[] = [];
  let left = Math.floor(minutes);
  for (const [unit, size] of [
    ['w', MIN_PER_WEEK],
    ['d', MIN_PER_DAY],
    ['h', MIN_PER_HOUR],
    ['m', 1],
  ] as const) {
    const n = Math.floor(left / size);
    if (n > 0) {
      parts.push(`${String(n)}${unit}`);
      left -= n * size;
    }
  }
  return parts.join(' ');
}

/**
 * เวลาที่เหลือหลังบันทึกงานหนึ่งครั้ง
 *
 * **ไม่ใช่ `original - spent`** — งานที่ประมาณไว้ 4 ชั่วโมงแล้วใช้ไป 5 ชั่วโมง
 * อาจยังเหลืออีก 2 ชั่วโมงจริง ๆ · การคำนวณด้วยการลบจะได้ค่าติดลบซึ่ง
 * **ตอบคำถามที่ไม่มีใครถาม** และทำให้รายงานรวมยอดผิดทั้งโปรเจกต์
 *
 * ค่าที่เหลือจึงเป็นค่าที่เก็บไว้ต่างหาก และการบันทึกงานหักออกจากมันทีละครั้ง
 * โดยไม่ต่ำกว่าศูนย์ — ศูนย์แปลว่า "ไม่เหลือแล้ว" ซึ่งเป็นคำตอบที่ถูก
 * ส่วนติดลบไม่ใช่คำตอบของอะไรเลย
 */
export function remainingAfter(currentRemaining: number | null, spent: number): number | null {
  if (currentRemaining === null) return null;
  return Math.max(0, currentRemaining - spent);
}
