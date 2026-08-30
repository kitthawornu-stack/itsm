/**
 * ข้อกำหนดของการจัดวางแดชบอร์ด — **เขียนก่อนโค้ด**
 *
 * เอนจินนี้ผิดแล้วไม่พัง มันแค่ตอบผิด: หน้าที่หายไปหนึ่งช่องดูเหมือนหน้าที่
 * เจ้าของจัดไว้แบบนั้นเอง · ไม่มี error ไม่มีอะไรแดง มีแต่คนที่ตัดสินใจ
 * จากตัวเลขที่ไม่ครบ · จึงเข้าเกณฑ์เดียวกับเอนจินอีกสี่ตัว —
 * ชุดทดสอบเป็นข้อกำหนด ไม่ใช่คำบรรยายสิ่งที่โค้ดทำ
 *
 * ## ความคิดหลัก: โครงร่างที่เก็บไว้คือ "ความตั้งใจ" ไม่ใช่ "ผลลัพธ์"
 *
 * สิ่งที่เก็บคือสิ่งที่เจ้าของอยากเห็น · สิ่งที่เรนเดอร์คือส่วนที่
 * **ยังมีอยู่จริง** และ **คนดูคนนี้ดูได้** · สองอย่างนี้ต่างกันเสมอเมื่อเวลาผ่านไป
 * และช่องว่างระหว่างมันต้องถูกรายงาน ไม่ใช่ถูกกลืน
 */
import { describe, expect, it } from 'vitest';

import {
  GadgetNotFoundError,
  KNOWN_GADGET_KINDS,
  MAX_GADGETS,
  defaultLayout,
  moveGadget,
  resolveLayout,
  type GadgetSpec,
  type Layout,
  type ResolveInput,
} from './dashboard-layout';

const ALL_KINDS = KNOWN_GADGET_KINDS;

function g(id: string, over: Partial<GadgetSpec> = {}): GadgetSpec {
  return { id, kind: 'summary', column: 0, projectId: null, title: null, ...over };
}

function layout(gadgets: GadgetSpec[], columns = 2): Layout {
  return { columns, gadgets };
}

function input(over: Partial<ResolveInput> = {}): ResolveInput {
  return {
    layout: layout([g('a')]),
    knownKinds: ALL_KINDS,
    visibleProjectIds: ['1', '2'],
    ownsLayout: true,
    ...over,
  };
}

// ============================================================

describe('แดชบอร์ด · A · การวางลงตาราง', () => {
  it('การ์ดในคอลัมน์เดียวกันได้แถวเรียงตามลำดับที่เก็บไว้', () => {
    const r = resolveLayout(input({ layout: layout([g('a'), g('b'), g('c')]) }));
    expect(r.gadgets.map((x) => [x.id, x.column, x.row])).toEqual([
      ['a', 0, 0],
      ['b', 0, 1],
      ['c', 0, 2],
    ]);
  });

  it('แต่ละคอลัมน์นับแถวของตัวเอง เริ่มที่ศูนย์เสมอ', () => {
    const r = resolveLayout(
      input({ layout: layout([g('a', { column: 0 }), g('b', { column: 1 }), g('c', { column: 1 })]) }),
    );
    expect(r.gadgets.map((x) => [x.id, x.column, x.row])).toEqual([
      ['a', 0, 0],
      ['b', 1, 0],
      ['c', 1, 1],
    ]);
  });

  /**
   * คอลัมน์ที่เกินขอบ **ต้องยังเห็น** ไม่ใช่หายไป
   *
   * เจ้าของที่ย่อแดชบอร์ดจากสามคอลัมน์เหลือสอง ไม่ได้ตั้งใจลบการ์ดคอลัมน์ที่สาม
   * ทิ้ง · การหายไปเงียบ ๆ ทำให้เขาคิดว่าระบบลืม แล้วสร้างใหม่ทับของเดิม
   */
  it('คอลัมน์ที่เกินจำนวนคอลัมน์ ถูกดันเข้าคอลัมน์สุดท้าย ไม่ใช่หายไป', () => {
    const r = resolveLayout(input({ layout: layout([g('a', { column: 7 })], 2) }));
    expect(r.gadgets).toHaveLength(1);
    expect(r.gadgets[0]?.column).toBe(1);
    expect(r.dropped).toEqual([]);
  });

  it('คอลัมน์ติดลบถูกดึงกลับเป็นศูนย์', () => {
    const r = resolveLayout(input({ layout: layout([g('a', { column: -3 })]) }));
    expect(r.gadgets[0]?.column).toBe(0);
  });

  it('คอลัมน์ที่ไม่ใช่จำนวนเต็มถูกปัดลง ไม่ใช่ทำให้ทั้งหน้าพัง', () => {
    const r = resolveLayout(input({ layout: layout([g('a', { column: 1.9 })], 3) }));
    expect(r.gadgets[0]?.column).toBe(1);
  });

  it('จำนวนคอลัมน์ต่ำกว่าหนึ่งถือเป็นหนึ่ง — หน้าที่มีศูนย์คอลัมน์วางอะไรไม่ได้เลย', () => {
    const r = resolveLayout(input({ layout: layout([g('a'), g('b')], 0) }));
    expect(r.columns).toBe(1);
    expect(r.gadgets.map((x) => x.column)).toEqual([0, 0]);
  });

  it('เรียกสองครั้งด้วยข้อมูลเดียวกัน ได้ผลเหมือนกันเป๊ะ', () => {
    const inp = input({ layout: layout([g('c', { column: 1 }), g('a'), g('b', { column: 1 })]) });
    expect(resolveLayout(inp)).toEqual(resolveLayout(inp));
  });

  it('ไม่แก้ของที่รับเข้ามา — โครงร่างเดิมต้องไม่ถูกเขียนทับ', () => {
    const original = layout([g('a', { column: 9 })], 2);
    const snapshot = JSON.parse(JSON.stringify(original)) as Layout;
    resolveLayout(input({ layout: original }));
    expect(original).toEqual(snapshot);
  });

  it('หน้าว่างเปล่าไม่ใช่ error — คืนรายการว่างและไม่มีอะไรถูกตัด', () => {
    const r = resolveLayout(input({ layout: layout([]) }));
    expect(r.gadgets).toEqual([]);
    expect(r.dropped).toEqual([]);
  });
});

