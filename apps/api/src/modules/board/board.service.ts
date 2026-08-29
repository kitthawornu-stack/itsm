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

export interface BoardColumn {
  statusId: string;
  name: string;
  category: string;
  cards: BoardCard[];
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
): Promise<{ projectKey: string; columns: BoardColumn[] }> {
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

  const columns: BoardColumn[] = [];
  for (const [name, e] of byName) {
    const rows = await db.workItem.findMany({
      where: { projectId: project.id, statusId: { in: e.ids } },
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
    columns.push({
      statusId: (e.ids[0] ?? 0n).toString(),
      name,
      category: e.category,
      cards: rows.map((r) => ({
        itemKey: r.itemKey,
        summary: r.summary,
        assignee: r.assignee?.displayName ?? null,
        priority: r.priority === null ? null : { rank: r.priority.rank, name: r.priority.name },
        rank: r.rank,
      })),
    });
  }

  return { projectKey: project.key, columns };
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
