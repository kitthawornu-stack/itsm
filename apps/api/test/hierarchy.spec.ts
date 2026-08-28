/**
 * ลำดับชั้นของงาน — เทสต์เป็นข้อกำหนด
 *
 * `parentId` อยู่ในสคีมามาตั้งแต่ Phase 0 และถูก index เข้า OpenSearch ด้วย
 * **แต่ไม่มี service ไหนอ่านหรือเขียนมันเลย** — รูปแบบเดิม
 *
 * สี่ข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **ความลึกมาจากชนิดงาน ไม่ใช่จากการนับ** — แม่ต้องสูงกว่าลูกหนึ่งชั้นพอดี
 *      แล้ว "ลึกสุด 3 ชั้น" เป็นผลที่ตามมาเอง · ตัวนับความลึกจะพังเงียบ
 *      เมื่อมีคนเพิ่มชนิดงานใหม่ที่มันไม่รู้จัก
 *   2. **ยังต้องกันวงกลม แม้กฎชั้นจะกันให้แล้วในทางทฤษฎี** — ผู้ดูแลแก้
 *      `hierarchy_level` ของชนิดงานได้หลังจากผูกกันไปแล้ว
 *   3. **แม่กับลูกต้องอยู่โปรเจกต์เดียวกัน** — ไม่งั้นความคืบหน้าที่แสดงจะนับ
 *      ใบที่ผู้อ่านมองไม่เห็นรวมอยู่ด้วย ซึ่งบอกจำนวนของสิ่งที่เขาไม่ควรรู้ว่ามี
 *   4. **นับ "เสร็จแล้ว" จากหมวดของสถานะ ไม่ใช่จากชื่อ** — ชื่อเปลี่ยนได้
 *      หมวดคือความหมาย
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  CrossProjectParentError,
  HierarchyCycleError,
  HierarchyTargetNotFoundError,
  SelfParentError,
  WrongHierarchyLevelError,
  childTypesFor,
  childrenOf,
  parentOf,
  setParent,
} from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let projectId: bigint;
let otherProjectId: bigint;
/** มี EDIT_ITEM */
let staff: TenantContext;
/** เห็นงานได้ แต่แก้ไม่ได้ */
let viewer: TenantContext;
let staffId: bigint | undefined;
let viewerId: bigint | undefined;
let staffGroupId: bigint | undefined;
let viewerGroupId: bigint | undefined;

/** id ของชนิดงานแต่ละชั้น */
let epicTypeId: bigint;
let taskTypeId: bigint;
let subTypeId: bigint;
let doneStatusId: bigint;
let openStatusId: bigint;

