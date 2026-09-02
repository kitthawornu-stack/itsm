/**
 * ข้อกำหนดของนโยบายระยะเวลาเก็บข้อมูล — **เขียนก่อนโค้ด**
 *
 * ## ทำไมต้องมีไฟล์นี้ และทำไมต้องเขียนก่อน
 *
 * PDPA บังคับว่าข้อมูลส่วนบุคคลต้องไม่ถูกเก็บไว้นานเกินความจำเป็น ·
 * แต่**ฟีเจอร์นี้คือฟีเจอร์ที่ลบข้อมูลของคนอื่นทิ้ง** ซึ่งเป็นชนิดที่โปรเจกต์นี้
 * เจ็บมาแล้ว: ตัวเก็บกวาดเซสชันเคยลบเซสชันจริง 187 แถวทิ้งทั้งหมด เพราะเทสต์
 * ส่ง "ตอนนี้" เป็นปี 2572 เข้าไปให้ฟังก์ชันที่ทำงานกับทุกแถวของทุกองค์กร
 *
 * เอนจินจึงต้องเป็นฟังก์ชันบริสุทธิ์ที่ **ตัดสินว่าจะลบอะไร** โดยไม่ลบเอง ·
 * การลบจริงเป็นคนละชั้น และทดสอบแยก
 *
 * ## สิ่งที่ผิดแล้วเงียบ และร้ายแรงเพราะกู้ไม่ได้
 *
 *   1. **ไม่มีนโยบาย แล้วตีความว่า "ลบได้"** — ค่าปริยายของทุกคิวรีคือ
 *      ไม่กรอง · ถ้าเผลอ องค์กรที่ไม่เคยตั้งอะไรเลยจะถูกลบข้อมูลทิ้ง
 *      **ไม่มีนโยบาย ต้องแปลว่าเก็บตลอดไป**
 *   2. **`keepDays` เป็น 0** — ลบทุกอย่างรวมของวันนี้ · แทบไม่มีทางเป็น
 *      เจตนาจริง เป็นค่าที่หลุดมาจากช่องว่างหรือการพิมพ์ผิด
 *   3. **ตั้งสั้นเกินกับตารางที่ใช้กู้คืน** — `work_item_history` และ
 *      `audit_log` เป็นที่เดียวที่รู้ว่าค่าเดิมคืออะไร · ลบทิ้งแล้วความเสียหาย
 *      ครั้งถัดไปจะกู้ไม่ได้เลย (CLAUDE.md: อย่าให้ตัวเก็บกวาดลบสิ่งที่ใช้กู้คืน)
 *   4. **อ่านนาฬิกาเอง** — ทดสอบไม่ได้ และเทสต์ที่ปลอมเวลาจะไปโดนแถวจริง
 */
import { describe, expect, it } from 'vitest';

import {
  RETENTION_TARGETS,
  InvalidKeepDaysError,
  UnknownRetentionTargetError,
  cutoffFor,
  planRetention,
  targetByKey,
} from './retention';

const NOW = new Date('2026-09-02T00:00:00.000Z');

describe('ระยะเวลาเก็บ · A · รายการตารางที่ตั้งได้', () => {
  it('มีตารางให้ตั้งจริง — ไม่ใช่รายการว่างที่ทำให้ทุกอย่างผ่าน', () => {
    expect(RETENTION_TARGETS.length).toBeGreaterThan(2);
  });

  it('ทุกตารางมีคำอธิบายเป็นภาษาคน ไม่ใช่ชื่อตารางดิบ', () => {
    for (const t of RETENTION_TARGETS) {
      expect(t.label.length, `${t.key} ไม่มีชื่อที่คนอ่านออก`).toBeGreaterThan(3);
      expect(t.why.length, `${t.key} ไม่ได้บอกว่าทำไมขั้นต่ำเป็นเท่านี้`).toBeGreaterThan(10);
    }
  });

  /**
   * **ตารางที่ใช้กู้คืน ต้องมีขั้นต่ำสูง**
   *
   * `work_item_history` เป็นที่เดียวที่รู้ว่าค่าเดิมของงานคืออะไร —
   * เคยใช้กู้งาน 64 ใบที่สคริปต์ QA เปลี่ยนสถานะไปโดยไม่ตั้งใจ ·
   * ตั้งไว้ 30 วันแล้วเจอความเสียหายตอนวันที่ 31 คือกู้ไม่ได้
   */
  it('**ตารางที่ใช้กู้คืน ขั้นต่ำต้องไม่น้อยกว่าหนึ่งปี**', () => {
    for (const key of ['audit_log', 'work_item_history']) {
      const t = targetByKey(key);
      expect(t.minKeepDays, `${key} ขั้นต่ำต่ำเกินไป`).toBeGreaterThanOrEqual(365);
    }
  });

  it('ถามหาตารางที่ไม่มี ต้องโยน ไม่ใช่คืน undefined ให้ไปพังทีหลัง', () => {
    expect(() => targetByKey('ตารางที่ไม่มีจริง')).toThrow(UnknownRetentionTargetError);
  });
});

