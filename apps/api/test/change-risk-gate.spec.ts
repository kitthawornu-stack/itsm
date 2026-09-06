/**
 * validator `max-change-risk` ต่อสายจริงหรือยัง
 *
 * เทสต์ของเอนจินพิสูจน์ได้แค่ว่า *ถ้า* ความเสี่ยงเข้ามาแบบนั้น ผลจะถูก ·
 * ไม่ได้พิสูจน์ว่า **มีอะไรในระบบส่งความเสี่ยงเข้ามาได้จริง** — ซึ่งเป็น
 * กับดักที่ CLAUDE.md บันทึกไว้จากหมวด F ของ SLA Engine
 *
 * ไฟล์นี้จึงสร้าง workflow กฎ และงานของตัวเอง แล้วยิงผ่าน **ผู้เรียกจริง**
 * (`bulkTransitionWorkItems`) ไม่ใช่ `applyTransition` ตรง ๆ ซึ่งเป็นชั้นที่
 * ไม่ได้ประเมินความเสี่ยงเอง — รอบแรกเขียนแบบหลังแล้วแดงทั้งสองเคส ซึ่งเป็น
 * คำตอบที่ถูกต้องของโค้ด แต่วัดผิดชั้น
 *
 * เคสที่สำคัญที่สุดคือ **เรื่องความเสี่ยงปานกลางต้องผ่าน** เพราะถ้าผู้เรียก
 * ไม่ได้ส่งความเสี่ยงมา validator จะปฏิเสธด้วย "ผู้เรียกไม่ได้ส่งมา" —
 * เคสนั้นจึงเป็นตัวจับว่าการต่อสายหลุดหรือไม่
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { bulkTransitionWorkItems } from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let ctx: TenantContext;
let userId: bigint;
let workflowId: bigint;
let toStatusId: bigint;
let transitionId: bigint;
let transitionName: string;
/** เรื่องที่ยังไม่ผูก CI และไม่มีช่วงเวลา — ทั้งสองเหตุเป็นระดับปานกลาง */
let mediumId: bigint;
/** เรื่องที่มีช่วงเวลาเริ่มไปแล้ว — emergency change ซึ่งเป็นระดับสูง */
let highId: bigint;

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
    data: { tenantId, name: `ชุดสิทธิ์ความเสี่ยง ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `RSK${STAMP}`,
      name: `โปรเจกต์ทดสอบความเสี่ยง ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  const groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `rsk ${STAMP}` },
      select: { id: true },
    })
  ).id;
  const u = await prismaClient.user.create({
    data: { tenantId, email: `rsk-${STAMP}@example.test`, displayName: `ผู้ใช้ ${STAMP}` },
    select: { id: true },
  });
  userId = u.id;
  await prismaClient.groupMember.create({ data: { tenantId, groupId, userId } });
  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId },
      { tenantId, schemeId: scheme.id, permission: 'TRANSITION_ITEM', groupId },
      { tenantId, schemeId: scheme.id, permission: 'BULK_EDIT', groupId },
    ] as never,
  });
  ctx = { tenantId, actorId: userId };

  const wf = await prismaClient.workflow.create({
    data: { tenantId, name: `workflow ความเสี่ยง ${STAMP}` },
    select: { id: true },
  });
  workflowId = wf.id;
  const mkStatus = async (name: string, position: number, initial: boolean): Promise<bigint> =>
    (
      await prismaClient.workflowStatus.create({
        data: {
          tenantId,
          workflowId: wf.id,
          name: `${name} ${STAMP}`,
          category: 'TODO' as never,
          position,
          isInitial: initial,
        },
        select: { id: true },
      })
    ).id;
  const fromStatusId = await mkStatus('รอเริ่ม', 1, true);
  toStatusId = await mkStatus('กำลังเปลี่ยนแปลง', 2, false);

  transitionName = `เริ่มดำเนินการ ${STAMP}`;
  const t = await prismaClient.workflowTransition.create({
    data: {
      tenantId,
      workflowId: wf.id,
      name: transitionName,
      fromStatusId,
      toStatusId,
      position: 1,
    },
    select: { id: true },
  });
  transitionId = t.id;
  await prismaClient.transitionRule.create({
    data: {
      tenantId,
      transitionId: t.id,
      kind: 'VALIDATOR' as never,
      ruleType: 'max-change-risk',
      config: {},
      position: 1,
    },
  });

  const issueType = await prismaClient.issueType.findFirstOrThrow({
    where: { tenantId, hierarchyLevel: 0 },
    select: { id: true },
  });
  await prismaClient.workflowScheme.create({
    data: { tenantId, projectId: project.id, issueTypeId: issueType.id, workflowId: wf.id },
  });

  const mkItem = async (n: number, summary: string): Promise<bigint> =>
    (
      await prismaClient.workItem.create({
        data: {
          tenantId,
          projectId: project.id,
          itemKey: `RSK${STAMP}-${String(n)}`,
          issueTypeId: issueType.id,
          statusId: fromStatusId,
          reporterId: userId,
          summary: `${summary} ${STAMP}`,
          rank: `0|${String(n)}00`,
        },
        select: { id: true },
      })
    ).id;
  mediumId = await mkItem(1, 'เปลี่ยนแปลงที่ยังไม่ได้วางแผน');
  highId = await mkItem(2, 'เปลี่ยนแปลงฉุกเฉิน');

  /*
    ช่วงเวลาที่ **เริ่มไปแล้ว** = emergency change ตามนิยามของเอนจิน ซึ่งเป็น
    ระดับสูง · ใช้วิธีนี้เพราะไม่ต้องมี CI และไม่ต้องแตะโมดูล cmdb
  */
  const now = Date.now();
  await prismaClient.changeWindow.create({
    data: {
      tenantId,
      workItemId: highId,
      plannedStart: new Date(now - 60 * 60 * 1000),
      plannedEnd: new Date(now + 60 * 60 * 1000),
      createdById: userId,
    },
  });
}, 180_000);

