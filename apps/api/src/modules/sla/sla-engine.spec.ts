/**
 * SLA Engine — ส่วนที่สองของชุดทดสอบ
 *
 * หมวดที่ครอบคลุม:
 *   A. วงจรพื้นฐาน — เริ่ม เดิน จบ
 *   B. พักและกลับมาเดิน
 *   C. ตั๋วที่เปิดนอกเวลาทำการ
 *   D. พักคร่อมวันหยุดยาวสงกรานต์
 *   E. เปลี่ยนความสำคัญกลางทางแล้วเป้าเปลี่ยน
 *   F. ตั๋วที่ถูกเปิดใหม่หลังปิดไปแล้ว
 *   G. breachAt — จุดที่จะหลุด
 *   H. การแจ้งเตือนที่ 50% / 75% / 100%
 *   I. เคสที่ต้องล้มดัง
 */
import { describe, expect, it } from 'vitest';
import { toUtcDate, type UtcDate } from '@itsm/types';

import { HOURS_24_7, officeHoursThai } from './business-calendar';
import {
  MissingTargetError,
  SlaEventOrderError,
  computeSla,
  notificationTimes,
  type SlaEvent,
} from './sla-engine';

const HOUR = 3_600_000;

const th = (iso: string): UtcDate => toUtcDate(`${iso}+07:00`);
const office = officeHoursThai();
const songkran = officeHoursThai(['2026-04-13', '2026-04-14', '2026-04-15']);

const ev = (kind: SlaEvent['kind'], iso: string, newTargetMs?: number): SlaEvent => ({
  kind,
  at: th(iso),
  ...(newTargetMs === undefined ? {} : { newTargetMs }),
});

describe('SLA · A · วงจรพื้นฐาน', () => {
  it('ยังไม่เริ่มเมื่อไม่มีเหตุการณ์', () => {
    const s = computeSla(office, 4 * HOUR, [], th('2026-08-25T10:00:00'));
    expect(s.state).toBe('not-started');
    expect(s.elapsedMs).toBe(0);
    expect(s.breachAt).toBeNull();
  });

  it('เดินอยู่หลังเริ่ม และนับเวลาถึงตอนนี้', () => {
    const s = computeSla(office, 4 * HOUR, [ev('start', '2026-08-25T09:00:00')], th('2026-08-25T11:00:00'));
    expect(s.state).toBe('running');
    expect(s.elapsedMs).toBe(2 * HOUR);
    expect(s.remainingMs).toBe(2 * HOUR);
  });

  it('จบภายในเป้า -> met', () => {
    const s = computeSla(
      office,
      4 * HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('stop', '2026-08-25T12:00:00')],
      th('2026-08-25T18:00:00'),
    );
    expect(s.state).toBe('met');
    expect(s.elapsedMs).toBe(3 * HOUR);
    expect(s.isBreached).toBe(false);
    expect(s.breachAt).toBeNull();
  });

  it('จบเกินเป้า -> breached', () => {
    const s = computeSla(
      office,
      HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('stop', '2026-08-25T12:00:00')],
      th('2026-08-25T18:00:00'),
    );
    expect(s.state).toBe('breached');
    expect(s.elapsedMs).toBe(3 * HOUR);
    expect(s.remainingMs).toBe(0);
  });

  it('หลุดขณะยังเดินอยู่ -> breached แต่ยังนับต่อ', () => {
    const s = computeSla(office, HOUR, [ev('start', '2026-08-25T09:00:00')], th('2026-08-25T12:00:00'));
    expect(s.state).toBe('breached');
    expect(s.elapsedMs).toBe(3 * HOUR);
    expect(s.ratio).toBeCloseTo(3, 5);
  });

  it('เวลาที่ใช้พอดีเป้า ยังไม่ถือว่าหลุด', () => {
    const s = computeSla(
      office,
      3 * HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('stop', '2026-08-25T12:00:00')],
      th('2026-08-25T18:00:00'),
    );
    expect(s.isBreached).toBe(false);
    expect(s.state).toBe('met');
    expect(s.remainingMs).toBe(0);
  });

  it('start ซ้ำไม่รีเซ็ตนาฬิกา', () => {
    const s = computeSla(
      office,
      8 * HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('start', '2026-08-25T11:00:00')],
      th('2026-08-25T12:00:00'),
    );
    expect(s.elapsedMs).toBe(3 * HOUR);
  });
});

