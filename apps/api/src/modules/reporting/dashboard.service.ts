/**
 * แดชบอร์ดที่จัดวางเอง
 *
 * ชั้นนี้ทำสามอย่าง: อ่านความตั้งใจจากฐานข้อมูล · ให้ `resolveLayout` ตัดสินว่า
 * อะไรเรนเดอร์ได้จริงวันนี้ · แล้วดึงข้อมูลให้เฉพาะส่วนที่รอด
 *
 * ## หนึ่งขอบเขต หนึ่งชุดคิวรี ไม่ใช่หนึ่งการ์ดหนึ่งชุด
 *
 * การ์ดสี่ใบที่ถามโปรเจกต์เดียวกัน ใช้ผลชุดเดียวกัน · ถ้าปล่อยให้แต่ละใบยิงเอง
 * หน้าที่มีสิบการ์ดจะยิงสิบรอบ ทั้งที่ตอบคำถามเดียวกันแปดรอบ — และคนที่เจอ
 * ไม่ใช่คนที่เขียนโค้ด แต่เป็นคนที่เปิดหน้านี้ทุกเช้าพร้อมกันทั้งทีม
 *
 * ## หน้าเริ่มต้นไม่ต้องมีแถวในฐานข้อมูล
 *
 * `openDashboard(ctx, null)` คืนหน้าเริ่มต้นโดยไม่สร้างอะไร · การบังคับให้
 * ระบบสร้างแถวก่อนคนจะได้ "ดู" แปลว่าการเข้าหน้าจอกลายเป็นการเขียนข้อมูล
 * ซึ่งพังทันทีเมื่อคนที่ไม่มีสิทธิ์เขียนเปิดหน้านี้
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import {
  KNOWN_GADGET_KINDS,
  MAX_GADGETS,
  defaultLayout,
  moveGadget,
  resolveLayout,
  type DroppedGadget,
  type GadgetKind,
  type GadgetSpec,
  type Layout,
} from './dashboard-layout';
import { reportSummary, reportableProjectIds, type ReportSummary } from './report.service';
import { windowFor, type RangeKey } from './report-window';

/**
 * ป้ายภาษาคนของการ์ดแต่ละชนิด
 *
 * ประกาศเป็น `Record<GadgetKind, string>` **โดยตั้งใจ** — เพิ่มชนิดใหม่ในเอนจิน
 * แล้วลืมตั้งชื่อ จะเป็น type error ไม่ใช่การ์ดที่ขึ้นหน้าจอโดยไม่มีชื่อ
 *
 * อยู่ที่นี่ไม่ใช่ในเอนจิน เพราะเอนจินไม่ควรรู้จักภาษาที่คนอ่าน
 */
export const GADGET_LABEL: Record<GadgetKind, string> = {
  summary: 'ยอดรวมของช่วง',
  daily: 'เปิดเทียบปิด รายวัน',
  'by-priority': 'แยกตามความสำคัญ',
  'by-assignee': 'แยกตามผู้รับผิดชอบ',
  breached: 'หลุด SLA ในช่วงนี้',
};

const NAME_MAX = 128;
/** จำนวนหน้าต่อคน — กันคนสร้างทิ้งไว้จนตัวเลือกยาวเกินอ่าน */
export const MAX_DASHBOARDS_PER_USER = 20;

export class DashboardNameRequiredError extends Error {
  constructor() {
    super('ต้องตั้งชื่อแดชบอร์ด');
    this.name = 'DashboardNameRequiredError';
  }
}

export class DuplicateDashboardNameError extends Error {
  constructor(readonly given: string) {
    super(`คุณมีแดชบอร์ดชื่อ "${given}" อยู่แล้ว`);
    this.name = 'DuplicateDashboardNameError';
  }
}

export class DashboardNotFoundError extends Error {
  constructor(id: bigint) {
    super(`ไม่พบแดชบอร์ด #${id.toString()}`);
    this.name = 'DashboardNotFoundError';
  }
}

