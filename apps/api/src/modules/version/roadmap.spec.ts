/**
 * ข้อกำหนดของแผนงานบนเส้นเวลา (Roadmap) — **เขียนก่อนโค้ด**
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 *   1. **วางแท่งให้สิ่งที่ยังไม่มีกำหนด** — Gantt ที่เดาตำแหน่งให้ อ่านเหมือน
 *      แผนที่ตกลงกันแล้ว · แย่กว่าไม่มีแผนภาพเลย เพราะคนจะเอาไปวางแผนต่อ ·
 *      สิ่งที่ยังไม่มีวันที่ ต้องอยู่ในรายการแยกพร้อมเหตุผล ไม่ใช่หายไปเงียบ ๆ
 *      และไม่ใช่ถูกวางมั่ว ๆ
 *   2. **แท่งที่วันจบมาก่อนวันเริ่ม** — ข้อมูลผิดที่วาดออกมาได้ จะกลายเป็น
 *      แท่งความยาวติดลบหรือแท่งที่ยาวข้ามจอ แล้วแต่ว่าใครวาด
 *   3. **การขวางข้ามรุ่นที่ไม่มีใครเห็น** — งานในรุ่น 1.0 ขวางงานในรุ่น 0.9
 *      ที่ปล่อยก่อน แปลว่า 0.9 ปล่อยไม่ได้จริง · ไม่มีใครไล่เทียบเองทัน
 *      และตอนที่รู้คือวันที่ปล่อยไม่ได้
 *   4. **สิ่งที่ตรวจไม่ได้ ถูกนับว่าไม่มีปัญหา** — คู่ที่ฝ่ายใดฝ่ายหนึ่งยังไม่มี
 *      กำหนด ตอบไม่ได้ว่าขัดกันไหม · ต้องรายงานว่า "ตรวจไม่ได้" ไม่ใช่เงียบ
 */
import { describe, expect, it } from 'vitest';
import { toUtcDate } from '@itsm/types';

import {
  crossVersionBlocks,
  placeOnTimeline,
  type BlockLink,
  type TimelineEntry,
} from './roadmap';

const WINDOW = {
  from: toUtcDate('2029-01-01T00:00:00.000Z'),
  to: toUtcDate('2029-12-31T00:00:00.000Z'),
};

function entry(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    key: 'v1',
    label: '1.0',
    kind: 'version',
    start: toUtcDate('2029-04-01T00:00:00.000Z'),
    end: toUtcDate('2029-06-30T00:00:00.000Z'),
    done: false,
    ...over,
  };
}

// ============================================================

describe('แผนงาน · A · การวางบนเส้นเวลา', () => {
  it('มีทั้งวันเริ่มและวันจบ วางเป็นแท่งได้', () => {
    const r = placeOnTimeline([entry()], WINDOW);
    expect(r.bars).toHaveLength(1);
    expect(r.unplaced).toEqual([]);
    expect(r.bars[0]?.startRatio).toBeGreaterThan(0);
    expect(r.bars[0]?.endRatio).toBeLessThan(1);
    expect(r.bars[0]?.milestone).toBe(false);
  });

  /**
   * **หัวใจของหมวดนี้**
   *
   * Gantt ที่เดาตำแหน่งให้สิ่งที่ยังไม่มีกำหนด อ่านเหมือนแผนที่ตกลงกันแล้ว
   */
  it('**ไม่มีวันที่เลย ไม่ถูกวาง และบอกเหตุผล**', () => {
    const r = placeOnTimeline([entry({ start: null, end: null })], WINDOW);
    expect(r.bars).toEqual([]);
    expect(r.unplaced).toHaveLength(1);
    expect(r.unplaced[0]?.reason).toBe('no-dates');
  });

  /** รุ่นที่ตั้งแต่วันปล่อย = หมุด ไม่ใช่แท่ง — ช่วงเวลาที่ไม่มีอยู่จริง */
  it('**มีแต่วันจบ วางเป็นหมุด ไม่ใช่แท่งที่ลากมาจากขอบจอ**', () => {
    const r = placeOnTimeline([entry({ start: null })], WINDOW);
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0]?.milestone).toBe(true);
    expect(r.bars[0]?.startRatio).toBe(r.bars[0]?.endRatio);
  });

  it('**วันจบมาก่อนวันเริ่ม ไม่ถูกวาง** — ข้อมูลผิดต้องเห็น ไม่ใช่วาดแท่งติดลบ', () => {
    const r = placeOnTimeline(
      [
        entry({
          start: toUtcDate('2029-06-30T00:00:00.000Z'),
          end: toUtcDate('2029-04-01T00:00:00.000Z'),
        }),
      ],
      WINDOW,
    );
    expect(r.bars).toEqual([]);
    expect(r.unplaced[0]?.reason).toBe('backwards');
  });

  it('อยู่นอกกรอบเวลาที่ดู ไม่ถูกวาง และบอกว่าทำไม', () => {
    const r = placeOnTimeline(
      [
        entry({
          start: toUtcDate('2027-01-01T00:00:00.000Z'),
          end: toUtcDate('2027-02-01T00:00:00.000Z'),
        }),
      ],
      WINDOW,
    );
    expect(r.bars).toEqual([]);
    expect(r.unplaced[0]?.reason).toBe('outside-window');
  });

  /** คร่อมกรอบ = ยังเกี่ยวข้อง · ตัดทิ้งจะทำให้แผนดูว่างทั้งที่มีงานอยู่ */
  it('**เริ่มก่อนกรอบและจบหลังกรอบ วางเต็มกรอบ ไม่ใช่ตัดทิ้ง**', () => {
    const r = placeOnTimeline(
      [
        entry({
          start: toUtcDate('2028-01-01T00:00:00.000Z'),
          end: toUtcDate('2030-01-01T00:00:00.000Z'),
        }),
      ],
      WINDOW,
    );
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0]?.startRatio).toBe(0);
    expect(r.bars[0]?.endRatio).toBe(1);
  });

  it('สัดส่วนอยู่ในช่วง 0 ถึง 1 เสมอ ไม่ว่าอินพุตหน้าตาแบบไหน', () => {
    const r = placeOnTimeline(
      [
        entry({ key: 'a', start: toUtcDate('2028-06-01T00:00:00.000Z') }),
        entry({ key: 'b', end: toUtcDate('2030-06-01T00:00:00.000Z') }),
        entry({ key: 'c', start: null }),
      ],
      WINDOW,
    );
    for (const b of r.bars) {
      expect(b.startRatio).toBeGreaterThanOrEqual(0);
      expect(b.endRatio).toBeLessThanOrEqual(1);
      expect(b.endRatio).toBeGreaterThanOrEqual(b.startRatio);
    }
  });
});

