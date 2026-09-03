/**
 * กระดานงานและการจัดลำดับ
 *
 * ## `rank` มีอยู่เพื่อการนี้ และยังไม่เคยถูกใช้เพื่อการนี้
 *
 * `packages/lexorank` ถูกเรียกใช้อยู่แล้ว — `seed.ts` ใช้ `distribute` และ
 * `workitem.service.ts` ใช้ `between(last, null)` ตอนสร้างงาน · **แต่ `between`
 * ถูกเรียกที่เดียวเพื่อต่อท้ายเท่านั้น ไม่มีโค้ดไหนย้ายลำดับเลย**
 * ซึ่งเป็นเหตุผลทั้งหมดที่คอลัมน์นี้มีอยู่
 *
 * ## ย้ายข้ามคอลัมน์ต้องเดินผ่าน workflow
 *
 * คอลัมน์บนกระดานคือสถานะ · การลากการ์ดข้ามคอลัมน์คือการเปลี่ยนสถานะ
 * ซึ่งต้องผ่านเงื่อนไข ตัวตรวจ และ post function เหมือนกดปุ่มบนหน้างาน
 *
 * **การเขียน `statusId` ทับตอนลาก คือการเดินอ้อมทุกอย่างที่ workflow มีไว้
 * ปฏิเสธ** — งานจะถูกปิดโดยไม่มีผลการแก้ไข นาฬิกา SLA ไม่หยุด และไม่มี error
 * สักบรรทัด (บทเรียนเดียวกับการเปลี่ยนสถานะเป็นชุด)
 */
import type { TenantContext } from '@itsm/types';
import { between, needsRebalance, distribute, compareRank } from '@itsm/lexorank';

import { auditedTransaction, change } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan, browsableProjectIds } from '../permission';
import { applyTransition, availableTransitions } from '../workflow';

import { scrumScopeOf, type ScrumScope } from './scrum-scope';
import {
  evaluateWip,
  isValidWipLimit,
  wipLimitOf,
  WIP_LIMIT_MAX,
  type WipState,
} from './wip-limit';

export class BoardItemNotFoundError extends Error {
  constructor() {
    super('ไม่พบเรื่องที่ระบุ');
    this.name = 'BoardItemNotFoundError';
  }
}

export class NoTransitionForColumnError extends Error {
  constructor(
    readonly itemKey: string,
    readonly column: string,
    readonly available: string[],
  ) {
    super(
      available.length === 0
        ? `ตอนนี้ยังย้าย ${itemKey} ไปไหนไม่ได้เลย`
        : `${itemKey} ย้ายไป "${column}" ไม่ได้จากสถานะปัจจุบัน — ` +
            `ที่ไปได้คือ ${available.join(' · ')}`,
    );
    this.name = 'NoTransitionForColumnError';
  }
}

export interface BoardCard {
  itemKey: string;
  summary: string;
  assignee: string | null;
  priority: { rank: number; name: string } | null;
  rank: string;
}

export type BoardMode = 'kanban' | 'scrum';

export interface BoardView {
  projectKey: string;
  mode: BoardMode;
  /** ขอบเขตที่ใช้จริง — โหมด kanban ได้ `not-scrum` เสมอ เพราะไม่จำกัดด้วยรอบ */
  scope: ScrumScope;
  columns: BoardColumn[];
}

export interface BoardColumn {
  statusId: string;
  name: string;
  category: string;
  cards: BoardCard[];
  /**
   * จำนวนงานจริงในคอลัมน์นี้ · **ไม่ใช่ `cards.length`**
   *
   * `cards` ถูกตัดที่ `limitPerColumn` (100) · คอลัมน์ที่มีงานจริง 150 ใบ
   * จะมี `cards.length === 100` แต่ `count === 150` · เพดาน WIP ตัดสิน
   * จากตัวเลขนี้เท่านั้น มิฉะนั้นคอลัมน์ที่ล้นจริงจะเงียบตั้งแต่ใบที่ 101
   */
  count: number;
  /** ผลการตัดสินเพดานงานที่ทำพร้อมกัน — `no-limit` เมื่อยังไม่ได้ตั้ง */
  wip: WipState;
}

