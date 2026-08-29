/**
 * validator `children-done` — พิสูจน์ว่าสถานะนั้น **ไปถึงได้จริง**
 *
 * `workflow-engine.spec.ts` ทดสอบตัว validator แล้ว แต่มันประกอบ
 * `TransitionContext` ขึ้นมาเองในเทสต์ · แบบนั้นพิสูจน์ได้แค่ว่า *ถ้า*
 * `children` เข้ามาแบบนั้น ผลจะถูก — **ไม่ได้พิสูจน์ว่ามีอะไรในระบบ
 * ส่งค่านั้นเข้ามาได้จริง**
 *
 * นี่คือบทเรียนหมวด F ของ SLA Engine ตรง ๆ: เทสต์ประกาศว่า "ตั๋วที่เปิดใหม่
 * ต้องใช้นาฬิกาเรือนใหม่" และเขียว เพราะมันสร้างรายการเหตุการณ์ชุดใหม่เอง
 * ทั้งที่ไม่มีโค้ดเส้นไหนสร้างรายการนั้นได้เลย
 *
 * ไฟล์นี้จึงเดินผ่าน `availableTransitions` และ `applyTransition` ของจริง
 * บนงานที่มีงานย่อยจริง เพื่อพิสูจน์ว่า `buildContext` นับมาให้จริง
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { applyTransition, availableTransitions } from '../src/modules/workflow';
import { setParent } from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let projectId: bigint;
let staff: TenantContext;
let staffId: bigint | undefined;
let groupId: bigint | undefined;
let workflowId: bigint | undefined;
/** transition ที่ติด validator `children-done` */
let closeTransitionId: bigint | undefined;

const keys: string[] = [];
let parentKey = '';
let childKey = '';

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
    data: { tenantId, name: `ชุดสิทธิ์งานย่อย ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `CHD${STAMP}`,
      name: `โปรเจกต์ทดสอบงานย่อย ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = project.id;

  groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `chd-staff ${STAMP}` },
      select: { id: true },
    })
  ).id;
  const u = await prismaClient.user.create({
    data: { tenantId, email: `chd-staff-${STAMP}@example.test`, displayName: `ผู้ใช้ ${STAMP}` },
    select: { id: true },
  });
  staffId = u.id;
  await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId },
      { tenantId, schemeId: scheme.id, permission: 'EDIT_ITEM', groupId },
      { tenantId, schemeId: scheme.id, permission: 'TRANSITION_ITEM', groupId },
    ] as never,
  });
  staff = { tenantId, actorId: staffId };

  /*
    workflow ของตัวเอง — สองสถานะ หนึ่งปุ่ม ที่ติด validator `children-done`

    ไม่แตะ workflow ของ seed เพราะการเพิ่มกฎเข้าไปจะเปลี่ยนพฤติกรรมของ
    งานจริงทุกใบในโปรเจกต์นั้น และเทสต์ที่ล้มกลางทางจะทิ้งกฎนั้นค้างไว้
  */
  const wf = await prismaClient.workflow.create({
    data: { tenantId, name: `workflow งานย่อย ${STAMP}` },
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
          name: `${name} ${STAMP}`,
          category: category as never,
          position,
          isInitial,
        },
        select: { id: true },
      })
    ).id;
  const openId = await mkStatus('เปิดอยู่', 'TODO', 1, true);
  const doneId = await mkStatus('ปิดแล้ว', 'DONE', 2, false);

  const tr = await prismaClient.workflowTransition.create({
    data: {
      tenantId,
      workflowId: wf.id,
      name: 'ปิดเรื่อง',
      fromStatusId: openId,
      toStatusId: doneId,
      position: 1,
      rules: {
        create: [
          { tenantId, kind: 'VALIDATOR', ruleType: 'children-done', config: {}, position: 1 },
        ],
      },
    },
    select: { id: true },
  });
  closeTransitionId = tr.id;

  // ผูก workflow เข้ากับทุกประเภทงานที่เทสต์นี้ใช้
  const [parentType, childType] = await Promise.all([
    prismaClient.issueType.findFirstOrThrow({
      where: { hierarchyLevel: 0 },
      select: { id: true },
    }),
    prismaClient.issueType.findFirstOrThrow({
      where: { hierarchyLevel: -1 },
      select: { id: true },
    }),
  ]);
  await prismaClient.workflowScheme.createMany({
    data: [
      { tenantId, projectId, issueTypeId: parentType.id, workflowId: wf.id },
      { tenantId, projectId, issueTypeId: childType.id, workflowId: wf.id },
    ],
  });

  const mk = async (suffix: string, typeId: bigint): Promise<string> => {
    const w = await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey: `CHD${STAMP}-${suffix}`,
        issueTypeId: typeId,
        statusId: openId,
        reporterId: staffId as bigint,
        summary: `งานทดสอบงานย่อย ${suffix} ${STAMP}`,
        rank: `zzr${STAMP}${suffix}`,
      },
      select: { itemKey: true },
    });
    keys.push(w.itemKey);
    return w.itemKey;
  };
  parentKey = await mk('P', parentType.id);
  childKey = await mk('C', childType.id);
}, 180_000);

