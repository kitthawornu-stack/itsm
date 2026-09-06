/**
 * Workflow Engine — เทสต์เป็นข้อกำหนด เขียนก่อน implementation (CLAUDE.md §4)
 *
 * ทำไมเอนจินนี้ต้องเขียนเทสต์ก่อน: ความผิดพลาดปรากฏเป็น
 * "ปุ่มที่ไม่ควรเห็นแต่เห็น" ซึ่งคือช่องโหว่ด้านสิทธิ์ ไม่ใช่บั๊กด้านการใช้งาน
 *
 * โครงสร้างที่ต้องบังคับ — transition หนึ่งเส้นมีสามชั้น ตามลำดับนี้เท่านั้น:
 *   1. CONDITION      ใครเห็นปุ่มนี้        → ถ้าไม่ผ่าน ปุ่มต้องไม่ปรากฏเลย
 *   2. VALIDATOR      กรอกครบไหม           → ปุ่มปรากฏ แต่กดแล้วถูกปฏิเสธพร้อมเหตุผล
 *   3. POST_FUNCTION  ทำอะไรต่อหลังผ่าน    → รันหลังเปลี่ยนสถานะ ในทรานแซกชันเดียวกัน
 *
 * ความต่างระหว่าง CONDITION กับ VALIDATOR สำคัญมาก:
 * ถ้าเอา required-field ไปไว้ใน CONDITION ผู้ใช้จะเห็นปุ่มหายไปโดยไม่รู้สาเหตุ
 */
import { describe, expect, it } from 'vitest';

import {
  KNOWN_POST_FUNCTIONS,
  RULE_CATALOG,
  evaluateTransitions,
  slaEffectOfTransition,
  validateTransition,
  TransitionNotAllowedError,
  ValidationFailedError,
  type TransitionDefinition,
  type TransitionContext,
} from './workflow-engine';

// ---------- ตัวช่วยสร้างข้อมูลทดสอบ ----------

const STATUS = {
  new: { id: 1n, name: 'New', category: 'TODO' as const, pausesSla: false },
  investigating: { id: 2n, name: 'Investigating', category: 'IN_PROGRESS' as const, pausesSla: false },
  pending: { id: 3n, name: 'Pending Customer', category: 'IN_PROGRESS' as const, pausesSla: true },
  resolved: { id: 4n, name: 'Resolved', category: 'DONE' as const, pausesSla: false },
};

function ctx(overrides: Partial<TransitionContext> = {}): TransitionContext {
  return {
    currentUserId: 100n,
    currentStatusId: STATUS.investigating.id,
    assigneeId: 100n,
    userGroupIds: [10n],
    fields: {},
    ...overrides,
  };
}

const resolveTransition: TransitionDefinition = {
  id: 900n,
  name: 'แก้ไขเสร็จแล้ว',
  fromStatusId: STATUS.investigating.id,
  toStatusId: STATUS.resolved.id,
  position: 1,
  rules: [
    { kind: 'CONDITION', ruleType: 'assignee-is-current-user', config: {}, position: 1 },
    { kind: 'VALIDATOR', ruleType: 'required-fields', config: { fields: ['resolution'] }, position: 1 },
    { kind: 'POST_FUNCTION', ruleType: 'stop-sla', config: { goal: 'time-to-resolve' }, position: 1 },
  ],
};

const startTransition: TransitionDefinition = {
  id: 901n,
  name: 'เริ่มตรวจสอบ',
  fromStatusId: STATUS.new.id,
  toStatusId: STATUS.investigating.id,
  position: 1,
  rules: [],
};

/** transition ที่ต้องได้รับอนุมัติก่อน — ใช้ทดสอบ validator `require-approval` */
const needsApproval: TransitionDefinition = {
  id: 903n,
  name: 'เริ่มจัดซื้อ',
  fromStatusId: STATUS.new.id,
  toStatusId: STATUS.investigating.id,
  position: 2,
  rules: [{ kind: 'VALIDATOR', ruleType: 'require-approval', config: {}, position: 1 }],
};

