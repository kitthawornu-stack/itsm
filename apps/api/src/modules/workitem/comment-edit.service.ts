/**
 * แก้ไขและลบความเห็น
 *
 * `deletedAt` อยู่ในสคีมามาตั้งแต่ Phase 0 และ `listComments` กรองมันอยู่แล้ว
 * **แต่ไม่มีโค้ดเส้นไหนตั้งค่ามันเลย** · `DELETE_COMMENT` ก็อยู่ใน
 * `UNENFORCED_PERMISSIONS` — รูปแบบเดียวกับ `BULK_EDIT` `LINK_ITEM`
 * `VIEW_REPORT` และตารางผู้เฝ้าดู
 *
 * ## สิทธิ์ลบ ไม่ใช่สิทธิ์เขียนแทนคนอื่น
 *
 * `DELETE_COMMENT` ให้ลบความเห็นของคนอื่นได้ — เพราะบางข้อความต้องหายไปจริง ๆ
 * (เลขบัตรประชาชนที่พิมพ์ผิดช่อง · รหัสผ่านที่แปะมาเต็ม ๆ)
 *
 * **แต่ไม่มีใครแก้ข้อความของคนอื่นได้ ไม่ว่าจะมีสิทธิ์อะไร** · การแก้คำพูด
 * ของคนอื่นแล้วให้ยังเป็นชื่อเขาอยู่ คือการปลอมบันทึก ซึ่งอันตรายกว่าการลบ
 * เพราะไม่มีใครรู้ว่าเกิดขึ้น · ผู้ดูแลที่อยากแก้ข้อความ ให้ลบแล้วเขียนใหม่
 * ในชื่อตัวเอง
 *
 * ## ลบแล้วต้องลบสำเนาที่ค้างอยู่ด้วย
 *
 * `notification.body` เก็บเนื้อความไว้ตอนแจ้งเตือน · ถ้าลบแค่แถวความเห็น
 * ข้อความที่ตั้งใจลบจะยังอยู่ในกล่องแจ้งเตือนของทุกคนที่ได้รับ
 * — คนที่ลบจะเชื่อว่ามันหายแล้ว ทั้งที่ยังอ่านได้อยู่อีกที่หนึ่ง
 *
 * **สิ่งที่ลบไม่ได้คืออีเมลที่ส่งออกไปแล้ว** — ข้อจำกัดที่ต้องพูดตรง ๆ
 * ไม่ใช่แกล้งว่าไม่มี
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { auditedTransaction, change } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan, can } from '../permission';
import { COMMENT_MAX, EmptyCommentError } from './comment.service';

export class CommentNotFoundError extends Error {
  constructor() {
    super('ไม่พบความเห็นที่ระบุ');
    this.name = 'CommentNotFoundError';
  }
}

/**
 * แก้ข้อความของคนอื่นไม่ได้ — แยกจาก `PermissionDeniedError` โดยตั้งใจ
 *
 * ข้อความปฏิเสธต้องบอกทางออกที่ถูก (ลบแล้วเขียนใหม่) ไม่ใช่ทำให้ผู้ดูแล
 * ไปตามหาว่าต้องได้สิทธิ์อะไรเพิ่ม — เพราะไม่มีสิทธิ์ไหนเปิดทางนี้ได้
 */
export class NotCommentAuthorError extends Error {
  constructor() {
    super('แก้ข้อความของคนอื่นไม่ได้ — ถ้าต้องเอาออก ให้ลบแล้วเขียนใหม่ในชื่อตัวเอง');
    this.name = 'NotCommentAuthorError';
  }
}

async function loadComment(
  ctx: TenantContext,
  commentId: bigint,
): Promise<{
  id: bigint;
  authorId: bigint;
  workItemId: bigint;
  projectId: bigint;
  isInternal: boolean;
}> {
  const row = await tenantScoped(ctx).workItemComment.findFirst({
    // ความเห็นที่ลบไปแล้ว ตอบเหมือนไม่มีอยู่ — ลบซ้ำต้องไม่รื้อประวัติเพิ่ม
    where: { id: commentId, deletedAt: null },
    include: { workItem: { select: { id: true, projectId: true } } },
  });
  if (row === null) throw new CommentNotFoundError();

  /*
    ต้องเปิดดูโปรเจกต์ได้ก่อน · และถ้าเป็นบันทึกภายใน ต้องเห็นบันทึกภายในด้วย
    มิฉะนั้นการลองลบทีละ id จะบอกได้ว่า id ไหนเป็นบันทึกภายในที่มีอยู่จริง
  */
  await assertCan(ctx, row.workItem.projectId, 'BROWSE_PROJECT');
  if (row.isInternal && !(await can(ctx, row.workItem.projectId, 'VIEW_INTERNAL_COMMENT'))) {
    throw new CommentNotFoundError();
  }

  return {
    id: row.id,
    authorId: row.authorId,
    workItemId: row.workItem.id,
    projectId: row.workItem.projectId,
    isInternal: row.isInternal,
  };
}

