/**
 * CMDB — สิ่งที่ทีมไอทีดูแล และอะไรพึ่งอะไร
 *
 * **มีเพื่อตอบคำถามเดียว: "ถ้าตัวนี้ล่ม อะไรพังตามบ้าง"** · CMDB ที่เก็บ
 * ทุกรายละเอียดของทุกเครื่องกลายเป็นทะเบียนที่ไม่มีใครอัปเดต แล้วคำตอบที่ได้
 * ก็เชื่อไม่ได้อยู่ดี
 *
 * ตรรกะการไล่กราฟอยู่ใน `impact-graph.ts` เป็นฟังก์ชันบริสุทธิ์ ·
 * ไฟล์นี้อ่านของให้มัน แล้วแปลผลกลับเป็นชื่อที่คนอ่านออก
 *
 * ## กันวงจรตอนเขียน **และ** ตอนอ่าน
 *
 * ตอนเขียนกันเพื่อบอกผู้ดูแลทันทีว่าเส้นนี้ทำให้เกิดวงจร — ดีกว่าให้เขารู้
 * ตอนที่หน้าจอผลกระทบขึ้นธงสีแดงในอีกสามเดือน · ตอนอ่านกันเพราะข้อมูล
 * เข้ามาทาง SQL และการนำเข้าได้ด้วย ซึ่งไม่ผ่านชั้นนี้เลย
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertTenantAdmin } from '../permission';
import { impactOf, type CiEdge, type ImpactResult } from './impact-graph';

export type CiKindKey = 'SERVICE' | 'APPLICATION' | 'SERVER' | 'DATABASE' | 'NETWORK' | 'OTHER';
export type CiStatusKey = 'PLANNED' | 'ACTIVE' | 'RETIRED';

/** ป้ายภาษาคน — ไม่ใช่ศัพท์ระบบ (CLAUDE.md §5) */
export const CI_KIND_LABEL: Record<CiKindKey, string> = {
  SERVICE: 'บริการ',
  APPLICATION: 'แอปพลิเคชัน',
  SERVER: 'เครื่องแม่ข่าย',
  DATABASE: 'ฐานข้อมูล',
  NETWORK: 'อุปกรณ์เครือข่าย',
  OTHER: 'อื่น ๆ',
};

export const CI_STATUS_LABEL: Record<CiStatusKey, string> = {
  PLANNED: 'ยังไม่ขึ้นใช้',
  ACTIVE: 'ใช้งานอยู่',
  RETIRED: 'เลิกใช้แล้ว',
};

export class CiKeyRequiredError extends Error {
  constructor() {
    super('ต้องระบุรหัสและชื่อของสิ่งที่ดูแล');
    this.name = 'CiKeyRequiredError';
  }
}

export class DuplicateCiKeyError extends Error {
  constructor(readonly ciKey: string) {
    super(`มีรหัส "${ciKey}" อยู่แล้ว`);
    this.name = 'DuplicateCiKeyError';
  }
}

export class CiNotFoundError extends Error {
  constructor() {
    super('ไม่พบสิ่งที่ดูแลที่ระบุ');
    this.name = 'CiNotFoundError';
  }
}

export class SelfDependencyError extends Error {
  constructor() {
    super('สิ่งหนึ่งพึ่งพาตัวเองไม่ได้');
    this.name = 'SelfDependencyError';
  }
}

/**
 * เส้นนี้ทำให้เกิดวงจร
 *
 * ข้อความบอก**เส้นทางที่วนกลับมา** ไม่ใช่แค่ "เกิดวงจร" — ผู้ดูแลต้องรู้ว่า
 * ต้องไปแก้เส้นไหน ซึ่งอาจเป็นเส้นที่คนอื่นกรอกไว้เมื่อหกเดือนก่อน
 */
export class DependencyCycleError extends Error {
  constructor(readonly path: readonly string[]) {
    super(`เส้นนี้ทำให้เกิดวงจร: ${path.join(' → ')}`);
    this.name = 'DependencyCycleError';
  }
}

export interface CiView {
  id: string;
  key: string;
  name: string;
  kind: CiKindKey;
  kindLabel: string;
  status: CiStatusKey;
  statusLabel: string;
  ownerGroup: string | null;
  notes: string | null;
  dependsOnCount: number;
  usedByCount: number;
}

function toView(row: {
  id: bigint;
  key: string;
  name: string;
  kind: CiKindKey;
  status: CiStatusKey;
  notes: string | null;
  ownerGroup: { name: string } | null;
  _count: { dependsOn: number; usedBy: number };
}): CiView {
  return {
    id: row.id.toString(),
    key: row.key,
    name: row.name,
    kind: row.kind,
    kindLabel: CI_KIND_LABEL[row.kind],
    status: row.status,
    statusLabel: CI_STATUS_LABEL[row.status],
    ownerGroup: row.ownerGroup?.name ?? null,
    notes: row.notes,
    dependsOnCount: row._count.dependsOn,
    usedByCount: row._count.usedBy,
  };
}

