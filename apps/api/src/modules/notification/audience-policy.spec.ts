/**
 * ข้อกำหนดของ "ใครควรได้รับ" ที่ผู้ดูแลตั้งได้ — **เขียนก่อนโค้ด**
 *
 * เดิมบทบาทผู้รับ (ผู้แจ้ง · ผู้รับผิดชอบ · ทีม · ผู้เฝ้าดู · คนที่ถูกเรียกถึง)
 * เขียนตายอยู่ในโค้ดของแต่ละ service · สวิตช์ปิด/เปิด **ทั้งชนิด** ทำได้แล้ว
 * แต่ปิดเฉพาะบทบาทยังทำไม่ได้
 *
 * ## ทำไมต้องเขียนเทสต์ก่อน
 *
 * กฎที่นี่ตัดสินว่า **ใครจะไม่ได้รับ** ซึ่งพลาดแล้วเงียบทั้งสองทาง —
 * ส่งเกินคนเลิกอ่าน ส่งขาดผู้แจ้งถามแล้วไม่มีใครมาตอบ · ไม่มี error
 * ไม่มีอะไรแดง เกณฑ์เดียวกับเอนจินอีกสี่ตัว
 *
 * ## ความคิดหลัก: ปิดทุกบทบาท ≠ ปิดทั้งชนิด
 *
 * สองอย่างนี้ให้ผลเหมือนกันคือไม่มีใครได้รับ · แต่อย่างหนึ่ง**เห็นได้จาก
 * สวิตช์ของชนิดนั้น** อีกอย่างต้องไล่ดูบทบาททีละอันถึงจะรู้ · การตั้งค่าแบบหลัง
 * จึงถูกปฏิเสธตั้งแต่ตอนบันทึก ให้ไปปิดทั้งชนิดแทน
 */
import { describe, expect, it } from 'vitest';

import {
  ALWAYS_REACHED,
  AUDIENCE_ROLES,
  EmptyAudienceError,
  ROLES_OF_KIND,
  assertAudienceReachable,
  filterAudience,
  roleReaches,
  type AudienceRole,
  type AudienceRule,
} from './audience-policy';

const P1 = BigInt(1);
const P2 = BigInt(2);

function rule(
  role: AudienceRole,
  isEnabled: boolean,
  over: Partial<AudienceRule> = {},
): AudienceRule {
  return { kind: 'comment.added', role, projectId: null, isEnabled, ...over };
}

/** รายชื่อผู้รับแบบที่ `commentAudience` คืนออกมา */
function people(...roles: AudienceRole[]): Array<{ userId: bigint | null; reason: string }> {
  return roles.map((reason, i) => ({ userId: BigInt(i + 10), reason }));
}

// ============================================================