export class NotDashboardOwnerError extends Error {
  constructor(readonly ownerName: string) {
    super(`แดชบอร์ดนี้เป็นของ ${ownerName} — แก้ได้เฉพาะเจ้าของ`);
    this.name = 'NotDashboardOwnerError';
  }
}

export class TooManyDashboardsError extends Error {
  constructor() {
    super(`สร้างได้สูงสุด ${String(MAX_DASHBOARDS_PER_USER)} หน้าต่อคน`);
    this.name = 'TooManyDashboardsError';
  }
}

export class TooManyGadgetsError extends Error {
  constructor() {
    super(`หน้าหนึ่งมีการ์ดได้สูงสุด ${String(MAX_GADGETS)} ใบ`);
    this.name = 'TooManyGadgetsError';
  }
}

export class UnknownGadgetKindError extends Error {
  constructor(readonly given: string) {
    super(`ไม่รู้จักการ์ดชนิด "${given}"`);
    this.name = 'UnknownGadgetKindError';
  }
}

export interface DashboardRow {
  id: string;
  name: string;
  isShared: boolean;
  owner: string;
  isMine: boolean;
  gadgetCount: number;
}

/** ข้อมูลของการ์ดหนึ่งใบ — `null` เมื่อดึงไม่ได้ (ดู `summariesFor`) */
export interface GadgetView {
  id: string;
  kind: string;
  column: number;
  row: number;
  title: string | null;
  projectId: string | null;
  data: ReportSummary | null;
}

export interface DashboardView {
  /** `null` = หน้าเริ่มต้นที่ยังไม่ได้บันทึกลงฐานข้อมูล */
  id: string | null;
  name: string;
  columns: number;
  isShared: boolean;
  isMine: boolean;
  gadgets: GadgetView[];
  dropped: DroppedGadget[];
  range: RangeKey;
}

function cleanName(raw: unknown): string {
  const n = (typeof raw === 'string' ? raw : '').trim().slice(0, NAME_MAX);
  if (n === '') throw new DashboardNameRequiredError();
  return n;
}

/** หน้าที่คนนี้เห็น — ของตัวเอง และของคนอื่นที่แชร์ไว้ */
export async function listDashboards(ctx: TenantContext): Promise<DashboardRow[]> {
  const rows = await tenantScoped(ctx).dashboard.findMany({
    where: { OR: [{ ownerId: ctx.actorId ?? BigInt(0) }, { isShared: true }] },
    orderBy: [{ name: 'asc' }],
    include: {
      owner: { select: { displayName: true } },
      _count: { select: { gadgets: true } },
    },
  });
  return rows.map((d) => ({
    id: d.id.toString(),
    name: d.name,
    isShared: d.isShared,
    owner: d.owner.displayName,
    isMine: d.ownerId === ctx.actorId,
    gadgetCount: d._count.gadgets,
  }));
}

interface LoadedDashboard {
  id: bigint;
  name: string;
  isShared: boolean;
  ownerId: bigint;
  ownerName: string;
  layout: Layout;
}

/**
 * อ่านหน้าหนึ่งพร้อมการ์ด **เรียงตาม `position` ไม่ใช่ตาม id**
 *
 * เอนจินอ่านลำดับที่เก็บไว้เป็นความหมาย · ถ้าเรียงด้วย id การย้ายการ์ดจะไม่มีผล
 * อะไรเลยหลังรีเฟรช ซึ่งดูเหมือนปุ่มเสีย ไม่ใช่ลำดับผิด
 */
async function loadDashboard(ctx: TenantContext, id: bigint): Promise<LoadedDashboard> {
  const d = await tenantScoped(ctx).dashboard.findFirst({
    where: { id, OR: [{ ownerId: ctx.actorId ?? BigInt(0) }, { isShared: true }] },
    include: {
      owner: { select: { displayName: true } },
      gadgets: { orderBy: { position: 'asc' } },
    },
  });
  if (d === null) throw new DashboardNotFoundError(id);
  return {
    id: d.id,
    name: d.name,
    isShared: d.isShared,
    ownerId: d.ownerId,
    ownerName: d.owner.displayName,
    layout: {
      columns: d.columns,
      gadgets: d.gadgets.map((x) => ({
        id: x.id.toString(),
        kind: x.kind,
        column: x.colIndex,
        projectId: x.projectId?.toString() ?? null,
        title: x.title,
      })),
    },
  };
}

