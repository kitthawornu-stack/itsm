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

export interface AudienceRule {
  kind: string;
  role: AudienceRole;
  /** `null` = ทุกโปรเจกต์ · ระบุ = เฉพาะโปรเจกต์นั้น และชนะกฎรวมเสมอ */
  projectId: bigint | null;
  isEnabled: boolean;
}

export class EmptyAudienceError extends Error {
  constructor(readonly kind: string) {
    super(
      `ปิดทุกบทบาทของ "${kind}" ไม่ได้ — ถ้าไม่ต้องการให้ใครได้รับเลย ` +
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
): void {
  const anyReaches = rolesOfKind.some((role) => roleReaches(kind, role, projectId, rules));
  if (!anyReaches) throw new EmptyAudienceError(kind);
}
