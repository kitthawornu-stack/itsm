/**
 * กระดานงานและการจัดลำดับ — เทสต์เป็นข้อกำหนด
 *
 * `packages/lexorank` ถูกเรียกใช้อยู่แล้ว (`seed.ts` ใช้ `distribute` ·
 * `workitem.service.ts` ใช้ `between(last, null)` ตอนสร้างงาน) · **แต่
 * `between` ถูกเรียกที่เดียวเพื่อต่อท้ายเท่านั้น ไม่มีโค้ดไหนย้ายลำดับเลย**
 * ซึ่งเป็นเหตุผลทั้งหมดที่คอลัมน์ `rank` มีอยู่
 *
 * ห้าข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **ย้ายข้ามคอลัมน์ต้องเดินผ่าน workflow** — การเขียน `statusId` ทับ
 *      ตอนลาก คือการเดินอ้อมทุกอย่างที่ workflow มีไว้ปฏิเสธ
 *   2. **คอลัมน์ที่ไปไม่ได้ ต้องบอกว่าไปไหนได้บ้าง** ไม่ใช่เด้งกลับเฉย ๆ
 *   3. **ลำดับที่ได้ต้องเรียงตรงกับฝั่งฐานข้อมูล** — `rank` ใช้ collation
 *      `utf8mb4_bin` ซึ่งเทียบแบบไบนารี เหมือน `compareRank`
 *   4. **ลากแล้วปล่อยที่เดิม ต้องไม่เขียนอะไร** — ประวัติที่รกเท่ากับไม่มีประวัติ
 *   5. **คอลัมน์มาจาก workflow ของโปรเจกต์** ไม่ใช่สถานะทั้งระบบ
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';
import { compareRank } from '@itsm/lexorank';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  BoardItemNotFoundError,
  NoTransitionForColumnError,
  boardOf,
  moveCard,
  rebalanceColumn,
} from '../src/modules/board';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let projectId: bigint;
let projectKey = '';
/** ย้ายและเปลี่ยนสถานะได้ */
let staff: TenantContext;
/** เห็นกระดาน แต่ย้ายไม่ได้ */
let viewer: TenantContext;
let staffId: bigint | undefined;
let viewerId: bigint | undefined;
let staffGroupId: bigint | undefined;
let viewerGroupId: bigint | undefined;
let workflowId: bigint | undefined;

const keys: string[] = [];
const OPEN = `เปิดอยู่ ${STAMP}`;
const DONE = `ปิดแล้ว ${STAMP}`;
/**
 * คอลัมน์ที่สาม — มีไว้ให้ **มีทางเลือกมากกว่าหนึ่ง**
 *
 * workflow ที่มี transition เดียวพิสูจน์ไม่ได้ว่าโค้ดเลือกถูกใบ · ลบตัวเลือก
 * ทิ้งแล้วหยิบใบแรกมาใช้ ก็ยังเขียวทั้ง 12 เคส (พิสูจน์แล้วในรอบลบทีละบรรทัด)
 */
