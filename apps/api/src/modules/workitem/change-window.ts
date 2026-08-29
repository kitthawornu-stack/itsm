/**
 * หน้าต่างเวลาดำเนินการเปลี่ยนแปลง
 *
 * ITIL เรียกร้องให้การเปลี่ยนแปลงมี **ช่วงเวลาที่ตกลงกันไว้** และให้เห็นว่า
 * ช่วงนั้นชนกับของคนอื่นหรือชนช่วงห้ามเปลี่ยนแปลงหรือเปล่า
 *
 * ทั้งไฟล์เป็นฟังก์ชันบริสุทธิ์ · **"ตอนนี้" ส่งเข้ามา ไม่อ่านนาฬิกาเอง**
 * กติกาเดียวกับ SLA Engine — เคสวันข้ามปีและช่วงที่คาบเกี่ยวกันพอดีเป๊ะ
 * ทดสอบได้ก็ต่อเมื่อไม่ต้องรอเวลาจริง
 *
 * ## ช่วงเวลาเป็น `[start, end)`
 *
 * งานที่จบ 21:00 พอดี ไม่ชนกับงานที่เริ่ม 21:00 · ถ้านับปลายปิดด้วย
 * ทุกคู่ที่ทำต่อกันจะติดธง แล้วคนจะเรียนรู้ที่จะเมินคำเตือน
 * ซึ่งแย่กว่าไม่มีคำเตือนเลย (เหตุผลเดียวกับช่วงเวลาทำการของ SLA)
 *
 * ## การชนกันเตือน · ช่วงห้ามกั้น
 *
 * สองอย่างนี้ต่างกันโดยตั้งใจ:
 *
 * - **ชนกับงานอื่น = คำเตือน** ห้ามเมื่อไร คนจะไปนัดกันนอกระบบ
 *   แล้วระบบจะไม่รู้อะไรเลย ซึ่งแย่กว่ารู้ว่าชน
 * - **อยู่ในช่วงห้าม = กั้น** แต่ข้ามได้เมื่อบันทึกเหตุผล — การห้ามที่
 *   ข้ามไม่ได้เลย จะถูกข้ามด้วยการไม่กรอกลงระบบ และร่องรอยจะหายไปทั้งหมด
 */
import type { UtcDate } from '@itsm/types';

/** ช่วงเวลาแบบ `[start, end)` */
export interface TimeWindow {
  start: UtcDate;
  end: UtcDate;
}

export interface ScheduledChange {
  itemKey: string;
  summary: string;
  window: TimeWindow;
}

export interface FreezeWindow {
  name: string;
  /** ทำไมถึงห้าม — ผู้ที่จะขอข้ามต้องอ่านแล้วตัดสินใจได้เอง */
  reason: string;
  window: TimeWindow;
}

/**
 * เพดานความยาวของหน้าต่างหนึ่งบาน
 *
 * หน้าต่างสามเดือนไม่ใช่แผน มันคือการพิมพ์ผิดหรือการเลี่ยงไม่วางแผน ·
 * และหน้าต่างที่ยาวเกินจริงจะชนกับทุกอย่าง ทำให้รายงานการชนไร้ความหมาย
 */