const SELECT = {
  id: true,
  key: true,
  name: true,
  kind: true,
  status: true,
  notes: true,
  ownerGroup: { select: { name: true } },
  _count: { select: { dependsOn: true, usedBy: true } },
} as const;

/** รายการทั้งหมด — เรียงตามรหัส เพราะคนจำรหัสได้ ไม่ใช่ลำดับที่สร้าง */
export async function listCis(ctx: TenantContext): Promise<CiView[]> {
  const rows = await tenantScoped(ctx).configurationItem.findMany({
    orderBy: { key: 'asc' },
    select: SELECT,
  });
  return rows.map(toView);
}

export interface CiInput {
  key: string;
  name: string;
  kind: CiKindKey;
  status?: CiStatusKey;
  ownerGroupId?: string | null;
  notes?: string | null;
}

function clean(input: CiInput): {
  key: string;
  name: string;
  kind: CiKindKey;
  status: CiStatusKey;
  notes: string | null;
} {
  const key = input.key.trim();
  const name = input.name.trim();
  if (key === '' || name === '') throw new CiKeyRequiredError();
  const notes = input.notes?.trim();
  return {
    key,
    name,
    kind: input.kind,
    status: input.status ?? 'ACTIVE',
    notes: notes === undefined || notes === '' ? null : notes,
  };
}

export async function createCi(ctx: TenantContext, input: CiInput): Promise<{ id: bigint }> {
  await assertTenantAdmin(ctx);
  const v = clean(input);
  const db = tenantScoped(ctx);

  // ดักด้วยโค้ดก่อน แล้วให้ unique index เป็นด่านสุดท้าย — ข้อความจากฐานข้อมูล
  // อ่านไม่รู้เรื่องสำหรับผู้ดูแล
  const clash = await db.configurationItem.findFirst({ where: { key: v.key }, select: { id: true } });
  if (clash !== null) throw new DuplicateCiKeyError(v.key);

  return auditedTransaction(ctx, 'cmdb.ci.create', async (tx) => {
    const row = await tx.configurationItem.create({
      data: {
        tenantId: ctx.tenantId,
        ...v,
        ownerGroupId:
          input.ownerGroupId === undefined || input.ownerGroupId === null || input.ownerGroupId === ''
            ? null
            : BigInt(input.ownerGroupId),
      },
      select: { id: true },
    });
    return {
      result: { id: row.id },
      audit: [
        {
          kind: 'system' as const,
          action: 'cmdb.ci.create',
          entityType: 'configuration-item',
          entityId: row.id.toString(),
          payload: { key: v.key, name: v.name, kind: v.kind },
        },
      ],
    };
  });
}

export async function updateCi(ctx: TenantContext, id: bigint, input: CiInput): Promise<void> {
  await assertTenantAdmin(ctx);
  const v = clean(input);
  const db = tenantScoped(ctx);
  const existing = await db.configurationItem.findFirst({ where: { id }, select: { key: true } });
  if (existing === null) throw new CiNotFoundError();

  const clash = await db.configurationItem.findFirst({
    where: { key: v.key, id: { not: id } },
    select: { id: true },
  });
  if (clash !== null) throw new DuplicateCiKeyError(v.key);

  await auditedTransaction(ctx, 'cmdb.ci.update', async (tx) => {
    await tx.configurationItem.update({
      where: { id },
      data: {
        ...v,
        ownerGroupId:
          input.ownerGroupId === undefined || input.ownerGroupId === null || input.ownerGroupId === ''
            ? null
            : BigInt(input.ownerGroupId),
      },
    });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'cmdb.ci.update',
          entityType: 'configuration-item',
          entityId: id.toString(),
          payload: { from: existing.key, to: v.key, name: v.name },
        },
      ],
    };
  });
}

/**
 * ลบสิ่งที่ดูแล
 *
 * ความสัมพันธ์ที่ชี้เข้าและออกหายตามด้วย (`onDelete: Cascade`) —
 * **จำนวนที่จะหายต้องบอกใน audit** เพราะคำถาม "ทำไมกราฟถึงขาดตรงนี้"
 * ถามย้อนหลังเสมอ
 */
export async function deleteCi(ctx: TenantContext, id: bigint): Promise<void> {
  await assertTenantAdmin(ctx);
  const db = tenantScoped(ctx);
  const existing = await db.configurationItem.findFirst({
    where: { id },
    select: { key: true, name: true, _count: { select: { dependsOn: true, usedBy: true } } },
  });
  if (existing === null) throw new CiNotFoundError();

  await auditedTransaction(ctx, 'cmdb.ci.delete', async (tx) => {
    await tx.configurationItem.deleteMany({ where: { id } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'cmdb.ci.delete',
          entityType: 'configuration-item',
          entityId: id.toString(),
          payload: {
            key: existing.key,
            name: existing.name,
            removedEdges: existing._count.dependsOn + existing._count.usedBy,
          },
        },
      ],
    };
  });
}

/** ทุกเส้นในองค์กร — กราฟขนาดนี้อ่านทั้งก้อนถูกกว่าไล่ทีละชั้น */
async function allEdges(ctx: TenantContext): Promise<CiEdge[]> {
  const rows = await tenantScoped(ctx).ciDependency.findMany({
    select: { dependentId: true, dependsOnId: true },
  });
  return rows.map((r) => ({
    dependentId: r.dependentId.toString(),
    dependsOnId: r.dependsOnId.toString(),
  }));
}