describe('ผู้รับ · A · ค่าปริยายและลำดับความสำคัญ', () => {
  it('ไม่มีกฎสักข้อ = ทุกบทบาทได้รับ', () => {
    for (const role of AUDIENCE_ROLES) {
      expect(roleReaches('comment.added', role, P1, [])).toBe(true);
    }
  });

  it('ปิดบทบาทหนึ่ง บทบาทนั้นไม่ได้รับ', () => {
    expect(roleReaches('comment.added', 'watcher', P1, [rule('watcher', false)])).toBe(false);
  });

  it('ปิดบทบาทหนึ่ง ไม่กระทบบทบาทอื่น', () => {
    const rules = [rule('watcher', false)];
    expect(roleReaches('comment.added', 'reporter', P1, rules)).toBe(true);
    expect(roleReaches('comment.added', 'assignee', P1, rules)).toBe(true);
  });

  it('กฎรวมของชนิดหนึ่งไม่มีผลข้ามไปอีกชนิด', () => {
    const rules = [rule('watcher', false, { kind: 'comment.added' })];
    expect(roleReaches('workitem.assigned', 'watcher', P1, rules)).toBe(true);
  });

  /**
   * เคสนี้เพิ่มเข้ามาเพราะด่านลบทีละบรรทัดจับได้
   *
   * ลบ `r.kind === kind` ออกจากการค้นกฎ**ที่ระบุโปรเจกต์** แล้วเทสต์ยังเขียว
   * — เคสข้างบนใช้แต่กฎรวม (`projectId: null`) จึงไม่เคยแตะสาขานั้นเลย ·
   * สองสาขาต้องมีเคสของตัวเอง ไม่ใช่เชื่อว่าเขียนเหมือนกันแล้วถูกเหมือนกัน
   */
  it('กฎของโปรเจกต์ในชนิดหนึ่ง ไม่มีผลข้ามไปอีกชนิด', () => {
    const rules = [rule('watcher', false, { kind: 'comment.added', projectId: P1 })];
    expect(roleReaches('workitem.assigned', 'watcher', P1, rules)).toBe(true);
  });

  /**
   * กฎที่ระบุโปรเจกต์ชนะกฎรวมเสมอ ไม่ว่าจะเปิดหรือปิด
   *
   * กติกาเดียวกับสวิตช์ของชนิด · การให้ "ปิดชนะเสมอ" ทำให้เขียนข้อยกเว้น
   * ไม่ได้เลย — ผู้ดูแลที่ปิดทั้งองค์กรแล้วเปิดเฉพาะโปรเจกต์เดียว
   * ตั้งใจอย่างนั้นจริง ๆ
   */
  it('กฎของโปรเจกต์ชนะกฎรวม เมื่อกฎโปรเจกต์เปิด', () => {
    const rules = [rule('watcher', false), rule('watcher', true, { projectId: P1 })];
    expect(roleReaches('comment.added', 'watcher', P1, rules)).toBe(true);
  });

  it('กฎของโปรเจกต์ชนะกฎรวม เมื่อกฎโปรเจกต์ปิด', () => {
    const rules = [rule('watcher', true), rule('watcher', false, { projectId: P1 })];
    expect(roleReaches('comment.added', 'watcher', P1, rules)).toBe(false);
  });

  it('กฎของโปรเจกต์อื่นไม่มีผลกับโปรเจกต์นี้', () => {
    const rules = [rule('watcher', false, { projectId: P2 })];
    expect(roleReaches('comment.added', 'watcher', P1, rules)).toBe(true);
  });
});

// ============================================================

describe('ผู้รับ · B · บทบาทที่ปิดไม่ได้', () => {
  /**
   * เกณฑ์เดียวกับ `ALWAYS_ON` ของชนิด: ปิดแล้ว **หน้าจอกลายเป็นคำโกหก**
   *
   * คนพิมพ์ `@ชื่อ` แล้วเห็นชื่อขึ้นเป็นลิงก์ คือคำสัญญาว่าอีกฝ่ายจะรู้ ·
   * ถ้าผู้ดูแลปิดได้ คำสัญญานั้นจะผิดโดยที่ทั้งคนพิมพ์และคนถูกเรียกไม่รู้ตัว
   */
  it('คนที่ถูกเรียกถึงได้รับเสมอ แม้กฎรวมสั่งปิด', () => {
    expect(roleReaches('comment.added', 'mention', P1, [rule('mention', false)])).toBe(true);
  });

  it('คนที่ถูกเรียกถึงได้รับเสมอ แม้กฎของโปรเจกต์สั่งปิด', () => {
    const rules = [rule('mention', false, { projectId: P1 })];
    expect(roleReaches('comment.added', 'mention', P1, rules)).toBe(true);
  });

  it('บทบาทที่ปิดไม่ได้ มีเฉพาะที่ประกาศไว้ ไม่ใช่ทุกตัว', () => {
    expect(ALWAYS_REACHED.length).toBeGreaterThan(0);
    expect(ALWAYS_REACHED.length).toBeLessThan(AUDIENCE_ROLES.length);
  });

  it('บทบาทที่ไม่ได้อยู่ในรายการปิดไม่ได้ ต้องปิดได้จริง', () => {
    for (const role of AUDIENCE_ROLES.filter((r) => !ALWAYS_REACHED.includes(r))) {
      expect(roleReaches('comment.added', role, P1, [rule(role, false)]), role).toBe(false);
    }
  });
});

// ============================================================

