/**
 * แก้ไขหลายเรื่องพร้อมกัน
 *
 * ไฟล์นี้ทำให้ `BULK_EDIT` มีผลจริงเป็นครั้งแรก · ก่อนหน้านี้คีย์นี้อยู่ใน enum
 * แสดงบนหน้าตั้งค่า และ seed ให้กับกลุ่ม IT Support ไว้แล้ว **แต่ไม่มีโค้ด
 * เส้นไหนถามถึงมันเลย** ผู้ดูแลจึงอ่านหน้าจอได้ว่า "แก้ไขหลายเรื่องพร้อมกัน —
 * IT Support" ซึ่งเป็นความเชื่อที่หน้าจอสร้างขึ้นเองทั้งหมด
 *
 * **ทำไมไม่เรียก `editWorkItem` / `assignWorkItem` วนลูป**
 *
 * ทั้งสองตัวโยน error เมื่อทำไม่ได้ ซึ่งถูกต้องสำหรับใบเดียว แต่ผิดสำหรับทั้งชุด:
 * ใบที่ทำไม่ได้ใบเดียวจะทำให้อีก 49 ใบไม่ถูกแตะ และผู้ใช้ไม่รู้ว่าใบไหนสำเร็จ
 * ที่นี่จึงเก็บผลรายใบและเดินต่อ — **ล้มทีละใบ ไม่ล้มทั้งรอบ**
 *
 * ข้อยกเว้นคือความผิดพลาดที่เป็นของ **คำขอ** ไม่ใช่ของงานใบใดใบหนึ่ง
 * (ไม่มีสิทธิ์ · เกินเพดาน · ระดับความสำคัญที่ไม่มีอยู่จริง) — พวกนี้โยนทั้งชุด
 * ก่อนแตะใบไหน เพราะผลลัพธ์ที่อ่านว่า "ทุกใบล้ม" จะชี้ไปที่งาน ไม่ใช่ที่ค่าที่กรอก
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import {
  auditedTransaction,
  change,
  type AuditEntry,
} from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { createNotifications } from '../notification';
import { assertCan, browsableProjectIds } from '../permission';
import { indexWorkItem } from '../search-index';
import { InvalidFieldValueError } from './edit.service';
import { AssigneeNotEligibleError } from './assign.service';

/**
 * จำนวนใบสูงสุดต่อครั้ง
 *
 * เท่ากับที่หน้าคิวแสดงต่อหน้า — เพดานที่ตรงกับสิ่งที่ตาเห็นทำให้ผู้ใช้
 * เดาได้เองว่าทำไมถึงเกิน แทนที่จะเจอเลขที่ไม่รู้ที่มา
 */
export const BULK_MAX = 50;

export class NothingSelectedError extends Error {
  constructor(message = 'ยังไม่ได้เลือกเรื่องที่จะแก้') {
    super(message);
    this.name = 'NothingSelectedError';
  }
}

export class BulkTooManyItemsError extends Error {
  constructor(readonly given: number) {
    super(`แก้ได้ครั้งละไม่เกิน ${String(BULK_MAX)} เรื่อง — เลือกมา ${String(given)} เรื่อง`);
    this.name = 'BulkTooManyItemsError';
  }
}

export interface BulkChanges {
  /** ไม่ส่ง = ไม่แตะ · ส่ง null = ปลดผู้รับผิดชอบ (คืนงานเข้ากอง) */
  assigneeId?: bigint | null;
  /** ไม่ส่ง = ไม่แตะ · ส่ง null = ล้างระดับความสำคัญ */
  priorityRank?: number | null;
}

/**
 * ผลของงานใบเดียวในชุด
 *
 * `not-found` ครอบสองกรณีโดยตั้งใจ: ไม่มีอยู่จริง กับ มีอยู่แต่เปิดดูไม่ได้
 * การแยกสองอย่างนี้ออกจากกันคือการยืนยันว่าเลขที่เรื่องนั้นมีอยู่
 * ซึ่งเป็นการวาดแผนที่ให้คนที่กำลังไล่เดา
 */
export type BulkOutcome = 'changed' | 'unchanged' | 'not-found' | 'failed';

export interface BulkItemResult {
  itemKey: string;
  outcome: BulkOutcome;
  /** ชื่อฟิลด์ที่เปลี่ยนจริง — ว่างเมื่อไม่ได้เปลี่ยนอะไร */
  changed: string[];
  /** เหตุผลที่ทำไม่ได้ — มีเฉพาะเมื่อ outcome เป็น failed */
  reason?: string;
}

