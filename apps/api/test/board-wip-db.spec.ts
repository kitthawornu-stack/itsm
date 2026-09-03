/**
 * เพดานงานที่ทำพร้อมกัน — ต่อกับฐานข้อมูลจริง
 *
 * `wip-limit.spec.ts` พิสูจน์ตรรกะบนตัวเลขที่ประกอบขึ้นเอง · ไฟล์นี้พิสูจน์ว่า
 * **มีอะไรในระบบสร้างตัวเลขนั้นได้จริง** ซึ่งเป็นคนละเรื่องกัน (บทเรียนหมวด F
 * ของ SLA ใน CLAUDE.md: เทสต์ที่ประกอบข้อมูลนำเข้าเองพิสูจน์ได้แค่ว่า *ถ้า*
 * ข้อมูลหน้าตาแบบนั้นเข้ามา ผลจะถูก)
 *
 * ข้อที่สำคัญที่สุดคือ **`count` ไม่ใช่ `cards.length`** — ถ้าเพดานตัดสินจาก
 * จำนวนการ์ดที่แสดง คอลัมน์ที่ล้นจริงจะเงียบตั้งแต่ใบที่ 101 เป็นต้นไป ·
 * เคสนี้ไม่ต้องสร้างงาน 101 ใบ เพราะ `boardOf` รับเพดานการแสดงผลเป็น
 * พารามิเตอร์อยู่แล้ว — ตั้งเป็น 1 แล้วดูว่า `count` ยังบอกความจริงไหม
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  BoardColumnNotFoundError,
  InvalidWipLimitError,
  boardOf,
  setWipLimit,
} from '../src/modules/board';

const STAMP = String(Date.now()).slice(-6);
const OPEN = `รอหยิบ ${STAMP}`;
const DOING = `กำลังทำ ${STAMP}`;

let tenantId: bigint;
let projectId: bigint;
let projectKey = '';
/** ตั้งเพดานได้ */
let lead: TenantContext;
/** เห็นกระดาน แต่ตั้งเพดานไม่ได้ */
let member: TenantContext;
let leadId: bigint | undefined;
let memberId: bigint | undefined;
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

  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์เพดาน ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `WIP${STAMP}`,
      name: `โปรเจกต์ทดสอบเพดาน ${STAMP}`,
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
        data: { tenantId, name: `wip-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  const leadGroupId = await mkGroup('lead');
  const memberGroupId = await mkGroup('member');

  const mkUser = async (n: string, groupId: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `wip-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  leadId = await mkUser('lead', leadGroupId);
  memberId = await mkUser('member', memberGroupId);

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: leadGroupId },
      { tenantId, schemeId: scheme.id, permission: 'MANAGE_PROJECT', groupId: leadGroupId },
      // เห็นกระดาน แต่ตั้งเพดานไม่ได้ — การซ่อนปุ่มไม่ใช่การป้องกัน
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: memberGroupId },
    ] as never,
  });
  lead = { tenantId, actorId: leadId };
  member = { tenantId, actorId: memberId };

  const wf = await prismaClient.workflow.create({
    data: { tenantId, name: `workflow เพดาน ${STAMP}` },
    select: { id: true },
  });
  workflowId = wf.id;
  const mkStatus = async (
    name: string,
    category: string,
    position: number,
    init: boolean,
  ): Promise<bigint> =>
    (
      await prismaClient.workflowStatus.create({
        data: {
          tenantId,
          workflowId: wf.id,
          name,
          category: category as never,
          position,
          isInitial: init,
        },
        select: { id: true },
      })
    ).id;
  const openId = await mkStatus(OPEN, 'TODO', 1, true);
  await mkStatus(DOING, 'IN_PROGRESS', 2, false);

  const template = await prismaClient.workItem.findFirstOrThrow({ select: { issueTypeId: true } });
  await prismaClient.workflowScheme.create({
    data: { tenantId, projectId, issueTypeId: template.issueTypeId, workflowId: wf.id },
  });

  // สามใบในคอลัมน์แรก · คอลัมน์ที่สองว่าง
  for (let i = 1; i <= 3; i++) {
    const w = await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey: `WIP${STAMP}-${String(i)}`,
        issueTypeId: template.issueTypeId,
        statusId: openId,
        reporterId: leadId as bigint,
        summary: `การ์ดเพดาน ${String(i)} ${STAMP}`,
        rank: `0|${String(i)}000`,
      },
      select: { itemKey: true },
    });
    keys.push(w.itemKey);
  }
}, 180_000);

