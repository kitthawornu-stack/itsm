/**
 * ข้อกำหนดของการแบ่งเลนบนกระดาน — **เขียนก่อนโค้ด**
 *
 * ## ทำไมต้องมีไฟล์นี้
 *
 * เลนคือการจัดกลุ่มการ์ดตามผู้รับผิดชอบหรือระดับความสำคัญ · ทีมเล็กใช้ดูว่า
 * ใครถืออะไรอยู่บ้าง โดยไม่ต้องกรองทีละคน
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 *   1. **การ์ดที่ไม่เข้าเลนไหนเลย หายไปจากกระดาน** — งานที่ยังไม่มีผู้รับผิดชอบ
 *      คือกองที่สำคัญที่สุดในศูนย์บริการ · ถ้ามันหายไป กระดานจะดูโล่ง
 *      และไม่มีใครรู้ว่ามีงานรออยู่
 *   2. **จำนวนการ์ดรวมทุกเลน ไม่เท่ากับก่อนแบ่ง** — เป็นอาการของข้อ 1
 *      ที่วัดได้ตรง ๆ
 *   3. **เลนว่างเปล่าถูกซ่อน** — คอลัมน์ที่ไม่มีการ์ดในเลนนั้นต้องยังอยู่
 *      มิฉะนั้นเลนแต่ละเลนจะมีคอลัมน์ไม่เท่ากัน แล้วอ่านเทียบกันไม่ได้
 */
import { describe, expect, it } from 'vitest';

import { NO_LANE_LABEL, splitLanes, type LaneMode } from './swimlanes';

const card = (itemKey: string, assignee: string | null, rank: number | null) => ({
  itemKey,
  summary: `งาน ${itemKey}`,
  assignee,
  priority: rank === null ? null : { rank, name: `P${String(rank)}` },
  rank: itemKey,
});

const columns = [
  {
    statusId: '1',
    name: 'ใหม่',
    category: 'TODO',
    cards: [card('A', 'สมชาย', 1), card('B', null, 3), card('C', 'มาลี', 1)],
  },
  {
    statusId: '2',
    name: 'กำลังทำ',
    category: 'IN_PROGRESS',
    cards: [card('D', 'สมชาย', null)],
  },
];

const total = (lanes: ReturnType<typeof splitLanes>): number =>
  lanes.reduce((n, l) => n + l.columns.reduce((m, c) => m + c.cards.length, 0), 0);

