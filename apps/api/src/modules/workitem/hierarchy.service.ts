/**
 * ลำดับชั้นของงาน — Epic → Story/Incident → Sub-task
 *
 * `parentId` อยู่ในสคีมามาตั้งแต่ Phase 0 · ถูก index เข้า OpenSearch ด้วย
 * **แต่ไม่มี service ไหนอ่านหรือเขียนมันเลย** — รูปแบบเดียวกับ `LINK_ITEM`
 * `VIEW_REPORT` `DELETE_COMMENT` และตารางผู้เฝ้าดู
 *
 * ## ความลึกมาจากชนิดงาน ไม่ใช่จากการนับ
 *
 * `issue_type.hierarchy_level` บอกอยู่แล้วว่าอะไรอยู่ชั้นไหน (Epic=1 ·
 * Story/Incident=0 · Sub-task=-1) · กฎคือ **แม่ต้องอยู่สูงกว่าลูกหนึ่งชั้นพอดี**
 *
 * เขียนแบบนี้แล้ว "ลึกสุด 3 ชั้น" เป็นผลที่ตามมาเอง ไม่ต้องมีตัวนับความลึก
 * ซึ่งเป็นโค้ดที่พังเงียบเมื่อมีคนเพิ่มชนิดงานใหม่ — ตัวนับไม่รู้จักชนิดนั้น
 * และปล่อยผ่านหรือปฏิเสธผิด ๆ โดยไม่มีอะไรบอก
 *
 * ## แต่ยังต้องกันวงกลมอยู่ดี
 *
 * ถ้าชั้นถูกเสมอ วงกลมเกิดไม่ได้ เพราะไล่ขึ้นไปทีไรชั้นก็สูงขึ้นเรื่อย ๆ
 * **แต่ผู้ดูแลแก้ `hierarchy_level` ของชนิดงานได้หลังจากผูกกันไปแล้ว** ·
 * A(0) เป็นแม่ของ B(-1) อยู่ · แอดมินเปลี่ยน B เป็นชั้น 1 · ตอนนี้ B
 * เป็นแม่ของ A ได้ตามกฎชั้น และกลายเป็นวงกลม
 *
 * วงกลมทำให้หน้าจอที่ไล่ขึ้นไปหาแม่วนไม่รู้จบ — ต้องกันตอนเขียน
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction, change } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan, browsableProjectIds } from '../permission';

/** ไล่ขึ้นไปหาแม่ได้ลึกสุดเท่านี้ — กันไว้เผื่อข้อมูลเสียจนวนจริง */
const MAX_WALK = 10;

export class HierarchyTargetNotFoundError extends Error {
  constructor() {
    super('ไม่พบเรื่องที่ระบุ');
    this.name = 'HierarchyTargetNotFoundError';
  }
}

export class SelfParentError extends Error {
  constructor() {
    super('ทำให้เรื่องเป็นงานย่อยของตัวเองไม่ได้');
    this.name = 'SelfParentError';
  }
}

export class WrongHierarchyLevelError extends Error {
  constructor(
    readonly parentType: string,
    readonly childType: string,
  ) {
    super(`"${parentType}" เป็นเรื่องหลักของ "${childType}" ไม่ได้ — ชั้นไม่ต่อกัน`);
    this.name = 'WrongHierarchyLevelError';
  }
}

export class CrossProjectParentError extends Error {
  constructor() {
    super('เรื่องหลักกับงานย่อยต้องอยู่โปรเจกต์เดียวกัน');
    this.name = 'CrossProjectParentError';
  }
}

export class HierarchyCycleError extends Error {
  constructor() {
    super('ผูกแบบนี้จะทำให้วนกลับมาหาตัวเอง');
    this.name = 'HierarchyCycleError';
  }
}

export interface ChildRow {
  itemKey: string;
  summary: string;
  statusName: string;
  statusCategory: string;
  assignee: string | null;
}

export interface ParentRow {
  itemKey: string;
  summary: string;
  statusName: string;
  statusCategory: string;
}

