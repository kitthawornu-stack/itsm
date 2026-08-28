/**
 * ผู้เฝ้าดูเรื่อง
 *
 * ตาราง `work_item_watcher` มีมาตั้งแต่ Phase 0 และ **ไม่มีโค้ดเส้นไหนแตะมันเลย**
 * — รูปแบบเดียวกับ `BULK_EDIT` `LINK_ITEM` และ `VIEW_REPORT`
 *
 * ## ทำไมฟีเจอร์นี้สำคัญกับองค์กรที่ย้ายมาจาก LINE
 *
 * ในกลุ่ม LINE ทุกคนเห็นทุกเรื่องโดยปริยาย · ระบบตั๋วที่แจ้งเฉพาะผู้แจ้งกับ
 * ผู้รับผิดชอบ ทำให้คนที่เคยเห็นทุกอย่าง **หยุดเห็น** ซึ่งเป็นเหตุผลอันดับหนึ่ง
 * ที่ทีมเลิกใช้แล้วกลับไปคุยกันในแชท · ปุ่มเฝ้าดูคือทางกลับของคนเหล่านั้น
 *
 * ## สิทธิ์ตรวจตอนส่ง ไม่ใช่ตอนกด
 *
 * สิทธิ์เปลี่ยนได้หลังกดเฝ้าดู · คนที่ย้ายทีมแล้วยังมีแถวค้างอยู่ ต้องไม่ได้รับ
 * หัวข้อเรื่องของโปรเจกต์ที่ตัวเองเข้าไม่ได้แล้ว — การแจ้งเตือนพกหัวข้อและ
 * เนื้อความไปด้วย มันจึงเป็นการรั่วที่ไม่ต้องกดอะไรเลยก็เกิด
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan, browsableProjectIds, permissionsFor } from '../permission';

export class WatchTargetNotFoundError extends Error {
  constructor() {
    super('ไม่พบเรื่องที่ระบุ');
    this.name = 'WatchTargetNotFoundError';
  }
}

export interface WatcherView {
  userId: string;
  displayName: string;
  addedAt: string;
}

async function visibleItem(
  ctx: TenantContext,
  itemKey: string,
): Promise<{ id: bigint; projectId: bigint }> {
  const allowed = await browsableProjectIds(ctx);
  const item =
    allowed.length === 0
      ? null
      : await tenantScoped(ctx).workItem.findFirst({
          where: { itemKey: itemKey.trim(), projectId: { in: allowed } },
          select: { id: true, projectId: true },
        });
  // ไม่มีอยู่จริง กับ เปิดดูไม่ได้ ตอบเหมือนกัน — ไม่ยืนยันว่าเลขนี้มีอยู่
  if (item === null) throw new WatchTargetNotFoundError();
  return item;
}

/**
 * เริ่มเฝ้าดู
 *
 * กดซ้ำไม่ใช่ความผิดพลาด และต้องไม่เขียนประวัติเพิ่ม — ประวัติที่รกเท่ากับ
 * ไม่มีประวัติ · `@@id([workItemId, userId])` กันแถวซ้ำให้อยู่แล้ว แต่การเช็กก่อน
 * ทำให้ไม่ต้องเขียน audit ที่ไม่มีอะไรเปลี่ยน
 */
export async function watch(ctx: TenantContext, itemKey: string): Promise<{ watching: boolean }> {
  const actorId = ctx.actorId;
  if (actorId === null) throw new WatchTargetNotFoundError();
  const item = await visibleItem(ctx, itemKey);
  // เฝ้าดูได้ถ้าเปิดดูได้ — ไม่ต้องมีสิทธิ์แก้ไข · การอ่านตามเรื่องไม่ใช่การแก้ของ
  await assertCan(ctx, item.projectId, 'BROWSE_PROJECT');

  const existing = await tenantScoped(ctx).workItemWatcher.findFirst({
    where: { workItemId: item.id, userId: actorId },
    select: { userId: true },
  });
  if (existing !== null) return { watching: true };

  await auditedTransaction(ctx, 'workitem.watch', async (tx) => {
    await tx.workItemWatcher.create({
      data: { tenantId: ctx.tenantId, workItemId: item.id, userId: actorId },
    });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'workitem.watch',
          entityType: 'work_item',
          entityId: item.id.toString(),
          payload: { itemKey: itemKey.trim() },
        },
      ],
    };
  });
  return { watching: true };
}