/**
 * กระดานของโปรเจกต์หนึ่ง
 *
 * คอลัมน์มาจาก workflow ที่โปรเจกต์ใช้ **ไม่ใช่รายการสถานะทั้งระบบ** ·
 * กระดานที่แสดงคอลัมน์ซึ่งงานในโปรเจกต์นี้ไปถึงไม่ได้ ทำให้คนลากแล้วเด้งกลับ
 * โดยไม่เข้าใจว่าทำไม
 */
export async function boardOf(
  ctx: TenantContext,
  projectKey: string,
  limitPerColumn = 100,
  /**
   * `'scrum'` = แสดงเฉพาะงานในรอบที่กำลังทำอยู่ · `'kanban'` = ทั้งโปรเจกต์
   *
   * ค่าปริยายคือ kanban เพราะเป็นสิ่งที่กระดานนี้เป็นมาตลอด — โหมดใหม่
   * ต้องถูกขอ ไม่ใช่ได้มาเงียบ ๆ แล้วคนสงสัยว่างานหายไปไหน
   */
  mode: BoardMode = 'kanban',
): Promise<BoardView> {
  const allowed = await browsableProjectIds(ctx);
  const project =
    allowed.length === 0
      ? null
      : await tenantScoped(ctx).project.findFirst({
          where: { key: projectKey.trim(), id: { in: allowed } },
          select: { id: true, key: true },
        });
  if (project === null) throw new BoardItemNotFoundError();

  const db = tenantScoped(ctx);
  const schemes = await db.workflowScheme.findMany({
    where: { projectId: project.id },
    select: { workflowId: true },
  });
  const workflowIds = [...new Set(schemes.map((s) => s.workflowId.toString()))].map((s) =>
    BigInt(s),
  );

  const statuses = await db.workflowStatus.findMany({
    where: { workflowId: { in: workflowIds } },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, category: true },
  });

  /*
    ยุบสถานะชื่อซ้ำจากหลาย workflow ให้เป็นคอลัมน์เดียว

    โปรเจกต์หนึ่งผูกได้หลาย workflow (ชนิดงานละเรือน) · ถ้าไม่ยุบ กระดานจะมี
    คอลัมน์ "New" สองอันที่หน้าตาเหมือนกันทุกประการ และไม่มีใครบอกได้ว่า
    การ์ดควรอยู่อันไหน
  */
  const byName = new Map<string, { ids: bigint[]; category: string }>();
  for (const st of statuses) {
    const e = byName.get(st.name) ?? { ids: [], category: st.category };
    e.ids.push(st.id);
    byName.set(st.name, e);
  }

  /*
    **ขอบเขตของโหมด Scrum ตัดสินก่อนคิวรี ไม่ใช่กรองผลทีหลัง**

    กรองทีหลังแปลว่าเราอ่านงานทั้งโปรเจกต์มาก่อน แล้วเพดาน `limitPerColumn`
    จะถูกใช้ไปกับงานที่ไม่ได้อยู่ในรอบ · คอลัมน์ที่มีงานนอกรอบเยอะ
    จะแสดงงานในรอบไม่ครบ โดยไม่มีอะไรบอก
  */
  let scope: ScrumScope = { kind: 'not-scrum' };
  if (mode === 'scrum') {
    const sprints = await db.sprint.findMany({
      where: { projectId: project.id },
      select: { id: true, name: true, goal: true, state: true },
      orderBy: { id: 'asc' },
    });
    scope = scrumScopeOf(sprints.map((x) => ({ ...x, id: x.id.toString() })));
    /*
      **ขอบเขตที่ตัดสินไม่ได้ ต้องคืนกระดานเปล่าพร้อมเหตุผล ไม่ใช่ทั้งโปรเจกต์**

      กติกาเดิมของโปรเจกต์นี้: รายการที่ใช้กรองว่างเปล่า ต้องแปลว่าไม่เห็น
      อะไรเลย ไม่ใช่เห็นทุกอย่าง (CLAUDE.md)
    */
    if (scope.kind !== 'sprint') {
      return { projectKey: project.key, mode, scope, columns: [] };
    }
  }
  const sprintFilter = scope.kind === 'sprint' ? { sprintId: BigInt(scope.sprintId) } : {};

  /*
    **นับจำนวนจริงด้วยคิวรีของตัวเอง ไม่ใช่จาก `cards.length`**

    คิวรีเดียวสำหรับทั้งกระดาน แล้วรวมตามสถานะที่ยุบเข้าคอลัมน์เดียวกัน —
    ถูกกว่าการนับทีละคอลัมน์ และให้คำตอบที่ไม่ขึ้นกับเพดานการแสดงผล
  */
  const grouped = await db.workItem.groupBy({
    by: ['statusId'],
    where: { projectId: project.id, ...sprintFilter },
    _count: { _all: true },
  });
  const countByStatus = new Map(grouped.map((g) => [g.statusId.toString(), g._count._all]));

  const limitRows = await db.boardWipLimit.findMany({
    where: { projectId: project.id },
    select: { statusId: true, maxCards: true },
  });
  const limitByStatus = new Map(limitRows.map((r) => [r.statusId.toString(), r.maxCards]));

  const columns: BoardColumn[] = [];
  for (const [name, e] of byName) {
    const rows = await db.workItem.findMany({
      where: { projectId: project.id, statusId: { in: e.ids }, ...sprintFilter },
      // `rank` ใช้ collation utf8mb4_bin — เรียงฝั่งฐานข้อมูลตรงกับ `compareRank`
      orderBy: { rank: 'asc' },
      take: limitPerColumn,
      select: {
        itemKey: true,
        summary: true,
        rank: true,
        assignee: { select: { displayName: true } },
        priority: { select: { rank: true, name: true } },
      },
    });
    const ids = e.ids.map((i) => i.toString());
    const count = ids.reduce((n, id) => n + (countByStatus.get(id) ?? 0), 0);
    columns.push({
      statusId: (e.ids[0] ?? 0n).toString(),
      name,
      category: e.category,
      count,
      wip: evaluateWip(count, wipLimitOf(ids, limitByStatus)),
      cards: rows.map((r) => ({
        itemKey: r.itemKey,
        summary: r.summary,
        assignee: r.assignee?.displayName ?? null,
        priority: r.priority === null ? null : { rank: r.priority.rank, name: r.priority.name },
        rank: r.rank,
      })),
    });
  }

  return { projectKey: project.key, mode, scope, columns };
}