// ============================================================

describe('แดชบอร์ด · B · ชนิดที่ระบบไม่รู้จักแล้ว', () => {
  /**
   * ชนิดของการ์ดที่เก็บไว้เป็น `string` ไม่ใช่ union โดยตั้งใจ
   *
   * แถวในฐานข้อมูลถูกเขียนไว้ตั้งแต่รุ่นก่อน · ถ้าประกาศเป็น union
   * TypeScript จะบอกว่าเคสนี้เกิดไม่ได้ แล้วเราจะไม่เขียนโค้ดรับมือ
   * ทั้งที่มันเกิดจริงทุกครั้งที่ถอดฟีเจอร์ออก
   */
  it('ชนิดที่ไม่อยู่ในรายการที่รู้จัก ไปอยู่ในรายการที่ถูกตัด ไม่ใช่หายเงียบ', () => {
    const r = resolveLayout(input({ layout: layout([g('a', { kind: 'sprint-burndown' })]) }));
    expect(r.gadgets).toEqual([]);
    expect(r.dropped).toEqual([{ id: 'a', reason: 'unknown-kind', title: null }]);
  });

  it('ชนิดที่ไม่รู้จักไม่ทำให้การ์ดตัวอื่นหายไปด้วย', () => {
    const r = resolveLayout(
      input({ layout: layout([g('a'), g('bad', { kind: 'ไม่มีจริง' }), g('c')]) }),
    );
    expect(r.gadgets.map((x) => x.id)).toEqual(['a', 'c']);
    expect(r.dropped.map((x) => x.id)).toEqual(['bad']);
  });

  it('การ์ดที่เหลือได้แถวไล่ต่อกัน ไม่เว้นช่องว่างของตัวที่ถูกตัด', () => {
    const r = resolveLayout(
      input({ layout: layout([g('a'), g('bad', { kind: 'x' }), g('c')]) }),
    );
    expect(r.gadgets.map((x) => x.row)).toEqual([0, 1]);
  });

  it('หน้าที่มีแต่ชนิดที่ไม่รู้จัก คืนหน้าว่างพร้อมเหตุผล ไม่โยน error', () => {
    const r = resolveLayout(
      input({ layout: layout([g('a', { kind: 'x' }), g('b', { kind: 'y' })]) }),
    );
    expect(r.gadgets).toEqual([]);
    expect(r.dropped).toHaveLength(2);
  });

  it('ทุกชนิดที่ประกาศว่ารู้จัก ต้องผ่านด่านนี้ได้จริงทุกตัว', () => {
    for (const kind of ALL_KINDS) {
      const r = resolveLayout(input({ layout: layout([g('a', { kind })]) }));
      expect(r.dropped, `ชนิด ${kind} ถูกตัดทิ้งทั้งที่ประกาศว่ารู้จัก`).toEqual([]);
    }
  });
});