/** transition ที่ต้องปิดงานย่อยให้ครบก่อน — ใช้ทดสอบ validator `children-done` */
const needsChildrenDone: TransitionDefinition = {
  id: 904n,
  name: 'ปิดเรื่องหลัก',
  fromStatusId: STATUS.new.id,
  toStatusId: STATUS.resolved.id,
  position: 3,
  rules: [{ kind: 'VALIDATOR', ruleType: 'children-done', config: {}, position: 1 }],
};

/** transition ที่ห้ามกดเมื่อความเสี่ยงสูง — ใช้ทดสอบ `max-change-risk` */
const needsLowRisk: TransitionDefinition = {
  id: 905n,
  name: 'เริ่มดำเนินการเปลี่ยนแปลง',
  fromStatusId: STATUS.new.id,
  toStatusId: STATUS.investigating.id,
  position: 4,
  rules: [{ kind: 'VALIDATOR', ruleType: 'max-change-risk', config: {}, position: 1 }],
};

const escalate: TransitionDefinition = {
  id: 902n,
  name: 'ยกระดับเป็น Major Incident',
  fromStatusId: null, // global — ทำได้จากทุกสถานะ
  toStatusId: STATUS.investigating.id,
  position: 9,
  rules: [{ kind: 'CONDITION', ruleType: 'in-group', config: { groupIds: ['99'] }, position: 1 }],
};

// ============================================================
describe('Workflow Engine · การเลือก transition ที่ทำได้', () => {
  it('คืนเฉพาะ transition ที่ออกจากสถานะปัจจุบัน', () => {
    const available = evaluateTransitions([startTransition, resolveTransition], ctx());
    expect(available.map((t) => t.name)).toEqual(['แก้ไขเสร็จแล้ว']);
  });

  it('transition ที่ fromStatusId = null ใช้ได้จากทุกสถานะ', () => {
    const available = evaluateTransitions([escalate], ctx({ userGroupIds: [99n] }));
    expect(available.map((t) => t.name)).toEqual(['ยกระดับเป็น Major Incident']);

    const fromNew = evaluateTransitions([escalate], ctx({
      currentStatusId: STATUS.new.id,
      userGroupIds: [99n],
    }));
    expect(fromNew).toHaveLength(1);
  });

  it('CONDITION ที่ไม่ผ่าน ทำให้ปุ่มไม่ปรากฏเลย', () => {
    // ผู้ใช้ไม่ใช่ผู้รับผิดชอบ → assignee-is-current-user ไม่ผ่าน
    const available = evaluateTransitions([resolveTransition], ctx({ assigneeId: 555n }));
    expect(available).toHaveLength(0);
  });

  it('CONDITION แบบกลุ่ม: ไม่อยู่ในกลุ่มที่กำหนดก็ไม่เห็นปุ่ม', () => {
    expect(evaluateTransitions([escalate], ctx({ userGroupIds: [10n] }))).toHaveLength(0);
    expect(evaluateTransitions([escalate], ctx({ userGroupIds: [10n, 99n] }))).toHaveLength(1);
  });

  it('VALIDATOR ที่ไม่ผ่าน **ไม่** ทำให้ปุ่มหาย — ปุ่มยังเห็น แต่กดแล้วถูกปฏิเสธ', () => {
    // ไม่ได้กรอก resolution แต่ต้องยังเห็นปุ่ม เพื่อให้ผู้ใช้รู้ว่าต้องกรอกอะไร
    const available = evaluateTransitions([resolveTransition], ctx({ fields: {} }));
    expect(available).toHaveLength(1);
    expect(available[0]?.name).toBe('แก้ไขเสร็จแล้ว');
  });

  it('เรียงตาม position เพื่อให้คีย์ลัด 1-9 คงที่', () => {
    const t2 = { ...startTransition, id: 903n, name: 'B', fromStatusId: STATUS.investigating.id, position: 2 };
    const t1 = { ...startTransition, id: 904n, name: 'A', fromStatusId: STATUS.investigating.id, position: 1 };
    const available = evaluateTransitions([t2, t1], ctx());
    expect(available.map((t) => t.name)).toEqual(['A', 'B']);
  });
});

