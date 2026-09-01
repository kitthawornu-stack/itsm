/**
 * ข้อกำหนดของการเก็บกวาดเซสชันที่ตายแล้ว — **เขียนก่อนโค้ด**
 *
 * ## ทำไมต้องมี
 *
 * วัดจริงในฐานข้อมูลพัฒนา: **184 แถว หมดอายุแล้ว 169** และไม่มีอะไรลบมันเลย ·
 * ตารางนี้โตทุกครั้งที่มีคนล็อกอิน และไม่เคยเล็กลง · บนระบบที่มีคนใช้จริง
 * ทุกวัน มันจะกลายเป็นตารางที่ใหญ่ที่สุดในฐานข้อมูลโดยไม่มีใครสังเกต
 * เพราะทุกคิวรีกรองด้วย `tokenHash` แถวตายจึงไม่เคยโผล่ที่ไหน
 * — รูปแบบเดียวกับแถวกำพร้าใน `notification` ที่รั่ว 170 แถวโดยไม่มีใครเห็น
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 *   1. **ลบทันทีที่หมดอายุ** — ตารางนี้เป็น**ร่องรอยความปลอดภัย**ด้วย
 *      (`userAgent`, `ipAddress`) · เซสชันที่เพิ่งหมดอายุคือหลักฐานเดียว
 *      ว่ามีใครล็อกอินจากที่ไหนเมื่อวาน · ลบทิ้งทันทีคือทำลายหลักฐาน
 *      ก่อนที่เจ้าของบัญชีจะได้ดู
 *   2. **ลบเซสชันที่ยังใช้ได้** — คนกำลังทำงานอยู่แล้วหลุดกลางคัน
 *      โดยไม่มีอะไรอธิบายได้
 *   3. **ลบทีเดียวทั้งตาราง** — DELETE ก้อนใหญ่ล็อกตารางนาน แล้วทุกคน
 *      ล็อกอินไม่ได้ระหว่างนั้น · ต้องมีเพดานต่อรอบ
 */
import { describe, expect, it } from 'vitest';
import { toUtcDate } from '@itsm/types';

import {
  REAP_BATCH,
  SESSION_KEEP_DAYS,
  diedAt,
  reapable,
  type ReapableSession,
} from './session-reaper';

const NOW = toUtcDate('2029-06-30T00:00:00.000Z');
const DAY = 86_400_000;

/** เวลาที่ห่างจาก "ตอนนี้" ไปกี่วัน (ลบคืออดีต) */
function days(n: number): Date {
  return new Date(NOW.getTime() + n * DAY);
}

function session(over: Partial<ReapableSession> = {}): ReapableSession {
  return {
    id: BigInt(1),
    expiresAt: days(-SESSION_KEEP_DAYS - 10),
    revokedAt: null,
    ...over,
  };
}

// ============================================================