/**
 * ดึงยอดของทุกขอบเขตที่หน้านี้ต้องใช้ — ขอบเขตละครั้งเดียว
 *
 * การ์ดที่ดึงไม่สำเร็จได้ `null` ไม่ใช่ทำให้ทั้งหน้าล้ม · หน้าที่ว่างทั้งหน้า
 * เพราะการ์ดใบเดียวมีปัญหา แย่กว่าหน้าที่มีช่องว่างหนึ่งช่องพร้อมคำอธิบาย
 */
async function summariesFor(
  ctx: TenantContext,
  projectIds: ReadonlySet<string | null>,
  range: RangeKey,
  now: UtcDate,
): Promise<Map<string | null, ReportSummary | null>> {
  const win = windowFor(range, now);
  const out = new Map<string | null, ReportSummary | null>();
  await Promise.all(
    [...projectIds].map(async (pid) => {
      try {
        out.set(pid, await reportSummary(ctx, win, pid === null ? undefined : BigInt(pid)));
      } catch {
        out.set(pid, null);
      }
    }),
  );
  return out;
}

/**
 * เปิดหน้าหนึ่ง — `id` เป็น `null` แปลว่าหน้าเริ่มต้นที่ยังไม่ได้บันทึก
 *
 * "ตอนนี้" ส่งเข้ามาได้เพื่อให้เทสต์เลือกช่วงเวลาเองได้ กติกาเดียวกับ SLA
 */
export async function openDashboard(
  ctx: TenantContext,
  id: bigint | null,
  range: RangeKey,
  now: UtcDate = systemClock.nowUtc(),
): Promise<DashboardView> {
  const loaded = id === null ? null : await loadDashboard(ctx, id);
  const layout = loaded?.layout ?? defaultLayout();
  const visibleProjectIds = (await reportableProjectIds(ctx)).map((x) => x.toString());

  const resolved = resolveLayout({
    layout,
    knownKinds: KNOWN_GADGET_KINDS,
    visibleProjectIds,
    // หน้าเริ่มต้นถือว่าเป็นของคนที่เปิดเสมอ — มันถูกสร้างให้เขาเดี๋ยวนั้น
    ownsLayout: loaded === null || loaded.ownerId === ctx.actorId,
  });

  const scopes = new Set(resolved.gadgets.map((g) => g.projectId));
  const summaries = await summariesFor(ctx, scopes, range, now);

  return {
    id: loaded?.id.toString() ?? null,
    name: loaded?.name ?? 'ภาพรวม',
    columns: resolved.columns,
    isShared: loaded?.isShared ?? false,
    isMine: loaded === null || loaded.ownerId === ctx.actorId,
    gadgets: resolved.gadgets.map((g) => ({
      id: g.id,
      kind: g.kind,
      column: g.column,
      row: g.row,
      title: g.title,
      projectId: g.projectId,
      data: summaries.get(g.projectId) ?? null,
    })),
    dropped: resolved.dropped,
    range,
  };
}

/** เจ้าของเท่านั้นที่แก้ได้ — คนอื่นเปิดดูหน้าที่แชร์ได้ แต่แตะไม่ได้ */
async function ownedByActor(ctx: TenantContext, id: bigint): Promise<LoadedDashboard> {
  const d = await loadDashboard(ctx, id);
  if (d.ownerId !== ctx.actorId) throw new NotDashboardOwnerError(d.ownerName);
  return d;
}

