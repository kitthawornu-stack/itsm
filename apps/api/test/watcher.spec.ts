/**
 * ผู้เฝ้าดูเรื่อง — เทสต์เป็นข้อกำหนด
 *
 * ตาราง `work_item_watcher` มีมาตั้งแต่ Phase 0 และไม่มีโค้ดเส้นไหนแตะมันเลย
 *
 * **ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้น แย่กว่าปุ่มที่ยังไม่มี** — คนที่กดเฝ้าดูจะเชื่อ
 * ว่าตัวเองจะได้รับข่าว แล้วเลิกไปถามในแชท · ไฟล์นี้จึงไม่ได้ทดสอบแค่ว่าแถวถูกสร้าง
 * แต่ทดสอบว่า **การแจ้งเตือนไปถึงจริง** และ **ไปไม่ถึงคนที่ไม่ควรได้รับ**
 *
 * สี่ข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **สิทธิ์ตรวจตอนส่ง ไม่ใช่ตอนกด** — สิทธิ์เปลี่ยนได้ระหว่างนั้น และ
 *      การแจ้งเตือนพกหัวข้อเรื่องไปด้วย จึงรั่วโดยไม่ต้องกดอะไรเลย
 *   2. **บันทึกภายในต้องมี `VIEW_INTERNAL_COMMENT`** — ผู้แจ้งที่กดเฝ้าดูเรื่อง
 *      ของตัวเอง ต้องไม่ได้รับเนื้อความที่ทีมคุยกันเอง
 *   3. **ไม่ส่งซ้ำให้คนเดียวกัน** — ผู้รับผิดชอบที่กดเฝ้าดูด้วย ได้ใบเดียว
 *   4. **กดซ้ำไม่ใช่ความผิดพลาด และไม่เขียนประวัติเพิ่ม**
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  WatchTargetNotFoundError,
  addComment,
  eligibleWatcherIds,
  isWatching,
  unwatch,
  watch,
  watchersOf,
} from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let projectId: bigint;
let itemId: bigint;
let itemKey: string;

/** ทีมงาน — เห็นบันทึกภายในได้ */
let staff: TenantContext;
/** ผู้แจ้ง — เปิดดูโปรเจกต์ได้ แต่ไม่เห็นบันทึกภายใน */
let customer: TenantContext;
let staffId: bigint | undefined;
let customerId: bigint | undefined;
let staffGroupId: bigint | undefined;
let customerGroupId: bigint | undefined;

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

