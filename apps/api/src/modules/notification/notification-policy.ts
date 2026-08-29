/**
 * ใครควรได้รับอะไร — ตรรกะล้วน ไม่มีฐานข้อมูล ไม่มีนาฬิกา
 *
 * ที่ผ่านมา "ใครได้รับอะไร" เขียนตายอยู่ในโค้ดของแต่ละ service ผู้ดูแลปิด
 * การแจ้งเตือนที่ไม่อยากได้ไม่ได้เลย · นั่นคือเหตุผลอันดับหนึ่งที่คนเลิกอ่าน
 * อีเมลจากระบบ แล้วพลาดฉบับที่สำคัญจริงไปพร้อมกัน
 *
 * ## ข้อมูลที่ไม่ครบ แปลว่า "ส่ง" — กลับทางกับเรื่องสิทธิ์
 *
 * เรื่องสิทธิ์ ข้อมูลที่ไม่ครบต้องแปลว่าไม่มีสิทธิ์ (CLAUDE.md) เพราะความ
 * ผิดพลาดไปทางเปิดกว้างคือข้อมูลรั่ว · **เรื่องแจ้งเตือนกลับกัน** ความผิดพลาด
 * ไปทางไม่ส่ง คือคนไม่รู้ว่ามีเรื่องรอเขาอยู่ ซึ่งไม่มีอะไรฟ้องเลยสักอย่าง
 * ส่วนความผิดพลาดไปทางส่ง คือคนรำคาญ ซึ่งมีคนมาบ่นแล้วได้แก้
 *
 * ตั้งใจให้ต่างจากกติกาสิทธิ์ และเขียนไว้ตรงนี้เพื่อไม่ให้มีคนมา "แก้ให้
 * สอดคล้องกัน" ทีหลังโดยไม่รู้ว่าทำไม
 *
 * ## บางชนิดปิดไม่ได้
 *
 * `approval.requested` ที่ถูกปิด แปลว่าใบขออนุมัติค้างอยู่ตลอดกาลโดยไม่มีใคร
 * รู้ว่ามีมัน · ผู้อนุมัติที่ปิดการแจ้งเตือนไว้ ไม่ได้ตั้งใจจะหยุดกระบวนการ
 * ของทั้งองค์กร · ชนิดแบบนี้จึงไม่รับคำสั่งปิดจากใครทั้งนั้น
 */

/** ชนิดการแจ้งเตือนที่ระบบสร้างจริง — เทสต์สแกนซอร์สเทียบสองฝั่ง */
export const NOTIFICATION_KINDS = [
  'workitem.assigned',
  'workitem.rate',
  'comment.added',
  'comment.mention',
  'comment.internal',
  'approval.requested',
  'approval.decided',
  'sla.threshold',
  'automation.notice',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * ชนิดที่ปิดไม่ได้ ไม่ว่าจะสั่งจากที่ไหน
 *
 * เกณฑ์: ปิดแล้ว **กระบวนการของคนอื่นหยุด** ไม่ใช่แค่ตัวเองไม่รู้
 */
export const ALWAYS_ON: readonly NotificationKind[] = ['approval.requested'];

export type Channel = 'in-app' | 'email';
export const CHANNELS: readonly Channel[] = ['in-app', 'email'];

/** สวิตช์ระดับองค์กร/โปรเจกต์ ที่ผู้ดูแลตั้ง */
export interface AdminSwitch {
  kind: string;
  /** `null` = ทุกโปรเจกต์ · ระบุ = เฉพาะโปรเจกต์นั้น */
  projectId: bigint | null;
  isEnabled: boolean;
}

/** สิ่งที่ผู้ใช้คนหนึ่งเลือกไว้เอง */
export interface UserPreference {
  kind: string;
  channel: Channel;
  isEnabled: boolean;
}

export interface PolicyInput {
  kind: string;
  projectId: bigint;
  admin: readonly AdminSwitch[];
  user: readonly UserPreference[];
}

export interface PolicyDecision {
  /** เขียนแถวแจ้งเตือนไหม — ไม่เขียน แปลว่ากระดิ่งบนหน้าเว็บก็ไม่ขึ้น */
  inApp: boolean;
  /** ส่งอีเมลไหม — เขียนแถวแล้วแต่ไม่ส่งอีเมล เป็นสถานะที่ถูกต้อง */
  email: boolean;
  /** เหตุผลที่ปิด — `null` เมื่อส่งครบทุกช่องทาง */
  mutedBy: 'admin' | 'user' | null;
}

/**
 * สวิตช์ของผู้ดูแลที่ใช้กับโปรเจกต์นี้
 *
 * **สวิตช์ที่ระบุโปรเจกต์ ชนะสวิตช์รวมเสมอ** ไม่ว่าจะเปิดหรือปิด · ผู้ดูแลที่
 * ปิดทั้งองค์กรแล้วเปิดเฉพาะโปรเจกต์เดียว ตั้งใจอย่างนั้นจริง ๆ · การให้
 * "ปิดชนะเสมอ" จะทำให้ข้อยกเว้นเขียนไม่ได้เลย
 */
function adminSaysOff(kind: string, projectId: bigint, admin: readonly AdminSwitch[]): boolean {
  const forProject = admin.find((a) => a.kind === kind && a.projectId === projectId);
  if (forProject !== undefined) return !forProject.isEnabled;
  const global = admin.find((a) => a.kind === kind && a.projectId === null);
  // ไม่มีสวิตช์เลย = เปิด (ดูหัวไฟล์)
  return global !== undefined && !global.isEnabled;
}

function userSaysOff(kind: string, channel: Channel, user: readonly UserPreference[]): boolean {
  const row = user.find((u) => u.kind === kind && u.channel === channel);
  return row !== undefined && !row.isEnabled;
}

/** ตัดสินว่าจะแจ้งช่องทางไหนบ้าง */
export function decideNotification(input: PolicyInput): PolicyDecision {
  if ((ALWAYS_ON as readonly string[]).includes(input.kind)) {
    return { inApp: true, email: true, mutedBy: null };
  }

  if (adminSaysOff(input.kind, input.projectId, input.admin)) {
    // ผู้ดูแลปิด = ปิดทุกช่องทาง · การเปิดค้างไว้ช่องหนึ่งไม่ใช่สิ่งที่เขาสั่ง
    return { inApp: false, email: false, mutedBy: 'admin' };
  }

  const inApp = !userSaysOff(input.kind, 'in-app', input.user);
  const email = !userSaysOff(input.kind, 'email', input.user);

  return { inApp, email, mutedBy: inApp && email ? null : 'user' };
}
