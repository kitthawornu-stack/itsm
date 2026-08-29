/**
 * หน้าต่างเวลาดำเนินการเปลี่ยนแปลง — เทสต์เป็นข้อกำหนด เขียนก่อนโค้ด
 *
 * ITIL เรียกร้องให้การเปลี่ยนแปลงมี **ช่วงเวลาที่ตกลงกันไว้** และให้เห็นว่า
 * ช่วงนั้นชนกับของคนอื่นหรือช่วงห้ามเปลี่ยนแปลงหรือเปล่า · ตรรกะทั้งหมด
 * เป็นฟังก์ชันบริสุทธิ์ เพราะเคสที่สำคัญที่สุดคือเคสวันข้ามปีและช่วงที่คาบเกี่ยว
 * กันพอดีเป๊ะ ซึ่งทดสอบได้ก็ต่อเมื่อไม่ต้องรอเวลาจริง
 *
 * หกข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **ช่วงเวลาเป็น `[start, end)`** — งานที่จบเวลา 02:00 พอดี ไม่ชนกับงาน
 *      ที่เริ่ม 02:00 · ถ้านับปลายปิดด้วย ทุกคู่ที่ต่อกันหลังชนกันหมด แล้วคน
 *      จะเรียนรู้ที่จะเมินคำเตือน ซึ่งแย่กว่าไม่มีคำเตือน
 *   2. **การชนกันเป็นคำเตือน ไม่ใช่การห้าม** — ห้ามเมื่อไร คนจะไปนัดกันนอกระบบ
 *      แล้วระบบจะไม่รู้อะไรเลย
 *   3. **ช่วงห้ามเปลี่ยนแปลง (freeze) เป็นการห้ามจริง** แต่ข้ามได้ถ้าบันทึกเหตุผล
 *      — การห้ามที่ข้ามไม่ได้เลย จะถูกข้ามด้วยการไม่กรอกลงระบบ
 *   4. **ตั้งเวลาย้อนหลังได้ แต่ต้องบอก** — งานฉุกเฉินถูกทำไปก่อนแล้วค่อยบันทึก
 *      เป็นเรื่องปกติ · การปฏิเสธทำให้ไม่มีใครบันทึก
 *   5. **ห้ามอ่านนาฬิกาเอง** — "ตอนนี้" ส่งเข้ามา (กติกาเดียวกับ SLA Engine)
 *   6. **ช่วงที่กลับหัวหรือยาวเกินจริงถูกปฏิเสธ** — `end <= start` ไม่ใช่ช่วงเวลา
 *      และหน้าต่างสามเดือนคือการพิมพ์ผิด ไม่ใช่แผน
 */
import { describe, expect, it } from 'vitest';
import { toUtcDate } from '@itsm/types';

import {
  BackwardWindowError,
  MAX_WINDOW_DAYS,
  WindowTooLongError,
  assessWindow,
  conflictsWith,
  freezesHit,
  overlaps,
  type FreezeWindow,
  type ScheduledChange,
  type TimeWindow,
} from './change-window';

const at = (iso: string): ReturnType<typeof toUtcDate> => toUtcDate(iso);
const win = (a: string, b: string): TimeWindow => ({ start: at(a), end: at(b) });

/** คืนวันเสาร์ 02:00–04:00 ตามเวลาไทย = 2569-01-10T19:00Z ถึง 21:00Z */
const NIGHT = win('2026-01-10T19:00:00.000Z', '2026-01-10T21:00:00.000Z');

function change(key: string, a: string, b: string): ScheduledChange {
  return { itemKey: key, summary: `เปลี่ยนแปลง ${key}`, window: win(a, b) };
}