/** เลิกเฝ้าดู — กดซ้ำไม่ใช่ความผิดพลาดเช่นกัน */
export async function unwatch(ctx: TenantContext, itemKey: string): Promise<{ watching: boolean }> {
  const actorId = ctx.actorId;
  if (actorId === null) throw new WatchTargetNotFoundError();
  const item = await visibleItem(ctx, itemKey);

  const existing = await tenantScoped(ctx).workItemWatcher.findFirst({
    where: { workItemId: item.id, userId: actorId },
    select: { userId: true },
  });
  if (existing === null) return { watching: false };

  await auditedTransaction(ctx, 'workitem.unwatch', async (tx) => {
    await tx.workItemWatcher.delete({
      where: { workItemId_userId: { workItemId: item.id, userId: actorId } },
    });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'workitem.unwatch',
          entityType: 'work_item',
          entityId: item.id.toString(),
          payload: { itemKey: itemKey.trim() },
        },
      ],
    };
  });
  return { watching: false };
}

/** ใครเฝ้าดูเรื่องนี้อยู่บ้าง — สำหรับแสดงบนหน้ารายละเอียด */
export async function watchersOf(ctx: TenantContext, workItemId: bigint): Promise<WatcherView[]> {
  const rows = await tenantScoped(ctx).workItemWatcher.findMany({
    where: { workItemId },
    include: { user: { select: { id: true, displayName: true, isActive: true } } },
    orderBy: { addedAt: 'asc' },
  });
  return rows
    // บัญชีที่ปิดแล้วไม่ได้รับอะไรอยู่แล้ว การแสดงชื่อไว้ทำให้เข้าใจผิดว่ามีคนตามอยู่
    .filter((r) => r.user.isActive)
    .map((r) => ({
      userId: r.user.id.toString(),
      displayName: r.user.displayName,
      addedAt: r.addedAt.toISOString(),
    }));
}

/**
 * ผู้เฝ้าดูที่ **มีสิทธิ์รับแจ้งเตือนใบนี้จริง ณ ตอนนี้**
 *
 * กรองสามชั้น เพราะแต่ละชั้นพลาดแล้วเงียบคนละแบบ:
 *
 *   1. **บัญชีต้องยังใช้งานอยู่** — คนที่ลาออกไม่ควรมีแถวแจ้งเตือนค้างเพิ่มทุกวัน
 *   2. **ต้องเปิดดูโปรเจกต์ได้ ณ ตอนนี้** — สิทธิ์เปลี่ยนหลังกดเฝ้าดูได้
 *      และการแจ้งเตือนพกหัวข้อเรื่องไปด้วย จึงรั่วโดยไม่ต้องกดอะไรเลย
 *   3. **บันทึกภายในต้องมีสิทธิ์เห็นบันทึกภายใน** — `VIEW_INTERNAL_COMMENT`
 *      ไม่ใช่แค่เปิดดูโปรเจกต์ได้ · ผู้แจ้งที่กดเฝ้าดูเรื่องของตัวเอง
 *      ต้องไม่ได้รับเนื้อความที่ทีมคุยกันเอง
 */
