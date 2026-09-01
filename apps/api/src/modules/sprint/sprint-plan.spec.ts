/**
 * ข้อกำหนดของ Sprint — **เขียนก่อนโค้ด**
 *
 * เอนจินนี้ผิดแล้วไม่พัง มันตอบผิดเงียบ ๆ แล้วคำตอบนั้นกลายเป็นตัวเลขที่ทีม
 * ใช้วางแผนรอบถัดไป · เข้าเกณฑ์เดียวกับเอนจินตัวอื่นในโครงการนี้
 *
 * ## สองอย่างที่ต้องแยกให้ขาด
 *
 *   1. **กำหนดการ กับ เวลาที่เกิดขึ้นจริง** — สปรินต์ที่วางไว้ว่าเริ่ม 1 ก.ย.
 *      แต่กดเริ่มจริงวันที่ 3 คือคนละเรื่อง · บทเรียนเดียวกับ `breachAt`
 *      กับ `breachedAt` ที่เคยทำให้ตอบไม่ได้ว่า "หลุดตอนไหน"
 *   2. **สิ่งที่รับปากไว้ตอนเริ่ม กับ สิ่งที่อยู่ในสปรินต์ตอนจบ** — ถ้าไม่เก็บ
 *      ภาพตอนเริ่มไว้ คำถาม "ทำได้ตามที่รับปากไหม" จะตอบไม่ได้ตลอดกาล
 *      และตัวเลข "ทำเสร็จ 40 แต้ม" จะซ่อนไว้ว่า 15 แต้มเพิ่งใส่เข้ามากลางทาง
 */
import { describe, expect, it } from 'vitest';
import { toUtcDate } from '@itsm/types';

import {
  AlreadyStartedError,
  NotStartedError,
  OneActiveSprintError,
  SprintClosedError,
  assertCanComplete,
  assertCanStart,
  assertNotClosed,
  commitmentOf,
  completionOf,
  velocityOf,
  type SprintItem,
  type SprintSnapshot,
} from './sprint-plan';

const T0 = toUtcDate('2026-09-01T02:00:00.000Z');
const T1 = toUtcDate('2026-09-15T02:00:00.000Z');

function sprint(over: Partial<SprintSnapshot> = {}): SprintSnapshot {
  return {
    id: 's1',
    state: 'planned',
    startedAt: null,
    completedAt: null,
    committedItemIds: [],
    committedPoints: 0,
    ...over,
  };
}

function item(id: string, over: Partial<SprintItem> = {}): SprintItem {
  return { id, points: 3, done: false, ...over };
}

// ============================================================

describe('สปรินต์ · A · เริ่มได้เมื่อไร', () => {
  it('สปรินต์ที่วางแผนไว้ เริ่มได้', () => {
    expect(() => {
      assertCanStart(sprint(), []);
    }).not.toThrow();
  });

  it('สปรินต์ที่เริ่มไปแล้ว เริ่มซ้ำไม่ได้', () => {
    expect(() => {
      assertCanStart(sprint({ state: 'active', startedAt: T0 }), []);
    }).toThrow(AlreadyStartedError);
  });

  /**
   * สปรินต์ที่ปิดไปแล้ว แตะไม่ได้อีก
   *
   * ถ้าเปิดใหม่ได้ ตัวเลขในรายงานของรอบที่ผ่านมาจะเปลี่ยนย้อนหลัง —
   * และไม่มีใครรู้ว่าตัวเลขที่เคยเห็นในที่ประชุมเป็นตัวไหน
   */
  it('สปรินต์ที่ปิดแล้ว เริ่มใหม่ไม่ได้', () => {
    expect(() => {
      assertCanStart(sprint({ state: 'completed', completedAt: T1 }), []);
    }).toThrow(SprintClosedError);
  });

  it('มีสปรินต์อื่นที่กำลังทำอยู่ เริ่มอันใหม่ไม่ได้', () => {
    const others = [sprint({ id: 's0', state: 'active', startedAt: T0 })];
    expect(() => {
      assertCanStart(sprint(), others);
    }).toThrow(OneActiveSprintError);
  });

  it('สปรินต์อื่นที่ปิดแล้วหรือยังไม่เริ่ม ไม่ขวาง', () => {
    const others = [
      sprint({ id: 's0', state: 'completed', completedAt: T0 }),
      sprint({ id: 's2', state: 'planned' }),
    ];
    expect(() => {
      assertCanStart(sprint(), others);
    }).not.toThrow();
  });
});

// ============================================================

