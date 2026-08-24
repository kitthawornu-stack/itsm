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
