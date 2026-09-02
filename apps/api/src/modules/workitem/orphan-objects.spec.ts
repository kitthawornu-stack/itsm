/**
 * ข้อกำหนดของการหาไบต์กำพร้าในที่เก็บไฟล์ — **เขียนก่อนโค้ด**
 *
 * ## ทำไมต้องมีไฟล์นี้
 *
 * วัดจริงในฐานข้อมูลพัฒนา: **849 วัตถุใน MinIO แต่มีแถวไฟล์แนบเพียง 5 แถว** ·
 * ส่วนต่าง 844 คือไบต์ที่ไม่มีอะไรชี้ถึง สะสมมาจากเทสต์ที่ลบแถวตรง ๆ
 * โดยไม่ผ่าน `deleteAttachment` และจากการลบไฟล์ที่ล้มแล้วถูกกลืนไว้โดยตั้งใจ
 *
 * สองผลเสียที่ต่างกัน:
 *   1. **ดิสก์โตไม่มีที่สิ้นสุด** โดยไม่มีใครเห็น
 *   2. **PDPA** — "ลบข้อมูลแล้ว" ที่ไฟล์ยังอยู่ ไม่ใช่การลบ
 *
 * ## สิ่งที่ผิดแล้วกู้ไม่ได้
 *
 * ตัวเก็บกวาดที่ตัดสินผิดจะ **ลบไฟล์แนบจริงของผู้ใช้** ซึ่งไม่มีที่ไหนให้กู้ ·
 * ตรรกะการตัดสินจึงเป็นฟังก์ชันบริสุทธิ์ที่ทดสอบได้ และการลบจริงอยู่คนละชั้น
 *
 *   1. **รายการจากฐานข้อมูลว่างเปล่า ต้องไม่แปลว่า "ทุกอย่างกำพร้า"** —
 *      ถ้าอ่านฐานข้อมูลล้มหรือคิวรีผิด ผลคือลบทั้ง bucket
 *   2. **ไฟล์ที่เพิ่งเขียน ต้องไม่ถูกลบ** — ตอนอัปโหลด ไบต์ถูกเขียนก่อนที่
 *      แถวจะได้ `storageKey` (กติกา "จองก่อนทำ") · ตัวเก็บกวาดที่วิ่งพอดี
 *      ตอนนั้นจะเห็นไฟล์ที่ยังไม่มีใครชี้ถึง แล้วลบไฟล์ของผู้ใช้ที่กำลังอัป
 *   3. **ไม่รู้เวลาที่เขียน ต้องถือว่าใหม่** ไม่ใช่ถือว่าเก่า
 */
import { describe, expect, it } from 'vitest';

import { MIN_AGE_MS, planOrphanCleanup } from './orphan-objects';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const old = (hours: number): Date => new Date(NOW.getTime() - hours * 3_600_000);

const obj = (key: string, at: Date | null): { key: string; lastModified: Date | null; sizeBytes: number } => ({
  key,
  lastModified: at,
  sizeBytes: 1024,
});

