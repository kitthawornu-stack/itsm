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
import { createNotifications } from '../notification';
import { PermissionDeniedError, assertCan, can } from '../permission';
import { WorkItemNotFoundError } from './workitem.service';
import { eligibleMentions, eligibleWatcherIds } from './watcher.service';
import { mentionsIn } from './mention';
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
  /** เวลาที่ถูกแก้ — null คือยังไม่เคยแก้ · บทสนทนาที่แก้เงียบ ๆ ใช้เป็นหลักฐานไม่ได้ */
  editedAt?: string | null;
  /** ผู้ใช้คนนี้ทำอะไรกับความเห็นใบนี้ได้ — ให้หน้าจอซ่อนปุ่มที่กดแล้วได้ 403 */
  canEdit?: boolean;
  canDelete?: boolean;
}

export interface AddCommentInput {
  itemKey: string;
  body: string;
  /**
   * คนที่หน้าจอบอกว่าถูกกล่าวถึง
   *
   * เซิร์ฟเวอร์ **ไม่เชื่อรายการนี้ตรง ๆ** — ตรวจสิทธิ์ทุกคน และตรวจว่า
   * `@ชื่อ` ปรากฏในข้อความจริง ก่อนยอมรับ
   */
  mentions?: readonly string[];
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
    /*
      ผู้เฝ้าดูได้รับด้วย — และนี่คือจุดที่ทำให้ปุ่มเฝ้าดูมีผลจริง
      ถ้ากดแล้วไม่ได้รับอะไร ตาราง `work_item_watcher` ก็เป็นแค่แถวที่ไม่มีใครอ่าน

      กรองสิทธิ์ **ที่นี่ ตอนจะส่ง** ไม่ใช่ตอนกดเฝ้าดู · สิทธิ์เปลี่ยนได้ระหว่างนั้น
      และการแจ้งเตือนพกหัวข้อกับเนื้อความไปด้วย จึงรั่วโดยไม่ต้องกดอะไรเลย
    */
    const watcherIds = await eligibleWatcherIds(ctx, item.id, item.projectId, {
      internal: isInternal,
    });

    /*
      การกล่าวถึง — ตรวจสองชั้นก่อนยอมรับ

      1. **สิทธิ์** เกณฑ์เดียวกับผู้เฝ้าดู · เรียกคนที่เปิดเรื่องไม่ได้แล้วส่ง
         หัวข้อกับเนื้อความไปให้ คือการรั่วแบบเดียวกันเป๊ะ
      2. **ชื่อต้องอยู่ในข้อความจริง** · ถ้าเชื่อรายการที่หน้าจอส่งมาตรง ๆ
         ใครก็ส่ง id ใครก็ได้มาพร้อมข้อความที่ไม่มีชื่อเขา แล้วคนคนนั้น
         ได้แจ้งเตือนว่าถูกเรียก แต่เปิดเข้าไปหาไม่เจอว่าใครเรียก
    */
    const claimed = (input.mentions ?? [])
      .map((v) => {
        try {
          return BigInt(v);
        } catch {
          // ค่าที่ไม่ใช่ตัวเลขคือคำขอที่พัง ไม่ใช่การกล่าวถึง — ทิ้งเงียบ ๆ ได้
          return null;
        }
      })
      .filter((v): v is bigint => v !== null);
    const allowed = await eligibleMentions(ctx, item.projectId, claimed, {
      internal: isInternal,
    });
    const mentionIds = mentionsIn(body, allowed).map((m) => m.userId);
    const audience = commentAudience({
      authorId,
      reporterId: item.reporterId,
      assigneeId: item.assigneeId,
      isInternal,
      watcherIds,
      mentionIds,
    });
    if (audience.length > 0) {
      const textFor = (mentioned: boolean): { title: string; body: string } =>
        commentNotificationText({
          itemKey: item.itemKey,
          summary: item.summary,
          authorName: author?.displayName ?? 'ไม่ทราบชื่อ',
          body,
          isInternal,
          mentioned,
        });
      await createNotifications(
        ctx,
        tx,
        item.projectId,
        audience.map((r) => {
          const mentioned = r.reason === 'mention';
          const text = textFor(mentioned);
          return {
            userId: r.userId,
            workItemId: item.id,
            /*
              ชนิดต่างกันเพื่อให้กล่องแจ้งเตือนจัดลำดับได้ — การถูกเรียกชื่อ
              โดยตรงเป็นสัญญาณที่แรงกว่า "มีความเห็นใหม่" ซึ่งผู้รับผิดชอบ
              เห็นทุกวันจนเลิกอ่าน · และเป็นชนิดที่ผู้ใช้ปิดแยกกันได้
            */
            kind: mentioned ? 'comment.mention' : isInternal ? 'comment.internal' : 'comment.added',
            title: text.title,
            body: text.body,
            dedupeKey: commentDedupeKey(row.id, r.userId),
          };
        }),
      );
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

  /*
    ถามสิทธิ์ลบครั้งเดียวสำหรับทั้งหน้า ไม่ใช่ทีละความเห็น — ค่าเดียวกันทุกแถว
    เพราะ `DELETE_COMMENT` ผูกกับโปรเจกต์ ไม่ได้ผูกกับความเห็น
  */
  const mayDeleteAny = await can(ctx, item.projectId, 'DELETE_COMMENT');
  return rows.map((r) => ({
    id: r.id.toString(),
    body: textOf(r.body),
    isInternal: r.isInternal,
    author: r.author.displayName,
    createdAt: r.createdAt.toISOString(),
    editedAt: r.editedAt?.toISOString() ?? null,
    // แก้ได้เฉพาะของตัวเอง — ไม่มีสิทธิ์ไหนเปิดทางให้แก้ข้อความของคนอื่น
    canEdit: ctx.actorId !== null && r.authorId === ctx.actorId,
    canDelete: (ctx.actorId !== null && r.authorId === ctx.actorId) || mayDeleteAny,
  }));
}
