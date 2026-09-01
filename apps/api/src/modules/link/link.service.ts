/**
 * เชื่อมโยงเรื่องเข้าด้วยกัน
 *
 * ไฟล์นี้ทำให้ `LINK_ITEM` มีผลจริงเป็นครั้งแรก · ก่อนหน้านี้คีย์นี้อยู่ใน enum
 * แสดงบนหน้าตั้งค่าโปรเจกต์ว่า "เชื่อมโยงเรื่อง" **แต่อยู่ใน
 * `UNENFORCED_PERMISSIONS`** และโมดูลนี้ว่างเปล่า — เป็นรูปแบบเดียวกับ
 * `BULK_EDIT`: สิทธิ์ที่ให้แล้วไม่มีผล อันตรายกว่าสิทธิ์ที่ยังไม่ได้ให้
 *
 * ## หนึ่งความสัมพันธ์ = หนึ่งแถว
 *
 * "A ขวาง B" กับ "B ถูกขวางโดย A" เป็นประโยคเดียวกันพูดคนละทาง
 * ถ้าเก็บสองแถว วันหนึ่งจะมีคนลบไปข้างเดียว แล้วเหลือความสัมพันธ์ที่มองเห็น
 * จากฝั่งเดียว — ฐานข้อมูลตอบสองอย่างขัดกันโดยไม่มีอะไรบอกว่าผิด
 *
 * จึงเก็บทิศเดียว (`CANONICAL`) แล้ว **คำนวณคู่ตรงข้ามตอนอ่าน** ·
 * ราคาที่จ่ายคือคิวรีต้องดูทั้ง `sourceId` และ `targetId` ซึ่งมี index ทั้งคู่
 */
import { systemClock, toUtcDate, type TenantContext, type UtcDate } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan, browsableProjectIds } from '../permission';
import { articlesOf } from '../knowledge';
import { workaroundsFrom, type CausingProblem, type Workaround } from './known-error';
import { summarizeImpact, type CausedIncident, type ProblemImpact } from './problem-impact';

/** ชนิดของความสัมพันธ์ตามสคีมา — ตรงกับ enum `LinkType` */
export type LinkType =
  | 'RELATES_TO'
  | 'BLOCKS'
  | 'IS_BLOCKED_BY'
  | 'DUPLICATES'
  | 'CAUSES'
  | 'IS_CAUSED_BY';

export const LINK_TYPES: readonly LinkType[] = [
  'RELATES_TO',
  'BLOCKS',
  'IS_BLOCKED_BY',
  'DUPLICATES',
  'CAUSES',
  'IS_CAUSED_BY',
];

/**
 * ชนิดที่เก็บลงฐานข้อมูลสำหรับแต่ละชนิดที่ผู้ใช้เลือก
 *
 * ผู้ใช้พูดได้ทั้งสองทาง แต่เก็บทางเดียว · `IS_BLOCKED_BY` จึงถูกพลิกเป็น
 * `BLOCKS` แล้วสลับต้นทาง–ปลายทางก่อนเขียน มิฉะนั้น unique index
 * `(source, target, type)` จะปล่อยให้ความสัมพันธ์เดียวกันมีสองแถว
 */
const CANONICAL: Record<LinkType, { type: LinkType; flip: boolean }> = {
  RELATES_TO: { type: 'RELATES_TO', flip: false },
  BLOCKS: { type: 'BLOCKS', flip: false },
  IS_BLOCKED_BY: { type: 'BLOCKS', flip: true },
  DUPLICATES: { type: 'DUPLICATES', flip: false },
  CAUSES: { type: 'CAUSES', flip: false },
  IS_CAUSED_BY: { type: 'CAUSES', flip: true },
};

/**
 * ชนิดที่อีกฝั่งเห็น
 *
 * `DUPLICATES` ไม่มี `IS_DUPLICATED_BY` ในสคีมา — คู่ตรงข้ามของมันจึงเป็น
 * **เรื่องของการแสดงผล ไม่ใช่ค่าที่เก็บ** · ถ้าคืน `DUPLICATES` ให้อีกฝั่งด้วย
 * ความหมายจะกลับกัน: ใบต้นฉบับจะอ่านว่าเป็นใบที่ซ้ำ ซึ่งชี้ให้คนไปปิดผิดใบ
 */