describe('SLA · B · พักและกลับมาเดิน', () => {
  it('เวลาระหว่างพักไม่ถูกนับ', () => {
    const s = computeSla(
      office,
      8 * HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('pause', '2026-08-25T10:00:00')],
      th('2026-08-25T16:00:00'),
    );
    expect(s.state).toBe('paused');
    expect(s.elapsedMs).toBe(HOUR);
  });

  it('กลับมาเดินแล้วนับต่อจากเดิม', () => {
    const s = computeSla(
      office,
      8 * HOUR,
      [
        ev('start', '2026-08-25T09:00:00'),
        ev('pause', '2026-08-25T10:00:00'),
        ev('resume', '2026-08-25T15:00:00'),
      ],
      th('2026-08-25T16:00:00'),
    );
    expect(s.state).toBe('running');
    expect(s.elapsedMs).toBe(2 * HOUR);
  });

  it('พักหลายรอบสะสมถูกต้อง', () => {
    const s = computeSla(
      office,
      8 * HOUR,
      [
        ev('start', '2026-08-25T09:00:00'),
        ev('pause', '2026-08-25T10:00:00'),
        ev('resume', '2026-08-25T11:00:00'),
        ev('pause', '2026-08-25T12:00:00'),
        ev('resume', '2026-08-25T14:00:00'),
      ],
      th('2026-08-25T15:00:00'),
    );
    expect(s.elapsedMs).toBe(3 * HOUR);
  });

  it('ขณะพัก breachAt เป็น null — ไม่มีความหมายเพราะนาฬิกาไม่เดิน', () => {
    const s = computeSla(
      office,
      8 * HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('pause', '2026-08-25T10:00:00')],
      th('2026-08-25T16:00:00'),
    );
    expect(s.breachAt).toBeNull();
  });

  it('resume ขณะที่เดินอยู่แล้วไม่มีผล', () => {
    const s = computeSla(
      office,
      8 * HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('resume', '2026-08-25T10:00:00')],
      th('2026-08-25T11:00:00'),
    );
    expect(s.elapsedMs).toBe(2 * HOUR);
  });

  it('pause ขณะที่พักอยู่แล้วไม่ทำให้เวลาหาย', () => {
    const s = computeSla(
      office,
      8 * HOUR,
      [
        ev('start', '2026-08-25T09:00:00'),
        ev('pause', '2026-08-25T10:00:00'),
        ev('pause', '2026-08-25T11:00:00'),
      ],
      th('2026-08-25T16:00:00'),
    );
    expect(s.elapsedMs).toBe(HOUR);
  });

  it('ตั๋วที่พักข้ามคืน กลับมาเดินเช้าวันถัดไป', () => {
    const s = computeSla(
      office,
      8 * HOUR,
      [
        ev('start', '2026-08-25T16:00:00'),
        ev('pause', '2026-08-25T17:00:00'),
        ev('resume', '2026-08-26T09:00:00'),
      ],
      th('2026-08-26T10:00:00'),
    );
    expect(s.elapsedMs).toBe(2 * HOUR);
  });
});