/**
 * แก้ไขความเห็นของตัวเอง
 *
 * **ผู้เขียนเท่านั้น ไม่มีข้อยกเว้น** · `editedAt` ถูกตั้งเสมอ เพื่อให้หน้าจอ
 * บอกได้ว่าข้อความนี้ไม่ใช่ฉบับแรก — บทสนทนาที่แก้ย้อนหลังได้เงียบ ๆ
 * ใช้เป็นหลักฐานไม่ได้
 */
export async function editComment(
  ctx: TenantContext,
  commentId: bigint,
  body: string,
  now: UtcDate = systemClock.nowUtc(),
): Promise<void> {
  const actorId = ctx.actorId;
  if (actorId === null) throw new CommentNotFoundError();

  const trimmed = body.trim();
  if (trimmed.length === 0) throw new EmptyCommentError();
  const text = trimmed.slice(0, COMMENT_MAX);

  const c = await loadComment(ctx, commentId);
  if (c.authorId !== actorId) throw new NotCommentAuthorError();

  await auditedTransaction(ctx, 'comment.edit', async (tx) => {
    await tx.workItemComment.update({
      where: { id: c.id },
      data: { body: { text }, editedAt: now },
    });
    return {
      result: undefined,
      /*
        ประวัติบันทึกว่า "มีการแก้ไข" ไม่ใช่เนื้อความเก่ากับใหม่

        ถ้าคัดลอกเนื้อความลงประวัติ การลบความเห็นจะไม่ได้ลบจริง และบันทึกภายใน
        จะรั่วผ่านไทม์ไลน์ที่ผู้แจ้งมองเห็น — เหตุผลเดียวกับตอนเพิ่มความเห็น
      */
      audit: [change(c.workItemId, '__comment_edited__', null, c.id.toString())],
    };
  });
}

/**
 * ลบความเห็น
 *
 * ผู้เขียนลบของตัวเองได้เสมอ · การลบของคนอื่นต้องมี `DELETE_COMMENT`
 * — คีย์นี้จึงมีผลจริงเป็นครั้งแรก
 */
export async function deleteComment(
  ctx: TenantContext,
  commentId: bigint,
  now: UtcDate = systemClock.nowUtc(),
): Promise<void> {
  const actorId = ctx.actorId;
  if (actorId === null) throw new CommentNotFoundError();

  const c = await loadComment(ctx, commentId);
  if (c.authorId !== actorId) {
    // ลบของคนอื่นต้องมีสิทธิ์ — ลบของตัวเองไม่ต้อง เพราะเป็นคำพูดของเขาเอง
    await assertCan(ctx, c.projectId, 'DELETE_COMMENT');
  }

  await auditedTransaction(ctx, 'comment.delete', async (tx) => {
    await tx.workItemComment.update({
      where: { id: c.id },
      /*
        ล้างเนื้อความทิ้งด้วย ไม่ใช่แค่ตั้ง `deletedAt`

        soft delete มีไว้ให้ audit ตอบได้ว่า "เคยมีความเห็นตรงนี้" ไม่ใช่ให้
        เนื้อความค้างอยู่ในฐานข้อมูลให้ใครก็ตามที่เปิดตารางดูอ่านได้ ·
        เหตุผลที่คนกดลบมักเป็นเพราะข้อความนั้นไม่ควรมีอยู่ตั้งแต่แรก
      */
      data: { deletedAt: now, body: { text: '' } },
    });

    /*
      ลบสำเนาที่ค้างอยู่ในกล่องแจ้งเตือนด้วย

      `notification.body` เก็บเนื้อความไว้ตอนแจ้ง · ถ้าลบแค่แถวความเห็น
      ข้อความที่ตั้งใจลบจะยังอ่านได้ในกล่องแจ้งเตือนของทุกคนที่ได้รับ
      และคนที่ลบจะเชื่อว่ามันหายแล้ว

      **อีเมลที่ส่งออกไปแล้วเรียกกลับไม่ได้** — เป็นข้อจำกัดจริงที่ต้องรู้
    */
    await tx.notification.deleteMany({
      where: { workItemId: c.workItemId, dedupeKey: { startsWith: `comment:${c.id.toString()}:` } },
    });

    return {
      result: undefined,
      audit: [change(c.workItemId, '__comment_deleted__', c.id.toString(), null)],
    };
  });
}
