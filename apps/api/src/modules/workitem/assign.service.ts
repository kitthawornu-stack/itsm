/**
 * มอบหมายงาน
 *
 * ก่อนมีไฟล์นี้ การจ่ายงานต้องแก้ฐานข้อมูลเอง ซึ่งแปลว่าวงจร
 * "รับเรื่อง → จ่ายงาน → ทำ" ยังขาดตรงกลางไปทั้งท่อน
 *
 * สองอย่างที่ต้องเกิดพร้อมกันเสมอ:
 *   - **ประวัติ** ต้องบอกว่าใครเปลี่ยนจากใครเป็นใคร ไม่ใช่แค่ว่าตอนนี้เป็นใคร
 *   - **แจ้งเตือนผู้รับงานคนใหม่** — งานที่จ่ายให้แล้วไม่มีใครรู้ คือความเงียบ
 *     ที่ทำให้ SLA หลุดโดยไม่มีใครผิด
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import {
  auditedTransaction,
  change,
  type AuditEntry,
} from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan } from '../permission';
import { WorkItemNotFoundError } from './workitem.service';

export class AssigneeNotEligibleError extends Error {
  constructor() {
    // ไม่บอกว่าคนนั้นมีอยู่จริงหรือไม่ — ใช้ไล่หาว่าใครอยู่ในระบบได้
    super('มอบหมายให้ผู้ใช้รายนี้ไม่ได้');
    this.name = 'AssigneeNotEligibleError';
  }
}

export interface AssignResult {
  itemKey: string;
  assignee: { id: string; displayName: string } | null;
  previous: { id: string; displayName: string } | null;
}

/**
 * มอบหมายงานให้คนหนึ่ง หรือปลดผู้รับผิดชอบเมื่อส่ง `null`
 *
 * `assigneeId` เป็น null = คืนงานเข้ากอง ซึ่งต้องทำได้ ไม่ใช่ต้องหาคนมารับต่อเสมอ
 */
export async function assignWorkItem(
  ctx: TenantContext,
  itemKey: string,
  assigneeId: bigint | null,
  now: UtcDate = systemClock.nowUtc(),
): Promise<AssignResult> {
  const db = tenantScoped(ctx);
  const item = await db.workItem.findFirst({
    where: { itemKey },
    select: {
      id: true,
      itemKey: true,
      summary: true,
      projectId: true,
      assigneeId: true,
      assignee: { select: { id: true, displayName: true } },
    },
  });
  if (item === null) throw new WorkItemNotFoundError(itemKey);

  await assertCan(ctx, item.projectId, 'ASSIGN_ITEM');

  let next: { id: bigint; displayName: string } | null = null;
  if (assigneeId !== null) {
    /**
     * ผู้รับงานต้องเปิดดูโปรเจกต์นั้นได้
     *
     * มอบหมายให้คนที่เปิดงานไม่ได้ = งานหายไปจากทุกคน: เจ้าตัวเห็นไม่ได้
     * และคนอื่นเห็นว่ามีเจ้าของแล้วจึงไม่หยิบ · ต้องกันตั้งแต่ตอนจ่าย
     */
    const candidate = await db.user.findFirst({
      where: { id: assigneeId, isActive: true, isSystem: false },
      select: { id: true, displayName: true },
    });
    if (candidate === null) throw new AssigneeNotEligibleError();

    const eligible = await db.permissionGrant.findFirst({
      where: {
        permission: 'BROWSE_PROJECT',
        scheme: { projects: { some: { id: item.projectId } } },
        group: { members: { some: { userId: assigneeId } } },
      },
      select: { id: true },
    });
    if (eligible === null) throw new AssigneeNotEligibleError();
    next = candidate;
  }

  // มอบหมายให้คนเดิมซ้ำ = ไม่ต้องเขียนประวัติหรือแจ้งเตือนซ้ำ
  if ((item.assigneeId ?? null) === (next?.id ?? null)) {
    return {
      itemKey: item.itemKey,
      assignee: next === null ? null : { id: next.id.toString(), displayName: next.displayName },
      previous:
        item.assignee === null
          ? null
          : { id: item.assignee.id.toString(), displayName: item.assignee.displayName },
    };
  }

  await auditedTransaction(ctx, 'workitem.assign', async (tx) => {
    await tx.workItem.update({
      where: { id: item.id },
      data: { assigneeId: next?.id ?? null },
    });

    const audit: AuditEntry[] = [
      change(
        item.id,
        'assignee',
        item.assignee?.displayName ?? null,
        next?.displayName ?? null,
      ),
    ];

    /**
     * แจ้งผู้รับงานคนใหม่ — ยกเว้นตอนที่รับงานเอง
     *
     * คนที่กด "รับงานนี้" รู้อยู่แล้วว่าตัวเองรับ การส่งอีเมลบอกซ้ำ
     * เป็นสิ่งที่ทำให้คนเริ่มไม่อ่านการแจ้งเตือนจากระบบ
     */
    if (next !== null && next.id !== ctx.actorId) {
      await tx.notification.createMany({
        data: [
          {
            tenantId: ctx.tenantId,
            userId: next.id,
            workItemId: item.id,
            kind: 'workitem.assigned',
            title: `${item.itemKey} ถูกมอบหมายให้คุณ`,
            body: item.summary,
            dedupeKey: `assign:${item.id.toString()}:${next.id.toString()}:${String(now.getTime())}`,
          },
        ],
        skipDuplicates: true,
      });
    }

    return { result: undefined, audit };
  });

  return {
    itemKey: item.itemKey,
    assignee: next === null ? null : { id: next.id.toString(), displayName: next.displayName },
    previous:
      item.assignee === null
        ? null
        : { id: item.assignee.id.toString(), displayName: item.assignee.displayName },
  };
}

/**
 * คนที่มอบหมายงานในโปรเจกต์นี้ได้
 *
 * คืนเฉพาะคนที่เปิดดูโปรเจกต์ได้จริง เพื่อไม่ให้หน้าจอเสนอชื่อที่กดแล้วถูกปฏิเสธ
 */
export async function assignableUsers(
  ctx: TenantContext,
  projectId: bigint,
): Promise<Array<{ id: string; displayName: string; email: string }>> {
  const db = tenantScoped(ctx);
  const rows = await db.user.findMany({
    where: {
      isActive: true,
      isSystem: false,
      groupMemberships: {
        some: {
          group: {
            grants: {
              some: {
                permission: 'BROWSE_PROJECT',
                scheme: { projects: { some: { id: projectId } } },
              },
            },
          },
        },
      },
    },
    orderBy: { displayName: 'asc' },
    select: { id: true, displayName: true, email: true },
  });
  return rows.map((u) => ({ id: u.id.toString(), displayName: u.displayName, email: u.email }));
}
