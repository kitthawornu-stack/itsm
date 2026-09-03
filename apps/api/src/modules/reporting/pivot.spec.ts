/**
 * ข้อกำหนดของตารางไขว้ (pivot) — **เขียนก่อนโค้ด**
 *
 * ## ตารางไขว้มีไว้ทำอะไร
 *
 * ตอบคำถามแบบ "งานค้างของแต่ละคน แยกตามสถานะ" ในตารางเดียว ·
 * ผู้ดูแลใช้หาว่ากองไหนใหญ่ผิดปกติ
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 *   1. **ช่องที่ไม่มีข้อมูล หายไปแทนที่จะเป็น 0** — ตารางที่แถวยาวไม่เท่ากัน
 *      ทำให้คอลัมน์เลื่อน แล้วคนอ่านตัวเลขผิดช่อง · เป็นความผิดที่หน้าตา
 *      ยังดูปกติทุกอย่าง
 *   2. **ยอดรวมคำนวณจากคนละที่กับช่อง** — ยอดที่ไม่เท่ากับผลบวกของแถวตัวเอง
 *      แย่กว่าไม่มียอดรวม เพราะคนเชื่อยอดรวมมากกว่าช่อง
 *   3. **ค่าที่ไม่มี (ไม่มีผู้รับผิดชอบ · ไม่ได้จัดระดับ) ถูกทิ้ง** —
 *      กองงานที่ยังไม่มีคนรับคือกองที่สำคัญที่สุดในศูนย์บริการ ·
 *      ถ้าหายไป ผลรวมจะน้อยกว่าความจริงโดยไม่มีอะไรบอก
 *   4. **ลำดับแถวและคอลัมน์ไม่คงที่** — ตารางที่สลับที่กันเองระหว่างรีเฟรช
 *      ทำให้เทียบกับรอบก่อนไม่ได้ และอ่านเหมือนข้อมูลเปลี่ยน
 *   5. **คอลัมน์เยอะเกินจนอ่านไม่ได้** — ต้องตัดพร้อมบอกว่าตัด
 *      ไม่ใช่ตัดเงียบ ๆ แล้วให้คนเชื่อว่านั่นคือทั้งหมด
 */
import { describe, expect, it } from 'vitest';

import { MAX_PIVOT_COLUMNS, NO_VALUE_LABEL, buildPivot } from './pivot';

/** ข้อมูลตัวอย่าง: สองคน สามสถานะ และงานที่ยังไม่มีผู้รับผิดชอบหนึ่งใบ */
const facts = [
  { row: 'สมชาย', col: 'ใหม่', n: 3 },
  { row: 'สมชาย', col: 'กำลังทำ', n: 2 },
  { row: 'มาลี', col: 'ใหม่', n: 1 },
  { row: null, col: 'ใหม่', n: 5 },
];

