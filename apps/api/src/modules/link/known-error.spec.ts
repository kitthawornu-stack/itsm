/**
 * ข้อกำหนดของ "วิธีแก้จากปัญหาที่เป็นสาเหตุ" — **เขียนก่อนโค้ด**
 *
 * ITIL เรียกปัญหาที่รู้สาเหตุและมีวิธีแก้ชั่วคราวแล้วว่า Known Error ·
 * คุณค่าทั้งหมดของมันอยู่ที่ **คนที่รับเรื่องใบใหม่ได้เห็นวิธีแก้ทันที**
 * ไม่ใช่ที่การมีบทความเก็บไว้เฉย ๆ
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 *   1. **ไม่แสดงทั้งที่มี** — คนรับเรื่องไล่แก้เองใหม่ทุกครั้ง และไม่มีอะไรบอก
 *      ว่ามีคำตอบอยู่แล้ว · นี่คือความล้มเหลวที่ ITIL ทั้งกระบวนการมีไว้กัน
 *   2. **แสดงของที่ใช้ไม่ได้แล้ว** — ปัญหาที่แก้ถาวรไปแล้ว วิธีแก้ชั่วคราว
 *      ของมันอาจพาไปผิดทาง · ต้องบอกว่าปัญหานั้นปิดแล้ว ไม่ใช่ซ่อนหรือปล่อยผ่าน
 */
import { describe, expect, it } from 'vitest';

import { workaroundsFrom, type CausingProblem } from './known-error';

function problem(over: Partial<CausingProblem> = {}): CausingProblem {
  return {
    itemKey: 'PRB-1',
    summary: 'เซิร์ฟเวอร์พิมพ์ค้างเมื่อคิวยาว',
    resolved: false,
    articles: [{ id: 'a1', title: 'วิธีแก้ชั่วคราว: ล้างคิวพิมพ์' }],
    ...over,
  };
}

// ============================================================

describe('Known Error · A · เมื่อไรถึงมีอะไรให้แสดง', () => {
  it('ปัญหาที่มีบทความ ให้วิธีแก้ออกมา', () => {
    const r = workaroundsFrom([problem()]);
    expect(r).toHaveLength(1);
    expect(r[0]?.articleId).toBe('a1');
  });

  /** แผงว่างเปล่าคือเสียงรบกวน — ไม่มีบทความก็ไม่ต้องมีแผง */
  it('ปัญหาที่ยังไม่มีบทความ ไม่ให้อะไรออกมา', () => {
    expect(workaroundsFrom([problem({ articles: [] })])).toEqual([]);
  });

  it('ไม่มีปัญหาที่เป็นสาเหตุเลย ได้รายการว่าง', () => {
    expect(workaroundsFrom([])).toEqual([]);
  });

  it('รวมบทความจากปัญหาหลายใบ', () => {
    const r = workaroundsFrom([
      problem({ itemKey: 'PRB-1', articles: [{ id: 'a1', title: 'ก' }] }),
      problem({ itemKey: 'PRB-2', articles: [{ id: 'a2', title: 'ข' }] }),
    ]);
    expect(r.map((x) => x.articleId)).toEqual(['a1', 'a2']);
  });
});

// ============================================================

describe('Known Error · B · บอกว่ามาจากปัญหาใบไหน', () => {
  /**
   * คนอ่านต้องรู้ว่าวิธีแก้นี้เป็นของ **ปัญหาที่เป็นสาเหตุ** ไม่ใช่ของตั๋วใบนี้
   *
   * ถ้าไม่บอก มันจะดูเหมือนบทความที่มีคนแนบไว้กับตั๋วนี้เอง แล้วคนจะแก้
   * บทความนั้นด้วยรายละเอียดของเคสตัวเอง — ทำลายคำตอบที่ใช้ได้กับทุกเคส
   */
  it('ทุกวิธีแก้บอกคีย์และหัวเรื่องของปัญหาต้นทาง', () => {
    const r = workaroundsFrom([problem({ itemKey: 'PRB-9', summary: 'เน็ตชั้น 3 หลุด' })]);
    expect(r[0]?.problemKey).toBe('PRB-9');
    expect(r[0]?.problemSummary).toBe('เน็ตชั้น 3 หลุด');
  });

  it('บทความเดียวกันจากปัญหาสองใบ ไม่ซ้ำในรายการ', () => {
    const r = workaroundsFrom([
      problem({ itemKey: 'PRB-1', articles: [{ id: 'a1', title: 'ก' }] }),
      problem({ itemKey: 'PRB-2', articles: [{ id: 'a1', title: 'ก' }] }),
    ]);
    expect(r).toHaveLength(1);
  });

  /** ใบแรกที่พบเป็นเจ้าของ — ลำดับคงที่ ทำให้หน้าจอไม่สลับไปมาระหว่างรีเฟรช */
  it('บทความที่ซ้ำ ยกให้ปัญหาใบแรกที่พบ', () => {
    const r = workaroundsFrom([
      problem({ itemKey: 'PRB-1', articles: [{ id: 'a1', title: 'ก' }] }),
      problem({ itemKey: 'PRB-2', articles: [{ id: 'a1', title: 'ก' }] }),
    ]);
    expect(r[0]?.problemKey).toBe('PRB-1');
  });
});

// ============================================================

describe('Known Error · C · ปัญหาที่แก้ถาวรไปแล้ว', () => {
  /**
   * **บอก ไม่ใช่ซ่อน**
   *
   * ปัญหาที่ปิดแล้วอาจแปลว่ามีการแก้ถาวรไปแล้ว — ตั๋วใบนี้ที่ยังค้างอยู่
   * อาจแค่ยังไม่ได้รับการแก้นั้น · การซ่อนบทความทิ้งทำให้คนรับเรื่องไม่รู้
   * ว่ามีคำตอบ ส่วนการแสดงโดยไม่บอกว่าปัญหาปิดแล้ว อาจพาไปทำวิธีแก้ชั่วคราว
   * ทั้งที่มีวิธีแก้ถาวรอยู่
   */
  it('ปัญหาที่ปิดแล้ว ยังให้วิธีแก้ออกมา', () => {
    const r = workaroundsFrom([problem({ resolved: true })]);
    expect(r).toHaveLength(1);
  });

  it('และติดธงว่าปัญหาต้นทางปิดแล้ว', () => {
    expect(workaroundsFrom([problem({ resolved: true })])[0]?.problemResolved).toBe(true);
  });

  it('ปัญหาที่ยังไม่ปิด ไม่ติดธง', () => {
    expect(workaroundsFrom([problem()])[0]?.problemResolved).toBe(false);
  });

  /**
   * ปัญหาที่ยังเปิดอยู่มาก่อน — คนที่กำลังรับเรื่องต้องเห็นอันที่ยังเกี่ยวข้องก่อน
   */
  it('เรียงปัญหาที่ยังเปิดอยู่ไว้บนสุด', () => {
    const r = workaroundsFrom([
      problem({ itemKey: 'PRB-เก่า', resolved: true, articles: [{ id: 'a1', title: 'ก' }] }),
      problem({ itemKey: 'PRB-ใหม่', resolved: false, articles: [{ id: 'a2', title: 'ข' }] }),
    ]);
    expect(r.map((x) => x.problemKey)).toEqual(['PRB-ใหม่', 'PRB-เก่า']);
  });

  it('ไม่แก้รายการที่รับเข้ามา', () => {
    const input = [problem({ resolved: true }), problem({ itemKey: 'PRB-2' })];
    const snapshot = JSON.stringify(input);
    workaroundsFrom(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