interface Loaded {
  id: bigint;
  itemKey: string;
  projectId: bigint;
  parentId: bigint | null;
  level: number;
  typeName: string;
}

async function load(ctx: TenantContext, itemKey: string): Promise<Loaded> {
  const allowed = await browsableProjectIds(ctx);
  const row =
    allowed.length === 0
      ? null
      : await tenantScoped(ctx).workItem.findFirst({
          where: { itemKey: itemKey.trim(), projectId: { in: allowed } },
          select: {
            id: true,
            itemKey: true,
            projectId: true,
            parentId: true,
            issueType: { select: { name: true, hierarchyLevel: true } },
          },
        });
  // ไม่มีอยู่จริง กับ เปิดดูไม่ได้ ตอบเหมือนกัน — ไม่ยืนยันว่าเลขนี้มีอยู่
  if (row === null) throw new HierarchyTargetNotFoundError();
  return {
    id: row.id,
    itemKey: row.itemKey,
    projectId: row.projectId,
    parentId: row.parentId,
    level: row.issueType.hierarchyLevel,
    typeName: row.issueType.name,
  };
}

/**
 * ผูกเรื่องหลัก — ส่ง `null` เพื่อถอดออก
 *
 * ต้องมี `EDIT_ITEM` เพราะการเปลี่ยนเรื่องหลักเปลี่ยนความหมายของงานใบนั้น
 * และทำให้มันโผล่/หายจากรายการงานย่อยของอีกใบ
 */
export async function setParent(
  ctx: TenantContext,
  childKey: string,
  parentKey: string | null,
): Promise<void> {
  const child = await load(ctx, childKey);
  await assertCan(ctx, child.projectId, 'EDIT_ITEM');

  if (parentKey === null || parentKey.trim() === '') {
    if (child.parentId === null) return;
    const before = await tenantScoped(ctx).workItem.findUnique({
      where: { id: child.parentId },
      select: { itemKey: true },
    });
    await auditedTransaction(ctx, 'workitem.unparent', async (tx) => {
      await tx.workItem.update({ where: { id: child.id }, data: { parentId: null } });
      return {
        result: undefined,
        audit: [change(child.id, 'parent', before?.itemKey ?? null, null)],
      };
    });
    return;
  }

  const parent = await load(ctx, parentKey);
  if (parent.id === child.id) throw new SelfParentError();
  /*
    โปรเจกต์เดียวกันเท่านั้น

    ถ้าข้ามโปรเจกต์ได้ งานย่อยจะโผล่ในรายการของเรื่องหลักที่ผู้ใช้บางคน
    เปิดดูไม่ได้ · แล้วความคืบหน้าที่แสดง ("เสร็จ 3 จาก 5") จะนับใบที่เขา
    มองไม่เห็นรวมอยู่ด้วย ซึ่งเป็นการบอกจำนวนของสิ่งที่เขาไม่ควรรู้ว่ามี
  */
  if (parent.projectId !== child.projectId) throw new CrossProjectParentError();

  // แม่ต้องสูงกว่าลูกหนึ่งชั้นพอดี — "ลึกสุด 3 ชั้น" เป็นผลที่ตามมาเอง
  if (parent.level !== child.level + 1) {
    throw new WrongHierarchyLevelError(parent.typeName, child.typeName);
  }

  /*
    ไล่ขึ้นจากแม่คนใหม่ ถ้าเจอตัวลูกเอง = วงกลม

    ตามทฤษฎีเกิดไม่ได้ถ้าชั้นถูกเสมอ · แต่ผู้ดูแลแก้ `hierarchy_level`
    ของชนิดงานได้หลังจากผูกกันไปแล้ว ซึ่งทำให้ความสัมพันธ์เก่าที่เคยถูก
    กลายเป็นทางเปิดให้วนกลับมา
  */
  let cursor: bigint | null = parent.parentId;
  for (let i = 0; i < MAX_WALK && cursor !== null; i += 1) {
    if (cursor === child.id) throw new HierarchyCycleError();
    const up: { parentId: bigint | null } | null = await tenantScoped(ctx).workItem.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = up?.parentId ?? null;
  }

  if (child.parentId === parent.id) return;

  const before =
    child.parentId === null
      ? null
      : await tenantScoped(ctx).workItem.findUnique({
          where: { id: child.parentId },
          select: { itemKey: true },
        });

  await auditedTransaction(ctx, 'workitem.parent', async (tx) => {
    await tx.workItem.update({ where: { id: child.id }, data: { parentId: parent.id } });
    return {
      result: undefined,
      audit: [change(child.id, 'parent', before?.itemKey ?? null, parent.itemKey)],
    };
  });
}