afterAll(async () => {
  const owners = [leadId, memberId].filter((v): v is bigint => v !== undefined);
  await step('เพดาน', () => prismaClient.boardWipLimit.deleteMany({ where: { projectId } }));
  await step('นาฬิกา SLA', () =>
    prismaClient.workItemSla.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { actorId: { in: owners } } }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({ where: { actorId: { in: owners } } }),
  );
  await step('งานทดสอบ', () =>
    prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }),
  );
  await step('workflow scheme', () =>
    prismaClient.workflowScheme.deleteMany({ where: { projectId } }),
  );
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: `WIP${STAMP}` } }));
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

const colOf = async (
  name: string,
  limitPerColumn = 100,
): Promise<Awaited<ReturnType<typeof boardOf>>['columns'][number] | undefined> => {
  const b = await boardOf(lead, projectKey, limitPerColumn);
  return b.columns.find((c) => c.name === name);
};

describe('A · จำนวนที่ใช้ตัดสิน', () => {
  /**
   * **หัวใจของไฟล์นี้**
   *
   * `cards` ถูกตัดที่เพดานการแสดงผล · ถ้าเพดาน WIP ตัดสินจาก `cards.length`
   * คอลัมน์ที่มีงานจริง 150 ใบจะรายงานว่า 100 แล้วเพดาน 120 จะดูเหมือน
   * ยังไม่เต็มทั้งที่เกินไปแล้ว 30 ใบ — เงียบสนิท ไม่มี error
   */
  it('**`count` คือจำนวนจริง ไม่ใช่จำนวนการ์ดที่แสดง**', async () => {
    const shown = await colOf(OPEN, 1);
    expect(shown?.cards).toHaveLength(1);
    expect(shown?.count, 'count เดินตามเพดานการแสดงผล = ตัดสินจากตัวเลขที่ถูกตัดมา').toBe(3);
  });

  it('คอลัมน์ว่างมี count เป็น 0 ไม่ใช่หายไป', async () => {
    expect((await colOf(DOING))?.count).toBe(0);
  });
});

describe('B · ตั้งและถอดเพดาน', () => {
  it('ยังไม่ได้ตั้ง = ไม่มีเพดาน', async () => {
    expect((await colOf(OPEN))?.wip).toEqual({ kind: 'no-limit', count: 3 });
  });

  it('ตั้งแล้วกระดานเห็นทันที', async () => {
    await setWipLimit(lead, projectKey, OPEN, 5);
    expect((await colOf(OPEN))?.wip).toEqual({ kind: 'under', count: 3, max: 5, remaining: 2 });
  });

  it('ตั้งเท่ากับจำนวนที่มี = เต็มพอดี ไม่ใช่เกิน', async () => {
    await setWipLimit(lead, projectKey, OPEN, 3);
    expect((await colOf(OPEN))?.wip).toEqual({ kind: 'at', count: 3, max: 3 });
  });

  it('ตั้งต่ำกว่าจำนวนที่มี = เกิน และบอกว่าเกินกี่ใบ', async () => {
    await setWipLimit(lead, projectKey, OPEN, 2);
    expect((await colOf(OPEN))?.wip).toEqual({ kind: 'over', count: 3, max: 2, excess: 1 });
  });

  it('ตั้งซ้ำคอลัมน์เดิมคือทับของเดิม ไม่ใช่เพิ่มแถว', async () => {
    await setWipLimit(lead, projectKey, OPEN, 7);
    expect(await prismaClient.boardWipLimit.count({ where: { projectId } })).toBe(1);
    expect((await colOf(OPEN))?.wip).toMatchObject({ max: 7 });
  });

  it('ถอดด้วย null แล้วกลับไปไม่มีเพดาน', async () => {
    await setWipLimit(lead, projectKey, OPEN, null);
    expect((await colOf(OPEN))?.wip).toEqual({ kind: 'no-limit', count: 3 });
    expect(await prismaClient.boardWipLimit.count({ where: { projectId } })).toBe(0);
  });
});

describe('C · ค่าที่ปฏิเสธ', () => {
  /**
   * **0 ต้องถูกปฏิเสธ ไม่ใช่รับไว้เงียบ ๆ**
   *
   * คนที่พิมพ์ 0 ตั้งใจจะถอดเพดาน · ถ้ารับไว้ เขาจะเชื่อว่าถอดแล้ว
   * ทั้งที่เก็บเป็นเพดาน 0 ซึ่งทำให้ทุกคอลัมน์ที่มีงานอ่านว่า "เกิน"
   */
  it('**0 ถูกปฏิเสธ และข้อความบอกวิธีถอดเพดานจริง ๆ**', async () => {
    await expect(setWipLimit(lead, projectKey, OPEN, 0)).rejects.toThrow(InvalidWipLimitError);
    await expect(setWipLimit(lead, projectKey, OPEN, 0)).rejects.toThrow(/ค่าว่าง/);
    expect(await prismaClient.boardWipLimit.count({ where: { projectId } })).toBe(0);
  });

  it('ค่าติดลบและเศษส่วนถูกปฏิเสธ', async () => {
    await expect(setWipLimit(lead, projectKey, OPEN, -3)).rejects.toThrow(InvalidWipLimitError);
    await expect(setWipLimit(lead, projectKey, OPEN, 2.5)).rejects.toThrow(InvalidWipLimitError);
  });

  it('คอลัมน์ที่ไม่มีบนกระดานนี้ ถูกปฏิเสธ ไม่ใช่สร้างแถวลอย', async () => {
    await expect(setWipLimit(lead, projectKey, `ไม่มีคอลัมน์นี้ ${STAMP}`, 5)).rejects.toThrow(
      BoardColumnNotFoundError,
    );
    expect(await prismaClient.boardWipLimit.count({ where: { projectId } })).toBe(0);
  });
});

