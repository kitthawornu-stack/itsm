/**
 * Automation Engine — Trigger → Condition → Action
 *
 * เอนจินตัวที่ห้าของโครงการ ต่อจาก workflow · SLA · HQL · LexoRank ·
 * มีลักษณะเดียวกันทุกประการ: **ความผิดพลาดไม่ทำให้ระบบพัง แต่ทำให้ระบบ
 * ทำสิ่งที่ไม่มีใครสั่งอย่างเงียบ ๆ** — และของแบบนั้นหาสาเหตุยากที่สุด
 *
 * เป็นฟังก์ชันบริสุทธิ์ล้วน · ไม่อ่านฐานข้อมูล ไม่อ่านนาฬิกา ไม่ส่งอะไรออกไป
 * มันแค่ตอบว่า "เหตุการณ์นี้ กับกฎชุดนี้ ควรทำอะไรบ้าง" · การลงมือทำอยู่ที่
 * `automation.service` (กติกาเดียวกับ SLA Engine ที่ห้ามอ่านนาฬิกาเอง)
 *
 * ## กับดักที่ใหญ่ที่สุดคือกฎที่ปลุกตัวเอง
 *
 * กฎที่ทำงานเมื่อ "สถานะเปลี่ยน" แล้วสั่ง "เปลี่ยนสถานะ" จะปลุกตัวเองไม่รู้จบ ·
 * ไม่มี error ไม่มีอะไรพัง — แค่ตั๋วใบเดียวสร้างประวัติหลักพันแถวในไม่กี่วินาที
 * และคนที่มาดูจะเห็นแค่ "ระบบทำงานอยู่"
 *
 * เอนจินจึงรับ `depth` มาด้วย และ **ปฏิเสธตัวเองที่ระดับที่กำหนด**
 * ผู้เรียกเป็นคนนับ ไม่ใช่เอนจินจำเอง — เอนจินที่จำสถานะข้ามการเรียก
 * ไม่ใช่ฟังก์ชันบริสุทธิ์อีกต่อไป และทดสอบเคสวนไม่ได้
 */

/** เหตุการณ์ที่ปลุกกฎได้ */
export type TriggerKind =
  | 'item.created'
  | 'item.transitioned'
  | 'comment.added'
  | 'sla.breached'
  /**
   * ไม่มีความเคลื่อนไหวมานาน
   *
   * ต่างจากอีกสี่ตัวตรงที่ **ไม่มีใครทำอะไรให้มันเกิด** — มันเกิดจากการที่
   * ไม่มีอะไรเกิดขึ้น · จึงต้องมีคนไล่กวาดหาเป็นรอบ ไม่ใช่รอให้ถูกปลุก
   * (ดู `automation-scan.ts`) และเวลา "ตอนนี้" ต้องส่งเข้ามา ไม่ใช่ให้เอนจินอ่านเอง
   */
  | 'item.idle';

export const TRIGGERS: readonly TriggerKind[] = [
  'item.created',
  'item.transitioned',
  'comment.added',
  'sla.breached',
  'item.idle',
];

/**
 * ความลึกสูงสุดของการปลุกต่อกัน
 *
 * 3 ไม่ใช่ตัวเลขที่เดา — กฎที่ตั้งใจต่อกันจริง ๆ ในระบบแจ้งปัญหามีแบบเดียว:
 * "เปิดเรื่อง → มอบหมาย → แจ้งเตือน" ซึ่งลึก 2 ชั้น · ชั้นที่ 3 เผื่อไว้
 * ให้กฎที่ผู้ดูแลเขียนเองต่ออีกหนึ่ง · ลึกกว่านั้นคือวน ไม่ใช่เจตนา
 */
export const MAX_DEPTH = 3;

export interface AutomationEvent {
  kind: TriggerKind;
  /** ค่าของงาน ณ เวลาที่เหตุการณ์เกิด — ไม่ใช่ค่าที่อ่านใหม่ตอนกฎทำงาน */
  item: {
    itemKey: string;
    projectKey: string;
    issueTypeName: string;
    statusName: string;
    statusCategory: string;
    priorityRank: number | null;
    assigneeId: string | null;
    labels: readonly string[];
  };
  /** ชื่อ transition ที่เพิ่งกด — มีเฉพาะ `item.transitioned` */
  transitionName?: string;
  /**
   * จำนวนวันที่ไม่มีความเคลื่อนไหว — มีเฉพาะ `item.idle`
   *
   * ผู้เรียกคำนวณให้ จากเวลา "ตอนนี้" ที่มันถือไว้ · เอนจินไม่อ่านนาฬิกาเอง
   * (กติกาเดียวกับ SLA Engine) มิฉะนั้นทดสอบเคสข้ามสัปดาห์ต้องรอจริง
   */
  idleDays?: number;
  /** คนที่ทำให้เหตุการณ์นี้เกิด — กฎไม่ควรตอบกลับการกระทำของตัวมันเอง */
  actorId: string | null;
  /** ชั้นของการปลุกต่อกัน — ผู้เรียกเป็นคนนับ */
  depth: number;
}

