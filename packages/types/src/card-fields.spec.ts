/**
 * ข้อกำหนดของ "เลือกว่าการ์ดบนกระดานจะแสดงอะไร" — **เขียนก่อนโค้ด**
 *
 * ## ทำไมต้องมีไฟล์นี้
 *
 * การ์ดบนกระดานแสดงอะไรได้ไม่กี่อย่างก่อนจะอ่านไม่ทัน · ทีมที่ทำงานตาม
 * ผู้รับผิดชอบกับทีมที่ทำงานตามความเร่งด่วน ต้องการคนละอย่าง
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 *   1. **"ไม่เลือกอะไรเลย" ถูกอ่านเป็น "ใช้ค่าปริยาย"** — ผู้ใช้ที่ตั้งใจ
 *      ปิดทุกอย่างจะได้ค่าปริยายกลับมา แล้วเชื่อว่าปุ่มบันทึกพัง ·
 *      **ไม่มีแถว** กับ **แถวที่ว่างเปล่า** ต้องต่างกันให้ขาด เหมือนกับ
 *      นโยบายระยะเวลาเก็บข้อมูลที่ "ไม่มีแถว = เก็บตลอดไป"
 *   2. **ชื่อฟิลด์ที่ไม่รู้จักถูกทิ้งเงียบ ๆ** — ข้อมูลเก่าหรือฟิลด์ที่ถูกลบ
 *      ทำให้การตั้งค่าหายไปทีละอย่างโดยไม่มีใครรู้ · ต้องบอกได้ว่าทิ้งอะไรไป
 *   3. **ปิดคีย์งานหรือหัวข้อได้** — การ์ดที่ไม่มีคีย์คือการ์ดที่พูดถึงกับ
 *      คนอื่นไม่ได้ · สองอย่างนี้ไม่ใช่ตัวเลือก จึงไม่อยู่ในรายการเลย
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_CARD_FIELDS,
  CARD_FIELD_LABEL,
  DEFAULT_CARD_FIELDS,
  formatCardFields,
  parseCardFields,
} from './card-fields';

describe('ฟิลด์บนการ์ด', () => {
  describe('A · รายการที่เลือกได้', () => {
    it('มีตัวเลือกมากกว่าหนึ่ง มิฉะนั้นไม่มีอะไรให้เลือก', () => {
      expect(ALL_CARD_FIELDS.length).toBeGreaterThan(2);
    });

    /**
     * **คีย์งานกับหัวข้อไม่ใช่ตัวเลือก**
     *
     * การ์ดที่ไม่มีคีย์ พูดถึงกับคนอื่นไม่ได้ · การ์ดที่ไม่มีหัวข้อ
     * ไม่มีใครรู้ว่ามันคือเรื่องอะไร · จึงไม่อยู่ในรายการเลย
     * ไม่ใช่อยู่แล้วปิดไม่ได้ — ตัวเลือกที่กดไม่ได้คือหน้าจอที่หลอกคน
     */
    it('**คีย์งานกับหัวข้อไม่อยู่ในรายการที่เลือกได้**', () => {
      expect(ALL_CARD_FIELDS).not.toContain('itemKey');
      expect(ALL_CARD_FIELDS).not.toContain('summary');
    });

    it('ทุกตัวเลือกมีป้ายภาษาไทย ไม่ใช่ชื่อฟิลด์ดิบ', () => {
      for (const f of ALL_CARD_FIELDS) {
        const label = CARD_FIELD_LABEL[f];
        expect(label, `ฟิลด์ "${f}" ไม่มีป้าย`).toBeDefined();
        expect(label).not.toBe(f);
        // ป้ายที่ผู้ใช้เห็นต้องเป็นภาษาคน — ต้องมีอักษรไทยอย่างน้อยหนึ่งตัว
        expect(label, `ป้ายของ "${f}" ไม่ใช่ภาษาไทย`).toMatch(/[฀-๿]/);
      }
    });

    it('ค่าปริยายเป็นส่วนย่อยของรายการที่เลือกได้', () => {
      for (const f of DEFAULT_CARD_FIELDS) expect(ALL_CARD_FIELDS).toContain(f);
    });
  });

  describe('B · อ่านค่าที่เก็บไว้', () => {
    it('อ่านรายการปกติได้', () => {
      const got = parseCardFields('priority,assignee');
      expect(got.fields).toEqual(['priority', 'assignee']);
      expect(got.unknown).toEqual([]);
    });

    it('เว้นวรรคเกินไม่ทำให้อ่านผิด', () => {
      expect(parseCardFields('  priority , assignee ').fields).toEqual(['priority', 'assignee']);
    });

    it('ลำดับที่ผู้ใช้ตั้งไว้ถูกรักษาไว้ — ไม่ใช่เรียงใหม่ตามรายการหลัก', () => {
      expect(parseCardFields('assignee,priority').fields).toEqual(['assignee', 'priority']);
    });

    it('ชื่อซ้ำถูกยุบ — แสดงสองครั้งไม่ได้แปลว่าอะไร', () => {
      expect(parseCardFields('priority,priority').fields).toEqual(['priority']);
    });

    /**
     * **หัวใจของหมวดนี้**
     *
     * ไม่มีแถว (`null`) = ยังไม่เคยตั้ง จึงใช้ค่าปริยาย ·
     * แถวที่ว่างเปล่า (`''`) = ตั้งใจปิดทุกอย่าง จึงต้องได้รายการว่าง ·
     * ถ้าสองอย่างนี้ให้ผลเหมือนกัน ผู้ใช้ที่ปิดทุกอย่างจะได้ค่าปริยายกลับมา
     * แล้วเชื่อว่าปุ่มบันทึกพัง
     */
    it('**ยังไม่เคยตั้ง (`null`) = ค่าปริยาย**', () => {
      expect(parseCardFields(null).fields).toEqual([...DEFAULT_CARD_FIELDS]);
    });

    it('**ตั้งใจปิดทุกอย่าง (`""`) = ไม่แสดงอะไรเลย ไม่ใช่ค่าปริยาย**', () => {
      expect(parseCardFields('').fields).toEqual([]);
      expect(parseCardFields('   ').fields).toEqual([]);
    });

    /**
     * **ชื่อที่ไม่รู้จักต้องถูกรายงาน ไม่ใช่หายเงียบ**
     *
     * ข้อมูลเก่าหรือฟิลด์ที่ถูกลบ ทำให้การตั้งค่าหายไปทีละอย่าง ·
     * ผู้เรียกต้องเลือกได้ว่าจะบอกผู้ใช้หรือเก็บกวาดให้
     */
    it('**ชื่อที่ไม่รู้จักถูกแยกออกมา ไม่ใช่ทิ้งเงียบ**', () => {
      const got = parseCardFields('priority,ฟิลด์ที่ถูกลบไปแล้ว,assignee');
      expect(got.fields).toEqual(['priority', 'assignee']);
      expect(got.unknown).toEqual(['ฟิลด์ที่ถูกลบไปแล้ว']);
    });

    it('ทุกชื่อไม่รู้จัก = รายการว่าง แต่รายงานครบ', () => {
      const got = parseCardFields('ก,ข');
      expect(got.fields).toEqual([]);
      expect(got.unknown).toEqual(['ก', 'ข']);
    });
  });

  describe('C · เขียนค่ากลับ', () => {
    it('เขียนแล้วอ่านกลับได้ค่าเดิม', () => {
      const raw = formatCardFields(['assignee', 'priority']);
      expect(parseCardFields(raw).fields).toEqual(['assignee', 'priority']);
    });

    /**
     * **รายการว่างต้องเขียนเป็นสตริงว่าง ไม่ใช่ `null`**
     *
     * `null` แปลว่า "ยังไม่เคยตั้ง" ซึ่งเป็นคนละเรื่องกับ "ตั้งใจปิดทุกอย่าง"
     */
    it('**รายการว่างเขียนเป็นสตริงว่าง ซึ่งอ่านกลับได้ว่าว่างจริง**', () => {
      expect(formatCardFields([])).toBe('');
      expect(parseCardFields(formatCardFields([])).fields).toEqual([]);
    });

    it('ชื่อที่ไม่รู้จักเขียนลงไปไม่ได้', () => {
      expect(() => formatCardFields(['ไม่มีฟิลด์นี้' as never])).toThrow();
    });
  });
});
