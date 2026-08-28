/**
 * ซิงก์ work item จาก MySQL ไป OpenSearch
 *
 * MySQL เป็นแหล่งความจริง · OpenSearch เป็นดัชนีที่สร้างใหม่ได้เสมอ
 * ถ้า index เสียหาย ให้ `reindexAll` สร้างใหม่ได้โดยไม่กระทบข้อมูลจริง
 * (ADR-005 กำหนดว่าต้องมีคำสั่งนี้และต้องทดสอบบน production ตั้งแต่เฟส 1)
 *
 * ความไม่สอดคล้องชั่วคราว: ผู้ใช้ที่แก้ตั๋วแล้วค้นทันทีอาจยังไม่เจอ
 * หน้ารายละเอียดอ่านจาก MySQL ตรง ๆ จึงไม่ได้รับผลกระทบ
 */
import { compile } from '@itsm/hql';
import type { TenantContext } from '@itsm/types';

import { tenantScoped, type Prisma } from '../../infrastructure/prisma/tenant-scope';
import {
  WORK_ITEM_INDEX_SETTINGS,
  buildTextQuery,
  workItemIndexName,
} from './index-mapping';
import { OpenSearchError, openSearch } from './opensearch-client';

/**
 * ดัชนียังไม่ถูกสร้าง — ไม่ใช่ error ของผู้ใช้ และ **ห้ามกลืนเป็นผลลัพธ์ว่าง**
 * เพราะผลว่างจะทำให้ผู้ใช้เชื่อว่า "ไม่มีข้อมูล" ทั้งที่จริงคือระบบค้นหายังไม่พร้อม
 * ต้องแยกออกมาให้ชั้นบนแสดงข้อความที่ถูกต้องและให้ทีมงานเห็นใน alert
 */
/**
 * เพดานความลึกของการแบ่งหน้าใน OpenSearch
 *
 * `index.max_result_window` เป็น 10,000 โดยปริยาย · ขอ `from + size` เกินนี้
 * ได้ error ที่อ่านไม่ออก และ **หน้าจอเคยแปลมันเป็น "คิวรียังใช้ไม่ได้"**
 * ซึ่งโยนความผิดไปให้คิวรีที่เขียนถูกทุกตัวอักษร
 */
export const MAX_RESULT_WINDOW = 10_000;

export class SearchDepthExceededError extends Error {
  constructor(readonly limit: number) {
    super(
      `ดูผลได้ลึกสุด ${limit.toLocaleString('th-TH')} รายการ — ` +
        'ใช้เงื่อนไขให้แคบลงเพื่อเข้าถึงรายการที่เหลือ',
    );
    this.name = 'SearchDepthExceededError';
  }
}

export class SearchIndexNotReadyError extends Error {
  constructor(readonly index: string) {
    super(
      `ดัชนีค้นหา "${index}" ยังไม่ถูกสร้าง — ` +
        'รัน `pnpm --filter @itsm/api reindex` เพื่อสร้างจาก MySQL',
    );
    this.name = 'SearchIndexNotReadyError';
  }
}

export interface WorkItemDoc {
  tenantId: number;
  projectId: number;
  projectKey: string;
  itemKey: string;
  issueTypeId: number;
  issueTypeName: string;
  statusId: number;
  statusName: string;
  statusCategory: string;
  priorityId: number | null;
  priorityRank: number | null;
  reporterId: number;
  assigneeId: number | null;
  parentId: number | null;
  summary: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export async function ensureIndex(tenantId: bigint): Promise<string> {
  const index = workItemIndexName(tenantId);
  if (!(await openSearch.indexExists(index))) {
    await openSearch.createIndex(index, WORK_ITEM_INDEX_SETTINGS);
  }
  return index;
}

/** สร้างดัชนีใหม่ทั้งหมดจาก MySQL — ปลอดภัยเสมอ เพราะ MySQL คือแหล่งความจริง */
/** ตารางที่ต้อง include ครบก่อนแปลงเป็นเอกสารค้นหา */
const INDEX_INCLUDE = {
  project: true,
  issueType: true,
  status: true,
  priority: true,
} as const;

/**
 * ดึงข้อความออกจาก description ที่เก็บเป็น structured document
 *
 * `description` เป็นคอลัมน์ JSON เสมอ ไม่เคยเป็นสตริง โค้ดเดิมเช็ก `typeof === 'string'`
 * จึงได้ค่าว่างทุกครั้ง แปลว่ารายละเอียดของงานไม่เคยถูกค้นเจอเลยสักใบ
 * ตอนที่ยังไม่มีทางกรอกรายละเอียดมันไม่มีผล ตอนนี้มีแล้วจึงต้องแก้
 */
function descriptionText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return '';
  const doc = value as Record<string, unknown>;
  return typeof doc['text'] === 'string' ? doc['text'] : '';
}