describe('D · สิทธิ์', () => {
  /**
   * **คนที่เห็นกระดานได้ ไม่ได้แปลว่าตั้งเพดานให้ทั้งทีมได้**
   *
   * เพดานเป็นข้อตกลงของทีม ไม่ใช่ค่าที่ใครก็เปลี่ยนได้ · และการซ่อนปุ่ม
   * บนหน้าจอไม่ใช่การป้องกัน — เซิร์ฟเวอร์ต้องปฏิเสธเอง
   */
  it('**ไม่มี MANAGE_PROJECT ตั้งไม่ได้**', async () => {
    await expect(setWipLimit(member, projectKey, OPEN, 5)).rejects.toThrow(PermissionDeniedError);
    expect(await prismaClient.boardWipLimit.count({ where: { projectId } })).toBe(0);
  });

  it('คนที่ไม่มีสิทธิ์เห็นโปรเจกต์เลย ไม่ได้ตั้ง', async () => {
    const nobody: TenantContext = { tenantId, actorId: null };
    await expect(setWipLimit(nobody, projectKey, OPEN, 5)).rejects.toThrow();
    expect(await prismaClient.boardWipLimit.count({ where: { projectId } })).toBe(0);
  });
});

describe('E · หน้าจอรู้ว่าจะซ่อนปุ่มไหม', () => {
  /**
   * `canManage` **มีไว้ซ่อนปุ่มเท่านั้น ไม่ใช่การป้องกัน** — `setWipLimit`
   * ตรวจสิทธิ์เองทุกครั้ง (หมวด D) · ค่านี้มีไว้ไม่ให้ผู้ใช้เห็นช่องกรอก
   * ที่กดแล้วได้ 403 ซึ่งเป็นคนละเรื่องกับการกันไม่ให้ทำ
   */
  it('คนที่มี MANAGE_PROJECT ได้ canManage เป็นจริง', async () => {
    expect((await boardOf(lead, projectKey)).canManage).toBe(true);
  });

  it('**คนที่เห็นกระดานได้แต่ไม่มีสิทธิ์จัดการ ได้ canManage เป็นเท็จ**', async () => {
    expect((await boardOf(member, projectKey)).canManage).toBe(false);
  });
});

describe('F · ร่องรอย', () => {
  /**
   * ทุก mutation ต้องเขียน audit ในทรานแซกชันเดียวกัน (INVARIANT 2) ·
   * **การถอดเพดานก็เป็นการเปลี่ยนแปลง** — เพดานที่หายไปโดยไม่มีใครรู้ว่า
   * ใครถอด คือข้อตกลงของทีมที่ถูกยกเลิกเงียบ ๆ
   */
  it('**ตั้งและถอด เขียน audit ทั้งคู่**', async () => {
    const where = { actorId: leadId ?? 0n, action: { startsWith: 'board.wip_limit' } };
    const before = await prismaClient.auditLog.count({ where });
    await setWipLimit(lead, projectKey, OPEN, 4);
    await setWipLimit(lead, projectKey, OPEN, null);
    const rows = await prismaClient.auditLog.findMany({
      where,
      orderBy: { id: 'asc' },
      select: { action: true },
    });
    expect(rows.length - before).toBe(2);
    expect(rows.map((r) => r.action).slice(-2)).toEqual([
      'board.wip_limit.set',
      'board.wip_limit.clear',
    ]);
  });

  it('ค่าที่ถูกปฏิเสธไม่เขียน audit — ความพยายามที่ไม่เกิดผลไม่ใช่การเปลี่ยนแปลง', async () => {
    const where = { actorId: leadId ?? 0n, action: { startsWith: 'board.wip_limit' } };
    const before = await prismaClient.auditLog.count({ where });
    await expect(setWipLimit(lead, projectKey, OPEN, 0)).rejects.toThrow();
    expect(await prismaClient.auditLog.count({ where })).toBe(before);
  });
});
