/**
 * สายอนุมัติหลายขั้น — เทสต์เป็นข้อกำหนด
 *
 * ห้าข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **เรียงด้วย `stepNumber` ไม่ใช่เวลาที่สร้าง** — ทุกขั้นถูกสร้างใน
 *      ทรานแซกชันเดียวกัน เวลาที่บันทึกจึงเท่ากันได้ทั้งสาย · เรียงด้วยเวลา
 *      แล้วผู้อนุมัติขั้นที่สามอาจได้ตัดสินก่อนขั้นที่หนึ่ง
 *   2. **ปฏิเสธหนึ่งขั้น = จบทั้งสาย** และขั้นที่เหลือต้องถูกยกเลิก ไม่ใช่ค้าง
 *      เป็น `WAITING` ตลอดกาล ซึ่งทำให้ตอบไม่ได้ว่าสายนี้จบหรือยัง
 *   3. **คนเดียวกันตัดสินสองขั้นไม่ได้** — สายอนุมัติมีไว้ให้หลายสายตาดู ·
 *      คนที่อยู่ทั้งสองกลุ่มจะทำให้สายสามขั้นกลายเป็นขั้นเดียว โดยหน้าจอยัง
 *      แสดงว่าสามขั้น
 *   4. **ทุกขั้นต้องอนุมัติครบ จึงจะถือว่าอนุมัติ** — สายที่มีขั้นถูกยกเลิก
 *      ปนอยู่ ไม่ใช่สายที่อนุมัติแล้ว
 *   5. **ตัดสินข้ามคิวไม่ได้** และข้อความต้องบอกว่าตอนนี้รอขั้นไหนอยู่
 */
import { describe, expect, it } from 'vitest';

import {
  AlreadyDecidedInChainError,
  NotYourTurnError,
  chainState,
  currentStep,
  planDecision,
  type ChainStep,
} from './approval-chain';

/** สายสามขั้น — ขั้นแรกรออยู่ ที่เหลือยังไม่ถึงคิว */
function fresh(): ChainStep[] {
  return [
    { stepNumber: 1, status: 'PENDING', decidedById: null },
    { stepNumber: 2, status: 'WAITING', decidedById: null },
    { stepNumber: 3, status: 'WAITING', decidedById: null },
  ];
}

describe('A · ขั้นที่รออยู่', () => {
  it('**เรียงด้วย stepNumber ไม่ใช่ลำดับในอาร์เรย์**', () => {
    /*
      ทุกขั้นถูกสร้างในทรานแซกชันเดียวกัน `createdAt` จึงเท่ากันได้ทั้งสาย ·
      ฐานข้อมูลไม่รับประกันลำดับที่คืนมา · เทสต์นี้จึงสลับลำดับให้ผิดตั้งแต่ต้น
    */
    const shuffled: ChainStep[] = [
      { stepNumber: 3, status: 'WAITING', decidedById: null },
      { stepNumber: 1, status: 'PENDING', decidedById: null },
      { stepNumber: 2, status: 'WAITING', decidedById: null },
    ];
    expect(currentStep(shuffled)?.stepNumber).toBe(1);
  });

  it('**ขั้นถัดไปต้องเป็นขั้นที่ติดกัน ไม่ใช่ขั้นที่บังเอิญมาก่อนในอาร์เรย์**', () => {
    /*
      เคสเดียวที่พิสูจน์ว่าการเรียงมีผลจริง · เคส "หาขั้นที่รออยู่" ข้างบน
      มีขั้น PENDING ขั้นเดียว ลำดับจึงไม่เปลี่ยนคำตอบ — ลบการเรียงทิ้งก็ยังเขียว
      (พิสูจน์แล้วตอนลบทีละบรรทัด)

      ที่นี่ ถ้าไม่เรียง `find` จะเจอขั้นที่ 3 ก่อนขั้นที่ 2 แล้วสายจะข้าม
      ผู้อนุมัติไปหนึ่งคนโดยไม่มีอะไรฟ้อง
    */
    const shuffled: ChainStep[] = [
      { stepNumber: 3, status: 'WAITING', decidedById: null },
      { stepNumber: 1, status: 'PENDING', decidedById: null },
      { stepNumber: 2, status: 'WAITING', decidedById: null },
    ];
    expect(planDecision(shuffled, 1, 'u1', true).opensNext).toBe(2);
    // และการยกเลิกต้องเรียงตามขั้นจริงด้วย ไม่ใช่ตามลำดับในอาร์เรย์
    expect(planDecision(shuffled, 1, 'u1', false).cancels).toEqual([2, 3]);
  });

  it('สายที่จบแล้วไม่มีขั้นที่รออยู่', () => {
    const done: ChainStep[] = [{ stepNumber: 1, status: 'APPROVED', decidedById: 'u1' }];
    expect(currentStep(done)).toBeNull();
  });
});