/**
 * เพิ่มเส้นพึ่งพา
 *
 * @throws {SelfDependencyError} เมื่อชี้หาตัวเอง
 * @throws {DependencyCycleError} เมื่อเส้นนี้ทำให้เกิดวงจร
 */
export async function addDependency(
  ctx: TenantContext,
  dependentId: bigint,
  dependsOnId: bigint,
): Promise<void> {
  await assertTenantAdmin(ctx);
  if (dependentId === dependsOnId) throw new SelfDependencyError();
  const db = tenantScoped(ctx);

  const both = await db.configurationItem.findMany({
    where: { id: { in: [dependentId, dependsOnId] } },
    select: { id: true, key: true },
  });
  if (both.length !== 2) throw new CiNotFoundError();
  const nameOf = new Map(both.map((b) => [b.id.toString(), b.key]));

  /*
    **ตรวจวงจรก่อนเขียน** โดยถามเอนจินตัวเดียวกับที่หน้าจอผลกระทบใช้ ·
    ถ้า `dependsOn` พังแล้ว `dependent` พังตาม — เส้นนี้จึงเป็นวงจรก็ต่อเมื่อ
    `dependsOn` อยู่ในรายชื่อที่พังตามเมื่อ `dependent` ล่มอยู่แล้ว
  */
  const edges = await allEdges(ctx);
  const already = impactOf(dependentId.toString(), edges);
  if (already.affected.some((a) => a.id === dependsOnId.toString())) {
    const keys = await db.configurationItem.findMany({
      where: { id: { in: [dependentId, dependsOnId] } },
      select: { key: true },
    });
    throw new DependencyCycleError(keys.map((k) => k.key));
  }

  await auditedTransaction(ctx, 'cmdb.dependency.add', async (tx) => {
    await tx.ciDependency.create({ data: { tenantId: ctx.tenantId, dependentId, dependsOnId } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'cmdb.dependency.add',
          entityType: 'ci-dependency',
          entityId: `${dependentId.toString()}-${dependsOnId.toString()}`,
          payload: {
            dependent: nameOf.get(dependentId.toString()) ?? '',
            dependsOn: nameOf.get(dependsOnId.toString()) ?? '',
          },
        },
      ],
    };
  });
}

export async function removeDependency(
  ctx: TenantContext,
  dependentId: bigint,
  dependsOnId: bigint,
): Promise<void> {
  await assertTenantAdmin(ctx);
  const existing = await tenantScoped(ctx).ciDependency.findFirst({
    where: { dependentId, dependsOnId },
    select: { id: true },
  });
  if (existing === null) throw new CiNotFoundError();

  await auditedTransaction(ctx, 'cmdb.dependency.remove', async (tx) => {
    await tx.ciDependency.deleteMany({ where: { dependentId, dependsOnId } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'cmdb.dependency.remove',
          entityType: 'ci-dependency',
          entityId: `${dependentId.toString()}-${dependsOnId.toString()}`,
        },
      ],
    };
  });
}

export interface ImpactView {
  root: { id: string; key: string; name: string };
  affected: Array<{ id: string; key: string; name: string; kindLabel: string; distance: number }>;
  truncated: number;
  hasCycle: boolean;
}

/** ถ้าตัวนี้ล่ม อะไรพังตามบ้าง */
export async function impactOfCi(ctx: TenantContext, id: bigint): Promise<ImpactView> {
  const db = tenantScoped(ctx);
  const root = await db.configurationItem.findFirst({
    where: { id },
    select: { id: true, key: true, name: true },
  });
  if (root === null) throw new CiNotFoundError();

  const result: ImpactResult = impactOf(id.toString(), await allEdges(ctx));
  const ids = result.affected.map((a) => BigInt(a.id));
  const rows =
    ids.length === 0
      ? []
      : await db.configurationItem.findMany({
          where: { id: { in: ids } },
          select: { id: true, key: true, name: true, kind: true },
        });
  const byId = new Map(rows.map((r) => [r.id.toString(), r]));

  return {
    root: { id: root.id.toString(), key: root.key, name: root.name },
    /*
      เรียงตามที่เอนจินคืนมา (ใกล้ไปไกล) ไม่เรียงใหม่ตามผลของฐานข้อมูล —
      ลำดับคือคำตอบส่วนหนึ่ง ไม่ใช่การจัดหน้าจอ
    */
    affected: result.affected.flatMap((a) => {
      const row = byId.get(a.id);
      // แถวที่หายไประหว่างอ่าน (ถูกลบพร้อมกัน) ต้องไม่กลายเป็นบรรทัดว่าง
      if (row === undefined) return [];
      return [
        {
          id: a.id,
          key: row.key,
          name: row.name,
          kindLabel: CI_KIND_LABEL[row.kind],
          distance: a.distance,
        },
      ];
    }),
    truncated: result.truncated,
    hasCycle: result.hasCycle,
  };
}