describe('Workflow Engine · การตรวจก่อนเปลี่ยนสถานะ', () => {
  it('ผ่านเมื่อ condition และ validator ผ่านทั้งหมด', () => {
    const outcome = validateTransition(resolveTransition, ctx({ fields: { resolution: 'แก้ไขเรียบร้อย' } }));
    expect(outcome.toStatusId).toBe(STATUS.resolved.id);
    expect(outcome.postFunctions.map((p) => p.ruleType)).toEqual(['stop-sla']);
  });

  it('โยน TransitionNotAllowedError เมื่อ CONDITION ไม่ผ่าน', () => {
    expect(() => validateTransition(resolveTransition, ctx({ assigneeId: 555n }))).toThrow(
      TransitionNotAllowedError,
    );
  });

  it('โยน TransitionNotAllowedError เมื่อสถานะปัจจุบันไม่ตรงกับ fromStatusId', () => {
    expect(() =>
      validateTransition(resolveTransition, ctx({ currentStatusId: STATUS.new.id })),
    ).toThrow(TransitionNotAllowedError);
  });

  it('โยน ValidationFailedError พร้อมชื่อฟิลด์ที่ขาด — ไม่ใช่ข้อความคลุมเครือ', () => {
    try {
      validateTransition(resolveTransition, ctx({ fields: {} }));
      expect.unreachable('ควรโยน error');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationFailedError);
      expect((e as ValidationFailedError).missingFields).toEqual(['resolution']);
    }
  });

  it('ฟิลด์ที่เป็นสตริงว่างหรือช่องว่างล้วน ถือว่ายังไม่กรอก', () => {
    expect(() => validateTransition(resolveTransition, ctx({ fields: { resolution: '' } }))).toThrow(
      ValidationFailedError,
    );
    expect(() =>
      validateTransition(resolveTransition, ctx({ fields: { resolution: '   ' } })),
    ).toThrow(ValidationFailedError);
  });

  it('ฟิลด์ที่เป็น 0 หรือ false ถือว่ากรอกแล้ว — ไม่ใช่ค่าว่าง', () => {
    const t: TransitionDefinition = {
      ...resolveTransition,
      rules: [
        { kind: 'VALIDATOR', ruleType: 'required-fields', config: { fields: ['count', 'flag'] }, position: 1 },
      ],
    };
    expect(() => validateTransition(t, ctx({ fields: { count: 0, flag: false } }))).not.toThrow();
  });

  it('รายงานฟิลด์ที่ขาดทั้งหมดในครั้งเดียว ไม่ใช่ทีละตัว', () => {
    const t: TransitionDefinition = {
      ...resolveTransition,
      rules: [
        { kind: 'VALIDATOR', ruleType: 'required-fields', config: { fields: ['a', 'b', 'c'] }, position: 1 },
      ],
    };
    try {
      validateTransition(t, ctx({ fields: { b: 'x' } }));
      expect.unreachable('ควรโยน error');
    } catch (e) {
      expect((e as ValidationFailedError).missingFields).toEqual(['a', 'c']);
    }
  });

  it('POST_FUNCTION เรียงตาม position', () => {
    const t: TransitionDefinition = {
      ...resolveTransition,
      rules: [
        { kind: 'POST_FUNCTION', ruleType: 'notify', config: {}, position: 2 },
        { kind: 'POST_FUNCTION', ruleType: 'stop-sla', config: {}, position: 1 },
      ],
    };
    const outcome = validateTransition(t, ctx());
    expect(outcome.postFunctions.map((p) => p.ruleType)).toEqual(['stop-sla', 'notify']);
  });

  it('rule ที่ระบบไม่รู้จักต้องทำให้ transition ล้มเหลว ไม่ใช่ข้ามไปเงียบ ๆ', () => {
    // นี่คือพฤติกรรมที่สำคัญด้านความปลอดภัย: ถ้าแอดมินตั้ง condition ที่โค้ดยังไม่รองรับ
    // แล้วเราข้ามมันไป ผลคือสิทธิ์ถูกเปิดกว้างกว่าที่แอดมินตั้งใจ
    const t: TransitionDefinition = {
      ...resolveTransition,
      rules: [{ kind: 'CONDITION', ruleType: 'rule-ที่ยังไม่มีในโค้ด', config: {}, position: 1 }],
    };
    expect(() => validateTransition(t, ctx())).toThrow(/ไม่รู้จัก/);
    expect(evaluateTransitions([t], ctx())).toHaveLength(0);
  });
});