describe('SLA · C · ตั๋วที่เปิดนอกเวลาทำการ', () => {
  it('เปิดตอนตีสอง เวลาเริ่มนับตอน 08:30', () => {
    const s = computeSla(office, 4 * HOUR, [ev('start', '2026-08-25T02:00:00')], th('2026-08-25T09:30:00'));
    expect(s.elapsedMs).toBe(HOUR);
  });

  it('เปิดคืนวันศุกร์ ยังไม่นับอะไรจนถึงเช้าวันจันทร์', () => {
    const s = computeSla(office, 4 * HOUR, [ev('start', '2026-08-28T22:00:00')], th('2026-08-30T12:00:00'));
    expect(s.elapsedMs).toBe(0);
    expect(s.state).toBe('running');
  });

  it('เปิดคืนวันศุกร์ นับได้เมื่อถึงเช้าวันจันทร์', () => {
    const s = computeSla(office, 4 * HOUR, [ev('start', '2026-08-28T22:00:00')], th('2026-08-31T09:30:00'));
    expect(s.elapsedMs).toBe(HOUR);
  });

  it('ปฏิทิน 24×7 เปิดตอนตีสองนับทันที', () => {
    const s = computeSla(
      HOURS_24_7,
      4 * HOUR,
      [ev('start', '2026-08-25T02:00:00')],
      th('2026-08-25T04:00:00'),
    );
    expect(s.elapsedMs).toBe(2 * HOUR);
  });
});

describe('SLA · D · พักคร่อมวันหยุดยาว', () => {
  it('ตั๋วที่เปิดก่อนสงกรานต์ ไม่กินเวลาช่วงหยุดยาว', () => {
    const s = computeSla(
      songkran,
      4 * HOUR,
      [ev('start', '2026-04-10T16:30:00')],
      th('2026-04-16T09:30:00'),
    );
    // ศุกร์ 1 ชม. + พฤหัส 1 ชม.
    expect(s.elapsedMs).toBe(2 * HOUR);
    expect(s.isBreached).toBe(false);
  });

  it('ปฏิทินที่ไม่รู้จักวันหยุด ทำให้ตั๋วเดียวกันหลุด — เหตุผลที่ต้องมีปฏิทินถูกต้อง', () => {
    const s = computeSla(
      office,
      4 * HOUR,
      [ev('start', '2026-04-10T16:30:00')],
      th('2026-04-16T09:30:00'),
    );
    expect(s.isBreached).toBe(true);
  });

  it('พักคร่อมสงกรานต์แล้วกลับมา นับเฉพาะเวลาทำการจริง', () => {
    const s = computeSla(
      songkran,
      8 * HOUR,
      [
        ev('start', '2026-04-10T09:00:00'),
        ev('pause', '2026-04-10T11:00:00'),
        ev('resume', '2026-04-16T09:00:00'),
      ],
      th('2026-04-16T12:00:00'),
    );
    expect(s.elapsedMs).toBe(5 * HOUR);
  });
});

describe('SLA · E · เปลี่ยนความสำคัญกลางทาง', () => {
  it('เปลี่ยนเป้าไม่ล้างเวลาที่ใช้ไปแล้ว', () => {
    const s = computeSla(
      office,
      8 * HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('target-change', '2026-08-25T11:00:00', 4 * HOUR)],
      th('2026-08-25T12:00:00'),
    );
    expect(s.elapsedMs).toBe(3 * HOUR);
    expect(s.targetMs).toBe(4 * HOUR);
    expect(s.remainingMs).toBe(HOUR);
  });

  it('ยกระดับเป็น P1 แล้วหลุดทันที เพราะเวลาที่ใช้ไปเกินเป้าใหม่', () => {
    // ใช้ไป 3 ชม. แล้วเป้าลดเหลือ 1 ชม. -> หลุดทันที ซึ่งถูกต้อง
    const s = computeSla(
      office,
      8 * HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('target-change', '2026-08-25T12:00:00', HOUR)],
      th('2026-08-25T12:00:00'),
    );
    expect(s.isBreached).toBe(true);
    expect(s.state).toBe('breached');
  });

  it('ลดความสำคัญลง ทำให้กลับมาไม่หลุด', () => {
    const s = computeSla(
      office,
      HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('target-change', '2026-08-25T12:00:00', 8 * HOUR)],
      th('2026-08-25T12:00:00'),
    );
    expect(s.isBreached).toBe(false);
    expect(s.state).toBe('running');
  });

  it('เปลี่ยนเป้าหลายครั้ง ใช้ค่าล่าสุด', () => {
    const s = computeSla(
      office,
      8 * HOUR,
      [
        ev('start', '2026-08-25T09:00:00'),
        ev('target-change', '2026-08-25T10:00:00', 4 * HOUR),
        ev('target-change', '2026-08-25T11:00:00', 6 * HOUR),
      ],
      th('2026-08-25T12:00:00'),
    );
    expect(s.targetMs).toBe(6 * HOUR);
  });

  it('เปลี่ยนเป้าขณะพักอยู่ ไม่ทำให้นาฬิกากลับมาเดิน', () => {
    const s = computeSla(
      office,
      8 * HOUR,
      [
        ev('start', '2026-08-25T09:00:00'),
        ev('pause', '2026-08-25T10:00:00'),
        ev('target-change', '2026-08-25T11:00:00', 4 * HOUR),
      ],
      th('2026-08-25T16:00:00'),
    );
    expect(s.state).toBe('paused');
    expect(s.elapsedMs).toBe(HOUR);
  });
});

