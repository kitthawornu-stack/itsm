/**
 * ไฟล์แนบบนงาน
 *
 * คนแจ้งปัญหาส่งภาพหน้าจอเป็นเรื่องปกติ — ศูนย์บริการที่รับภาพไม่ได้
 * บังคับให้คนบรรยายสิ่งที่เห็นเป็นตัวอักษร ซึ่งช้ากว่าและคลาดเคลื่อนกว่า
 *
 * ลำดับที่สำคัญ: **เก็บไบต์ก่อน แล้วจึงบันทึกแถว**
 * ถ้าบันทึกแถวก่อนแล้วเก็บไฟล์พลาด จะได้แถวที่ชี้ไปไฟล์ที่ไม่มีอยู่ ซึ่งผู้ใช้
 * เห็นในรายการแต่กดโหลดไม่ได้ · กลับกัน ไฟล์ที่ไม่มีแถวชี้ถึงเป็นแค่ขยะเงียบ ๆ
 * ที่กวาดทีหลังได้ — เสียพื้นที่ ไม่เสียความเชื่อถือ
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import {
  auditedTransaction,
  change,
  type AuditEntry,
} from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { deleteObject, getObject, putObject } from '../../infrastructure/storage/object-store';
import {
  contentDisposition,
  safeDisplayName,
  storageKey,
  validateUpload,
  type Rejection,
} from './attachment-policy';
import { can, assertCan, PermissionDeniedError } from '../permission';
import { WorkItemNotFoundError } from './workitem.service';

export class AttachmentRejectedError extends Error {
  readonly code: Rejection['code'];
  constructor(rejection: Rejection) {
    super(rejection.message);
    this.name = 'AttachmentRejectedError';
    this.code = rejection.code;
  }
}

export class AttachmentNotFoundError extends Error {
  constructor(id: string) {
    super(`ไม่พบไฟล์แนบ ${id}`);
    this.name = 'AttachmentNotFoundError';
  }
}

export interface AttachmentView {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploader: string;
  createdAt: string;
  /**
   * ผู้ที่กำลังดูลบไฟล์นี้ได้ไหม
   *
   * มีไว้ให้หน้าจอไม่แสดงปุ่มที่กดแล้วได้ 403 เท่านั้น — **เซิร์ฟเวอร์ปฏิเสธเอง
   * ทุกครั้ง** การซ่อนปุ่มไม่ใช่การป้องกัน (CLAUDE.md กติกาเฉพาะของสิทธิ์)
   */
  canDelete: boolean;
}

export interface UploadInput {
  itemKey: string;
  filename: string;
  mimeType: string;
  content: Buffer;
}

