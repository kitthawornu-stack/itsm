/**
 * ความเห็นบนงาน — บทสนทนาระหว่างผู้แจ้งกับทีม
 *
 * ที่ผ่านมาระบบเปลี่ยนสถานะได้แต่คุยกันไม่ได้เลย ซึ่งทำให้มันเป็นกระดานสถานะ
 * ไม่ใช่ศูนย์บริการ — คำถามอย่าง "ลองรีสตาร์ตดูหรือยัง" ไม่มีที่ให้พิมพ์
 *
 * **ความเห็นภายใน (`isInternal`)** คือจุดที่พลาดแล้วเสียหายที่สุดของฟีเจอร์นี้
 * มันคือบันทึกที่ทีมคุยกันเองแล้วผู้แจ้งต้องไม่เห็น ถ้ากรองพลาดครั้งเดียว
 * ข้อความอย่าง "เครื่องนี้มันเก่ามาก บอกเขาไปว่ากำลังตรวจสอบ" จะไปถึงผู้แจ้ง
 * — จึงต้องกรองที่ชั้น service ก่อน serialize เสมอ ไม่ใช่ซ่อนที่หน้าจอ (INVARIANT 3)
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import {
  auditedTransaction,
  change,
  type AuditEntry,
} from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { WorkItemNotFoundError } from './workitem.service';

export class EmptyCommentError extends Error {
  constructor() {
    super('ความเห็นว่างเปล่า');
    this.name = 'EmptyCommentError';
  }
}

/** ยาวสุดที่รับ — ยาวกว่านี้ควรเป็นไฟล์แนบ ไม่ใช่ความเห็น */
export const COMMENT_MAX = 10_000;

/**
 * ผู้อ่านที่เห็นความเห็นภายในได้
 *
 * ตอนนี้ยังไม่มีโมดูล permission (ADR-003) จึงตัดสินจากบทบาทที่ส่งเข้ามา
 * เมื่อ permission พร้อม ให้เปลี่ยนมาถามสิทธิ์จริงแทน — จุดนี้คือรายการที่ต้องแก้
 */
export type Viewer = 'agent' | 'reporter';

export interface CommentView {
  id: string;
  body: string;
  isInternal: boolean;
  author: string;
  createdAt: string;
}

export interface AddCommentInput {
  itemKey: string;
  body: string;
  isInternal?: boolean;
}

export async function addComment(
  ctx: TenantContext,
  input: AddCommentInput,
  now: UtcDate = systemClock.nowUtc(),
): Promise<CommentView> {
  const body = input.body.trim();
  if (body.length === 0) throw new EmptyCommentError();
  if (ctx.actorId === null) throw new Error('addComment ต้องมีผู้เขียน (actorId)');
  const authorId = ctx.actorId;

  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({
    where: { itemKey: input.itemKey },
    select: { id: true },
  });
  if (item === null) throw new WorkItemNotFoundError(input.itemKey);

  const author = await db.user.findFirst({
    where: { id: authorId },
    select: { displayName: true },
  });

  const isInternal = input.isInternal ?? false;

  return auditedTransaction(ctx, 'workitem.comment', async (tx) => {
    const row = await tx.workItemComment.create({
      data: {
        tenantId: ctx.tenantId,
        workItemId: item.id,
        authorId,
        // เก็บเป็น structured document เหมือน description — รูปแบบ rich text ยังไม่ตัดสิน
        body: { format: 'text', text: body.slice(0, COMMENT_MAX) },
        isInternal,
        createdAt: now,
      },
      select: { id: true, createdAt: true },
    });

    /**
     * ประวัติบันทึกว่า "มีความเห็นเพิ่ม" ไม่ใช่เนื้อความ
     *
     * เนื้อความอยู่ในตารางความเห็นซึ่งลบแบบ soft delete อยู่แล้ว
     * ถ้าคัดลอกลงประวัติด้วย การลบความเห็นจะไม่ได้ลบจริง และความเห็นภายใน
     * จะรั่วผ่านไทม์ไลน์ที่ผู้แจ้งมองเห็น
     */
    const audit: AuditEntry[] = [
      change(item.id, isInternal ? '__comment_internal__' : '__comment__', null, row.id.toString()),
    ];

    return {
      result: {
        id: row.id.toString(),
        body: body.slice(0, COMMENT_MAX),
        isInternal,
        author: author?.displayName ?? 'ไม่ทราบชื่อ',
        createdAt: row.createdAt.toISOString(),
      },
      audit,
    };
  });
}

/** ดึงข้อความล้วนออกจาก structured document */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return '';
  const doc = value as Record<string, unknown>;
  return typeof doc['text'] === 'string' ? doc['text'] : '';
}

/**
 * ความเห็นของงานหนึ่งใบ
 *
 * **กรองความเห็นภายในที่นี่ ไม่ใช่ที่หน้าจอ** — ถ้าส่งออกไปแล้วให้ UI ซ่อน
 * ข้อมูลจะยังอยู่ใน response ที่ใครก็เปิด DevTools ดูได้ (INVARIANT 3)
 */
export async function listComments(
  ctx: TenantContext,
  itemKey: string,
  viewer: Viewer,
): Promise<CommentView[]> {
  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({ where: { itemKey }, select: { id: true } });
  if (item === null) throw new WorkItemNotFoundError(itemKey);

  const rows = await db.workItemComment.findMany({
    where: {
      workItemId: item.id,
      deletedAt: null,
      ...(viewer === 'agent' ? {} : { isInternal: false }),
    },
    orderBy: { id: 'asc' },
    include: { author: { select: { displayName: true } } },
  });

  return rows.map((r) => ({
    id: r.id.toString(),
    body: textOf(r.body),
    isInternal: r.isInternal,
    author: r.author.displayName,
    createdAt: r.createdAt.toISOString(),
  }));
}