/** แจ้งเตือนที่ผู้ใช้คนหนึ่งได้รับจากเรื่องนี้ */
async function inboxOf(userId: bigint | undefined): Promise<string[]> {
  if (userId === undefined) return [];
  const rows = await prismaClient.notification.findMany({
    where: { userId, workItemId: itemId },
    select: { kind: true },
  });
  return rows.map((r) => r.kind);
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  /*
    โปรเจกต์และชุดสิทธิ์ของตัวเอง — ต้องคุมได้ว่าใครเห็นอะไร เพราะข้อที่ทดสอบ
    คือการ **ถอนสิทธิ์แล้วผู้เฝ้าดูต้องไม่ได้รับ** ซึ่งแตะชุดสิทธิ์ของ seed ไม่ได้
  */
  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์เฝ้าดู ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `WAT${STAMP}`,
      name: `โปรเจกต์ทดสอบเฝ้าดู ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = project.id;

  const mkGroup = async (n: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `wat-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  staffGroupId = await mkGroup('staff');
  customerGroupId = await mkGroup('customer');

  const mkUser = async (n: string, groupId: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `wat-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  staffId = await mkUser('staff', staffGroupId);
  customerId = await mkUser('customer', customerGroupId);

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: staffGroupId },
      { tenantId, schemeId: scheme.id, permission: 'ADD_COMMENT', groupId: staffGroupId },
      { tenantId, schemeId: scheme.id, permission: 'VIEW_INTERNAL_COMMENT', groupId: staffGroupId },
      // ผู้แจ้ง: เห็นเรื่องและคอมเมนต์ได้ แต่ไม่เห็นบันทึกภายใน
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: customerGroupId },
      { tenantId, schemeId: scheme.id, permission: 'ADD_COMMENT', groupId: customerGroupId },
    ],
  });

  staff = { tenantId, actorId: staffId };
  customer = { tenantId, actorId: customerId };

  const template = await prismaClient.workItem.findFirstOrThrow({
    select: { issueTypeId: true, statusId: true },
  });
  const owner = customerId;
  const item = await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey: `WAT${STAMP}-1`,
      issueTypeId: template.issueTypeId,
      statusId: template.statusId,
      // ผู้แจ้งเป็นลูกค้า ผู้รับผิดชอบเป็นทีมงาน — โครงจริงของศูนย์บริการ
      reporterId: owner,
      assigneeId: staffId,
      summary: `งานทดสอบผู้เฝ้าดู ${STAMP}`,
      rank: `zzv${STAMP}`,
    },
    select: { id: true, itemKey: true },
  });
  itemId = item.id;
  itemKey = item.itemKey;
}, 180_000);

afterAll(async () => {
  const owners = [staffId, customerId].filter((v): v is bigint => v !== undefined);
  await step('แจ้งเตือน', () =>
    prismaClient.notification.deleteMany({ where: { userId: { in: owners } } }),
  );
  await step('ผู้เฝ้าดู', () =>
    prismaClient.workItemWatcher.deleteMany({ where: { userId: { in: owners } } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { actorId: { in: owners } } }),
  );
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actorId: { in: owners } } }));
  await step('ความเห็น', () =>
    prismaClient.workItemComment.deleteMany({ where: { workItemId: itemId } }),
  );
  await step('งานทดสอบ', () => prismaClient.workItem.deleteMany({ where: { itemKey } }));
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: `WAT${STAMP}` } }));
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({
      where: { groupId: { in: [staffGroupId, customerGroupId].filter((v) => v !== undefined) } },
    }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { userId: { in: owners } } }),
  );
  /*
    **ถามฐานข้อมูลว่าเทสต์นี้สร้างอะไรไว้ ไม่ใช่ถามตัวแปรที่จำไว้ตอนเขียน**

    เดิมบรรทัดนี้ลบเฉพาะ `owners` ซึ่งเก็บมาจาก `beforeAll` สองคน · แต่เคส
    "ผู้เฝ้าดูที่ไม่เกี่ยวข้องอะไรเลย" สร้างผู้ใช้คนที่สามขึ้นมาในตัวเทสต์เอง
    และไม่มีใครใส่มันเข้า `owners` — ผู้ใช้คนนั้นจึงค้างในฐานข้อมูลพัฒนา
    ทุกครั้งที่รัน · วัดจริง: เจอ `wat-obs-454418` กับ `wat-obs-579959`
    ค้างอยู่จากการรันสองครั้งเมื่อ 2026-08-28 ห่างกันสองนาที

    ทุกอีเมลที่ไฟล์นี้สร้างลงท้ายด้วย `${STAMP}@example.test` เหมือนกันหมด
    จึงลบด้วยรูปนั้น — ไม่มีทางชนกับผู้ใช้จริง และครอบคนที่ยังไม่ได้เขียน
    ในวันที่มีคนเพิ่มเคสใหม่ที่สร้างผู้ใช้เพิ่ม (CLAUDE.md)
  */
  const mine = { email: { endsWith: `${STAMP}@example.test` } };
  await step('สมาชิกกลุ่มของผู้ใช้ทุกคนที่เทสต์สร้าง', () =>
    prismaClient.groupMember.deleteMany({ where: { user: mine } }),
  );
  await step('ผู้เฝ้าดูของผู้ใช้ทุกคนที่เทสต์สร้าง', () =>
    prismaClient.workItemWatcher.deleteMany({ where: { user: mine } }),
  );
  await step('แจ้งเตือนของผู้ใช้ทุกคนที่เทสต์สร้าง', () =>
    prismaClient.notification.deleteMany({ where: { user: mine } }),
  );
  await step('ผู้ใช้', () => prismaClient.user.deleteMany({ where: mine }));
  await step('กลุ่ม', () =>
    prismaClient.userGroup.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  /*
    **นับหลังคืน ไม่ใช่เชื่อว่าลูปทำงาน** — `step()` กลืน error ไว้เพื่อไม่ให้
    ขั้นที่ล้มขวางขั้นถัดไป ผลข้างเคียงคือการเก็บกวาดที่ล้มทั้งหมดก็ยัง
    "เสร็จ" เงียบ ๆ · ด่านนี้คือสิ่งเดียวที่ทำให้มันดังขึ้นมา
  */
  const left = await prismaClient.user.count({
    where: { email: { endsWith: `${STAMP}@example.test` } },
  });
  await prismaClient.$disconnect();
  expect(left, `เก็บกวาดไม่ครบ — เหลือผู้ใช้ของเทสต์ ${String(left)} คนในฐานข้อมูล`).toBe(0);
});

describe('A · กดเฝ้าดู', () => {
  it('เฝ้าดูได้ และหน้าจอรู้ว่าเฝ้าดูอยู่', async () => {
    expect(await isWatching(staff, itemId)).toBe(false);
    await watch(staff, itemKey);
    expect(await isWatching(staff, itemId)).toBe(true);
    expect((await watchersOf(staff, itemId)).map((w) => w.userId)).toContain(
      String(staffId ?? ''),
    );
  });

  it('**กดซ้ำไม่ใช่ความผิดพลาด และไม่เขียนประวัติเพิ่ม**', async () => {
    // ประวัติที่รกเท่ากับไม่มีประวัติ — คนที่ไล่อ่านจะเลิกอ่าน
    const before = await prismaClient.auditLog.count({ where: { action: 'workitem.watch' } });
    await watch(staff, itemKey);
    const after = await prismaClient.auditLog.count({ where: { action: 'workitem.watch' } });
    expect(after).toBe(before);
    expect(await isWatching(staff, itemKey === '' ? 0n : itemId)).toBe(true);
  });

  it('เลิกเฝ้าดูได้ และกดซ้ำก็ไม่ผิดพลาด', async () => {
    await unwatch(staff, itemKey);
    expect(await isWatching(staff, itemId)).toBe(false);
    await unwatch(staff, itemKey);
    expect(await isWatching(staff, itemId)).toBe(false);
    await watch(staff, itemKey);
  });

  it('เฝ้าดูเรื่องที่เปิดดูไม่ได้ ตอบเหมือนเรื่องที่ไม่มีอยู่จริง', async () => {
    await expect(watch(staff, `WAT-ไม่มีจริง-${STAMP}`)).rejects.toThrow(WatchTargetNotFoundError);
  });
});

describe('B · การแจ้งเตือนไปถึงผู้เฝ้าดูจริง', () => {
  it('**ผู้เฝ้าดูที่ไม่เกี่ยวข้องอะไรเลย ได้รับความเห็นใหม่**', async () => {
    /*
      นี่คือเหตุผลทั้งหมดของฟีเจอร์นี้ · หัวหน้าทีมที่ไม่ใช่ทั้งผู้แจ้งและ
      ผู้รับผิดชอบ ต้องตามเรื่องได้โดยไม่ต้องไปถามในแชท
    */
    const watcher = await prismaClient.user.create({
      data: { tenantId, email: `wat-obs-${STAMP}@example.test`, displayName: `ผู้สังเกต ${STAMP}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({
      data: { tenantId, groupId: staffGroupId as bigint, userId: watcher.id },
    });
    await prismaClient.workItemWatcher.create({
      data: { tenantId, workItemId: itemId, userId: watcher.id },
    });

    await addComment(customer, { itemKey, body: 'ขอสอบถามความคืบหน้าครับ', isInternal: false });

    const got = await prismaClient.notification.count({
      where: { userId: watcher.id, workItemId: itemId },
    });
    expect(got).toBe(1);

    await prismaClient.notification.deleteMany({ where: { userId: watcher.id } });
    await prismaClient.workItemWatcher.deleteMany({ where: { userId: watcher.id } });
    await prismaClient.groupMember.deleteMany({ where: { userId: watcher.id } });
    await prismaClient.user.delete({ where: { id: watcher.id } });
  });

  it('**ผู้รับผิดชอบที่กดเฝ้าดูด้วย ได้ใบเดียว ไม่ใช่สองใบ**', async () => {
    await prismaClient.notification.deleteMany({ where: { workItemId: itemId } });
    // staff เป็นทั้งผู้รับผิดชอบและผู้เฝ้าดู
    expect(await isWatching(staff, itemId)).toBe(true);
    await addComment(customer, { itemKey, body: `ถามอีกครั้ง ${STAMP}`, isInternal: false });
    expect(await inboxOf(staffId)).toHaveLength(1);
  });

  it('**ไม่แจ้งคนที่เขียนเอง แม้จะกดเฝ้าดูไว้**', async () => {
    await watch(customer, itemKey);
    await prismaClient.notification.deleteMany({ where: { workItemId: itemId } });
    await addComment(customer, { itemKey, body: `ผู้แจ้งพิมพ์เอง ${STAMP}`, isInternal: false });
    expect(await inboxOf(customerId)).toHaveLength(0);
  });
});