describe('A · ช่วงเวลาคาบเกี่ยวกัน', () => {
  it('**ปลายชนต้นพอดี ไม่ถือว่าชน** — ช่วงเป็น [start, end)', () => {
    /*
      งานที่จบ 21:00 กับงานที่เริ่ม 21:00 ทำต่อกันได้จริง · ถ้ารายงานว่าชน
      ทุกคู่ที่ต่อกันจะติดธง แล้วคำเตือนจะกลายเป็นเสียงรบกวนที่ทุกคนเมิน
    */
    const a = win('2026-01-10T19:00:00.000Z', '2026-01-10T21:00:00.000Z');
    const b = win('2026-01-10T21:00:00.000Z', '2026-01-10T23:00:00.000Z');
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(b, a)).toBe(false);
  });

  it('คาบเกี่ยวแม้แค่นาทีเดียว ถือว่าชน', () => {
    const a = win('2026-01-10T19:00:00.000Z', '2026-01-10T21:00:00.000Z');
    const b = win('2026-01-10T20:59:00.000Z', '2026-01-10T23:00:00.000Z');
    expect(overlaps(a, b)).toBe(true);
    expect(overlaps(b, a)).toBe(true);
  });

  it('ช่วงที่อยู่ข้างในทั้งอัน ถือว่าชน', () => {
    const outer = win('2026-01-10T18:00:00.000Z', '2026-01-11T02:00:00.000Z');
    const inner = win('2026-01-10T19:00:00.000Z', '2026-01-10T21:00:00.000Z');
    expect(overlaps(outer, inner)).toBe(true);
    expect(overlaps(inner, outer)).toBe(true);
  });

  it('คนละวันกันไม่ชน', () => {
    expect(overlaps(NIGHT, win('2026-01-17T19:00:00.000Z', '2026-01-17T21:00:00.000Z'))).toBe(
      false,
    );
  });
});

describe('B · ช่วงที่รับไม่ได้', () => {
  it('**`end` เท่ากับ `start` ไม่ใช่ช่วงเวลา**', () => {
    // ช่วงยาวศูนย์ไม่ชนกับอะไรเลยตามนิยาม [start, end) — จึงเงียบสนิทถ้าปล่อยผ่าน
    expect(() =>
      assessWindow({
        window: win('2026-01-10T19:00:00.000Z', '2026-01-10T19:00:00.000Z'),
        others: [],
        freezes: [],
        now: at('2026-01-01T00:00:00.000Z'),
      }),
    ).toThrow(BackwardWindowError);
  });

  it('`end` ก่อน `start` ถูกปฏิเสธ', () => {
    expect(() =>
      assessWindow({
        window: win('2026-01-10T21:00:00.000Z', '2026-01-10T19:00:00.000Z'),
        others: [],
        freezes: [],
        now: at('2026-01-01T00:00:00.000Z'),
      }),
    ).toThrow(BackwardWindowError);
  });

  it('**หน้าต่างที่ยาวเกินเพดานคือการพิมพ์ผิด ไม่ใช่แผน**', () => {
    const start = '2026-01-10T19:00:00.000Z';
    const tooLong = new Date(Date.parse(start) + (MAX_WINDOW_DAYS + 1) * 86_400_000).toISOString();
    expect(() =>
      assessWindow({
        window: win(start, tooLong),
        others: [],
        freezes: [],
        now: at('2026-01-01T00:00:00.000Z'),
      }),
    ).toThrow(WindowTooLongError);
  });

  it('ยาวเท่าเพดานพอดี ยังผ่าน', () => {
    const start = '2026-01-10T19:00:00.000Z';
    const exact = new Date(Date.parse(start) + MAX_WINDOW_DAYS * 86_400_000).toISOString();
    expect(() =>
      assessWindow({
        window: win(start, exact),
        others: [],
        freezes: [],
        now: at('2026-01-01T00:00:00.000Z'),
      }),
    ).not.toThrow();
  });
});

