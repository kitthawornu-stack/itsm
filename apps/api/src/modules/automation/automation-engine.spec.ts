/**
 * Automation Engine — เทสต์เป็นข้อกำหนด เขียนก่อนโค้ด
 *
 * เอนจินตัวที่ห้า ต่อจาก workflow · SLA · HQL · LexoRank · ลักษณะเดียวกัน:
 * **ความผิดพลาดไม่ทำให้ระบบพัง แต่ทำให้ระบบทำสิ่งที่ไม่มีใครสั่งอย่างเงียบ ๆ**
 *
 * ห้าข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **กฎที่ปลุกตัวเองต้องหยุด** — กฎที่ทำงานเมื่อสถานะเปลี่ยนแล้วสั่งเปลี่ยน
 *      สถานะ จะวนไม่จบ · ไม่มี error ไม่มีอะไรพัง แค่ตั๋วใบเดียวสร้างประวัติ
 *      หลักพันแถวในไม่กี่วินาที และคนที่มาดูเห็นแค่ "ระบบทำงานอยู่"
 *   2. **ค่าที่ไม่มี ต้องไม่ผ่านเงื่อนไข `is`** — ตั๋วที่ยังไม่ได้ตั้งความสำคัญ
 *      ไม่ควรถูกนับว่า "ความสำคัญเท่ากับอะไรก็ได้"
 *   3. **ชื่อกฎต้องติดไปกับทุกการกระทำ** — คำถามแรกของคนที่เจอตั๋วถูกมอบหมาย
 *      เองคือ "ใครสั่ง" และ "ระบบทำเอง" ไม่ช่วยอะไรเลย
 *   4. **กฎที่ปิดอยู่ต้องไม่ทำงาน** แม้เงื่อนไขจะตรงทุกข้อ
 *   5. **รายการชนิดที่หน้าจอเลือกได้ ต้องตรงกับที่เอนจินรู้จัก**
 */
import { describe, expect, it } from 'vitest';

import {
  ACTION_KINDS,
  CONDITION_FIELDS,
  MAX_DEPTH,
  TRIGGERS,
  TooDeepError,
  matches,
  plan,
  ruleApplies,
  type AutomationEvent,
  type Condition,
  type Rule,
} from './automation-engine';

function ev(over: Partial<AutomationEvent> = {}): AutomationEvent {
  return {
    kind: 'item.created',
    item: {
      itemKey: 'SD-1',
      projectKey: 'SD',
      issueTypeName: 'Incident',
      statusName: 'New',
      statusCategory: 'TODO',
      priorityRank: 2,
      assigneeId: null,
      labels: ['เครือข่าย', 'ด่วน'],
    },
    actorId: '100',
    depth: 0,
    ...over,
  };
}

function rule(over: Partial<Rule> = {}): Rule {
  return {
    id: '1',
    name: 'มอบหมายงานเครือข่ายให้ทีมเน็ต',
    trigger: 'item.created',
    isEnabled: true,
    conditions: [],
    actions: [{ kind: 'assign', value: '200' }],
    ...over,
  };
}