// ============================================================

describe('แดชบอร์ด · C · สิทธิ์', () => {
  it('การ์ดที่ผูกโปรเจกต์ซึ่งคนดูไม่มีสิทธิ์ ถูกตัดออก', () => {
    const r = resolveLayout(input({ layout: layout([g('a', { projectId: '99' })]) }));
    expect(r.gadgets).toEqual([]);
    expect(r.dropped[0]?.reason).toBe('no-access');
  });

  it('การ์ดที่ไม่ผูกโปรเจกต์ (ทุกโปรเจกต์ที่ดูได้) ผ่านเมื่อยังมีโปรเจกต์ให้ดู', () => {
    const r = resolveLayout(input({ layout: layout([g('a', { projectId: null })]) }));
    expect(r.gadgets).toHaveLength(1);
  });

  /**
   * ไม่มีโปรเจกต์ให้ดูเลย = การ์ดทุกใบไร้ความหมาย
   *
   * ยอดศูนย์อ่านว่า "ไม่มีงานเลย" ซึ่งเป็นคนละเรื่องกับ "คุณดูไม่ได้"
   * — บทเรียนเดียวกับ `reportSummary` ที่ปฏิเสธตรง ๆ แทนการคืนศูนย์
   */
  it('คนที่ไม่มีโปรเจกต์ให้ดูสักโปรเจกต์ ถูกตัดทุกใบ ไม่ใช่เห็นยอดศูนย์', () => {
    const r = resolveLayout(
      input({ layout: layout([g('a', { projectId: null }), g('b', { projectId: '1' })]), visibleProjectIds: [] }),
    );
    expect(r.gadgets).toEqual([]);
    expect(r.dropped.map((x) => x.reason)).toEqual(['no-access', 'no-access']);
  });

  it('ชนิดที่ไม่รู้จักถูกตัดด้วยเหตุผลของมันเอง แม้โปรเจกต์จะดูไม่ได้ด้วย', () => {
    const r = resolveLayout(
      input({ layout: layout([g('a', { kind: 'x', projectId: '99' })]) }),
    );
    expect(r.dropped[0]?.reason).toBe('unknown-kind');
  });

  /**
   * คนอื่นเห็นว่ามีของถูกซ่อน แต่ไม่เห็นว่าเป็นของอะไร
   *
   * ชื่อการ์ดที่เจ้าของตั้งเอง เช่น "ค้างของฝ่ายการเงิน" บอกคนนอกว่ามีโปรเจกต์
   * ชื่อนั้นอยู่ · การไล่บอกทีละอย่างคือการวาดแผนที่ให้คนที่กำลังลอง
   */
  it('เจ้าของหน้าเห็นชื่อการ์ดที่ถูกตัด', () => {
    const r = resolveLayout(
      input({
        layout: layout([g('a', { projectId: '99', title: 'ค้างของฝ่ายการเงิน' })]),
        ownsLayout: true,
      }),
    );
    expect(r.dropped[0]?.title).toBe('ค้างของฝ่ายการเงิน');
  });

  it('คนที่ไม่ใช่เจ้าของ เห็นแค่ว่ามีของถูกตัด ไม่เห็นชื่อ', () => {
    const r = resolveLayout(
      input({
        layout: layout([g('a', { projectId: '99', title: 'ค้างของฝ่ายการเงิน' })]),
        ownsLayout: false,
      }),
    );
    expect(r.dropped).toEqual([{ id: 'a', reason: 'no-access', title: null }]);
  });

  it('การ์ดที่ผ่านด่านสิทธิ์ ยังคงชื่อไว้ให้คนที่ไม่ใช่เจ้าของเห็น', () => {
    const r = resolveLayout(
      input({ layout: layout([g('a', { projectId: '1', title: 'ค้างของทีมไอที' })]), ownsLayout: false }),
    );
    expect(r.gadgets[0]?.title).toBe('ค้างของทีมไอที');
  });
});

// ============================================================