afterAll(async () => {
  const keys = [`RSK${STAMP}-1`, `RSK${STAMP}-2`];
  await step('ช่วงเวลา', () =>
    prismaClient.changeWindow.deleteMany({ where: { workItemId: { in: [mediumId, highId] } } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { actorId: userId } }),
  );
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actorId: userId } }));
  await step('งาน', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
  await step('scheme ของ workflow', () =>
    prismaClient.workflowScheme.deleteMany({ where: { workflowId } }),
  );
  await step('กฎ', () =>
    prismaClient.transitionRule.deleteMany({ where: { transitionId } }),
  );
  await step('transition', () =>
    prismaClient.workflowTransition.deleteMany({ where: { workflowId } }),
  );
  await step('สถานะ', () => prismaClient.workflowStatus.deleteMany({ where: { workflowId } }));
  await step('workflow', () => prismaClient.workflow.deleteMany({ where: { id: workflowId } }));
  await step('โปรเจกต์', () =>
    prismaClient.project.deleteMany({ where: { key: `RSK${STAMP}` } }),
  );
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({
      where: { scheme: { name: { contains: STAMP } } },
    }),
  );
  await step('สมาชิกกลุ่ม', () => prismaClient.groupMember.deleteMany({ where: { userId } }));
  await step('ผู้ใช้', () => prismaClient.user.deleteMany({ where: { id: userId } }));
  await step('กลุ่ม', () =>
    prismaClient.userGroup.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await prismaClient.$disconnect();
});

describe('กั้น transition ด้วยความเสี่ยง · ต่อของจริง', () => {
  /**
   * **เคสที่จับว่าการต่อสายหลุด**
   *
   * ยิงผ่าน `bulkTransitionWorkItems` ซึ่งเป็นหนึ่งในสี่ทางที่ประเมินความเสี่ยง
   * แล้วส่งเข้า `applyTransition` · ถ้าใครถอดการประเมินออกจากทางนี้ validator
   * จะปฏิเสธด้วย "ผู้เรียกไม่ได้ส่งมา" แล้วเคสนี้แดงทันที
   */
  it('**ความเสี่ยงปานกลางผ่าน — พิสูจน์ว่าผู้เรียกส่งความเสี่ยงมาจริง**', async () => {
    const r = await bulkTransitionWorkItems(ctx, [`RSK${STAMP}-1`], { transitionName });
    expect(r.failed, JSON.stringify(r.items)).toBe(0);
    expect(r.changed).toBe(1);
    const after = await prismaClient.workItem.findFirstOrThrow({
      where: { id: mediumId },
      select: { statusId: true },
    });
    expect(after.statusId).toBe(toStatusId);
  });

  it('**ความเสี่ยงสูงถูกกั้น และข้อความบอกเหตุผล**', async () => {
    const r = await bulkTransitionWorkItems(ctx, [`RSK${STAMP}-2`], { transitionName });
    expect(r.changed).toBe(0);
    expect(JSON.stringify(r.items)).toMatch(/ทำก่อนขอ|emergency/);
    const after = await prismaClient.workItem.findFirstOrThrow({
      where: { id: highId },
      select: { statusId: true },
    });
    expect(after.statusId, 'ด่านที่อยู่หลังการเขียนจะโยนสายเกินไป').not.toBe(toStatusId);
  });
});