type IndexableWorkItem = Prisma.WorkItemGetPayload<{ include: typeof INDEX_INCLUDE }>;

function toDoc(w: IndexableWorkItem): WorkItemDoc {
  return {
    tenantId: Number(w.tenantId),
    projectId: Number(w.projectId),
    projectKey: w.project.key,
    itemKey: w.itemKey,
    issueTypeId: Number(w.issueTypeId),
    issueTypeName: w.issueType.name,
    statusId: Number(w.statusId),
    statusName: w.status.name,
    statusCategory: w.status.category,
    priorityId: w.priorityId,
    priorityRank: w.priority?.rank ?? null,
    reporterId: Number(w.reporterId),
    assigneeId: w.assigneeId === null ? null : Number(w.assigneeId),
    parentId: w.parentId === null ? null : Number(w.parentId),
    summary: w.summary,
    description: descriptionText(w.description),
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
    resolvedAt: w.resolvedAt?.toISOString() ?? null,
  };
}

/**
 * จัดดัชนีงานใบเดียว — ใช้ตอนสร้างหรือแก้ไข
 *
 * ไม่สร้างดัชนีใหม่ ถ้าดัชนียังไม่มีให้สร้างก่อน (`ensureIndex`)
 * เพื่อไม่ให้งานใบแรกของ tenant ใหม่หายไปเงียบ ๆ
 */
export async function indexWorkItem(ctx: TenantContext, workItemId: bigint): Promise<boolean> {
  const db = tenantScoped(ctx);
  const w = await db.workItem.findFirst({
    where: { id: workItemId },
    include: INDEX_INCLUDE,
  });
  if (w === null) return false;

  const index = await ensureIndex(ctx.tenantId);
  await openSearch.bulkIndex(index, [{ id: w.itemKey, doc: toDoc(w) }]);
  await openSearch.refresh(index);
  return true;
}

