/**
 * ปฏิทินเวลาทำการ — ส่วนที่หนึ่งของชุดทดสอบ SLA
 *
 * เหตุผลที่ชุดนี้ต้องใหญ่ (CLAUDE.md §4): ถ้าคำนวณเวลาทำการผิด
 * ตัวเลข SLA ทั้งระบบผิดตาม และผิดแบบเงียบ ๆ ไม่มี error ให้เห็น
 *
 * หมวดที่ครอบคลุม:
 *   A. พื้นฐาน — ในเวลา นอกเวลา ข้ามวัน
 *   B. สุดสัปดาห์
 *   C. วันหยุด รวมวันหยุดยาวสงกรานต์
 *   D. ขอบเขต — เริ่มพอดีตอนเปิด/ปิดทำการ
 *   E. addWorkingMs — หาจุดที่จะหลุด
 *   F. timezone และ DST
 *   G. ปฏิทิน 24×7
 */
import { describe, expect, it } from 'vitest';
import { toUtcDate } from '@itsm/types';

import {
  HOURS_24_7,
  addWorkingMs,
  elapsedWorkingMs,
  isWorkingTime,
  localDateKey,
  nextWorkingMoment,
  officeHoursThai,
  type BusinessCalendar,
} from './business-calendar';

const MIN = 60_000;
const HOUR = 3_600_000;

/** เวลาไทย -> UtcDate (ไทยเป็น UTC+7 ตลอดปี ไม่มี DST) */
const th = (iso: string) => toUtcDate(`${iso}+07:00`);

const office = officeHoursThai();

/** สงกรานต์ 2569: 13-15 เม.ย. ตรงกับ จ-พ */
const songkran = officeHoursThai(['2026-04-13', '2026-04-14', '2026-04-15']);

describe('ปฏิทิน · A · พื้นฐาน', () => {
  it('เที่ยงวันของวันอังคารอยู่ในเวลาทำการ', () => {
    expect(isWorkingTime(office, th('2026-08-25T12:00:00'))).toBe(true);
  });

  it('ตีสองของวันอังคารไม่อยู่ในเวลาทำการ', () => {
    expect(isWorkingTime(office, th('2026-08-25T02:00:00'))).toBe(false);
  });

  it('หนึ่งชั่วโมงกลางวันทำการนับได้หนึ่งชั่วโมง', () => {
    expect(elapsedWorkingMs(office, th('2026-08-25T10:00:00'), th('2026-08-25T11:00:00'))).toBe(HOUR);
  });

  it('ช่วงที่อยู่นอกเวลาทำการทั้งหมดนับเป็นศูนย์', () => {
    expect(elapsedWorkingMs(office, th('2026-08-25T20:00:00'), th('2026-08-25T22:00:00'))).toBe(0);
  });

  it('หนึ่งวันทำการเต็มคือ 9 ชั่วโมง (08:30-17:30)', () => {
    expect(elapsedWorkingMs(office, th('2026-08-25T00:00:00'), th('2026-08-25T23:59:59'))).toBe(9 * HOUR);
  });

  it('เริ่มก่อนเปิดทำการ นับตั้งแต่เวลาเปิด', () => {
    // 06:00 -> 09:30 ควรได้ 1 ชม. (08:30-09:30)
    expect(elapsedWorkingMs(office, th('2026-08-25T06:00:00'), th('2026-08-25T09:30:00'))).toBe(HOUR);
  });

  it('จบหลังปิดทำการ นับถึงเวลาปิด', () => {
    // 16:30 -> 20:00 ควรได้ 1 ชม. (16:30-17:30)
    expect(elapsedWorkingMs(office, th('2026-08-25T16:30:00'), th('2026-08-25T20:00:00'))).toBe(HOUR);
  });

  it('ข้ามคืนวันธรรมดา นับเฉพาะเวลาทำการของสองวัน', () => {
    // อังคาร 16:30 -> พุธ 09:30 = 1 ชม. + 1 ชม.
    expect(elapsedWorkingMs(office, th('2026-08-25T16:30:00'), th('2026-08-26T09:30:00'))).toBe(2 * HOUR);
  });

  it('to มาก่อน from คืนศูนย์ ไม่ใช่ค่าติดลบ', () => {
    expect(elapsedWorkingMs(office, th('2026-08-25T12:00:00'), th('2026-08-25T10:00:00'))).toBe(0);
  });

  it('from เท่ากับ to คืนศูนย์', () => {
    const t = th('2026-08-25T12:00:00');
    expect(elapsedWorkingMs(office, t, t)).toBe(0);
  });

  it('ห้าวันทำการติดกันได้ 45 ชั่วโมง', () => {
    // จันทร์ 24 - ศุกร์ 28 ส.ค. 2569
    expect(elapsedWorkingMs(office, th('2026-08-24T00:00:00'), th('2026-08-29T00:00:00'))).toBe(45 * HOUR);
  });
});

