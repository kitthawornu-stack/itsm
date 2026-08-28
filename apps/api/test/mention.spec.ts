/**
 * การกล่าวถึงในความเห็น — เทสต์เป็นข้อกำหนด (ส่วนที่แตะฐานข้อมูล)
 *
 * `src/modules/workitem/mention.spec.ts` ทดสอบตรรกะบริสุทธิ์ · ไฟล์นี้ทดสอบ
 * สิ่งที่ต้องมีฐานข้อมูลจริงถึงจะพิสูจน์ได้ — **การตรวจสิทธิ์ตอนส่ง**
 *
 * สามข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **id ที่ส่งมาโดยไม่มีชื่อในข้อความ ต้องถูกทิ้ง** — หน้าจอส่งรายการ id
 *      มาพร้อมข้อความ · ถ้าเซิร์ฟเวอร์เชื่อตรง ๆ ใครก็ส่ง id ใครก็ได้มาพร้อม
 *      ข้อความที่ไม่มีชื่อเขา แล้วคนคนนั้นได้แจ้งเตือนว่าถูกเรียก แต่เปิดเข้าไป
 *      หาไม่เจอว่าใครเรียก — การแจ้งเตือนชนิดนี้จะเชื่อถือไม่ได้ทั้งชนิด
 *   2. **เรียกคนที่เปิดเรื่องไม่ได้ ต้องไม่ส่ง** — การแจ้งเตือนพกหัวข้อกับ
 *      เนื้อความไปด้วย จึงรั่วโดยที่ผู้เรียกไม่ต้องมีสิทธิ์อะไรเลย
 *   3. **คนที่ถูกเรียกและเป็นผู้รับผิดชอบด้วย ได้ใบเดียว แบบที่บอกว่าถูกเรียก** —
 *      "มีความเห็นใหม่" เป็นข้อความที่เขาเห็นทุกวันจนเลิกอ่าน
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { addComment } from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let projectId: bigint;
let itemId: bigint;
let itemKey: string;

/** หัวหน้าทีม — เห็นบันทึกภายใน */
let lead: TenantContext;
/** ผู้รับผิดชอบของงานใบนี้ */
let agent: TenantContext;
/** ผู้แจ้ง — เปิดเรื่องได้ แต่ไม่เห็นบันทึกภายใน */
let customer: TenantContext;
let leadId: bigint | undefined;
let agentId: bigint | undefined;
let customerId: bigint | undefined;
let leadGroupId: bigint | undefined;
let agentGroupId: bigint | undefined;
let customerGroupId: bigint | undefined;

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

/** แจ้งเตือนที่ผู้ใช้คนหนึ่งได้รับจากเรื่องนี้ */
const inboxOf = async (
  userId: bigint | undefined,
): Promise<Array<{ kind: string; title: string }>> => {
  if (userId === undefined) return [];
  return prismaClient.notification.findMany({
    where: { userId, workItemId: itemId },
    select: { kind: true, title: true },
  });
};

