/**
 * Workflow Engine — state machine ที่นิยามอยู่ในฐานข้อมูล ไม่ใช่ในโค้ด
 *
 * transition หนึ่งเส้นมีสามชั้น ตามลำดับนี้เท่านั้น:
 *   1. CONDITION      ใครเห็นปุ่มนี้        ไม่ผ่าน = ปุ่มไม่ปรากฏเลย
 *   2. VALIDATOR      กรอกครบไหม           ไม่ผ่าน = ปุ่มยังเห็น แต่กดแล้วถูกปฏิเสธพร้อมเหตุผล
 *   3. POST_FUNCTION  ทำอะไรต่อหลังผ่าน    รันในทรานแซกชันเดียวกับการเปลี่ยนสถานะ
 *
 * ความต่างระหว่างชั้น 1 กับ 2 เป็นเรื่องของประสบการณ์ผู้ใช้ที่สำคัญ:
 * ถ้าเอา required-field ไปไว้ใน CONDITION ผู้ใช้จะเห็นปุ่มหายไปโดยไม่รู้สาเหตุ
 * ถ้าเอา permission ไปไว้ใน VALIDATOR ผู้ใช้ที่ไม่มีสิทธิ์จะรู้ว่าระบบต้องการฟิลด์อะไร
 *
 * โมดูลนี้เป็น pure function ทั้งหมด — ไม่แตะฐานข้อมูล ไม่มี side effect
 * จึงทดสอบเคสขอบได้ครบโดยไม่ต้องตั้ง fixture (ดู workflow-engine.spec.ts)
 */

export type RuleKind = 'CONDITION' | 'VALIDATOR' | 'POST_FUNCTION';

export interface TransitionRule {
  kind: RuleKind;
  ruleType: string;
  config: Record<string, unknown>;
  position: number;
}

export interface TransitionDefinition {
  id: bigint;
  name: string;
  /** null = global transition ทำได้จากทุกสถานะ */
  fromStatusId: bigint | null;
  toStatusId: bigint;
  position: number;
  rules: TransitionRule[];
}

export interface TransitionContext {
  currentUserId: bigint;
  currentStatusId: bigint;
  assigneeId: bigint | null;
  userGroupIds: bigint[];
  /** ค่าฟิลด์ปัจจุบันของ work item รวมทั้ง built-in และ custom field */
  fields: Record<string, unknown>;
  /**
   * สถานะการอนุมัติล่าสุดของงานใบนี้
   *
   * ส่งเข้ามาจากผู้เรียก ไม่ให้เอนจินไปอ่านเอง — เอนจินต้องเป็นฟังก์ชันบริสุทธิ์
   * ทดสอบได้โดยไม่ต้องมีฐานข้อมูล (กติกาเดียวกับที่ห้ามอ่านนาฬิกาเองใน SLA Engine)
   *
   * `none` = ยังไม่เคยขออนุมัติเลย · ต่างจาก `rejected` ซึ่งขอแล้วถูกปฏิเสธ
   */
  approval?: 'none' | 'pending' | 'approved' | 'rejected';
}

export interface TransitionOutcome {
  transitionId: bigint;
  toStatusId: bigint;
  postFunctions: TransitionRule[];
}

// ============================================================
// Errors
// ============================================================

export class TransitionNotAllowedError extends Error {
  constructor(
    readonly transitionName: string,
    readonly reason: string,
  ) {
    super(`ไม่สามารถทำ "${transitionName}" ได้: ${reason}`);
    this.name = 'TransitionNotAllowedError';
  }
}

export class ValidationFailedError extends Error {
  constructor(
    readonly transitionName: string,
    readonly missingFields: string[],
  ) {
    super(
      `ทำ "${transitionName}" ไม่ได้ เพราะยังไม่ได้กรอก: ${missingFields.join(', ')}`,
    );
    this.name = 'ValidationFailedError';
  }
}

