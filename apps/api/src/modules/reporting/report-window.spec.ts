/**
 * ช่วงเวลาของรายงาน — เทสต์เป็นข้อกำหนด
 *
 * ฟังก์ชันบริสุทธิ์ล้วน ไม่แตะฐานข้อมูล จึงทดสอบขอบของเดือนและปีได้ครบ
 * โดยไม่ต้องรอให้ถึงวันนั้นจริง (กติกาเดียวกับที่ห้าม SLA Engine อ่านนาฬิกาเอง)
 *
 * **ข้อที่สำคัญที่สุดคือขอบเขตของวัน** — "เดือนนี้ปิดไปกี่ใบ" ของคนไทยหมายถึง
 * เดือนตามปฏิทินไทย · ถ้าหั่นตามเดือน UTC งานที่ปิด 1 ส.ค. เวลา 00:30 น.
 * ตามเวลาไทย (= 31 ก.ค. 17:30 UTC) จะถูกนับเข้าเดือนกรกฎาคม
 * ไม่มี error ไม่มีอะไรผิดสังเกต แค่ยอดสองเดือนคลาดกันทุกเดือน
 */
import { describe, expect, it } from 'vitest';
import { toUtcDate } from '@itsm/types';

import {
  THAI_OFFSET_MS,
  daysIn,
  thaiDayKey,
  thaiMonth,
  thaiParts,
  windowFor,
} from './report-window';

describe('A · วันตามปฏิทินไทย', () => {
  it('**เที่ยงคืนครึ่งของวันที่ 1 ตามเวลาไทย ยังเป็นวันที่ 1**', () => {
    /*
      เคสนี้คือทั้งเหตุผลของไฟล์นี้ · เวลานี้เป็น 31 ก.ค. ใน UTC
      ถ้าหั่นตาม UTC งานใบนี้จะไปอยู่เดือนกรกฎาคม ทั้งที่คนแจ้งเห็นเป็นเดือนสิงหาคม
    */
    const at = toUtcDate('2026-07-31T17:30:00.000Z');
    expect(at.getUTCMonth() + 1).toBe(7);
    expect(thaiParts(at)).toEqual({ year: 2026, month: 8, day: 1 });
    expect(thaiDayKey(at)).toBe('2026-08-01');
  });

  it('ก่อนเที่ยงคืนไทยหนึ่งนาที ยังเป็นวันก่อนหน้า', () => {
    expect(thaiDayKey(toUtcDate('2026-07-31T16:59:00.000Z'))).toBe('2026-07-31');
  });

  it('ประเทศไทยไม่มี DST — ออฟเซ็ตเท่ากันทั้งฤดูร้อนและฤดูหนาว', () => {
    /*
      เขียนเป็นค่าคงที่แทนการเรียก `Intl` โดยตั้งใจ — คอนเทนเนอร์ที่ไม่มี full-icu
      จะตกกลับไปเป็น UTC เงียบ ๆ และรายงานจะเลื่อนไป 7 ชั่วโมงโดยไม่มีใครรู้
    */
    const summer = toUtcDate('2026-06-15T12:00:00.000Z');
    const winter = toUtcDate('2026-12-15T12:00:00.000Z');
    expect(thaiParts(summer).day).toBe(15);
    expect(thaiParts(winter).day).toBe(15);
    expect(THAI_OFFSET_MS).toBe(25_200_000);
  });
});

