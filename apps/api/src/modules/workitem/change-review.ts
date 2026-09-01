/**
 * การทบทวนหลังทำ (Post-Implementation Review)
 *
 * PIR มีไว้ตอบสามคำถามหลังการเปลี่ยนแปลงจบลง:
 * **ได้ผลไหม · ตอนนี้ระบบอยู่ในสภาพไหน · ครั้งหน้าต้องทำอะไรต่างไป**
 *
 * ฟังก์ชันบริสุทธิ์ · ไม่อ่านนาฬิกา — "ตอนนี้" ส่งเข้ามาเสมอ ทำให้ทดสอบ
 * เคสข้ามเวลาได้โดยไม่ต้องรอจริง (กติกาเดียวกับ SLA Engine)
 *
 * ## `rolledBack` เป็นสามค่า ไม่ใช่สองค่า
 *
 * `null` = **ยังไม่ตอบ** · `false` = ตอบแล้วว่าไม่ได้ย้อน · `true` = ย้อนแล้ว
 *
 * ถ้าใช้ boolean สองค่า ฟอร์มที่ยังไม่ได้ติ๊กจะกลายเป็น "ไม่ได้ย้อนกลับ"
 * โดยอัตโนมัติ — ซึ่งเป็นคำตอบที่ระบบแต่งขึ้นเอง ไม่ใช่คำตอบของคน ·
 * "ล้มเหลว" ที่ไม่บอกว่าย้อนกลับแล้วหรือยัง ทำให้ไม่มีใครรู้ว่าตอนนี้ระบบ
 * อยู่ในสภาพเดิมหรือสภาพครึ่ง ๆ กลาง ๆ ซึ่งเป็นคำถามที่สำคัญที่สุดของทั้ง PIR
 */
import type { UtcDate } from '@itsm/types';

export type ReviewOutcome = 'SUCCESS' | 'PARTIAL' | 'FAILED';

export const REVIEW_OUTCOMES: readonly ReviewOutcome[] = ['SUCCESS', 'PARTIAL', 'FAILED'];

export const REVIEW_OUTCOME_LABEL: Record<ReviewOutcome, string> = {
  SUCCESS: 'สำเร็จตามแผน',
  PARTIAL: 'สำเร็จบางส่วน',
  FAILED: 'ไม่สำเร็จ',
};

/**
 * ความยาวสูงสุดของบันทึก
 *
 * **ยาวเกินแล้วปฏิเสธ ไม่ใช่ตัดเงียบ ๆ** — การตัดทำให้คนเขียนบทเรียนยาว
 * แล้วสูญเสียท่อนท้ายไปโดยไม่รู้ตัว และท่อนท้ายมักเป็นข้อสรุป
 */
export const REVIEW_NOTES_MAX = 4000;

export class NotImplementedYetError extends Error {
  constructor() {
    super('ยังทบทวนไม่ได้ — ต้องกำหนดช่วงเวลาดำเนินการ และช่วงนั้นต้องเริ่มไปแล้ว');
    this.name = 'NotImplementedYetError';
  }
}

export class ContradictoryReviewError extends Error {
  constructor() {
    super('เลือก "สำเร็จตามแผน" พร้อมกับ "ย้อนกลับแล้ว" ไม่ได้ — ถ้าย้อนกลับ แปลว่าไม่สำเร็จ');
    this.name = 'ContradictoryReviewError';
  }
}

export class RollbackAnswerRequiredError extends Error {
  constructor() {
    super('ต้องตอบว่าย้อนกลับแล้วหรือยัง — ถ้าไม่ตอบ จะไม่มีใครรู้ว่าตอนนี้ระบบอยู่ในสภาพไหน');
    this.name = 'RollbackAnswerRequiredError';
  }
}

export class ReviewNotesRequiredError extends Error {
  constructor() {
    super('การเปลี่ยนแปลงที่ไม่สำเร็จ ต้องบันทึกสิ่งที่ได้เรียนรู้');
    this.name = 'ReviewNotesRequiredError';
  }
}

export class ReviewNotesTooLongError extends Error {
  constructor(length: number) {
    super(`บันทึกยาว ${String(length)} อักขระ เกินเพดาน ${String(REVIEW_NOTES_MAX)}`);
    this.name = 'ReviewNotesTooLongError';
  }
}

export interface ReviewInput {
  outcome: ReviewOutcome;
  /** `null` = ยังไม่ตอบ — ต่างจาก `false` ที่ตอบแล้วว่าไม่ได้ย้อน */
  rolledBack: boolean | null;
  notes: string;
  /** ช่วงเวลาดำเนินการที่นัดไว้ · `null` = ยังไม่ได้กำหนด */
  window: { start: UtcDate } | null;
  /** "ตอนนี้" — ส่งเข้ามาเสมอ ห้ามอ่านนาฬิกาในไฟล์นี้ */
  now: UtcDate;
}

export interface NormalizedReview {
  outcome: ReviewOutcome;
  rolledBack: boolean;
  /** `null` = ไม่ได้เขียน — ต่างจากสตริงว่างที่แปลว่าเขียนแล้วแต่ว่าง */
  notes: string | null;
}

/**
 * ตรวจและทำให้เป็นค่ามาตรฐานในขั้นตอนเดียว
 *
 * รวมไว้ที่เดียวโดยตั้งใจ — ถ้าแยก "ตรวจ" กับ "แปลง" ผู้เรียกจะเรียกแค่
 * ตัวใดตัวหนึ่งได้ แล้วอีกครึ่งจะหายไปเงียบ ๆ ในวันที่มีคนเพิ่มทางเรียกใหม่
 *
 * @throws {NotImplementedYetError} ยังไม่ถึงเวลาที่นัดไว้ หรือไม่ได้นัดไว้เลย
 * @throws {ContradictoryReviewError} "สำเร็จ" พร้อม "ย้อนกลับแล้ว"
 * @throws {RollbackAnswerRequiredError} ไม่สำเร็จแต่ไม่ตอบเรื่องการย้อนกลับ
 * @throws {ReviewNotesRequiredError} ไม่สำเร็จแต่ไม่มีบันทึก
 * @throws {ReviewNotesTooLongError} บันทึกยาวเกินเพดาน
 */
export function normalizeReview(input: ReviewInput): NormalizedReview {
  /*
    ขอบเขตเป็น `[start, …)` เหมือนหน้าต่างเวลา — เริ่มพอดีวินาทีนี้ถือว่า
    เริ่มแล้ว · ถ้าใช้ `<` คนที่กดทบทวนตรงเวลาเป๊ะจะถูกปฏิเสธโดยไม่มีเหตุผล
    ที่อธิบายได้ และมันจะเกิดปีละไม่กี่ครั้งจนไม่มีใครหาสาเหตุเจอ
  */
  const w = input.window;
  if (w === null || w.start.getTime() > input.now.getTime()) throw new NotImplementedYetError();

  if (input.notes.length > REVIEW_NOTES_MAX) throw new ReviewNotesTooLongError(input.notes.length);
  const notes = input.notes.trim();
  const succeeded = input.outcome === 'SUCCESS';

  if (succeeded && input.rolledBack === true) throw new ContradictoryReviewError();
  if (!succeeded && input.rolledBack === null) throw new RollbackAnswerRequiredError();
  if (!succeeded && notes === '') throw new ReviewNotesRequiredError();

  return {
    outcome: input.outcome,
    // ถึงตรงนี้ `null` เหลือได้เฉพาะกรณีสำเร็จ ซึ่งแปลว่าไม่ได้ย้อนกลับ
    rolledBack: input.rolledBack ?? false,
    notes: notes === '' ? null : notes,
  };
}