describe('B · สถานะของทั้งสาย', () => {
  it('มีขั้นที่รออยู่ = รออนุมัติ', () => {
    expect(chainState(fresh())).toBe('pending');
  });

  it('**ทุกขั้นอนุมัติครบ จึงจะอนุมัติ**', () => {
    const two: ChainStep[] = [
      { stepNumber: 1, status: 'APPROVED', decidedById: 'u1' },
      { stepNumber: 2, status: 'PENDING', decidedById: null },
    ];
    // ขั้นแรกผ่านแล้ว แต่ยังไม่จบ — การตอบว่า "อนุมัติแล้ว" ตรงนี้ทำให้งาน
    // เดินต่อทั้งที่ยังไม่ผ่าน CAB
    expect(chainState(two)).toBe('pending');

    two[1] = { stepNumber: 2, status: 'APPROVED', decidedById: 'u2' };
    expect(chainState(two)).toBe('approved');
  });

  it('**ปฏิเสธขั้นไหนก็ตาม = ทั้งสายถูกปฏิเสธ**', () => {
    const mixed: ChainStep[] = [
      { stepNumber: 1, status: 'APPROVED', decidedById: 'u1' },
      { stepNumber: 2, status: 'REJECTED', decidedById: 'u2' },
      { stepNumber: 3, status: 'CANCELLED', decidedById: null },
    ];
    expect(chainState(mixed)).toBe('rejected');
  });

  it('**สายที่มีขั้นถูกยกเลิกปนอยู่ ไม่ใช่สายที่อนุมัติแล้ว**', () => {
    /*
      งานที่ถูกปิดไปก่อนจะทำให้ขั้นที่เหลือถูกยกเลิก · การตอบว่า "อนุมัติแล้ว"
      ทำให้รายงานนับมันเป็นการอนุมัติที่ผ่านจริง ซึ่งไม่เคยเกิดขึ้น
    */
    const cancelled: ChainStep[] = [
      { stepNumber: 1, status: 'APPROVED', decidedById: 'u1' },
      { stepNumber: 2, status: 'CANCELLED', decidedById: null },
    ];
    expect(chainState(cancelled)).toBe('none');
  });

  it('ไม่มีขั้นเลย = ยังไม่เคยขอ', () => {
    expect(chainState([])).toBe('none');
  });
});