describe('B · เดือนตามปฏิทินไทย', () => {
  it('**ขอบเดือนคือเที่ยงคืนไทย ไม่ใช่เที่ยงคืน UTC**', () => {
    const w = thaiMonth(2026, 8);
    expect(w.from.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-08-31T17:00:00.000Z');
  });

  it('ธันวาคมต่อไปปีถัดไปได้ ไม่ใช่เดือนที่ 13', () => {
    // เคสที่มักลืมทดสอบ เพราะโค้ดที่ถูกไม่ต้องมี if พิเศษ และโค้ดที่ผิดก็ไม่ error
    const w = thaiMonth(2026, 12);
    expect(w.to.toISOString()).toBe('2026-12-31T17:00:00.000Z');
    expect(thaiParts(toUtcDate(w.to.getTime())).year).toBe(2027);
  });

  it('กุมภาพันธ์ปีอธิกสุรทินยาว 29 วัน', () => {
    expect(daysIn(thaiMonth(2028, 2))).toHaveLength(29);
    expect(daysIn(thaiMonth(2026, 2))).toHaveLength(28);
  });

  it('ป้ายเป็นภาษาไทยและปีพุทธศักราช', () => {
    // ผู้ใช้ไทยอ่าน 2569 ไม่ใช่ 2026 — ป้ายที่เป็น ค.ศ. ทำให้คนคิดว่าดูรายงานผิดปี
    expect(thaiMonth(2026, 8).label).toBe('สิงหาคม 2569');
  });
});

describe('C · ช่วงที่หน้าจอเลือก', () => {
  const now = toUtcDate('2026-08-28T03:00:00.000Z'); // 28 ส.ค. 10:00 น. เวลาไทย

  it('เดือนนี้ = เดือนไทยที่ "ตอนนี้" ตกอยู่', () => {
    const w = windowFor('this-month', now);
    expect(w.from.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(w.label).toBe('สิงหาคม 2569');
  });

  it('เดือนที่แล้วข้ามปีได้', () => {
    const jan = toUtcDate('2026-01-15T03:00:00.000Z');
    expect(windowFor('last-month', jan).label).toBe('ธันวาคม 2568');
  });

  it('**"7 วันล่าสุด" ตัดที่สิ้นวัน ไม่ใช่ที่นาทีนี้**', () => {
    /*
      ถ้าตัดที่นาทีนี้ ยอดจะขยับทุกครั้งที่กดรีเฟรช และสองคนที่เปิดรายงาน
      ห่างกันสิบนาทีจะได้เลขไม่ตรงกัน แล้วเถียงกันว่าใครอ่านผิด
    */
    const early = windowFor('last-7-days', toUtcDate('2026-08-28T01:00:00.000Z'));
    const late = windowFor('last-7-days', toUtcDate('2026-08-28T15:00:00.000Z'));
    expect(early.from.toISOString()).toBe(late.from.toISOString());
    expect(early.to.toISOString()).toBe(late.to.toISOString());
    // ครอบวันนี้ด้วย — "7 วันล่าสุด" ที่ไม่รวมวันนี้คือสิ่งที่ไม่มีใครคาดหวัง
    expect(daysIn(early)).toContain('2026-08-28');
    expect(daysIn(early)).toHaveLength(7);
  });

  it('30 วันล่าสุดข้ามเดือนได้ และมีครบ 30 วัน', () => {
    const w = windowFor('last-30-days', now);
    const days = daysIn(w);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-07-30');
    expect(days[days.length - 1]).toBe('2026-08-28');
  });
});

describe('D · รายวัน', () => {
  it('**ทุกวันในช่วงต้องมี รวมวันที่ไม่มีงานเลย**', () => {
    /*
      กราฟที่ข้ามวันว่างทำให้ช่วงที่เงียบดูเหมือนช่วงที่ยุ่ง เพราะแท่งเบียดกัน
      · รายการวันจึงต้องมาจากช่วงเวลา ไม่ใช่มาจากข้อมูลที่คิวรีเจอ
    */
    const days = daysIn(thaiMonth(2026, 8));
    expect(days).toHaveLength(31);
    expect(days[0]).toBe('2026-08-01');
    expect(days[30]).toBe('2026-08-31');
  });

  it('ไม่มีวันซ้ำและเรียงจากเก่าไปใหม่', () => {
    const days = daysIn(windowFor('last-30-days', toUtcDate('2026-03-05T03:00:00.000Z')));
    expect(new Set(days).size).toBe(days.length);
    expect([...days].sort()).toEqual(days);
  });
});