describe('ปฏิทิน · B · สุดสัปดาห์', () => {
  it('เสาร์ไม่ใช่เวลาทำการ', () => {
    expect(isWorkingTime(office, th('2026-08-29T12:00:00'))).toBe(false);
  });

  it('อาทิตย์ไม่ใช่เวลาทำการ', () => {
    expect(isWorkingTime(office, th('2026-08-30T12:00:00'))).toBe(false);
  });

  it('สุดสัปดาห์ทั้งหมดนับเป็นศูนย์', () => {
    expect(elapsedWorkingMs(office, th('2026-08-29T00:00:00'), th('2026-08-31T00:00:00'))).toBe(0);
  });

  it('ศุกร์บ่ายถึงจันทร์เช้า ข้ามสุดสัปดาห์ถูกต้อง', () => {
    // ศุกร์ 28 ส.ค. 16:30 -> จันทร์ 31 ส.ค. 09:30 = 1 + 1 = 2 ชม.
    expect(elapsedWorkingMs(office, th('2026-08-28T16:30:00'), th('2026-08-31T09:30:00'))).toBe(2 * HOUR);
  });

  it('ตั๋วที่เปิดเย็นวันศุกร์ นาฬิกาเริ่มเช้าวันจันทร์', () => {
    const next = nextWorkingMoment(office, th('2026-08-28T19:00:00'));
    expect(localDateKey(next, 'Asia/Bangkok')).toBe('2026-08-31');
  });
});

describe('ปฏิทิน · C · วันหยุด', () => {
  it('วันสงกรานต์ไม่ใช่เวลาทำการ', () => {
    expect(isWorkingTime(songkran, th('2026-04-13T12:00:00'))).toBe(false);
    expect(isWorkingTime(songkran, th('2026-04-14T12:00:00'))).toBe(false);
    expect(isWorkingTime(songkran, th('2026-04-15T12:00:00'))).toBe(false);
  });

  it('ก่อนสงกรานต์ยังทำงาน', () => {
    expect(isWorkingTime(songkran, th('2026-04-10T12:00:00'))).toBe(true);
  });

  it('ตั๋วที่เปิดเย็นวันศุกร์ก่อนสงกรานต์ ข้ามวันหยุดยาวถูกต้อง', () => {
    // ศุกร์ 10 เม.ย. 16:30 -> พฤหัส 16 เม.ย. 09:30
    // นับได้: ศุกร์ 1 ชม. + พฤหัส 1 ชม. = 2 ชม. (เสาร์อาทิตย์ + 13-15 หยุด)
    expect(elapsedWorkingMs(songkran, th('2026-04-10T16:30:00'), th('2026-04-16T09:30:00'))).toBe(2 * HOUR);
  });

  it('ช่วงที่เป็นวันหยุดยาวล้วนนับเป็นศูนย์', () => {
    expect(elapsedWorkingMs(songkran, th('2026-04-13T00:00:00'), th('2026-04-16T00:00:00'))).toBe(0);
  });

  it('ปฏิทินที่ไม่มีวันหยุดตั้งไว้ นับสงกรานต์เป็นวันทำการ', () => {
    // ยืนยันว่าความต่างมาจากรายการวันหยุดจริง ไม่ใช่เขียนตายไว้ในโค้ด
    expect(elapsedWorkingMs(office, th('2026-04-13T00:00:00'), th('2026-04-16T00:00:00'))).toBe(27 * HOUR);
  });
});

