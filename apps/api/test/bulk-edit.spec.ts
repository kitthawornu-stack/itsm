/**
 * แก้ไขหลายเรื่องพร้อมกัน — เทสต์เป็นข้อกำหนด เขียนก่อนโค้ด
 *
 * `BULK_EDIT` อยู่ในระบบมาตั้งแต่ Phase 0: มีใน enum · แสดงบนหน้าตั้งค่า ·
 * ข้อมูล seed ให้กับกลุ่ม IT Support ไว้แล้ว · **แต่ไม่มีโค้ดเส้นไหนถามถึงมันเลย**
 * ผู้ดูแลจึงอ่านหน้าจอได้ว่า "แก้ไขหลายเรื่องพร้อมกัน — IT Support"
 * ซึ่งเป็นความเชื่อที่หน้าจอสร้างขึ้นเองทั้งหมด (CLAUDE.md §8)
 *
 * ไฟล์นี้ทำให้คีย์นั้นมีผลจริง · สามข้อที่ต้องถูกตั้งแต่แรกเพราะแก้ทีหลังไม่ทัน:
 *
 *   1. **ล้มทีละใบ ไม่ล้มทั้งรอบ** — ใบที่ไม่มีสิทธิ์ไม่ควรทำให้อีก 49 ใบไม่ถูกแก้
 *   2. **ใบที่เปิดดูไม่ได้ ต้องตอบเหมือนใบที่ไม่มีอยู่จริง** — ตอบ "ไม่มีสิทธิ์"
 *      คือการยืนยันว่าเลขนี้มีอยู่ ซึ่งเป็นการวาดแผนที่ให้คนที่กำลังลอง
 *   3. **เกินเพดานต้องปฏิเสธทั้งชุด ไม่ใช่ตัดเงียบ ๆ** — ตัดเงียบแปลว่า
 *      ผู้ใช้เชื่อว่าแก้ครบแล้ว ทั้งที่ใบท้าย ๆ ไม่ได้ถูกแตะ
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  BULK_MAX,
  BulkTooManyItemsError,
  NothingSelectedError,
  bulkEditWorkItems,
} from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
/** ผู้ใช้ที่มี BULK_EDIT (อยู่กลุ่มที่ได้สิทธิ์ครบ) */
let staff: TenantContext;
/** ผู้ใช้ที่เปิดดูโปรเจกต์ได้ แต่ไม่มี BULK_EDIT */
let viewer: TenantContext;
let staffId: bigint;
let viewerId: bigint;
let staffGroupId: bigint;
let viewerGroupId: bigint;
let schemeId: bigint;
let projectId: bigint;
let assigneeId: bigint;

