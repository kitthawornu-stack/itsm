/**
 * ตัวกรองด่วนของกระดาน — คิวรี HQL ที่ตั้งชื่อไว้
 *
 * **ตรวจว่าคิวรีแปลได้ตอนบันทึก ไม่ใช่ตอนใช้** · ตัวกรองที่พังตอนกดใช้
 * ทำให้กระดานทั้งหน้าใช้ไม่ได้ โดยที่คนกดไม่รู้ว่าต้นเหตุอยู่ที่การตั้งค่า
 * เมื่อเดือนก่อน และไม่รู้ว่าต้องไปแก้ที่ไหน
 *
 * **เก็บข้อความคิวรี ไม่ใช่เงื่อนไขที่แปลแล้ว** — การแปลเปลี่ยนได้เมื่อ
 * ตัวแปลเปลี่ยน แต่สิ่งที่ผู้ใช้เขียนคือเจตนา ซึ่งไม่ควรถูกเขียนทับด้วย
 * ผลการแปลของวันที่บันทึก
 */
import type { TenantContext } from '@itsm/types';
import {
  HqlFieldError,
  HqlSyntaxError,
  HqlUnsupportedInPrismaError,
  HqlComparisonUnsupportedError,
  HqlValueError,
  compilePrismaClause,
} from '@itsm/hql';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan, browsableProjectIds } from '../permission';

/** จำนวนตัวกรองต่อโปรเจกต์ · แถบปุ่มที่ยาวกว่านี้ไม่มีใครกวาดตาไหว */
export const MAX_QUICK_FILTERS = 12;

export class QuickFilterProjectNotFoundError extends Error {
  constructor() {
    super('ไม่พบโปรเจกต์นี้ หรือคุณยังเปิดดูไม่ได้');
  }
}

export class QuickFilterNotFoundError extends Error {
  constructor() {
    super('ไม่พบตัวกรองนี้');
  }
}

/**
 * คิวรีที่บันทึกไม่ได้
 *
 * ข้อความมาจากตัวแปล HQL ตรง ๆ เพราะมันรู้ว่าผิดตรงไหน ส่วนเราไม่รู้ ·
 * การแทนที่ด้วย "คิวรีไม่ถูกต้อง" ทำให้คนต้องเดาว่าผิดคำไหน
 */
export class InvalidQuickFilterError extends Error {}

export class TooManyQuickFiltersError extends Error {
  constructor() {
    super(
      `ตั้งตัวกรองด่วนได้ไม่เกิน ${String(MAX_QUICK_FILTERS)} อันต่อโปรเจกต์` +
        ' · ลบอันที่ไม่ได้ใช้ออกก่อน',
    );
  }
}

export interface QuickFilterRow {
  id: string;
  name: string;
  hql: string;
  position: number;
}

/**
 * ตรวจว่าคิวรีนี้ใช้เป็นตัวกรองบนกระดานได้จริง
 *
 * แปลงข้อผิดพลาดของ HQL เป็นข้อความที่ผู้ใช้อ่านแล้วรู้ว่าต้องแก้อะไร ·
 * **ไม่กลืน error ที่ไม่รู้จัก** — ข้อผิดพลาดที่ไม่ได้คาดไว้ต้องโผล่ขึ้นมา
 * ไม่ใช่ถูกแปลงเป็น "คิวรีไม่ถูกต้อง" ซึ่งซ่อนบั๊กของเราเอง
 */
export function assertUsableOnBoard(hql: string): void {
  try {
    compilePrismaClause(hql);
  } catch (e) {
    if (
      e instanceof HqlSyntaxError ||
      e instanceof HqlFieldError ||
      e instanceof HqlValueError ||
      e instanceof HqlUnsupportedInPrismaError ||
      e instanceof HqlComparisonUnsupportedError
    ) {
      throw new InvalidQuickFilterError(e.message);
    }
    throw e;
  }
}

async function projectOf(ctx: TenantContext, projectKey: string): Promise<bigint> {
  const allowed = await browsableProjectIds(ctx);
  const project =
    allowed.length === 0
      ? null
      : await tenantScoped(ctx).project.findFirst({
          where: { key: projectKey.trim(), id: { in: allowed } },
          select: { id: true },
        });
  if (project === null) throw new QuickFilterProjectNotFoundError();
  return project.id;
}

/**
 * ตัวกรองทั้งหมดของโปรเจกต์
 *
 * เรียงด้วย `position` แล้วต่อด้วย `id` — เลขลำดับซ้ำกันได้ และการเรียง
 * ที่ไม่คงที่ทำให้ปุ่มสลับที่กันเองระหว่างรีเฟรช ซึ่งอ่านเหมือนหน้าจอพัง
 */
