/**
 * โหวตสนับสนุนเรื่อง — เทสต์เป็นข้อกำหนด
 *
 * สามข้อที่ต้องถูกตั้งแต่แรก เพราะแก้ทีหลังแปลว่าตัวเลขที่คนเคยอ่านไปแล้วผิด:
 * **ผู้แจ้งโหวตเรื่องของตัวเองไม่ได้** (ไม่งั้นทุกเรื่องเริ่มที่หนึ่งเสียงเสมอ) ·
 * **กดซ้ำคือถอนเสียง ไม่ใช่ error** · และ **นับใหม่จากฐานข้อมูลหลังเขียน**
 * ไม่ใช่บวกลบจากค่าที่อ่านมาก่อน ซึ่งจะเพี้ยนเมื่อสองคนกดพร้อมกัน
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  CannotVoteOwnItemError,
  VoteTargetNotFoundError,
  toggleVote,
  voteOf,
} from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let itemId: bigint;
let itemKey: string;
let reporterId: bigint;
let groupId: bigint;
let reporter: TenantContext;
let voter: TenantContext;
let voter2: TenantContext;
let outsider: TenantContext;
/** เปิดดู *โปรเจกต์อื่น* ได้ แต่ไม่ใช่โปรเจกต์นี้ */
let neighbour: TenantContext;

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
    data: { tenantId, name: `ชุดสิทธิ์โหวต ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `VOT${STAMP}`,
      name: `โปรเจกต์ทดสอบโหวต ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `vot ${STAMP}` },
      select: { id: true },
    })
  ).id;

  const mkUser = async (n: string, inGroup: boolean): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `vot-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    if (inGroup) await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  reporterId = await mkUser('reporter', true);
  const voterId = await mkUser('voter', true);
  const voter2Id = await mkUser('voter2', true);
  // คนนอก — ไม่อยู่กลุ่มไหนเลย จึงเปิดดูโปรเจกต์นี้ไม่ได้
  const outsiderId = await mkUser('outsider', false);

  /*
    **คนที่เปิดดูโปรเจกต์อื่นได้ แต่ไม่ใช่โปรเจกต์นี้** — รายการโปรเจกต์ของเขา
    ไม่ว่าง จึงเดินผ่านสาขาอื่นของโค้ด · ตอนพิสูจน์ว่าเทสต์แดงได้ ลบตัวกรอง
    `projectId` ออกแล้วยังเขียวทั้งชุด เพราะคนนอกไปโดนสาขา "ไม่มีโปรเจกต์
    ให้ดูเลย" ดักไว้ก่อน — ตัวกรองจริงจึงไม่เคยถูกทดสอบ
  */
  const otherScheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์ข้างเคียง ${STAMP}` },
    select: { id: true },
  });
  const otherGroupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `vot-nb ${STAMP}` },
      select: { id: true },
    })
  ).id;
  await prismaClient.project.create({
    data: {
      tenantId,
      key: `VNB${STAMP}`,
      name: `โปรเจกต์ข้างเคียง ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: otherScheme.id,
    },
  });
  await prismaClient.permissionGrant.create({
    data: { tenantId, schemeId: otherScheme.id, permission: 'BROWSE_PROJECT', groupId: otherGroupId },
  });
  const neighbourId = await mkUser('neighbour', false);
  await prismaClient.groupMember.create({
    data: { tenantId, groupId: otherGroupId, userId: neighbourId },
  });
  neighbour = { tenantId, actorId: neighbourId };

  await prismaClient.permissionGrant.create({
    data: { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId },
  });
  reporter = { tenantId, actorId: reporterId };
  voter = { tenantId, actorId: voterId };
  voter2 = { tenantId, actorId: voter2Id };
  outsider = { tenantId, actorId: outsiderId };

  const template = await prismaClient.workItem.findFirstOrThrow({
    select: { issueTypeId: true, statusId: true },
  });
  const item = await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId: project.id,
      itemKey: `VOT${STAMP}-1`,
      issueTypeId: template.issueTypeId,
      statusId: template.statusId,
      reporterId,
      summary: `งานทดสอบโหวต ${STAMP}`,
      rank: `zzvo${STAMP}`,
    },
    select: { id: true, itemKey: true },
  });
  itemId = item.id;
  itemKey = item.itemKey;
}, 180_000);

afterAll(async () => {
  const mine = { email: { endsWith: `${STAMP}@example.test` } };
  await step('เสียงโหวต', () => prismaClient.workItemVote.deleteMany({ where: { user: mine } }));
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actor: mine } }));
  await step('งานทดสอบ', () => prismaClient.workItem.deleteMany({ where: { itemKey } }));
  await step('โปรเจกต์', () =>
    prismaClient.project.deleteMany({ where: { key: { in: [`VOT${STAMP}`, `VNB${STAMP}`] } } }),
  );
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({
      where: { scheme: { name: { contains: STAMP } } },
    }),
  );
  await step('สมาชิกกลุ่ม', () => prismaClient.groupMember.deleteMany({ where: { user: mine } }));
  await step('ผู้ใช้', () => prismaClient.user.deleteMany({ where: mine }));
  await step('กลุ่ม', () =>
    prismaClient.userGroup.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await prismaClient.$disconnect();
});

describe('โหวต · A · เสียงของตัวเอง', () => {
  it('โหวตแล้วนับเป็นหนึ่ง และรู้ว่าตัวเองโหวตแล้ว', async () => {
    expect(await toggleVote(voter, itemKey)).toEqual({ count: 1, voted: true, ownItem: false });
  });

  it('**กดซ้ำคือถอนเสียง ไม่ใช่ error**', async () => {
    expect(await toggleVote(voter, itemKey)).toEqual({ count: 0, voted: false, ownItem: false });
    expect(await prismaClient.workItemVote.count({ where: { workItemId: itemId } })).toBe(0);
  });

  it('สองคนโหวต = สองเสียง และแต่ละคนเห็นสถานะของตัวเอง', async () => {
    await toggleVote(voter, itemKey);
    const second = await toggleVote(voter2, itemKey);
    expect(second.count).toBe(2);
    expect(second.voted).toBe(true);
    // คนที่ถอนไปแล้วเห็นยอดรวมเท่ากัน แต่สถานะของตัวเองต่างกัน
    await toggleVote(voter, itemKey);
    expect(await voteOf(voter, itemId, voter.actorId, reporterId)).toEqual({
      count: 1,
      voted: false,
      ownItem: false,
    });
  });
});

describe('โหวต · B · ใครโหวตไม่ได้', () => {
  /** ถ้าโหวตได้ ทุกเรื่องจะเริ่มที่หนึ่งเสียงเสมอ แล้วตัวเลขไม่บอกอะไรเลย */
  it('**ผู้แจ้งโหวตเรื่องของตัวเองไม่ได้**', async () => {
    await expect(toggleVote(reporter, itemKey)).rejects.toThrow(CannotVoteOwnItemError);
    expect(
      await prismaClient.workItemVote.count({
        where: { workItemId: itemId, userId: reporterId },
      }),
      'ด่านที่อยู่หลังการเขียนจะโยนสายเกินไป',
    ).toBe(0);
  });

  it('หน้าจอรู้ล่วงหน้าว่าเป็นเรื่องของตัวเอง จึงไม่ต้องแสดงปุ่มที่กดแล้วได้ error', async () => {
    expect((await voteOf(reporter, itemId, reporter.actorId, reporterId)).ownItem).toBe(true);
  });

  /** เปิดดูไม่ได้ กับ ไม่มีอยู่จริง ต้องตอบเหมือนกัน — ไม่ยืนยันว่าคีย์นี้มีอยู่ */
  it('**คนที่เปิดดูโปรเจกต์ไม่ได้ ตอบเหมือนไม่มีเรื่องนี้**', async () => {
    await expect(toggleVote(outsider, itemKey)).rejects.toThrow(VoteTargetNotFoundError);
    await expect(toggleVote(voter, `VOT${STAMP}-9999`)).rejects.toThrow(VoteTargetNotFoundError);
  });

  /** เคสที่ทำให้ตัวกรอง `projectId` ถูกเรียกใช้จริง — ดูเหตุผลใน `beforeAll` */
  it('**คนที่เปิดดูโปรเจกต์อื่นได้ ก็ยังโหวตเรื่องนี้ไม่ได้**', async () => {
    await expect(toggleVote(neighbour, itemKey)).rejects.toThrow(VoteTargetNotFoundError);
    const nb = neighbour.actorId as bigint;
    expect(await prismaClient.workItemVote.count({ where: { userId: nb } })).toBe(0);
  });
});

describe('โหวต · C · เสียงไม่ค้างเป็นแถวกำพร้า', () => {
  /**
   * ลบผู้ใช้แล้วเสียงต้องหายไปด้วย · ถ้าค้าง ยอดโหวตจะนับคนที่ไม่มีอยู่แล้ว
   * — อาการเดียวกับ 170 แถวใน `notification` ที่ชี้ไปหาผู้ใช้ที่ถูกลบ (§8)
   * · ด่านอยู่ที่สคีมา (`onDelete: Cascade`) ไม่ใช่ที่โค้ดเก็บกวาด
   */
  it('**ลบผู้ใช้แล้วเสียงหายตาม**', async () => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `vot-tmp-${STAMP}@example.test`, displayName: 'ชั่วคราว' },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    await toggleVote({ tenantId, actorId: u.id }, itemKey);
    expect(await prismaClient.workItemVote.count({ where: { userId: u.id } })).toBe(1);

    await prismaClient.groupMember.deleteMany({ where: { userId: u.id } });
    await prismaClient.auditLog.deleteMany({ where: { actorId: u.id } });
    await prismaClient.user.delete({ where: { id: u.id } });
    expect(await prismaClient.workItemVote.count({ where: { userId: u.id } })).toBe(0);
  });
});
