/**
 * คัดลอกเรื่อง — ต่อของจริง
 *
 * **สำเนาเดินผ่านเส้นทางเดียวกับการแจ้งเรื่องปกติ** (`createWorkItem` +
 * `prepareFieldValues`) · จึงสร้างสิ่งที่ฟอร์มสร้างไม่ได้ไม่ได้ ·
 * ถ้าตัวเลือกของฟิลด์ถูกปิดไปแล้ว สำเนาถูกปฏิเสธเหมือนกับที่คนกรอกเองถูกปฏิเสธ
 * — ซึ่งเป็นคำตอบที่ถูก ไม่ใช่ข้อจำกัด
 *
 * ทางเลือกที่ไม่เลือก: คัดลอกแถวใน SQL ตรง ๆ · เร็วกว่าและง่ายกว่า แต่จะข้าม
 * การตรวจฟิลด์บังคับ การออกคีย์ การตั้งนาฬิกา SLA และ audit ทั้งหมด —
 * ได้ตั๋วที่หน้าตาเหมือนตั๋วแต่ระบบไม่รู้จัก
 */
import type { TenantContext } from '@itsm/types';

import { prepareFieldValues, readFieldValues } from '../field';
import { assertCan } from '../permission';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

import { planClone } from './clone-plan';
import { createWorkItem, type CreatedWorkItem } from './workitem.service';

export class WorkItemNotFoundForCloneError extends Error {
  constructor(readonly itemKey: string) {
    super(`ไม่พบเรื่อง ${itemKey}`);
    this.name = 'WorkItemNotFoundForCloneError';
  }
}

/**
 * สร้างสำเนาของเรื่องหนึ่ง
 *
 * ## ด่านสองอัน คนละเรื่องกัน
 *
 *   1. **อ่านใบต้นทาง** ต้องมี `BROWSE_PROJECT` — ตรวจที่นี่
 *   2. **สร้างใบใหม่** ต้องมี `CREATE_ITEM` — `createWorkItem` ตรวจให้อยู่แล้ว
 *      **ไม่ตรวจซ้ำที่นี่** · ตอนพิสูจน์ว่าเทสต์แดงได้ พบว่าถอด `CREATE_ITEM`
 *      ออกจากที่นี่แล้วยังเขียว เพราะด่านของ `createWorkItem` รับไว้ —
 *      สองด่านสำหรับเรื่องเดียวทำให้ลบอันไหนออกเทสต์ก็ยังเขียว แล้วไม่มีใครรู้
 *      ว่าอันไหนคือด่านจริง (CLAUDE.md)
 *
 * ถ้าไม่ตรวจข้อ 1 คนที่เปิดดูโปรเจกต์นั้นไม่ได้จะแยกออกว่า "ไม่มีเรื่องนี้" (404)
 * ต่างจาก "มีแต่คุณสร้างไม่ได้" (403) ซึ่งบอกใบ้ว่าเลขที่เรื่องนั้นมีอยู่จริง
 */
export async function cloneWorkItem(
  ctx: TenantContext,
  itemKey: string,
): Promise<CreatedWorkItem> {
  const db = tenantScoped(ctx);
  const source = await db.workItem.findFirst({
    where: { itemKey },
    select: {
      id: true,
      summary: true,
      description: true,
      projectId: true,
      issueTypeId: true,
      project: { select: { key: true } },
      issueType: { select: { name: true } },
      priority: { select: { rank: true } },
    },
  });
  if (source === null) throw new WorkItemNotFoundForCloneError(itemKey);

  await assertCan(ctx, source.projectId, 'BROWSE_PROJECT');

  /*
    อ่านค่าฟิลด์จาก snapshot ที่ `readFieldValues` ประกอบจาก EAV —
    **ไม่อ่าน `fieldSnapshot` ในคอลัมน์ตรง ๆ** เพราะ ADR-001 บอกว่าคอลัมน์นั้น
    เป็นสำเนาอ่านอย่างเดียวสำหรับเรนเดอร์ลิสต์ ห้ามเอาไปเขียนต่อ
  */
  const values = await readFieldValues(ctx, source.id);

  const plan = planClone({
    summary: source.summary,
    /*
      `description` เก็บเป็น JSON `{ format, text }` · ดึงข้อความล้วนออกมา
      เพราะ `createWorkItem` รับข้อความ แล้วประกอบรูปนั้นขึ้นเองอีกที ·
      ส่งอ็อบเจกต์ดิบเข้าไปจะได้รายละเอียดที่เป็น `[object Object]`
    */
    description: textOf(source.description),
    issueTypeName: source.issueType.name,
    projectKey: source.project.key,
    priorityRank: source.priority?.rank ?? null,
    fields: values,
  });

  /*
    ตรวจค่าฟิลด์ **ก่อน** สร้าง ด้วยตัวตรวจตัวเดียวกับฟอร์ม · ถ้าตัวเลือกเดิม
    ถูกปิดไปแล้ว จะถูกปฏิเสธที่นี่และไม่มีตั๋วเกิดขึ้น
  */
  const fieldValues = await prepareFieldValues(
    ctx,
    source.projectId,
    source.issueTypeId,
    plan.fields,
  );

  return createWorkItem(ctx, {
    projectKey: plan.projectKey,
    issueTypeName: plan.issueTypeName,
    summary: plan.summary,
    ...(plan.description === '' ? {} : { description: plan.description }),
    ...(plan.priorityRank === null ? {} : { priorityRank: plan.priorityRank }),
    fieldValues,
  });
}

/** ข้อความล้วนจาก `{ format, text }` — รูปแบบอื่นหรือค่าเสีย คืนค่าว่าง */
function textOf(raw: unknown): string {
  if (raw === null || typeof raw !== 'object') return '';
  const t = (raw as { text?: unknown }).text;
  return typeof t === 'string' ? t : '';
}