/** ชื่อที่แสดงจริงของผู้ใช้ — ประกอบข้อความ `@ชื่อ` ให้ตรงกับของจริง */
const nameOf = async (userId: bigint | undefined): Promise<string> => {
  if (userId === undefined) return '';
  const u = await prismaClient.user.findUniqueOrThrow({
    where: { id: userId },
    select: { displayName: true },
  });
  return u.displayName;
};

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  /*
    โปรเจกต์และชุดสิทธิ์ของตัวเอง — ต้องคุมได้ว่าใครเห็นอะไร เพราะข้อที่ทดสอบ
    คือ "เรียกคนที่ไม่มีสิทธิ์แล้วต้องไม่ส่ง" ซึ่งแตะชุดสิทธิ์ของ seed ไม่ได้
  */
  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์กล่าวถึง ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `MEN${STAMP}`,
      name: `โปรเจกต์ทดสอบกล่าวถึง ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = project.id;

  const mkGroup = async (n: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `men-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  leadGroupId = await mkGroup('lead');
  agentGroupId = await mkGroup('agent');
  customerGroupId = await mkGroup('customer');

  const mkUser = async (n: string, groupId: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `men-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n} ${STAMP}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  leadId = await mkUser('lead', leadGroupId);
  agentId = await mkUser('agent', agentGroupId);
  customerId = await mkUser('customer', customerGroupId);

  const common = (groupId: bigint | undefined): Array<Record<string, unknown>> => [
    { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId },
    { tenantId, schemeId: scheme.id, permission: 'ADD_COMMENT', groupId },
  ];
  await prismaClient.permissionGrant.createMany({
    data: [
      ...common(leadGroupId),
      { tenantId, schemeId: scheme.id, permission: 'VIEW_INTERNAL_COMMENT', groupId: leadGroupId },
      ...common(agentGroupId),
      { tenantId, schemeId: scheme.id, permission: 'VIEW_INTERNAL_COMMENT', groupId: agentGroupId },
      // ผู้แจ้ง: เปิดเรื่องได้ แต่ไม่เห็นบันทึกภายใน
      ...common(customerGroupId),
    ] as never,
  });

  lead = { tenantId, actorId: leadId };
  agent = { tenantId, actorId: agentId };
  customer = { tenantId, actorId: customerId };

  const template = await prismaClient.workItem.findFirstOrThrow({
    select: { issueTypeId: true, statusId: true },
  });
  const owner = customerId;
  const item = await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey: `MEN${STAMP}-1`,
      issueTypeId: template.issueTypeId,
      statusId: template.statusId,
      reporterId: owner,
      assigneeId: agentId,
      summary: `งานทดสอบกล่าวถึง ${STAMP}`,
      rank: `zzt${STAMP}`,
    },
    select: { id: true, itemKey: true },
  });
  itemId = item.id;
  itemKey = item.itemKey;
}, 180_000);

afterAll(async () => {
  const owners = [leadId, agentId, customerId].filter((v): v is bigint => v !== undefined);
  await step('แจ้งเตือน', () =>
    prismaClient.notification.deleteMany({ where: { workItemId: itemId } }),
  );
  await step('ความเห็น', () =>
    prismaClient.workItemComment.deleteMany({ where: { workItemId: itemId } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { actorId: { in: owners } } }),
  );
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actorId: { in: owners } } }));
  await step('งานทดสอบ', () => prismaClient.workItem.deleteMany({ where: { itemKey } }));
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: `MEN${STAMP}` } }));
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

describe('A · ชื่อต้องอยู่ในข้อความจริง', () => {
  it('**ส่ง id มาโดยไม่มีชื่อในข้อความ = ไม่มีใครถูกเรียก**', async () => {
    /*
      เคสที่สำคัญที่สุดของไฟล์นี้ · ถ้าเซิร์ฟเวอร์เชื่อรายการที่หน้าจอส่งมาตรง ๆ
      ใครก็ส่ง id ใครก็ได้มาพร้อมข้อความที่ไม่มีชื่อเขา แล้วคนคนนั้นได้แจ้งเตือน
      ว่าถูกเรียก แต่เปิดเข้าไปหาไม่เจอว่าใครเรียกและเรื่องอะไร
    */
    await prismaClient.notification.deleteMany({ where: { workItemId: itemId } });
    await addComment(agent, {
      itemKey,
      body: `ไม่ได้เรียกใคร ${STAMP}`,
      mentions: [String(leadId ?? '')],
    });
    expect((await inboxOf(leadId)).some((n) => n.kind === 'comment.mention')).toBe(false);
  });

  it('เรียกด้วยชื่อจริง = ได้รับ และพาดหัวบอกว่าถูกเรียก', async () => {
    await prismaClient.notification.deleteMany({ where: { workItemId: itemId } });
    const name = await nameOf(leadId);
    await addComment(agent, {
      itemKey,
      body: `@${name} ช่วยดูให้หน่อยครับ ${STAMP}`,
      mentions: [String(leadId ?? '')],
    });
    const got = await inboxOf(leadId);
    expect(got.some((n) => n.kind === 'comment.mention')).toBe(true);
    expect(got.find((n) => n.kind === 'comment.mention')?.title).toContain('เรียกถึงคุณ');
  });

  it('เรียกตัวเองไม่ได้แจ้งเตือน', async () => {
    // ไม่มีใครอยากได้แจ้งเตือนบอกว่าตัวเองเพิ่งเรียกตัวเอง
    await prismaClient.notification.deleteMany({ where: { workItemId: itemId } });
    const name = await nameOf(agentId);
    await addComment(agent, {
      itemKey,
      body: `@${name} จดไว้เอง ${STAMP}`,
      mentions: [String(agentId ?? '')],
    });
    expect(await inboxOf(agentId)).toHaveLength(0);
  });

  it('id ที่ไม่ใช่ตัวเลข ไม่ทำให้ทั้งความเห็นล้ม', async () => {
    // ค่าที่พังบนคำขอไม่ควรทำให้ข้อความที่ผู้ใช้พิมพ์หายไป
    const c = await addComment(agent, {
      itemKey,
      body: `ข้อความยังต้องบันทึก ${STAMP}`,
      mentions: ['ไม่ใช่ตัวเลข', ''],
    });
    expect(c.id).not.toBe('');
  });
});

describe('B · สิทธิ์ตรวจตอนส่ง', () => {
  it('**เรียกคนที่เปิดเรื่องไม่ได้ ต้องไม่ส่ง**', async () => {
    /*
      ผู้ใช้ที่ไม่อยู่กลุ่มไหนเลย — เปิดโปรเจกต์นี้ไม่ได้ · การแจ้งเตือนพกหัวข้อ
      กับเนื้อความไปด้วย จึงรั่วโดยที่ผู้เรียกไม่ต้องมีสิทธิ์อะไรเลย
    */
    const outsider = await prismaClient.user.create({
      data: { tenantId, email: `men-out-${STAMP}@example.test`, displayName: `คนนอก ${STAMP}` },
      select: { id: true, displayName: true },
    });
    try {
      await prismaClient.notification.deleteMany({ where: { workItemId: itemId } });
      await addComment(agent, {
        itemKey,
        body: `@${outsider.displayName} ช่วยดูหน่อย`,
        mentions: [outsider.id.toString()],
      });
      expect(await inboxOf(outsider.id)).toHaveLength(0);
    } finally {
      /*
        เก็บกวาดทุกแถวที่จับมา รวมแถวที่คาดว่าจะไม่ถูกสร้าง — เพราะตอนกลไก
        ถูกลบออกเพื่อพิสูจน์ว่าเทสต์แดงได้ แถวนั้นจะถูกสร้างจริง (CLAUDE.md §9)
      */
      await prismaClient.notification.deleteMany({ where: { userId: outsider.id } });
      await prismaClient.user.delete({ where: { id: outsider.id } });
    }
  });

  it('**เรียกผู้แจ้งในบันทึกภายใน ต้องไม่ส่ง**', async () => {
    /*
      ผู้แจ้งเปิดเรื่องได้ แต่ไม่มี `VIEW_INTERNAL_COMMENT` · ถ้าการกล่าวถึง
      ไม่ตรวจชั้นนี้ เนื้อความที่ทีมคุยกันเองจะไปโผล่ในกล่องของลูกค้า
      ทั้งที่คนเขียนตั้งใจให้เป็นบันทึกภายในแท้ ๆ
    */
    await prismaClient.notification.deleteMany({ where: { workItemId: itemId } });
    const name = await nameOf(customerId);
    await addComment(lead, {
      itemKey,
      body: `@${name} รายนี้ค้างชำระ ${STAMP}`,
      isInternal: true,
      mentions: [String(customerId ?? '')],
    });
    expect(await inboxOf(customerId)).toHaveLength(0);
  });
});

describe('C · ไม่ส่งซ้ำ และใบที่แรงกว่าชนะ', () => {
  it('**ถูกเรียกและเป็นผู้รับผิดชอบด้วย ได้ใบเดียว แบบที่บอกว่าถูกเรียก**', async () => {
    /*
      `agent` เป็นผู้รับผิดชอบของงานใบนี้ · ถ้าเติมการกล่าวถึงทีหลัง
      ตัวกันซ้ำจะทิ้งใบที่แรงกว่าและเก็บใบ "มีความเห็นใหม่" ไว้แทน
      ซึ่งเป็นข้อความที่เขาเห็นทุกวันจนเลิกอ่าน
    */
    await prismaClient.notification.deleteMany({ where: { workItemId: itemId } });
    const name = await nameOf(agentId);
    await addComment(customer, {
      itemKey,
      body: `@${name} ยังไม่ได้รับเครื่องเลยครับ ${STAMP}`,
      mentions: [String(agentId ?? '')],
    });
    const got = await inboxOf(agentId);
    expect(got).toHaveLength(1);
    expect(got[0]?.kind).toBe('comment.mention');
  });
});
