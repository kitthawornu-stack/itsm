/**
 * ใครควรได้รับ — บทบาทผู้รับที่ผู้ดูแลเปิดปิดได้
 *
 * `notification-policy.ts` ตอบว่า **ชนิดนี้ส่งไหม** · ไฟล์นี้ตอบว่า
 * **ในบรรดาคนที่เข้าข่าย ใครยังควรได้รับ** สองคำถามนี้แยกกันโดยตั้งใจ:
 * ผู้ดูแลที่อยากให้ผู้เฝ้าดูหยุดได้รับความเห็นใหม่ ไม่ได้อยากปิดความเห็นใหม่
 * ทั้งระบบ
 *
 * ฟังก์ชันบริสุทธิ์ทั้งไฟล์ — กฎถูกส่งเข้ามา ไม่อ่านฐานข้อมูลเอง
 *
 * ## ปิดทุกบทบาท ≠ ปิดทั้งชนิด
 *
 * สองอย่างนี้ให้ผลเหมือนกันคือไม่มีใครได้รับ · แต่อย่างหนึ่ง **เห็นได้จาก
 * สวิตช์ของชนิดนั้นทันที** อีกอย่างต้องไล่ดูบทบาททีละอันถึงจะรู้ ·
 * การตั้งค่าแบบหลังจึงถูกปฏิเสธตั้งแต่ตอนบันทึก แล้วบอกให้ไปปิดทั้งชนิดแทน
 * — ความเงียบที่ตั้งใจ ต้องอ่านออกจากหน้าจอได้ว่าตั้งใจ
 */

/**
 * บทบาทของผู้รับ — ต้องตรงกับ `reason` ที่ `commentAudience` และเพื่อน ๆ คืน
 *
 * เทสต์เทียบสองฝั่ง: บทบาทที่โค้ดสร้างจริงแต่ไม่มีในรายการนี้ จะปิดไม่ได้
 * ตลอดกาลและไม่โผล่ในหน้าตั้งค่า — ผู้ดูแลจะเชื่อว่าตั้งครบแล้วทั้งที่มีทางลอด
 */
export const AUDIENCE_ROLES = ['reporter', 'assignee', 'team', 'watcher', 'mention'] as const;

export type AudienceRole = (typeof AUDIENCE_ROLES)[number];

/**
 * บทบาทที่ปิดไม่ได้ ไม่ว่าจะสั่งจากที่ไหน
 *
 * เกณฑ์เดียวกับ `ALWAYS_ON` ของชนิด: **ปิดแล้วหน้าจอกลายเป็นคำโกหก**
 *
 * คนที่พิมพ์ `@ชื่อ` แล้วเห็นชื่อกลายเป็นลิงก์ ได้รับคำสัญญาว่าอีกฝ่ายจะรู้ ·
 * ถ้าผู้ดูแลปิดได้ คำสัญญานั้นจะผิดโดยที่ทั้งคนพิมพ์และคนถูกเรียกไม่รู้ตัว
 * และไม่มีอะไรบนหน้าจอบอกได้เลยว่าเกิดอะไรขึ้น
 */
export const ALWAYS_REACHED: readonly AudienceRole[] = ['mention'];

/**
 * เหตุผลผู้รับที่ **ไม่เปิดให้ตั้งค่า** — คนที่ต้องลงมือ ไม่ใช่คนที่รับข่าวสาร
 *
 * ผู้อนุมัติที่ไม่รู้ว่ามีใบรออยู่ ไม่ได้แค่พลาดข่าว — **กระบวนการของคนอื่นหยุด**
 * เกณฑ์เดียวกับ `ALWAYS_ON` ของชนิด · แยกเป็นรายการต่างหากแทนที่จะปล่อยให้
 * ตกไปเป็น "บทบาทที่ไม่รู้จัก" เพราะอย่างหลังทำให้พิมพ์ผิดแล้วรอดไปด้วย
 *
 * `notification-policy.spec.ts` สแกนจุดเรียกจริงแล้วเทียบกับสองรายการนี้
 */
export const PASS_THROUGH_REASONS = ['approver', 'requester', 'group'] as const;

export interface AudienceRule {
  kind: string;
  role: AudienceRole;
  /** `null` = ทุกโปรเจกต์ · ระบุ = เฉพาะโปรเจกต์นั้น และชนะกฎรวมเสมอ */
  projectId: bigint | null;
  isEnabled: boolean;
}

/**
 * ชนิดไหนแจ้งบทบาทไหนบ้าง
 *
 * จำเป็นเพราะด่าน "ห้ามปิดจนไม่เหลือใคร" ต้องรู้ว่าชนิดนั้นมีใครให้เหลือ ·
 * **ตอนแรกส่ง `AUDIENCE_ROLES` ทั้งชุดเข้าไป ซึ่งรวม `mention` ที่ปิดไม่ได้
 * ด่านจึงไม่มีวันทำงานเลย** — ด่านที่ไม่มีวันทำงาน คือด่านที่ไม่มี
 *
 * รายการนี้เป็นรายการที่คนดูแลด้วยมือ จึงมีเทสต์ที่สแกนจุดเรียกจริงแล้วเทียบ
 * (`notification-policy.spec.ts`) · ชนิดที่ไม่อยู่ในรายการ = ไม่มีบทบาท
 * ที่ตั้งค่าได้ เช่นการอนุมัติและการแจ้งกลุ่ม ซึ่งผู้รับต้องลงมือเสมอ
 */
