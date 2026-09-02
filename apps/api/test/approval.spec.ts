/**
 * การอนุมัติขั้นเดียว — เทสต์เป็นข้อกำหนด เขียนก่อนโค้ด
 *
 * ถ้าไม่มีที่บันทึก การอนุมัติจะเกิดใน LINE หรือในห้องประชุม แล้วไม่มีใคร
 * ตอบได้ว่าใครอนุมัติเมื่อไรด้วยเหตุผลอะไร
 *
 * หกข้อที่พลาดแล้วการอนุมัติกลายเป็นพิธีกรรมที่ไม่ได้ป้องกันอะไร:
 *
 *   1. **ผู้ขออนุมัติคำขอตัวเองไม่ได้** — ถ้าได้ ทุกคำขอของคนในกลุ่มผู้อนุมัติ
 *      จะผ่านอัตโนมัติโดยไม่มีใครเห็น
 *   2. **คนนอกกลุ่มตัดสินไม่ได้** และข้อความปฏิเสธต้องไม่บอกว่ากลุ่มไหนอนุมัติได้
 *   3. **หนึ่งคำขอที่ค้างอยู่ต่อหนึ่งเรื่อง** — ขอซ้อนกันได้เมื่อไร จะมีสองคำตอบ
 *      ที่ขัดกันแล้วไม่มีใครรู้ว่าอันไหนใช่
 *   4. **การปฏิเสธต้องบอกเหตุผล** — ปฏิเสธเฉย ๆ คือทางตันของผู้ขอ
 *   5. **ปฏิเสธแล้วขอใหม่ได้ และประวัติเดิมต้องยังอยู่**
 *   6. **กลุ่มที่ไม่มีสมาชิกเลย ขอไม่ได้** — คำขอที่ไม่มีวันมีใครมาตัดสิน
 *      ต้องดังตอนขอ ไม่ใช่ค้างเงียบ ๆ
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError, type PermissionKey } from '../src/modules/permission';
import {
  AlreadyPendingError,
  NoPendingApprovalError,
  NotAnApproverError,
  RejectionNeedsReasonError,
  SelfApprovalError,
  approvalStateOf,
  approvalsFor,
  approverGroups,
  decideApproval,
  requestApproval,
} from '../src/modules/approval';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let requester: TenantContext;
let approver: TenantContext;
let outsider: TenantContext;
let requesterId: bigint;
let approverId: bigint;
let outsiderId: bigint;
let groupId: bigint;
let emptyGroupId: bigint;
let itemKey: string;
let itemId: bigint;
let permGroupId: bigint;
const permGrantIds: bigint[] = [];
const keys: string[] = [];
/** สร้างงานของเทสต์เอง แล้วจำคีย์ไว้เก็บกวาด — ห้ามหยิบงานของ seed มาใช้ */
let mkItem: (tag: string) => Promise<string>;

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    // เก็บกวาดต้องดังไว้ ไม่เงียบ — และขั้นที่ล้มต้องไม่หยุดขั้นที่เหลือ
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  tenantId = tenant.id;
  const projectId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } })).id;

  const mkUser = async (n: string): Promise<bigint> =>
    (
      await prismaClient.user.create({
        data: { tenantId, email: `apv-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
        select: { id: true },
      })
    ).id;
  requesterId = await mkUser('ผู้ขอ');
  approverId = await mkUser('ผู้อนุมัติ');
  outsiderId = await mkUser('คนนอก');

  groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `ผู้อนุมัติ ${STAMP}` },
      select: { id: true },
    })
  ).id;
  emptyGroupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `กลุ่มว่าง ${STAMP}` },
      select: { id: true },
    })
  ).id;
  // ผู้ขออยู่ในกลุ่มผู้อนุมัติด้วย — เพื่อพิสูจน์ว่ายังอนุมัติตัวเองไม่ได้
  await prismaClient.groupMember.createMany({
    data: [
      { tenantId, groupId, userId: approverId },
      { tenantId, groupId, userId: requesterId },
    ],
  });

  requester = { tenantId, actorId: requesterId };
  approver = { tenantId, actorId: approverId };
  outsider = { tenantId, actorId: outsiderId };

  /*
    **ให้สิทธิ์ผ่านกลุ่มของเทสต์เอง**

    ก่อนหน้านี้ทั้งไฟล์รันด้วยผู้ใช้ที่ไม่มีสิทธิ์ในโปรเจกต์ไหนเลยและผ่านหมด
    ซึ่งเป็นหลักฐานในตัวมันเองว่าโมดูล `approval` ไม่เคยมีด่านสิทธิ์ ·
    **คนนอกไม่ได้อยู่ในกลุ่มนี้** เพราะเคสของเขาคือการพิสูจน์ว่าถูกปฏิเสธ
  */
  const schemeId = (
    await prismaClient.project.findFirstOrThrow({
      where: { id: projectId },
      select: { permissionSchemeId: true },
    })
  ).permissionSchemeId;
  if (schemeId === null) throw new Error('โปรเจกต์ SD ไม่มี permission scheme');
  permGroupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `สิทธิ์อนุมัติ ${STAMP}` },
      select: { id: true },
    })
  ).id;
  for (const userId of [requesterId, approverId]) {
    await prismaClient.groupMember.create({ data: { tenantId, groupId: permGroupId, userId } });
  }
  for (const permission of ['BROWSE_PROJECT', 'EDIT_ITEM'] as PermissionKey[]) {
    const g = await prismaClient.permissionGrant.create({
      data: { tenantId, schemeId, permission, groupId: permGroupId },
      select: { id: true },
    });
    permGrantIds.push(g.id);
  }

  const template = await prismaClient.workItem.findFirstOrThrow({ where: { projectId } });
  mkItem = async (tag: string): Promise<string> => {
    const w = await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey: `SD-APV${STAMP}${tag}`,
        issueTypeId: template.issueTypeId,
        statusId: template.statusId,
        reporterId: requesterId,
        summary: `ขอซื้อจอเพิ่ม ${tag} ${STAMP}`,
        rank: `zza${STAMP}${tag}`,
      },
      select: { id: true, itemKey: true },
    });
    keys.push(w.itemKey);
    return w.itemKey;
  };
  itemKey = await mkItem('');
  // เก็บ id ของใบหลักไว้ตัวเดียว — ใบที่สร้างทีหลังต้องไม่มาทับ
  itemId = (
    await prismaClient.workItem.findFirstOrThrow({ where: { itemKey }, select: { id: true } })
  ).id;
}, 120_000);

afterAll(async () => {
  await step('สิทธิ์ของเทสต์', () =>
    prismaClient.permissionGrant.deleteMany({ where: { id: { in: permGrantIds } } }),
  );
  await step('สมาชิกกลุ่มสิทธิ์', () =>
    prismaClient.groupMember.deleteMany({ where: { groupId: permGroupId } }),
  );
  await step('กลุ่มสิทธิ์', () =>
    prismaClient.userGroup.deleteMany({ where: { id: permGroupId } }),
  );
  await step('คำขออนุมัติ', () =>
    prismaClient.approval.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('คำขอที่ผู้ใช้ของเทสต์สร้างที่อื่น', () =>
    prismaClient.approval.deleteMany({ where: { requestedById: { in: [requesterId, approverId] } } }),
  );
  await step('แจ้งเตือน', () =>
    prismaClient.notification.deleteMany({
      where: { userId: { in: [requesterId, approverId, outsiderId] } },
    }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({
      where: { actorId: { in: [requesterId, approverId, outsiderId] } },
    }),
  );
  await step('งานทดสอบ', () =>
    prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { groupId: { in: [groupId, emptyGroupId] } } }),
  );
  await step('ผู้ใช้ของเทสต์', () =>
    prismaClient.user.deleteMany({ where: { id: { in: [requesterId, approverId, outsiderId] } } }),
  );
  await step('กลุ่มของเทสต์', () =>
    prismaClient.userGroup.deleteMany({ where: { id: { in: [groupId, emptyGroupId] } } }),
  );
  await prismaClient.$disconnect();
});

describe('A · ขออนุมัติ', () => {
  it('ยังไม่เคยขอ = none ไม่ใช่ rejected', async () => {
    // สองอย่างนี้ผู้ใช้ต้องทำคนละอย่าง — ไปกดขอ กับ แก้เรื่องแล้วขอใหม่
    expect(await approvalStateOf(requester, itemId)).toBe('none');
  });

  it('ขอแล้วสถานะเป็น pending และมีประวัติหนึ่งรายการ', async () => {
    await requestApproval(requester, itemKey, [groupId], 'จอเดิมเสีย ใช้งานไม่ได้');
    expect(await approvalStateOf(requester, itemId)).toBe('pending');
    const list = await approvalsFor(requester, itemKey);
    expect(list).toHaveLength(1);
    expect(list[0]?.reason).toBe('จอเดิมเสีย ใช้งานไม่ได้');
  });

  it('**ขอซ้อนไม่ได้ขณะที่ยังรออยู่**', async () => {
    // สองคำขอที่คนละคนตัดสินคนละทาง = ไม่มีใครตอบได้ว่าอันไหนคือคำตอบ
    await expect(requestApproval(requester, itemKey, [groupId])).rejects.toThrow(AlreadyPendingError);
  });

  it('**กลุ่มที่ไม่มีสมาชิกเลย ขอไม่ได้**', async () => {
    /*
      คำขอที่ไม่มีวันมีใครมาตัดสิน ต้องดังตอนขอ ไม่ใช่ค้างเงียบ ๆ
      แล้วผู้ขอรอไปเรื่อย ๆ โดยไม่มีอะไรบอกว่าไม่มีวันได้คำตอบ
    */
    /*
      **สร้างงานของตัวเอง ไม่หยิบงานของ seed มาใช้** — เคสนี้ "ไม่ควรสร้างอะไร"
      แต่ตอนกลไกถูกลบเพื่อพิสูจน์ว่าเทสต์แดงได้ มันขอสำเร็จจริงและเขียนประวัติ
      ลงงานใบนั้น · เคยเกิดขึ้นแล้วกับ HR-1 และเก็บกวาดไม่ครอบเพราะไม่ได้อยู่ใน
      รายการที่จำไว้
    */
    const other = await mkItem('EMPTY');
    await expect(requestApproval(requester, other, [emptyGroupId])).rejects.toThrow(
      NotAnApproverError,
    );
  });

  /**
   * **โมดูลนี้เคยไม่มีด่านสิทธิ์เลยสักบรรทัด**
   *
   * `tenantScoped` กันข้ามองค์กรได้ แต่ไม่ได้กันข้ามโปรเจกต์ · ใครก็ตาม
   * ในองค์กรจึงอ่านสายอนุมัติของงานที่ตัวเองเปิดดูไม่ได้ รวมถึงชื่อกลุ่ม
   * ผู้อนุมัติ คำตัดสิน และเหตุผลที่ปฏิเสธ · และ `approverGroups` คืน
   * **ทุกกลุ่มในองค์กรพร้อมจำนวนสมาชิก** ให้ใครก็ได้ที่ล็อกอินอยู่
   *
   * เจอด้วย `authz-smoke.spec.ts` ไม่ได้เจอด้วยการอ่านโค้ด
   */
  it('**คนที่เปิดดูโปรเจกต์ไม่ได้ อ่านสายอนุมัติและรายชื่อกลุ่มไม่ได้**', async () => {
    const key = await mkItem('SEC');
    // เจ้าของสิทธิ์อ่านได้ — ถ้าเคสนี้ล้ม แปลว่าด่านกันผิดคน ไม่ใช่กันถูกคน
    await expect(approvalsFor(requester, key)).resolves.toBeDefined();
    await expect(approvalsFor(outsider, key)).rejects.toThrow(PermissionDeniedError);
    await expect(approverGroups(outsider, key)).rejects.toThrow(PermissionDeniedError);
    await expect(requestApproval(outsider, key, [groupId])).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it('กลุ่มที่เลือกได้ ต้องไม่มีกลุ่มว่างอยู่ในรายการ', async () => {
    // ต้องส่งงานที่กำลังจะขออนุมัติมาด้วย — ฟังก์ชันนี้ตรวจสิทธิ์จากโปรเจกต์ของงาน
    const groups = await approverGroups(requester, await mkItem('GROUPS'));
    expect(groups.some((g) => g.id === groupId.toString())).toBe(true);
    expect(groups.some((g) => g.id === emptyGroupId.toString())).toBe(false);
  });
});

describe('B · ใครตัดสินได้', () => {
  it('**คนนอกกลุ่มตัดสินไม่ได้**', async () => {
    await expect(decideApproval(outsider, itemKey, { approve: true })).rejects.toThrow(
      NotAnApproverError,
    );
  });

  it('**ผู้ขออนุมัติคำขอของตัวเองไม่ได้ แม้จะอยู่ในกลุ่มผู้อนุมัติ**', async () => {
    /*
      นี่คือเคสที่สำคัญที่สุดของไฟล์นี้ — ผู้ขออยู่ในกลุ่มจริง จึงผ่านด่าน
      "เป็นสมาชิกไหม" มาได้ · ถ้าไม่มีด่านที่สอง ทุกคำขอของคนในกลุ่มผู้อนุมัติ
      จะผ่านอัตโนมัติโดยไม่มีใครเห็น และการอนุมัติทั้งระบบจะไม่มีความหมาย
    */
    await expect(decideApproval(requester, itemKey, { approve: true })).rejects.toThrow(
      SelfApprovalError,
    );
  });

  it('ปฏิเสธแล้วต้องยังเป็น pending อยู่ ไม่ใช่ถูกตัดสินไปแล้ว', async () => {
    expect(await approvalStateOf(requester, itemId)).toBe('pending');
  });
});

describe('C · การตัดสิน', () => {
  it('**ปฏิเสธโดยไม่บอกเหตุผลไม่ได้**', async () => {
    // ปฏิเสธเฉย ๆ คือทางตัน — ผู้ขอไม่รู้ว่าต้องแก้อะไรก่อนขอใหม่
    await expect(decideApproval(approver, itemKey, { approve: false })).rejects.toThrow(
      RejectionNeedsReasonError,
    );
    await expect(decideApproval(approver, itemKey, { approve: false, note: '   ' })).rejects.toThrow(
      RejectionNeedsReasonError,
    );
  });

  it('ปฏิเสธพร้อมเหตุผลได้ และประวัติจำเหตุผลไว้', async () => {
    await decideApproval(approver, itemKey, { approve: false, note: 'งบปีนี้หมดแล้ว' });
    expect(await approvalStateOf(requester, itemId)).toBe('rejected');
    const list = await approvalsFor(requester, itemKey);
    expect(list[0]?.decisionNote).toBe('งบปีนี้หมดแล้ว');
    expect(list[0]?.decidedBy).toContain('ผู้อนุมัติ');
  });

  it('**ตัดสินซ้ำไม่ได้ — ไม่มีคำขอค้างอยู่แล้ว**', async () => {
    await expect(decideApproval(approver, itemKey, { approve: true })).rejects.toThrow(
      NoPendingApprovalError,
    );
  });

  it('**ปฏิเสธแล้วขอใหม่ได้ และประวัติเดิมยังอยู่**', async () => {
    await requestApproval(requester, itemKey, [groupId], 'ขอใหม่ ใช้งบปีหน้า');
    expect(await approvalStateOf(requester, itemId)).toBe('pending');

    const list = await approvalsFor(requester, itemKey);
    expect(list).toHaveLength(2);
    // ใหม่สุดก่อน · ใบเก่ายังตอบได้ว่าเคยถูกปฏิเสธเพราะอะไร
    expect(list[0]?.status).toBe('PENDING');
    expect(list[1]?.status).toBe('REJECTED');
    expect(list[1]?.decisionNote).toBe('งบปีนี้หมดแล้ว');
  });

  it('อนุมัติแล้วสถานะเป็น approved', async () => {
    await decideApproval(approver, itemKey, { approve: true });
    expect(await approvalStateOf(requester, itemId)).toBe('approved');
  });
});

describe('D · ร่องรอย', () => {
  it('ทุกการเปลี่ยนแปลงเขียนประวัติของงาน', async () => {
    const n = await prismaClient.workItemHistory.count({
      where: { workItemId: itemId, field: 'approval' },
    });
    // ขอ · ปฏิเสธ · ขอใหม่ · อนุมัติ = 4
    expect(n).toBe(4);
  });

  it('**ผู้อนุมัติได้รับแจ้ง แต่ผู้ขอไม่ได้รับแจ้งคำขอของตัวเอง**', async () => {
    const toApprover = await prismaClient.notification.count({
      where: { userId: approverId, kind: 'approval.requested' },
    });
    const toRequester = await prismaClient.notification.count({
      where: { userId: requesterId, kind: 'approval.requested' },
    });
    expect(toApprover).toBeGreaterThan(0);
    // ผู้ขออยู่ในกลุ่มด้วย แต่รู้อยู่แล้วว่าเพิ่งกดขอ
    expect(toRequester).toBe(0);
  });

  it('ผู้ขอได้รับแจ้งผลการตัดสิน', async () => {
    const n = await prismaClient.notification.count({
      where: { userId: requesterId, kind: 'approval.decided' },
    });
    expect(n).toBeGreaterThan(0);
  });
});