describe('ตารางไขว้', () => {
  describe('A · รูปร่างของตาราง', () => {
    it('แถวและคอลัมน์มาจากข้อมูลจริง ไม่ใช่รายการที่เขียนไว้', () => {
      const t = buildPivot(facts);
      expect(t.columns).toEqual(['กำลังทำ', 'ใหม่']);
      expect(t.rows.map((r) => r.label)).toEqual([NO_VALUE_LABEL, 'มาลี', 'สมชาย']);
    });

    /**
     * **ทุกแถวมีช่องครบทุกคอลัมน์**
     *
     * ตารางที่แถวยาวไม่เท่ากันทำให้คอลัมน์เลื่อน แล้วคนอ่านตัวเลขผิดช่อง
     * โดยที่หน้าตายังดูปกติทุกอย่าง
     */
    it('**ช่องที่ไม่มีข้อมูลเป็น 0 ไม่ใช่หายไป**', () => {
      const t = buildPivot(facts);
      for (const r of t.rows) {
        expect(r.cells, `แถว "${r.label}" มีช่องไม่ครบ`).toHaveLength(t.columns.length);
      }
      const malee = t.rows.find((r) => r.label === 'มาลี');
      expect(malee?.cells).toEqual([0, 1]);
    });

    /**
     * **ค่าที่ไม่มี ได้แถวของตัวเองที่มีชื่อ**
     *
     * กติกาเดียวกับเลนบนกระดาน — งานที่ยังไม่มีผู้รับผิดชอบคือกองที่สำคัญ
     * ที่สุด ถ้าหายไปผลรวมจะน้อยกว่าความจริงโดยไม่มีอะไรบอก
     */
    it('**ค่าที่เป็น null ได้แถวของตัวเอง และอยู่บนสุด**', () => {
      const t = buildPivot(facts);
      expect(t.rows[0]?.label).toBe(NO_VALUE_LABEL);
      expect(t.rows[0]?.total).toBe(5);
    });

    it('คอลัมน์ที่เป็น null ก็ได้ชื่อเดียวกัน', () => {
      const t = buildPivot([{ row: 'ก', col: null, n: 2 }]);
      expect(t.columns).toEqual([NO_VALUE_LABEL]);
    });

    it('ข้อมูลว่างเปล่า = ตารางว่าง ไม่ใช่พัง', () => {
      const t = buildPivot([]);
      expect(t.rows).toEqual([]);
      expect(t.columns).toEqual([]);
      expect(t.grandTotal).toBe(0);
    });
  });

  describe('B · ยอดรวม', () => {
    /**
     * **ยอดรวมต้องคำนวณจากช่องเดียวกับที่แสดง**
     *
     * ยอดที่ไม่เท่ากับผลบวกของแถวตัวเอง แย่กว่าไม่มียอดรวม เพราะคนเชื่อ
     * ยอดรวมมากกว่าช่อง แล้วเอาไปใช้ต่อ
     */
    it('**ยอดของแถว = ผลบวกของช่องในแถวนั้นเสมอ**', () => {
      for (const r of buildPivot(facts).rows) {
        expect(r.total, `ยอดของแถว "${r.label}" ไม่ตรงกับผลบวกช่อง`).toBe(
          r.cells.reduce((a, b) => a + b, 0),
        );
      }
    });

    it('**ยอดของคอลัมน์ = ผลบวกของช่องในคอลัมน์นั้นเสมอ**', () => {
      const t = buildPivot(facts);
      t.columnTotals.forEach((total, i) => {
        const sum = t.rows.reduce((a, r) => a + (r.cells[i] ?? 0), 0);
        expect(total, `ยอดของคอลัมน์ "${t.columns[i] ?? ''}" ไม่ตรง`).toBe(sum);
      });
    });

    it('**ยอดรวมใหญ่ = ผลบวกของทุกช่อง**', () => {
      const t = buildPivot(facts);
      const sum = t.rows.reduce((a, r) => a + r.cells.reduce((x, y) => x + y, 0), 0);
      expect(t.grandTotal).toBe(sum);
      expect(t.grandTotal).toBe(11);
    });

    it('ข้อมูลที่ซ้ำคู่ (แถว, คอลัมน์) ถูกบวกเข้าด้วยกัน ไม่ใช่ทับกัน', () => {
      const t = buildPivot([
        { row: 'ก', col: 'x', n: 2 },
        { row: 'ก', col: 'x', n: 3 },
      ]);
      expect(t.rows[0]?.cells[0]).toBe(5);
    });
  });

  describe('C · ลำดับที่คงที่', () => {
    /**
     * ตารางที่สลับที่กันเองระหว่างรีเฟรช ทำให้เทียบกับรอบก่อนไม่ได้
     * และอ่านเหมือนข้อมูลเปลี่ยนทั้งที่ไม่ได้เปลี่ยน
     */
    it('**ลำดับเดิมเสมอ ไม่ว่าข้อมูลเข้ามาลำดับไหน**', () => {
      const a = buildPivot(facts);
      const b = buildPivot([...facts].reverse());
      expect(b.columns).toEqual(a.columns);
      expect(b.rows.map((r) => r.label)).toEqual(a.rows.map((r) => r.label));
    });

    it('แถวที่ไม่มีค่าอยู่บนสุดเสมอ แม้ชื่อจะเรียงไปอยู่ท้าย', () => {
      const t = buildPivot([
        { row: 'ก', col: 'x', n: 1 },
        { row: null, col: 'x', n: 1 },
      ]);
      expect(t.rows.map((r) => r.label)).toEqual([NO_VALUE_LABEL, 'ก']);
    });
  });

  describe('D · เพดานคอลัมน์', () => {
    /**
     * **ตัดแล้วต้องบอกว่าตัด**
     *
     * ตารางที่ตัดเงียบ ๆ ทำให้คนเชื่อว่านั่นคือทั้งหมด แล้วสรุปผิด ·
     * ยอดรวมยังต้องนับของที่ถูกตัดด้วย มิฉะนั้นตัวเลขจะขัดกับที่อื่น
     */
    it('**คอลัมน์เกินเพดานถูกตัด และรายงานว่าตัดไปกี่อัน**', () => {
      const many = Array.from({ length: MAX_PIVOT_COLUMNS + 5 }, (_, i) => ({
        row: 'ก',
        col: `c${String(i).padStart(3, '0')}`,
        n: 1,
      }));
      const t = buildPivot(many);
      expect(t.columns).toHaveLength(MAX_PIVOT_COLUMNS);
      expect(t.truncatedColumns).toBe(5);
    });

    it('**ยอดรวมใหญ่ยังนับของที่ถูกตัดด้วย**', () => {
      const many = Array.from({ length: MAX_PIVOT_COLUMNS + 5 }, (_, i) => ({
        row: 'ก',
        col: `c${String(i).padStart(3, '0')}`,
        n: 1,
      }));
      const t = buildPivot(many);
      expect(t.grandTotal, 'ยอดรวมนับแต่คอลัมน์ที่เหลือ — ขัดกับตัวเลขที่อื่น').toBe(
        MAX_PIVOT_COLUMNS + 5,
      );
    });

    it('ไม่เกินเพดาน = ไม่ตัด และรายงานว่า 0', () => {
      expect(buildPivot(facts).truncatedColumns).toBe(0);
    });
  });
});
