import { describe, expect, it } from 'vitest';

import { planHierarchy, type HierarchyItem } from './hierarchy-plan';

/** รูปร่างใกล้เคียงโปรเจกต์ PLAT จริง: Epic 616 · เรื่องหลัก 1,738 · งานย่อย 647 */
function sample(): HierarchyItem[] {
  const out: HierarchyItem[] = [];
  let n = 0;
  const add = (count: number, level: number): void => {
    for (let i = 0; i < count; i++) out.push({ id: String(++n), level });
  };
  add(616, 1);
  add(1_738, 0);
  add(647, -1);
  return out;
}

const levelOf = (items: readonly HierarchyItem[]): Map<string, number> =>
  new Map(items.map((i) => [i.id, i.level]));

describe('planHierarchy', () => {
  const items = sample();
  const lv = levelOf(items);
  const plan = planHierarchy(items);

  it('probe · ผูกได้จริง — ไม่ใช่ผ่านเพราะแผนว่างเปล่า', () => {
    // เซ็ตว่างผ่านทุกเงื่อนไขข้างล่างนี้ได้หมด
    expect(plan.links.size).toBeGreaterThan(1_000);
    expect(plan.epicsWithChildren).toBeGreaterThan(5);
  });

  it('**แม่สูงกว่าลูกหนึ่งชั้นพอดีเสมอ**', () => {
    for (const [child, parent] of plan.links)
      expect(lv.get(parent), `${child} → ${parent}`).toBe((lv.get(child) as number) + 1);
  });

  it('Epic ไม่มีแม่ · ไม่มีใครเป็นแม่ตัวเอง', () => {
    for (const [child, parent] of plan.links) {
      expect(child).not.toBe(parent);
      expect(lv.get(child)).not.toBe(1);
    }
  });

  it('งานย่อยได้แม่ทุกใบ — งานย่อยที่ไม่มีแม่ไม่ใช่ข้อมูลที่มีความหมาย', () => {
    for (const i of items) if (i.level === -1) expect(plan.links.has(i.id), i.id).toBe(true);
  });

  /**
   * ถ้าเรื่องหลัก **ทุกใบ** อยู่ใต้ Epic เลน "ไม่ได้อยู่ใต้ Epic ใด" จะว่าง
   * และไม่มีใครรู้ว่ามันทำงานหรือไม่ · กองที่ยังไม่ถูกจัดเข้า Epic
   * เป็นของที่มีจริงในทุกโปรเจกต์
   */
  it('**เรื่องหลักส่วนหนึ่งตั้งใจไม่ให้อยู่ใต้ Epic ใด**', () => {
    expect(plan.topLevelWithoutEpic).toBeGreaterThan(100);
  });

  /**
   * ถ้า Epic ทุกใบรับลูก กระดานจะได้เลนเท่าจำนวน Epic — วัดจริงแล้วได้
   * 197 เลนบนกระดานเดียว ซึ่งอ่านไม่ได้ · ขอบบนต้องเล็กพอที่กระดานยังใช้ได้
   * ไม่ใช่แค่ "น้อยกว่าทั้งหมด"
   */
  it('**Epic ที่รับลูกต้องน้อยพอที่กระดานยังอ่านได้**', () => {
    expect(plan.epicsWithChildren).toBeLessThanOrEqual(15);
  });

  /**
   * **หัวใจ** — เลน Epic ต้องไต่สองชั้น (งานย่อย → เรื่องหลัก → Epic)
   * ถ้าไม่มีสายไหนยาวถึงสามชั้นจริง โค้ดที่ไต่ชั้นเดียวแล้วหยุดก็ผ่านหมด
   */
  it('**มีสายที่ลึกครบ 3 ชั้นจริง และมีสายที่ลึกแค่ 2 ชั้นด้วย**', () => {
    let deep = 0;
    let shallow = 0;
    for (const i of items) {
      if (i.level !== -1) continue;
      const parent = plan.links.get(i.id) as string;
      if (plan.links.has(parent)) deep++;
      else shallow++;
    }
    expect(deep, 'ไม่มีงานย่อยใบไหนไต่ถึง Epic — โค้ดที่ไต่ชั้นเดียวจะผ่าน').toBeGreaterThan(50);
    expect(shallow, 'งานย่อยทุกใบไต่ถึง Epic — ไม่มีของให้เลน "ไม่มี Epic"').toBeGreaterThan(50);
  });

  it('เรียกซ้ำได้ผลเดียวกันเป๊ะ — มิฉะนั้นเติมย้อนหลังกับ seed จะไม่ตรงกัน', () => {
    const again = planHierarchy(sample());
    expect([...again.links]).toEqual([...plan.links]);
  });

  /**
   * ตรวจด้วย `has` ไม่ใช่ `get` — `get` คืน `undefined` เหมือนกันทั้งตอนที่
   * ไม่มีคีย์ และตอนที่คีย์มีอยู่แต่ค่าเป็น `undefined` · เขียนด้วย `get`
   * แล้วลบด่าน `used.length > 0` ทิ้ง เทสต์ยังเขียวทั้งที่แผนผูกลูกเข้ากับ
   * แม่ที่ไม่มีตัวตนไปแล้ว
   */
  it('ไม่มี Epic เลย = ไม่มีเรื่องหลักใบไหนได้แม่ (ไม่ใช่โยน error)', () => {
    const only = planHierarchy([
      { id: 'a', level: 0 },
      { id: 'b', level: 0 },
      { id: 'c', level: -1 },
    ]);
    expect(only.links.has('a')).toBe(false);
    expect(only.links.has('b')).toBe(false);
    expect(['a', 'b']).toContain(only.links.get('c'));
  });

  it('ไม่มีเรื่องหลักเลย = งานย่อยไม่ได้แม่ ไม่ใช่ไปเกาะ Epic ผิดชั้น', () => {
    const only = planHierarchy([
      { id: 'e', level: 1 },
      { id: 's', level: -1 },
    ]);
    expect(only.links.size).toBe(0);
  });
});