export class UnknownRuleError extends Error {
  constructor(kind: RuleKind, ruleType: string) {
    super(
      `กฎที่ระบบไม่รู้จัก: ${kind}/${ruleType} — ` +
        `ปฏิเสธ transition ไว้ก่อนเพื่อความปลอดภัย ` +
        `(ถ้าข้ามไป สิทธิ์จะเปิดกว้างกว่าที่แอดมินตั้งใจ)`,
    );
    this.name = 'UnknownRuleError';
  }
}

// ============================================================
// CONDITION — ใครเห็นปุ่มนี้
// ============================================================

type ConditionFn = (config: Record<string, unknown>, ctx: TransitionContext) => boolean;

function toBigIntList(value: unknown): bigint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (typeof v === 'bigint') return v;
      if (typeof v === 'number' || typeof v === 'string') {
        try {
          return BigInt(v);
        } catch {
          return null;
        }
      }
      return null;
    })
    .filter((v): v is bigint => v !== null);
}

const CONDITIONS: Record<string, ConditionFn> = {
  /** ผู้กดต้องเป็นผู้รับผิดชอบงานนั้น */
  'assignee-is-current-user': (_config, ctx) =>
    ctx.assigneeId !== null && ctx.assigneeId === ctx.currentUserId,

  /** ผู้กดต้องอยู่ในกลุ่มใดกลุ่มหนึ่งที่กำหนด */
  'in-group': (config, ctx) => {
    const required = toBigIntList(config['groupIds']);
    if (required.length === 0) return false;
    return required.some((g) => ctx.userGroupIds.includes(g));
  },

  /** งานต้องมีผู้รับผิดชอบแล้ว */
  'has-assignee': (_config, ctx) => ctx.assigneeId !== null,

  /** งานต้องยังไม่มีผู้รับผิดชอบ (เช่น ปุ่ม "รับงานนี้") */
  'is-unassigned': (_config, ctx) => ctx.assigneeId === null,
};

// ============================================================
// VALIDATOR — กรอกครบไหม
// ============================================================

/**
 * ค่าที่ถือว่า "ยังไม่กรอก"
 *
 * ระวัง: 0 และ false **ถือว่ากรอกแล้ว** — การใช้ falsy check ตรง ๆ ที่นี่
 * เป็นบั๊กคลาสสิกที่ทำให้ฟิลด์ตัวเลขที่มีค่า 0 ถูกมองว่าว่าง
 */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

type ValidatorFn = (
  config: Record<string, unknown>,
  ctx: TransitionContext,
) => { ok: true } | { ok: false; missingFields: string[] };

const VALIDATORS: Record<string, ValidatorFn> = {
  /**
   * ต้องได้รับอนุมัติก่อนจึงจะกดปุ่มนี้ได้
   *
   * เป็นฟังก์ชันบริสุทธิ์เหมือนกฎอื่นทุกตัว — สถานะการอนุมัติถูกส่งเข้ามาใน
   * context ไม่ใช่ให้เอนจินไปอ่านฐานข้อมูลเอง
   *
   * **แยก "ยังไม่ได้ขอ" ออกจาก "ถูกปฏิเสธ"** เพราะสองอย่างนี้ผู้ใช้ต้องทำ
   * คนละอย่าง: อย่างแรกไปกดขออนุมัติ อย่างหลังต้องแก้เรื่องก่อนแล้วขอใหม่
   */
  'require-approval': (_config, ctx) => {
    const state = ctx.approval ?? 'none';
    if (state === 'approved') return { ok: true };
    const reason =
      state === 'pending'
        ? 'รออนุมัติอยู่'
        : state === 'rejected'
          ? 'คำขออนุมัติถูกปฏิเสธ'
          : 'ยังไม่ได้ขออนุมัติ';
    return { ok: false, missingFields: [`การอนุมัติ (${reason})`] };
  },

  /** ฟิลด์ที่ระบุต้องมีค่าครบทุกตัว — รายงานที่ขาดทั้งหมดในครั้งเดียว */
  'required-fields': (config, ctx) => {
    const required = Array.isArray(config['fields'])
      ? (config['fields'] as unknown[]).filter((f): f is string => typeof f === 'string')
      : [];
    const missing = required.filter((f) => isEmpty(ctx.fields[f]));
    return missing.length === 0 ? { ok: true } : { ok: false, missingFields: missing };
  },
};