describe('SLA · F · ตั๋วที่ถูกเปิดใหม่หลังปิดแล้ว', () => {
  it('เหตุการณ์หลัง stop ถูกละเว้น — นาฬิกาเดิมจบไปแล้ว', () => {
    const s = computeSla(
      office,
      8 * HOUR,
      [
        ev('start', '2026-08-25T09:00:00'),
        ev('stop', '2026-08-25T10:00:00'),
        ev('resume', '2026-08-25T11:00:00'),
      ],
      th('2026-08-25T16:00:00'),
    );
    expect(s.state).toBe('met');
    expect(s.elapsedMs).toBe(HOUR);
  });

  it('ตั๋วที่เปิดใหม่ต้องใช้นาฬิกาเรือนใหม่ ไม่ใช่ต่อจากเรือนเดิม', () => {
    // นาฬิกาเรือนใหม่ = รายการเหตุการณ์ชุดใหม่
    const reopened = computeSla(
      office,
      4 * HOUR,
      [ev('start', '2026-08-26T09:00:00')],
      th('2026-08-26T10:00:00'),
    );
    expect(reopened.elapsedMs).toBe(HOUR);
    expect(reopened.state).toBe('running');
  });
});

describe('SLA · G · breachAt', () => {
  it('คำนวณจุดที่จะหลุดในวันเดียวกัน', () => {
    const s = computeSla(office, 4 * HOUR, [ev('start', '2026-08-25T09:00:00')], th('2026-08-25T10:00:00'));
    // ใช้ไป 1 ชม. เหลือ 3 ชม. จาก 10:00 -> 13:00
    expect(s.breachAt?.getTime()).toBe(th('2026-08-25T13:00:00').getTime());
  });

  it('จุดที่จะหลุดข้ามคืนเมื่อเวลาที่เหลือเกินเวลาทำการที่เหลือของวัน', () => {
    const s = computeSla(office, 4 * HOUR, [ev('start', '2026-08-25T16:00:00')], th('2026-08-25T16:00:00'));
    // จาก 16:00 เหลือ 1.5 ชม. ของวันนี้ + 2.5 ชม. พรุ่งนี้ -> 11:00
    expect(s.breachAt?.getTime()).toBe(th('2026-08-26T11:00:00').getTime());
  });

  it('จุดที่จะหลุดข้ามสุดสัปดาห์', () => {
    const s = computeSla(office, 4 * HOUR, [ev('start', '2026-08-28T16:00:00')], th('2026-08-28T16:00:00'));
    expect(s.breachAt?.getTime()).toBe(th('2026-08-31T11:00:00').getTime());
  });

  it('ตอนนี้อยู่นอกเวลาทำการ จุดที่จะหลุดเริ่มนับจากเวลาเปิดถัดไป', () => {
    const s = computeSla(office, 2 * HOUR, [ev('start', '2026-08-25T22:00:00')], th('2026-08-25T22:00:00'));
    expect(s.breachAt?.getTime()).toBe(th('2026-08-26T10:30:00').getTime());
  });

  it('หลุดไปแล้ว breachAt เป็น null', () => {
    const s = computeSla(office, HOUR, [ev('start', '2026-08-25T09:00:00')], th('2026-08-25T14:00:00'));
    expect(s.breachAt).toBeNull();
  });
});