describe('แดชบอร์ด · D · เพดานจำนวนการ์ด', () => {
  const many = (n: number, over: Partial<GadgetSpec> = {}): GadgetSpec[] =>
    Array.from({ length: n }, (_, i) => g(`g${String(i)}`, over));

  it('จำนวนเท่าเพดานพอดีผ่านครบ', () => {
    const r = resolveLayout(input({ layout: layout(many(MAX_GADGETS)) }));
    expect(r.gadgets).toHaveLength(MAX_GADGETS);
    expect(r.dropped).toEqual([]);
  });

  it('เกินเพดานตัดเฉพาะส่วนเกิน ไม่ใช่ปฏิเสธทั้งหน้า', () => {
    const r = resolveLayout(input({ layout: layout(many(MAX_GADGETS + 3)) }));
    expect(r.gadgets).toHaveLength(MAX_GADGETS);
    expect(r.dropped).toHaveLength(3);
    expect(r.dropped.every((d) => d.reason === 'over-capacity')).toBe(true);
  });

  it('ตัวที่ถูกตัดคือตัวท้ายตามลำดับที่เก็บ ไม่ใช่ตัวสุ่ม', () => {
    const r = resolveLayout(input({ layout: layout(many(MAX_GADGETS + 2)) }));
    expect(r.dropped.map((d) => d.id)).toEqual([
      `g${String(MAX_GADGETS)}`,
      `g${String(MAX_GADGETS + 1)}`,
    ]);
  });

  /**
   * เพดานนับเฉพาะการ์ดที่จะได้เรนเดอร์จริง
   *
   * ถ้าการ์ดที่ตายแล้วยังกินโควตา หน้าที่เคยเต็มจะค่อย ๆ ว่างลงเมื่อถอดฟีเจอร์
   * โดยที่เจ้าของไม่ได้ทำอะไรผิด และมองไม่ออกว่าทำไม
   */
  it('การ์ดที่ถูกตัดเพราะชนิดไม่รู้จัก ไม่กินโควตาของเพดาน', () => {
    const dead = many(5, { kind: 'ไม่มีจริง' }).map((x, i) => ({ ...x, id: `d${String(i)}` }));
    const r = resolveLayout(input({ layout: layout([...dead, ...many(MAX_GADGETS)]) }));
    expect(r.gadgets).toHaveLength(MAX_GADGETS);
    expect(r.dropped.filter((d) => d.reason === 'over-capacity')).toEqual([]);
  });
});

// ============================================================