// ============================================================
// POST_FUNCTION — ชื่อที่รองรับ (การรันจริงอยู่ใน workflow.service)
// ============================================================

/**
 * รายการกฎที่ **หน้าจอเลือกได้** พร้อมคำอธิบายภาษาคน
 *
 * ประกาศไว้ข้างเดียวกับตัวกฎจริง เพื่อให้เพิ่มกฎใหม่แล้วลืมเพิ่มที่นี่ไม่ได้ —
 * `workflow-engine.spec.ts` เทียบสองฝั่งให้ · รายการที่ดูแลด้วยมือแยกไฟล์
 * คือรายการที่จะไม่ตรงกับความจริงในวันที่มีคนแก้แค่ฝั่งเดียว
 *
 * `needsConfig` บอกหน้าจอว่ากฎนี้ต้องกรอกอะไรเพิ่ม — กฎที่ต้องมี config
 * แต่ไม่ได้กรอก จะกลายเป็นกฎที่ไม่ทำอะไรเลยหรือกันทุกคนออก
 */
export interface RuleCatalogEntry {
  kind: RuleKind;
  ruleType: string;
  label: string;
  hint: string;
  needsConfig: 'none' | 'fields' | 'groups' | 'goal';
}

export const RULE_CATALOG: readonly RuleCatalogEntry[] = [
  {
    kind: 'CONDITION',
    ruleType: 'assignee-is-current-user',
    label: 'เฉพาะผู้รับผิดชอบงานนี้',
    hint: 'คนอื่นจะไม่เห็นปุ่มนี้เลย',
    needsConfig: 'none',
  },
  {
    kind: 'CONDITION',
    ruleType: 'in-group',
    label: 'เฉพาะคนในกลุ่มที่กำหนด',
    hint: 'เลือกกลุ่มที่เห็นปุ่มนี้ได้',
    needsConfig: 'groups',
  },
  {
    kind: 'CONDITION',
    ruleType: 'has-assignee',
    label: 'ต้องมีผู้รับผิดชอบแล้ว',
    hint: 'งานที่ยังไม่มีคนรับ จะไม่เห็นปุ่มนี้',
    needsConfig: 'none',
  },
  {
    kind: 'CONDITION',
    ruleType: 'is-unassigned',
    label: 'ต้องยังไม่มีผู้รับผิดชอบ',
    hint: 'ใช้กับปุ่ม "รับงานนี้"',
    needsConfig: 'none',
  },
  {
    kind: 'VALIDATOR',
    ruleType: 'required-fields',
    label: 'ต้องกรอกฟิลด์ให้ครบ',
    hint: 'ระบุคีย์ฟิลด์ที่ต้องมีค่า',
    needsConfig: 'fields',
  },
  {
    kind: 'VALIDATOR',
    ruleType: 'require-approval',
    label: 'ต้องได้รับอนุมัติก่อน',
    hint: 'กดปุ่มนี้ไม่ได้จนกว่าคำขออนุมัติจะผ่าน',
    needsConfig: 'none',
  },
  {
    kind: 'POST_FUNCTION',
    ruleType: 'stop-sla',
    label: 'หยุดนาฬิกา SLA',
    hint: 'ใช้กับปุ่มที่ทำให้งานจบ',
    needsConfig: 'goal',
  },
  {
    kind: 'POST_FUNCTION',
    ruleType: 'start-sla',
    label: 'เริ่มนาฬิกา SLA',
    hint: '',
    needsConfig: 'goal',
  },
  {
    kind: 'POST_FUNCTION',
    ruleType: 'pause-sla',
    label: 'พักนาฬิกา SLA',
    hint: 'ใช้กับสถานะที่รอคนอื่นตอบ',
    needsConfig: 'goal',
  },
  {
    kind: 'POST_FUNCTION',
    ruleType: 'set-resolution',
    label: 'ตั้งผลการแก้ไข',
    hint: 'ผู้กดจะถูกถามว่าจบเรื่องนี้อย่างไร',
    needsConfig: 'none',
  },
  {
    kind: 'POST_FUNCTION',
    ruleType: 'assign-to-current-user',
    label: 'มอบหมายให้คนที่กด',
    hint: 'ใช้กับปุ่ม "รับงานนี้"',
    needsConfig: 'none',
  },
  {
    kind: 'POST_FUNCTION',
    ruleType: 'clear-assignee',
    label: 'ปลดผู้รับผิดชอบ',
    hint: 'คืนงานเข้ากอง',
    needsConfig: 'none',
  },
];