describe('C · สิทธิ์ตรวจตอนส่ง ไม่ใช่ตอนกด', () => {
  it('**บันทึกภายในไม่ถึงผู้เฝ้าดูที่ไม่มีสิทธิ์เห็น**', async () => {
    /*
      ผู้แจ้งกดเฝ้าดูเรื่องของตัวเองไว้ (ซึ่งเป็นเรื่องปกติ) · ถ้าการกระจาย
      ให้ผู้เฝ้าดูไม่ตรวจ `VIEW_INTERNAL_COMMENT` เนื้อความที่ทีมคุยกันเอง
      จะไปโผล่ในกล่องแจ้งเตือนของลูกค้า — รั่วโดยที่ไม่มีใครกดอะไรผิดเลย
    */
    expect(await isWatching(customer, itemId)).toBe(true);
    await prismaClient.notification.deleteMany({ where: { workItemId: itemId } });
    await addComment(staff, { itemKey, body: `ลูกค้ารายนี้ค้างชำระอยู่ ${STAMP}`, isInternal: true });
    expect(await inboxOf(customerId)).toHaveLength(0);
  });

  it('**ถอนสิทธิ์เปิดดูโปรเจกต์แล้ว ผู้เฝ้าดูต้องไม่ได้รับอีก**', async () => {
    /*
      สิทธิ์เปลี่ยนได้หลังกดเฝ้าดู · คนที่ย้ายทีมแล้วยังมีแถวค้างอยู่
      ต้องไม่ได้รับหัวข้อเรื่องของโปรเจกต์ที่ตัวเองเข้าไม่ได้แล้ว

      ย้าย grant ของกลุ่มลูกค้าออกชั่วคราวแล้วคืนใน `finally` · คืน**ทุกแถว
      ที่จับมา** ไม่ใช่เฉพาะแถวที่คิดว่าจะถูกแตะ — เพราะตอนกลไกหายไป
      แถวที่ "ไม่ควรถูกใช้" จะถูกใช้จริง (CLAUDE.md §9)
    */
    const removed = await prismaClient.permissionGrant.findMany({
      where: { groupId: customerGroupId, permission: 'BROWSE_PROJECT' },
      select: { id: true, tenantId: true, schemeId: true, permission: true, groupId: true },
    });
    expect(removed.length).toBeGreaterThan(0);
    try {
      await prismaClient.permissionGrant.deleteMany({
        where: { id: { in: removed.map((r) => r.id) } },
      });
      const eligible = await eligibleWatcherIds(staff, itemId, projectId);
      expect(eligible).not.toContain(customerId);
      // และ staff ซึ่งยังมีสิทธิ์อยู่ ต้องยังอยู่ในรายชื่อ
      expect(eligible).toContain(staffId);
    } finally {
      await prismaClient.permissionGrant.createMany({
        data: removed.map((r) => ({
          tenantId: r.tenantId,
          schemeId: r.schemeId,
          permission: r.permission,
          groupId: r.groupId,
        })),
      });
    }
    const back = await prismaClient.permissionGrant.count({
      where: { groupId: customerGroupId, permission: 'BROWSE_PROJECT' },
    });
    // นับหลังคืน ไม่ใช่เชื่อว่าลูปทำงาน
    expect(back).toBe(removed.length);
  });

  it('บัญชีที่ปิดแล้วไม่ได้รับ และไม่โผล่ในรายชื่อผู้เฝ้าดู', async () => {
    /*
      คนที่ลาออกไม่ควรมีแถวแจ้งเตือนค้างเพิ่มทุกวัน · และการแสดงชื่อเขาไว้
      บนหน้าจอทำให้คนอื่นเข้าใจผิดว่ายังมีคนตามเรื่องนี้อยู่
    */
    const gone = await prismaClient.user.create({
      data: {
        tenantId,
        email: `wat-gone-${STAMP}@example.test`,
        displayName: `ลาออกแล้ว ${STAMP}`,
        isActive: false,
      },
      select: { id: true },
    });
    await prismaClient.groupMember.create({
      data: { tenantId, groupId: staffGroupId as bigint, userId: gone.id },
    });
    await prismaClient.workItemWatcher.create({
      data: { tenantId, workItemId: itemId, userId: gone.id },
    });
    try {
      expect(await eligibleWatcherIds(staff, itemId, projectId)).not.toContain(gone.id);
      expect((await watchersOf(staff, itemId)).map((w) => w.userId)).not.toContain(
        gone.id.toString(),
      );
    } finally {
      await prismaClient.workItemWatcher.deleteMany({ where: { userId: gone.id } });
      await prismaClient.groupMember.deleteMany({ where: { userId: gone.id } });
      await prismaClient.user.delete({ where: { id: gone.id } });
    }
  });
});