describe('สปรินต์ · A2 · ปิดแล้วแตะไม่ได้', () => {
  /**
   * คำถามคนละข้อกับ "เริ่มได้ไหม" และ "ปิดได้ไหม"
   *
   * เคยเขียนโดยเรียก `assertCanComplete` มาใช้ซ้ำ แล้วมันปฏิเสธสปรินต์ที่ยัง
   * `planned` ด้วย `NotStartedError` — ซึ่งเป็นคำตอบของคำถามที่ไม่มีใครถาม
   * และทำให้เพิ่มงานเข้าสปรินต์ที่ยังไม่เริ่มไม่ได้เลย
   */
  it('สปรินต์ที่ยังไม่เริ่ม แตะได้', () => {
    expect(() => {
      assertNotClosed(sprint());
    }).not.toThrow();
  });

  it('สปรินต์ที่กำลังทำอยู่ แตะได้', () => {
    expect(() => {
      assertNotClosed(sprint({ state: 'active', startedAt: T0 }));
    }).not.toThrow();
  });

  it('สปรินต์ที่ปิดแล้ว แตะไม่ได้', () => {
    expect(() => {
      assertNotClosed(sprint({ state: 'completed', completedAt: T1 }));
    }).toThrow(SprintClosedError);
  });
});

// ============================================================

describe('สปรินต์ · B · ภาพตอนเริ่ม คือคำรับปาก', () => {
  it('เก็บรายการและแต้มที่มีอยู่ ณ ตอนกดเริ่ม', () => {
    const c = commitmentOf([item('a'), item('b', { points: 5 })], T0);
    expect(c.committedItemIds).toEqual(['a', 'b']);
    expect(c.committedPoints).toBe(8);
    expect(c.startedAt).toBe(T0);
  });

  /**
   * งานที่ยังไม่ประเมิน ต้องนับแยก ไม่ใช่นับเป็นศูนย์เงียบ ๆ
   *
   * สปรินต์ที่มีงาน 20 ใบซึ่งยังไม่ประเมินสักใบ แล้วรายงานว่า "0 แต้ม"
   * เป็นการโกหกด้วยการละเว้น · ตัวเลขที่อ่านแล้วเข้าใจผิด แย่กว่าไม่มีตัวเลข
   */
  it('งานที่ยังไม่ประเมินถูกนับแยก ไม่ใช่กลืนเป็นศูนย์', () => {
    const c = commitmentOf([item('a', { points: null }), item('b', { points: 2 })], T0);
    expect(c.committedPoints).toBe(2);
    expect(c.unestimated).toBe(1);
  });

  it('สปรินต์ว่างเปล่าเริ่มได้ และรับปากศูนย์แต้ม', () => {
    const c = commitmentOf([], T0);
    expect(c.committedItemIds).toEqual([]);
    expect(c.committedPoints).toBe(0);
    expect(c.unestimated).toBe(0);
  });

  it('แต้มเป็นทศนิยมรวมได้ถูกต้อง', () => {
    const c = commitmentOf([item('a', { points: 0.5 }), item('b', { points: 1.5 })], T0);
    expect(c.committedPoints).toBe(2);
  });

  it('แต้มติดลบถือเป็นศูนย์ — ค่าที่ใส่ผิดต้องไม่ลดยอดรวม', () => {
    const c = commitmentOf([item('a', { points: -5 }), item('b', { points: 3 })], T0);
    expect(c.committedPoints).toBe(3);
  });
});

// ============================================================

describe('สปรินต์ · C · ตอนปิด', () => {
  const started = (): SprintSnapshot =>
    sprint({
      state: 'active',
      startedAt: T0,
      committedItemIds: ['a', 'b', 'c'],
      committedPoints: 9,
    });

  it('สปรินต์ที่ยังไม่เริ่ม ปิดไม่ได้', () => {
    expect(() => {
      assertCanComplete(sprint());
    }).toThrow(NotStartedError);
  });

  it('สปรินต์ที่ปิดแล้ว ปิดซ้ำไม่ได้', () => {
    expect(() => {
      assertCanComplete(sprint({ state: 'completed', completedAt: T1 }));
    }).toThrow(SprintClosedError);
  });

  it('งานที่เสร็จกับที่ไม่เสร็จ ถูกแยกออกจากกันชัดเจน', () => {
    const r = completionOf(
      started(),
      [item('a', { done: true }), item('b'), item('c', { done: true })],
      T1,
    );
    expect(r.doneIds.sort()).toEqual(['a', 'c']);
    expect(r.undoneIds).toEqual(['b']);
  });

  /**
   * **งานที่ยังไม่เสร็จต้องถูกส่งคืนออกมา ไม่ใช่หายไปกับสปรินต์**
   *
   * ถ้าเอนจินปิดสปรินต์แล้วเงียบ งานที่ค้างจะไม่อยู่ในสปรินต์ไหนเลยและ
   * ไม่อยู่ใน backlog ด้วย — หายจากทุกหน้าจอโดยไม่มีใครลบมัน
   */
  it('รายการงานค้างถูกส่งกลับให้ผู้เรียกจัดการต่อเสมอ', () => {
    const r = completionOf(started(), [item('a'), item('b'), item('c')], T1);
    expect(r.undoneIds).toHaveLength(3);
  });

  it('แต้มที่ทำเสร็จนับเฉพาะงานที่เสร็จ', () => {
    const r = completionOf(
      started(),
      [item('a', { done: true, points: 5 }), item('b', { points: 8 })],
      T1,
    );
    expect(r.completedPoints).toBe(5);
  });

  /**
   * งานที่เพิ่มเข้ามาหลังเริ่ม ต้องรายงานแยก
   *
   * "ทำเสร็จ 40 แต้ม" ที่ซ่อนไว้ว่า 15 แต้มเพิ่งใส่เข้ามากลางทาง ทำให้ทีม
   * วางแผนรอบถัดไปด้วยความเร็วที่ไม่มีอยู่จริง
   */
  it('งานที่เพิ่มหลังเริ่ม ถูกแยกจากงานที่รับปากไว้', () => {
    const r = completionOf(
      started(),
      [item('a', { done: true }), item('b'), item('c'), item('d', { done: true, points: 4 })],
      T1,
    );
    expect(r.addedAfterStartIds).toEqual(['d']);
    expect(r.addedAfterStartPoints).toBe(4);
  });

  it('งานที่ถูกเอาออกหลังเริ่ม ก็ถูกรายงานแยกเหมือนกัน', () => {
    const r = completionOf(started(), [item('a', { done: true }), item('b')], T1);
    expect(r.removedAfterStartIds).toEqual(['c']);
  });

  it('เวลาที่ปิดคือเวลาที่ส่งเข้ามา ไม่ใช่นาฬิกาในเอนจิน', () => {
    expect(completionOf(started(), [], T1).completedAt).toBe(T1);
  });

  it('สปรินต์ที่ไม่มีงานเลย ปิดได้และได้ศูนย์ทุกช่อง', () => {
    const r = completionOf(sprint({ state: 'active', startedAt: T0 }), [], T1);
    expect(r.doneIds).toEqual([]);
    expect(r.undoneIds).toEqual([]);
    expect(r.completedPoints).toBe(0);
  });
});