export const KNOWN_POST_FUNCTIONS = new Set([
  'stop-sla',
  'start-sla',
  'pause-sla',
  'set-resolution',
  'assign-to-current-user',
  'clear-assignee',
  'notify',
  'fire-webhook',
]);

// ============================================================
// API
// ============================================================

function appliesToCurrentStatus(t: TransitionDefinition, ctx: TransitionContext): boolean {
  return t.fromStatusId === null || t.fromStatusId === ctx.currentStatusId;
}

/**
 * สถานะของนาฬิกาที่ต้องบันทึกเมื่อสถานะงานเปลี่ยน
 *
 * `recompute` = ไม่มีเหตุการณ์ใหม่ แต่ยังต้องคำนวณใหม่ · ละข้อนี้แล้วนาฬิกาที่
 * เพิ่งเริ่มจะไม่เคยตั้งงานแจ้งเตือนเลย เพราะงานถูกตั้งตอนคำนวณใหม่เท่านั้น
 */
export type SlaEffect = 'stop' | 'reopen' | 'pause' | 'resume' | 'recompute';

export interface StatusShape {
  category: string;
  pausesSla: boolean;
}

/**
 * แปลงการเปลี่ยนสถานะเป็นเหตุการณ์ของนาฬิกา
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพราะตารางนี้คือที่ที่พลาดแล้วเงียบที่สุด:
 * เลือกผิดหนึ่งช่อง นาฬิกาก็เดินผิดไปทั้งใบโดยไม่มี error ให้เห็น
 * และเคสที่สำคัญที่สุด — ออกจากหมวด DONE — เคยไม่มีช่องของตัวเองเลย
 * มันตกไปที่ `recompute` ซึ่งคำนวณนาฬิกาที่ปิดไปแล้วใหม่ แล้วได้ "จบแล้ว"
 * เหมือนเดิมทุกครั้ง
 */
export function slaEffectOfTransition(
  from: StatusShape | null,
  to: StatusShape,
): SlaEffect {
  if (to.category === 'DONE') return 'stop';
  // ออกจาก DONE = เปิดใหม่ · ต้องมาก่อนการตรวจ pausesSla เพราะนาฬิกาที่ปิดแล้ว
  // ต้องถูกปลุกก่อน จะพักทีหลังก็เรื่องของรอบใหม่
  if (from?.category === 'DONE') return 'reopen';
  if (to.pausesSla && from?.pausesSla !== true) return 'pause';
  if (!to.pausesSla && from?.pausesSla === true) return 'resume';
  return 'recompute';
}

/**
 * ฟิลด์ที่ transition นี้จะเรียกร้องเมื่อกด
 *
 * หน้าจอต้องรู้ **ก่อน** กด ไม่ใช่รู้จากข้อความ error หลังกดแล้วถูกปฏิเสธ
 * — การให้ผู้ใช้กดปุ่มเพื่อค้นหาว่าระบบต้องการอะไร คือการใช้ข้อความผิดพลาด
 * แทนการออกแบบ
 *
 * อ่านจาก VALIDATOR เท่านั้น ไม่อ่าน CONDITION โดยเจตนา (ดูหัวไฟล์):
 * ผู้ใช้ที่ไม่ผ่าน CONDITION ต้องไม่เห็นปุ่มอยู่แล้ว และไม่ควรรู้ว่าระบบขออะไร
 */
export function requiredFieldsFor(t: TransitionDefinition): string[] {
  const fields = new Set<string>();
  for (const rule of t.rules) {
    if (rule.kind !== 'VALIDATOR' || rule.ruleType !== 'required-fields') continue;
    const list = rule.config['fields'];
    if (!Array.isArray(list)) continue;
    for (const f of list) if (typeof f === 'string' && f !== '') fields.add(f);
  }
  return [...fields];
}