describe('Workflow Engine · ลำดับการทำงานสามชั้น', () => {
  it('CONDITION ถูกตรวจก่อน VALIDATOR เสมอ', () => {
    // ถ้าทั้งสองชั้นไม่ผ่าน ต้องได้ TransitionNotAllowedError (ชั้นแรก)
    // ไม่ใช่ ValidationFailedError — เพราะผู้ใช้ที่ไม่มีสิทธิ์ไม่ควรรู้ว่าต้องกรอกฟิลด์อะไร
    expect(() =>
      validateTransition(resolveTransition, ctx({ assigneeId: 555n, fields: {} })),
    ).toThrow(TransitionNotAllowedError);
  });

  it('transition ที่ไม่มี rule เลย ผ่านได้และไม่มี post function', () => {
    const outcome = validateTransition(startTransition, ctx({ currentStatusId: STATUS.new.id }));
    expect(outcome.toStatusId).toBe(STATUS.investigating.id);
    expect(outcome.postFunctions).toHaveLength(0);
  });
});

/**
 * ตารางนี้เป็นจุดที่พลาดแล้วเงียบที่สุดของทั้งฟีเจอร์ SLA
 *
 * เลือกผิดหนึ่งช่อง นาฬิกาเดินผิดไปทั้งใบโดยไม่มี error สักบรรทัด
 * และไม่มีหน้าจอไหนแสดงอาการ นอกจากตัวเลขที่ผิดในรายงานอีกสามเดือนถัดมา
 */
describe('slaEffectOfTransition', () => {
  const todo = { category: 'TODO', pausesSla: false };
  const doing = { category: 'IN_PROGRESS', pausesSla: false };
  const waiting = { category: 'IN_PROGRESS', pausesSla: true };
  const done = { category: 'DONE', pausesSla: false };

  it('เข้าหมวด DONE = หยุดนาฬิกา', () => {
    expect(slaEffectOfTransition(doing, done)).toBe('stop');
  });

  it('**ออกจากหมวด DONE = เปิดใหม่** ไม่ใช่แค่คำนวณใหม่', () => {
    // ก่อนมีช่องนี้ กรณีนี้ตกไปที่ recompute ซึ่งคำนวณนาฬิกาที่ปิดแล้วใหม่
    // แล้วได้ "จบแล้ว" เหมือนเดิมทุกครั้ง — ตั๋วที่เปิดใหม่จึงไม่มีนาฬิกาเดินเลย
    expect(slaEffectOfTransition(done, doing)).toBe('reopen');
    expect(slaEffectOfTransition(done, todo)).toBe('reopen');
  });

  it('เปิดใหม่เข้าสถานะที่พักนาฬิกา ก็ยังต้องปลุกนาฬิกาก่อน', () => {
    // ถ้าตอบ pause นาฬิกาที่ปิดอยู่จะไม่มีอะไรปลุก แล้วค้างเป็น "จบแล้ว" ต่อไป
    expect(slaEffectOfTransition(done, waiting)).toBe('reopen');
  });

  it('DONE ไป DONE ยังนับเป็นหยุด ไม่ใช่เปิดใหม่', () => {
    // Resolved -> Closed เป็นเส้นทางปกติ ต้องไม่ปลุกนาฬิกาขึ้นมาเดินอีก
    expect(slaEffectOfTransition(done, done)).toBe('stop');
  });

  it('เข้าสถานะที่พักนาฬิกา = พัก', () => {
    expect(slaEffectOfTransition(doing, waiting)).toBe('pause');
  });

  it('พักอยู่แล้วเข้าสถานะที่พักอีก ไม่พักซ้ำ', () => {
    expect(slaEffectOfTransition(waiting, waiting)).toBe('recompute');
  });

  it('ออกจากสถานะที่พัก = เดินต่อ', () => {
    expect(slaEffectOfTransition(waiting, doing)).toBe('resume');
  });

  it('เปลี่ยนสถานะที่ไม่กระทบนาฬิกา ยังต้องคำนวณใหม่ ไม่ใช่ไม่ทำอะไร', () => {
    expect(slaEffectOfTransition(todo, doing)).toBe('recompute');
  });

  it('ไม่รู้สถานะเดิม ถือว่าไม่เคยพักและไม่เคยปิด', () => {
    expect(slaEffectOfTransition(null, doing)).toBe('recompute');
    expect(slaEffectOfTransition(null, waiting)).toBe('pause');
  });
});

