/**
 * เลนตาม Epic — ต่อกับฐานข้อมูลจริง
 *
 * **ทั้งฐานข้อมูลพัฒนาไม่มีงานที่มีแม่สักใบ** (`parent_id` เป็น null ทั้งหมด)
 * ลำดับชั้น Epic → Story → Sub-task จึงไม่เคยถูกใช้จริงบนเครื่องพัฒนาเลย
 * แม้เอกสารจะกาว่าเสร็จแล้ว · ไฟล์นี้จึง **สร้างลำดับชั้นของตัวเอง** แล้วลบทิ้ง
 * ไม่ใช่หวังว่าจะมีข้อมูลให้ใช้
 *
 * สองข้อที่ผิดแล้วเงียบ:
 *
 *   1. **ไต่ชั้นเดียวแล้วหยุด** — Sub-task อยู่ลึกสองชั้นจาก Epic
 *      (Sub-task → Story → Epic) · ถ้าไต่ชั้นเดียว Sub-task จะกลายเป็น
 *      "ไม่ได้อยู่ใต้ Epic ใด" ทั้งที่มี และไม่มีอะไรบอกว่าผิด
 *   2. **ตัดสิน Epic จากชื่อประเภทงาน** — ชื่อเปลี่ยนได้และแต่ละองค์กร
 *      ตั้งไม่เหมือนกัน · ต้องดู `hierarchyLevel === 1`
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { boardOf } from '../src/modules/board';

const STAMP = String(Date.now()).slice(-6);
const OPEN = `รอทำ ${STAMP}`;

let tenantId: bigint;
let projectId: bigint;
let projectKey = '';
let ctx: TenantContext;
let userId: bigint | undefined;
let workflowId: bigint | undefined;
const keys: string[] = [];

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
    ใช้ประเภทงานที่มีอยู่จริง โดยเลือกจาก `hierarchyLevel` **ไม่ใช่จากชื่อ** —
    เกณฑ์เดียวกับที่โค้ดใช้ · ถ้าเลือกด้วยชื่อ เทสต์จะพิสูจน์คนละอย่างกับที่โค้ดทำ
  */
  const epic = await prismaClient.issueType.findFirstOrThrow({
    where: { tenantId, hierarchyLevel: 1 },
    select: { id: true },
  });
  const story = await prismaClient.issueType.findFirstOrThrow({
    where: { tenantId, hierarchyLevel: 0 },
    select: { id: true },
  });
  const sub = await prismaClient.issueType.findFirstOrThrow({
    where: { tenantId, hierarchyLevel: -1 },
    select: { id: true },
  });

  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์เลน Epic ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `EP${STAMP}`,
      name: `โปรเจกต์ทดสอบเลน Epic ${STAMP}`,
      type: 'SOFTWARE',
      permissionSchemeId: scheme.id,
    },
    select: { id: true, key: true },
  });
  projectId = project.id;
  projectKey = project.key;

  const groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `ep ${STAMP}` },
      select: { id: true },
    })
  ).id;
  const u = await prismaClient.user.create({
    data: { tenantId, email: `ep-${STAMP}@example.test`, displayName: `ผู้ใช้ ${STAMP}` },
    select: { id: true },
  });
  userId = u.id;
  await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
  await prismaClient.permissionGrant.createMany({
    data: [{ tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId }] as never,
  });
  ctx = { tenantId, actorId: u.id };

  const wf = await prismaClient.workflow.create({
    data: { tenantId, name: `workflow เลน Epic ${STAMP}` },
    select: { id: true },
  });
  workflowId = wf.id;
  const statusId = (
    await prismaClient.workflowStatus.create({
      data: {
        tenantId,
        workflowId: wf.id,
        name: OPEN,
        category: 'TODO' as never,
        position: 1,
        isInitial: true,
      },
      select: { id: true },
    })
  ).id;
  for (const t of [epic.id, story.id, sub.id]) {
    await prismaClient.workflowScheme.create({
      data: { tenantId, projectId, issueTypeId: t, workflowId: wf.id },
    });
  }

  const mkItem = async (
    n: number,
    issueTypeId: bigint,
    parentId: bigint | null,
    summary: string,
  ): Promise<bigint> => {
    const w = await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey: `EP${STAMP}-${String(n)}`,
        issueTypeId,
        statusId,
        parentId,
        reporterId: u.id,
        summary,
        rank: `0|${String(n)}000`,
      },
      select: { id: true, itemKey: true },
    });
    keys.push(w.itemKey);
    return w.id;
  };

  // Epic → Story → Sub-task · และงานอิสระที่ไม่มีแม่
  const epicId = await mkItem(1, epic.id, null, `ยกเครื่องระบบสำรองข้อมูล ${STAMP}`);
  const storyId = await mkItem(2, story.id, epicId, `ออกแบบตารางสำรอง ${STAMP}`);
  await mkItem(3, sub.id, storyId, `เขียนสคริปต์ ${STAMP}`);
  await mkItem(4, story.id, null, `งานที่ไม่มี Epic ${STAMP}`);
}, 180_000);