export async function createDashboard(
  ctx: TenantContext,
  rawName: string,
): Promise<{ id: bigint }> {
  if (ctx.actorId === null) throw new DashboardNameRequiredError();
  const db = tenantScoped(ctx);
  const name = cleanName(rawName);

  const mine = await db.dashboard.count({ where: { ownerId: ctx.actorId } });
  if (mine >= MAX_DASHBOARDS_PER_USER) throw new TooManyDashboardsError();

  const clash = await db.dashboard.findFirst({
    where: { ownerId: ctx.actorId, name },
    select: { id: true },
  });
  if (clash !== null) throw new DuplicateDashboardNameError(name);

  const start = defaultLayout();
  return auditedTransaction(ctx, 'dashboard.create', async (tx) => {
    const d = await tx.dashboard.create({
      data: {
        tenantId: ctx.tenantId,
        ownerId: ctx.actorId ?? BigInt(0),
        name,
        columns: start.columns,
      },
      select: { id: true },
    });
    /*
      หน้าใหม่เริ่มด้วยการ์ดชุดเดียวกับหน้าเริ่มต้น ไม่ใช่หน้าเปล่า —
      หน้าเปล่าคือหน้าที่คนไม่รู้ว่าจะเริ่มยังไง แล้วก็ปิดทิ้ง
    */
    await tx.dashboardGadget.createMany({
      data: start.gadgets.map((g, i) => ({
        tenantId: ctx.tenantId,
        dashboardId: d.id,
        kind: g.kind,
        colIndex: g.column,
        position: i,
        projectId: null,
        title: null,
      })),
    });
    return {
      result: d,
      audit: [
        {
          kind: 'system',
          action: 'dashboard.create',
          entityType: 'dashboard',
          entityId: d.id.toString(),
          payload: { name, gadgets: start.gadgets.length },
        },
      ],
    };
  });
}

export async function updateDashboard(
  ctx: TenantContext,
  id: bigint,
  changes: { name?: string; columns?: number; isShared?: boolean },
): Promise<void> {
  const before = await ownedByActor(ctx, id);
  const data: Record<string, unknown> = {};
  if (changes.name !== undefined) {
    const name = cleanName(changes.name);
    if (name !== before.name) {
      const clash = await tenantScoped(ctx).dashboard.findFirst({
        where: { ownerId: ctx.actorId ?? BigInt(0), name, NOT: { id } },
        select: { id: true },
      });
      if (clash !== null) throw new DuplicateDashboardNameError(name);
    }
    data['name'] = name;
  }
  /*
    จำนวนคอลัมน์ที่ใช้ไม่ได้ถูกดึงกลับเข้าขอบ ไม่ใช่ปฏิเสธ — ค่าที่พังมาจาก
    ลิงก์เก่าหรือฟอร์มที่กรอกพลาด และเอนจินก็ดึงกลับให้อยู่แล้วตอนเรนเดอร์
    · เก็บค่าที่ใช้ได้ลงไปเลย จะได้ไม่ต้องดึงกลับซ้ำทุกครั้งที่เปิดหน้า
  */
  if (changes.columns !== undefined) {
    data['columns'] = Math.min(4, Math.max(1, Math.floor(changes.columns)));
  }
  if (changes.isShared !== undefined) data['isShared'] = changes.isShared;
  if (Object.keys(data).length === 0) return;

  await auditedTransaction(ctx, 'dashboard.update', async (tx) => {
    await tx.dashboard.update({ where: { id }, data });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'dashboard.update',
          entityType: 'dashboard',
          entityId: id.toString(),
          payload: data,
        },
      ],
    };
  });
}

export async function deleteDashboard(ctx: TenantContext, id: bigint): Promise<void> {
  const d = await ownedByActor(ctx, id);
  await auditedTransaction(ctx, 'dashboard.delete', async (tx) => {
    await tx.dashboard.delete({ where: { id } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'dashboard.delete',
          entityType: 'dashboard',
          entityId: id.toString(),
          payload: { name: d.name },
        },
      ],
    };
  });
}