const OPPOSITE: Record<LinkType, LinkType> = {
  RELATES_TO: 'RELATES_TO',
  BLOCKS: 'IS_BLOCKED_BY',
  IS_BLOCKED_BY: 'BLOCKS',
  DUPLICATES: 'DUPLICATES',
  CAUSES: 'IS_CAUSED_BY',
  IS_CAUSED_BY: 'CAUSES',
};

/** ป้ายภาษาคน — ไม่ใช่ศัพท์ระบบ (CLAUDE.md §5) */
const LABEL: Record<LinkType, string> = {
  RELATES_TO: 'เกี่ยวข้องกับ',
  BLOCKS: 'ขวางเรื่อง',
  IS_BLOCKED_BY: 'ติดอยู่ที่',
  DUPLICATES: 'ซ้ำกับ',
  CAUSES: 'เป็นสาเหตุของ',
  IS_CAUSED_BY: 'เกิดจาก',
};

/** ป้ายที่อีกฝั่งเห็น เมื่อชนิดนั้นไม่มีคู่ตรงข้ามเก็บไว้ */
const REVERSE_LABEL: Partial<Record<LinkType, string>> = {
  DUPLICATES: 'ถูกแจ้งซ้ำโดย',
};

export class SelfLinkError extends Error {
  constructor() {
    super('เชื่อมเรื่องเข้ากับตัวเองไม่ได้');
    this.name = 'SelfLinkError';
  }
}

/**
 * ปลายทางไม่มีอยู่จริง **หรือ** เปิดดูไม่ได้
 *
 * ตั้งใจให้สองกรณีตอบเหมือนกัน — การแยกออกจากกันคือการยืนยันว่าเลขที่เรื่องนั้น
 * มีอยู่ ซึ่งเป็นการวาดแผนที่ให้คนที่กำลังไล่เดา
 */
export class LinkTargetNotFoundError extends Error {
  constructor() {
    super('ไม่พบเรื่องที่ระบุ');
    this.name = 'LinkTargetNotFoundError';
  }
}

export class DuplicateLinkError extends Error {
  constructor(readonly label: string) {
    super(`สองเรื่องนี้ถูกทำเครื่องหมายว่า "${label}" ไว้แล้ว`);
    this.name = 'DuplicateLinkError';
  }
}

export interface LinkView {
  id: string;
  /** ชนิดที่ **ฝั่งที่กำลังดูอยู่** เห็น ไม่ใช่ชนิดที่เก็บในแถว */
  type: LinkType;
  label: string;
  other: {
    itemKey: string;
    summary: string;
    statusName: string;
    statusCategory: string;
  };
}

/** อ่านงานที่เปิดดูได้ตามคีย์ — คืน null เมื่อไม่มีหรือมองไม่เห็น */
async function findVisible(
  ctx: TenantContext,
  itemKey: string,
  allowed: readonly bigint[],
): Promise<{ id: bigint; projectId: bigint; itemKey: string } | null> {
  const trimmed = itemKey.trim();
  if (trimmed === '' || allowed.length === 0) return null;
  return tenantScoped(ctx).workItem.findFirst({
    where: { itemKey: trimmed, projectId: { in: [...allowed] } },
    select: { id: true, projectId: true, itemKey: true },
  });
}

/**
 * เชื่อมสองเรื่องเข้าด้วยกัน
 *
 * ตรวจ `LINK_ITEM` ของ **ทั้งสองฝั่ง** — ความสัมพันธ์นี้จะไปโผล่บนหน้ารายละเอียด
 * ของอีกใบด้วย · คนที่เชื่อมโยงใน SD ได้ ไม่ควรไปเพิ่มบรรทัดบนงานของ PLAT
 */