export const MAX_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export class BackwardWindowError extends Error {
  constructor() {
    super('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
    this.name = 'BackwardWindowError';
  }
}

export class WindowTooLongError extends Error {
  constructor(readonly days: number) {
    super(
      `หน้าต่างยาว ${String(Math.round(days))} วัน — เกิน ${String(MAX_WINDOW_DAYS)} วัน ` +
        `ให้แตกเป็นหลายครั้งที่สั้นกว่า`,
    );
    this.name = 'WindowTooLongError';
  }
}

/**
 * สองช่วงคาบเกี่ยวกันไหม
 *
 * **`[start, end)`** — ปลายของอันหนึ่งชนต้นของอีกอันพอดี ไม่ถือว่าชน
 */
export function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/** งานที่ชนกับหน้าต่างนี้ — เรียงตามเวลาเริ่ม · ไม่ชนเลยคืนรายการว่าง ไม่ใช่ `null` */
export function conflictsWith(
  window: TimeWindow,
  others: readonly ScheduledChange[],
): ScheduledChange[] {
  return others
    .filter((o) => overlaps(window, o.window))
    .sort((x, y) => x.window.start.getTime() - y.window.start.getTime());
}

/** ช่วงห้ามที่หน้าต่างนี้ไปคาบเกี่ยว */
export function freezesHit(
  window: TimeWindow,
  freezes: readonly FreezeWindow[],
): FreezeWindow[] {
  return freezes
    .filter((f) => overlaps(window, f.window))
    .sort((x, y) => x.window.start.getTime() - y.window.start.getTime());
}

export interface AssessInput {
  window: TimeWindow;
  /** หน้าต่างของการเปลี่ยนแปลงใบอื่นที่ยังไม่ถูกยกเลิก */
  others: readonly ScheduledChange[];
  freezes: readonly FreezeWindow[];
  /** "ตอนนี้" — ส่งเข้ามาเสมอ ห้ามอ่านนาฬิกาในไฟล์นี้ */
  now: UtcDate;
  /** เหตุผลที่ขอข้ามช่วงห้าม — ว่างหรือช่องว่างล้วน = ไม่ได้ให้เหตุผล */
  overrideReason?: string | undefined;
}

export interface WindowAssessment {
  /** งานอื่นที่ชน — เป็นคำเตือน ไม่ได้กั้น */
  conflicts: ScheduledChange[];
  /** ช่วงห้ามที่ชน — กั้น เว้นแต่จะข้ามพร้อมเหตุผล */
  freezes: FreezeWindow[];
  /** ข้ามช่วงห้ามจริงหรือเปล่า — ไม่ใช่แค่ "มีข้อความส่งมา" */
  overridden: boolean;
  /** บันทึกไม่ได้จนกว่าจะแก้ */
  blocked: boolean;
  /** เริ่มก่อน "ตอนนี้" — บันทึกได้ แต่ต้องให้เห็น */
  startsInPast: boolean;
  durationMs: number;
}

/**
 * ตรวจหน้าต่างหนึ่งบานเทียบกับทุกอย่างรอบตัว
 *
 * @throws {BackwardWindowError} เมื่อ `end <= start` — ช่วงยาวศูนย์ไม่ชนกับ
 *   อะไรเลยตามนิยาม `[start, end)` จึงเงียบสนิทถ้าปล่อยผ่าน
 * @throws {WindowTooLongError} เมื่อยาวเกิน `MAX_WINDOW_DAYS`
 */
export function assessWindow(input: AssessInput): WindowAssessment {
  const durationMs = input.window.end.getTime() - input.window.start.getTime();
  if (durationMs <= 0) throw new BackwardWindowError();
  if (durationMs > MAX_WINDOW_DAYS * DAY_MS) throw new WindowTooLongError(durationMs / DAY_MS);

  const conflicts = conflictsWith(input.window, input.others);
  const freezes = freezesHit(input.window, input.freezes);

  /*
    `overridden` ต้องหมายถึง "ข้ามการห้ามจริง" ไม่ใช่ "มีข้อความส่งมา" ·
    ถ้าตีความอย่างหลัง รายงานจะนับใบที่ไม่เคยชนช่วงห้ามเลยว่าเป็นการข้าม
    แล้วตัวเลข "จำนวนครั้งที่ข้ามช่วงห้าม" จะสูงกว่าความจริงตลอด
  */
  const hasReason = (input.overrideReason ?? '').trim() !== '';
  const overridden = freezes.length > 0 && hasReason;

  return {
    conflicts,
    freezes,
    overridden,
    blocked: freezes.length > 0 && !overridden,
    // เริ่มพอดีวินาทีนี้ ไม่ใช่อดีต — ผู้ใช้ที่เลือก "เริ่มเดี๋ยวนี้" ต้องไม่ติดธง
    startsInPast: input.window.start.getTime() < input.now.getTime(),
    durationMs,
  };
}
