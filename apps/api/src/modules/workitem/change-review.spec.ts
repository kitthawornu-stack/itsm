/**
 * ข้อกำหนดของการทบทวนหลังทำ (Post-Implementation Review) — **เขียนก่อนโค้ด**
 *
 * PIR มีไว้ตอบสามคำถามหลังการเปลี่ยนแปลงจบลง: **ได้ผลไหม · ตอนนี้ระบบอยู่ใน
 * สภาพไหน · ครั้งหน้าต้องทำอะไรต่างไป**
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 *   1. **"ล้มเหลว" ที่ไม่บอกว่าย้อนกลับแล้วหรือยัง** — อ่านแล้วไม่มีใครรู้ว่า
 *      ตอนนี้ระบบอยู่ในสภาพเดิมหรือสภาพครึ่ง ๆ กลาง ๆ · เป็นข้อมูลที่ดูเหมือน
 *      ครบแต่ตอบคำถามที่สำคัญที่สุดไม่ได้
 *   2. **"สำเร็จ" ทั้งที่ย้อนกลับไปแล้ว** — ขัดกันเองในประโยคเดียว แต่ฟอร์ม
 *      ที่ไม่ตรวจจะรับไว้เงียบ ๆ แล้วรายงานจะนับใบนั้นเป็นความสำเร็จตลอดไป
 *   3. **ทบทวนก่อนถึงเวลาที่นัดไว้** — การทบทวนสิ่งที่ยังไม่เกิดคือการเดา
 *      และมันจะถูกอ่านทีหลังเหมือนเป็นข้อเท็จจริง
 *   4. **ไม่สำเร็จแล้วไม่มีบันทึก** — PIR ที่ไม่มีสิ่งที่ได้เรียนรู้
 *      คือแบบฟอร์มที่กรอกเพื่อให้ครบ ไม่ใช่การทบทวน
 */
import { describe, expect, it } from 'vitest';
import { toUtcDate } from '@itsm/types';

import {
  ContradictoryReviewError,
  NotImplementedYetError,
  REVIEW_NOTES_MAX,
  ReviewNotesRequiredError,
  ReviewNotesTooLongError,
  RollbackAnswerRequiredError,
  normalizeReview,
  type ReviewInput,
} from './change-review';

const NOW = toUtcDate('2028-05-10T00:00:00.000Z');
const STARTED = { start: toUtcDate('2028-05-09T18:00:00.000Z') };

function input(over: Partial<ReviewInput> = {}): ReviewInput {
  return {
    outcome: 'SUCCESS',
    rolledBack: false,
    notes: '',
    window: STARTED,
    now: NOW,
    ...over,
  };
}

// ============================================================

describe('ทบทวนหลังทำ · A · เมื่อไรถึงทบทวนได้', () => {
  /** ทบทวนสิ่งที่ยังไม่เกิด คือการเดา และจะถูกอ่านทีหลังเหมือนข้อเท็จจริง */
  it('**งานที่ยังไม่ได้กำหนดช่วงเวลาดำเนินการ ทบทวนไม่ได้**', () => {
    expect(() => normalizeReview(input({ window: null }))).toThrow(NotImplementedYetError);
  });

  it('**ช่วงเวลายังไม่ถึง ทบทวนไม่ได้**', () => {
    expect(() =>
      normalizeReview(input({ window: { start: toUtcDate('2028-06-01T00:00:00.000Z') } })),
    ).toThrow(NotImplementedYetError);
  });

  it('เริ่มไปแล้ว ทบทวนได้', () => {
    expect(normalizeReview(input()).outcome).toBe('SUCCESS');
  });

  /**
   * ขอบเขตเป็น `[start, …)` เหมือนหน้าต่างเวลา — เริ่มพอดีวินาทีนี้ถือว่า
   * เริ่มแล้ว · ถ้าใช้ `<` คนที่กดทบทวนตรงเวลาเป๊ะจะถูกปฏิเสธโดยไม่มีเหตุผล
   * ที่อธิบายได้ และมันจะเกิดปีละไม่กี่ครั้งจนไม่มีใครหาสาเหตุเจอ
   */
  it('**เริ่มพอดีวินาทีนี้ ถือว่าเริ่มแล้ว**', () => {
    expect(() => normalizeReview(input({ window: { start: NOW } }))).not.toThrow();
  });
});

// ============================================================

