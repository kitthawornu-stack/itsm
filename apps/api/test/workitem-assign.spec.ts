/**
 * มอบหมายงาน — เทสต์เป็นข้อกำหนด
 *
 * สร้างผู้ใช้และงานของตัวเองแล้วลบทิ้งใน `finally` · ไม่แตะข้อมูล seed
 *
 * เคสที่สำคัญที่สุดคือ **มอบหมายให้คนที่เปิดงานไม่ได้ ต้องถูกปฏิเสธ**
 * ไม่งั้นงานจะหายไปจากทุกคน: เจ้าตัวเห็นไม่ได้ และคนอื่นเห็นว่ามีเจ้าของแล้วจึงไม่หยิบ
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  AssigneeNotEligibleError,
  assignWorkItem,
  assignableUsers,
} from '../src/modules/workitem/assign.service';
import { createWorkItem } from '../src/modules/workitem/workitem.service';

const PREFIX = `assign-spec-${String(Date.now())}`;
let tenantId: bigint;
let projectId: bigint;
let staffCtx: TenantContext;
let itGroupId: bigint;
let allGroupId: bigint;
let itemKey: string;
let itemId: bigint;
/** อยู่กลุ่มพนักงานทั้งหมด — เปิดดู SD ได้ */
let insiderId: bigint;
/** ไม่อยู่กลุ่มไหนเลย — เปิดดู SD ไม่ได้ */
let outsiderId: bigint;
const madeUsers: bigint[] = [];

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirst({ where: { key: 'default' } });
  if (tenant === null) {
    throw new Error('ยังไม่มีข้อมูล seed — รัน `pnpm --filter @itsm/api seed` ก่อน');
  }
  tenantId = tenant.id;

  const it = await prismaClient.userGroup.findFirstOrThrow({
    where: { tenantId, name: 'IT Support' },
  });
  itGroupId = it.id;
  const all = await prismaClient.userGroup.findFirstOrThrow({
    where: { tenantId, name: 'พนักงานทั้งหมด' },
  });
  allGroupId = all.id;

  const mk = async (n: string, groups: bigint[]): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `${PREFIX}-${n}@example.test`, displayName: `ทดสอบ ${n}` },
      select: { id: true },
    });
    madeUsers.push(u.id);
    if (groups.length > 0) {
      await prismaClient.groupMember.createMany({
        data: groups.map((groupId) => ({ tenantId, groupId, userId: u.id })),
      });
    }
    return u.id;
  };

  const staffId = await mk('staff', [itGroupId, allGroupId]);
  staffCtx = { tenantId, actorId: staffId };
  insiderId = await mk('insider', [allGroupId]);
  outsiderId = await mk('outsider', []);

  const created = await createWorkItem(staffCtx, {
    projectKey: 'SD',
    issueTypeName: 'Incident',
    summary: 'งานสำหรับทดสอบการมอบหมาย',
  });
  itemKey = created.itemKey;
  itemId = created.id;
  const row = await prismaClient.workItem.findFirstOrThrow({ where: { id: itemId } });
  projectId = row.projectId;
});

afterAll(async () => {
  await prismaClient.notification.deleteMany({ where: { workItemId: itemId } });
  await prismaClient.slaEvent.deleteMany({ where: { sla: { workItemId: itemId } } });
  await prismaClient.workItemSla.deleteMany({ where: { workItemId: itemId } });
  await prismaClient.workItemHistory.deleteMany({ where: { workItemId: itemId } });
  await prismaClient.workItem.deleteMany({ where: { id: itemId } });
  await prismaClient.groupMember.deleteMany({ where: { userId: { in: madeUsers } } });
  await prismaClient.user.deleteMany({ where: { id: { in: madeUsers } } });
  await prismaClient.$disconnect();
});