export async function eligibleWatcherIds(
  ctx: TenantContext,
  workItemId: bigint,
  projectId: bigint,
  opts: { internal?: boolean } = {},
): Promise<bigint[]> {
  const rows = await tenantScoped(ctx).workItemWatcher.findMany({
    where: { workItemId },
    include: { user: { select: { id: true, isActive: true } } },
  });

  const out: bigint[] = [];
  for (const r of rows) {
    if (!r.user.isActive) continue;
    const keys = await permissionsFor({ ...ctx, actorId: r.user.id }, projectId);
    if (!keys.has('BROWSE_PROJECT')) continue;
    if (opts.internal === true && !keys.has('VIEW_INTERNAL_COMMENT')) continue;
    out.push(r.user.id);
  }
  return out;
}

/**
 * ผู้ใช้ที่ถูกกล่าวถึง **และมีสิทธิ์เห็นความเห็นใบนี้จริง**
 *
 * ใช้เกณฑ์เดียวกับผู้เฝ้าดู เพราะเป็นคำถามเดียวกัน: ใครเปิดเรื่องนี้ได้ตอนนี้
 * และถ้าเป็นบันทึกภายใน ใครเห็นบันทึกภายในได้ · การกล่าวถึงคนที่เปิดเรื่อง
 * ไม่ได้ แล้วส่งหัวข้อกับเนื้อความไปให้ คือการรั่วแบบเดียวกันเป๊ะ
 */
export async function eligibleMentions(
  ctx: TenantContext,
  projectId: bigint,
  userIds: readonly bigint[],
  opts: { internal?: boolean } = {},
): Promise<Array<{ userId: bigint; displayName: string }>> {
  if (userIds.length === 0) return [];
  const users = await tenantScoped(ctx).user.findMany({
    where: { id: { in: [...new Set(userIds)] }, isActive: true, isSystem: false },
    select: { id: true, displayName: true },
  });

  const out: Array<{ userId: bigint; displayName: string }> = [];
  for (const u of users) {
    const keys = await permissionsFor({ ...ctx, actorId: u.id }, projectId);
    if (!keys.has('BROWSE_PROJECT')) continue;
    if (opts.internal === true && !keys.has('VIEW_INTERNAL_COMMENT')) continue;
    out.push({ userId: u.id, displayName: u.displayName });
  }
  return out;
}

/**
 * คนที่เรียกถึงได้ในเรื่องนี้ — สำหรับรายการเลือกบนหน้าจอ
 *
 * เกณฑ์คือ "เปิดโปรเจกต์นี้ได้" ไม่ใช่ "รับงานได้" · คนที่มอบหมายงานให้ไม่ได้
 * ก็ยังตอบคำถามได้ · การใช้รายชื่อผู้รับงานมาทำเมนูเรียกถึง จะตัดคนที่
 * รู้คำตอบออกไปเงียบ ๆ
 *
 * รายชื่อนี้เปิดเผยว่าใครอยู่ในโปรเจกต์ ผู้เรียกจึงต้องคอมเมนต์ได้ก่อน
 */
export async function mentionableUsers(
  ctx: TenantContext,
  projectId: bigint,
): Promise<Array<{ id: string; displayName: string }>> {
  const users = await tenantScoped(ctx).user.findMany({
    where: { isActive: true, isSystem: false },
    select: { id: true, displayName: true },
    orderBy: { displayName: 'asc' },
  });

  const out: Array<{ id: string; displayName: string }> = [];
  for (const u of users) {
    const keys = await permissionsFor({ ...ctx, actorId: u.id }, projectId);
    if (keys.has('BROWSE_PROJECT')) out.push({ id: u.id.toString(), displayName: u.displayName });
  }
  return out;
}

/** ผู้ใช้ปัจจุบันเฝ้าดูเรื่องนี้อยู่ไหม — ให้หน้าจอแสดงปุ่มที่ถูกด้าน */
export async function isWatching(ctx: TenantContext, workItemId: bigint): Promise<boolean> {
  if (ctx.actorId === null) return false;
  const row = await tenantScoped(ctx).workItemWatcher.findFirst({
    where: { workItemId, userId: ctx.actorId },
    select: { userId: true },
  });
  return row !== null;
}