describe('เลนบนกระดาน', () => {
  it('ไม่แบ่งเลน — ได้เลนเดียวที่มีทุกอย่าง', () => {
    const lanes = splitLanes(columns, 'none');
    expect(lanes).toHaveLength(1);
    expect(total(lanes)).toBe(4);
  });

  it('แบ่งตามผู้รับผิดชอบ — หนึ่งเลนต่อหนึ่งคน', () => {
    const lanes = splitLanes(columns, 'assignee');
    expect(lanes.map((l) => l.label)).toContain('สมชาย');
    expect(lanes.map((l) => l.label)).toContain('มาลี');
  });

  /**
   * **หัวใจของไฟล์นี้**
   *
   * งานที่ยังไม่มีผู้รับผิดชอบคือกองที่สำคัญที่สุดในศูนย์บริการ ·
   * ถ้ามันหายไป กระดานจะดูโล่งและไม่มีใครรู้ว่ามีงานรออยู่
   */
  it('**การ์ดที่ไม่มีผู้รับผิดชอบ ได้เลนของตัวเอง ไม่ใช่หายไป**', () => {
    const lanes = splitLanes(columns, 'assignee');
    const none = lanes.find((l) => l.label === NO_LANE_LABEL.assignee);
    expect(none, 'ไม่มีเลนสำหรับงานที่ยังไม่มีผู้รับผิดชอบ').toBeDefined();
    expect(none?.columns.flatMap((c) => c.cards).map((c) => c.itemKey)).toEqual(['B']);
  });

  it('**จำนวนการ์ดรวมทุกเลน เท่ากับก่อนแบ่งเสมอ**', () => {
    for (const mode of ['none', 'assignee', 'priority'] as LaneMode[]) {
      expect(total(splitLanes(columns, mode)), `โหมด ${mode} ทำการ์ดหาย`).toBe(4);
    }
  });

  it('**การ์ดที่ไม่มีระดับความสำคัญ ได้เลนของตัวเอง**', () => {
    const lanes = splitLanes(columns, 'priority');
    const none = lanes.find((l) => l.label === NO_LANE_LABEL.priority);
    expect(none?.columns.flatMap((c) => c.cards).map((c) => c.itemKey)).toEqual(['D']);
  });

  /**
   * ทุกเลนต้องมีคอลัมน์ครบเท่ากัน แม้คอลัมน์นั้นจะว่างในเลนนั้น ·
   * ถ้าซ่อนคอลัมน์ว่าง เลนแต่ละเลนจะกว้างไม่เท่ากัน แล้วอ่านเทียบกันไม่ได้
   */
  it('**ทุกเลนมีคอลัมน์ครบเท่ากัน แม้จะว่าง**', () => {
    for (const lane of splitLanes(columns, 'assignee')) {
      expect(lane.columns.map((c) => c.name)).toEqual(['ใหม่', 'กำลังทำ']);
    }
  });

  /**
   * **เลน "ยังไม่มีผู้รับผิดชอบ" อยู่บนสุด**
   *
   * เป็นกองที่ต้องมีคนหยิบ · การเรียงตามตัวอักษรจะทำให้มันไปอยู่กลาง ๆ
   * แล้วคนเลื่อนผ่าน
   */
  it('**เลนที่ยังไม่มีเจ้าของ อยู่บนสุด**', () => {
    const lanes = splitLanes(columns, 'assignee');
    expect(lanes[0]?.label).toBe(NO_LANE_LABEL.assignee);
  });

  it('เลนของคนเรียงตามชื่อ เพื่อให้หาซ้ำได้', () => {
    const lanes = splitLanes(columns, 'assignee').slice(1);
    expect(lanes.map((l) => l.label)).toEqual(['มาลี', 'สมชาย']);
  });

  /**
   * **ความสำคัญเรียงจากด่วนที่สุด ไม่ใช่ตามตัวอักษรของชื่อ**
   *
   * ชื่อที่ใช้ทดสอบต้องเป็นชื่อที่ **เรียงตามตัวอักษรแล้วได้คนละลำดับกับเรียง
   * ตามอันดับ** · รอบแรกใช้ `P1 P2 P3` ซึ่งสองวิธีให้ผลเหมือนกันเป๊ะ —
   * ตอนลบการเรียงตามอันดับออกเพื่อพิสูจน์ว่าเทสต์แดงได้ **มันยังเขียว**
   * เพราะข้อมูลตัวอย่างแยกสองอย่างนี้ไม่ออก
   *
   * ชื่อจริงในระบบเป็นภาษาไทย ซึ่งเรียงคนละแบบกับอันดับอยู่แล้ว
   */
  it('**เลนความสำคัญเรียงจากด่วนที่สุด ไม่ใช่ตามตัวอักษร**', () => {
    const named = (key: string, rank: number, name: string) => ({
      itemKey: key,
      summary: `งาน ${key}`,
      assignee: null,
      priority: { rank, name },
      rank: key,
    });
    const many = [
      {
        statusId: '1',
        name: 'ใหม่',
        category: 'TODO',
        cards: [named('A', 5, 'ต่ำ'), named('B', 1, 'สูงมาก'), named('C', 3, 'ปานกลาง')],
      },
    ];
    const lanes = splitLanes(many, 'priority');
    expect(lanes.map((l) => l.label)).toEqual(['สูงมาก', 'ปานกลาง', 'ต่ำ']);
    // เรียงตามตัวอักษรไทยจะได้ ต่ำ · ปานกลาง · สูงมาก ซึ่งต่างกันจริง
    expect([...lanes.map((l) => l.label)].sort((x, y) => x.localeCompare(y, 'th'))).not.toEqual(
      lanes.map((l) => l.label),
    );
  });

  it('กระดานเปล่า ได้เลนเปล่า ไม่ใช่พัง', () => {
    expect(splitLanes([], 'assignee')).toEqual([]);
  });

  it('ไม่แก้ข้อมูลที่รับเข้ามา', () => {
    const snapshot = JSON.stringify(columns);
    splitLanes(columns, 'assignee');
    expect(JSON.stringify(columns)).toBe(snapshot);
  });
});