describe('ปฏิทิน · D · ขอบเขต', () => {
  it('เวลาเปิดทำการพอดี ถือว่าอยู่ในเวลาทำการ', () => {
    expect(isWorkingTime(office, th('2026-08-25T08:30:00'))).toBe(true);
  });

  it('เวลาปิดทำการพอดี ถือว่า **ไม่** อยู่ในเวลาทำการแล้ว', () => {
    // ช่วงเป็นแบบ [start, end) — ถ้านับ end ด้วยจะได้เวลาเกินจริงวันละ 1 มิลลิวินาที
    expect(isWorkingTime(office, th('2026-08-25T17:30:00'))).toBe(false);
  });

  it('หนึ่งมิลลิวินาทีก่อนปิดยังอยู่ในเวลาทำการ', () => {
    expect(isWorkingTime(office, toUtcDate(th('2026-08-25T17:30:00').getTime() - 1))).toBe(true);
  });

  it('หนึ่งมิลลิวินาทีก่อนเปิดยังไม่อยู่ในเวลาทำการ', () => {
    expect(isWorkingTime(office, toUtcDate(th('2026-08-25T08:30:00').getTime() - 1))).toBe(false);
  });

  it('ช่วงที่คร่อมเวลาปิดพอดี นับถึงเวลาปิดเท่านั้น', () => {
    expect(elapsedWorkingMs(office, th('2026-08-25T17:29:00'), th('2026-08-25T17:31:00'))).toBe(MIN);
  });
});

describe('ปฏิทิน · E · addWorkingMs (หาจุดที่จะหลุด)', () => {
  it('บวกหนึ่งชั่วโมงกลางวันทำการ', () => {
    const r = addWorkingMs(office, th('2026-08-25T10:00:00'), HOUR);
    expect(r.getTime()).toBe(th('2026-08-25T11:00:00').getTime());
  });

  it('บวกข้ามเวลาปิด ไปโผล่เช้าวันถัดไป', () => {
    // 17:00 + 1 ชม. = เหลือ 30 นาทีวันนี้ + 30 นาทีพรุ่งนี้ = 09:00
    const r = addWorkingMs(office, th('2026-08-25T17:00:00'), HOUR);
    expect(r.getTime()).toBe(th('2026-08-26T09:00:00').getTime());
  });

  it('เริ่มนอกเวลาทำการ นับจากเวลาเปิดถัดไป', () => {
    const r = addWorkingMs(office, th('2026-08-25T22:00:00'), HOUR);
    expect(r.getTime()).toBe(th('2026-08-26T09:30:00').getTime());
  });

  it('บวกข้ามสุดสัปดาห์', () => {
    // ศุกร์ 17:00 + 1 ชม. -> จันทร์ 09:00
    const r = addWorkingMs(office, th('2026-08-28T17:00:00'), HOUR);
    expect(r.getTime()).toBe(th('2026-08-31T09:00:00').getTime());
  });

  it('บวกข้ามวันหยุดยาวสงกรานต์', () => {
    // ศุกร์ 10 เม.ย. 17:00 + 1 ชม. -> พฤหัส 16 เม.ย. 09:00
    const r = addWorkingMs(songkran, th('2026-04-10T17:00:00'), HOUR);
    expect(r.getTime()).toBe(th('2026-04-16T09:00:00').getTime());
  });

  it('บวกศูนย์คืนเวลาเดิม', () => {
    const t = th('2026-08-25T10:00:00');
    expect(addWorkingMs(office, t, 0).getTime()).toBe(t.getTime());
  });

  it('addWorkingMs กับ elapsedWorkingMs สอดคล้องกัน (round-trip)', () => {
    const from = th('2026-08-25T10:00:00');
    for (const ms of [MIN, 30 * MIN, 4 * HOUR, 9 * HOUR, 20 * HOUR, 60 * HOUR]) {
      const to = addWorkingMs(office, from, ms);
      expect(elapsedWorkingMs(office, from, to), `ms=${ms}`).toBe(ms);
    }
  });

  it('ปฏิทินที่ไม่มีเวลาทำการเลย ต้องล้มดัง ไม่ใช่วนไม่จบ', () => {
    const never: BusinessCalendar = {
      name: 'ไม่มีวันทำการ',
      timezone: 'Asia/Bangkok',
      weekly: [[], [], [], [], [], [], []],
      holidays: new Set(),
    };
    expect(() => addWorkingMs(never, th('2026-08-25T10:00:00'), HOUR)).toThrow(/400 วัน/);
  });
});