describe('SLA · H · การแจ้งเตือน', () => {
  it('คืนเวลาแจ้งเตือนสามจุดเมื่อเพิ่งเริ่ม', () => {
    const now = th('2026-08-25T09:00:00');
    const s = computeSla(office, 4 * HOUR, [ev('start', '2026-08-25T09:00:00')], now);
    const times = notificationTimes(office, s, now);
    expect(times.map((t) => t.threshold)).toEqual([0.5, 0.75, 1]);
    expect(times[0]?.at.getTime()).toBe(th('2026-08-25T11:00:00').getTime());
    expect(times[1]?.at.getTime()).toBe(th('2026-08-25T12:00:00').getTime());
    expect(times[2]?.at.getTime()).toBe(th('2026-08-25T13:00:00').getTime());
  });

  it('ข้ามจุดที่เลยมาแล้ว', () => {
    const now = th('2026-08-25T12:00:00');
    const s = computeSla(office, 4 * HOUR, [ev('start', '2026-08-25T09:00:00')], now);
    const times = notificationTimes(office, s, now);
    // ใช้ไป 3 ชม. = 75% แล้ว เหลือแค่จุด 100%
    expect(times.map((t) => t.threshold)).toEqual([1]);
  });

  it('ไม่แจ้งเตือนเมื่อนาฬิกาหยุด', () => {
    const now = th('2026-08-25T12:00:00');
    const s = computeSla(
      office,
      4 * HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('pause', '2026-08-25T10:00:00')],
      now,
    );
    expect(notificationTimes(office, s, now)).toEqual([]);
  });

  it('ไม่แจ้งเตือนเมื่อตั๋วปิดแล้ว', () => {
    const now = th('2026-08-25T16:00:00');
    const s = computeSla(
      office,
      4 * HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('stop', '2026-08-25T10:00:00')],
      now,
    );
    expect(notificationTimes(office, s, now)).toEqual([]);
  });

  it('เวลาแจ้งเตือนข้ามวันหยุดยาวถูกต้อง', () => {
    const now = th('2026-04-10T17:00:00');
    const s = computeSla(songkran, 2 * HOUR, [ev('start', '2026-04-10T17:00:00')], now);
    const times = notificationTimes(songkran, s, now, [1]);
    // เหลือ 30 นาทีของวันศุกร์ + 1.5 ชม. หลังสงกรานต์ -> พฤหัส 16 เม.ย. 10:00
    expect(times[0]?.at.getTime()).toBe(th('2026-04-16T10:00:00').getTime());
  });
});

describe('SLA · I · เคสที่ต้องล้มดัง', () => {
  it('เหตุการณ์ที่เรียงผิดลำดับต้องโยน error ไม่ใช่คำนวณมั่ว', () => {
    expect(() =>
      computeSla(
        office,
        4 * HOUR,
        [ev('start', '2026-08-25T12:00:00'), ev('pause', '2026-08-25T09:00:00')],
        th('2026-08-25T16:00:00'),
      ),
    ).toThrow(SlaEventOrderError);
  });

  it('target-change ที่ไม่ระบุเป้าใหม่ต้องโยน error', () => {
    expect(() =>
      computeSla(
        office,
        4 * HOUR,
        [ev('start', '2026-08-25T09:00:00'), { kind: 'target-change', at: th('2026-08-25T10:00:00') }],
        th('2026-08-25T11:00:00'),
      ),
    ).toThrow(MissingTargetError);
  });

  it('เป้าเป็นศูนย์ ไม่ทำให้หารด้วยศูนย์', () => {
    const s = computeSla(office, 0, [ev('start', '2026-08-25T09:00:00')], th('2026-08-25T10:00:00'));
    expect(Number.isFinite(s.ratio)).toBe(true);
    expect(s.isBreached).toBe(true);
  });
});