describe('Workflow Engine · require-approval', () => {
  /*
    กฎนี้เป็นฟังก์ชันบริสุทธิ์เหมือนกฎอื่นทุกตัว — สถานะการอนุมัติถูกส่งเข้ามาใน
    context ไม่ใช่ให้เอนจินไปอ่านฐานข้อมูลเอง (กติกาเดียวกับที่ห้าม SLA Engine
    อ่านนาฬิกาเอง) · เทสต์ชุดนี้จึงรันได้โดยไม่ต้องมีฐานข้อมูลเลย
  */
  it('อนุมัติแล้วผ่าน', () => {
    const outcome = validateTransition(
      needsApproval,
      ctx({ currentStatusId: STATUS.new.id, approval: 'approved' }),
    );
    expect(outcome.toStatusId).toBe(STATUS.investigating.id);
  });

  it('**ยังไม่ได้ขอ กับ ถูกปฏิเสธ ต้องได้ข้อความคนละอย่าง**', () => {
    /*
      สองสถานะนี้ผู้ใช้ต้องทำคนละอย่าง: อย่างแรกไปกดขออนุมัติ
      อย่างหลังต้องแก้เรื่องก่อนแล้วค่อยขอใหม่ · ข้อความเดียวกันทำให้
      คนที่ถูกปฏิเสธไปกดขอซ้ำแล้วโดนปฏิเสธซ้ำโดยไม่รู้ว่าทำไม
    */
    const messageFor = (approval: 'none' | 'pending' | 'rejected'): string => {
      try {
        validateTransition(needsApproval, ctx({ currentStatusId: STATUS.new.id, approval }));
        return 'ผ่าน';
      } catch (e) {
        return (e as ValidationFailedError).missingFields.join(' ');
      }
    };
    const none = messageFor('none');
    const pending = messageFor('pending');
    const rejected = messageFor('rejected');
    expect(none).toContain('ยังไม่ได้ขออนุมัติ');
    expect(pending).toContain('รออนุมัติอยู่');
    expect(rejected).toContain('ถูกปฏิเสธ');
    expect(new Set([none, pending, rejected]).size).toBe(3);
  });

  it('ไม่ส่ง approval มาเลย ถือว่ายังไม่ได้ขอ — ไม่ใช่ผ่าน', () => {
    // ค่าที่ไม่ครบต้องแปลว่า "ยังไม่ผ่าน" ไม่ใช่ "ผ่าน"
    // การเดาไปทางอนุญาตเมื่อข้อมูลไม่ครบ คือวิธีที่กลไกกันไว้รั่วบ่อยที่สุด
    expect(() =>
      validateTransition(needsApproval, ctx({ currentStatusId: STATUS.new.id })),
    ).toThrow(ValidationFailedError);
  });
});