describe('ระยะเวลาเก็บ · B · ตรวจค่าที่ตั้ง', () => {
  it('ค่าที่มากกว่าขั้นต่ำ ผ่าน', () => {
    expect(cutoffFor('notification', 90, NOW)).toBeInstanceOf(Date);
  });

  /**
   * **0 คือค่าที่ต้องปฏิเสธ ไม่ใช่ค่าที่แปลว่า "ลบทันที"**
   *
   * ช่องว่างที่ถูกแปลงเป็นตัวเลขได้ 0 · การยอมรับมันแปลว่าคนที่เผลอกดบันทึก
   * ฟอร์มเปล่า สั่งลบข้อมูลทั้งตาราง
   */
  it('**keepDays เป็น 0 ถูกปฏิเสธ**', () => {
    expect(() => cutoffFor('notification', 0, NOW)).toThrow(InvalidKeepDaysError);
  });

  it('**ค่าติดลบถูกปฏิเสธ**', () => {
    expect(() => cutoffFor('notification', -1, NOW)).toThrow(InvalidKeepDaysError);
  });

  it('**ค่าที่ไม่ใช่จำนวนเต็มถูกปฏิเสธ** — 0.5 วันไม่มีความหมาย', () => {
    expect(() => cutoffFor('notification', 30.5, NOW)).toThrow(InvalidKeepDaysError);
    expect(() => cutoffFor('notification', Number.NaN, NOW)).toThrow(InvalidKeepDaysError);
  });

  /** ขั้นต่ำของแต่ละตารางต่างกัน และต้องบังคับตามของตารางนั้นจริง ๆ */
  it('**ต่ำกว่าขั้นต่ำของตารางนั้น ถูกปฏิเสธ**', () => {
    const audit = targetByKey('audit_log');
    expect(() => cutoffFor('audit_log', audit.minKeepDays - 1, NOW)).toThrow(InvalidKeepDaysError);
    expect(cutoffFor('audit_log', audit.minKeepDays, NOW)).toBeInstanceOf(Date);
  });

  /** ข้อความปฏิเสธต้องบอกขั้นต่ำ ไม่ใช่บอกแค่ว่าผิด — คนต้องแก้ได้ทันที */
  it('ข้อความปฏิเสธบอกขั้นต่ำที่ยอมรับได้', () => {
    try {
      cutoffFor('audit_log', 1, NOW);
      throw new Error('ควรโยนแต่ไม่โยน');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidKeepDaysError);
      expect((e as Error).message).toContain(String(targetByKey('audit_log').minKeepDays));
    }
  });

  /**
   * **นาฬิกาถูกส่งเข้ามา ไม่ใช่อ่านเอง** — ทำให้ทดสอบเส้นแบ่งได้โดยไม่ต้องรอ
   * และทำให้ผู้เรียกรับผิดชอบว่า "ตอนนี้" คือเมื่อไร
   */
  it('**เส้นแบ่งคำนวณจาก now ที่ส่งเข้ามา**', () => {
    expect(cutoffFor('notification', 30, NOW).toISOString()).toBe('2026-08-03T00:00:00.000Z');
  });
});