export async function linkWorkItems(
  ctx: TenantContext,
  fromKey: string,
  toKey: string,
  type: LinkType,
): Promise<{ id: bigint }> {
  const allowed = await browsableProjectIds(ctx);
  const [from, to] = await Promise.all([
    findVisible(ctx, fromKey, allowed),
    findVisible(ctx, toKey, allowed),
  ]);
  if (from === null || to === null) throw new LinkTargetNotFoundError();
  if (from.id === to.id) throw new SelfLinkError();

  await assertCan(ctx, from.projectId, 'LINK_ITEM');
  if (to.projectId !== from.projectId) await assertCan(ctx, to.projectId, 'LINK_ITEM');

  const canon = CANONICAL[type];
  const sourceId = canon.flip ? to.id : from.id;
  const targetId = canon.flip ? from.id : to.id;

  /*
    หาซ้ำจากทั้งสองทิศ ไม่ใช่แค่ทิศที่กำลังจะเขียน

    `RELATES_TO` สมมาตร: "A เกี่ยวกับ B" กับ "B เกี่ยวกับ A" เป็นประโยคเดียวกัน
    แต่ unique index มองว่าเป็นคนละแถว · ถ้าไม่ตรวจเอง หน้ารายละเอียดจะแสดง
    ความสัมพันธ์เดียวซ้ำสองบรรทัด และการถอดออกครั้งเดียวจะเหลืออีกบรรทัดค้างไว้
  */
  const existing = await tenantScoped(ctx).workItemLink.findFirst({
    where: {
      type: canon.type,
      OR: [
        { sourceId, targetId },
        { sourceId: targetId, targetId: sourceId },
      ],
    },
    select: { id: true },
  });
  if (existing !== null) throw new DuplicateLinkError(LABEL[type]);

  return auditedTransaction(ctx, 'workitem.link', async (tx) => {
    const row = await tx.workItemLink.create({
      data: { tenantId: ctx.tenantId, sourceId, targetId, type: canon.type },
      select: { id: true },
    });
    return {
      result: { id: row.id },
      audit: [
        {
          kind: 'system',
          action: 'workitem.link',
          entityType: 'work_item_link',
          entityId: row.id.toString(),
          payload: { from: from.itemKey, to: to.itemKey, type: canon.type },
        },
      ],
    };
  });
}

/**
 * ความสัมพันธ์ของเรื่องหนึ่ง — ทั้งสองทิศ
 *
 * **กรองปลายทางที่เปิดดูไม่ได้ออกตอนอ่านด้วย** ไม่ใช่เชื่อว่าตอนสร้างกรองไปแล้ว ·
 * สิทธิ์เปลี่ยนได้หลังลิงก์ถูกสร้าง และลิงก์ที่เคยถูกต้องเมื่อวาน อาจชี้ไปยัง
 * โปรเจกต์ที่ผู้ใช้เข้าไม่ได้แล้ววันนี้ · การแสดงคีย์ของงานที่กดแล้วได้ 403
 * เป็นทั้งการยืนยันว่ามันมีอยู่ และทางตันที่ผู้ใช้ออกเองไม่ได้
 */
export async function linksOf(ctx: TenantContext, workItemId: bigint): Promise<LinkView[]> {
  const allowed = await browsableProjectIds(ctx);
  if (allowed.length === 0) return [];

  const select = {
    id: true,
    itemKey: true,
    summary: true,
    status: { select: { name: true, category: true } },
  };
  const rows = await tenantScoped(ctx).workItemLink.findMany({
    where: { OR: [{ sourceId: workItemId }, { targetId: workItemId }] },
    include: {
      source: { select: { ...select, projectId: true } },
      target: { select: { ...select, projectId: true } },
    },
    orderBy: { id: 'asc' },
  });

  const visible = new Set(allowed.map((a) => a.toString()));
  const out: LinkView[] = [];
  for (const r of rows) {
    // ฝั่งที่กำลังดูอยู่เป็น source หรือ target — อีกฝั่งคือสิ่งที่จะแสดง
    const iAmSource = r.sourceId === workItemId;
    const other = iAmSource ? r.target : r.source;
    if (!visible.has(other.projectId.toString())) continue;

    /*
      ไม่ต้อง assert — ชนิดของ Prisma ตรงกับ `LinkType` ที่ประกาศไว้ข้างบนอยู่แล้ว
      และการปล่อยให้ `tsc` เป็นคนตรวจ ทำให้วันที่มีคนเพิ่มค่าใน enum ของสคีมา
      แล้วลืมเพิ่มใน `OPPOSITE`/`LABEL` typecheck จะแดงทันที · การใส่ `as`
      จะกลบข้อนั้นทิ้ง แล้วเราจะได้ `undefined` เป็นป้ายบนหน้าจอแทน
    */
    const stored = r.type;
    const shown = iAmSource ? stored : OPPOSITE[stored];
    out.push({
      id: r.id.toString(),
      type: shown,
      // ชนิดที่ไม่มีคู่ตรงข้ามเก็บไว้ ใช้ป้ายเฉพาะของฝั่งตรงข้ามแทน
      label: (iAmSource ? undefined : REVERSE_LABEL[stored]) ?? LABEL[shown],
      other: {
        itemKey: other.itemKey,
        summary: other.summary,
        statusName: other.status.name,
        statusCategory: other.status.category,
      },
    });
  }
  return out;
}