// ============================================================

describe('แผนงาน · B · การขวางข้ามรุ่น', () => {
  const link = (over: Partial<BlockLink> = {}): BlockLink => ({
    blockerKey: 'PLAT-1',
    blockerVersion: { key: 'v2', label: '1.0', releaseDate: toUtcDate('2029-06-30T00:00:00.000Z') },
    blockedKey: 'PLAT-2',
    blockedVersion: { key: 'v1', label: '0.9', releaseDate: toUtcDate('2029-03-31T00:00:00.000Z') },
    ...over,
  });

  /**
   * **หัวใจของทั้งไฟล์**
   *
   * งานในรุ่น 1.0 ขวางงานในรุ่น 0.9 ที่ปล่อยก่อน แปลว่า 0.9 ปล่อยไม่ได้จริง ·
   * ไม่มีใครไล่เทียบเองทัน และตอนที่รู้คือวันที่ปล่อยไม่ได้
   */
  it('**ตัวขวางอยู่ในรุ่นที่ปล่อยทีหลัง = ขัดแย้ง**', () => {
    const r = crossVersionBlocks([link()]);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]?.blockedKey).toBe('PLAT-2');
    expect(r.conflicts[0]?.blockerVersionLabel).toBe('1.0');
    expect(r.conflicts[0]?.blockedVersionLabel).toBe('0.9');
    expect(r.uncheckable).toEqual([]);
  });

  it('ตัวขวางอยู่ในรุ่นที่ปล่อยก่อน = ไม่ขัดแย้ง', () => {
    const r = crossVersionBlocks([
      link({
        blockerVersion: { key: 'v1', label: '0.9', releaseDate: toUtcDate('2029-03-31T00:00:00.000Z') },
        blockedVersion: { key: 'v2', label: '1.0', releaseDate: toUtcDate('2029-06-30T00:00:00.000Z') },
      }),
    ]);
    expect(r.conflicts).toEqual([]);
  });

  /** ปล่อยวันเดียวกัน = ออกไปพร้อมกัน ไม่ใช่ขัดแย้ง */
  it('**รุ่นเดียวกันหรือปล่อยวันเดียวกัน ไม่นับว่าขัดแย้ง**', () => {
    const sameDay = toUtcDate('2029-06-30T00:00:00.000Z');
    const r = crossVersionBlocks([
      link({
        blockerVersion: { key: 'v2', label: '1.0', releaseDate: sameDay },
        blockedVersion: { key: 'v3', label: '1.0.1', releaseDate: sameDay },
      }),
    ]);
    expect(r.conflicts).toEqual([]);
  });

  /**
   * **สิ่งที่ตรวจไม่ได้ ต้องไม่ถูกนับว่าไม่มีปัญหา**
   *
   * คู่ที่ฝ่ายใดฝ่ายหนึ่งยังไม่มีวันปล่อย ตอบไม่ได้ว่าขัดกันไหม ·
   * การเงียบทำให้คนอ่านเชื่อว่าตรวจครบแล้ว
   */
  it('**ฝ่ายใดไม่มีวันปล่อย ต้องรายงานว่าตรวจไม่ได้ ไม่ใช่เงียบ**', () => {
    const r = crossVersionBlocks([
      link({ blockerVersion: { key: 'v2', label: '1.0', releaseDate: null } }),
    ]);
    expect(r.conflicts).toEqual([]);
    expect(r.uncheckable).toHaveLength(1);
    expect(r.uncheckable[0]?.blockedKey).toBe('PLAT-2');
  });

  it('งานที่ไม่ได้อยู่รุ่นไหนเลย ก็ตรวจไม่ได้เหมือนกัน', () => {
    const r = crossVersionBlocks([link({ blockedVersion: null })]);
    expect(r.conflicts).toEqual([]);
    expect(r.uncheckable).toHaveLength(1);
  });
});

// ============================================================

describe('แผนงาน · C · ไม่แก้ข้อมูลนำเข้า', () => {
  it('ไม่แก้รายการที่รับเข้ามา', () => {
    const items = [entry({ key: 'b' }), entry({ key: 'a' })];
    const snapshot = JSON.stringify(items);
    placeOnTimeline(items, WINDOW);
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});