describe('ระยะเวลาเก็บ · C · วางแผนก่อนลบ', () => {
  const counts = new Map([
    ['notification', 1200],
    ['audit_log', 50],
  ]);

  /**
   * **หัวใจของทั้งไฟล์**
   *
   * องค์กรที่ไม่เคยตั้งอะไรเลย ต้องไม่ถูกลบอะไรเลย · การไม่กรองคือค่าปริยาย
   * ของทุกคิวรี ถ้าเผลอตรงนี้ ความเสียหายคือข้อมูลที่กู้ไม่ได้
   */
  it('**ไม่มีนโยบายเลย ไม่มีอะไรถูกลบ**', () => {
    const plan = planRetention([], counts, NOW);
    expect(plan).toEqual([]);
  });

  it('**นโยบายที่ปิดอยู่ ไม่ถูกนำมาใช้**', () => {
    const plan = planRetention(
      [{ target: 'notification', keepDays: 30, isEnabled: false }],
      counts,
      NOW,
    );
    expect(plan).toEqual([]);
  });

  it('นโยบายที่เปิดอยู่ ได้เส้นแบ่งและจำนวนที่จะลบ', () => {
    const plan = planRetention(
      [{ target: 'notification', keepDays: 30, isEnabled: true }],
      counts,
      NOW,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]?.target).toBe('notification');
    expect(plan[0]?.cutoff?.toISOString()).toBe('2026-08-03T00:00:00.000Z');
    expect(plan[0]?.affected).toBe(1200);
  });

  /**
   * ไม่รู้จำนวน **ไม่เท่ากับ** ไม่มีอะไรจะลบ · ถ้าปนกันได้ หน้าจอที่บอกว่า
   * "จะลบ 0 แถว" จะทำให้คนกดยืนยันโดยไม่รู้ว่ากำลังลบอะไรอยู่
   */
  it('**ไม่รู้จำนวน ต้องเป็น null ไม่ใช่ 0**', () => {
    const plan = planRetention(
      [{ target: 'notification', keepDays: 30, isEnabled: true }],
      new Map(),
      NOW,
    );
    expect(plan[0]?.affected).toBeNull();
  });

  it('หลายนโยบายพร้อมกัน ได้ครบทุกอัน', () => {
    const plan = planRetention(
      [
        { target: 'notification', keepDays: 30, isEnabled: true },
        { target: 'audit_log', keepDays: 400, isEnabled: true },
      ],
      counts,
      NOW,
    );
    expect(plan.map((p) => p.target).sort()).toEqual(['audit_log', 'notification']);
  });

  /**
   * **นโยบายที่ค่าผิด ต้องรายงาน ไม่ใช่ข้ามเงียบ ๆ**
   *
   * แถวที่ค่าต่ำกว่าขั้นต่ำอาจเข้ามาทาง SQL ตรง ๆ หรือจากตอนที่กติกายังหลวมกว่านี้
   * · การข้ามเงียบทำให้ผู้ดูแลเชื่อว่านโยบายทำงานอยู่ ทั้งที่ไม่ได้ทำอะไรเลย
   * — ซึ่งเป็นความเชื่อที่หน้าจอสร้างขึ้นเอง แบบเดียวกับสิทธิ์ที่ให้แล้วไม่มีผล
   */
  it('**นโยบายที่ค่าไม่ผ่านเกณฑ์ ถูกรายงานเป็นปัญหา ไม่ใช่หายไปเฉย ๆ**', () => {
    const plan = planRetention(
      [{ target: 'audit_log', keepDays: 1, isEnabled: true }],
      counts,
      NOW,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]?.problem, 'ต้องบอกว่าทำไมถึงใช้ไม่ได้').not.toBeNull();
    expect(plan[0]?.cutoff, 'นโยบายที่มีปัญหาต้องไม่มีเส้นแบ่งให้ใครเอาไปลบ').toBeNull();
    expect(plan[0]?.affected).toBeNull();
  });

  it('**ตารางที่ไม่รู้จัก ถูกรายงานเป็นปัญหา ไม่ใช่ทำให้ทั้งแผนพัง**', () => {
    const plan = planRetention(
      [
        { target: 'ตารางที่ถูกลบไปแล้ว', keepDays: 90, isEnabled: true },
        { target: 'notification', keepDays: 90, isEnabled: true },
      ],
      counts,
      NOW,
    );
    expect(plan).toHaveLength(2);
    expect(plan.find((p) => p.target === 'notification')?.cutoff).not.toBeNull();
    expect(plan.find((p) => p.target === 'ตารางที่ถูกลบไปแล้ว')?.problem).not.toBeNull();
  });

  it('ไม่แก้ข้อมูลที่รับเข้ามา', () => {
    const policies = [{ target: 'notification', keepDays: 30, isEnabled: true }];
    const snapshot = JSON.stringify(policies);
    planRetention(policies, counts, NOW);
    expect(JSON.stringify(policies)).toBe(snapshot);
  });
});