describe('SLA · breachedAt · จุดที่หลุดไปแล้ว', () => {
  /**
   * `breachAt` ตอบว่า "จะหลุดเมื่อไร" และเป็น null ทันทีที่หลุด
   * `breachedAt` ตอบว่า "หลุดไปแล้วตอนไหน" ซึ่งเป็นคนละคำถาม
   * ถ้าไม่มีค่านี้ ระบบรู้ว่าหลุดแต่กู้การแจ้งเตือนที่ตกหล่นไม่ได้
   * และรายงานตอบไม่ได้ว่าช้าไปเท่าไร
   */

  it('ยังไม่หลุด = null', () => {
    const s = computeSla(office, 4 * HOUR, [ev('start', '2026-08-25T09:00:00')], th('2026-08-25T11:00:00'));
    expect(s.isBreached).toBe(false);
    expect(s.breachedAt).toBeNull();
  });

  it('หลุดแล้ว = เวลาที่ข้ามเป้าพอดี ไม่ใช่เวลาที่ถาม', () => {
    // เริ่ม 09:00 เป้า 2 ชม. -> ข้ามเป้าตอน 11:00 แม้จะถามตอน 15:00
    const s = computeSla(office, 2 * HOUR, [ev('start', '2026-08-25T09:00:00')], th('2026-08-25T15:00:00'));
    expect(s.isBreached).toBe(true);
    expect(s.breachedAt?.toISOString()).toBe(th('2026-08-25T11:00:00').toISOString());
  });

  it('**ค่าคงที่ไม่ว่าจะถามตอนไหน** — ถามช้าลงไม่ทำให้เวลาหลุดขยับ', () => {
    const of = (nowIso: string) =>
      computeSla(office, 2 * HOUR, [ev('start', '2026-08-25T09:00:00')], th(nowIso)).breachedAt?.toISOString();
    expect(of('2026-08-25T12:00:00')).toBe(of('2026-08-28T12:00:00'));
  });

  it('เวลาที่พักไม่นับ — จุดที่หลุดเลื่อนออกไปตามที่พัก', () => {
    const s = computeSla(
      office,
      2 * HOUR,
      [
        ev('start', '2026-08-25T09:00:00'),
        ev('pause', '2026-08-25T10:00:00'), // ใช้ไป 1 ชม.
        ev('resume', '2026-08-25T13:00:00'),
      ],
      th('2026-08-25T16:00:00'),
    );
    // เหลืออีก 1 ชม. นับจาก 13:00 -> หลุด 14:00
    expect(s.breachedAt?.toISOString()).toBe(th('2026-08-25T14:00:00').toISOString());
  });

  it('ข้ามคืน — จุดที่หลุดตกในเวลาทำการวันถัดไป ไม่ใช่กลางดึก', () => {
    // เริ่มบ่ายสี่ เป้า 4 ชม. -> วันนี้เหลือถึงเลิกงาน แล้วต่อวันรุ่งขึ้น
    const s = computeSla(office, 4 * HOUR, [ev('start', '2026-08-25T16:00:00')], th('2026-08-28T12:00:00'));
    const at = s.breachedAt;
    expect(at).not.toBeNull();
    const hourBkk = Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        hour12: false,
        timeZone: 'Asia/Bangkok',
      }).format(at as Date),
    );
    expect(hourBkk).toBeGreaterThanOrEqual(9);
    expect(hourBkk).toBeLessThanOrEqual(18);
  });

  it('ตั๋วที่ปิดแบบหลุด ยังบอกได้ว่าหลุดตอนไหน', () => {
    const s = computeSla(
      office,
      2 * HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('stop', '2026-08-25T15:00:00')],
      th('2026-08-26T09:00:00'),
    );
    expect(s.state).toBe('breached');
    expect(s.breachedAt?.toISOString()).toBe(th('2026-08-25T11:00:00').toISOString());
  });

  it('ยกระดับความสำคัญจนเป้าแคบกว่าที่ใช้ไปแล้ว = หลุด ณ วินาทีที่เปลี่ยน', () => {
    const s = computeSla(
      office,
      8 * HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('target-change', '2026-08-25T12:00:00', HOUR)],
      th('2026-08-25T14:00:00'),
    );
    expect(s.isBreached).toBe(true);
    expect(s.breachedAt?.toISOString()).toBe(th('2026-08-25T12:00:00').toISOString());
  });

  it('ขยายเป้าจนกลับมาไม่หลุด = ล้างค่าเดิมทิ้ง ไม่ค้างไว้หลอกรายงาน', () => {
    const s = computeSla(
      office,
      2 * HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('target-change', '2026-08-25T12:00:00', 8 * HOUR)],
      th('2026-08-25T14:00:00'),
    );
    expect(s.isBreached).toBe(false);
    expect(s.breachedAt).toBeNull();
  });

  it('วันหยุดสงกรานต์ไม่นับ — จุดที่หลุดข้ามไปหลังหยุดยาว', () => {
    const s = computeSla(songkran, 4 * HOUR, [ev('start', '2026-04-10T16:00:00')], th('2026-04-20T12:00:00'));
    const at = s.breachedAt;
    expect(at).not.toBeNull();
    // ศุกร์ 16:00 เหลือ 2 ชม. -> ที่เหลือต้องข้ามเสาร์-อาทิตย์และ 13-15 เม.ย.
    expect((at as Date).toISOString() >= th('2026-04-16T00:00:00').toISOString()).toBe(true);
  });

  it('breachAt กับ breachedAt ไม่มีทางมีค่าพร้อมกัน', () => {
    for (const target of [HOUR, 2 * HOUR, 4 * HOUR, 40 * HOUR]) {
      const s = computeSla(office, target, [ev('start', '2026-08-25T09:00:00')], th('2026-08-25T14:00:00'));
      expect(s.breachAt !== null && s.breachedAt !== null).toBe(false);
    }
  });
});