describe('ผู้รับ · C · การกรองรายชื่อ', () => {
  it('กรองเฉพาะบทบาทที่ถูกปิด', () => {
    const list = people('reporter', 'watcher', 'assignee');
    const out = filterAudience(list, 'comment.added', P1, [rule('watcher', false)]);
    expect(out.map((r) => r.reason)).toEqual(['reporter', 'assignee']);
  });

  it('รักษาลำดับเดิม — ลำดับมีความหมาย (การเรียกถึงมาก่อน)', () => {
    const list = people('mention', 'reporter', 'assignee');
    const out = filterAudience(list, 'comment.added', P1, []);
    expect(out.map((r) => r.reason)).toEqual(['mention', 'reporter', 'assignee']);
  });

  it('ไม่แก้รายการที่รับเข้ามา', () => {
    const list = people('reporter', 'watcher');
    const snapshot = JSON.parse(JSON.stringify(list, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))) as unknown;
    filterAudience(list, 'comment.added', P1, [rule('watcher', false)]);
    expect(
      JSON.parse(JSON.stringify(list, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))),
    ).toEqual(snapshot);
  });

  it('รายการว่างคืนรายการว่าง ไม่ใช่ error', () => {
    expect(filterAudience([], 'comment.added', P1, [])).toEqual([]);
  });

  /**
   * บทบาทที่ระบบไม่รู้จัก **ผ่าน** ไม่ใช่ถูกตัดทิ้ง
   *
   * ตรงข้ามกับการ์ดบนแดชบอร์ดที่ชนิดไม่รู้จักแล้วถูกตัด — เพราะที่นี่
   * ผลของการตัดคือ **คนไม่ได้รับข่าว** ส่วนผลของการปล่อยผ่านคือได้รับเกิน
   * · เมื่อไม่แน่ใจ ให้พลาดไปทางที่แก้ได้ด้วยการบอกกัน ไม่ใช่ทางที่เงียบ
   */
  it('บทบาทที่ระบบไม่รู้จักยังได้รับ ไม่ถูกตัดเงียบ', () => {
    const list = [{ userId: BigInt(9), reason: 'บทบาทจากรุ่นหน้า' }];
    expect(filterAudience(list, 'comment.added', P1, [])).toHaveLength(1);
  });

  it('ผู้รับระดับทีม (ยังไม่ระบุตัวคน) ปิดได้เหมือนบทบาทอื่น', () => {
    const list = [{ userId: null, reason: 'team' }];
    expect(filterAudience(list, 'comment.added', P1, [rule('team', false)])).toEqual([]);
  });
});

// ============================================================

describe('ผู้รับ · D · ปิดทุกบทบาท ≠ ปิดทั้งชนิด', () => {
  const closable = AUDIENCE_ROLES.filter((r) => !ALWAYS_REACHED.includes(r));

  it('ปิดครบทุกบทบาทของชนิดหนึ่ง ถูกปฏิเสธตอนบันทึก', () => {
    const rules = closable.map((r) => rule(r, false, { kind: 'workitem.assigned' }));
    expect(() => {
      assertAudienceReachable('workitem.assigned', closable, P1, rules);
    }).toThrow(EmptyAudienceError);
  });

  it('เหลือเปิดไว้อย่างน้อยหนึ่งบทบาท ผ่าน', () => {
    const rules = closable.slice(1).map((r) => rule(r, false, { kind: 'workitem.assigned' }));
    expect(() => {
      assertAudienceReachable('workitem.assigned', closable, P1, rules);
    }).not.toThrow();
  });

  /** ชนิดที่มีบทบาทซึ่งปิดไม่ได้ ไม่มีวันไม่มีผู้รับ */
  it('ชนิดที่มีบทบาทปิดไม่ได้อยู่ด้วย ไม่ถูกปฏิเสธ', () => {
    const all = [...AUDIENCE_ROLES];
    const rules = all.map((r) => rule(r, false, { kind: 'comment.added' }));
    expect(() => {
      assertAudienceReachable('comment.added', all, P1, rules);
    }).not.toThrow();
  });

  it('ข้อความบอกทางออกที่ถูกต้อง ไม่ใช่แค่บอกว่าผิด', () => {
    const rules = closable.map((r) => rule(r, false, { kind: 'workitem.assigned' }));
    try {
      assertAudienceReachable('workitem.assigned', closable, P1, rules);
      throw new Error('ควรโยน error');
    } catch (e) {
      expect((e as Error).message).toContain('ปิดทั้งชนิด');
    }
  });

  it('ปิดเฉพาะโปรเจกต์เดียวจนหมด ก็ถูกปฏิเสธ — ความเงียบไม่ได้เบาลงเพราะขอบเขตแคบ', () => {
    const rules = closable.map((r) => rule(r, false, { kind: 'workitem.assigned', projectId: P1 }));
    expect(() => {
      assertAudienceReachable('workitem.assigned', closable, P1, rules);
    }).toThrow(EmptyAudienceError);
  });

  it('ไม่มีกฎเลย ผ่านเสมอ', () => {
    expect(() => {
      assertAudienceReachable('workitem.assigned', closable, P1, []);
    }).not.toThrow();
  });
});