/** เงื่อนไขหนึ่งข้อ — ทุกข้อต้องเป็นจริงพร้อมกัน */
export interface Condition {
  field:
    | 'project'
    | 'type'
    | 'status'
    | 'category'
    | 'priority'
    | 'label'
    | 'transition'
    | 'unassigned'
    /** จำนวนวันที่ไม่มีความเคลื่อนไหว — มีค่าเฉพาะเหตุการณ์ `item.idle` */
    | 'idleDays';
  /**
   * `is` = เท่ากับ · `is-not` = ไม่เท่ากับ · `has` = มีอยู่ในรายการ ·
   * `at-least` = มากกว่าหรือเท่ากับ (ตัวเลขเท่านั้น)
   *
   * **`at-least` มีไว้เพราะ `is` ผิดสำหรับจำนวนวัน** — "ไม่มีใครตอบมา 2 วัน"
   * ที่เขียนด้วย `is` จะทำงานเฉพาะวันที่ 2 พอดี แล้วเงียบตั้งแต่วันที่ 3
   * เป็นต้นไป ซึ่งกลับความหมายของกฎทั้งข้อโดยไม่มีอะไรฟ้อง
   */
  op: 'is' | 'is-not' | 'has' | 'at-least';
  value: string;
}

export interface Action {
  kind: 'assign' | 'add-label' | 'comment' | 'transition';
  value: string;
}

export interface Rule {
  id: string;
  name: string;
  trigger: TriggerKind;
  isEnabled: boolean;
  conditions: readonly Condition[];
  actions: readonly Action[];
}

export interface PlannedAction extends Action {
  ruleId: string;
  ruleName: string;
}

export class TooDeepError extends Error {
  constructor(readonly depth: number) {
    super(
      `กฎอัตโนมัติปลุกกันต่อลึกเกิน ${String(MAX_DEPTH)} ชั้น (ชั้นที่ ${String(depth)}) — ` +
        'หยุดไว้เพื่อกันวนไม่จบ',
    );
    this.name = 'TooDeepError';
  }
}

/** ค่าของฟิลด์ที่เงื่อนไขอ้างถึง — `null` = ไม่มีค่า ซึ่งต่างจากค่าว่าง */
function valueOf(c: Condition, e: AutomationEvent): string | readonly string[] | null {
  switch (c.field) {
    case 'project':
      return e.item.projectKey;
    case 'type':
      return e.item.issueTypeName;
    case 'status':
      return e.item.statusName;
    case 'category':
      return e.item.statusCategory;
    case 'priority':
      return e.item.priorityRank === null ? null : String(e.item.priorityRank);
    case 'label':
      return e.item.labels;
    case 'transition':
      return e.transitionName ?? null;
    case 'unassigned':
      return e.item.assigneeId === null ? 'true' : 'false';
    case 'idleDays':
      // เหตุการณ์ชนิดอื่นไม่มีค่านี้ — `null` ไม่ใช่ 0 · 0 แปลว่า "เพิ่งขยับ"
      // ซึ่งเป็นคำตอบคนละข้อกับ "คำถามนี้ใช้กับเหตุการณ์นี้ไม่ได้"
      return e.idleDays === undefined ? null : String(e.idleDays);
  }
}

/**
 * เงื่อนไขข้อเดียว
 *
 * **ค่าที่ไม่มี ต้องไม่ผ่านเงื่อนไข `is`** — ตั๋วที่ยังไม่ได้ตั้งความสำคัญ
 * ไม่ควรถูกนับว่า "ความสำคัญเท่ากับอะไรก็ได้" · แต่ `is-not` ผ่าน
 * เพราะ "ไม่ใช่ P1" เป็นจริงสำหรับตั๋วที่ไม่มีความสำคัญ
 */