export async function listQuickFilters(
  ctx: TenantContext,
  projectKey: string,
): Promise<QuickFilterRow[]> {
  const projectId = await projectOf(ctx, projectKey);
  const rows = await tenantScoped(ctx).boardQuickFilter.findMany({
    where: { projectId },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, hql: true, position: true },
  });
  // id เป็น string เสมอตอนออกจากชั้น service — `JSON.stringify` โยน TypeError กับ BigInt
  return rows.map((r) => ({ ...r, id: r.id.toString() }));
}

/**
 * สร้างตัวกรองใหม่
 *
 * ชื่อว่างเปล่าถูกปฏิเสธ — ปุ่มที่ไม่มีข้อความคือปุ่มที่ไม่มีใครรู้ว่ากดแล้วได้อะไร
 */
export async function createQuickFilter(
  ctx: TenantContext,
  projectKey: string,
  input: { name: string; hql: string },
): Promise<QuickFilterRow> {
  const projectId = await projectOf(ctx, projectKey);
  await assertCan(ctx, projectId, 'MANAGE_PROJECT');

  const name = input.name.trim();
  if (name === '') throw new InvalidQuickFilterError('ตั้งชื่อตัวกรองก่อน');
  const hql = input.hql.trim();
  if (hql === '') throw new InvalidQuickFilterError('ตัวกรองที่ไม่มีเงื่อนไข ไม่ได้กรองอะไรเลย');
  assertUsableOnBoard(hql);

  const db = tenantScoped(ctx);
  const existing = await db.boardQuickFilter.count({ where: { projectId } });
  if (existing >= MAX_QUICK_FILTERS) throw new TooManyQuickFiltersError();

  const row = await auditedTransaction(ctx, 'board.quick_filter.create', async (tx) => {
    const created = await tx.boardQuickFilter.create({
      data: { tenantId: ctx.tenantId, projectId, name, hql, position: existing },
      select: { id: true, name: true, hql: true, position: true },
    });
    return {
      result: created,
      audit: [
        {
          kind: 'system' as const,
          action: 'board.quick_filter.create',
          entityType: 'project',
          entityId: projectId.toString(),
          payload: { name, hql },
        },
      ],
    };
  });
  return { ...row, id: row.id.toString() };
}

/**
 * ลบตัวกรอง
 *
 * **ลบด้วย id ที่ระบุแถวเดียว** ไม่ใช่ `deleteMany` ด้วยเงื่อนไขช่วง —
 * `deleteMany` ที่ไม่ตรงแถวไหนเลยยังจับ gap lock ถึง supremum แล้วชนกับ
 * insert ของอีกทรานแซกชันจนเป็น deadlock (CLAUDE.md)
 */
export async function deleteQuickFilter(
  ctx: TenantContext,
  projectKey: string,
  id: string,
): Promise<void> {
  const projectId = await projectOf(ctx, projectKey);
  await assertCan(ctx, projectId, 'MANAGE_PROJECT');

  if (!/^\d+$/.test(id)) throw new QuickFilterNotFoundError();
  const db = tenantScoped(ctx);
  const row = await db.boardQuickFilter.findFirst({
    where: { id: BigInt(id), projectId },
    select: { id: true, name: true },
  });
  if (row === null) throw new QuickFilterNotFoundError();

  await auditedTransaction(ctx, 'board.quick_filter.delete', async (tx) => {
    await tx.boardQuickFilter.delete({ where: { id: row.id } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'board.quick_filter.delete',
          entityType: 'project',
          entityId: projectId.toString(),
          payload: { name: row.name },
        },
      ],
    };
  });
}

/**
 * เงื่อนไขของตัวกรองหนึ่ง สำหรับให้กระดานเอาไปใช้
 *
 * **อ่านได้ด้วยสิทธิ์เปิดดูโปรเจกต์** — ตัวกรองไม่ได้เปิดเผยอะไรที่คนเห็น
 * กระดานอยู่แล้วมองไม่เห็น · การตั้งค่าต่างหากที่ต้องมี `MANAGE_PROJECT`
 *
 * คืน `null` เมื่อคิวรีไม่กรองอะไร · **โยน error เมื่อแปลไม่ได้** ไม่ใช่คืน
 * `null` เงียบ ๆ — ตัวกรองที่ตั้งไว้แล้วแปลไม่ได้ ต้องบอก ไม่ใช่แสดงกระดาน
 * ทั้งใบเหมือนไม่ได้กรอง ซึ่งอ่านเหมือนตัวกรองทำงานแล้วไม่เจออะไรผิดปกติ
 */
export async function quickFilterClause(
  ctx: TenantContext,
  projectId: bigint,
  id: string,
): Promise<Record<string, unknown> | null> {
  if (!/^\d+$/.test(id)) throw new QuickFilterNotFoundError();
  const row = await tenantScoped(ctx).boardQuickFilter.findFirst({
    where: { id: BigInt(id), projectId },
    select: { hql: true },
  });
  if (row === null) throw new QuickFilterNotFoundError();
  assertUsableOnBoard(row.hql);
  return compilePrismaClause(row.hql);
}
