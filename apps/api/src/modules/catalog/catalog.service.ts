/**
 * Service Catalog — รายการบริการที่ผู้แจ้งเลือกได้
 *
 * ก่อนมีไฟล์นี้ ผู้แจ้งพิมพ์อิสระอย่างเดียว ทีมจึงต้องอ่านแล้วเดาทีหลังว่า
 * เรื่องนี้คืออะไร และรายงานตอบไม่ได้เลยว่าบริการไหนสร้างงานมากที่สุด
 *
 * **หมวดหมู่ที่ไม่ได้เก็บตอนแจ้ง ย้อนกลับไปเติมให้เรื่องเก่าไม่ได้**
 * นี่คือเหตุผลที่ `work_item.catalog_item_id` เพิ่มมาพร้อมกันตั้งแต่วันแรก
 * ไม่ใช่รอจนมีหน้ารายงาน
 *
 * **ทางพิมพ์อิสระต้องไม่หายไป** — รายการบริการไม่มีวันครอบคลุมทุกเรื่อง
 * ถ้าบังคับให้เลือกจากรายการ คนจะเลือกอันที่ใกล้เคียงที่สุดแล้วเขียนอย่างอื่น
 * ซึ่งแย่กว่าไม่มีหมวดหมู่เลย เพราะข้อมูลจะดูน่าเชื่อทั้งที่ผิด
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

export class CategoryNameRequiredError extends Error {
  constructor() {
    super('ต้องตั้งชื่อหมวด');
    this.name = 'CategoryNameRequiredError';
  }
}

export class DuplicateCatalogNameError extends Error {
  constructor(readonly given: string) {
    super(`มีรายการชื่อ "${given}" อยู่แล้ว`);
    this.name = 'DuplicateCatalogNameError';
  }
}

/**
 * ปลายทางที่บริการชี้ไปไม่มีอยู่จริง
 *
 * ตรวจตอน **สร้าง** ไม่ใช่ตอนมีคนกด — บริการที่ชี้ไปยังโปรเจกต์หรือประเภทงาน
 * ที่ไม่มีอยู่ คือกับดักที่รอผู้แจ้งมากด และคนที่กดไม่ใช่คนที่ตั้งค่าผิด
 */
export class UnknownCatalogTargetError extends Error {
  constructor(readonly what: string) {
    super(`ตั้งค่าปลายทางไม่ถูกต้อง: ไม่พบ${what}`);
    this.name = 'UnknownCatalogTargetError';
  }
}

/**
 * ไม่พบบริการนี้
 *
 * ครอบสามกรณีโดยตั้งใจ: ไม่มีอยู่จริง · ปิดอยู่ · อยู่ในโปรเจกต์ที่ผู้ใช้เปิดดูไม่ได้
 * การแยกออกจากกันคือการยืนยันว่าเลขนี้มีอยู่ ซึ่งเป็นการวาดแผนที่ให้คนที่กำลังลอง
 */
export class CatalogItemNotFoundError extends Error {
  constructor() {
    super('ไม่พบบริการที่เลือก');
    this.name = 'CatalogItemNotFoundError';
  }
}

export class CategoryInUseError extends Error {
  constructor(readonly count: number) {
    super(`ลบไม่ได้ — ยังมีบริการอยู่ในหมวดนี้ ${String(count)} รายการ`);
    this.name = 'CategoryInUseError';
  }
}

const NAME_MAX = 200;

export interface CatalogItemRow {
  id: string;
  name: string;
  description: string | null;
  projectKey: string;
  issueTypeName: string;
  priorityName: string | null;
  isActive: boolean;
}

export interface CatalogGroup {
  id: string;
  name: string;
  items: CatalogItemRow[];
}

function toRow(i: {
  id: bigint;
  name: string;
  description: string | null;
  isActive: boolean;
  project: { key: string };
  issueType: { name: string };
  priority: { name: string } | null;
}): CatalogItemRow {
  return {
    id: i.id.toString(),
    name: i.name,
    description: i.description,
    projectKey: i.project.key,
    issueTypeName: i.issueType.name,
    priorityName: i.priority?.name ?? null,
    isActive: i.isActive,
  };
}

const ITEM_INCLUDE = {
  project: { select: { key: true } },
  issueType: { select: { name: true } },
  priority: { select: { name: true } },
} as const;

/**
 * รายการบริการที่ผู้แจ้งเห็น
 *
 * **กรองด้วยโปรเจกต์ที่เปิดดูได้ที่ระดับคิวรี** — รายการบริการคือแผนที่ของสิ่งที่
 * องค์กรทำ การโชว์ทั้งหมดให้ทุกคนคือการบอกว่ามีโปรเจกต์อะไรอยู่บ้าง
 *
 * หมวดที่ไม่เหลือบริการที่คนนี้เห็นได้ จะไม่ถูกคืนมาเป็นหมวดว่าง —
 * หมวดว่างเปล่าอ่านเหมือน "ยังไม่มีบริการ" ทั้งที่จริงคือ "มีแต่คุณเข้าไม่ถึง"
 */
