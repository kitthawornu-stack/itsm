/**
 * วันหยุดไทย — ส่วนที่สามของชุดทดสอบ SLA
 *
 * สิ่งที่ทดสอบได้: กฎวันหยุดชดเชย และกลไกที่กันไม่ให้ใช้ปฏิทินที่ยังไม่ตรวจสอบ
 *
 * สิ่งที่ทดสอบ **ไม่ได้** และต้องอาศัยคน: ความถูกต้องของรายการวันหยุดจริงในแต่ละปี
 * วันสำคัญทางพุทธศาสนาคำนวณจากปฏิทินจันทรคติ และวันหยุดพิเศษมาจากมติ ครม.
 * — ไม่มีสูตรใดคาดเดาได้ ต้องอ่านประกาศ
 */
import { describe, expect, it } from 'vitest';

import {
  UnverifiedCalendarError,
  assertVerified,
  defaultThaiHolidays,
  fixedThaiHolidays,
  withSubstitutionDays,
} from './thai-holidays';

describe('วันหยุดไทย · วันที่ตายตัว', () => {
  it('มีวันขึ้นปีใหม่', () => {
    expect(fixedThaiHolidays(2026)).toContain('2026-01-01');
  });

  it('มีสงกรานต์ครบสามวัน', () => {
    const h = fixedThaiHolidays(2026);
    expect(h).toContain('2026-04-13');
    expect(h).toContain('2026-04-14');
    expect(h).toContain('2026-04-15');
  });

  it('มีวันแรงงานและวันรัฐธรรมนูญ', () => {
    const h = fixedThaiHolidays(2026);
    expect(h).toContain('2026-05-01');
    expect(h).toContain('2026-12-10');
  });

  it('รูปแบบวันที่เป็น YYYY-MM-DD เสมอ', () => {
    for (const d of fixedThaiHolidays(2026)) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('ใช้ได้กับปีอื่นและเปลี่ยนปีตาม', () => {
    expect(fixedThaiHolidays(2027).every((d) => d.startsWith('2027-'))).toBe(true);
  });

  it('เดือนและวันเติมศูนย์นำหน้าถูกต้อง', () => {
    expect(fixedThaiHolidays(2026)).toContain('2026-01-01');
    expect(fixedThaiHolidays(2026)).toContain('2026-05-04');
  });
});

describe('วันหยุดไทย · วันหยุดชดเชย', () => {
  it('วันหยุดที่ตรงวันเสาร์ ได้ชดเชยวันจันทร์', () => {
    // 2026-01-03 เป็นวันเสาร์
    const out = withSubstitutionDays(['2026-01-03']);
    expect(out).toContain('2026-01-03');
    expect(out).toContain('2026-01-05'); // จันทร์
  });

  it('วันหยุดที่ตรงวันอาทิตย์ ได้ชดเชยวันจันทร์', () => {
    // 2026-01-04 เป็นวันอาทิตย์
    const out = withSubstitutionDays(['2026-01-04']);
    expect(out).toContain('2026-01-05');
  });

  it('วันหยุดที่ตรงวันธรรมดาไม่มีชดเชย', () => {
    // 2026-01-01 เป็นวันพฤหัสบดี
    expect(withSubstitutionDays(['2026-01-01'])).toEqual(['2026-01-01']);
  });

  it('เสาร์และอาทิตย์ติดกัน ได้ชดเชยสองวันไม่ซ้ำกัน', () => {
    const out = withSubstitutionDays(['2026-01-03', '2026-01-04']);
    expect(out).toContain('2026-01-05'); // จันทร์
    expect(out).toContain('2026-01-06'); // อังคาร
    expect(new Set(out).size).toBe(out.length);
  });

  it('ไม่ชดเชยทับวันที่เป็นวันหยุดอยู่แล้ว', () => {
    // เสาร์ 3 ม.ค. ชดเชย แต่จันทร์ 5 ม.ค. เป็นวันหยุดอยู่แล้ว -> ต้องไปอังคาร
    const out = withSubstitutionDays(['2026-01-03', '2026-01-05']);
    expect(out).toContain('2026-01-06');
  });

  it('ผลลัพธ์เรียงลำดับเสมอ', () => {
    const out = withSubstitutionDays(['2026-12-05', '2026-01-03', '2026-04-13']);
    expect(out).toEqual([...out].sort());
  });

  it('รายการว่างคืนรายการว่าง', () => {
    expect(withSubstitutionDays([])).toEqual([]);
  });

  it('ไม่แก้ไขรายการเดิม (ไม่ mutate)', () => {
    const input = ['2026-01-03'];
    withSubstitutionDays(input);
    expect(input).toEqual(['2026-01-03']);
  });
});

describe('วันหยุดไทย · การกันปฏิทินที่ยังไม่ตรวจสอบ', () => {
  it('ปฏิทินเริ่มต้นถูกทำเครื่องหมายว่ายังไม่ตรวจสอบ', () => {
    expect(defaultThaiHolidays(2026).verified).toBe(false);
  });

  it('มีหมายเหตุบอกว่ายังขาดอะไร', () => {
    const set = defaultThaiHolidays(2026);
    expect(set.note).toContain('จันทรคติ');
    expect(set.note).toContain('ครม.');
  });

  it('assertVerified โยน error เมื่อยังไม่ตรวจสอบ', () => {
    expect(() => {
      assertVerified(defaultThaiHolidays(2026));
    }).toThrow(UnverifiedCalendarError);
  });

  it('ข้อความ error บอกปีที่มีปัญหา', () => {
    try {
      assertVerified(defaultThaiHolidays(2027));
      expect.unreachable('ควรโยน error');
    } catch (e) {
      expect((e as Error).message).toContain('2027');
    }
  });

  it('assertVerified ผ่านเมื่อตรวจสอบแล้ว', () => {
    expect(() => {
      assertVerified({ year: 2026, verified: true, dates: ['2026-01-01'] });
    }).not.toThrow();
  });

  it('ปฏิทินเริ่มต้นรวมวันหยุดชดเชยไว้แล้ว', () => {
    const set = defaultThaiHolidays(2026);
    // 2026-12-05 (วันพ่อ) เป็นวันเสาร์ -> ต้องมีชดเชยวันจันทร์ 7 ธ.ค.
    expect(set.dates).toContain('2026-12-05');
    expect(set.dates).toContain('2026-12-07');
  });

  it('ปฏิทินเริ่มต้นไม่มีวันซ้ำ', () => {
    const d = defaultThaiHolidays(2026).dates;
    expect(new Set(d).size).toBe(d.length);
  });
});