afterAll(async () => {
  await step('งานทดสอบ', async () => {
    // ลบลูกก่อนแม่ — foreign key ของ parent เป็น Restrict
    for (const k of [...keys].reverse()) {
      await prismaClient.workItem.deleteMany({ where: { itemKey: k } });
    }
  });
  await step('workflow scheme', () =>
    prismaClient.workflowScheme.deleteMany({ where: { projectId } }),
  );
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: `EP${STAMP}` } }));
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
    prismaClient.groupMember.deleteMany({ where: { userId: userId ?? 0n } }),
  );
  await step('ผู้ใช้', () => prismaClient.user.deleteMany({ where: { id: userId ?? 0n } }));
  await step('กลุ่ม', () =>
    prismaClient.userGroup.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await prismaClient.$disconnect();
});

/** การ์ดทุกใบบนกระดาน แมปคีย์ → ชื่อ Epic */
async function epicByKey(): Promise<Map<string, string | null>> {
  const b = await boardOf(ctx, projectKey);
  return new Map(b.columns.flatMap((c) => c.cards).map((c) => [c.itemKey, c.epic]));
}

describe('เลนตาม Epic', () => {
  it('probe · สร้างลำดับชั้นได้จริง — ไม่ใช่ผ่านเพราะกระดานว่าง', async () => {
    const m = await epicByKey();
    expect(m.size, 'กระดานไม่มีการ์ดเลย — เคสที่เหลือจะไม่ได้ตรวจอะไร').toBe(4);
    expect(
      await prismaClient.workItem.count({ where: { projectId, parentId: { not: null } } }),
      'ไม่มีงานที่มีแม่เลย',
    ).toBe(2);
  });

  it('Story ที่อยู่ใต้ Epic ได้ชื่อ Epic', async () => {
    expect((await epicByKey()).get(`EP${STAMP}-2`)).toBe(`ยกเครื่องระบบสำรองข้อมูล ${STAMP}`);
  });

  /**
   * **หัวใจของไฟล์นี้**
   *
   * Sub-task อยู่ลึกสองชั้นจาก Epic · ถ้าไต่ชั้นเดียวแล้วหยุด มันจะกลายเป็น
   * "ไม่ได้อยู่ใต้ Epic ใด" ทั้งที่มี — และไม่มีอะไรบอกว่าผิด
   */
  it('**Sub-task ที่อยู่ลึกสองชั้น ยังหา Epic เจอ**', async () => {
    expect((await epicByKey()).get(`EP${STAMP}-3`), 'ไต่ชั้นเดียวแล้วหยุด').toBe(
      `ยกเครื่องระบบสำรองข้อมูล ${STAMP}`,
    );
  });

  it('งานที่ไม่มีแม่ ได้ null ไม่ใช่ชื่อมั่ว', async () => {
    expect((await epicByKey()).get(`EP${STAMP}-4`)).toBeNull();
  });

  /**
   * ตัว Epic เองไม่ได้อยู่ใต้ Epic ไหน · ได้ `null` และไปอยู่เลน
   * "ไม่ได้อยู่ใต้ Epic ใด" — เขียนไว้ตรง ๆ ดีกว่าปล่อยให้คนเดาว่าหายไปไหน
   */
  it('ตัว Epic เองได้ null', async () => {
    expect((await epicByKey()).get(`EP${STAMP}-1`)).toBeNull();
  });
});