export async function browseCatalog(
  ctx: TenantContext,
  browsableProjectIds: readonly bigint[],
): Promise<CatalogGroup[]> {
  /*
    ไม่มี early return สำหรับรายการว่าง โดยตั้งใจ

    `projectId: { in: [] }` ไม่ตรงกับอะไรอยู่แล้ว การเขียน `if (length === 0) return []`
    ซ้ำอีกชั้นคือการประกาศกฎเดียวกันสองที่ · และมันจะ **กลบ** ความผิดพลาด:
    ถ้าวันหนึ่งมีคนลบตัวกรอง `in` ออก เคส "ไม่มีสิทธิ์เลย" จะยังเขียวเพราะ
    early return ทำงานแทน ทั้งที่เคสอื่นรั่วหมดแล้ว
    (พิสูจน์แล้ว: ลบบรรทัดนั้นออก เทสต์ยังเขียวทั้ง 16 เคส)
  */
  const db = tenantScoped(ctx);
  const cats = await db.catalogCategory.findMany({
    where: {
      isActive: true,
      items: { some: { isActive: true, projectId: { in: [...browsableProjectIds] } } },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      items: {
        where: { isActive: true, projectId: { in: [...browsableProjectIds] } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: ITEM_INCLUDE,
      },
    },
  });
  return cats.map((c) => ({
    id: c.id.toString(),
    name: c.name,
    items: c.items.map(toRow),
  }));
}

/** รายการทั้งหมดสำหรับหน้าผู้ดูแล — รวมที่ปิดอยู่ ซึ่งผู้แจ้งไม่เห็น */
export async function listCatalogAdmin(ctx: TenantContext): Promise<CatalogGroup[]> {
  const cats = await tenantScoped(ctx).catalogCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      items: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: ITEM_INCLUDE },
    },
  });
  return cats.map((c) => ({ id: c.id.toString(), name: c.name, items: c.items.map(toRow) }));
}

export async function createCatalogCategory(
  ctx: TenantContext,
  rawName: string,
  sortOrder = 100,
): Promise<{ id: bigint }> {
  const name = rawName.trim().slice(0, 128);
  if (name === '') throw new CategoryNameRequiredError();

  const db = tenantScoped(ctx);
  if ((await db.catalogCategory.findFirst({ where: { name }, select: { id: true } })) !== null) {
    throw new DuplicateCatalogNameError(name);
  }

  return auditedTransaction(ctx, 'catalog.category.create', async (tx) => {
    const c = await tx.catalogCategory.create({
      data: { tenantId: ctx.tenantId, name, sortOrder },
      select: { id: true },
    });
    return {
      result: c,
      audit: [
        {
          kind: 'system',
          action: 'catalog.category.create',
          entityType: 'catalog_category',
          entityId: c.id.toString(),
          payload: { name, sortOrder },
        },
      ],
    };
  });
}

export interface CreateCatalogItemInput {
  categoryId: bigint;
  name: string;
  description?: string | undefined;
  projectId: bigint;
  issueTypeId: bigint;
  priorityId?: number | undefined;
  sortOrder?: number | undefined;
}

export async function createCatalogItem(
  ctx: TenantContext,
  input: CreateCatalogItemInput,
): Promise<{ id: bigint }> {
  const name = input.name.trim().slice(0, NAME_MAX);
  if (name === '') throw new CategoryNameRequiredError();

  const db = tenantScoped(ctx);

  /*
    ตรวจปลายทางให้ครบก่อนเขียน — ไม่ปล่อยให้ foreign key เป็นคนบอก
    error ของ FK อ่านไม่ออกสำหรับผู้ดูแล และไม่บอกว่าอันไหนผิด
  */
  const [cat, project, issueType] = await Promise.all([
    db.catalogCategory.findFirst({ where: { id: input.categoryId }, select: { id: true } }),
    db.project.findFirst({ where: { id: input.projectId }, select: { id: true } }),
    db.issueType.findFirst({ where: { id: input.issueTypeId }, select: { id: true } }),
  ]);
  if (cat === null) throw new UnknownCatalogTargetError('หมวด');
  if (project === null) throw new UnknownCatalogTargetError('โปรเจกต์');
  if (issueType === null) throw new UnknownCatalogTargetError('ประเภทงาน');
  if (input.priorityId !== undefined) {
    const p = await db.priority.findFirst({ where: { id: input.priorityId }, select: { id: true } });
    if (p === null) throw new UnknownCatalogTargetError('ระดับความสำคัญ');
  }

  if ((await db.catalogItem.findFirst({ where: { name }, select: { id: true } })) !== null) {
    throw new DuplicateCatalogNameError(name);
  }

  return auditedTransaction(ctx, 'catalog.item.create', async (tx) => {
    const i = await tx.catalogItem.create({
      data: {
        tenantId: ctx.tenantId,
        categoryId: input.categoryId,
        name,
        description: input.description?.trim() === '' ? null : (input.description ?? null),
        projectId: input.projectId,
        issueTypeId: input.issueTypeId,
        priorityId: input.priorityId ?? null,
        sortOrder: input.sortOrder ?? 100,
      },
      select: { id: true },
    });
    return {
      result: i,
      audit: [
        {
          kind: 'system',
          action: 'catalog.item.create',
          entityType: 'catalog_item',
          entityId: i.id.toString(),
          payload: { name, projectId: input.projectId.toString() },
        },
      ],
    };
  });
}