describe('A · เงื่อนไขทีละข้อ', () => {
  const c = (over: Partial<Condition>): Condition =>
    ({ field: 'project', op: 'is', value: 'SD', ...over }) as Condition;

  it('เทียบค่าตรง ๆ ได้ทั้ง is และ is-not', () => {
    expect(matches(c({}), ev())).toBe(true);
    expect(matches(c({ value: 'PLAT' }), ev())).toBe(false);
    expect(matches(c({ op: 'is-not', value: 'PLAT' }), ev())).toBe(true);
  });

  it('**ค่าที่ไม่มี ต้องไม่ผ่านเงื่อนไข `is`**', () => {
    /*
      ตั๋วที่ยังไม่ได้ตั้งความสำคัญ ไม่ควรถูกนับว่า "ความสำคัญเท่ากับอะไรก็ได้"
      · ถ้าปล่อยผ่าน กฎที่เขียนว่า "ถ้า P1 ให้แจ้งหัวหน้า" จะแจ้งทุกใบที่ยัง
      ไม่ได้ตั้งความสำคัญด้วย — ซึ่งเป็นใบส่วนใหญ่ตอนเพิ่งแจ้งเข้ามา
    */
    const noPriority = ev({ item: { ...ev().item, priorityRank: null } });
    expect(matches(c({ field: 'priority', op: 'is', value: '1' }), noPriority)).toBe(false);
  });

  it('แต่ `is-not` ผ่านเมื่อไม่มีค่า — "ไม่ใช่ P1" เป็นจริง', () => {
    const noPriority = ev({ item: { ...ev().item, priorityRank: null } });
    expect(matches(c({ field: 'priority', op: 'is-not', value: '1' }), noPriority)).toBe(true);
  });

  it('`has` ใช้กับรายการป้าย', () => {
    expect(matches(c({ field: 'label', op: 'has', value: 'ด่วน' }), ev())).toBe(true);
    expect(matches(c({ field: 'label', op: 'has', value: 'ไม่มี' }), ev())).toBe(false);
  });

  it('**`has` กับค่าเดี่ยว = กฎที่เขียนผิด ต้องไม่ผ่าน**', () => {
    /*
      "โปรเจกต์ has SD" ไม่มีความหมาย · การปล่อยให้ผ่านเงียบ ๆ ทำให้กฎที่เขียน
      ผิดทำงานเหมือนถูก แล้วผู้ดูแลจะไม่มีวันรู้ว่าตัวเองเขียนอะไรลงไป
    */
    expect(matches(c({ field: 'project', op: 'has', value: 'SD' }), ev())).toBe(false);
  });

  it('`unassigned` ตอบเป็น true/false ตามจริง', () => {
    expect(matches(c({ field: 'unassigned', op: 'is', value: 'true' }), ev())).toBe(true);
    const assigned = ev({ item: { ...ev().item, assigneeId: '9' } });
    expect(matches(c({ field: 'unassigned', op: 'is', value: 'true' }), assigned)).toBe(false);
  });

  it('`transition` มีค่าเฉพาะเหตุการณ์เปลี่ยนสถานะ', () => {
    const moved = ev({ kind: 'item.transitioned', transitionName: 'เริ่มตรวจสอบ' });
    expect(matches(c({ field: 'transition', op: 'is', value: 'เริ่มตรวจสอบ' }), moved)).toBe(true);
    // เหตุการณ์อื่นไม่มีชื่อปุ่ม — ต้องไม่ผ่าน ไม่ใช่ผ่านเพราะค่าว่างเท่ากับค่าว่าง
    expect(matches(c({ field: 'transition', op: 'is', value: 'เริ่มตรวจสอบ' }), ev())).toBe(false);
  });
});

describe('B · กฎทั้งข้อ', () => {
  it('**กฎที่ปิดอยู่ ต้องไม่ทำงาน แม้เงื่อนไขตรงทุกข้อ**', () => {
    expect(ruleApplies(rule({ isEnabled: false }), ev())).toBe(false);
  });

  it('trigger ต้องตรงกับเหตุการณ์', () => {
    expect(ruleApplies(rule({ trigger: 'comment.added' }), ev())).toBe(false);
  });

  it('**กฎที่ไม่มีเงื่อนไขเลย ทำงานกับทุกเหตุการณ์ของ trigger นั้น**', () => {
    /*
      ไม่ใช่ "ไม่ทำงาน" · เป็นเจตนาที่อ่านง่ายกว่า และผู้ดูแลที่ลืมใส่เงื่อนไข
      จะเห็นผลทันทีแทนที่จะสงสัยว่าทำไมกฎเงียบ — ความเงียบวินิจฉัยยากกว่ามาก
    */
    expect(ruleApplies(rule({ conditions: [] }), ev())).toBe(true);
  });

  it('ทุกเงื่อนไขต้องเป็นจริงพร้อมกัน', () => {
    const r = rule({
      conditions: [
        { field: 'project', op: 'is', value: 'SD' },
        { field: 'priority', op: 'is', value: '1' },
      ],
    });
    expect(ruleApplies(r, ev())).toBe(false);
  });
});

