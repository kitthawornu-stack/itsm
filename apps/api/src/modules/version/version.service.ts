/**
 * รุ่นของโปรเจกต์ — ต่อฐานข้อมูล
 *
 * `release-plan.ts` ตัดสินว่าปล่อยได้หรือยังและบันทึกหน้าตาอย่างไร ·
 * ไฟล์นี้หาข้อมูลมาให้มันตัดสิน แล้วเขียนลงฐานข้อมูลพร้อมร่องรอย
 *
 * **สิทธิ์**: อ่านใช้ `BROWSE_PROJECT` · สร้าง/แก้/ปล่อย ใช้ `MANAGE_PROJECT`
 * เพราะรุ่นเป็นโครงของโปรเจกต์ ไม่ใช่ของงานใบใดใบหนึ่ง · ส่วนการ **ใส่งาน
 * เข้ารุ่น** ใช้ `EDIT_ITEM` เพราะเป็นการแก้งานใบนั้น (กติกาเดียวกับ `attachCi`)
 */
import { systemClock, toUtcDate, type TenantContext, type UtcDate } from '@itsm/types';

import { auditedTransaction, change } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan } from '../permission';
import {
  VERSION_STATE_LABEL,
  assertCanRelease,
  assertCanReopen,
  releaseNoteOf,
  versionStateOf,
  type ReleaseItem,
  type VersionRow,
} from './release-plan';

export class VersionNotFoundError extends Error {
  constructor() {
    super('ไม่พบรุ่นที่ระบุ');
    this.name = 'VersionNotFoundError';
  }
}

export class ProjectNotFoundForVersionError extends Error {
  constructor(key: string) {
    super(`ไม่พบโปรเจกต์ ${key}`);
    this.name = 'ProjectNotFoundForVersionError';
  }
}

export class VersionNameRequiredError extends Error {
  constructor() {
    super('ต้องตั้งชื่อรุ่น');
    this.name = 'VersionNameRequiredError';
  }
}

export class DuplicateVersionNameError extends Error {
  constructor(name: string) {
    super(`โปรเจกต์นี้มีรุ่นชื่อ "${name}" อยู่แล้ว`);
    this.name = 'DuplicateVersionNameError';
  }
}

export class ItemFromOtherProjectError extends Error {
  constructor() {
    super('งานอยู่คนละโปรเจกต์กับรุ่นนี้');
    this.name = 'ItemFromOtherProjectError';
  }
}

export class ItemNotFoundForVersionError extends Error {
  constructor(key: string) {
    super(`ไม่พบงาน ${key}`);
    this.name = 'ItemNotFoundForVersionError';
  }
}

export interface VersionView {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  releaseDate: string | null;
  releasedAt: string | null;
  archived: boolean;
  state: string;
  stateLabel: string;
  /** จำนวนงานในรุ่น แยกเสร็จ/ค้าง — ตัวเลขที่ตอบว่า "ปล่อยได้หรือยัง" */
  total: number;
  done: number;
}

const SELECT = {
  id: true,
  name: true,
  description: true,
  startDate: true,
  releaseDate: true,
  releasedAt: true,
  archived: true,
} as const;

function rowOf(r: {
  name: string;
  releaseDate: Date | null;
  releasedAt: Date | null;
  archived: boolean;
}): VersionRow {
  return {
    name: r.name,
    releaseDate: r.releaseDate === null ? null : toUtcDate(r.releaseDate),
    releasedAt: r.releasedAt === null ? null : toUtcDate(r.releasedAt),
    archived: r.archived,
  };
}

/*
  **ตัวช่วยเหล่านี้ไม่ตรวจสิทธิ์เอง** และไม่รับคีย์สิทธิ์เป็นพารามิเตอร์ ·
  ผู้เรียกต้องเรียกด่านตรวจเองโดยเขียนชื่อคีย์เป็นสตริงตรง ๆ ที่จุดเรียก

  เหตุผลไม่ใช่เรื่องสไตล์: `permission-coverage.spec.ts` สแกนซอร์สหาคีย์ที่เป็น
  **อาร์กิวเมนต์ของ `assertCan`/`can`** เพื่อบอกว่าคีย์ไหนบังคับใช้จริงแล้ว ·
  การซ่อนคีย์ไว้หลังพารามิเตอร์ของตัวช่วยทำให้ตัวสแกนมองไม่เห็น แล้ว
  `UNENFORCED_PERMISSIONS` จะบอกว่า "ยังไม่บังคับใช้" ต่อไปทั้งที่บังคับแล้ว
  — ซึ่งคือหน้าตั้งค่าที่โกหกโดยไม่มีใครรู้ · เจอตอนเขียนไฟล์นี้เอง
*/
async function projectFor(ctx: TenantContext, key: string): Promise<{ id: bigint }> {
  const project = await tenantScoped(ctx).project.findFirst({
    where: { key },
    select: { id: true },
  });
  if (project === null) throw new ProjectNotFoundForVersionError(key);
  return project;
}