describe('C · การตัดสินหนึ่งครั้ง', () => {
  it('อนุมัติขั้นแรก เปิดขั้นที่สอง และยังไม่จบ', () => {
    const plan = planDecision(fresh(), 1, 'u1', true);
    expect(plan).toEqual({ step: 1, opensNext: 2, cancels: [], finishes: false });
  });

  it('อนุมัติขั้นสุดท้าย = จบสาย ไม่มีขั้นถัดไป', () => {
    const last: ChainStep[] = [
      { stepNumber: 1, status: 'APPROVED', decidedById: 'u1' },
      { stepNumber: 2, status: 'PENDING', decidedById: null },
    ];
    expect(planDecision(last, 2, 'u2', true)).toEqual({
      step: 2,
      opensNext: null,
      cancels: [],
      finishes: true,
    });
  });

  it('**ปฏิเสธแล้วขั้นที่เหลือถูกยกเลิก ไม่ค้างเป็น WAITING**', () => {
    /*
      แถว `WAITING` ที่ค้างอยู่ทำให้ตอบไม่ได้ว่าสายนี้จบหรือยัง และคำขอใบใหม่
      จะถูกกันไว้ด้วยเหตุผลที่ไม่มีใครเข้าใจ
    */
    const plan = planDecision(fresh(), 1, 'u1', false);
    expect(plan).toEqual({ step: 1, opensNext: null, cancels: [2, 3], finishes: true });
  });

  it('ปฏิเสธขั้นกลาง ยกเลิกเฉพาะขั้นที่อยู่หลังมัน', () => {
    const mid: ChainStep[] = [
      { stepNumber: 1, status: 'APPROVED', decidedById: 'u1' },
      { stepNumber: 2, status: 'PENDING', decidedById: null },
      { stepNumber: 3, status: 'WAITING', decidedById: null },
    ];
    expect(planDecision(mid, 2, 'u2', false).cancels).toEqual([3]);
  });
});

describe('D · สิ่งที่ต้องปฏิเสธ', () => {
  it('**ตัดสินข้ามคิวไม่ได้ และต้องบอกว่ารอขั้นไหนอยู่**', () => {
    /*
      ข้อความที่บอกแค่ "ทำไม่ได้" ทำให้ผู้อนุมัติขั้นที่สามไม่รู้ว่าต้องรอใคร
      แล้วไปถามผิดคน
    */
    expect(() => planDecision(fresh(), 3, 'u3', true)).toThrow(NotYourTurnError);
    try {
      planDecision(fresh(), 3, 'u3', true);
    } catch (e) {
      expect(String(e)).toContain('ขั้นที่ 1');
    }
  });

  it('ตัดสินขั้นที่ผ่านไปแล้วซ้ำไม่ได้', () => {
    const mid: ChainStep[] = [
      { stepNumber: 1, status: 'APPROVED', decidedById: 'u1' },
      { stepNumber: 2, status: 'PENDING', decidedById: null },
    ];
    expect(() => planDecision(mid, 1, 'u1', true)).toThrow(NotYourTurnError);
  });

  it('**คนเดิมตัดสินสองขั้นในสายเดียวกันไม่ได้**', () => {
    /*
      คนที่อยู่ทั้งกลุ่มหัวหน้าทีมและกลุ่ม CAB ถ้าตัดสินได้ทั้งสองขั้น สายสามขั้น
      จะกลายเป็นสายขั้นเดียวโดยที่หน้าจอยังแสดงว่าสามขั้น — การแยกหน้าที่หายไป
      โดยไม่มีใครเห็น
    */
    const mid: ChainStep[] = [
      { stepNumber: 1, status: 'APPROVED', decidedById: 'u1' },
      { stepNumber: 2, status: 'PENDING', decidedById: null },
    ];
    expect(() => planDecision(mid, 2, 'u1', true)).toThrow(AlreadyDecidedInChainError);
    // คนอื่นในกลุ่มเดียวกันยังตัดสินได้ตามปกติ
    expect(planDecision(mid, 2, 'u2', true).finishes).toBe(true);
  });

  it('คนเดิม**ปฏิเสธ**ขั้นที่สองก็ไม่ได้เหมือนกัน', () => {
    // การห้ามต้องไม่ขึ้นกับว่าจะอนุมัติหรือปฏิเสธ — ปัญหาคือคนซ้ำ ไม่ใช่คำตอบ
    const mid: ChainStep[] = [
      { stepNumber: 1, status: 'APPROVED', decidedById: 'u1' },
      { stepNumber: 2, status: 'PENDING', decidedById: null },
    ];
    expect(() => planDecision(mid, 2, 'u1', false)).toThrow(AlreadyDecidedInChainError);
  });
});