const PAUSED = `พักไว้ ${STAMP}`;

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์กระดาน ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `BRD${STAMP}`,
      name: `โปรเจกต์ทดสอบกระดาน ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true, key: true },
  });
  projectId = project.id;
  projectKey = project.key;

  const mkGroup = async (n: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `brd-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  staffGroupId = await mkGroup('staff');
  viewerGroupId = await mkGroup('viewer');

  const mkUser = async (n: string, groupId: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `brd-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  staffId = await mkUser('staff', staffGroupId);
  viewerId = await mkUser('viewer', viewerGroupId);

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: staffGroupId },
      { tenantId, schemeId: scheme.id, permission: 'EDIT_ITEM', groupId: staffGroupId },
      { tenantId, schemeId: scheme.id, permission: 'TRANSITION_ITEM', groupId: staffGroupId },
      // เห็นกระดาน แต่ย้ายไม่ได้
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: viewerGroupId },
    ] as never,
  });
  staff = { tenantId, actorId: staffId };
  viewer = { tenantId, actorId: viewerId };

  /*
    workflow ของตัวเอง — ไม่แตะของ seed เพราะการย้ายการ์ดจะเปลี่ยนสถานะ
    ของงานจริง และเทสต์ที่ล้มกลางทางจะทิ้งไว้อย่างนั้น
  */
  const wf = await prismaClient.workflow.create({
    data: { tenantId, name: `workflow กระดาน ${STAMP}` },
    select: { id: true },
  });
  workflowId = wf.id;
  const mkStatus = async (
    name: string,
    category: string,
    position: number,
    isInitial: boolean,
  ): Promise<bigint> =>
    (
      await prismaClient.workflowStatus.create({
        data: {
          tenantId,
          workflowId: wf.id,
          name,
          category: category as never,
          position,
          isInitial,
        },
        select: { id: true },
      })
    ).id;
  const openId = await mkStatus(OPEN, 'TODO', 1, true);
  const pausedId = await mkStatus(PAUSED, 'IN_PROGRESS', 2, false);
  const doneId = await mkStatus(DONE, 'DONE', 3, false);
  // สองทางออกจากสถานะเดียวกัน — ต้องเลือกใบที่ตรงกับคอลัมน์ปลายทาง
  await prismaClient.workflowTransition.createMany({
    data: [
      {
        tenantId,
        workflowId: wf.id,
        name: 'พักเรื่อง',
        fromStatusId: openId,
        toStatusId: pausedId,
        position: 1,
      },
      {
        tenantId,
        workflowId: wf.id,
        name: 'ปิดเรื่อง',
        fromStatusId: openId,
        toStatusId: doneId,
        position: 2,
      },
    ],
  });

  const template = await prismaClient.workItem.findFirstOrThrow({
    select: { issueTypeId: true },
  });
  await prismaClient.workflowScheme.create({
    data: { tenantId, projectId, issueTypeId: template.issueTypeId, workflowId: wf.id },
  });

  /*
    สร้างงานสามใบด้วย rank ที่ห่างกันชัด — ไม่ประกอบ rank เอง
    แต่ใช้ค่าที่รูปแบบถูกต้อง (`bucket|body`) เหมือนที่ `distribute` ให้
  */
  const ranks = ['0|1000', '0|2000', '0|3000'];
  for (const [i, rank] of ranks.entries()) {
    const w = await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey: `BRD${STAMP}-${String(i + 1)}`,
        issueTypeId: template.issueTypeId,
        statusId: openId,
        reporterId: staffId as bigint,
        summary: `การ์ดทดสอบ ${String(i + 1)} ${STAMP}`,
        rank,
      },
      select: { itemKey: true },
    });
    keys.push(w.itemKey);
  }
}, 180_000);

afterAll(async () => {
  const owners = [staffId, viewerId].filter((v): v is bigint => v !== undefined);
  await step('นาฬิกา SLA', () =>
    prismaClient.workItemSla.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { actorId: { in: owners } } }),
  );
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actorId: { in: owners } } }));
  await step('แจ้งเตือน', () =>
    prismaClient.notification.deleteMany({ where: { userId: { in: owners } } }),
  );
  await step('งานทดสอบ', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
  await step('workflow scheme', () =>
    prismaClient.workflowScheme.deleteMany({ where: { projectId } }),
  );
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: `BRD${STAMP}` } }));
  await step('transition', () =>
    prismaClient.workflowTransition.deleteMany({ where: { workflowId: workflowId ?? 0n } }),
  );
  await step('สถานะ', () =>
    prismaClient.workflowStatus.deleteMany({ where: { workflowId: workflowId ?? 0n } }),
  );
  await step('workflow', () =>
    prismaClient.workflow.deleteMany({ where: { id: workflowId ?? 0n } }),
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

/** ลำดับการ์ดในคอลัมน์หนึ่ง ตามที่ฐานข้อมูลเรียงให้ */
const orderIn = async (column: string): Promise<string[]> => {
  const b = await boardOf(staff, projectKey);
  return b.columns.find((c) => c.name === column)?.cards.map((c) => c.itemKey) ?? [];
};

describe('A · คอลัมน์', () => {
  it('**คอลัมน์มาจาก workflow ของโปรเจกต์ ไม่ใช่สถานะทั้งระบบ**', async () => {
    /*
      กระดานที่แสดงคอลัมน์ซึ่งงานในโปรเจกต์นี้ไปถึงไม่ได้ ทำให้คนลากแล้ว
      เด้งกลับโดยไม่เข้าใจว่าทำไม
    */
    const b = await boardOf(staff, projectKey);
    expect(b.columns.map((c) => c.name)).toEqual([OPEN, PAUSED, DONE]);
    expect(b.columns[0]?.cards).toHaveLength(3);
    expect(b.columns[2]?.cards).toHaveLength(0);
  });

  it('เรียงตาม rank และตรงกับที่ `compareRank` บอก', async () => {
    /*
      `rank` ใช้ collation `utf8mb4_bin` ซึ่งเทียบแบบไบนารี · ถ้าฝั่งแอปกับ
      ฝั่งฐานข้อมูลเรียงไม่ตรงกัน การ์ดจะกระโดดหลังรีเฟรช โดยไม่มีอะไรผิดพลาด
      ให้เห็นเลย
    */
    const b = await boardOf(staff, projectKey);
    const ranks = b.columns[0]?.cards.map((c) => c.rank) ?? [];
    const sorted = [...ranks].sort(compareRank);
    expect(ranks).toEqual(sorted);
  });

  it('โปรเจกต์ที่เปิดดูไม่ได้ ตอบเหมือนไม่มีอยู่', async () => {
    await expect(boardOf(staff, `ไม่มีจริง${STAMP}`)).rejects.toThrow(BoardItemNotFoundError);
  });
});

describe('B · จัดลำดับในคอลัมน์เดิม', () => {
  it('**ย้ายใบท้ายขึ้นมาบนสุด**', async () => {
    /*
      `between(null, first)` — เคสนี้คือครั้งแรกที่ `between` ถูกเรียกเพื่อ
      **ย้าย** ไม่ใช่เพื่อต่อท้าย ซึ่งเป็นเหตุผลทั้งหมดที่คอลัมน์ `rank` มีอยู่
    */
    const before = await orderIn(OPEN);
    await moveCard(staff, before[2] as string, { beforeKey: before[0] });
    expect(await orderIn(OPEN)).toEqual([before[2], before[0], before[1]]);
  });

  it('แทรกกลางระหว่างสองใบ', async () => {
    const o = await orderIn(OPEN);
    await moveCard(staff, o[0] as string, { afterKey: o[1], beforeKey: o[2] });
    expect(await orderIn(OPEN)).toEqual([o[1], o[0], o[2]]);
  });

  it('**ลากแล้วปล่อยที่เดิม ไม่เขียนอะไร**', async () => {
    // ประวัติที่รกเท่ากับไม่มีประวัติ — คนที่ไล่อ่านจะเลิกอ่าน
    const o = await orderIn(OPEN);
    const count = async (): Promise<number> =>
      prismaClient.workItemHistory.count({ where: { field: 'rank' } });
    const before = await count();
    await moveCard(staff, o[0] as string, {});
    expect(await count()).toBe(before);
    expect(await orderIn(OPEN)).toEqual(o);
  });

  it('เพื่อนบ้านสลับกัน = คำขอที่พัง', async () => {
    const o = await orderIn(OPEN);
    // afterKey อยู่หลัง beforeKey — เป็นไปไม่ได้
    await expect(
      moveCard(staff, o[0] as string, { afterKey: o[2], beforeKey: o[1] }),
    ).rejects.toThrow(BoardItemNotFoundError);
  });
});

describe('C · สิทธิ์', () => {
  it('**ไม่มี EDIT_ITEM = ย้ายไม่ได้**', async () => {
    const o = await orderIn(OPEN);
    await expect(moveCard(viewer, o[0] as string, { beforeKey: o[1] })).rejects.toThrow(
      PermissionDeniedError,
    );
  });
});

describe('D · ย้ายข้ามคอลัมน์', () => {
  it('**ต้องเดินผ่าน workflow — และเปลี่ยนสถานะจริง**', async () => {
    /*
      การเขียน `statusId` ทับตอนลาก คือการเดินอ้อมทุกอย่างที่ workflow
      มีไว้ปฏิเสธ · งานจะถูกปิดโดยไม่มีผลการแก้ไข นาฬิกา SLA ไม่หยุด
      และไม่มี error สักบรรทัด
    */
    const o = await orderIn(OPEN);
    const moved = await moveCard(staff, o[0] as string, { toColumn: DONE });
    expect(moved.statusName).toBe(DONE);
    expect(await orderIn(DONE)).toEqual([o[0]]);
    expect((await orderIn(OPEN)).length).toBe(2);

    // ประวัติต้องบันทึกว่าผ่านปุ่มไหน ไม่ใช่แค่ว่าสถานะเปลี่ยน
    const trail = await prismaClient.workItemHistory.count({
      where: { workItem: { itemKey: o[0] as string }, field: '__transition__' },
    });
    expect(trail).toBeGreaterThan(0);
  });

  it('**มีสองทางออก ต้องเลือกใบที่ตรงกับคอลัมน์ปลายทาง**', async () => {
    /*
      workflow ทดสอบมี "พักเรื่อง" อยู่ก่อน "ปิดเรื่อง" ตามลำดับ position ·
      ถ้าโค้ดหยิบ transition ใบแรกที่กดได้แทนที่จะเลือกตามคอลัมน์ การ์ดจะไป
      ลงคอลัมน์ผิด และผู้ใช้จะเห็นว่ามัน "เด้ง" ไปที่อื่น
    */
    const o = await orderIn(OPEN);
    const moved = await moveCard(staff, o[0] as string, { toColumn: DONE });
    expect(moved.statusName).toBe(DONE);
    expect(await orderIn(PAUSED)).toHaveLength(0);
  });

  it('**คอลัมน์ที่ไปไม่ได้ ต้องบอกว่าไปไหนได้บ้าง**', async () => {
    /*
      เด้งกลับเฉย ๆ ทำให้คนลากซ้ำอีกสามครั้งก่อนจะยอมแพ้ · ข้อความที่บอกว่า
      ไปไหนได้ ทำให้เขาทำถูกในครั้งถัดไป
    */
    const done = await orderIn(DONE);
    await expect(
      moveCard(staff, done[0] as string, { toColumn: OPEN }),
    ).rejects.toThrow(NoTransitionForColumnError);
  });

  it('ย้ายไปคอลัมน์ที่อยู่แล้ว = ไม่ทำอะไร', async () => {
    const done = await orderIn(DONE);
    const r = await moveCard(staff, done[0] as string, { toColumn: DONE });
    expect(r.statusName).toBe(DONE);
  });
});

describe('E · จัดลำดับใหม่ทั้งคอลัมน์', () => {
  it('rank ที่ยังสั้นอยู่ ไม่ต้องจัดใหม่', async () => {
    /*
      `needsRebalance` วัดจากความยาวเฉลี่ยจริง ไม่ใช่ตัวเลขที่เดา ·
      การจัดใหม่ทุกครั้งจะเขียนทับทั้งคอลัมน์โดยไม่จำเป็น
    */
    const r = await rebalanceColumn(staff, projectKey, OPEN);
    expect(r.rebalanced).toBe(0);
  });
});
