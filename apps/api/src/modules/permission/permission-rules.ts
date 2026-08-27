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

/**
 * คีย์สิทธิ์ทั้งหมดที่ระบบรู้จัก — เรียงตามลำดับเดียวกับ enum `PermissionKey`
 * ในสคีมา ซึ่งจัดกลุ่มสิ่งที่เกี่ยวข้องกันไว้ด้วยกันอยู่แล้ว
 *
 * ชนิด `PermissionKey` ประกาศจากรายการนี้ ไม่ใช่เขียนคู่กันสองที่ —
 * รายการที่ต้องแก้สองแห่งคือรายการที่จะไม่ตรงกันในวันที่มีคนแก้แค่แห่งเดียว
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

/**
 * คีย์ที่ **ยังไม่มีโค้ดเส้นไหนบังคับใช้**
 *
 * ทั้งเจ็ดคีย์นี้มีอยู่ใน enum · แสดงบนหน้าตั้งค่า · และให้กับกลุ่มได้จริง
 * แต่ไม่มี `can()` หรือ `assertCan()` ที่ไหนถามถึงมันเลย
 *
 * ข้อมูล seed ให้ `BULK_EDIT` กับกลุ่ม IT Support ไว้แล้ว ผู้ดูแลที่เปิดหน้า
 * ตั้งค่าจึงอ่านได้ว่า "แก้ไขหลายเรื่องพร้อมกัน — IT Support" ซึ่งเป็นความเชื่อ
 * ที่หน้าจอสร้างขึ้นเองทั้งหมด: ฟีเจอร์นั้นยังไม่มี และต่อให้มี ก็ไม่มีอะไรตรวจคีย์นี้
 *
 * **สิทธิ์ที่ให้แล้วไม่มีผล อันตรายกว่าสิทธิ์ที่ยังไม่ได้ให้** — อย่างหลังทำให้
 * มีคนมาบ่นแล้วได้แก้ อย่างแรกทำให้ทุกคนเชื่อว่าตั้งค่าเรียบร้อยแล้ว
 *
 * รายการนี้ไม่ได้ดูแลด้วยมือ — `permission-coverage.spec.ts` สแกนซอร์สจริง
 * แล้วเทียบ ถ้าวันไหนมีคนเขียนโค้ดบังคับใช้คีย์เหล่านี้ เทสต์จะแดงทันที
 * และบังคับให้มาลบชื่อออกจากที่นี่
 */
export const UNENFORCED_PERMISSIONS: readonly PermissionKey[] = [
  'DELETE_ITEM',
  'DELETE_COMMENT',
  'LINK_ITEM',
  'BULK_EDIT',
  'MANAGE_SPRINT',
  'MANAGE_PROJECT',
  'VIEW_REPORT',
] as const;

/** คีย์นี้มีผลจริงหรือยัง */
export function isEnforced(key: PermissionKey): boolean {
  return !UNENFORCED_PERMISSIONS.includes(key);
}

/**
 * การถอนสิทธิ์นี้จะทำให้ไม่มีใครเข้าหน้าตั้งค่าได้อีกหรือไม่
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพราะการทดสอบกฎนี้กับฐานข้อมูลจริง **อันตราย**:
 * ถ้ากลไกถูกลบออก (ซึ่งต้องทำเพื่อพิสูจน์ว่าเทสต์แดงได้) การลบจะสำเร็จจริง
 * และฐานข้อมูลจะเหลือศูนย์ — เกิดขึ้นมาแล้วครั้งหนึ่งระหว่างเขียนไฟล์นี้
 *
 * @param othersElsewhere จำนวน grant `ADMINISTER_TENANT` ที่เหลือ **ทั้ง tenant**
 *   ไม่ใช่แค่ในชุดสิทธิ์ใบเดียวกัน เพราะ `isTenantAdmin` ถือว่ามีคีย์นี้
 *   ในชุดไหนก็ตาม = เป็นผู้ดูแลทั้ง tenant
 */
export function wouldLockOutAdmins(permission: PermissionKey, othersElsewhere: number): boolean {
  if (permission !== 'ADMINISTER_TENANT') return false;
  return othersElsewhere <= 0;
}

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
 * คีย์ที่ **ให้สิทธิ์อีกคีย์หนึ่งโดยปริยาย**
 *
 * `canAttach` เป็นจริงเมื่อมี MANAGE_ATTACHMENT **หรือ** EDIT_ITEM
 * (ดู `summarize`) · ตารางสิทธิ์ที่แสดงแต่ grant ตรง ๆ จึงบอกว่า
 * "จัดการไฟล์แนบ — ยังไม่มีใคร" ทั้งที่ทีมที่แก้ไขเรื่องได้แนบไฟล์ได้อยู่แล้ว
 *
 * ข้อความที่จริงตามตัวอักษรแต่พาให้สรุปผิด แย่กว่าไม่มีข้อความ —
 * หน้าตั้งค่าจึงต้องบอกที่มาโดยปริยายด้วย ไม่ใช่บอกแค่สิ่งที่อยู่ในตาราง
 */
export const IMPLIED_BY: Partial<Record<PermissionKey, PermissionKey>> = {
  MANAGE_ATTACHMENT: 'EDIT_ITEM',
};

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