describe('ไบต์กำพร้า · A · การตัดสิน', () => {
  it('ไฟล์ที่มีแถวชี้ถึง ไม่ถูกแตะ', () => {
    const plan = planOrphanCleanup(
      [obj('t1/w1/1.png', old(48))],
      new Set(['t1/w1/1.png']),
      NOW,
    );
    expect(plan.orphans).toEqual([]);
    expect(plan.matched).toBe(1);
  });

  it('ไฟล์ที่ไม่มีแถวชี้ถึงและเก่าพอ ถูกจัดว่ากำพร้า', () => {
    const plan = planOrphanCleanup([obj('t1/w1/9.png', old(48))], new Set(), NOW);
    expect(plan.orphans.map((o) => o.key)).toEqual(['t1/w1/9.png']);
  });

  /**
   * **หัวใจข้อที่หนึ่ง**
   *
   * ถ้าคิวรีฐานข้อมูลล้มหรือเขียนผิดจนได้เซ็ตว่าง ผลลัพธ์ต้องไม่ใช่
   * "ทุกอย่างกำพร้า" ซึ่งแปลว่าลบทั้ง bucket · ผู้เรียกต้องยืนยันเจตนา
   */
  it('**รายการจากฐานข้อมูลว่างเปล่า ถูกปฏิเสธ ไม่ใช่ลบทุกอย่าง**', () => {
    const plan = planOrphanCleanup(
      [obj('t1/w1/1.png', old(48)), obj('t1/w1/2.png', old(48))],
      new Set(),
      NOW,
    );
    expect(plan.orphans).toHaveLength(2);
    expect(plan.refusedReason, 'ต้องบอกว่าทำไมถึงไม่ควรลบเลย').not.toBeNull();
    expect(plan.safeToDelete, 'เซ็ตว่างจากฐานข้อมูลต้องไม่ถูกถือว่าปลอดภัย').toBe(false);
  });

  it('มีแถวอย่างน้อยหนึ่งแถว ถือว่าอ่านฐานข้อมูลได้จริง', () => {
    const plan = planOrphanCleanup(
      [obj('t1/w1/1.png', old(48)), obj('t1/w1/9.png', old(48))],
      new Set(['t1/w1/1.png']),
      NOW,
    );
    expect(plan.safeToDelete).toBe(true);
    expect(plan.refusedReason).toBeNull();
  });

  /**
   * **หัวใจข้อที่สอง**
   *
   * ตอนอัปโหลด ไบต์ถูกเขียนก่อนที่แถวจะได้ `storageKey` · ตัวเก็บกวาดที่วิ่ง
   * พอดีตอนนั้นจะเห็นไฟล์ที่ยังไม่มีใครชี้ถึง — **แล้วลบไฟล์ของผู้ใช้ที่กำลังอัป**
   */
  it('**ไฟล์ที่เพิ่งเขียน ไม่ถูกจัดว่ากำพร้า**', () => {
    const plan = planOrphanCleanup(
      [obj('t1/w1/1.png', old(48)), obj('t1/w1/สด.png', new Date(NOW.getTime() - 1000))],
      new Set(['t1/w1/1.png']),
      NOW,
    );
    expect(plan.orphans).toEqual([]);
    expect(plan.tooYoung).toBe(1);
  });

  it('เส้นแบ่งอายุคำนวณจาก now ที่ส่งเข้ามา ไม่ใช่อ่านนาฬิกาเอง', () => {
    const justOver = new Date(NOW.getTime() - MIN_AGE_MS - 1000);
    const justUnder = new Date(NOW.getTime() - MIN_AGE_MS + 1000);
    const known = new Set(['t1/w1/1.png']);
    expect(
      planOrphanCleanup([obj('t1/w1/1.png', old(99)), obj('a', justOver)], known, NOW).orphans,
    ).toHaveLength(1);
    expect(
      planOrphanCleanup([obj('t1/w1/1.png', old(99)), obj('a', justUnder)], known, NOW).orphans,
    ).toHaveLength(0);
  });

  /**
   * **หัวใจข้อที่สาม**
   *
   * ไม่รู้เวลาที่เขียน ต้องถือว่า **ใหม่** — การถือว่าเก่าคือการลบไฟล์ที่
   * เราไม่รู้อะไรเกี่ยวกับมันเลย ซึ่งเป็นการเดาที่กู้ไม่ได้ถ้าเดาผิด
   */
  it('**ไม่รู้เวลาที่เขียน ถือว่าใหม่ ไม่ใช่เก่า**', () => {
    const plan = planOrphanCleanup(
      [obj('t1/w1/1.png', old(99)), obj('ไม่รู้เวลา', null)],
      new Set(['t1/w1/1.png']),
      NOW,
    );
    expect(plan.orphans).toEqual([]);
    expect(plan.unknownAge).toBe(1);
  });

  it('บอกขนาดรวมของสิ่งที่จะลบ — ตัวเลขที่ทำให้คนตัดสินใจได้', () => {
    const plan = planOrphanCleanup(
      [obj('t1/w1/1.png', old(48)), obj('x', old(48)), obj('y', old(48))],
      new Set(['t1/w1/1.png']),
      NOW,
    );
    expect(plan.orphanBytes).toBe(2048);
  });

  it('ไม่แก้ข้อมูลที่รับเข้ามา', () => {
    const objects = [obj('a', old(48))];
    const snapshot = JSON.stringify(objects);
    planOrphanCleanup(objects, new Set(['b']), NOW);
    expect(JSON.stringify(objects)).toBe(snapshot);
  });

  it('bucket ว่างเปล่า ไม่มีอะไรให้ทำ และไม่ใช่ความผิดพลาด', () => {
    const plan = planOrphanCleanup([], new Set(['t1/w1/1.png']), NOW);
    expect(plan.orphans).toEqual([]);
    expect(plan.refusedReason).toBeNull();
  });
});