/**
 * งานย่อยของเรื่องนี้
 *
 * กรองด้วยโปรเจกต์ที่เปิดดูได้ **ตอนอ่าน** เหมือนลิงก์และผู้เฝ้าดู ·
 * ปกติงานย่อยอยู่โปรเจกต์เดียวกันอยู่แล้ว แต่ข้อมูลเก่าที่ผูกไว้ก่อนมีกฎนี้
 * (หรือแก้ผ่าน SQL) อาจข้ามโปรเจกต์อยู่
 */
export async function childrenOf(
  ctx: TenantContext,
  workItemId: bigint,
): Promise<{ rows: ChildRow[]; done: number }> {
  const allowed = await browsableProjectIds(ctx);
  if (allowed.length === 0) return { rows: [], done: 0 };

  const rows = await tenantScoped(ctx).workItem.findMany({
    where: { parentId: workItemId, projectId: { in: allowed } },
    select: {
      itemKey: true,
      summary: true,
      status: { select: { name: true, category: true } },
      assignee: { select: { displayName: true } },
    },
    orderBy: { itemKey: 'asc' },
  });

  return {
    rows: rows.map((r) => ({
      itemKey: r.itemKey,
      summary: r.summary,
      statusName: r.status.name,
      statusCategory: r.status.category,
      assignee: r.assignee?.displayName ?? null,
    })),
    // นับจากหมวดของสถานะ ไม่ใช่จากชื่อสถานะ — ชื่อเปลี่ยนได้ หมวดคือความหมาย
    done: rows.filter((r) => r.status.category === 'DONE').length,
  };
}

/** เรื่องหลักของเรื่องนี้ — `null` เมื่อไม่มี หรือมองไม่เห็น */
export async function parentOf(
  ctx: TenantContext,
  workItemId: bigint,
): Promise<ParentRow | null> {
  const allowed = await browsableProjectIds(ctx);
  if (allowed.length === 0) return null;

  const me = await tenantScoped(ctx).workItem.findUnique({
    where: { id: workItemId },
    select: { parentId: true },
  });
  if (me?.parentId === null || me?.parentId === undefined) return null;

  const p = await tenantScoped(ctx).workItem.findFirst({
    where: { id: me.parentId, projectId: { in: allowed } },
    select: { itemKey: true, summary: true, status: { select: { name: true, category: true } } },
  });
  if (p === null) return null;
  return {
    itemKey: p.itemKey,
    summary: p.summary,
    statusName: p.status.name,
    statusCategory: p.status.category,
  };
}

/**
 * ชนิดงานที่เป็นงานย่อยของเรื่องนี้ได้
 *
 * ให้หน้าจอเสนอเฉพาะชนิดที่ผูกได้จริง แทนที่จะให้ผู้ใช้เลือกแล้วเจอคำปฏิเสธ
 * — เกณฑ์เดียวกับที่ `setParent` ใช้ จึงเป็นไปไม่ได้ที่เมนูจะเสนอสิ่งที่กดไม่ได้
 */
export async function childTypesFor(
  ctx: TenantContext,
  parentLevel: number,
): Promise<Array<{ id: string; name: string }>> {
  const rows = await tenantScoped(ctx).issueType.findMany({
    where: { hierarchyLevel: parentLevel - 1 },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return rows.map((r) => ({ id: r.id.toString(), name: r.name }));
}