export async function addGadget(
  ctx: TenantContext,
  dashboardId: bigint,
  spec: { kind: string; column: number; projectId: bigint | null; title: string | null },
): Promise<void> {
  const d = await ownedByActor(ctx, dashboardId);
  if (!KNOWN_GADGET_KINDS.includes(spec.kind as (typeof KNOWN_GADGET_KINDS)[number])) {
    throw new UnknownGadgetKindError(spec.kind);
  }
  /*
    เพดานตรวจที่นี่ด้วย ไม่ใช่ปล่อยให้เอนจินตัดตอนเรนเดอร์อย่างเดียว —
    การ์ดที่เพิ่มสำเร็จแล้วไม่เคยโผล่ คือความเงียบที่ไม่มีใครสืบต่อได้
  */
  if (d.layout.gadgets.length >= MAX_GADGETS) throw new TooManyGadgetsError();

  await auditedTransaction(ctx, 'dashboard.gadget.add', async (tx) => {
    const g = await tx.dashboardGadget.create({
      data: {
        tenantId: ctx.tenantId,
        dashboardId,
        kind: spec.kind,
        colIndex: Math.max(0, Math.floor(spec.column)),
        position: d.layout.gadgets.length,
        projectId: spec.projectId,
        title: spec.title === null || spec.title.trim() === '' ? null : spec.title.trim(),
      },
      select: { id: true },
    });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'dashboard.gadget.add',
          entityType: 'dashboard',
          entityId: dashboardId.toString(),
          payload: { gadgetId: g.id.toString(), kind: spec.kind },
        },
      ],
    };
  });
}

export async function removeGadget(
  ctx: TenantContext,
  dashboardId: bigint,
  gadgetId: bigint,
): Promise<void> {
  await ownedByActor(ctx, dashboardId);
  await auditedTransaction(ctx, 'dashboard.gadget.remove', async (tx) => {
    await tx.dashboardGadget.deleteMany({ where: { id: gadgetId, dashboardId } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'dashboard.gadget.remove',
          entityType: 'dashboard',
          entityId: dashboardId.toString(),
          payload: { gadgetId: gadgetId.toString() },
        },
      ],
    };
  });
}

/**
 * ย้ายการ์ดหนึ่งใบ — ตรรกะการย้ายอยู่ในเอนจิน ที่นี่แค่เขียนผลลง
 *
 * ## ทำไมเขียนตำแหน่งสองรอบ
 *
 * `@@unique([dashboardId, position])` ทำให้การสลับสองใบชนกันกลางทาง
 * (ใบหนึ่งย้ายไปตำแหน่งที่อีกใบยังอยู่) · รอบแรกจึงผลักทุกใบไปเป็นเลขติดลบ
 * ซึ่งไม่มีทางชนกับเลขจริง แล้วรอบสองค่อยลงตำแหน่งจริง
 *
 * ทางที่ง่ายกว่าคือลบทั้งหมดแล้วสร้างใหม่ — แต่ id ของการ์ดจะเปลี่ยนทุกครั้ง
 * แล้วปุ่มย้ายที่คนกดรัว ๆ จะอ้าง id ที่หายไปแล้ว กลายเป็น error
 * ทั้งที่ผู้ใช้ไม่ได้ทำอะไรผิด
 */
export async function moveGadgetOn(
  ctx: TenantContext,
  dashboardId: bigint,
  gadgetId: string,
  direction: 'up' | 'down' | 'left' | 'right',
): Promise<void> {
  const d = await ownedByActor(ctx, dashboardId);
  const next: Layout = moveGadget(d.layout, gadgetId, direction);

  await auditedTransaction(ctx, 'dashboard.gadget.move', async (tx) => {
    await tx.dashboardGadget.updateMany({
      where: { dashboardId },
      data: { position: { decrement: MAX_GADGETS + 1 } },
    });
    for (const [i, g] of next.gadgets.entries()) {
      await tx.dashboardGadget.updateMany({
        where: { id: BigInt(g.id), dashboardId },
        data: { position: i, colIndex: g.column },
      });
    }
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'dashboard.gadget.move',
          entityType: 'dashboard',
          entityId: dashboardId.toString(),
          payload: { gadgetId, direction, order: next.gadgets.map((g: GadgetSpec) => g.id) },
        },
      ],
    };
  });
}