export function matches(c: Condition, e: AutomationEvent): boolean {
  const actual = valueOf(c, e);

  if (c.op === 'at-least') {
    /*
      ตัวเลขทั้งสองฝั่งเท่านั้น · ฝั่งไหนไม่ใช่ตัวเลขคือกฎที่เขียนผิด ไม่ใช่กฎที่ไม่ตรง
      — "โปรเจกต์ at-least SD" หรือ "at-least สองวัน" อ่านเข้าใจได้สำหรับคน
      แต่เทียบไม่ได้ · การปล่อยผ่านทำให้กฎทำงานทุกใบ ซึ่งตรงข้ามกับเจตนา
    */
    const left = typeof actual === 'string' && actual.trim() !== '' ? Number(actual) : NaN;
    const right = c.value.trim() === '' ? NaN : Number(c.value);
    /*
      **ไม่มี `if (!Number.isFinite(...)) return false;` โดยตั้งใจ**

      เคยเขียนไว้ แล้วรอบพิสูจน์ว่าเทสต์แดงได้จับว่า ลบทั้งบรรทัดทิ้งก็ยังเขียว
      ทั้ง 30 เคส — เพราะ `NaN >= x` และ `x >= NaN` เป็น false อยู่แล้วทั้งคู่
      บรรทัดนั้นจึงไม่เคยเปลี่ยนผลอะไรเลย เป็นโค้ดตายที่อ่านเหมือนเป็นด่าน

      การเก็บด่านที่ลบแล้วยังเขียวไว้ อันตรายกว่าไม่มี เพราะคนอ่านจะเชื่อว่า
      มีอะไรกันอยู่ · สิ่งที่กันจริงคือ `left`/`right` ที่กลายเป็น `NaN`
      ตั้งแต่สองบรรทัดข้างบน ซึ่งมีเทสต์คุ้มครบทุกทาง (หมวด G)
    */
    return left >= right;
  }

  if (c.op === 'has') {
    // `has` ใช้กับรายการเท่านั้น — ใช้กับค่าเดี่ยวคือกฎที่เขียนผิด ไม่ใช่กฎที่ไม่ตรง
    return Array.isArray(actual) ? actual.includes(c.value) : false;
  }

  if (Array.isArray(actual)) {
    // `is` กับรายการ = รายการนั้นมีค่านี้ค่าเดียว · เขียนแบบนี้แทบไม่มีใครตั้งใจ
    return c.op === 'is'
      ? actual.length === 1 && actual[0] === c.value
      : !actual.includes(c.value);
  }

  const v = actual as string | null;
  if (v === null) return c.op === 'is-not';
  return c.op === 'is' ? v === c.value : v !== c.value;
}

/**
 * กฎข้อเดียวเข้าเงื่อนไขไหม
 *
 * **กฎที่ไม่มีเงื่อนไขเลย ทำงานกับทุกเหตุการณ์ของ trigger นั้น** — ไม่ใช่
 * ไม่ทำงาน · เป็นเจตนาที่อ่านง่ายกว่า และผู้ดูแลที่ลืมใส่เงื่อนไขจะเห็นผล
 * ทันทีแทนที่จะสงสัยว่าทำไมกฎเงียบ
 */
export function ruleApplies(rule: Rule, e: AutomationEvent): boolean {
  if (!rule.isEnabled) return false;
  if (rule.trigger !== e.kind) return false;
  return rule.conditions.every((c) => matches(c, e));
}

/**
 * วางแผนว่าเหตุการณ์นี้ควรทำอะไรบ้าง
 *
 * คืนรายการการกระทำพร้อมชื่อกฎที่สั่ง — **ชื่อกฎต้องติดไปด้วยเสมอ**
 * เพราะคำถามแรกของคนที่เจอตั๋วถูกมอบหมายเองคือ "ใครสั่ง" และคำตอบ
 * "ระบบทำเอง" ไม่ช่วยอะไรเลย
 *
 * ลำดับของกฎคือลำดับที่ส่งเข้ามา · ผู้เรียกเรียงตามที่ผู้ดูแลตั้งไว้
 */
export function plan(rules: readonly Rule[], e: AutomationEvent): PlannedAction[] {
  if (e.depth > MAX_DEPTH) throw new TooDeepError(e.depth);

  const out: PlannedAction[] = [];
  for (const rule of rules) {
    if (!ruleApplies(rule, e)) continue;
    for (const a of rule.actions) {
      out.push({ ...a, ruleId: rule.id, ruleName: rule.name });
    }
  }
  return out;
}

/**
 * รายการชนิดของเงื่อนไขและการกระทำที่หน้าจอเลือกได้
 *
 * ประกาศข้างเดียวกับตัวที่ทำงานจริง เพื่อให้เพิ่มชนิดใหม่แล้วลืมเพิ่มที่นี่
 * ไม่ได้ — เทสต์เทียบสองฝั่งให้ (กติกาเดียวกับ `RULE_CATALOG` ของ workflow)
 */
export const CONDITION_OPS: readonly Condition['op'][] = ['is', 'is-not', 'has', 'at-least'];

export const CONDITION_FIELDS: readonly Condition['field'][] = [
  'project',
  'type',
  'status',
  'category',
  'priority',
  'label',
  'transition',
  'unassigned',
  'idleDays',
];

/*
  ไม่มี `notify-group` ในรายการนี้ **โดยตั้งใจ** — โมดูล notification ยังไม่
  export อะไรให้เรียก · ชนิดที่หน้าจอให้เลือกได้แต่ไม่มีโค้ดเส้นไหนทำ คือกับดัก
  เดียวกับสิทธิ์ที่ให้แล้วไม่มีผล (CLAUDE.md §8): ผู้ดูแลจะเชื่อว่าตั้งค่าเรียบร้อย
  แล้วจากสิ่งที่หน้าจอบอก · เพิ่มกลับเมื่อมีตัวทำจริง แล้วเทสต์เทียบสองฝั่งจะบังคับเอง
*/
export const ACTION_KINDS: readonly Action['kind'][] = [
  'assign',
  'add-label',
  'comment',
  'transition',
];