describe('เก็บกวาดเซสชัน · A · อะไรถูกเก็บกวาด', () => {
  it('เซสชันที่ยังไม่หมดอายุ ไม่ถูกลบ', () => {
    expect(reapable([session({ expiresAt: days(5) })], NOW)).toEqual([]);
  });

  /**
   * **หัวใจของทั้งไฟล์**
   *
   * ตารางเซสชันเป็นร่องรอยความปลอดภัยด้วย · เซสชันที่เพิ่งหมดอายุคือหลักฐาน
   * เดียวว่ามีใครล็อกอินจากที่ไหนเมื่อวาน
   */
  it('**หมดอายุเมื่อวาน ยังไม่ถูกลบ — ยังอยู่ในช่วงผ่อนผัน**', () => {
    expect(reapable([session({ expiresAt: days(-1) })], NOW)).toEqual([]);
  });

  it('หมดอายุนานเกินช่วงผ่อนผัน ถูกลบ', () => {
    const r = reapable([session({ id: BigInt(9), expiresAt: days(-SESSION_KEEP_DAYS - 1) })], NOW);
    expect(r).toEqual([BigInt(9)]);
  });

  /** ครบพอดีถือว่าเลยแล้ว — ขอบเขตต้องตัดสินทางเดียว ไม่ใช่แล้วแต่วินาที */
  it('ครบช่วงผ่อนผันพอดี ถูกลบ', () => {
    expect(reapable([session({ expiresAt: days(-SESSION_KEEP_DAYS) })], NOW)).toHaveLength(1);
  });

  it('เพิ่งถูกเพิกถอนเมื่อวาน ยังไม่ถูกลบ', () => {
    expect(
      reapable([session({ expiresAt: days(30), revokedAt: days(-1) })], NOW),
    ).toEqual([]);
  });

  /**
   * **เซสชันตายตอนถูกเพิกถอน ไม่ใช่ตอนหมดอายุ**
   *
   * ถ้านับจากวันหมดอายุอย่างเดียว เซสชันที่ถูกเพิกถอนตั้งแต่ปีที่แล้ว
   * แต่ตั้งวันหมดอายุไว้ไกล จะค้างอยู่ตลอดกาล
   */
  it('**ถูกเพิกถอนนานแล้ว แม้ยังไม่ถึงวันหมดอายุ ก็ถูกลบ**', () => {
    const r = reapable(
      [session({ id: BigInt(7), expiresAt: days(365), revokedAt: days(-SESSION_KEEP_DAYS - 1) })],
      NOW,
    );
    expect(r).toEqual([BigInt(7)]);
  });

  /**
   * **เพิกถอนของที่หมดอายุไปแล้ว ไม่ยืดอายุให้มัน**
   *
   * ผู้ดูแลกดเพิกถอนเซสชันเก่าที่หมดอายุไปนานแล้ว · ถ้านับจากวันเพิกถอน
   * แถวนั้นจะได้ช่วงผ่อนผันใหม่ทั้งที่ตายไปตั้งนานแล้ว
   */
  it('**ถูกเพิกถอนหลังหมดอายุ นับจากวันหมดอายุ ไม่ใช่วันเพิกถอน**', () => {
    const s = session({ expiresAt: days(-SESSION_KEEP_DAYS - 5), revokedAt: days(-1) });
    expect(diedAt(s).getTime()).toBe(s.expiresAt.getTime());
    expect(reapable([s], NOW)).toHaveLength(1);
  });
});

// ============================================================

describe('เก็บกวาดเซสชัน · B · เพดานต่อรอบ', () => {
  /** DELETE ก้อนใหญ่ล็อกตารางนาน แล้วทุกคนล็อกอินไม่ได้ระหว่างนั้น */
  it('**คืนไม่เกินเพดานต่อรอบ**', () => {
    const many = Array.from({ length: REAP_BATCH + 50 }, (_, i) =>
      session({ id: BigInt(i + 1), expiresAt: days(-SESSION_KEEP_DAYS - 1) }),
    );
    expect(reapable(many, NOW)).toHaveLength(REAP_BATCH);
  });

  /**
   * **เอาที่ตายนานที่สุดก่อน** — ไม่ใช่ลำดับที่ฐานข้อมูลบังเอิญคืนมา
   *
   * ถ้าเรียงตามลำดับที่ได้มา รอบที่ชนเพดานทุกครั้งจะเก็บกวาดแถวชุดเดิมซ้ำ ๆ
   * แล้วแถวที่เก่าที่สุดอาจไม่เคยถูกแตะเลย
   */
  it('**เรียงจากที่ตายนานที่สุดก่อน**', () => {
    const r = reapable(
      [
        session({ id: BigInt(1), expiresAt: days(-SESSION_KEEP_DAYS - 1) }),
        session({ id: BigInt(2), expiresAt: days(-SESSION_KEEP_DAYS - 900) }),
        session({ id: BigInt(3), expiresAt: days(-SESSION_KEEP_DAYS - 100) }),
      ],
      NOW,
    );
    expect(r).toEqual([BigInt(2), BigInt(3), BigInt(1)]);
  });

  it('ไม่มีอะไรให้เก็บกวาด คืนรายการว่าง', () => {
    expect(reapable([], NOW)).toEqual([]);
  });
});

// ============================================================

describe('เก็บกวาดเซสชัน · C · ไม่แก้ข้อมูลนำเข้า', () => {
  it('ไม่แก้รายการที่รับเข้ามา', () => {
    const rows = [
      session({ id: BigInt(1), expiresAt: days(-SESSION_KEEP_DAYS - 1) }),
      session({ id: BigInt(2), expiresAt: days(-SESSION_KEEP_DAYS - 9) }),
    ];
    const snapshot = rows.map((r) => r.id.toString()).join(',');
    reapable(rows, NOW);
    expect(rows.map((r) => r.id.toString()).join(',')).toBe(snapshot);
  });
});