export async function uploadAttachment(
  ctx: TenantContext,
  input: UploadInput,
  now: UtcDate = systemClock.nowUtc(),
): Promise<AttachmentView> {
  if (ctx.actorId === null) throw new Error('uploadAttachment ต้องมีผู้อัปโหลด (actorId)');
  const uploaderId = ctx.actorId;

  const verdict = validateUpload({
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.content.byteLength,
  });
  if (!verdict.ok) throw new AttachmentRejectedError(verdict);

  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({
    where: { itemKey: input.itemKey },
    select: { id: true, projectId: true },
  });
  if (item === null) throw new WorkItemNotFoundError(input.itemKey);

  // แนบไฟล์ได้ถ้ามีสิทธิ์แนบโดยตรง หรือแก้ไขงานได้อยู่แล้ว
  const mayAttach =
    (await can(ctx, item.projectId, 'MANAGE_ATTACHMENT')) ||
    (await can(ctx, item.projectId, 'EDIT_ITEM'));
  if (!mayAttach) throw new PermissionDeniedError('MANAGE_ATTACHMENT');

  const filename = safeDisplayName(input.filename);
  const uploader = await db.user.findFirst({
    where: { id: uploaderId },
    select: { displayName: true },
  });

  /**
   * จอง id ก่อน เพื่อให้ key ของไฟล์ผูกกับแถวที่แน่นอน
   *
   * ใช้ id ที่ฐานข้อมูลออกให้ แทนการสุ่มชื่อ เพราะถ้าเกิด key ชนกันเมื่อไร
   * แปลว่าเรามีบั๊กที่ร้ายแรงกว่านั้นมาก และอยากให้มันดังทันที ไม่ใช่เขียนทับเงียบ ๆ
   */
  const draft = await db.workItemAttachment.create({
    data: {
      tenantId: ctx.tenantId,
      workItemId: item.id,
      uploaderId,
      filename,
      mimeType: input.mimeType.split(';')[0]?.trim().toLowerCase() ?? '',
      sizeBytes: BigInt(input.content.byteLength),
      // เติมทันทีหลังรู้ id — ค่าชั่วคราวนี้ไม่เคยถูกใช้อ่านไฟล์
      storageKey: '',
      createdAt: now,
    },
    select: { id: true, createdAt: true },
  });

  const key = storageKey({
    tenantId: ctx.tenantId,
    workItemId: item.id,
    attachmentId: draft.id,
    filename,
  });

  try {
    await putObject(key, input.content, input.mimeType);
  } catch (err) {
    // เก็บไบต์ไม่สำเร็จ = ต้องไม่เหลือแถวที่ชี้ไปไฟล์ที่ไม่มีอยู่
    await db.workItemAttachment.deleteMany({ where: { id: draft.id } });
    throw err;
  }

  return auditedTransaction(ctx, 'workitem.attachment.upload', async (tx) => {
    await tx.workItemAttachment.update({
      where: { id: draft.id },
      data: { storageKey: key },
    });
    const audit: AuditEntry[] = [change(item.id, '__attachment__', null, filename)];
    return {
      result: {
        id: draft.id.toString(),
        filename,
        mimeType: input.mimeType,
        sizeBytes: input.content.byteLength,
        uploader: uploader?.displayName ?? 'ไม่ทราบชื่อ',
        createdAt: draft.createdAt.toISOString(),
        // คนที่เพิ่งแนบเอง ลบของตัวเองได้เสมอ
        canDelete: true,
      },
      audit,
    };
  });
}

export async function listAttachments(
  ctx: TenantContext,
  itemKey: string,
): Promise<AttachmentView[]> {
  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({
    where: { itemKey },
    select: { id: true, projectId: true },
  });
  if (item === null) throw new WorkItemNotFoundError(itemKey);

  await assertCan(ctx, item.projectId, 'BROWSE_PROJECT');

  const rows = await db.workItemAttachment.findMany({
    // ไฟล์ที่ยังเก็บไบต์ไม่เสร็จ (storageKey ว่าง) ไม่แสดง — กดโหลดแล้วจะพัง
    where: { workItemId: item.id, NOT: { storageKey: '' } },
    orderBy: { id: 'asc' },
    include: { uploader: { select: { displayName: true } } },
  });

  /*
    ถามสิทธิ์ลบครั้งเดียวสำหรับทั้งหน้า ไม่ใช่ทีละไฟล์ — `MANAGE_ATTACHMENT`
    ผูกกับโปรเจกต์ ไม่ได้ผูกกับไฟล์ · กติกาเดียวกับความเห็น
  */
  const mayDeleteAny = await can(ctx, item.projectId, 'MANAGE_ATTACHMENT');
  return rows.map((r) => ({
    id: r.id.toString(),
    filename: r.filename,
    mimeType: r.mimeType,
    sizeBytes: Number(r.sizeBytes),
    uploader: r.uploader.displayName,
    createdAt: r.createdAt.toISOString(),
    canDelete: (ctx.actorId !== null && r.uploaderId === ctx.actorId) || mayDeleteAny,
  }));
}

export interface DownloadResult {
  content: Buffer;
  mimeType: string;
  disposition: string;
}