export const ROLES_OF_KIND: Readonly<Record<string, readonly AudienceRole[]>> = {
  'workitem.assigned': ['assignee'],
  'workitem.rate': ['reporter'],
  // การถูกเรียกถึงแยกเป็นชนิดของตัวเอง จึงไม่อยู่ในสองชนิดล่าง
  'comment.added': ['reporter', 'assignee', 'team', 'watcher'],
  // บันทึกภายในไม่ถึงผู้แจ้งเด็ดขาด — ไม่ใช่เรื่องที่ตั้งค่าได้
  'comment.internal': ['assignee', 'team', 'watcher'],
  'comment.mention': ['mention'],
};

export class EmptyAudienceError extends Error {
  /**
   * `label` คือชื่อที่ผู้ใช้เห็น — ไม่ใส่จะใช้คีย์ของระบบแทน
   *
   * เอนจินไม่รู้จักภาษาที่คนอ่าน (ชั้นบริการเป็นคนรู้) แต่ข้อความนี้ไปถึงหน้าจอ
   * โดยตรง · ถ้าไม่เปิดช่องไว้ ผู้ใช้จะเห็น `comment.added` ซึ่งเป็นศัพท์ระบบ
   * ที่ §5 ห้ามไว้ — เห็นตอนกดจริงในเบราว์เซอร์เท่านั้น
   */
  constructor(
    readonly kind: string,
    label?: string,
  ) {
    super(
      `ปิดทุกบทบาทของ "${label ?? kind}" ไม่ได้ — ถ้าไม่ต้องการให้ใครได้รับเลย ` +
        'ให้ปิดทั้งชนิดที่สวิตช์ของชนิดนั้นแทน จะได้เห็นจากหน้าจอว่าตั้งใจปิด',
    );
    this.name = 'EmptyAudienceError';
  }
}

/**
 * บทบาทนี้ยังถึงตัวคนอยู่ไหม
 *
 * **กฎที่ระบุโปรเจกต์ชนะกฎรวมเสมอ** ไม่ว่าจะเปิดหรือปิด — กติกาเดียวกับ
 * สวิตช์ของชนิด · การให้ "ปิดชนะเสมอ" ทำให้เขียนข้อยกเว้นไม่ได้เลย
 */
export function roleReaches(
  kind: string,
  role: AudienceRole,
  projectId: bigint,
  rules: readonly AudienceRule[],
): boolean {
  if (ALWAYS_REACHED.includes(role)) return true;

  const forProject = rules.find(
    (r) => r.kind === kind && r.role === role && r.projectId === projectId,
  );
  if (forProject !== undefined) return forProject.isEnabled;

  const global = rules.find((r) => r.kind === kind && r.role === role && r.projectId === null);
  // ไม่มีกฎเลย = ได้รับ · ค่าปริยายคือพฤติกรรมเดิมก่อนมีฟีเจอร์นี้
  return global === undefined || global.isEnabled;
}

/**
 * กรองรายชื่อผู้รับตามกฎ
 *
 * **บทบาทที่ระบบไม่รู้จักผ่านไป ไม่ถูกตัดทิ้ง** — ตรงข้ามกับการ์ดบนแดชบอร์ด
 * ที่ชนิดไม่รู้จักแล้วถูกตัดออก · เพราะที่นี่ผลของการตัดคือ **คนไม่ได้รับข่าว**
 * ส่วนผลของการปล่อยผ่านคือได้รับเกิน · เมื่อไม่แน่ใจ ให้พลาดไปทางที่แก้ได้
 * ด้วยการบอกกัน ไม่ใช่ทางที่เงียบ
 */
export function filterAudience<T extends { reason: string }>(
  list: readonly T[],
  kind: string,
  projectId: bigint,
  rules: readonly AudienceRule[],
): T[] {
  return list.filter((r) => {
    if (!(AUDIENCE_ROLES as readonly string[]).includes(r.reason)) return true;
    return roleReaches(kind, r.reason as AudienceRole, projectId, rules);
  });
}

/**
 * ด่านตอนบันทึก — ชนิดหนึ่งต้องเหลือทางถึงตัวคนอย่างน้อยหนึ่งทาง
 *
 * `rolesOfKind` คือบทบาทที่ชนิดนั้นสร้างขึ้นจริง ส่งเข้ามาเพราะแต่ละชนิด
 * มีผู้รับไม่เหมือนกัน — `workitem.assigned` ไม่มีคนถูกเรียกถึง
 */
export function assertAudienceReachable(
  kind: string,
  rolesOfKind: readonly AudienceRole[],
  projectId: bigint,
  rules: readonly AudienceRule[],
  label?: string,
): void {
  const anyReaches = rolesOfKind.some((role) => roleReaches(kind, role, projectId, rules));
  if (!anyReaches) throw new EmptyAudienceError(kind, label);
}
