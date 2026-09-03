/**
 * ฟิลด์บนการ์ดที่ผู้ใช้แต่ละคนเลือกเอง
 *
 * **เป็นค่าของแต่ละคน ไม่ใช่ของทั้งทีม** — คนที่ดูงานของตัวเองกับคนที่จัดคิว
 * ให้ทั้งทีม อยากเห็นคนละอย่างบนกระดานเดียวกัน · จึงไม่ต้องมี `MANAGE_PROJECT`
 * และไม่มีใครแก้ของคนอื่นได้: `userId` มาจาก `ctx.actorId` เสมอ
 * **ไม่ใช่จากพารามิเตอร์ที่ผู้เรียกส่งมา** ซึ่งเป็นวิธีที่ระบบสิทธิ์รั่วบ่อยที่สุด
 */
import { formatCardFields, parseCardFields, type CardField } from '@itsm/types';
import type { TenantContext } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { browsableProjectIds } from '../permission';

export class CardPrefProjectNotFoundError extends Error {
  constructor() {
    super('ไม่พบโปรเจกต์นี้ หรือคุณยังเปิดดูไม่ได้');
  }
}

/** ผู้ใช้ที่ยังไม่ได้ล็อกอิน ตั้งค่าส่วนตัวไม่ได้ */
export class NotSignedInError extends Error {
  constructor() {
    super('ต้องเข้าสู่ระบบก่อนจึงจะตั้งค่าส่วนตัวได้');
  }
}

async function projectOf(ctx: TenantContext, projectKey: string): Promise<bigint> {
  const allowed = await browsableProjectIds(ctx);
  const project =
    allowed.length === 0
      ? null
      : await tenantScoped(ctx).project.findFirst({
          where: { key: projectKey.trim(), id: { in: allowed } },
          select: { id: true },
        });
  if (project === null) throw new CardPrefProjectNotFoundError();
  return project.id;
}

export interface CardPref {
  fields: CardField[];
  /** ชื่อที่เก็บไว้แต่ไม่รู้จักแล้ว — บอกผู้ใช้ ไม่ใช่ทิ้งเงียบ */
  unknown: string[];
  /** ยังไม่เคยตั้งค่าเลย — ต่างจากตั้งใจปิดทุกอย่าง */
  isDefault: boolean;
}

/**
 * ค่าที่ผู้ใช้คนนี้ตั้งไว้สำหรับโปรเจกต์นี้
 *
 * **ไม่มีแถว = ยังไม่เคยตั้ง จึงได้ค่าปริยาย** · ต่างจากแถวที่เก็บสตริงว่าง
 * ซึ่งแปลว่าตั้งใจปิดทุกอย่าง — `parseCardFields` แยกสองอย่างนี้ให้
 */
export async function cardPrefOf(ctx: TenantContext, projectKey: string): Promise<CardPref> {
  const projectId = await projectOf(ctx, projectKey);
  if (ctx.actorId === null) {
    const p = parseCardFields(null);
    return { ...p, isDefault: true };
  }
  const row = await tenantScoped(ctx).boardCardPref.findFirst({
    where: { userId: ctx.actorId, projectId },
    select: { fields: true },
  });
  const parsed = parseCardFields(row === null ? null : row.fields);
  return { ...parsed, isDefault: row === null };
}

/**
 * ตั้งค่าของ **ตัวเอง** เท่านั้น
 *
 * ไม่เขียน audit — ค่าที่มีผลกับหน้าจอของคนคนเดียว ไม่ใช่การเปลี่ยนแปลง
 * ที่ใครต้องตรวจสอบย้อนหลัง · INVARIANT 2 พูดถึง mutation ของข้อมูลงาน
 * ไม่ใช่การตั้งค่าการแสดงผลส่วนตัว
 */
export async function setCardPref(
  ctx: TenantContext,
  projectKey: string,
  fields: readonly CardField[],
): Promise<CardPref> {
  const projectId = await projectOf(ctx, projectKey);
  if (ctx.actorId === null) throw new NotSignedInError();
  const raw = formatCardFields(fields);

  await tenantScoped(ctx).boardCardPref.upsert({
    where: { userId_projectId: { userId: ctx.actorId, projectId } },
    create: { tenantId: ctx.tenantId, userId: ctx.actorId, projectId, fields: raw },
    update: { fields: raw },
  });
  const parsed = parseCardFields(raw);
  return { ...parsed, isDefault: false };
}

/**
 * ลบค่าที่ตั้งไว้ กลับไปเป็น **"ยังไม่เคยตั้ง"**
 *
 * ต่างจากการบันทึกรายการว่าง ซึ่งแปลว่า "ตั้งใจไม่แสดงอะไรเลย" ·
 * ทั้งระบบแยกสองสถานะนี้ไว้ตั้งแต่ชั้นเก็บข้อมูล แต่ถ้าหน้าจอไปถึงได้
 * ทางเดียว **ผู้ใช้ที่ปิดทุกช่องแล้วจะกลับไม่ได้** — ความแตกต่างที่
 * ผู้ใช้ไปถึงไม่ได้ คือความแตกต่างที่ไม่มีอยู่จริงสำหรับเขา
 *
 * ลบด้วย unique key ที่ระบุแถวเดียว ไม่ใช่ `deleteMany` ด้วยเงื่อนไขช่วง
 * — `deleteMany` ที่ไม่ตรงแถวไหนเลยยังจับ gap lock ถึง supremum (CLAUDE.md)
 */
export async function resetCardPref(ctx: TenantContext, projectKey: string): Promise<CardPref> {
  const projectId = await projectOf(ctx, projectKey);
  if (ctx.actorId === null) throw new NotSignedInError();

  const db = tenantScoped(ctx);
  const row = await db.boardCardPref.findFirst({
    where: { userId: ctx.actorId, projectId },
    select: { id: true },
  });
  /*
    ไม่มีแถวอยู่แล้ว = สำเร็จ ไม่ใช่ error · การกดปุ่มที่ทำให้ไปถึงสถานะ
    ที่ต้องการอยู่แล้ว ควรเงียบ ไม่ใช่ฟ้อง
  */
  if (row !== null) await db.boardCardPref.delete({ where: { id: row.id } });

  const parsed = parseCardFields(null);
  return { ...parsed, isDefault: true };
}