describe('ปฏิทิน · F · timezone และ DST', () => {
  it('ปฏิทินไทยให้ผลตามเวลาไทย ไม่ใช่ UTC', () => {
    // 02:00 UTC = 09:00 ไทย -> อยู่ในเวลาทำการ
    expect(isWorkingTime(office, toUtcDate('2026-08-25T02:00:00Z'))).toBe(true);
    // 14:00 UTC = 21:00 ไทย -> นอกเวลาทำการ
    expect(isWorkingTime(office, toUtcDate('2026-08-25T14:00:00Z'))).toBe(false);
  });

  it('ปฏิทินที่มี DST คำนวณถูกในวันที่ offset เปลี่ยน', () => {
    // ยุโรปเปลี่ยนเป็นเวลาฤดูร้อน 29 มี.ค. 2026 (ตี 2 -> ตี 3)
    const berlin: BusinessCalendar = {
      name: 'Berlin 8x5',
      timezone: 'Europe/Berlin',
      weekly: Array.from({ length: 7 }, (_, d) =>
        d >= 1 && d <= 5 ? [{ startMinute: 9 * 60, endMinute: 17 * 60 }] : [],
      ),
      holidays: new Set(),
    };
    // จันทร์ 30 มี.ค. (หลังเปลี่ยน) ต้องได้ 8 ชม. เท่าเดิม
    const mon = elapsedWorkingMs(
      berlin,
      toUtcDate('2026-03-30T00:00:00Z'),
      toUtcDate('2026-03-31T00:00:00Z'),
    );
    expect(mon).toBe(8 * HOUR);
  });

  it('สัปดาห์ที่คร่อมการเปลี่ยน DST ยังได้ 40 ชั่วโมง', () => {
    const berlin: BusinessCalendar = {
      name: 'Berlin 8x5',
      timezone: 'Europe/Berlin',
      weekly: Array.from({ length: 7 }, (_, d) =>
        d >= 1 && d <= 5 ? [{ startMinute: 9 * 60, endMinute: 17 * 60 }] : [],
      ),
      holidays: new Set(),
    };
    // จันทร์ 23 - เสาร์ 28 มี.ค. คร่อมคืนที่เปลี่ยนเวลา (29 มี.ค.)
    const week = elapsedWorkingMs(
      berlin,
      toUtcDate('2026-03-23T00:00:00Z'),
      toUtcDate('2026-03-28T00:00:00Z'),
    );
    expect(week).toBe(40 * HOUR);
  });
});

describe('ปฏิทิน · G · 24×7', () => {
  it('ทุกเวลาคือเวลาทำการ', () => {
    expect(isWorkingTime(HOURS_24_7, toUtcDate('2026-08-30T03:00:00Z'))).toBe(true);
    expect(isWorkingTime(HOURS_24_7, toUtcDate('2026-01-01T00:00:00Z'))).toBe(true);
  });

  it('เวลาที่ผ่านไปเท่ากับเวลาจริงเสมอ', () => {
    const from = toUtcDate('2026-08-28T20:00:00Z');
    const to = toUtcDate('2026-08-31T08:00:00Z');
    expect(elapsedWorkingMs(HOURS_24_7, from, to)).toBe(to.getTime() - from.getTime());
  });

  it('addWorkingMs เท่ากับการบวกเวลาตรง ๆ', () => {
    const from = toUtcDate('2026-08-28T20:00:00Z');
    expect(addWorkingMs(HOURS_24_7, from, 5 * HOUR).getTime()).toBe(from.getTime() + 5 * HOUR);
  });
});
