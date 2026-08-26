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
import { PermissionDeniedError, assertCan, can } from '../permission';
import { WorkItemNotFoundError } from './workitem.service';
import {
  commentAudience,
  commentDedupeKey,
  commentNotificationText,
} from './comment-audience';

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
 * เดิมรับมาจากพารามิเตอร์ `?view=` ซึ่งแปลว่าใครพิมพ์ `?view=agent`
 * ก็อ่านบันทึกภายในได้ · วัดจริงแล้วผู้ใช้ทั่วไปอ่านได้ครบทุกฉบับ
 *
 * ตอนนี้ตัดสินจากสิทธิ์ `VIEW_INTERNAL_COMMENT` บนโปรเจกต์ของงานใบนั้น
 * ผู้เรียกบอกไม่ได้อีกแล้ว
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
  const isInternalRequested = input.isInternal ?? false;
  if (body.length === 0) throw new EmptyCommentError();
  if (ctx.actorId === null) throw new Error('addComment ต้องมีผู้เขียน (actorId)');
  const authorId = ctx.actorId;

  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({
    where: { itemKey: input.itemKey },
    select: {
      id: true,
      itemKey: true,
      summary: true,
      projectId: true,
      reporterId: true,
      assigneeId: true,
    },
  });
  if (item === null) throw new WorkItemNotFoundError(input.itemKey);

  await assertCan(ctx, item.projectId, 'ADD_COMMENT');
  /**
   * เขียนบันทึกภายในได้เฉพาะคนที่เห็นบันทึกภายใน
   *
   * ถ้าไม่กัน ผู้แจ้งจะส่ง `isInternal: true` มาเองแล้วเขียนบันทึกที่ตัวเอง
   * มองไม่เห็นอีกต่อไป — ข้อความหายไปจากหน้าจอเจ้าของเองโดยไม่มีคำอธิบาย
   */
  if (isInternalRequested && !(await can(ctx, item.projectId, 'VIEW_INTERNAL_COMMENT'))) {
    throw new PermissionDeniedError('VIEW_INTERNAL_COMMENT');
  }

  const author = await db.user.findFirst({
    where: { id: authorId },
    select: { displayName: true },
  });

  const isInternal = isInternalRequested;

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
     * แจ้งเตือน **ในทรานแซกชันเดียวกับความเห็น**
     *
     * ถ้าเขียนทีหลังนอกทรานแซกชัน ความเห็นที่บันทึกสำเร็จแต่แจ้งเตือนพลาด
     * จะกลายเป็นคำถามที่ไม่มีใครเห็น โดยไม่มี error ให้ใครสังเกต
     * ตัวส่งอีเมลอ่านจากตารางนี้อยู่แล้ว จึงได้ความทนทานมาฟรี
     */
    const audience = commentAudience({
      authorId,
      reporterId: item.reporterId,
      assigneeId: item.assigneeId,
      isInternal,
    });
    if (audience.length > 0) {
      const text = commentNotificationText({
        itemKey: item.itemKey,
        summary: item.summary,
        authorName: author?.displayName ?? 'ไม่ทราบชื่อ',
        body,
        isInternal,
      });
      await tx.notification.createMany({
        data: audience.map((r) => ({
          tenantId: ctx.tenantId,
          userId: r.userId,
          workItemId: item.id,
          kind: isInternal ? 'comment.internal' : 'comment.added',
          title: text.title,
          body: text.body,
          dedupeKey: commentDedupeKey(row.id, r.userId),
        })),
        // unique index บน (tenantId, dedupeKey) เป็นด่านสุดท้าย
        // ถ้าชนแปลว่าเคยแจ้งไปแล้ว ซึ่งไม่ใช่ความผิดพลาดที่ต้องล้มทั้งความเห็น
        skipDuplicates: true,
      });
    }

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
export async function listComments(ctx: TenantContext, itemKey: string): Promise<CommentView[]> {
  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({
    where: { itemKey },
    select: { id: true, projectId: true },
  });
  if (item === null) throw new WorkItemNotFoundError(itemKey);

  await assertCan(ctx, item.projectId, 'BROWSE_PROJECT');

  // ถามสิทธิ์จริง — ไม่รับคำตอบนี้จากผู้เรียก (INVARIANT 3)
  const viewer: Viewer = (await can(ctx, item.projectId, 'VIEW_INTERNAL_COMMENT'))
    ? 'agent'
    : 'reporter';

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
