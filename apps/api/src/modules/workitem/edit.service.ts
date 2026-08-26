/**
 * แก้ไขงานที่แจ้งไปแล้ว
 *
 * ก่อนมีไฟล์นี้ พิมพ์หัวข้อผิดแล้วแก้ไม่ได้เลย ต้องปิดใบเก่าแล้วแจ้งใหม่
 * ซึ่งทำให้เลขที่เรื่องขาดตอนและประวัติกระจัดกระจาย
 *
 * **บันทึกเฉพาะฟิลด์ที่เปลี่ยนจริง** ไม่ใช่ทุกฟิลด์ที่ส่งมา
 * ถ้าบันทึกทุกฟิลด์ ไทม์ไลน์จะเต็มไปด้วยบรรทัด "แก้ไขหัวข้อ" ที่ค่าเดิมกับค่าใหม่
 * เหมือนกัน จนหาการเปลี่ยนแปลงจริงไม่เจอ — ประวัติที่รกเท่ากับไม่มีประวัติ
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import {
  auditedTransaction,
  change,
  type AuditEntry,
} from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan } from '../permission';
import { indexWorkItem } from '../search-index';
import { SUMMARY_MAX, SummaryRequiredError, WorkItemNotFoundError } from './workitem.service';

export class NothingToUpdateError extends Error {
  constructor() {
    super('ไม่มีอะไรเปลี่ยน');
    this.name = 'NothingToUpdateError';
  }
}

export class InvalidFieldValueError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'InvalidFieldValueError';
  }
}

export interface EditWorkItemInput {
  /** ไม่ส่ง = ไม่แตะฟิลด์นั้น · ต่างจากส่ง null ซึ่งแปลว่าล้างค่า */
  summary?: string;
  description?: string | null;
  priorityRank?: number | null;
}

export interface EditResult {
  itemKey: string;
  changed: string[];
}

/** ข้อความล้วนจาก structured document — คืน null เมื่อไม่มีเนื้อหา */
function textOf(value: unknown): string | null {
  if (typeof value === 'string') return value === '' ? null : value;
  if (value === null || typeof value !== 'object') return null;
  const doc = value as Record<string, unknown>;
  return typeof doc['text'] === 'string' && doc['text'] !== '' ? doc['text'] : null;
}

export async function editWorkItem(
  ctx: TenantContext,
  itemKey: string,
  input: EditWorkItemInput,
  now: UtcDate = systemClock.nowUtc(),
): Promise<EditResult> {
  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({
    where: { itemKey },
    select: {
      id: true,
      itemKey: true,
      projectId: true,
      summary: true,
      description: true,
      priority: { select: { id: true, name: true, rank: true } },
    },
  });
  if (item === null) throw new WorkItemNotFoundError(itemKey);

  await assertCan(ctx, item.projectId, 'EDIT_ITEM');

  const data: Record<string, unknown> = {};
  const audit: AuditEntry[] = [];
  const changed: string[] = [];

  // ---------- หัวข้อ ----------
  if (input.summary !== undefined) {
    const next = input.summary.trim().slice(0, SUMMARY_MAX);
    if (next === '') throw new SummaryRequiredError();
    if (next !== item.summary) {
      data['summary'] = next;
      audit.push(change(item.id, 'summary', item.summary, next));
      changed.push('summary');
    }
  }

  // ---------- คำอธิบาย ----------
  if (input.description !== undefined) {
    const raw = input.description === null ? '' : input.description.trim();
    const next = raw === '' ? null : raw;
    const current = textOf(item.description);
    if (next !== current) {
      data['description'] = next === null ? null : { format: 'text', text: next };
      // เก็บข้อความลงประวัติได้ เพราะคำอธิบายเป็นข้อมูลที่ทุกคนที่เปิดงานเห็นอยู่แล้ว
      // ต่างจากความเห็นภายในซึ่งมีชั้นสิทธิ์ของตัวเอง
      audit.push(change(item.id, 'description', current, next));
      changed.push('description');
    }
  }

  // ---------- ความสำคัญ ----------
  if (input.priorityRank !== undefined) {
    let nextId: number | null = null;
    let nextName: string | null = null;
    if (input.priorityRank !== null) {
      const p = await db.priority.findFirst({
        where: { rank: input.priorityRank },
        select: { id: true, name: true },
      });
      if (p === null) {
        throw new InvalidFieldValueError('priorityRank', 'ไม่พบระดับความสำคัญที่เลือก');
      }
      nextId = p.id;
      nextName = p.name;
    }
    if (nextId !== (item.priority?.id ?? null)) {
      data['priorityId'] = nextId;
      audit.push(change(item.id, 'priority', item.priority?.name ?? null, nextName));
      changed.push('priority');
    }
  }

  /**
   * ไม่มีอะไรเปลี่ยน = ไม่เขียนอะไรเลย
   *
   * `auditedTransaction` โยนเมื่อไม่มี audit entry โดยตั้งใจ (INVARIANT 2)
   * การส่งฟอร์มที่ไม่ได้แก้อะไรจึงต้องถูกดักที่นี่ ไม่ใช่ปล่อยให้ไปตายข้างใน
   * ด้วย error ที่บอกว่าเป็นบั๊กของนักพัฒนา ทั้งที่ผู้ใช้แค่กดบันทึกซ้ำ
   */
  if (changed.length === 0) throw new NothingToUpdateError();

  await auditedTransaction(ctx, 'workitem.edit', async (tx) => {
    await tx.workItem.update({ where: { id: item.id }, data: { ...data, updatedAt: now } });
    return { result: undefined, audit };
  });

  // ดัชนีค้นหาต้องตามให้ทัน ไม่งั้นค้นด้วยหัวข้อใหม่ไม่เจอ
  // ล้มเหลวที่นี่ไม่ทำให้การแก้ไขล้ม — reindex กู้ได้เสมอ
  try {
    await indexWorkItem(ctx, item.id);
  } catch (err) {
    console.error(
      `[workitem] จัดดัชนี ${item.itemKey} หลังแก้ไขไม่สำเร็จ:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return { itemKey: item.itemKey, changed };
}

/** ระดับความสำคัญทั้งหมดของ tenant — ใช้เติมตัวเลือกในฟอร์ม */
export async function listPriorities(
  ctx: TenantContext,
): Promise<Array<{ rank: number; name: string; colorToken: string }>> {
  const db = tenantScoped(ctx);
  const rows = await db.priority.findMany({
    orderBy: { rank: 'asc' },
    select: { rank: true, name: true, colorToken: true },
  });
  return rows;
}