/**
 * เปิด/ปิดบริการ
 *
 * ปิด ไม่ใช่ลบ — เรื่องที่แจ้งผ่านบริการนี้ไปแล้วต้องยังตอบได้ว่ามาจากไหน
 * และการเลิกให้บริการอย่างหนึ่งไม่ควรลบประวัติของมันทิ้ง
 */
export async function setCatalogItemActive(
  ctx: TenantContext,
  id: bigint,
  isActive: boolean,
): Promise<void> {
  const db = tenantScoped(ctx);
  const item = await db.catalogItem.findFirst({ where: { id }, select: { id: true, name: true } });
  if (item === null) throw new CatalogItemNotFoundError();

  await auditedTransaction(ctx, 'catalog.item.active', async (tx) => {
    await tx.catalogItem.update({ where: { id }, data: { isActive } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'catalog.item.active',
          entityType: 'catalog_item',
          entityId: id.toString(),
          payload: { name: item.name, isActive },
        },
      ],
    };
  });
}

export async function deleteCatalogCategory(ctx: TenantContext, id: bigint): Promise<void> {
  const db = tenantScoped(ctx);
  const cat = await db.catalogCategory.findFirst({ where: { id }, select: { id: true, name: true } });
  if (cat === null) throw new CatalogItemNotFoundError();

  /*
    นับก่อนลบ และบอกจำนวนไปด้วย

    ฐานข้อมูลกันไว้ด้วย `onDelete: Restrict` อยู่แล้ว แต่ error ของ FK
    อ่านไม่ออก และไม่บอกว่าเหลืออยู่กี่รายการ ซึ่งเป็นสิ่งเดียวที่ผู้ดูแลต้องรู้
    เพื่อตัดสินใจว่าจะย้ายบริการไปหมวดอื่นหรือปิดทิ้ง
  */
  const inUse = await db.catalogItem.count({ where: { categoryId: id } });
  if (inUse > 0) throw new CategoryInUseError(inUse);

  await auditedTransaction(ctx, 'catalog.category.delete', async (tx) => {
    await tx.catalogCategory.delete({ where: { id } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'catalog.category.delete',
          entityType: 'catalog_category',
          entityId: id.toString(),
          payload: { name: cat.name },
        },
      ],
    };
  });
}

export interface CatalogTarget {
  itemId: bigint;
  name: string;
  projectId: bigint;
  projectKey: string;
  issueTypeId: bigint;
  issueTypeName: string;
  priorityId: number | null;
}

/**
 * ปลายทางของบริการหนึ่งรายการ สำหรับให้ฟอร์มแจ้งเรื่องตั้งค่าเริ่มต้น
 *
 * `browsableProjectIds` ต้องส่งเข้ามา ไม่ใช่คำนวณที่นี่ — โมดูล catalog
 * ถามโมดูล permission ตรง ๆ ไม่ได้ (ADR-004) และการปล่อยให้ค่านี้เป็นตัวเลือก
 * ที่ลืมส่งได้ คือการเปิดช่องให้หลุดขอบเขตอย่างเงียบ ๆ
 */
export async function catalogItemForReport(
  ctx: TenantContext,
  id: bigint,
  browsableProjectIds: readonly bigint[],
): Promise<CatalogTarget> {
  // ไม่มี early return ด้วยเหตุผลเดียวกับ `browseCatalog` — ดูคอมเมนต์ที่นั่น
  const item = await tenantScoped(ctx).catalogItem.findFirst({
    where: { id, isActive: true, projectId: { in: [...browsableProjectIds] } },
    include: { project: { select: { key: true } }, issueType: { select: { name: true } } },
  });
  if (item === null) throw new CatalogItemNotFoundError();
  return {
    itemId: item.id,
    name: item.name,
    projectId: item.projectId,
    projectKey: item.project.key,
    issueTypeId: item.issueTypeId,
    issueTypeName: item.issueType.name,
    priorityId: item.priorityId,
  };
}