describe('แดชบอร์ด · E · การย้ายด้วยคีย์บอร์ด', () => {
  const three = (): Layout => layout([g('a'), g('b'), g('c')], 2);

  it('ย้ายลงสลับกับตัวถัดไปในคอลัมน์เดียวกัน', () => {
    const out = moveGadget(three(), 'a', 'down');
    expect(out.gadgets.map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('ย้ายขึ้นสลับกับตัวก่อนหน้าในคอลัมน์เดียวกัน', () => {
    const out = moveGadget(three(), 'c', 'up');
    expect(out.gadgets.map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });

  it('ย้ายขึ้นจากบนสุดไม่เปลี่ยนอะไร — ไม่วนไปล่างสุด', () => {
    const out = moveGadget(three(), 'a', 'up');
    expect(out.gadgets.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('ย้ายลงจากล่างสุดไม่เปลี่ยนอะไร', () => {
    const out = moveGadget(three(), 'c', 'down');
    expect(out.gadgets.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('ย้ายซ้ายจากคอลัมน์แรกไม่เปลี่ยนอะไร', () => {
    expect(moveGadget(three(), 'a', 'left').gadgets).toEqual(three().gadgets);
  });

  it('ย้ายขวาจากคอลัมน์สุดท้ายไม่เปลี่ยนอะไร', () => {
    const l = layout([g('a', { column: 1 })], 2);
    expect(moveGadget(l, 'a', 'right').gadgets).toEqual(l.gadgets);
  });

  /** ตำแหน่งที่คาดเดาได้สำคัญกว่าตำแหน่งที่ "ใกล้เคียงเดิม" — คนกดซ้ำได้ */
  it('ย้ายขวาไปอยู่ท้ายคอลัมน์ถัดไปเสมอ', () => {
    const l = layout([g('a'), g('x', { column: 1 }), g('y', { column: 1 })], 2);
    const out = moveGadget(l, 'a', 'right');
    const col1 = out.gadgets.filter((z) => z.column === 1).map((z) => z.id);
    expect(col1).toEqual(['x', 'y', 'a']);
  });

  it('ย้ายซ้ายไปอยู่ท้ายคอลัมน์ก่อนหน้าเสมอ', () => {
    const l = layout([g('x'), g('y'), g('a', { column: 1 })], 2);
    const out = moveGadget(l, 'a', 'left');
    expect(out.gadgets.filter((z) => z.column === 0).map((z) => z.id)).toEqual(['x', 'y', 'a']);
  });

  it('ย้ายขึ้นลงข้ามคอลัมน์กันไม่ได้ — ตัวที่อยู่คนละคอลัมน์ไม่ถือเป็นเพื่อนบ้าน', () => {
    const l = layout([g('a'), g('b', { column: 1 })], 2);
    expect(moveGadget(l, 'b', 'up').gadgets).toEqual(l.gadgets);
  });

  it('ย้ายแล้วการ์ดตัวอื่นไม่สลับที่กันเอง', () => {
    const l = layout([g('a'), g('b'), g('c'), g('z', { column: 1 })], 2);
    const out = moveGadget(l, 'c', 'up');
    expect(out.gadgets.filter((x) => x.column === 1).map((x) => x.id)).toEqual(['z']);
  });

  /**
   * ปุ่มย้ายมีอยู่ข้างการ์ดเท่านั้น · id ที่ไม่มีจริงแปลว่าโค้ดผิด
   * ไม่ใช่ผู้ใช้ทำอะไรผิด — คืนของเดิมเงียบ ๆ จะกลายเป็นปุ่มที่ "กดไม่ติด"
   * ซึ่งไม่มีใครแจ้ง เพราะดูเหมือนตั้งใจให้เป็นแบบนั้น
   */
  it('ย้ายการ์ดที่ไม่มีอยู่ โยน error ไม่ใช่คืนของเดิมเงียบ ๆ', () => {
    expect(() => moveGadget(three(), 'ไม่มีตัวนี้', 'up')).toThrow(GadgetNotFoundError);
  });

  it('ไม่แก้โครงร่างเดิม — คืนของใหม่เสมอ', () => {
    const l = three();
    const snapshot = JSON.parse(JSON.stringify(l)) as Layout;
    moveGadget(l, 'a', 'down');
    expect(l).toEqual(snapshot);
  });

  it('จำนวนการ์ดไม่เปลี่ยนหลังย้าย ไม่ว่าทิศไหน', () => {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      expect(moveGadget(three(), 'b', dir).gadgets).toHaveLength(3);
    }
  });
});

// ============================================================

describe('แดชบอร์ด · F · หน้าเริ่มต้น', () => {
  it('ผู้ใช้ใหม่ไม่ได้หน้าว่างเปล่า', () => {
    expect(defaultLayout().gadgets.length).toBeGreaterThan(0);
  });

  /**
   * ด่านที่จับ "ค่าเริ่มต้นที่พังตั้งแต่วันแรก"
   *
   * หน้าเริ่มต้นที่อ้างชนิดซึ่งพิมพ์ผิด จะขึ้นเป็นหน้าว่างให้ผู้ใช้ใหม่ทุกคน
   * โดยไม่มี error — และคนที่เจอคือคนที่เพิ่งเริ่มใช้ระบบ ซึ่งจะสรุปว่า
   * ระบบไม่มีอะไรเลย ไม่ใช่ว่าหน้านี้ตั้งค่าผิด
   */
  it('หน้าเริ่มต้นผ่านการตรวจโดยไม่มีการ์ดไหนถูกตัดสักใบ', () => {
    const r = resolveLayout(input({ layout: defaultLayout() }));
    expect(r.dropped).toEqual([]);
    expect(r.gadgets).toHaveLength(defaultLayout().gadgets.length);
  });

  it('หน้าเริ่มต้นไม่ผูกโปรเจกต์ใดโปรเจกต์หนึ่ง — คนใหม่ยังไม่รู้ว่ามีโปรเจกต์อะไร', () => {
    expect(defaultLayout().gadgets.every((x) => x.projectId === null)).toBe(true);
  });

  it('หน้าเริ่มต้นไม่เกินเพดาน', () => {
    expect(defaultLayout().gadgets.length).toBeLessThanOrEqual(MAX_GADGETS);
  });

  it('รหัสของการ์ดในหน้าเริ่มต้นไม่ซ้ำกัน', () => {
    const ids = defaultLayout().gadgets.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