// ============================================================

describe('สปรินต์ · D · ความเร็วของทีม', () => {
  const done = (id: string, points: number): SprintSnapshot =>
    sprint({ id, state: 'completed', completedAt: T1, committedPoints: points });

  it('เฉลี่ยจากสปรินต์ที่ปิดแล้วเท่านั้น', () => {
    const v = velocityOf(
      [done('s1', 10), done('s2', 20), sprint({ id: 's3', state: 'active', startedAt: T0 })],
      [
        { sprintId: 's1', completedPoints: 10 },
        { sprintId: 's2', completedPoints: 20 },
        { sprintId: 's3', completedPoints: 99 },
      ],
      3,
    );
    expect(v.average).toBe(15);
    expect(v.usedSprints).toBe(2);
  });

  /**
   * บอกว่าเฉลี่ยจากกี่รอบ ไม่ใช่แค่ตัวเลขเดียว
   *
   * ค่าเฉลี่ยจากสปรินต์เดียวคือ "แต้มของสปรินต์นั้น" ไม่ใช่ความเร็วของทีม ·
   * ตัวเลขที่ไม่บอกว่ามาจากกี่รอบ ถูกเอาไปวางแผนราวกับเชื่อถือได้เท่ากัน
   */
  it('บอกจำนวนรอบที่ใช้คำนวณเสมอ', () => {
    const v = velocityOf([done('s1', 10)], [{ sprintId: 's1', completedPoints: 10 }], 3);
    expect(v.usedSprints).toBe(1);
    expect(v.average).toBe(10);
  });

  it('ไม่มีสปรินต์ที่ปิดแล้วเลย คืน null ไม่ใช่ศูนย์', () => {
    const v = velocityOf([sprint()], [], 3);
    expect(v.average).toBeNull();
    expect(v.usedSprints).toBe(0);
  });

  it('ใช้เฉพาะรอบล่าสุดตามจำนวนที่ขอ', () => {
    const v = velocityOf(
      [done('s1', 1), done('s2', 2), done('s3', 3), done('s4', 4)],
      [
        { sprintId: 's1', completedPoints: 10 },
        { sprintId: 's2', completedPoints: 20 },
        { sprintId: 's3', completedPoints: 30 },
        { sprintId: 's4', completedPoints: 40 },
      ],
      2,
    );
    expect(v.usedSprints).toBe(2);
    expect(v.average).toBe(35);
  });

  it('ขอศูนย์รอบหรือติดลบ ถือว่าขอหนึ่งรอบ ไม่ใช่หารด้วยศูนย์', () => {
    const rows = [{ sprintId: 's1', completedPoints: 10 }];
    expect(velocityOf([done('s1', 10)], rows, 0).usedSprints).toBe(1);
    expect(velocityOf([done('s1', 10)], rows, -3).usedSprints).toBe(1);
  });

  it('สปรินต์ที่ปิดแล้วแต่ไม่มีตัวเลขบันทึกไว้ ไม่ถูกนับ', () => {
    const v = velocityOf([done('s1', 10), done('s2', 20)], [{ sprintId: 's1', completedPoints: 10 }], 3);
    expect(v.usedSprints).toBe(1);
  });
});
