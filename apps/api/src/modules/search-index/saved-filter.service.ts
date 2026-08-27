/**
 * ตัวกรองที่บันทึกไว้
 *
 * เก็บ **ข้อความ HQL ที่ผู้ใช้พิมพ์** ไม่ใช่ DSL ที่แปลแล้ว · DSL ที่แปลไว้
 * จะค้างอยู่กับกติกาของวันที่บันทึก และเมื่อภาษาเพิ่มฟิลด์หรือแก้เกณฑ์การค้นหา
 * ตัวกรองเก่าจะยังทำงานด้วยกติกาเดิมเงียบ ๆ โดยไม่มีใครรู้ว่าผลที่เห็นมาจากอะไร
 *
 * **ตัวกรองที่แชร์ ทำงานด้วยขอบเขตของคนที่กด ไม่ใช่ของเจ้าของ**
 * ขอบเขตถูกประกอบตอน `compile` ทุกครั้งที่รัน (ดู packages/hql) — ตัวกรองจึงเป็น
 * แค่ข้อความ ไม่ได้พกสิทธิ์ของใครติดไปด้วย · ถ้าเก็บ DSL ที่ประกอบขอบเขตไว้แล้ว
 * การแชร์ตัวกรองจะกลายเป็นการแชร์สิทธิ์ของเจ้าของ ซึ่งเป็นช่องโหว่ที่มองไม่เห็น
 */
import type { TenantContext } from '@itsm/types';
import { compile } from '@itsm/hql';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

export class FilterNameRequiredError extends Error {
  constructor() {
    super('ต้องตั้งชื่อตัวกรอง');
    this.name = 'FilterNameRequiredError';
  }
}

export class DuplicateFilterNameError extends Error {
  constructor(readonly given: string) {
    super(`คุณมีตัวกรองชื่อ "${given}" อยู่แล้ว`);
    this.name = 'DuplicateFilterNameError';
  }
}

export class FilterNotFoundError extends Error {
  constructor(id: bigint) {
    super(`ไม่พบตัวกรอง #${id.toString()}`);
    this.name = 'FilterNotFoundError';
  }
}

export class NotFilterOwnerError extends Error {
  constructor(readonly ownerName: string) {
    super(`ตัวกรองนี้เป็นของ ${ownerName} — แก้หรือลบได้เฉพาะเจ้าของ`);
    this.name = 'NotFilterOwnerError';
  }
}

export class InvalidFilterQueryError extends Error {
  constructor(readonly reason: string) {
    super(`คิวรีใช้ไม่ได้: ${reason}`);
    this.name = 'InvalidFilterQueryError';
  }
}

const NAME_MAX = 128;
const HQL_MAX = 2000;

export interface SavedFilterRow {
  id: string;
  name: string;
  hql: string;
  isShared: boolean;
  owner: string;
  isMine: boolean;
}

/**
 * ตรวจว่าคิวรีแปลได้ **ก่อนบันทึก**
 *
 * ตัวกรองที่บันทึกไว้ทั้งที่แปลไม่ได้ คือกับดักที่รอคนกดในวันข้างหน้า —
 * และคนที่กดจะไม่ใช่คนที่พิมพ์ผิด · ขอบเขตที่ใส่ตอนตรวจเป็นค่าอะไรก็ได้
 * เพราะเรากำลังตรวจ **ไวยากรณ์และชื่อฟิลด์** ไม่ใช่ผลลัพธ์
 */
function assertCompiles(hql: string): void {
  try {
    compile(hql, { tenantId: '0', browsableProjectIds: [] });
  } catch (e) {
    throw new InvalidFilterQueryError(e instanceof Error ? e.message : String(e));
  }
}