export interface MoveInput {
  /** ชื่อคอลัมน์ปลายทาง — ไม่ส่ง = อยู่คอลัมน์เดิม แค่เปลี่ยนลำดับ */
  toColumn?: string;
  /** วางไว้หลังการ์ดใบนี้ — ไม่ส่ง = บนสุดของคอลัมน์ */
  afterKey?: string;
  /** วางไว้ก่อนการ์ดใบนี้ — ไม่ส่ง = ล่างสุดของคอลัมน์ */
  beforeKey?: string;
  resolutionName?: string | null;
}

/**
 * ย้ายการ์ด — เปลี่ยนคอลัมน์และ/หรือเปลี่ยนลำดับ
 *
 * ลำดับกับสถานะเป็นคนละเรื่องและเขียนคนละที่: ลำดับเป็นค่าของกระดาน
 * ส่วนสถานะเป็นผลของ state machine · ทำสองอย่างในคำสั่งเดียวได้ แต่
 * **สถานะต้องผ่าน `applyTransition` เสมอ**
 */
export async function moveCard(
  ctx: TenantContext,
  itemKey: string,
  input: MoveInput,
): Promise<{ rank: string; statusName: string }> {
  const actorId = ctx.actorId;
  if (actorId === null) throw new BoardItemNotFoundError();

  const allowed = await browsableProjectIds(ctx);
  const db = tenantScoped(ctx);
  const item =
    allowed.length === 0
      ? null
      : await db.workItem.findFirst({
          where: { itemKey: itemKey.trim(), projectId: { in: allowed } },
          select: {
            id: true,
            itemKey: true,
            projectId: true,
            rank: true,
            status: { select: { name: true } },
          },
        });
  if (item === null) throw new BoardItemNotFoundError();
  await assertCan(ctx, item.projectId, 'EDIT_ITEM');

  let statusName = item.status.name;

  // ---------- เปลี่ยนคอลัมน์ ----------
  if (input.toColumn !== undefined && input.toColumn !== statusName) {
    await assertCan(ctx, item.projectId, 'TRANSITION_ITEM');
    /*
      หา transition จาก **รายการที่ใบนี้กดได้จริง** ไม่ใช่จากตารางตรง ๆ ·
      รายการนี้ผ่านเงื่อนไขของ engine มาแล้ว (ผู้กดอยู่กลุ่มไหน · งานมี
      ผู้รับหรือยัง) การ์ดที่หาไม่เจอจึงได้เหตุผลที่ถูกต้อง แทน 422 ตอนลาก
    */
    const list = await availableTransitions(ctx, item.id, actorId);
    const target = await pickByColumn(ctx, list, input.toColumn);
    if (target === undefined) {
      throw new NoTransitionForColumnError(
        item.itemKey,
        input.toColumn,
        await columnNames(ctx, list),
      );
    }
    const applied = await applyTransition(ctx, item.id, target, actorId, {
      resolutionName: input.resolutionName ?? null,
    });
    const to = await db.workflowStatus.findUnique({
      where: { id: applied.toStatusId },
      select: { name: true },
    });
    statusName = to?.name ?? statusName;
  }

  // ---------- เปลี่ยนลำดับ ----------
  const neighbours = await Promise.all(
    [input.afterKey, input.beforeKey].map(async (k) =>
      k === undefined || k.trim() === ''
        ? null
        : db.workItem.findFirst({
            where: { itemKey: k.trim(), projectId: item.projectId },
            select: { rank: true },
          }),
    ),
  );
  const prev = neighbours[0]?.rank ?? null;
  const next = neighbours[1]?.rank ?? null;

  /*
    วางไว้ที่เดิม = ไม่เขียนอะไร

    การลากแล้วปล่อยที่เดิมเป็นเรื่องปกติมาก · ถ้าเขียนทุกครั้ง ประวัติจะเต็มไป
    ด้วยแถวที่ไม่มีอะไรเปลี่ยน แล้วคนจะเลิกอ่านประวัติ
  */
  if (prev === null && next === null && input.toColumn === undefined) {
    return { rank: item.rank, statusName };
  }
  if (prev !== null && next !== null && compareRank(prev, next) >= 0) {
    // เพื่อนบ้านสลับกัน = คำขอที่พัง ไม่ใช่ลำดับที่เป็นไปได้
    throw new BoardItemNotFoundError();
  }

  const newRank = between(prev, next);
  if (newRank === item.rank) return { rank: item.rank, statusName };

  await auditedTransaction(ctx, 'board.move', async (tx) => {
    await tx.workItem.update({ where: { id: item.id }, data: { rank: newRank } });
    return {
      result: undefined,
      audit: [change(item.id, 'rank', item.rank, newRank)],
    };
  });

  return { rank: newRank, statusName };
}