describe('assignWorkItem', () => {
  it('มอบหมายให้คนที่เปิดงานได้ สำเร็จ', async () => {
    const r = await assignWorkItem(staffCtx, itemKey, insiderId);
    expect(r.assignee?.id).toBe(insiderId.toString());
  });

  it('เขียนประวัติว่าเปลี่ยนจากใครเป็นใคร ไม่ใช่แค่ว่าตอนนี้เป็นใคร', async () => {
    await assignWorkItem(staffCtx, itemKey, null);
    await assignWorkItem(staffCtx, itemKey, insiderId);
    const history = await prismaClient.workItemHistory.findMany({
      where: { workItemId: itemId, field: 'assignee' },
      orderBy: { id: 'desc' },
      take: 1,
    });
    expect(history[0]?.oldValue).toBeNull();
    expect(history[0]?.newValue).toContain('insider');
  });

  it('**มอบหมายให้คนที่เปิดโปรเจกต์ไม่ได้ ถูกปฏิเสธ**', async () => {
    // ไม่งั้นงานหายไปจากทุกคน — เจ้าตัวเห็นไม่ได้ คนอื่นคิดว่ามีเจ้าของแล้ว
    await expect(assignWorkItem(staffCtx, itemKey, outsiderId)).rejects.toThrow(
      AssigneeNotEligibleError,
    );
  });

  it('ผู้ใช้ที่ไม่มีอยู่ถูกปฏิเสธด้วยข้อความเดียวกัน — ไม่บอกว่ามีคนนี้ไหม', async () => {
    const a = await assignWorkItem(staffCtx, itemKey, outsiderId).catch((e: unknown) => e);
    const b = await assignWorkItem(staffCtx, itemKey, 999_999_999n).catch((e: unknown) => e);
    expect((a as Error).message).toBe((b as Error).message);
  });

  it('บัญชีที่ปิดแล้วรับงานไม่ได้', async () => {
    await prismaClient.user.update({ where: { id: insiderId }, data: { isActive: false } });
    await expect(assignWorkItem(staffCtx, itemKey, insiderId)).rejects.toThrow(
      AssigneeNotEligibleError,
    );
    await prismaClient.user.update({ where: { id: insiderId }, data: { isActive: true } });
  });

  it('ปลดผู้รับผิดชอบได้ด้วยการส่ง null — คืนงานเข้ากอง', async () => {
    await assignWorkItem(staffCtx, itemKey, insiderId);
    const r = await assignWorkItem(staffCtx, itemKey, null);
    expect(r.assignee).toBeNull();
    expect(r.previous?.id).toBe(insiderId.toString());
  });

  it('มอบหมายซ้ำคนเดิม **ไม่เขียนประวัติเพิ่ม** และไม่แจ้งเตือนซ้ำ', async () => {
    await assignWorkItem(staffCtx, itemKey, insiderId);
    const before = await prismaClient.workItemHistory.count({
      where: { workItemId: itemId, field: 'assignee' },
    });
    const notifBefore = await prismaClient.notification.count({ where: { workItemId: itemId } });

    await assignWorkItem(staffCtx, itemKey, insiderId);

    expect(
      await prismaClient.workItemHistory.count({
        where: { workItemId: itemId, field: 'assignee' },
      }),
    ).toBe(before);
    expect(await prismaClient.notification.count({ where: { workItemId: itemId } })).toBe(
      notifBefore,
    );
  });

  it('แจ้งเตือนผู้รับงานคนใหม่', async () => {
    await assignWorkItem(staffCtx, itemKey, null);
    await assignWorkItem(staffCtx, itemKey, insiderId);
    const n = await prismaClient.notification.findFirst({
      where: { workItemId: itemId, userId: insiderId, kind: 'workitem.assigned' },
    });
    expect(n).not.toBeNull();
    expect(n?.title).toContain(itemKey);
  });

  it('**รับงานเองไม่แจ้งเตือนตัวเอง** — คนกดรู้อยู่แล้วว่าตัวเองรับ', async () => {
    await assignWorkItem(staffCtx, itemKey, null);
    const before = await prismaClient.notification.count({
      where: { workItemId: itemId, userId: staffCtx.actorId },
    });
    await assignWorkItem(staffCtx, itemKey, staffCtx.actorId as bigint);
    expect(
      await prismaClient.notification.count({
        where: { workItemId: itemId, userId: staffCtx.actorId },
      }),
    ).toBe(before);
  });

  it('คนที่ไม่มีสิทธิ์ ASSIGN_ITEM มอบหมายไม่ได้', async () => {
    await expect(
      assignWorkItem({ tenantId, actorId: insiderId }, itemKey, insiderId),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

describe('assignableUsers', () => {
  it('คืนเฉพาะคนที่เปิดดูโปรเจกต์ได้', async () => {
    const rows = await assignableUsers(staffCtx, projectId);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(insiderId.toString());
    expect(ids).not.toContain(outsiderId.toString());
  });

  it('ไม่คืนบัญชีที่ปิดแล้ว และไม่คืนบัญชีระบบ', async () => {
    await prismaClient.user.update({ where: { id: insiderId }, data: { isActive: false } });
    const rows = await assignableUsers(staffCtx, projectId);
    expect(rows.map((r) => r.id)).not.toContain(insiderId.toString());
    expect(rows.some((r) => r.email.startsWith('automation@'))).toBe(false);
    await prismaClient.user.update({ where: { id: insiderId }, data: { isActive: true } });
  });
});