export async function reindexAll(
  ctx: TenantContext,
  opts: { batchSize?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ index: string; indexed: number; elapsedMs: number }> {
  const startedAt = performance.now();
  const batchSize = opts.batchSize ?? 1_000;
  const index = workItemIndexName(ctx.tenantId);
  const db = tenantScoped(ctx);

  // สร้างใหม่ตั้งแต่ต้นเพื่อให้ mapping ตรงกับเวอร์ชันปัจจุบันเสมอ
  await openSearch.deleteIndex(index);
  await openSearch.createIndex(index, WORK_ITEM_INDEX_SETTINGS);

  const total = await db.workItem.count();
  let done = 0;
  let cursor: bigint | undefined;

  for (;;) {
    const rows = await db.workItem.findMany({
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      take: batchSize,
      orderBy: { id: 'asc' },
      include: { project: true, issueType: true, status: true, priority: true },
    });
    if (rows.length === 0) break;

    await openSearch.bulkIndex(
      index,
      rows.map((w) => ({ id: w.itemKey, doc: toDoc(w) })),
    );

    done += rows.length;
    cursor = rows[rows.length - 1]?.id;
    opts.onProgress?.(done, total);
  }

  await openSearch.refresh(index);
  return { index, indexed: done, elapsedMs: Math.round(performance.now() - startedAt) };
}

export interface SearchHit {
  itemKey: string;
  summary: string;
  statusName: string;
  score: number;
}

/**
 * ผลค้นหาหนึ่งหน้า พร้อม **ยอดรวมจริงของทั้งคิวรี**
 *
 * ยอดรวมไม่ใช่จำนวนที่คืนมาในหน้านี้ · หน้าจอที่รายงานเพดานเป็นยอดรวม
 * ("แสดง 50 รายการ" → "ทั้งหมด 50 รายการ") คือการรายงานข้อจำกัดของตัวเอง
 * เป็นข้อเท็จจริงเกี่ยวกับข้อมูล
 */
export interface SearchPage {
  total: number;
  hits: SearchHit[];
}

/** ค้นหาข้อความ — tenant และ project อยู่ใน filter context เสมอ */
export async function searchWorkItems(
  ctx: TenantContext,
  text: string,
  opts: { projectIds?: bigint[]; size?: number } = {},
): Promise<SearchHit[]> {
  const index = workItemIndexName(ctx.tenantId);
  const query = buildTextQuery({
    tenantId: ctx.tenantId,
    text,
    ...(opts.projectIds === undefined ? {} : { projectIds: opts.projectIds }),
  });
  let page;
  try {
    page = await openSearch.search<WorkItemDoc>(index, query, opts.size ?? 20);
  } catch (e) {
    if (e instanceof OpenSearchError && e.status === 404) throw new SearchIndexNotReadyError(index);
    throw e;
  }
  return page.hits.map((h) => ({
    itemKey: h.source.itemKey,
    summary: h.source.summary,
    statusName: h.source.statusName,
    score: h.score,
  }));
}

/**
 * ค้นด้วย HQL
 *
 * ต่างจาก `searchWorkItems` ตรงที่ผู้ใช้เป็นคนเขียนเงื่อนไขเอง ไม่ใช่พิมพ์คำค้น
 * ขอบเขต tenant และโปรเจกต์จึงถูกประกอบเข้าไปโดย `compile` เสมอ ไม่ว่าคิวรี
 * จะเขียนว่าอะไร (ดู packages/hql)
 *
 * **`browsableProjectIds` ต้องส่งเข้ามา ไม่ใช่คำนวณที่นี่** — โมดูล search-index
 * ถามโมดูล permission ไม่ได้โดยตรง (ADR-004) และการปล่อยให้ค่านี้เป็นตัวเลือก
 * ที่ลืมส่งได้ คือการเปิดช่องให้คิวรีหลุดขอบเขตอย่างเงียบ ๆ
 */
export async function searchByHql(
  ctx: TenantContext,
  hql: string,
  browsableProjectIds: bigint[],
  size = 50,
  from = 0,
): Promise<SearchPage> {
  /*
    กันไว้ก่อนยิง ไม่ใช่ปล่อยให้ OpenSearch โยน error ที่อ่านไม่ออกกลับมา
    แล้วให้ชั้นบนเดาว่ามันแปลว่าอะไร
  */
  if (from + size > MAX_RESULT_WINDOW) throw new SearchDepthExceededError(MAX_RESULT_WINDOW);

  const index = workItemIndexName(ctx.tenantId);
  const compiled = compile(hql, {
    tenantId: ctx.tenantId.toString(),
    browsableProjectIds: browsableProjectIds.map((id) => id.toString()),
  });

  let page;
  try {
    // CompiledQuery เป็นชนิดที่ประกาศฟิลด์ชัดเจน ไม่มี index signature
    // ตัว client รับ Record<string, unknown> — แปลงเป็น object ธรรมดาก่อนส่ง
    page = await openSearch.search<WorkItemDoc>(index, { ...compiled }, size, from);
  } catch (e) {
    if (e instanceof OpenSearchError && e.status === 404) throw new SearchIndexNotReadyError(index);
    throw e;
  }
  return {
    total: page.total,
    hits: page.hits.map((h) => ({
      itemKey: h.source.itemKey,
      summary: h.source.summary,
      statusName: h.source.statusName,
      score: h.score,
    })),
  };
}