/** ชื่อสถานะปลายทางของ transition ที่กดได้ — ใช้ในข้อความปฏิเสธ */
async function columnNames(
  ctx: TenantContext,
  list: Array<{ toStatusId: bigint }>,
): Promise<string[]> {
  if (list.length === 0) return [];
  const rows = await tenantScoped(ctx).workflowStatus.findMany({
    where: { id: { in: list.map((t) => t.toStatusId) } },
    select: { name: true },
  });
  return [...new Set(rows.map((r) => r.name))];
}

/** transition ที่พาไปยังคอลัมน์ที่ต้องการ — คืน `undefined` เมื่อไม่มี */
async function pickByColumn(
  ctx: TenantContext,
  list: Array<{ id: bigint; toStatusId: bigint }>,
  column: string,
): Promise<bigint | undefined> {
  if (list.length === 0) return undefined;
  const statuses = await tenantScoped(ctx).workflowStatus.findMany({
    where: { id: { in: list.map((t) => t.toStatusId) }, name: column },
    select: { id: true },
  });
  const wanted = new Set(statuses.map((s) => s.id.toString()));
  return list.find((t) => wanted.has(t.toStatusId.toString()))?.id;
}

/**
 * จัดลำดับใหม่ทั้งคอลัมน์เมื่อ rank ยาวเกินไป
 *
 * `between` ทำให้สตริงยาวขึ้นเรื่อย ๆ เมื่อแทรกซ้ำที่เดิม · `needsRebalance`
 * บอกว่าถึงจุดที่ควรจัดใหม่แล้ว — ไม่ใช่ตัวเลขที่เดา แต่วัดจากความยาวเฉลี่ยจริง
 *
 * **ไม่เรียกอัตโนมัติตอนย้าย** เพราะการเขียนทับทั้งคอลัมน์ระหว่างที่คนอื่น
 * กำลังลากอยู่ จะทำให้การ์ดกระโดด · ให้ผู้ดูแลสั่งเอง หรือให้ job รันตอนว่าง
 */