describe('C · การชนกับงานอื่น', () => {
  const others = [
    change('CHG-1', '2026-01-10T20:00:00.000Z', '2026-01-10T22:00:00.000Z'),
    change('CHG-2', '2026-01-10T21:00:00.000Z', '2026-01-10T23:00:00.000Z'),
    change('CHG-3', '2026-01-17T19:00:00.000Z', '2026-01-17T21:00:00.000Z'),
  ];

  it('คืนเฉพาะงานที่ชนจริง และเรียงตามเวลาเริ่ม', () => {
    const hit = conflictsWith(win('2026-01-10T18:00:00.000Z', '2026-01-10T21:30:00.000Z'), others);
    expect(hit.map((c) => c.itemKey)).toEqual(['CHG-1', 'CHG-2']);
  });

  it('**เรียงตามเวลาเริ่มจริง ไม่ใช่ตามลำดับที่ส่งเข้ามา**', () => {
    /*
      เคสข้างบนส่งรายการที่เรียงมาถูกอยู่แล้ว ลำดับจึงไม่เปลี่ยนคำตอบ —
      ลบการเรียงทิ้งก็ยังเขียว (พิสูจน์แล้วตอนลบทีละบรรทัด)

      ของจริงมาจากฐานข้อมูลซึ่งไม่รับประกันลำดับ · หน้าจอที่แสดงงานที่ชนกัน
      แบบสลับเวลา ทำให้คนอ่านไม่ออกว่าอันไหนมาก่อน แล้วเลือกเลื่อนผิดใบ
    */
    const shuffled = [
      change('CHG-ดึก', '2026-01-10T22:00:00.000Z', '2026-01-11T00:00:00.000Z'),
      change('CHG-หัวค่ำ', '2026-01-10T18:00:00.000Z', '2026-01-10T20:00:00.000Z'),
      change('CHG-กลาง', '2026-01-10T20:00:00.000Z', '2026-01-10T22:00:00.000Z'),
    ];
    const hit = conflictsWith(win('2026-01-10T17:00:00.000Z', '2026-01-11T01:00:00.000Z'), shuffled);
    expect(hit.map((c) => c.itemKey)).toEqual(['CHG-หัวค่ำ', 'CHG-กลาง', 'CHG-ดึก']);
  });

  it('ไม่ชนใครเลย = รายการว่าง ไม่ใช่ null', () => {
    // ผู้เรียกที่ต้องเช็ค null ก่อนทุกครั้ง จะลืมเช็คสักที่หนึ่งเสมอ
    expect(conflictsWith(win('2026-02-01T00:00:00.000Z', '2026-02-01T02:00:00.000Z'), others))
      .toEqual([]);
  });

  it('**การชนไม่ทำให้ทั้งหมดล้ม** — เป็นข้อมูลที่คืนกลับ ไม่ใช่ error', () => {
    /*
      ห้ามตั้งเวลาที่ชนกัน = คนไปนัดกันในไลน์แล้วระบบไม่รู้อะไรเลย ·
      หน้าที่ของระบบคือทำให้เห็น ไม่ใช่ทำให้ทำไม่ได้
    */
    const r = assessWindow({
      window: win('2026-01-10T20:00:00.000Z', '2026-01-10T22:00:00.000Z'),
      others,
      freezes: [],
      now: at('2026-01-01T00:00:00.000Z'),
    });
    expect(r.conflicts.map((c) => c.itemKey)).toEqual(['CHG-1', 'CHG-2']);
    expect(r.blocked).toBe(false);
  });
});