describe('SLA · breachedAt · เปลี่ยนเป้าหลายครั้ง', () => {
  /**
   * เคสนี้คือเคสเดียวที่พิสูจน์ว่าการล้างค่าตอนเปลี่ยนเป้าจำเป็นจริง
   * เคสเปลี่ยนครั้งเดียวผ่านได้ด้วยตัวกรอง `isBreached` ตอนคืนค่า
   * จึงไม่ได้พิสูจน์อะไรเลย — ต้องเปลี่ยนสองครั้งถึงจะเห็นความต่าง
   */
  it('หลุด -> ขยายเป้าจนไม่หลุด -> แคบอีกครั้ง = หลุด ณ ครั้งที่แคบ ไม่ใช่ครั้งแรก', () => {
    const s = computeSla(
      office,
      2 * HOUR,
      [
        ev('start', '2026-08-25T09:00:00'),
        // 12:00 ใช้ไป 3 ชม. เกินเป้า 2 ชม. -> เคยหลุดที่ 11:00
        ev('target-change', '2026-08-25T12:00:00', 8 * HOUR), // กลับมาไม่หลุด
        ev('target-change', '2026-08-25T14:00:00', HOUR), // แคบกว่าที่ใช้ไปแล้วมาก
      ],
      th('2026-08-25T16:00:00'),
    );
    expect(s.isBreached).toBe(true);
    // ต้องเป็น 14:00 — เพราะเป้า 1 ชม. เพิ่งมีผลตอนนั้น
    // ถ้าตอบ 11:00 แปลว่าค่าเก่าค้างอยู่ข้ามการขยายเป้า
    expect(s.breachedAt?.toISOString()).toBe(th('2026-08-25T14:00:00').toISOString());
  });

  it('เป้าที่แคบกว่าที่ใช้ไปแล้ว ไม่เรียกคำนวณด้วยระยะเวลาติดลบ', () => {
    // ผลลัพธ์ต้องอยู่ในช่วงที่สมเหตุสมผล ไม่ใช่ก่อนเวลาเริ่มงาน
    const s = computeSla(
      office,
      8 * HOUR,
      [ev('start', '2026-08-25T09:00:00'), ev('target-change', '2026-08-25T15:00:00', HOUR)],
      th('2026-08-25T17:00:00'),
    );
    const at = s.breachedAt as Date;
    expect(at.getTime()).toBeGreaterThanOrEqual(th('2026-08-25T09:00:00').getTime());
    expect(at.getTime()).toBeLessThanOrEqual(th('2026-08-25T17:00:00').getTime());
  });
});