export async function rebalanceColumn(
  ctx: TenantContext,
  projectKey: string,
  column: string,
): Promise<{ rebalanced: number }> {
  const allowed = await browsableProjectIds(ctx);
  const project =
    allowed.length === 0
      ? null
      : await tenantScoped(ctx).project.findFirst({
          where: { key: projectKey.trim(), id: { in: allowed } },
          select: { id: true },
        });
  if (project === null) throw new BoardItemNotFoundError();
  await assertCan(ctx, project.id, 'EDIT_ITEM');

  const db = tenantScoped(ctx);
  const statusIds = (
    await db.workflowStatus.findMany({ where: { name: column }, select: { id: true } })
  ).map((s) => s.id);
  if (statusIds.length === 0) return { rebalanced: 0 };

  const rows = await db.workItem.findMany({
    where: { projectId: project.id, statusId: { in: statusIds } },
    orderBy: { rank: 'asc' },
    select: { id: true, rank: true },
  });
  if (!needsRebalance(rows.map((r) => r.rank))) return { rebalanced: 0 };

  const fresh = distribute(rows.length);
  await auditedTransaction(ctx, 'board.rebalance', async (tx) => {
    for (const [i, row] of rows.entries()) {
      const r = fresh[i];
      if (r === undefined) continue;
      await tx.workItem.update({ where: { id: row.id }, data: { rank: r } });
    }
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'board.rebalance',
          entityType: 'project',
          entityId: project.id.toString(),
          payload: { column, count: rows.length },
        },
      ],
    };
  });
  return { rebalanced: rows.length };
}

/** ค่าที่ตั้งเป็นเพดานไม่ได้ — ข้อความบอกช่วงที่ยอมรับ ไม่ใช่แค่ว่าผิด */
export class InvalidWipLimitError extends Error {
  constructor(got: number) {
    super(
      `เพดานต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง ${String(WIP_LIMIT_MAX)} — ได้รับ ${String(got)}` +
        ' · ถ้าต้องการเอาเพดานออก ให้ส่งค่าว่างแทนเลข 0',
    );
  }
}

/** คอลัมน์ที่อ้างถึงไม่มีอยู่ในกระดานของโปรเจกต์นี้ */
export class BoardColumnNotFoundError extends Error {
  constructor(column: string) {
    super(`ไม่มีคอลัมน์ "${column}" บนกระดานของโปรเจกต์นี้`);
  }
}