describe('C · แผนการกระทำ', () => {
  it('**ชื่อกฎติดไปกับทุกการกระทำ**', () => {
    /*
      คำถามแรกของคนที่เจอตั๋วถูกมอบหมายเองคือ "ใครสั่ง" · คำตอบ "ระบบทำเอง"
      ไม่ช่วยอะไรเลย และทำให้คนเลิกเชื่อระบบอัตโนมัติทั้งชุด
    */
    const out = plan([rule()], ev());
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleName).toBe('มอบหมายงานเครือข่ายให้ทีมเน็ต');
    expect(out[0]?.ruleId).toBe('1');
  });

  it('กฎหลายข้อทำงานตามลำดับที่ส่งเข้ามา', () => {
    const a = rule({ id: '1', name: 'ก', actions: [{ kind: 'add-label', value: 'ก' }] });
    const b = rule({ id: '2', name: 'ข', actions: [{ kind: 'add-label', value: 'ข' }] });
    expect(plan([a, b], ev()).map((x) => x.value)).toEqual(['ก', 'ข']);
  });

  it('ไม่มีกฎไหนตรง = ไม่มีการกระทำ ไม่ใช่ error', () => {
    expect(plan([rule({ trigger: 'sla.breached' })], ev())).toEqual([]);
  });
});

describe('D · กฎที่ปลุกตัวเอง', () => {
  it('**ลึกเกินเพดาน ต้องหยุดและบอกว่าทำไม**', () => {
    /*
      เคสที่สำคัญที่สุดของไฟล์นี้ · กฎที่ทำงานเมื่อสถานะเปลี่ยนแล้วสั่งเปลี่ยน
      สถานะ จะปลุกตัวเองไม่รู้จบ — ไม่มี error ไม่มีอะไรพัง แค่ตั๋วใบเดียว
      สร้างประวัติหลักพันแถวในไม่กี่วินาที

      ข้อความต้องบอกว่าหยุดเพราะอะไร ไม่ใช่เงียบไป — ผู้ดูแลที่เห็นกฎไม่ทำงาน
      ต้องรู้ว่าเป็นเพราะวน ไม่ใช่เพราะเงื่อนไขไม่ตรง
    */
    expect(() => plan([rule()], ev({ depth: MAX_DEPTH + 1 }))).toThrow(TooDeepError);
    try {
      plan([rule()], ev({ depth: MAX_DEPTH + 1 }));
    } catch (e) {
      expect(String(e)).toContain('วนไม่จบ');
    }
  });

  it('ที่เพดานพอดี ยังทำงาน', () => {
    // เพดานคือ "ลึกได้ถึงเท่านี้" ไม่ใช่ "ลึกได้ไม่ถึงเท่านี้"
    expect(plan([rule()], ev({ depth: MAX_DEPTH }))).toHaveLength(1);
  });

  it('เอนจินไม่จำความลึกเอง — ผู้เรียกเป็นคนนับ', () => {
    /*
      เอนจินที่จำสถานะข้ามการเรียก ไม่ใช่ฟังก์ชันบริสุทธิ์อีกต่อไป และ
      ทดสอบเคสวนไม่ได้เลย · เรียกซ้ำที่ depth เดิมต้องได้ผลเดิมทุกครั้ง
    */
    const e = ev({ depth: 1 });
    expect(plan([rule()], e)).toEqual(plan([rule()], e));
  });
});

describe('E · รายการที่หน้าจอเลือกได้', () => {
  it('**ชนิดของเงื่อนไขที่ประกาศ ต้องตรงกับที่เอนจินตอบได้จริง**', () => {
    /*
      รายการที่ดูแลด้วยมือแยกจากตัวที่ทำงานจริง จะไม่ตรงกันในวันที่มีคนแก้
      แค่ฝั่งเดียว · เทสต์นี้คือสะพานเดียวที่จับได้ (กติกาเดียวกับ
      `RULE_CATALOG` ของ workflow)
    */
    for (const field of CONDITION_FIELDS) {
      // ทุกชนิดต้องตอบได้โดยไม่โยน — ชนิดที่เอนจินไม่รู้จักจะตกท้าย switch
      expect(() => matches({ field, op: 'is', value: 'x' }, ev())).not.toThrow();
    }
    expect(CONDITION_FIELDS.length).toBeGreaterThan(0);
    expect(new Set(CONDITION_FIELDS).size).toBe(CONDITION_FIELDS.length);
  });

  it('รายการ trigger และ action ไม่มีค่าซ้ำ', () => {
    expect(new Set(TRIGGERS).size).toBe(TRIGGERS.length);
    expect(new Set(ACTION_KINDS).size).toBe(ACTION_KINDS.length);
  });
});