// ============================================================

describe('ผู้รับ · E · รายการบทบาทตรงกับที่โค้ดใช้จริง', () => {
  /**
   * ด่านที่จับ "รายการที่คนดูแลด้วยมือ"
   *
   * ถ้ามีใครเพิ่ม `reason` ใหม่ใน `commentAudience` แล้วลืมเพิ่มที่นี่
   * บทบาทนั้นจะปิดไม่ได้ตลอดกาล และหน้าตั้งค่าจะไม่แสดงมัน —
   * ผู้ดูแลจะเชื่อว่าตั้งครบแล้วทั้งที่มีทางลอดอยู่
   */
  it('ทุกบทบาทใน AUDIENCE_ROLES ไม่ซ้ำกัน', () => {
    expect(new Set(AUDIENCE_ROLES).size).toBe(AUDIENCE_ROLES.length);
  });

  it('ทุกบทบาทที่ปิดไม่ได้ ต้องอยู่ใน AUDIENCE_ROLES ด้วย', () => {
    for (const r of ALWAYS_REACHED) {
      expect(AUDIENCE_ROLES).toContain(r);
    }
  });
});

// ============================================================

describe('ผู้รับ · F · ชนิดไหนแจ้งบทบาทไหน', () => {
  /**
   * ด่านที่จับ "ด่านที่ไม่มีวันทำงาน"
   *
   * ตอนแรกส่ง `AUDIENCE_ROLES` ทั้งชุดเข้า `assertAudienceReachable` ซึ่งรวม
   * `mention` ที่ปิดไม่ได้ — ด่าน "ห้ามปิดจนไม่เหลือใคร" จึงผ่านตลอดกาล
   * และเทสต์ต่อฐานข้อมูลเป็นตัวจับได้ ไม่ใช่เทสต์บริสุทธิ์
   */
  it('ทุกบทบาทในแผนที่ต้องอยู่ใน AUDIENCE_ROLES', () => {
    for (const [kind, roles] of Object.entries(ROLES_OF_KIND)) {
      for (const r of roles) {
        expect(AUDIENCE_ROLES, `${kind} อ้างบทบาทที่ไม่มีจริง`).toContain(r);
      }
    }
  });

  it('อย่างน้อยหนึ่งชนิดต้องปิดได้จนหมด มิฉะนั้นด่านไม่มีวันทำงาน', () => {
    const canRunOut = Object.entries(ROLES_OF_KIND).filter(([, roles]) =>
      roles.every((r) => !ALWAYS_REACHED.includes(r)),
    );
    expect(canRunOut.length).toBeGreaterThan(0);
  });

  it('ชนิดที่ปิดได้จนหมด ถูกปฏิเสธจริงเมื่อปิดครบ', () => {
    for (const [kind, roles] of Object.entries(ROLES_OF_KIND)) {
      if (roles.some((r) => ALWAYS_REACHED.includes(r))) continue;
      const rules = roles.map((role) => rule(role, false, { kind }));
      expect(() => {
        assertAudienceReachable(kind, roles, P1, rules);
      }, kind).toThrow(EmptyAudienceError);
    }
  });

  it('ชนิดที่มีบทบาทปิดไม่ได้ ไม่ถูกปฏิเสธ', () => {
    for (const [kind, roles] of Object.entries(ROLES_OF_KIND)) {
      if (!roles.some((r) => ALWAYS_REACHED.includes(r))) continue;
      const rules = roles.map((role) => rule(role, false, { kind }));
      expect(() => {
        assertAudienceReachable(kind, roles, P1, rules);
      }, kind).not.toThrow();
    }
  });
});