describe('D · ช่วงห้ามเปลี่ยนแปลง', () => {
  const freezes: FreezeWindow[] = [
    {
      name: 'ปิดงบสิ้นปี',
      reason: 'ระบบบัญชีปิดงบ ห้ามแตะทุกระบบที่เกี่ยวข้อง',
      window: win('2025-12-25T17:00:00.000Z', '2026-01-05T17:00:00.000Z'),
    },
    {
      name: 'สงกรานต์',
      reason: 'ไม่มีคนอยู่ประจำการ',
      window: win('2026-04-12T17:00:00.000Z', '2026-04-16T17:00:00.000Z'),
    },
  ];

  it('**อยู่ในช่วงห้าม = ถูกกั้น** ต่างจากการชนกับงานอื่น', () => {
    const r = assessWindow({
      window: win('2026-01-02T19:00:00.000Z', '2026-01-02T21:00:00.000Z'),
      others: [],
      freezes,
      now: at('2026-01-01T00:00:00.000Z'),
    });
    expect(r.freezes.map((f) => f.name)).toEqual(['ปิดงบสิ้นปี']);
    expect(r.blocked).toBe(true);
  });

  it('**ข้ามช่วงห้ามได้เมื่อบันทึกเหตุผล** — การห้ามที่ข้ามไม่ได้เลย จะถูกข้ามนอกระบบ', () => {
    const r = assessWindow({
      window: win('2026-01-02T19:00:00.000Z', '2026-01-02T21:00:00.000Z'),
      others: [],
      freezes,
      now: at('2026-01-01T00:00:00.000Z'),
      overrideReason: 'ระบบล่ม ต้องกู้คืนทันที ผู้อำนวยการอนุมัติทางโทรศัพท์',
    });
    expect(r.freezes.map((f) => f.name)).toEqual(['ปิดงบสิ้นปี']);
    // ยังรายงานว่าอยู่ในช่วงห้าม — การข้ามไม่ได้แปลว่าไม่เคยชน
    expect(r.blocked).toBe(false);
    expect(r.overridden).toBe(true);
  });

  it('**เหตุผลที่เป็นช่องว่างล้วน ไม่นับว่าให้เหตุผล**', () => {
    const r = assessWindow({
      window: win('2026-01-02T19:00:00.000Z', '2026-01-02T21:00:00.000Z'),
      others: [],
      freezes,
      now: at('2026-01-01T00:00:00.000Z'),
      overrideReason: '   ',
    });
    expect(r.blocked).toBe(true);
    expect(r.overridden).toBe(false);
  });

  it('ไม่ได้อยู่ในช่วงห้าม แต่มีเหตุผลมาด้วย — ไม่ถือว่าข้ามอะไร', () => {
    // `overridden` ต้องหมายถึง "ข้ามการห้ามจริง" ไม่ใช่ "มีข้อความส่งมา"
    const r = assessWindow({
      window: win('2026-02-01T19:00:00.000Z', '2026-02-01T21:00:00.000Z'),
      others: [],
      freezes,
      now: at('2026-01-01T00:00:00.000Z'),
      overrideReason: 'เผื่อไว้',
    });
    expect(r.freezes).toEqual([]);
    expect(r.overridden).toBe(false);
    expect(r.blocked).toBe(false);
  });

  it('ปลายช่วงห้ามชนต้นหน้าต่างพอดี ไม่ถือว่าอยู่ในช่วงห้าม', () => {
    expect(
      freezesHit(win('2026-01-05T17:00:00.000Z', '2026-01-05T19:00:00.000Z'), freezes),
    ).toEqual([]);
  });
});

describe('E · เวลาที่ผ่านไปแล้ว', () => {
  it('**ตั้งย้อนหลังได้ แต่ต้องบอกว่าย้อนหลัง**', () => {
    /*
      งานฉุกเฉินถูกทำไปก่อนแล้วค่อยบันทึกเป็นเรื่องปกติของ ITIL
      (emergency change) · การปฏิเสธทำให้ไม่มีใครบันทึกเลย ซึ่งแย่กว่า
    */
    const r = assessWindow({
      window: win('2025-12-01T19:00:00.000Z', '2025-12-01T21:00:00.000Z'),
      others: [],
      freezes: [],
      now: at('2026-01-01T00:00:00.000Z'),
    });
    expect(r.startsInPast).toBe(true);
    expect(r.blocked).toBe(false);
  });

  it('เริ่มในอนาคต ไม่ติดธง', () => {
    const r = assessWindow({
      window: NIGHT,
      others: [],
      freezes: [],
      now: at('2026-01-01T00:00:00.000Z'),
    });
    expect(r.startsInPast).toBe(false);
    expect(r.durationMs).toBe(2 * 60 * 60 * 1000);
  });

  it('**เริ่มพอดีวินาทีนี้ ไม่ใช่อดีต**', () => {
    // เขตแดนที่ `<` กับ `<=` ให้คำตอบต่างกัน — และเป็นเคสที่เกิดจริงเมื่อ
    // ผู้ใช้กดบันทึกโดยเลือก "เริ่มเดี๋ยวนี้"
    const r = assessWindow({
      window: win('2026-01-01T00:00:00.000Z', '2026-01-01T02:00:00.000Z'),
      others: [],
      freezes: [],
      now: at('2026-01-01T00:00:00.000Z'),
    });
    expect(r.startsInPast).toBe(false);
  });
});