/** ตัวกรองที่ผู้ใช้คนนี้เห็น — ของตัวเอง และของคนอื่นที่แชร์ไว้ */
export async function listSavedFilters(ctx: TenantContext): Promise<SavedFilterRow[]> {
  const rows = await tenantScoped(ctx).savedFilter.findMany({
    where: { OR: [{ ownerId: ctx.actorId ?? BigInt(0) }, { isShared: true }] },
    orderBy: [{ name: 'asc' }],
    include: { owner: { select: { displayName: true } } },
  });
  return rows.map((f) => ({
    id: f.id.toString(),
    name: f.name,
    hql: f.hql,
    isShared: f.isShared,
    owner: f.owner.displayName,
    isMine: f.ownerId === ctx.actorId,
  }));
}

export async function createSavedFilter(
  ctx: TenantContext,
  rawName: string,
  rawHql: string,
  isShared: boolean,
): Promise<{ id: bigint }> {
  if (ctx.actorId === null) throw new FilterNameRequiredError();
  const db = tenantScoped(ctx);

  const name = (typeof rawName === 'string' ? rawName : '').trim().slice(0, NAME_MAX);
  if (name === '') throw new FilterNameRequiredError();
  const hql = (typeof rawHql === 'string' ? rawHql : '').trim().slice(0, HQL_MAX);
  assertCompiles(hql);

  const clash = await db.savedFilter.findFirst({
    where: { ownerId: ctx.actorId, name },
    select: { id: true },
  });
  if (clash !== null) throw new DuplicateFilterNameError(name);

  return auditedTransaction(ctx, 'filter.create', async (tx) => {
    const f = await tx.savedFilter.create({
      data: { tenantId: ctx.tenantId, ownerId: ctx.actorId ?? BigInt(0), name, hql, isShared },
      select: { id: true },
    });
    return {
      result: f,
      audit: [
        {
          kind: 'system',
          action: 'filter.create',
          entityType: 'saved_filter',
          entityId: f.id.toString(),
          payload: { name, hql, isShared },
        },
      ],
    };
  });
}

/** เจ้าของเท่านั้นที่แก้หรือลบได้ — คนอื่นเห็นและใช้ได้ แต่แตะไม่ได้ */
async function ownedByActor(
  ctx: TenantContext,
  id: bigint,
): Promise<{ id: bigint; name: string }> {
  const f = await tenantScoped(ctx).savedFilter.findFirst({
    where: { id },
    include: { owner: { select: { displayName: true } } },
  });
  if (f === null) throw new FilterNotFoundError(id);
  if (f.ownerId !== ctx.actorId) throw new NotFilterOwnerError(f.owner.displayName);
  return { id: f.id, name: f.name };
}

export async function updateSavedFilter(
  ctx: TenantContext,
  id: bigint,
  changes: { hql?: string; isShared?: boolean },
): Promise<void> {
  const f = await ownedByActor(ctx, id);
  const data: Record<string, unknown> = {};
  if (changes.hql !== undefined) {
    const hql = changes.hql.trim().slice(0, HQL_MAX);
    // ตรวจก่อนบันทึกเสมอ รวมตอนแก้ — ตัวกรองที่เคยใช้ได้แล้วถูกแก้จนพัง
    // เป็นกับดักเดียวกับตอนสร้าง แต่หลอกกว่าเพราะเคยทำงานได้มาก่อน
    assertCompiles(hql);
    data['hql'] = hql;
  }
  if (changes.isShared !== undefined) data['isShared'] = changes.isShared;
  if (Object.keys(data).length === 0) return;

  await auditedTransaction(ctx, 'filter.update', async (tx) => {
    await tx.savedFilter.update({ where: { id }, data });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'filter.update',
          entityType: 'saved_filter',
          entityId: id.toString(),
          payload: { name: f.name, ...data },
        },
      ],
    };
  });
}

export async function deleteSavedFilter(ctx: TenantContext, id: bigint): Promise<void> {
  const f = await ownedByActor(ctx, id);
  await auditedTransaction(ctx, 'filter.delete', async (tx) => {
    await tx.savedFilter.delete({ where: { id } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'filter.delete',
          entityType: 'saved_filter',
          entityId: id.toString(),
          payload: { name: f.name },
        },
      ],
    };
  });
}
