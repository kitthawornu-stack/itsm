/**
 * กติกาการรวมสิทธิ์ — **แหล่งความจริงเดียว**
 *
 * อยู่ใน `@itsm/types` เพราะทั้ง api และ worker ต้องตอบคำถามเดียวกันว่า
 * "คนนี้ยังมีสิทธิ์อยู่ไหม" · worker เรียกโค้ดของ api ไม่ได้ (คนละแอป)
 * และตัวส่งรายงานตามตารางเวลาต้องตรวจสิทธิ์ **ทุกรอบ** ไม่ใช่เชื่อว่า
 * ตรวจตอนตั้งแล้วพอ — ตารางที่ตั้งไว้ตอนยังมีสิทธิ์ ต้องหยุดส่งเมื่อสิทธิ์
 * ถูกถอน มิฉะนั้นการถอนสิทธิ์จะไม่มีผลกับสิ่งที่ตั้งไว้แล้ว
 *
 * **คิวรีอยู่แยกกันตามแอป แต่กติกาอยู่ที่เดียว** · ถ้าเขียนกติกาซ้ำ
 * สองที่ จะกลายเป็นสองคำตอบเรื่องสิทธิ์ ซึ่งเป็นที่ที่ผิดพลาดแล้ว
 * ไม่มีทางเห็นจนกว่าจะมีคนได้ข้อมูลที่ไม่ควรได้
 */

export const ALL_PERMISSION_KEYS = [
  'BROWSE_PROJECT',
  'CREATE_ITEM',
  'EDIT_ITEM',
  'DELETE_ITEM',
  'ASSIGN_ITEM',
  'TRANSITION_ITEM',
  'ADD_COMMENT',
  'DELETE_COMMENT',
  'VIEW_INTERNAL_COMMENT',
  'MANAGE_ATTACHMENT',
  'LINK_ITEM',
  'BULK_EDIT',
  'MANAGE_SPRINT',
  'MANAGE_PROJECT',
  'VIEW_REPORT',
  'ADMINISTER_TENANT',
] as const;

/** คีย์สิทธิ์ที่ระบบรู้จัก — ตรงกับ enum `PermissionKey` ในสคีมา */
export type PermissionKey = (typeof ALL_PERMISSION_KEYS)[number];

/** สิทธิ์หนึ่งรายการที่ผูกกับกลุ่ม — `groupId` เป็น null คือ grant ที่ยังตั้งค่าไม่ครบ */
export interface GrantRow {
  permission: string;
  groupId: bigint | null;
}

/**
 * รวมสิทธิ์ที่ผู้ใช้คนหนึ่งได้จริงจากกลุ่มที่ตัวเองอยู่
 *
 * **ให้สิทธิ์ผ่านกลุ่มเท่านั้น ไม่ให้รายบุคคล** (ตามที่สคีมาออกแบบไว้)
 * เพื่อให้ตอบได้ว่า "ทำไมคนนี้ทำได้" ไม่ใช่แค่ "ทำได้"
 *
 * grant ที่ไม่มี `groupId` ถูกข้าม — ไม่ใช่ตีความว่าให้ทุกคน
 * การเดาไปทางให้สิทธิ์เมื่อข้อมูลไม่ครบ คือวิธีที่ระบบสิทธิ์รั่วบ่อยที่สุด
 */
export function resolveGrants(
  grants: readonly GrantRow[],
  userGroupIds: readonly bigint[],
): Set<PermissionKey> {
  const mine = new Set(userGroupIds.map((g) => g.toString()));
  const out = new Set<PermissionKey>();
  for (const g of grants) {
    if (g.groupId === null) continue;
    if (!mine.has(g.groupId.toString())) continue;
    out.add(g.permission as PermissionKey);
  }
  return out;
}