afterAll(async () => {
  await step('ถอดเรื่องหลัก', () =>
    prismaClient.workItem.updateMany({ where: { itemKey: { in: keys } }, data: { parentId: null } }),
  );
  await step('นาฬิกา SLA', () =>
    prismaClient.workItemSla.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { actorId: staffId ?? 0n } }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({ where: { actorId: staffId ?? 0n } }),
  );
  await step('แจ้งเตือน', () =>
    prismaClient.notification.deleteMany({ where: { userId: staffId ?? 0n } }),
  );
  await step('งานทดสอบ', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
  await step('workflow scheme', () =>
    prismaClient.workflowScheme.deleteMany({ where: { projectId } }),
  );
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: `CHD${STAMP}` } }));
  await step('กฎของ transition', () =>
    prismaClient.transitionRule.deleteMany({ where: { transitionId: closeTransitionId ?? 0n } }),
  );
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
    prismaClient.groupMember.deleteMany({ where: { userId: staffId ?? 0n } }),
  );
  await step('ผู้ใช้', () => prismaClient.user.deleteMany({ where: { id: staffId ?? 0n } }));
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

describe('A · ไม่มีงานย่อย', () => {
  it('**ปิดได้ตามปกติ — "นับแล้ว ไม่มี" ต้องปล่อยผ่าน**', async () => {
    /*
      ถ้า `buildContext` ไม่ได้นับมา validator จะปฏิเสธทุกครั้ง และเคสนี้จะแดง
      — จึงเป็นเทสต์ที่พิสูจน์ว่า **มีอะไรในระบบส่งค่านั้นเข้ามาได้จริง**
      ไม่ใช่แค่ว่าถ้าค่าเข้ามาแล้วผลจะถูก
    */
    const list = await availableTransitions(staff, await idOf(childKey), staffId as bigint);
    expect(list.map((t) => t.name)).toContain('ปิดเรื่อง');
    const r = await applyTransition(
      staff,
      await idOf(childKey),
      closeTransitionId as bigint,
      staffId as bigint,
    );
    expect(r.workItemId).toBe(await idOf(childKey));
  });
});

describe('B · มีงานย่อยค้าง', () => {
  it('**ปิดเรื่องหลักไม่ได้ และบอกว่าเหลือกี่เรื่อง**', async () => {
    // คืนงานย่อยกลับเป็นยังไม่เสร็จก่อน แล้วผูกใต้เรื่องหลัก
    const openStatus = await prismaClient.workflowStatus.findFirstOrThrow({
      where: { workflowId: workflowId ?? 0n, category: 'TODO' },
      select: { id: true },
    });
    await prismaClient.workItem.update({
      where: { id: await idOf(childKey) },
      data: { statusId: openStatus.id, resolvedAt: null },
    });
    await setParent(staff, childKey, parentKey);

    await expect(
      applyTransition(staff, await idOf(parentKey), closeTransitionId as bigint, staffId as bigint),
    ).rejects.toThrow(/1/);

    // ยังไม่ปิด
    const p = await prismaClient.workItem.findFirstOrThrow({
      where: { itemKey: parentKey },
      select: { status: { select: { category: true } } },
    });
    expect(p.status.category).not.toBe('DONE');
  });

  it('**ปิดงานย่อยแล้วจึงปิดเรื่องหลักได้**', async () => {
    /*
      ครึ่งหลังของข้อบน · เทสต์ที่พิสูจน์แค่ว่า "ปฏิเสธได้" ยังไม่พอ —
      ต้องพิสูจน์ว่า **ทางออกมีอยู่จริง** ไม่งั้นกฎนี้จะเป็นทางตันที่ผู้ใช้
      ออกเองไม่ได้ และไม่มีใครรู้จนกว่าจะมีคนติด
    */
    await applyTransition(
      staff,
      await idOf(childKey),
      closeTransitionId as bigint,
      staffId as bigint,
    );
    const r = await applyTransition(
      staff,
      await idOf(parentKey),
      closeTransitionId as bigint,
      staffId as bigint,
    );
    expect(r.workItemId).toBe(await idOf(parentKey));

    const p = await prismaClient.workItem.findFirstOrThrow({
      where: { itemKey: parentKey },
      select: { status: { select: { category: true } } },
    });
    expect(p.status.category).toBe('DONE');
  });
});