const keys: string[] = [];
/** Epic · Task · Sub-task · Task ใบที่สอง · งานในอีกโปรเจกต์ */
let epicKey = '';
let taskKey = '';
let subKey = '';
let task2Key = '';
let farKey = '';

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  /*
    **สองโปรเจกต์ ต้องใช้ชุดสิทธิ์คนละใบ**

    รอบแรกใช้ชุดเดียวกันทั้งคู่ · ผลคือทุกคนเห็นทั้งสองโปรเจกต์ และเทสต์
    "งานย่อยที่มองไม่เห็นต้องไม่โผล่" ไม่ได้ทดสอบอะไรเลย — ลบตัวกรองทิ้ง
    แล้วยังเขียวทั้ง 15 เคส
  */
  const mkScheme = async (n: string): Promise<bigint> =>
    (
      await prismaClient.permissionScheme.create({
        data: { tenantId, name: `ชุดสิทธิ์ลำดับชั้น ${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  const schemeA = await mkScheme('A');
  const schemeB = await mkScheme('B');
  const mkProject = async (suffix: string, schemeId: bigint): Promise<bigint> =>
    (
      await prismaClient.project.create({
        data: {
          tenantId,
          key: `HRC${STAMP}${suffix}`,
          name: `โปรเจกต์ทดสอบลำดับชั้น ${STAMP}${suffix}`,
          type: 'SERVICE_DESK',
          permissionSchemeId: schemeId,
        },
        select: { id: true },
      })
    ).id;
  projectId = await mkProject('A', schemeA);
  otherProjectId = await mkProject('B', schemeB);

  const mkGroup = async (n: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `hrc-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  staffGroupId = await mkGroup('staff');
  viewerGroupId = await mkGroup('viewer');

  const mkUser = async (n: string, groupId: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `hrc-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  staffId = await mkUser('staff', staffGroupId);
  viewerId = await mkUser('viewer', viewerGroupId);

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: schemeA, permission: 'BROWSE_PROJECT', groupId: staffGroupId },
      { tenantId, schemeId: schemeA, permission: 'EDIT_ITEM', groupId: staffGroupId },
      // เห็นงานได้ แต่ผูกเรื่องหลักไม่ได้
      { tenantId, schemeId: schemeA, permission: 'BROWSE_PROJECT', groupId: viewerGroupId },
      /*
        โปรเจกต์ B: `staff` เห็น แต่ `viewer` ไม่เห็น
        — จำเป็นสำหรับเทสต์ "งานย่อยที่มองไม่เห็นต้องไม่โผล่"
      */
      { tenantId, schemeId: schemeB, permission: 'BROWSE_PROJECT', groupId: staffGroupId },
      { tenantId, schemeId: schemeB, permission: 'EDIT_ITEM', groupId: staffGroupId },
    ] as never,
  });

  staff = { tenantId, actorId: staffId };
  viewer = { tenantId, actorId: viewerId };

  /*
    ใช้ชนิดงานที่มีอยู่จริงในระบบ ไม่สร้างชนิดใหม่

    ชั้นของชนิดงานเป็นข้อมูลที่ผู้ดูแลตั้ง — เทสต์ที่ประกอบชนิดขึ้นมาเอง
    จะพิสูจน์ได้แค่ว่า *ถ้า* ชั้นหน้าตาแบบนั้น ผลจะถูก ไม่ได้พิสูจน์ว่า
    ชนิดที่มีอยู่จริงในระบบต่อกันได้
  */
  const byLevel = async (level: number): Promise<bigint> =>
    (
      await prismaClient.issueType.findFirstOrThrow({
        where: { hierarchyLevel: level },
        select: { id: true },
      })
    ).id;
  epicTypeId = await byLevel(1);
  taskTypeId = await byLevel(0);
  subTypeId = await byLevel(-1);

  const statuses = await prismaClient.workflowStatus.findMany({
    where: { category: { in: ['DONE', 'TODO'] } },
    select: { id: true, category: true },
  });
  doneStatusId = statuses.find((s) => s.category === 'DONE')?.id ?? 0n;
  openStatusId = statuses.find((s) => s.category === 'TODO')?.id ?? 0n;

  const mk = async (
    suffix: string,
    typeId: bigint,
    project = projectId,
    statusId = openStatusId,
  ): Promise<string> => {
    const w = await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId: project,
        itemKey: `HRC${STAMP}-${suffix}`,
        issueTypeId: typeId,
        statusId,
        reporterId: staffId as bigint,
        summary: `งานทดสอบลำดับชั้น ${suffix} ${STAMP}`,
        rank: `zzs${STAMP}${suffix}`,
      },
      select: { itemKey: true },
    });
    keys.push(w.itemKey);
    return w.itemKey;
  };
  epicKey = await mk('EPIC', epicTypeId);
  taskKey = await mk('TASK', taskTypeId);
  subKey = await mk('SUB', subTypeId);
  task2Key = await mk('TASK2', taskTypeId);
  farKey = await mk('FAR', taskTypeId, otherProjectId);
}, 180_000);

afterAll(async () => {
  const owners = [staffId, viewerId].filter((v): v is bigint => v !== undefined);
  /*
    ถอดความสัมพันธ์ก่อนลบงาน — `parentId` เป็น SetNull ก็จริง แต่ลำดับที่เขียนเอง
    อ่านแล้วรู้ว่าอะไรขึ้นกับอะไร และไม่ต้องหวังว่าลำดับ cascade ของ MySQL
    จะเป็นอย่างที่คิด (บทเรียนของ seed.ts)
  */
  await step('ถอดเรื่องหลัก', () =>
    prismaClient.workItem.updateMany({ where: { itemKey: { in: keys } }, data: { parentId: null } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { actorId: { in: owners } } }),
  );
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actorId: { in: owners } } }));
  await step('งานทดสอบ', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
  await step('โปรเจกต์', () =>
    prismaClient.project.deleteMany({ where: { key: { startsWith: `HRC${STAMP}` } } }),
  );
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({ where: { scheme: { name: { contains: STAMP } } } }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { userId: { in: owners } } }),
  );
  await step('ผู้ใช้', () => prismaClient.user.deleteMany({ where: { id: { in: owners } } }));
  await step('กลุ่ม', () =>
    prismaClient.userGroup.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await prismaClient.$disconnect();
});

const idOf = async (key: string): Promise<bigint> =>
  (await prismaClient.workItem.findFirstOrThrow({ where: { itemKey: key }, select: { id: true } }))
    .id;

describe('A · สิทธิ์', () => {
  it('**เห็นงานได้ ไม่ได้แปลว่าผูกเรื่องหลักได้**', async () => {
    await expect(setParent(viewer, taskKey, epicKey)).rejects.toThrow(PermissionDeniedError);
    expect(await parentOf(staff, await idOf(taskKey))).toBeNull();
  });

  it('เรื่องที่เปิดดูไม่ได้ ตอบเหมือนไม่มีอยู่จริง', async () => {
    await expect(setParent(staff, `HRC-ไม่มีจริง-${STAMP}`, epicKey)).rejects.toThrow(
      HierarchyTargetNotFoundError,
    );
  });
});

describe('B · ชั้นต้องต่อกันพอดี', () => {
  it('**Epic เป็นเรื่องหลักของ Task ได้**', async () => {
    await setParent(staff, taskKey, epicKey);
    expect((await parentOf(staff, await idOf(taskKey)))?.itemKey).toBe(epicKey);
  });

  it('Task เป็นเรื่องหลักของ Sub-task ได้', async () => {
    await setParent(staff, subKey, taskKey);
    expect((await parentOf(staff, await idOf(subKey)))?.itemKey).toBe(taskKey);
  });

  it('**Epic เป็นเรื่องหลักของ Sub-task ไม่ได้ — ข้ามชั้น**', async () => {
    /*
      กฎคือ "สูงกว่าหนึ่งชั้นพอดี" ไม่ใช่ "สูงกว่า" · ถ้าปล่อยให้ข้ามชั้นได้
      โครงสามชั้นจะพังทันที และรายงานความคืบหน้าของ Epic จะนับงานย่อย
      ที่ไม่ได้อยู่ใต้ Task ใบไหนเลย
    */
    await expect(setParent(staff, subKey, epicKey)).rejects.toThrow(WrongHierarchyLevelError);
    // ยังเป็นลูกของ Task เหมือนเดิม
    expect((await parentOf(staff, await idOf(subKey)))?.itemKey).toBe(taskKey);
  });

  it('Task เป็นเรื่องหลักของ Task ไม่ได้ — ชั้นเดียวกัน', async () => {
    await expect(setParent(staff, task2Key, taskKey)).rejects.toThrow(WrongHierarchyLevelError);
  });

  it('**Sub-task เป็นเรื่องหลักของใครไม่ได้ — ไม่มีชั้นที่ต่ำกว่า**', async () => {
    /*
      "ลึกสุด 3 ชั้น" เป็นผลที่ตามมาจากกฎชั้น ไม่ต้องมีตัวนับความลึก
      ซึ่งเป็นโค้ดที่พังเงียบเมื่อมีคนเพิ่มชนิดงานใหม่
    */
    expect(await childTypesFor(staff, -1)).toEqual([]);
  });

  it('เมนูเสนอเฉพาะชนิดที่ผูกได้จริง', async () => {
    const underEpic = await childTypesFor(staff, 1);
    expect(underEpic.length).toBeGreaterThan(0);
    expect(underEpic.some((t) => t.name === 'Sub-task')).toBe(false);
  });
});

describe('C · วงกลมและตัวเอง', () => {
  it('เป็นเรื่องหลักของตัวเองไม่ได้', async () => {
    await expect(setParent(staff, taskKey, taskKey)).rejects.toThrow(SelfParentError);
  });

  it('**วงกลมต้องถูกกัน แม้กฎชั้นจะกันให้แล้วในทางทฤษฎี**', async () => {
    /*
      เคสที่สำคัญที่สุดของไฟล์นี้ · ตามทฤษฎีวงกลมเกิดไม่ได้ถ้าชั้นถูกเสมอ
      **แต่ผู้ดูแลแก้ `hierarchy_level` ของชนิดงานได้หลังจากผูกกันไปแล้ว**

      จำลองสิ่งนั้น: ตอนนี้ EPIC(1) → TASK(0) → SUB(-1) · เปลี่ยนชนิดของ SUB
      ให้เป็นชั้น 1 ชั่วคราว แล้ว SUB จะเป็นแม่ของ TASK ได้ตามกฎชั้น
      ซึ่งจะกลายเป็นวงกลม TASK → SUB → TASK

      คืนชนิดใน `finally` และนับหลังคืน ไม่ใช่เชื่อว่าบรรทัดถูกรัน
    */
    const subId = await idOf(subKey);
    await prismaClient.workItem.update({ where: { id: subId }, data: { issueTypeId: epicTypeId } });
    try {
      await expect(setParent(staff, taskKey, subKey)).rejects.toThrow(HierarchyCycleError);
      // TASK ยังเป็นลูกของ EPIC เหมือนเดิม
      expect((await parentOf(staff, await idOf(taskKey)))?.itemKey).toBe(epicKey);
    } finally {
      await prismaClient.workItem.update({ where: { id: subId }, data: { issueTypeId: subTypeId } });
    }
    const back = await prismaClient.workItem.findUniqueOrThrow({
      where: { id: subId },
      select: { issueTypeId: true },
    });
    expect(back.issueTypeId).toBe(subTypeId);
  });
});

describe('D · ขอบเขตโปรเจกต์', () => {
  it('**แม่กับลูกต้องอยู่โปรเจกต์เดียวกัน**', async () => {
    /*
      ถ้าข้ามโปรเจกต์ได้ ความคืบหน้าที่แสดง ("เสร็จ 3 จาก 5") จะนับใบที่
      ผู้อ่านมองไม่เห็นรวมอยู่ด้วย — เป็นการบอกจำนวนของสิ่งที่เขาไม่ควรรู้ว่ามี
    */
    await expect(setParent(staff, farKey, epicKey)).rejects.toThrow(CrossProjectParentError);
    expect(await parentOf(staff, await idOf(farKey))).toBeNull();
  });
});

describe('E · งานย่อยและความคืบหน้า', () => {
  it('รายการงานย่อยและจำนวนที่เสร็จ', async () => {
    await setParent(staff, task2Key, epicKey);
    const epicId = await idOf(epicKey);
    const before = await childrenOf(staff, epicId);
    expect(before.rows.map((r) => r.itemKey).sort()).toEqual([taskKey, task2Key].sort());
    expect(before.done).toBe(0);
  });

  it('**นับ "เสร็จแล้ว" จากหมวดของสถานะ ไม่ใช่จากชื่อ**', async () => {
    /*
      ชื่อสถานะเปลี่ยนได้จากหน้าตั้งค่า · หมวดคือความหมาย ·
      ถ้านับจากชื่อ วันที่มีคนเปลี่ยน "Closed" เป็น "ปิดงานแล้ว"
      ความคืบหน้าทุกใบจะกลับไปเป็นศูนย์โดยไม่มีใครแตะมัน
    */
    await prismaClient.workItem.update({
      where: { id: await idOf(task2Key) },
      data: { statusId: doneStatusId },
    });
    const after = await childrenOf(staff, await idOf(epicKey));
    expect(after.done).toBe(1);
    expect(after.rows).toHaveLength(2);
  });

  it('ถอดเรื่องหลักออกได้ และถอดซ้ำไม่ใช่ความผิดพลาด', async () => {
    await setParent(staff, task2Key, null);
    expect(await parentOf(staff, await idOf(task2Key))).toBeNull();
    await setParent(staff, task2Key, null);
    expect((await childrenOf(staff, await idOf(epicKey))).rows).toHaveLength(1);
  });

  it('ผูกซ้ำกับแม่คนเดิม ไม่เขียนประวัติเพิ่ม', async () => {
    /*
      **นับจาก `work_item_history` ไม่ใช่ `audit_log`**

      รอบแรกเขียนว่านับ `auditLog` ที่ `action: 'workitem.parent'` แล้วเทสต์
      ผ่านทั้งที่กลไกถูกลบ — เพราะ `change()` คืน kind `work-item` ซึ่งลงที่
      `work_item_history` · แถวใน `audit_log` ชื่อนั้นไม่เคยมีอยู่เลย
      ทั้งก่อนและหลัง จึงเท่ากันเสมอ · เทสต์ที่ผ่านด้วยเหตุผลผิด
    */
    const taskId = await idOf(taskKey);
    const count = async (): Promise<number> =>
      prismaClient.workItemHistory.count({ where: { workItemId: taskId, field: 'parent' } });
    const before = await count();
    expect(before).toBeGreaterThan(0);
    await setParent(staff, taskKey, epicKey);
    // ประวัติที่รกเท่ากับไม่มีประวัติ — คนที่ไล่อ่านจะเลิกอ่าน
    expect(await count()).toBe(before);
  });

  it('**งานย่อยที่อยู่โปรเจกต์ที่มองไม่เห็น ต้องไม่โผล่ตอนอ่าน**', async () => {
    /*
      `setParent` กันการผูกข้ามโปรเจกต์อยู่แล้ว · แต่ข้อมูลเก่าที่ผูกไว้ก่อนมี
      กฎนี้ (หรือแก้ผ่าน SQL) ยังข้ามโปรเจกต์อยู่ได้ — และสิทธิ์เปลี่ยนได้
      หลังผูกด้วย · ตัวกรองตอนอ่านจึงไม่ใช่ของซ้ำซ้อน

      ต้องผูกผ่าน Prisma ตรง ๆ เพราะทางปกติปฏิเสธ · เคสนี้คือเหตุผลที่
      บรรทัดกรองตอนอ่านมีอยู่ ซึ่งรอบแรกไม่มีเทสต์ไหนคุ้มเลย
    */
    const epicId = await idOf(epicKey);
    const farId = await idOf(farKey);
    await prismaClient.workItem.update({ where: { id: farId }, data: { parentId: epicId } });
    try {
      // `staff` เห็นโปรเจกต์ B จึงเห็นงานย่อยใบนั้น
      expect((await childrenOf(staff, epicId)).rows.some((r) => r.itemKey === farKey)).toBe(true);
      // `viewer` ไม่เห็นโปรเจกต์ B — ทั้งรายการและจำนวนต้องไม่นับใบนั้น
      const asViewer = await childrenOf(viewer, epicId);
      expect(asViewer.rows.some((r) => r.itemKey === farKey)).toBe(false);
      expect(asViewer.rows.length).toBeLessThan((await childrenOf(staff, epicId)).rows.length);
    } finally {
      await prismaClient.workItem.update({ where: { id: farId }, data: { parentId: null } });
    }
    const back = await prismaClient.workItem.findUniqueOrThrow({
      where: { id: farId },
      select: { parentId: true },
    });
    expect(back.parentId).toBeNull();
  });
});