/**
 * ตรวจ CONDITION ทุกข้อ — โยน UnknownRuleError ถ้าเจอกฎที่ไม่รู้จัก
 * ผู้เรียกเลือกได้ว่าจะปล่อย error ขึ้นไป (validateTransition) หรือถือว่าไม่ผ่าน (evaluateTransitions)
 */
function checkConditions(t: TransitionDefinition, ctx: TransitionContext): void {
  const conditions = t.rules
    .filter((r) => r.kind === 'CONDITION')
    .sort((a, b) => a.position - b.position);

  for (const rule of conditions) {
    const fn = CONDITIONS[rule.ruleType];
    if (fn === undefined) throw new UnknownRuleError('CONDITION', rule.ruleType);
    if (!fn(rule.config, ctx)) {
      throw new TransitionNotAllowedError(t.name, `เงื่อนไข "${rule.ruleType}" ไม่ผ่าน`);
    }
  }
}

/**
 * transition ที่ผู้ใช้ควร **เห็นปุ่ม** ในสถานะปัจจุบัน
 *
 * ตรวจเฉพาะ CONDITION — ไม่ตรวจ VALIDATOR โดยเจตนา
 * เพราะปุ่มที่หายไปเพราะยังไม่กรอกฟิลด์ ทำให้ผู้ใช้ไม่รู้ว่าต้องทำอะไรต่อ
 */
export function evaluateTransitions(
  transitions: TransitionDefinition[],
  ctx: TransitionContext,
): TransitionDefinition[] {
  return transitions
    .filter((t) => appliesToCurrentStatus(t, ctx))
    .filter((t) => {
      try {
        checkConditions(t, ctx);
        return true;
      } catch {
        // กฎที่ไม่รู้จักหรือเงื่อนไขไม่ผ่าน → ไม่แสดงปุ่ม (ปลอดภัยไว้ก่อน)
        return false;
      }
    })
    .sort((a, b) => a.position - b.position);
}

/**
 * ตรวจครบทุกชั้นก่อนเปลี่ยนสถานะจริง
 *
 * คืน post function ที่ต้องรัน — ผู้เรียกมีหน้าที่รันมันใน `auditedTransaction`
 * เดียวกับการอัปเดตสถานะ (INVARIANT 2)
 */
export function validateTransition(
  t: TransitionDefinition,
  ctx: TransitionContext,
): TransitionOutcome {
  if (!appliesToCurrentStatus(t, ctx)) {
    throw new TransitionNotAllowedError(
      t.name,
      `สถานะปัจจุบันไม่ตรงกับจุดเริ่มต้นของ transition นี้`,
    );
  }

  // ชั้น 1 ก่อนเสมอ — ผู้ใช้ที่ไม่มีสิทธิ์ต้องไม่รู้ว่าระบบต้องการฟิลด์อะไร
  checkConditions(t, ctx);

  // ชั้น 2
  const validators = t.rules
    .filter((r) => r.kind === 'VALIDATOR')
    .sort((a, b) => a.position - b.position);

  const missing: string[] = [];
  for (const rule of validators) {
    const fn = VALIDATORS[rule.ruleType];
    if (fn === undefined) throw new UnknownRuleError('VALIDATOR', rule.ruleType);
    const result = fn(rule.config, ctx);
    if (!result.ok) missing.push(...result.missingFields);
  }
  if (missing.length > 0) throw new ValidationFailedError(t.name, missing);

  // ชั้น 3 — ตรวจว่ารู้จักทุกตัวก่อนคืน ไม่ปล่อยให้ล้มกลางทรานแซกชัน
  const postFunctions = t.rules
    .filter((r) => r.kind === 'POST_FUNCTION')
    .sort((a, b) => a.position - b.position);

  for (const p of postFunctions) {
    if (!KNOWN_POST_FUNCTIONS.has(p.ruleType)) {
      throw new UnknownRuleError('POST_FUNCTION', p.ruleType);
    }
  }

  return { transitionId: t.id, toStatusId: t.toStatusId, postFunctions };
}