export interface BulkEditResult {
  /** จำนวนใบหลังยุบคีย์ซ้ำ ไม่ใช่จำนวนที่ส่งมา */
  requested: number;
  changed: number;
  unchanged: number;
  failed: number;
  items: BulkItemResult[];
}

/**
 * แก้ไขงานหลายใบพร้อมกัน
 *
 * ตรวจสิทธิ์ **ทุกโปรเจกต์ที่ชุดนี้แตะ** ไม่ใช่แค่โปรเจกต์แรก — คิวรี HQL
 * เลือกงานข้ามโปรเจกต์ได้ และคนที่แก้ SD ได้ ไม่ได้แปลว่าแก้ PLAT ได้ด้วย
 */
export async function bulkEditWorkItems(
  ctx: TenantContext,
  itemKeys: readonly string[],
  changes: BulkChanges,
  now: UtcDate = systemClock.nowUtc(),
): Promise<BulkEditResult> {
  const touchesAssignee = changes.assigneeId !== undefined;
  const touchesPriority = changes.priorityRank !== undefined;
  if (!touchesAssignee && !touchesPriority) {
    throw new NothingSelectedError('ยังไม่ได้เลือกว่าจะเปลี่ยนอะไร');
  }

  // ยุบคีย์ซ้ำก่อนนับ — เลือกใบเดิมสิบครั้งไม่ใช่สิบใบ และไม่ควรกินโควตา
  const keys = [...new Set(itemKeys.map((k) => k.trim()).filter((k) => k !== ''))];
  if (keys.length === 0) throw new NothingSelectedError();
  // ปฏิเสธทั้งชุด ไม่ตัดเงียบ ๆ — ตัดเงียบแปลว่าผู้ใช้เชื่อว่าแก้ครบแล้ว
  if (keys.length > BULK_MAX) throw new BulkTooManyItemsError(keys.length);

  const db = tenantScoped(ctx);

  /*
    อ่านเฉพาะงานของโปรเจกต์ที่เปิดดูได้ **ที่ระดับคิวรี**
    ถ้าอ่านมาทั้งหมดแล้วค่อยคัดทีหลัง แถวของโปรเจกต์ที่ไม่มีสิทธิ์ก็ถูกอ่าน
    ออกมาแล้วหนึ่งรอบอยู่ดี · ใบที่ไม่อยู่ในผลนี้จะได้ผลเป็น `not-found`
    เหมือนกับใบที่ไม่มีอยู่จริง
  */
  const allowed = await browsableProjectIds(ctx);
  const items =
    allowed.length === 0
      ? []
      : await db.workItem.findMany({
          where: { itemKey: { in: keys }, projectId: { in: allowed } },
          select: {
            id: true,
            itemKey: true,
            projectId: true,
            summary: true,
            assigneeId: true,
            assignee: { select: { id: true, displayName: true } },
            priority: { select: { id: true, name: true, rank: true } },
          },
        });

  /*
    ตรวจสิทธิ์ก่อนแตะใบไหน และตรวจทุกโปรเจกต์ที่ชุดนี้แตะ

    `assertCan` โยนทันทีที่เจอโปรเจกต์แรกที่ไม่ผ่าน จึงไม่มีใบไหนถูกแก้ไปครึ่งชุด
    — ต่างจากการตรวจในลูป ซึ่งจะแก้ใบแรก ๆ ไปแล้วค่อยล้ม
  */
  const projectIds = [...new Set(items.map((i) => i.projectId.toString()))].map((s) => BigInt(s));
  for (const pid of projectIds) {
    await assertCan(ctx, pid, 'BULK_EDIT');
    if (touchesPriority) await assertCan(ctx, pid, 'EDIT_ITEM');
    if (touchesAssignee) await assertCan(ctx, pid, 'ASSIGN_ITEM');
  }

  /*
    แปลงค่าที่กรอกเป็นค่าจริงครั้งเดียว ไม่ใช่ทุกใบ

    ค่าที่ผิดเป็นความผิดของคำขอ — โยนทั้งชุดก่อนแตะใบไหน
  */
  let nextPriority: { id: number; name: string } | null = null;
  if (touchesPriority && changes.priorityRank !== null) {
    const p = await db.priority.findFirst({
      where: { rank: changes.priorityRank },
      select: { id: true, name: true },
    });
    if (p === null) throw new InvalidFieldValueError('priorityRank', 'ไม่พบระดับความสำคัญที่เลือก');
    nextPriority = p;
  }

  let nextAssignee: { id: bigint; displayName: string } | null = null;
  if (touchesAssignee && changes.assigneeId !== null) {
    const u = await db.user.findFirst({
      where: { id: changes.assigneeId, isActive: true, isSystem: false },
      select: { id: true, displayName: true },
    });
    if (u === null) throw new AssigneeNotEligibleError();
    nextAssignee = u;
  }

  const byKey = new Map(items.map((i) => [i.itemKey, i]));
  const results: BulkItemResult[] = [];

  for (const key of keys) {
    const item = byKey.get(key);
    if (item === undefined) {
      results.push({ itemKey: key, outcome: 'not-found', changed: [] });
      continue;
    }

    /*
      ผู้รับงานคนใหม่ต้องเปิดดูโปรเจกต์ของใบนั้นได้

      ตรวจรายใบ ไม่ใช่ครั้งเดียว — ชุดหนึ่งข้ามหลายโปรเจกต์ได้ และคนที่เปิด SD
      ได้อาจเปิด PLAT ไม่ได้ · มอบหมายให้คนที่เปิดงานไม่ได้ = งานหายไปจากทุกคน
      เจ้าตัวเห็นไม่ได้ และคนอื่นเห็นว่ามีเจ้าของแล้วจึงไม่หยิบ
    */
    if (nextAssignee !== null) {
      const eligible = await db.permissionGrant.findFirst({
        where: {
          permission: 'BROWSE_PROJECT',
          scheme: { projects: { some: { id: item.projectId } } },
          group: { members: { some: { userId: nextAssignee.id } } },
        },
        select: { id: true },
      });
      if (eligible === null) {
        results.push({
          itemKey: key,
          outcome: 'failed',
          changed: [],
          reason: 'มอบหมายให้ผู้ใช้รายนี้ในโปรเจกต์นี้ไม่ได้',
        });
        continue;
      }
    }

    const data: Record<string, unknown> = {};
    const audit: AuditEntry[] = [];
    const changedFields: string[] = [];

    if (touchesPriority && (item.priority?.id ?? null) !== (nextPriority?.id ?? null)) {
      data['priorityId'] = nextPriority?.id ?? null;
      audit.push(change(item.id, 'priority', item.priority?.name ?? null, nextPriority?.name ?? null));
      changedFields.push('priority');
    }

    if (touchesAssignee && (item.assigneeId ?? null) !== (nextAssignee?.id ?? null)) {
      data['assigneeId'] = nextAssignee?.id ?? null;
      audit.push(
        change(item.id, 'assignee', item.assignee?.displayName ?? null, nextAssignee?.displayName ?? null),
      );
      changedFields.push('assignee');
    }

    // ตั้งค่าเดิมซ้ำ = ไม่เขียนอะไรเลย · ประวัติที่รกเท่ากับไม่มีประวัติ
    if (changedFields.length === 0) {
      results.push({ itemKey: key, outcome: 'unchanged', changed: [] });
      continue;
    }

    try {
      await auditedTransaction(ctx, 'workitem.bulk-edit', async (tx) => {
        await tx.workItem.update({ where: { id: item.id }, data });

        /*
          แจ้งผู้รับงานคนใหม่ — ยกเว้นตอนที่รับงานเอง

          `dedupeKey` ประกอบจาก (งาน, ผู้รับ, เวลา) เหมือนการมอบหมายทีละใบ
          เพื่อให้ unique index เป็นด่านสุดท้ายกันการส่งซ้ำ
        */
        if (nextAssignee !== null && nextAssignee.id !== ctx.actorId) {
          await createNotifications(ctx, tx, item.projectId, [
            {
              userId: nextAssignee.id,
              workItemId: item.id,
              kind: 'workitem.assigned',
              reason: 'assignee',
              title: `${item.itemKey} ถูกมอบหมายให้คุณ`,
              body: item.summary,
              dedupeKey: `assign:${item.id.toString()}:${nextAssignee.id.toString()}:${String(now.getTime())}`,
            },
          ]);
        }

        return { result: undefined, audit };
      });

      // ดัชนีค้นหาตามหลังได้ · ล้มที่นี่ไม่ควรทำให้การแก้ที่สำเร็จแล้วดูเหมือนล้ม
      await indexWorkItem(ctx, item.id).catch(() => undefined);
      results.push({ itemKey: key, outcome: 'changed', changed: changedFields });
    } catch (e) {
      results.push({
        itemKey: key,
        outcome: 'failed',
        changed: [],
        reason: e instanceof Error ? e.message : 'แก้ไม่สำเร็จ',
      });
    }
  }

  return {
    requested: keys.length,
    changed: results.filter((r) => r.outcome === 'changed').length,
    unchanged: results.filter((r) => r.outcome === 'unchanged').length,
    failed: results.filter((r) => r.outcome === 'not-found' || r.outcome === 'failed').length,
    items: results,
  };
}