/** คีย์ของงานที่เทสต์นี้สร้างเอง — ไม่แตะงานของ seed */
const keys: string[] = [];
/*
  ชนิดต้องบอกความจริง: `beforeAll` ล้มกลางทางได้ และตอนนั้นค่านี้ยังไม่ถูกตั้ง
  ประกาศเป็น `string` เฉย ๆ ทำให้ lint บอกว่าการเช็กเป็นเรื่องเกินจำเป็น
  ทั้งที่การเช็กนั้นคือสิ่งเดียวที่กันไม่ให้การเก็บกวาดระเบิดทับ error จริง
*/
let hiddenKey: string | undefined;
let hiddenProjectId: bigint;
let hiddenPriorityId: number | null;

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  tenantId = tenant.id;

  const project = await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } });
  projectId = project.id;
  schemeId = project.permissionSchemeId ?? 0n;

  const hidden = await prismaClient.project.findFirstOrThrow({ where: { key: 'PLAT' } });
  hiddenProjectId = hidden.id;

  /*
    สร้างกลุ่มและผู้ใช้ของตัวเองทั้งหมด **ไม่แตะข้อมูล seed**
    เคยมีเทสต์สิทธิ์ที่ลบสมาชิกกลุ่มจริงออกแล้วใส่กลับตอนท้าย · พอ assertion
    กลางทางล้ม บรรทัดใส่กลับไม่ถูกรัน และ agent1/agent2 หลุดจากกลุ่มค้างไว้จริง
    ทุกอย่างตอบ 403 ทั้งที่โค้ดถูก และดูเหมือนระบบสิทธิ์พังทั้งระบบ
  */
  const mkGroup = async (name: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `${name} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  staffGroupId = await mkGroup('bulk-staff');
  viewerGroupId = await mkGroup('bulk-viewer');

  const mkUser = async (n: string, groupId: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `bulk-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  staffId = await mkUser('staff', staffGroupId);
  viewerId = await mkUser('viewer', viewerGroupId);
  assigneeId = await mkUser('assignee', staffGroupId);

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId, permission: 'BROWSE_PROJECT', groupId: staffGroupId },
      { tenantId, schemeId, permission: 'EDIT_ITEM', groupId: staffGroupId },
      { tenantId, schemeId, permission: 'ASSIGN_ITEM', groupId: staffGroupId },
      { tenantId, schemeId, permission: 'BULK_EDIT', groupId: staffGroupId },
      // ผู้ชมเห็นงานได้ แต่แก้ทีละหลายใบไม่ได้
      { tenantId, schemeId, permission: 'BROWSE_PROJECT', groupId: viewerGroupId },
      { tenantId, schemeId, permission: 'EDIT_ITEM', groupId: viewerGroupId },
    ],
  });

  staff = { tenantId, actorId: staffId };
  viewer = { tenantId, actorId: viewerId };

  // งานทดสอบของตัวเอง — คัดลอกชนิด/สถานะ/ผู้แจ้งจากงานที่มีอยู่แล้ว
  const template = await prismaClient.workItem.findFirstOrThrow({ where: { projectId } });
  for (let i = 0; i < 4; i += 1) {
    const w = await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey: `SD-BULK${STAMP}${String(i)}`,
        issueTypeId: template.issueTypeId,
        statusId: template.statusId,
        reporterId: staffId,
        summary: `งานทดสอบแก้หลายใบ ${STAMP} ลำดับ ${String(i)}`,
        rank: `zzz${STAMP}${String(i)}`,
      },
      select: { itemKey: true },
    });
    keys.push(w.itemKey);
  }

  const hiddenItem = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId: hiddenProjectId },
    select: { itemKey: true, priorityId: true },
  });
  hiddenKey = hiddenItem.itemKey;
  hiddenPriorityId = hiddenItem.priorityId;
}, 120_000);

/** เก็บกวาดต้องทนต่อการที่ `beforeAll` ล้มกลางทาง ไม่งั้น error จริงถูกกลบ */
const ids = (...v: Array<bigint | undefined>): bigint[] => v.filter((x) => x !== undefined);

afterAll(async () => {
  /*
    เก็บกวาด **ทุกแถวที่จับมา** รวมแถวที่คาดว่าจะไม่ถูกแตะ — เพราะตอนกลไก
    ถูกลบออกเพื่อพิสูจน์ว่าเทสต์แดงได้ ใบที่ควรถูกปฏิเสธจะถูกแก้จริง
    และงานของ PLAT ที่ควรมองไม่เห็น จะถูกแตะจริง
  */
  /*
    คืนงานของ PLAT ให้เหมือนเดิม **ก่อนอย่างอื่น**

    ตอนกลไกขอบเขตการมองเห็นถูกลบออก (ซึ่งต้องทำเพื่อพิสูจน์ว่าเทสต์แดงได้)
    ใบนั้นจะถูกแก้จริง · การลบประวัติอย่างเดียวไม่พอ เพราะค่าที่เปลี่ยนไป
    ค้างอยู่บนงานของ seed ที่หน้าจอจริงอ่านอยู่ทุกวัน
  */
  if (hiddenKey !== undefined) {
    await prismaClient.workItem.updateMany({
      where: { itemKey: hiddenKey },
      data: { priorityId: hiddenPriorityId },
    });
  }
  await prismaClient.workItemHistory.deleteMany({ where: { actorId: { in: ids(staffId, viewerId) } } });
  await prismaClient.auditLog.deleteMany({ where: { actorId: { in: ids(staffId, viewerId) } } });
  await prismaClient.notification.deleteMany({
    where: { userId: { in: ids(staffId, viewerId, assigneeId) } },
  });
  await prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } });
  await prismaClient.permissionGrant.deleteMany({
    where: { groupId: { in: ids(staffGroupId, viewerGroupId) } },
  });
  await prismaClient.groupMember.deleteMany({
    where: { groupId: { in: ids(staffGroupId, viewerGroupId) } },
  });
  await prismaClient.user.deleteMany({ where: { id: { in: ids(staffId, viewerId, assigneeId) } } });
  await prismaClient.userGroup.deleteMany({ where: { id: { in: ids(staffGroupId, viewerGroupId) } } });
  await prismaClient.$disconnect();
});

