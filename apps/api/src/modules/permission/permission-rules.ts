/**
 * กฎการตัดสินสิทธิ์ — ฟังก์ชันบริสุทธิ์ทั้งหมด
 *
 * แยกจากการอ่านฐานข้อมูล เพราะทุกบรรทัดที่นี่คือคำตอบของคำถาม
 * "ใครทำอะไรได้บ้าง" ซึ่งพลาดแล้วข้อมูลรั่วโดยไม่มี error ให้เห็น
 *
 * ตารางและข้อมูลสิทธิ์มีอยู่ในสคีมาตั้งแต่ Phase 0 แต่ **ไม่เคยมีโค้ดอ่านมันเลย**
 * ผลคือทุกคนที่ล็อกอินได้ทำได้ทุกอย่างเท่ากัน — วัดจริงแล้วผู้ใช้ทั่วไป
 * อ่านบันทึกภายในของทีมได้ครบทุกฉบับ
 */

/** คีย์สิทธิ์ที่ระบบรู้จัก — ตรงกับ enum `PermissionKey` ในสคีมา */
export type PermissionKey =
  | 'BROWSE_PROJECT'
  | 'CREATE_ITEM'
  | 'EDIT_ITEM'
  | 'DELETE_ITEM'
  | 'ASSIGN_ITEM'
  | 'TRANSITION_ITEM'
  | 'ADD_COMMENT'
  | 'DELETE_COMMENT'
  | 'VIEW_INTERNAL_COMMENT'
  | 'MANAGE_ATTACHMENT'
  | 'LINK_ITEM'
  | 'BULK_EDIT'
  | 'MANAGE_SPRINT'
  | 'MANAGE_PROJECT'
  | 'VIEW_REPORT'
  | 'ADMINISTER_TENANT';

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

/**
 * ผู้ใช้คนนี้เป็น "ทีมงาน" ของโปรเจกต์นี้หรือไม่
 *
 * ใช้ตัดสินว่าจะเห็นบันทึกภายในไหม · ตัดสินจากสิทธิ์ที่ตั้งไว้จริง
 * ไม่ใช่จากพารามิเตอร์ที่ผู้เรียกส่งมา — ของเดิมรับ `?view=agent`
 * จากฝั่งผู้ใช้ตรง ๆ ซึ่งแปลว่าใครพิมพ์คำนี้ก็เป็นทีมงานได้
 */
export function isStaff(permissions: ReadonlySet<PermissionKey>): boolean {
  return permissions.has('VIEW_INTERNAL_COMMENT');
}

/**
 * สรุปสิทธิ์ให้หน้าจอใช้ตัดสินว่าจะแสดงปุ่มอะไร
 *
 * **หน้าจอซ่อนปุ่มไม่ใช่การป้องกัน** — เซิร์ฟเวอร์ต้องปฏิเสธเองทุกครั้ง
 * ค่าเหล่านี้มีไว้ไม่ให้ผู้ใช้เห็นปุ่มที่กดแล้วได้ 403 เท่านั้น
 */
export interface PermissionSummary {
  canCreate: boolean;
  canEdit: boolean;
  canAssign: boolean;
  canTransition: boolean;
  canComment: boolean;
  canAttach: boolean;
  seesInternal: boolean;
}

export function summarize(permissions: ReadonlySet<PermissionKey>): PermissionSummary {
  return {
    canCreate: permissions.has('CREATE_ITEM'),
    canEdit: permissions.has('EDIT_ITEM'),
    canAssign: permissions.has('ASSIGN_ITEM'),
    canTransition: permissions.has('TRANSITION_ITEM'),
    canComment: permissions.has('ADD_COMMENT'),
    // แนบไฟล์ได้ถ้าแนบได้โดยตรง หรือแก้ไขงานได้อยู่แล้ว
    canAttach: permissions.has('MANAGE_ATTACHMENT') || permissions.has('EDIT_ITEM'),
    seesInternal: isStaff(permissions),
  };
}