async function versionFor(
  ctx: TenantContext,
  id: bigint,
): Promise<{ id: bigint; projectId: bigint; row: VersionRow }> {
  const v = await tenantScoped(ctx).projectVersion.findFirst({
    where: { id },
    select: { ...SELECT, projectId: true },
  });
  if (v === null) throw new VersionNotFoundError();
  return { id: v.id, projectId: v.projectId, row: rowOf(v) };
}

/** งานในรุ่น พร้อมสิ่งที่เอนจินต้องใช้ตัดสิน */
async function itemsOf(ctx: TenantContext, versionId: bigint): Promise<ReleaseItem[]> {
  const rows = await tenantScoped(ctx).workItemVersion.findMany({
    where: { versionId },
    select: {
      workItem: {
        select: {
          itemKey: true,
          summary: true,
          issueType: { select: { name: true } },
          status: { select: { category: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    itemKey: r.workItem.itemKey,
    summary: r.workItem.summary,
    issueType: r.workItem.issueType.name,
    /*
      **"เสร็จ" อ่านจากหมวดของสถานะ ไม่ใช่ `resolvedAt`** — งานที่ถูกปิดแล้ว
      เปิดใหม่จะมี `resolvedAt` ค้างอยู่ แล้วบันทึกการปล่อยจะนับมันว่าเสร็จ
    */
    done: r.workItem.status.category === 'DONE',
  }));
}

function toView(
  r: {
    id: bigint;
    name: string;
    description: string | null;
    startDate: Date | null;
    releaseDate: Date | null;
    releasedAt: Date | null;
    archived: boolean;
  },
  counts: { total: number; done: number },
  now: UtcDate,
): VersionView {
  const state = versionStateOf(rowOf(r), now);
  return {
    id: r.id.toString(),
    name: r.name,
    description: r.description,
    startDate: r.startDate?.toISOString() ?? null,
    releaseDate: r.releaseDate?.toISOString() ?? null,
    releasedAt: r.releasedAt?.toISOString() ?? null,
    archived: r.archived,
    state,
    stateLabel: VERSION_STATE_LABEL[state],
    ...counts,
  };
}

/**
 * รุ่นทั้งหมดของโปรเจกต์ — เรียงตามวันปล่อย รุ่นที่ไม่มีวันนัดไปท้าย
 *
 * นับงานด้วยคิวรีรวมครั้งเดียว (`groupBy`) ไม่ใช่ยิงต่อรุ่น · โปรเจกต์ที่มี
 * ยี่สิบรุ่นจะกลายเป็นสี่สิบคิวรีทันทีถ้าเขียนแบบหลัง
 */
export async function listVersions(
  ctx: TenantContext,
  projectKey: string,
  now: UtcDate = systemClock.nowUtc(),
): Promise<VersionView[]> {
  const project = await projectFor(ctx, projectKey);
  await assertCan(ctx, project.id, 'BROWSE_PROJECT');
  const db = tenantScoped(ctx);
  const rows = await db.projectVersion.findMany({
    where: { projectId: project.id },
    select: SELECT,
    orderBy: [{ releaseDate: 'asc' }, { name: 'asc' }],
  });
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const links = await db.workItemVersion.findMany({
    where: { versionId: { in: ids } },
    select: { versionId: true, workItem: { select: { status: { select: { category: true } } } } },
  });
  const counts = new Map<string, { total: number; done: number }>();
  for (const l of links) {
    const key = l.versionId.toString();
    const c = counts.get(key) ?? { total: 0, done: 0 };
    c.total += 1;
    if (l.workItem.status.category === 'DONE') c.done += 1;
    counts.set(key, c);
  }

  return rows.map((r) => toView(r, counts.get(r.id.toString()) ?? { total: 0, done: 0 }, now));
}

export interface VersionInput {
  name: string;
  description?: string | undefined;
  startDate?: string | undefined;
  releaseDate?: string | undefined;
}

function readDates(input: VersionInput): { startDate: Date | null; releaseDate: Date | null } {
  const parse = (v: string | undefined): Date | null => {
    if (v === undefined || v.trim() === '') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return { startDate: parse(input.startDate), releaseDate: parse(input.releaseDate) };
}

/**
 * @throws {VersionNameRequiredError} ชื่อว่างหรือช่องว่างล้วน
 * @throws {DuplicateVersionNameError} ชื่อซ้ำในโปรเจกต์เดียวกัน
 */
export async function createVersion(
  ctx: TenantContext,
  projectKey: string,
  input: VersionInput,
): Promise<{ id: bigint }> {
  const actorId = ctx.actorId;
  if (actorId === null) throw new ProjectNotFoundForVersionError(projectKey);
  const project = await projectFor(ctx, projectKey);
  await assertCan(ctx, project.id, 'MANAGE_PROJECT');

  const name = input.name.trim().slice(0, 128);
  if (name === '') throw new VersionNameRequiredError();
  const db = tenantScoped(ctx);
  const clash = await db.projectVersion.findFirst({
    where: { projectId: project.id, name },
    select: { id: true },
  });
  if (clash !== null) throw new DuplicateVersionNameError(name);

  const dates = readDates(input);
  return auditedTransaction(ctx, 'version.create', async (tx) => {
    const v = await tx.projectVersion.create({
      data: {
        tenantId: ctx.tenantId,
        projectId: project.id,
        name,
        description: input.description?.trim().slice(0, 1000) || null,
        ...dates,
        createdById: actorId,
      },
      select: { id: true },
    });
    return {
      result: { id: v.id },
      audit: [
        {
          kind: 'system' as const,
          action: 'version.create',
          entityType: 'project-version',
          entityId: v.id.toString(),
          payload: { projectKey, name },
        },
      ],
    };
  });
}

/**
 * ปล่อยรุ่น
 *
 * @throws {AlreadyReleasedError} ปล่อยไปแล้ว
 * @throws {UnfinishedItemsError} ยังมีงานที่ไม่อยู่ในหมวด DONE
 */
export async function releaseVersion(
  ctx: TenantContext,
  id: bigint,
  now: UtcDate = systemClock.nowUtc(),
): Promise<void> {
  const v = await versionFor(ctx, id);
  await assertCan(ctx, v.projectId, 'MANAGE_PROJECT');
  assertCanRelease(v.row, await itemsOf(ctx, id));

  await auditedTransaction(ctx, 'version.release', async (tx) => {
    await tx.projectVersion.update({ where: { id }, data: { releasedAt: now } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'version.release',
          entityType: 'project-version',
          entityId: id.toString(),
          payload: { name: v.row.name, releasedAt: now.toISOString() },
        },
      ],
    };
  });
}

/** เปิดรุ่นที่ปล่อยไปแล้วใหม่ — ปล่อยผิดรุ่นเกิดขึ้นจริง */
export async function reopenVersion(ctx: TenantContext, id: bigint): Promise<void> {
  const v = await versionFor(ctx, id);
  await assertCan(ctx, v.projectId, 'MANAGE_PROJECT');
  assertCanReopen(v.row);

  await auditedTransaction(ctx, 'version.reopen', async (tx) => {
    await tx.projectVersion.update({ where: { id }, data: { releasedAt: null } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'version.reopen',
          entityType: 'project-version',
          entityId: id.toString(),
          payload: { name: v.row.name, wasReleasedAt: v.row.releasedAt?.toISOString() ?? null },
        },
      ],
    };
  });
}

/**
 * ใส่งานเข้ารุ่น หรือเอาออก
 *
 * ใช้ `EDIT_ITEM` ไม่ใช่ `MANAGE_PROJECT` — เป็นการแก้งานใบนั้น
 * (กติกาเดียวกับ `attachCi`) · **ใส่ซ้ำไม่ใช่ความผิดพลาด** และต้องไม่เขียน
 * ประวัติเพิ่ม เพราะกดสองครั้งไม่ได้แปลว่าเกิดสองเหตุการณ์
 *
 * @throws {ItemFromOtherProjectError} งานอยู่คนละโปรเจกต์กับรุ่น
 */
export async function setItemVersion(
  ctx: TenantContext,
  itemKey: string,
  versionId: bigint,
  add: boolean,
): Promise<void> {
  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({
    where: { itemKey },
    select: { id: true, projectId: true },
  });
  if (item === null) throw new ItemNotFoundForVersionError(itemKey);
  await assertCan(ctx, item.projectId, 'EDIT_ITEM');

  const version = await db.projectVersion.findFirst({
    where: { id: versionId },
    select: { id: true, name: true, projectId: true },
  });
  if (version === null) throw new VersionNotFoundError();
  /*
    **รุ่นเป็นของโปรเจกต์** — ใส่งานข้ามโปรเจกต์เข้าไปได้เมื่อไร บันทึกการปล่อย
    จะมีงานที่ไม่มีใครในทีมนั้นรู้จัก และตัวกรอง `projectId` ที่หน้าจอใช้
    ก็จะเลือกมันไม่เจอ กลายเป็นงานที่มีอยู่แต่มองไม่เห็น
  */
  if (version.projectId !== item.projectId) throw new ItemFromOtherProjectError();

  const existing = await db.workItemVersion.findFirst({
    where: { workItemId: item.id, versionId },
    select: { id: true },
  });
  if (add === (existing !== null)) return;

  await auditedTransaction(ctx, add ? 'version.item.add' : 'version.item.remove', async (tx) => {
    if (add) {
      await tx.workItemVersion.create({
        data: { tenantId: ctx.tenantId, workItemId: item.id, versionId },
      });
    } else {
      await tx.workItemVersion.deleteMany({ where: { workItemId: item.id, versionId } });
    }
    return {
      result: undefined,
      audit: [
        change(item.id, 'fixVersion', add ? null : version.name, add ? version.name : null),
      ],
    };
  });
}

export interface ReleaseNoteView {
  name: string;
  releasedAt: string | null;
  groups: Array<{ issueType: string; items: Array<{ itemKey: string; summary: string }> }>;
  finished: number;
  unfinished: number;
}

/**
 * บันทึกการปล่อย — อ่านได้แม้ยังไม่ปล่อย (เป็นตัวอย่างว่าจะได้อะไร)
 *
 * **บอกจำนวนที่ยังไม่เสร็จเสมอ** แม้จะไม่ลงรายการ — ดู doc ของเอนจิน
 */
export async function releaseNote(
  ctx: TenantContext,
  id: bigint,
): Promise<ReleaseNoteView> {
  const v = await versionFor(ctx, id);
  await assertCan(ctx, v.projectId, 'BROWSE_PROJECT');
  const note = releaseNoteOf(v.row, await itemsOf(ctx, id));
  return {
    name: note.name,
    releasedAt: note.releasedAt?.toISOString() ?? null,
    groups: note.groups.map((g) => ({
      issueType: g.issueType,
      items: g.items.map((i) => ({ itemKey: i.itemKey, summary: i.summary })),
    })),
    finished: note.finished,
    unfinished: note.unfinished,
  };
}

/** รุ่นที่งานใบนี้อยู่ — ใช้บนหน้ารายละเอียด */
export async function versionsOfItem(
  ctx: TenantContext,
  itemKey: string,
  now: UtcDate = systemClock.nowUtc(),
): Promise<{ inVersions: VersionView[]; available: VersionView[] }> {
  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({
    where: { itemKey },
    select: { id: true, projectId: true, project: { select: { key: true } } },
  });
  if (item === null) throw new ItemNotFoundForVersionError(itemKey);
  await assertCan(ctx, item.projectId, 'BROWSE_PROJECT');

  const all = await listVersions(ctx, item.project.key, now);
  const mine = new Set(
    (
      await db.workItemVersion.findMany({
        where: { workItemId: item.id },
        select: { versionId: true },
      })
    ).map((r) => r.versionId.toString()),
  );
  return {
    inVersions: all.filter((v) => mine.has(v.id)),
    // รุ่นที่เก็บเข้าคลังแล้วไม่ควรโผล่ในตัวเลือก แต่ถ้างานอยู่ในนั้นอยู่แล้วต้องยังเห็น
    available: all.filter((v) => !mine.has(v.id) && !v.archived && v.releasedAt === null),
  };
}