/**
 * ถอดความสัมพันธ์
 *
 * ถอดจากฝั่งไหนก็ได้ เพราะเป็นแถวเดียวกัน · ผู้ถอดต้องมี `LINK_ITEM`
 * ในโปรเจกต์ของ **ฝั่งที่ตัวเองเปิดดูได้** — ไม่ใช่ทั้งสองฝั่ง เพราะ
 * ความสัมพันธ์ที่ค้างอยู่บนหน้าจอโดยถอดไม่ออก แย่กว่าการถอดออกได้
 */
export async function unlinkWorkItems(ctx: TenantContext, linkId: bigint): Promise<void> {
  const allowed = await browsableProjectIds(ctx);
  const link =
    allowed.length === 0
      ? null
      : await tenantScoped(ctx).workItemLink.findFirst({
          where: {
            id: linkId,
            OR: [
              { source: { projectId: { in: allowed } } },
              { target: { projectId: { in: allowed } } },
            ],
          },
          include: {
            source: { select: { projectId: true, itemKey: true } },
            target: { select: { projectId: true, itemKey: true } },
          },
        });
  // ไม่มีอยู่จริง กับ มองไม่เห็น ตอบเหมือนกัน — เหตุผลเดียวกับตอนสร้าง
  if (link === null) throw new LinkTargetNotFoundError();

  const mine = allowed.some((a) => a === link.source.projectId)
    ? link.source.projectId
    : link.target.projectId;
  await assertCan(ctx, mine, 'LINK_ITEM');

  await auditedTransaction(ctx, 'workitem.unlink', async (tx) => {
    await tx.workItemLink.delete({ where: { id: linkId } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'workitem.unlink',
          entityType: 'work_item_link',
          entityId: linkId.toString(),
          payload: { from: link.source.itemKey, to: link.target.itemKey, type: link.type },
        },
      ],
    };
  });
}

/**
 * ผลกระทบของปัญหา — เรื่องทั้งหมดที่ใบนี้ "เป็นสาเหตุของ"
 *
 * `linksOf` คืนความสัมพันธ์ทุกชนิดพร้อมข้อมูลแค่พอแสดงเป็นรายการ ·
 * การสรุปผลกระทบต้องการเวลาที่เรื่องเข้ามาและโปรเจกต์ของแต่ละใบด้วย
 * จึงเป็นคิวรีของตัวเอง ไม่ใช่การกรองผลของ `linksOf`
 *
 * **นับเฉพาะทิศ "เป็นสาเหตุของ"** — ใบที่เป็น `source` ของแถวชนิด `CAUSES` ·
 * ถ้านับทั้งสองทิศ ปัญหาจะรวมใบที่ *ทำให้ตัวมันเกิด* เข้าไปด้วย แล้วตัวเลข
 * ผลกระทบจะสูงกว่าความจริงโดยไม่มีใครสังเกต
 */