/**
 * ตั้งหรือถอดเพดานงานที่ทำพร้อมกันของคอลัมน์หนึ่ง
 *
 * **อ้างถึงคอลัมน์ด้วยชื่อ แต่เก็บด้วยรหัสสถานะ** — ชื่อคือสิ่งที่คนเห็น
 * บนกระดาน ส่วนสถานะคือสิ่งที่ไม่กำพร้าเมื่อมีคนเปลี่ยนชื่อ · คอลัมน์เดียว
 * อาจยุบมาจากหลายสถานะ (ชนิดงานละ workflow) จึงเขียนให้ **ทุกสถานะในคอลัมน์นั้น**
 * ค่าเดียวกัน มิฉะนั้นจะกลายเป็น "กำกวม" ทันทีที่ตั้งเสร็จ
 *
 * `maxCards === null` = ถอดเพดานออก · **ไม่ใช่ 0** ซึ่งตั้งไม่ได้เลย
 */
export async function setWipLimit(
  ctx: TenantContext,
  projectKey: string,
  column: string,
  maxCards: number | null,
): Promise<{ column: string; maxCards: number | null; statuses: number }> {
  const allowed = await browsableProjectIds(ctx);
  const project =
    allowed.length === 0
      ? null
      : await tenantScoped(ctx).project.findFirst({
          where: { key: projectKey.trim(), id: { in: allowed } },
          select: { id: true },
        });
  if (project === null) throw new BoardItemNotFoundError();
  await assertCan(ctx, project.id, 'MANAGE_PROJECT');

  if (maxCards !== null && !isValidWipLimit(maxCards)) throw new InvalidWipLimitError(maxCards);

  const db = tenantScoped(ctx);
  /*
    หาสถานะจาก workflow ที่ *โปรเจกต์นี้ใช้จริง* ไม่ใช่ทุกสถานะที่ชื่อตรงกัน
    ทั้งองค์กร — มิฉะนั้นการตั้งเพดานของโปรเจกต์หนึ่งจะไปสร้างแถวให้สถานะ
    ของโปรเจกต์อื่นที่บังเอิญตั้งชื่อคอลัมน์เหมือนกัน
  */
  const schemes = await db.workflowScheme.findMany({
    where: { projectId: project.id },
    select: { workflowId: true },
  });
  const workflowIds = [...new Set(schemes.map((s) => s.workflowId.toString()))].map((x) =>
    BigInt(x),
  );
  const statuses = await db.workflowStatus.findMany({
    where: { workflowId: { in: workflowIds }, name: column.trim() },
    select: { id: true },
  });
  if (statuses.length === 0) throw new BoardColumnNotFoundError(column);

  await auditedTransaction(ctx, 'board.wip_limit', async (tx) => {
    for (const st of statuses) {
      if (maxCards === null) {
        /*
          ลบด้วย unique key ที่ระบุแถวเดียว ไม่ใช่ `deleteMany` ด้วยเงื่อนไขช่วง
          — `deleteMany` ที่ไม่ตรงแถวไหนเลยยังจับ gap lock ถึง supremum
          แล้วชนกับ insert ของอีกทรานแซกชันจนเป็น deadlock (CLAUDE.md)
        */
        await tx.boardWipLimit.deleteMany({
          where: { projectId: project.id, statusId: st.id },
        });
      } else {
        await tx.boardWipLimit.upsert({
          where: { projectId_statusId: { projectId: project.id, statusId: st.id } },
          create: {
            tenantId: ctx.tenantId,
            projectId: project.id,
            statusId: st.id,
            maxCards,
          },
          update: { maxCards },
        });
      }
    }
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: maxCards === null ? 'board.wip_limit.clear' : 'board.wip_limit.set',
          entityType: 'project',
          entityId: project.id.toString(),
          payload: { column: column.trim(), maxCards, statuses: statuses.length },
        },
      ],
    };
  });

  return { column: column.trim(), maxCards, statuses: statuses.length };
}