describe('RULE_CATALOG · รายการที่หน้าจอเลือกได้ ต้องตรงกับกฎที่เอนจินรู้จักจริง', () => {
  /*
    รายการที่ดูแลด้วยมือคือรายการที่จะไม่ตรงกับความจริงในวันที่มีคนแก้แค่ฝั่งเดียว
    (บทเรียนเดียวกับ `UNENFORCED_PERMISSIONS` และเอกสารสถานะ)

    ถ้าเทสต์นี้แดง แปลว่าเพิ่มหรือลบกฎแล้วลืมแก้อีกฝั่ง — แก้รายการ ไม่ใช่แก้เทสต์
  */
  it('ตัวสแกนอ่านรายการเจอจริง — ไม่ใช่ผ่านเพราะทั้งสองฝั่งว่าง', () => {
    expect(RULE_CATALOG.length).toBeGreaterThan(5);
    expect(KNOWN_POST_FUNCTIONS.size).toBeGreaterThan(3);
  });

  it('**ทุกกฎในรายการ ต้องเป็นกฎที่เอนจินรันได้จริง**', () => {
    for (const e of RULE_CATALOG) {
      const t: TransitionDefinition = {
        id: 990n,
        name: 'ทดสอบ',
        fromStatusId: STATUS.new.id,
        toStatusId: STATUS.investigating.id,
        position: 1,
        rules: [{ kind: e.kind, ruleType: e.ruleType, config: {}, position: 1 }],
      };
      /*
        กฎที่เอนจินไม่รู้จักจะโยน UnknownRuleError · กฎที่รู้จักอาจโยน
        TransitionNotAllowedError หรือ ValidationFailedError ซึ่งแปลว่า
        "รันได้แต่ไม่ผ่าน" — เป็นคนละเรื่องกัน
      */
      try {
        validateTransition(t, ctx({ currentStatusId: STATUS.new.id }));
      } catch (err) {
        expect(
          (err as Error).name,
          `กฎ ${e.kind}/${e.ruleType} อยู่ในรายการแต่เอนจินไม่รู้จัก`,
        ).not.toBe('UnknownRuleError');
      }
    }
  });

  it('**ทุก POST_FUNCTION ที่เอนจินรู้จัก ต้องมีในรายการ** — ยกเว้นที่ยังไม่ได้ทำ', () => {
    // `notify` กับ `fire-webhook` ยังไม่มีโค้ดรันจริง จึงยังไม่ควรให้เลือกจากหน้าจอ
    // การให้เลือกกฎที่ตั้งแล้วไม่เกิดอะไรขึ้น คือการโกหกผู้ดูแล
    const notImplemented = new Set(['notify', 'fire-webhook']);
    const inCatalog = new Set(
      RULE_CATALOG.filter((e) => e.kind === 'POST_FUNCTION').map((e) => e.ruleType),
    );
    for (const fn of KNOWN_POST_FUNCTIONS) {
      if (notImplemented.has(fn)) {
        expect(inCatalog.has(fn), `${fn} ยังไม่ได้ทำ ต้องไม่อยู่ในรายการให้เลือก`).toBe(false);
        continue;
      }
      expect(inCatalog.has(fn), `${fn} เอนจินรู้จักแต่หน้าจอเลือกไม่ได้`).toBe(true);
    }
  });

  it('ไม่มีกฎซ้ำในรายการ', () => {
    const keys = RULE_CATALOG.map((e) => `${e.kind}/${e.ruleType}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('Workflow Engine · validator `children-done`', () => {
  const at = (children?: { total: number; done: number }): TransitionContext =>
    ctx({ currentStatusId: STATUS.new.id, ...(children === undefined ? {} : { children }) });

  it('ไม่มีงานย่อยเลย = ผ่าน', () => {
    // "นับแล้ว ไม่มี" ต่างจาก "ไม่ได้นับ" — อันนี้คืออันแรก
    expect(validateTransition(needsChildrenDone, at({ total: 0, done: 0 })).toStatusId).toBe(
      STATUS.resolved.id,
    );
  });

  it('งานย่อยเสร็จครบ = ผ่าน', () => {
    expect(validateTransition(needsChildrenDone, at({ total: 3, done: 3 })).toStatusId).toBe(
      STATUS.resolved.id,
    );
  });

  it('**ยังมีงานย่อยค้าง = ปฏิเสธ และบอกว่าเหลือกี่เรื่อง**', () => {
    /*
      เรื่องหลักที่ปิดได้ทั้งที่งานย่อยยังค้าง ทำให้รายงาน "ค้างอยู่" ตกงาน
      เหล่านั้นไปทั้งกอง — เพราะคนดูรายงานที่ระดับเรื่องหลัก และมันบอกว่าเสร็จแล้ว

      ข้อความต้องบอกจำนวน ไม่ใช่แค่ "ยังปิดไม่ได้" · คนที่เห็นตัวเลขรู้ทันที
      ว่าต้องไปตามอีกกี่ใบ
    */
    try {
      validateTransition(needsChildrenDone, at({ total: 5, done: 2 }));
      throw new Error('ต้องโยน');
    } catch (e) {
      expect(String(e)).toContain('3');
    }
  });

  it('**ผู้เรียกที่ไม่ได้นับมา ต้องถูกปฏิเสธ ไม่ใช่ปล่อยผ่าน**', () => {
    /*
      ถ้าตีความ `undefined` เป็น "ไม่มีงานย่อย" กฎนี้จะเงียบสนิทในวันที่มีใคร
      เพิ่มเส้นทางเรียกใหม่แล้วลืมนับ — และไม่มีอะไรบอกเลยว่ามันหยุดทำงาน
      (บทเรียนเดียวกับกลไกที่ไม่มีอะไรเรียกใช้)
    */
    expect(() => validateTransition(needsChildrenDone, at())).toThrow();
  });
});

// ============================================================

describe('validator · ความเสี่ยงของการเปลี่ยนแปลง', () => {
  const risk = (level: 'LOW' | 'MEDIUM' | 'HIGH', reasons: string[] = []): TransitionContext =>
    ctx({ currentStatusId: STATUS.new.id, changeRisk: { level, reasons } });

  it('ความเสี่ยงต่ำและปานกลางผ่าน', () => {
    expect(validateTransition(needsLowRisk, risk('LOW')).toStatusId).toBe(STATUS.investigating.id);
    expect(validateTransition(needsLowRisk, risk('MEDIUM')).toStatusId).toBe(
      STATUS.investigating.id,
    );
  });

  /**
   * **บอกเหตุผล ไม่ใช่บอกแค่ว่าเสี่ยงสูง** — คนกดต้องรู้ว่าต้องไปทำอะไร
   * ข้อความว่า "ความเสี่ยงสูง" เฉย ๆ ส่งคนไปหาหน้าจอที่ไม่มีปุ่มให้แก้
   */
  it('**เสี่ยงสูงถูกปฏิเสธ พร้อมเหตุผลที่ทำให้สูง**', () => {
    try {
      validateTransition(needsLowRisk, risk('HIGH', ['ยังไม่ได้ผูก CI']));
      throw new Error('ต้องโยน');
    } catch (e) {
      expect(String(e)).toContain('ยังไม่ได้ผูก CI');
    }
  });

  it('เสี่ยงสูงแต่ไม่มีเหตุผลมา ยังต้องบอกอะไรสักอย่าง', () => {
    try {
      validateTransition(needsLowRisk, risk('HIGH'));
      throw new Error('ต้องโยน');
    } catch (e) {
      expect(String(e)).toContain('ระดับสูง');
    }
  });

  /**
   * กติกาเดียวกับ `children-done` · ผู้เรียกที่ลืมประเมินต้องถูกปฏิเสธ
   * ไม่ใช่ปล่อยผ่าน — กฎที่เงียบเมื่อข้อมูลขาด คือกฎที่หายไปเองในวันที่
   * มีคนเพิ่มเส้นทางเรียกใหม่แล้วลืมส่งข้อมูล
   */
  it('**ผู้เรียกไม่ได้ส่งความเสี่ยงมา = ปฏิเสธ ไม่ใช่ปล่อยผ่าน**', () => {
    try {
      validateTransition(needsLowRisk, ctx({ currentStatusId: STATUS.new.id }));
      throw new Error('ต้องโยน');
    } catch (e) {
      expect(String(e)).toContain('ผู้เรียกไม่ได้ส่งมา');
    }
  });
});