export async function problemImpactOf(
  ctx: TenantContext,
  workItemId: bigint,
  now: UtcDate = systemClock.nowUtc(),
): Promise<{ impact: ProblemImpact; incidents: CausedIncident[] }> {
  const allowed = await browsableProjectIds(ctx);
  /*
    ทางลัดนี้เป็นการ **ประหยัดคิวรี ไม่ใช่ด่าน** — ตัวกรองปลายทางข้างล่าง
    ให้คำตอบเดียวกันอยู่แล้วเมื่อไม่มีโปรเจกต์ที่เข้าถึงได้ · ลบทิ้งแล้วเทสต์
    ยังเขียวทุกเคส และนั่นถูกต้อง · เขียนไว้ให้ตรงกับ `linksOf` ที่ทำแบบเดียวกัน
  */
  if (allowed.length === 0) return { impact: summarizeImpact([], now), incidents: [] };

  const rows = await tenantScoped(ctx).workItemLink.findMany({
    where: { sourceId: workItemId, type: 'CAUSES' },
    select: {
      target: {
        select: {
          itemKey: true,
          summary: true,
          createdAt: true,
          resolvedAt: true,
          projectId: true,
          project: { select: { key: true } },
          status: { select: { category: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  const visible = new Set(allowed.map((a) => a.toString()));
  const incidents: CausedIncident[] = rows
    // เรื่องในโปรเจกต์ที่ผู้ดูเข้าไม่ถึง ต้องไม่ถูกนับ — ตัวเลขก็เป็นข้อมูลรั่วได้
    .filter((r) => visible.has(r.target.projectId.toString()))
    .map((r) => ({
      itemKey: r.target.itemKey,
      summary: r.target.summary,
      statusCategory: r.target.status.category,
      projectKey: r.target.project.key,
      createdAt: toUtcDate(r.target.createdAt),
      resolvedAt: r.target.resolvedAt === null ? null : toUtcDate(r.target.resolvedAt),
    }));

  return { impact: summarizeImpact(incidents, now), incidents };
}

/**
 * วิธีแก้จากปัญหาที่เป็นสาเหตุของเรื่องนี้
 *
 * ทิศตรงข้ามกับ `problemImpactOf` — ที่นั่นถามว่า "ปัญหาใบนี้ทำให้อะไรเกิดบ้าง"
 * ที่นี่ถามว่า **"เรื่องใบนี้เกิดจากปัญหาอะไร และปัญหานั้นมีวิธีแก้แล้วหรือยัง"**
 *
 * คุณค่าทั้งหมดของ Known Error อยู่ตรงนี้: คนรับเรื่องใบใหม่เห็นคำตอบทันที
 * โดยไม่ต้องรู้ว่ามีปัญหาใบนั้นอยู่ · คลังความรู้ที่ไม่มีใครเจอตอนต้องใช้
 * ก็เป็นแค่โฟลเดอร์เอกสาร
 *
 * **ตัดปัญหาที่อยู่ในโปรเจกต์ซึ่งผู้ดูเข้าไม่ถึงออก** — กติกาเดียวกับ
 * `problemImpactOf` · และการกรองบทความตามสิทธิ์ (ร่าง/ถูกลบ) ทำที่
 * `articlesOf` ซึ่งกรองตอนอ่านทุกครั้ง ไม่ใช่เชื่อว่าตอนแนบกรองไปแล้ว
 */
export async function workaroundsFor(
  ctx: TenantContext,
  workItemId: bigint,
): Promise<Workaround[]> {
  /*
    **ไม่มีทางลัด `allowed.length === 0`** ต่างจาก `problemImpactOf` ข้างบน —
    ตัวกรองปลายทางให้คำตอบเดียวกันอยู่แล้ว และการมีทั้งสองอย่างทำให้ลบอันไหน
    ออกเทสต์ก็ยังเขียว · ด่านเดียวต่อเรื่องเดียว (CLAUDE.md) · ราคาที่จ่ายคือ
    คิวรีเดียวบนตารางความสัมพันธ์ ซึ่งคืนศูนย์แถวเกือบตลอดอยู่แล้ว
  */
  const allowed = await browsableProjectIds(ctx);

  const rows = await tenantScoped(ctx).workItemLink.findMany({
    where: { targetId: workItemId, type: 'CAUSES' },
    select: {
      source: {
        select: {
          id: true,
          itemKey: true,
          summary: true,
          projectId: true,
          status: { select: { category: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  const visible = rows
    .map((r) => r.source)
    .filter((p) => allowed.some((id) => id === p.projectId));

  const problems: CausingProblem[] = [];
  for (const p of visible) {
    const articles = await articlesOf(ctx, p.id);
    problems.push({
      itemKey: p.itemKey,
      summary: p.summary,
      // "ปิดแล้ว" ดูจากหมวดของสถานะ ไม่ใช่ `resolvedAt` — ให้ตรงกับที่หน้าคิวนับ
      resolved: p.status.category === 'DONE',
      articles: articles.map((a) => ({ id: a.id, title: a.title })),
    });
  }
  return workaroundsFrom(problems);
}