describe('ทบทวนหลังทำ · B · ความขัดแย้งที่ต้องปฏิเสธ', () => {
  it('**"สำเร็จ" ทั้งที่ย้อนกลับไปแล้ว ถูกปฏิเสธ**', () => {
    expect(() => normalizeReview(input({ outcome: 'SUCCESS', rolledBack: true }))).toThrow(
      ContradictoryReviewError,
    );
  });

  /**
   * **คำถามที่สำคัญที่สุดของทั้ง PIR**
   *
   * "ล้มเหลว" ที่ไม่บอกว่าย้อนกลับแล้วหรือยัง ทำให้ไม่มีใครรู้ว่าตอนนี้ระบบ
   * อยู่ในสภาพเดิมหรือสภาพครึ่ง ๆ กลาง ๆ · `null` แปลว่ายังไม่ตอบ
   * ซึ่งต่างจาก `false` ที่แปลว่าตอบแล้วว่าไม่ได้ย้อน
   */
  it('**"ล้มเหลว" ที่ไม่ตอบว่าย้อนกลับหรือยัง ถูกปฏิเสธ**', () => {
    expect(() =>
      normalizeReview(input({ outcome: 'FAILED', rolledBack: null, notes: 'ไดรเวอร์ไม่รองรับ' })),
    ).toThrow(RollbackAnswerRequiredError);
  });

  it('**"สำเร็จบางส่วน" ที่ไม่ตอบว่าย้อนกลับหรือยัง ก็ถูกปฏิเสธ**', () => {
    expect(() =>
      normalizeReview(input({ outcome: 'PARTIAL', rolledBack: null, notes: 'ย้ายได้แค่ครึ่ง' })),
    ).toThrow(RollbackAnswerRequiredError);
  });

  /** "สำเร็จ" ที่ไม่ตอบ ถือว่าไม่ได้ย้อน — ไม่มีทางอื่นที่สำเร็จได้ */
  it('"สำเร็จ" ที่ไม่ตอบ ผ่าน และถือว่าไม่ได้ย้อนกลับ', () => {
    expect(normalizeReview(input({ outcome: 'SUCCESS', rolledBack: null })).rolledBack).toBe(false);
  });

  it('"ล้มเหลว" ที่ตอบว่าย้อนกลับแล้ว ผ่าน', () => {
    const r = normalizeReview(
      input({ outcome: 'FAILED', rolledBack: true, notes: 'ไดรเวอร์ไม่รองรับ' }),
    );
    expect(r.rolledBack).toBe(true);
  });
});

// ============================================================

describe('ทบทวนหลังทำ · C · บันทึกสิ่งที่ได้เรียนรู้', () => {
  /** PIR ที่ไม่มีสิ่งที่ได้เรียนรู้ คือแบบฟอร์มที่กรอกเพื่อให้ครบ */
  it('**ไม่สำเร็จแล้วไม่มีบันทึก ถูกปฏิเสธ**', () => {
    expect(() =>
      normalizeReview(input({ outcome: 'FAILED', rolledBack: true, notes: '' })),
    ).toThrow(ReviewNotesRequiredError);
  });

  it('**ช่องว่างล้วนไม่นับว่ามีบันทึก**', () => {
    expect(() =>
      normalizeReview(input({ outcome: 'PARTIAL', rolledBack: false, notes: '   \n  ' })),
    ).toThrow(ReviewNotesRequiredError);
  });

  it('สำเร็จแล้วไม่เขียนบันทึก ผ่าน — ไม่ใช่ทุกครั้งที่มีอะไรให้เรียนรู้', () => {
    expect(() => normalizeReview(input({ outcome: 'SUCCESS', notes: '' }))).not.toThrow();
  });

  /**
   * **ยาวเกินแล้วปฏิเสธ ไม่ใช่ตัดเงียบ ๆ**
   *
   * การตัดทิ้งทำให้คนเขียนบทเรียนยาว ๆ แล้วสูญเสียท่อนท้ายไปโดยไม่รู้ตัว —
   * ท่อนท้ายมักเป็นข้อสรุป
   */
  it('**บันทึกที่ยาวเกินเพดาน ถูกปฏิเสธ ไม่ใช่ตัดทิ้ง**', () => {
    const long = 'ก'.repeat(REVIEW_NOTES_MAX + 1);
    expect(() => normalizeReview(input({ notes: long }))).toThrow(ReviewNotesTooLongError);
  });

  it('ยาวเท่าเพดานพอดี ผ่าน', () => {
    expect(() =>
      normalizeReview(input({ notes: 'ก'.repeat(REVIEW_NOTES_MAX) })),
    ).not.toThrow();
  });
});

// ============================================================

describe('ทบทวนหลังทำ · D · ค่าที่คืนออกมา', () => {
  it('ตัดช่องว่างหัวท้ายของบันทึก', () => {
    const r = normalizeReview(input({ notes: '  ย้ายสำเร็จ ใช้เวลาน้อยกว่าที่คิด  ' }));
    expect(r.notes).toBe('ย้ายสำเร็จ ใช้เวลาน้อยกว่าที่คิด');
  });

  /** บันทึกว่างคืน `null` ไม่ใช่สตริงว่าง — "ไม่ได้เขียน" กับ "เขียนว่าง" คนละเรื่อง */
  it('บันทึกว่างคืน `null` ไม่ใช่สตริงว่าง', () => {
    expect(normalizeReview(input({ notes: '   ' })).notes).toBeNull();
  });

  it('ไม่แก้ข้อมูลที่รับเข้ามา', () => {
    const i = input({ notes: '  มีช่องว่าง  ', rolledBack: null });
    const snapshot = JSON.stringify(i);
    normalizeReview(i);
    expect(JSON.stringify(i)).toBe(snapshot);
  });
});
