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
import type { TenantContext } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
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
      rows.map((w) => ({
        id: w.itemKey,
        doc: {
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
          description: typeof w.description === 'string' ? w.description : '',
          createdAt: w.createdAt.toISOString(),
          updatedAt: w.updatedAt.toISOString(),
          resolvedAt: w.resolvedAt?.toISOString() ?? null,
        } satisfies WorkItemDoc,
      })),
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
  let hits;
  try {
    hits = await openSearch.search<WorkItemDoc>(index, query, opts.size ?? 20);
  } catch (e) {
    if (e instanceof OpenSearchError && e.status === 404) throw new SearchIndexNotReadyError(index);
    throw e;
  }
  return hits.map((h) => ({
    itemKey: h.source.itemKey,
    summary: h.source.summary,
    statusName: h.source.statusName,
    score: h.score,
  }));
}
