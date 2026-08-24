/**
 * วันหยุดราชการไทย
 *
 * ⚠️ **ข้อมูลนี้ต้องตรวจสอบและอัปเดตทุกปี — ห้ามถือว่าถูกต้องตลอดไป**
 *
 * วันหยุดไทยแบ่งเป็นสามกลุ่มที่มีความแน่นอนต่างกัน:
 *
 *   1. **วันที่ตายตัว** — ปีใหม่, สงกรานต์, วันแรงงาน, วันพ่อ, วันแม่, วันรัฐธรรมนูญ
 *      คาดเดาล่วงหน้าได้ แต่ยังต้องดูวันหยุดชดเชย
 *
 *   2. **วันตามปฏิทินจันทรคติ** — มาฆบูชา, วิสาขบูชา, อาสาฬหบูชา, เข้าพรรษา
 *      **เปลี่ยนทุกปี คำนวณจากข้างขึ้นข้างแรม** ต้องดูประกาศจริง
 *
 *   3. **วันหยุดชดเชยและวันหยุดพิเศษที่ ครม. ประกาศ**
 *      **ไม่มีทางคาดเดาได้เลย** ต้องรอประกาศราชกิจจานุเบกษา
 *
 * ผลถ้าใช้ข้อมูลผิด: ตั๋วที่เปิดก่อนวันหยุดยาวจะถูกคำนวณว่าหลุด SLA
 * ทั้งที่ทีมไม่ได้ทำงานในวันนั้น — เป็นความผิดพลาดที่ Agent จะรู้สึกว่าไม่ยุติธรรม
 * และทำให้เลิกเชื่อตัวเลข SLA ทั้งระบบ
 *
 * แหล่งอ้างอิงที่ต้องใช้: ประกาศธนาคารแห่งประเทศไทย และมติคณะรัฐมนตรี
 */

export interface HolidaySet {
  year: number;
  /** ตรวจสอบกับประกาศจริงแล้วหรือยัง — false = ยังเป็นค่าประมาณ ห้ามใช้ใน production */
  verified: boolean;
  /** YYYY-MM-DD */
  dates: readonly string[];
  note?: string;
}

/**
 * วันหยุดที่ตายตัวทุกปี — ยังไม่รวมวันหยุดชดเชย
 * ใช้เป็นฐานเท่านั้น ไม่ใช่รายการที่สมบูรณ์
 */
export function fixedThaiHolidays(year: number): string[] {
  const d = (m: number, day: number): string =>
    `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return [
    d(1, 1), // วันขึ้นปีใหม่
    d(4, 6), // วันจักรี
    d(4, 13), // สงกรานต์
    d(4, 14),
    d(4, 15),
    d(5, 1), // วันแรงงาน
    d(5, 4), // วันฉัตรมงคล
    d(6, 3), // วันเฉลิมพระชนมพรรษา สมเด็จพระนางเจ้าฯ พระบรมราชินี
    d(7, 28), // วันเฉลิมพระชนมพรรษา พระบาทสมเด็จพระเจ้าอยู่หัว
    d(8, 12), // วันแม่แห่งชาติ
    d(10, 13), // วันนวมินทรมหาราช
    d(10, 23), // วันปิยมหาราช
    d(12, 5), // วันพ่อแห่งชาติ
    d(12, 10), // วันรัฐธรรมนูญ
    d(12, 31), // วันสิ้นปี
  ];
}

/**
 * วันหยุดชดเชย — เมื่อวันหยุดตรงกับเสาร์หรืออาทิตย์ ให้หยุดวันทำการถัดไป
 *
 * นี่คือ **กฎทั่วไป** ที่ใช้ได้เกือบทุกครั้ง แต่ ครม. มีอำนาจประกาศเป็นอย่างอื่น
 * จึงต้องยังตรวจกับประกาศจริงอยู่ดี
 */
export function withSubstitutionDays(dates: readonly string[]): string[] {
  const set = new Set(dates);
  const out = new Set(dates);

  for (const date of [...dates].sort()) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) continue;

    // เลื่อนไปวันทำการถัดไปที่ยังไม่เป็นวันหยุด
    const cursor = new Date(`${date}T00:00:00Z`);
    for (let i = 0; i < 7; i += 1) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const key = cursor.toISOString().slice(0, 10);
      const d = cursor.getUTCDay();
      if (d !== 0 && d !== 6 && !set.has(key) && !out.has(key)) {
        out.add(key);
        break;
      }
    }
  }
  return [...out].sort();
}

/**
 * ชุดวันหยุดที่ระบบใช้เป็นค่าเริ่มต้น
 *
 * `verified: false` ทุกปีจนกว่าจะมีคนตรวจกับประกาศจริงและเปลี่ยนเป็น true
 * ระบบต้องเตือนแอดมินเมื่อใช้ปฏิทินที่ยังไม่ได้ตรวจสอบ
 */
export function defaultThaiHolidays(year: number): HolidaySet {
  return {
    year,
    verified: false,
    dates: withSubstitutionDays(fixedThaiHolidays(year)),
    note:
      'ยังไม่รวมวันสำคัญทางพุทธศาสนาตามปฏิทินจันทรคติ (มาฆบูชา วิสาขบูชา อาสาฬหบูชา เข้าพรรษา) ' +
      'และวันหยุดพิเศษที่ ครม. ประกาศ — ต้องเพิ่มด้วยมือจากประกาศจริงทุกปี',
  };
}

export class UnverifiedCalendarError extends Error {
  constructor(year: number) {
    super(
      `ปฏิทินวันหยุดปี ${year} ยังไม่ได้ตรวจสอบกับประกาศจริง — ` +
        'ห้ามใช้คำนวณ SLA บน production เพราะตัวเลขจะผิดโดยไม่มีใครรู้',
    );
    this.name = 'UnverifiedCalendarError';
  }
}

/** เรียกก่อนใช้ปฏิทินใน production — ล้มดังดีกว่าคำนวณผิดเงียบ ๆ */
export function assertVerified(set: HolidaySet): void {
  if (!set.verified) throw new UnverifiedCalendarError(set.year);
}