describe('A · สิทธิ์', () => {
  it('**ไม่มี BULK_EDIT = ทำไม่ได้ แม้จะแก้ทีละใบได้**', async () => {
    /*
      ผู้ชมมี EDIT_ITEM จึงแก้ทีละใบได้อยู่แล้ว · ถ้า bulk ตรวจแค่ EDIT_ITEM
      คีย์ BULK_EDIT จะยังไม่มีผลอยู่ดี และหน้าตั้งค่าจะยังโกหกต่อไป
    */
    await expect(
      bulkEditWorkItems(viewer, keys.slice(0, 2), { priorityRank: 2 }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('ปฏิเสธแล้วต้องไม่มีใบไหนถูกแก้เลย — ไม่ใช่แก้ไปครึ่งชุด', async () => {
    const rows = await prismaClient.workItem.findMany({
      where: { itemKey: { in: keys.slice(0, 2) } },
      select: { priorityId: true },
    });
    for (const r of rows) expect(r.priorityId).toBeNull();
  });

  it('มี BULK_EDIT = ทำได้', async () => {
    const res = await bulkEditWorkItems(staff, keys.slice(0, 2), { priorityRank: 2 });
    expect(res.changed).toBe(2);
    expect(res.items.every((i) => i.outcome === 'changed')).toBe(true);
  });
});

describe('B · ขอบเขตการมองเห็น', () => {
  it('**ใบที่เปิดดูไม่ได้ ตอบเหมือนใบที่ไม่มีอยู่จริง**', async () => {
    /*
      staff ไม่มี BROWSE_PROJECT ของ PLAT · ถ้าตอบ "ไม่มีสิทธิ์" กับใบที่มีอยู่จริง
      และ "ไม่พบ" กับใบที่ไม่มี ผู้ใช้จะไล่เดาเลขที่เรื่องเพื่อดูว่าใบไหนมีอยู่ได้
    */
    const res = await bulkEditWorkItems(
      staff,
      [hiddenKey as string, `SD-ไม่มีจริง-${STAMP}`],
      { priorityRank: 3 },
    );
    const outcomes = res.items.map((i) => i.outcome);
    expect(outcomes).toEqual(['not-found', 'not-found']);
  });

  it('ใบของโปรเจกต์ที่มองไม่เห็น ต้องไม่ถูกแก้จริง — ไม่ใช่แค่รายงานว่าไม่เจอ', async () => {
    const row = await prismaClient.workItem.findFirstOrThrow({ where: { itemKey: hiddenKey } });
    expect(row.priorityId).toBe(hiddenPriorityId);
    const hist = await prismaClient.workItemHistory.count({
      where: { workItemId: row.id, actorId: staffId },
    });
    expect(hist).toBe(0);
  });
});

describe('C · ล้มทีละใบ ไม่ล้มทั้งรอบ', () => {
  it('**ใบที่ทำไม่ได้ ไม่ทำให้ใบที่ทำได้ไม่ถูกแก้**', async () => {
    const mixed = [keys[2] as string, `SD-ไม่มีจริงอีก-${STAMP}`, keys[3] as string];
    const res = await bulkEditWorkItems(staff, mixed, { priorityRank: 1 });
    expect(res.changed).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.items.map((i) => i.outcome)).toEqual(['changed', 'not-found', 'changed']);

    const rows = await prismaClient.workItem.findMany({
      where: { itemKey: { in: [keys[2] as string, keys[3] as string] } },
      include: { priority: { select: { rank: true } } },
    });
    for (const r of rows) expect(r.priority?.rank).toBe(1);
  });
});

describe('D · ไม่เปลี่ยน = ไม่เขียนประวัติ', () => {
  it('**ตั้งค่าเดิมซ้ำต้องไม่เกิดบรรทัดในประวัติ** — ประวัติที่รกเท่ากับไม่มีประวัติ', async () => {
    const key = keys[2] as string;
    const item = await prismaClient.workItem.findFirstOrThrow({ where: { itemKey: key } });
    const before = await prismaClient.workItemHistory.count({ where: { workItemId: item.id } });

    const res = await bulkEditWorkItems(staff, [key], { priorityRank: 1 });
    expect(res.items[0]?.outcome).toBe('unchanged');
    expect(res.changed).toBe(0);

    const after = await prismaClient.workItemHistory.count({ where: { workItemId: item.id } });
    expect(after).toBe(before);
  });
});

describe('E · ประวัติและ audit', () => {
  it('**ทุกใบที่เปลี่ยนมีบรรทัดประวัติของตัวเอง** ไม่ใช่บรรทัดเดียวของทั้งชุด', async () => {
    const two = keys.slice(0, 2);
    await bulkEditWorkItems(staff, two, { assigneeId });
    const items = await prismaClient.workItem.findMany({
      where: { itemKey: { in: two } },
      select: { id: true, assigneeId: true },
    });
    expect(items.every((i) => i.assigneeId === assigneeId)).toBe(true);

    for (const i of items) {
      const hist = await prismaClient.workItemHistory.count({
        where: { workItemId: i.id, field: 'assignee', actorId: staffId },
      });
      expect(hist).toBe(1);
    }
  });

  it('ปลดผู้รับผิดชอบได้ด้วย null — ไม่ใช่ต้องหาคนมารับต่อเสมอ', async () => {
    const res = await bulkEditWorkItems(staff, keys.slice(0, 2), { assigneeId: null });
    expect(res.changed).toBe(2);
    const items = await prismaClient.workItem.findMany({
      where: { itemKey: { in: keys.slice(0, 2) } },
      select: { assigneeId: true },
    });
    expect(items.every((i) => i.assigneeId === null)).toBe(true);
  });
});

describe('F · เพดานและข้อมูลนำเข้า', () => {
  it('**เกินเพดานปฏิเสธทั้งชุด ไม่ตัดเงียบ ๆ**', async () => {
    /*
      คีย์ต้องเป็นคีย์ที่ **ไม่มีทางมีอยู่จริง**

      รอบแรกใช้ `SD-0` … `SD-50` ซึ่งเป็นคีย์ของข้อมูล seed จริง · ตอนลบกลไก
      เพดานออกเพื่อพิสูจน์ว่าเทสต์แดงได้ คำสั่งจึงทำงานจนจบและ **เปลี่ยน
      ระดับความสำคัญของงานจริง 43 ใบเป็น P2 High ค้างไว้ในฐานข้อมูลพัฒนา**
      โดยที่จำนวนแถวไม่เปลี่ยนเลย — การนับแถวก่อนหลังจึงจับไม่ได้

      บทเรียนเดิมซ้ำอีกรอบ: ข้อมูลนำเข้าของเทสต์ต้องปลอดภัย **ตอนกลไกหายไป**
      ไม่ใช่แค่ตอนกลไกทำงาน
    */
    const many = Array.from({ length: BULK_MAX + 1 }, (_, i) => `SD-CAP${STAMP}-${String(i)}`);
    await expect(bulkEditWorkItems(staff, many, { priorityRank: 2 })).rejects.toThrow(
      BulkTooManyItemsError,
    );
  });

  it('ไม่เลือกอะไรเลยถูกปฏิเสธ', async () => {
    await expect(bulkEditWorkItems(staff, [], { priorityRank: 2 })).rejects.toThrow(
      NothingSelectedError,
    );
  });

  it('คีย์ซ้ำถูกยุบเหลือใบเดียว — ไม่ใช่แก้ซ้ำสองรอบ', async () => {
    const key = keys[0] as string;
    const res = await bulkEditWorkItems(staff, [key, key, key], { priorityRank: 4 });
    expect(res.requested).toBe(1);
    expect(res.items).toHaveLength(1);
  });

  it('ไม่ส่งการเปลี่ยนแปลงอะไรเลยถูกปฏิเสธ — ไม่ใช่วนเขียนเปล่า ๆ ทั้งชุด', async () => {
    await expect(bulkEditWorkItems(staff, [keys[0] as string], {})).rejects.toThrow(
      NothingSelectedError,
    );
  });

  it('ระดับความสำคัญที่ไม่มีอยู่จริงถูกปฏิเสธทั้งชุด ก่อนแตะใบไหน', async () => {
    /*
      ค่าที่ผิดเป็นความผิดของคำขอ ไม่ใช่ของงานใบใดใบหนึ่ง · ปล่อยให้วนแล้วล้ม
      ทีละใบจะได้ผลลัพธ์ที่อ่านว่า "ทุกใบล้ม" ซึ่งชี้ไปที่งาน ไม่ใช่ที่ค่าที่กรอก
    */
    const key = keys[0] as string;
    const before = await prismaClient.workItem.findFirstOrThrow({ where: { itemKey: key } });
    await expect(bulkEditWorkItems(staff, [key], { priorityRank: 99 })).rejects.toThrow();
    const after = await prismaClient.workItem.findFirstOrThrow({ where: { itemKey: key } });
    expect(after.priorityId).toBe(before.priorityId);
  });
});