export async function downloadAttachment(
  ctx: TenantContext,
  attachmentId: bigint,
): Promise<DownloadResult> {
  const db = tenantScoped(ctx);
  // findFirst ผูก tenant ให้อยู่แล้ว — ไฟล์ของ tenant อื่นจึงหาไม่เจอ ไม่ใช่หาเจอแล้วปฏิเสธ
  const row = await db.workItemAttachment.findFirst({
    where: { id: attachmentId },
    include: { workItem: { select: { projectId: true } } },
  });
  if (row === null || row.storageKey === '') {
    throw new AttachmentNotFoundError(attachmentId.toString());
  }

  // ดาวน์โหลดได้เฉพาะคนที่เปิดดูโปรเจกต์นั้นได้ — id เดาได้ง่ายเกินกว่าจะปล่อย
  await assertCan(ctx, row.workItem.projectId, 'BROWSE_PROJECT');

  return {
    content: await getObject(row.storageKey),
    mimeType: row.mimeType,
    // บังคับดาวน์โหลดเสมอ ไม่เปิดในเบราว์เซอร์ (ดู attachment-policy)
    disposition: contentDisposition(row.filename),
  };
}

/**
 * ลบไฟล์แนบ — **แถวก่อน ไบต์ทีหลัง**
 *
 * ## ลำดับเดิมกลับด้านกับเหตุผลของตัวเอง
 *
 * โค้ดเดิมลบไบต์ก่อนแล้วค่อยลบแถว พร้อมคอมเมนต์ว่าทำเพื่อไม่ให้เหลือ
 * "แถวที่ชี้ไปไฟล์ที่ไม่มีอยู่" — แต่ลำดับนั้นให้ผลตรงข้าม ถ้าทรานแซกชันล้ม
 * หลังไบต์หายไปแล้ว แถวจะค้างอยู่และชี้ไปไฟล์ที่ไม่มี ซึ่งผู้ใช้เห็นในรายการ
 * แต่กดโหลดไม่ได้ · ไม่มีใครเจอเพราะ **ไม่เคยมีอะไรเรียกฟังก์ชันนี้เลย**
 *
 * ลบแถวก่อนให้ผลที่แย่น้อยกว่า: ไฟล์กำพร้าใน MinIO ที่กวาดทีหลังได้
 * — เสียพื้นที่ ไม่เสียความเชื่อถือ (เหตุผลเดียวกับหัวไฟล์)
 *
 * ## ใครลบได้
 *
 * เจ้าของไฟล์ลบของตัวเองได้เสมอ · ลบของคนอื่นต้องมี `MANAGE_ATTACHMENT`
 * · **`EDIT_ITEM` ให้แนบได้แต่ไม่ให้ลบของคนอื่น** — การลบหลักฐานที่คนอื่น
 * แนบไว้เป็นการกระทำที่หนักกว่าการแนบเพิ่ม และกู้กลับไม่ได้
 */
export async function deleteAttachment(ctx: TenantContext, attachmentId: bigint): Promise<void> {
  const db = tenantScoped(ctx);
  const row = await db.workItemAttachment.findFirst({
    where: { id: attachmentId },
    include: { workItem: { select: { projectId: true } } },
  });
  if (row === null) throw new AttachmentNotFoundError(attachmentId.toString());

  const mine = ctx.actorId !== null && row.uploaderId === ctx.actorId;
  if (!mine && !(await can(ctx, row.workItem.projectId, 'MANAGE_ATTACHMENT'))) {
    throw new PermissionDeniedError('MANAGE_ATTACHMENT');
  }

  await auditedTransaction(ctx, 'workitem.attachment.delete', async (tx) => {
    await tx.workItemAttachment.delete({ where: { id: row.id } });
    return {
      result: undefined,
      audit: [change(row.workItemId, '__attachment_deleted__', row.filename, null)],
    };
  });

  /*
    ไบต์หลังสุด และนอกทรานแซกชัน — ถ้าลบไม่สำเร็จเหลือแค่ขยะใน MinIO
    ไม่ใช่แถวที่ผู้ใช้กดแล้วพัง · ไม่โยนต่อเพราะแถวหายไปแล้ว
    ผู้ใช้ทำอะไรกับ error นี้ไม่ได้
  */
  if (row.storageKey !== '') {
    try {
      await deleteObject(row.storageKey);
    } catch {
      // ตั้งใจกลืน — ดูเหตุผลข้างบน
    }
  }
}
