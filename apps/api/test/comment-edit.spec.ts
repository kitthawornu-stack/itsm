/**
 * แก้ไขและลบความเห็น — เทสต์เป็นข้อกำหนด
 *
 * `deletedAt` อยู่ในสคีมามาตั้งแต่ Phase 0 และ `listComments` กรองมันอยู่แล้ว
 * **แต่ไม่มีโค้ดเส้นไหนตั้งค่ามันเลย** · `DELETE_COMMENT` ก็อยู่ใน
 * `UNENFORCED_PERMISSIONS` — รูปแบบเดียวกับที่เจอซ้ำมาตลอดโครงการนี้
 *
 * สี่ข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **สิทธิ์ลบ ไม่ใช่สิทธิ์เขียนแทนคนอื่น** — `DELETE_COMMENT` ให้ลบของคนอื่นได้
 *      แต่ไม่มีสิทธิ์ไหนให้แก้ข้อความของคนอื่น · การแก้คำพูดของคนอื่นแล้วให้ยังเป็น
 *      ชื่อเขาอยู่ คือการปลอมบันทึก ซึ่งอันตรายกว่าการลบเพราะไม่มีใครรู้ว่าเกิดขึ้น
 *   2. **ลบแล้วต้องลบสำเนาที่ค้างอยู่ด้วย** — `notification.body` เก็บเนื้อความไว้
 *      ถ้าลบแค่แถวความเห็น ข้อความที่ตั้งใจลบจะยังอ่านได้ในกล่องแจ้งเตือน
 *   3. **แก้แล้วต้องเห็นว่าแก้** — บทสนทนาที่แก้ย้อนหลังได้เงียบ ๆ
 *      ใช้เป็นหลักฐานไม่ได้
 *   4. **บันทึกภายในที่มองไม่เห็น ต้องลบไม่ได้และไม่ยืนยันว่ามีอยู่** —
 *      ไม่งั้นการลองลบทีละ id จะบอกได้ว่า id ไหนเป็นบันทึกภายในที่มีจริง
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  CommentNotFoundError,
  EmptyCommentError,
  NotCommentAuthorError,
  addComment,
  deleteComment,
  editComment,
  listComments,
} from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let projectId: bigint;
let itemId: bigint;
let itemKey: string;

/** ทีมงาน — เห็นบันทึกภายใน และลบความเห็นของคนอื่นได้ */
let lead: TenantContext;
/** ทีมงานอีกคน — เห็นบันทึกภายใน แต่ลบของคนอื่นไม่ได้ */
let agent: TenantContext;
/** ผู้แจ้ง — ไม่เห็นบันทึกภายใน */
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

const bodyOf = async (id: bigint): Promise<string> => {
  const r = await prismaClient.workItemComment.findUniqueOrThrow({
    where: { id },
    select: { body: true },
  });
  return JSON.stringify(r.body);
};

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์ความเห็น ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `CMT${STAMP}`,
      name: `โปรเจกต์ทดสอบความเห็น ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = project.id;

  const mkGroup = async (n: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `cmt-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  leadGroupId = await mkGroup('lead');
  agentGroupId = await mkGroup('agent');
  customerGroupId = await mkGroup('customer');

  const mkUser = async (n: string, groupId: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `cmt-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
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
      // หัวหน้าทีมเท่านั้นที่ลบความเห็นของคนอื่นได้
      { tenantId, schemeId: scheme.id, permission: 'DELETE_COMMENT', groupId: leadGroupId },
      ...common(agentGroupId),
      { tenantId, schemeId: scheme.id, permission: 'VIEW_INTERNAL_COMMENT', groupId: agentGroupId },
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
      itemKey: `CMT${STAMP}-1`,
      issueTypeId: template.issueTypeId,
      statusId: template.statusId,
      reporterId: owner,
      assigneeId: agentId,
      summary: `งานทดสอบความเห็น ${STAMP}`,
      rank: `zzu${STAMP}`,
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
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: `CMT${STAMP}` } }));
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({
      where: { scheme: { name: { contains: STAMP } } },
    }),
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

describe('A · แก้ไขความเห็นของตัวเอง', () => {
  it('**แก้แล้วต้องเห็นว่าแก้**', async () => {
    /*
      บทสนทนาที่แก้ย้อนหลังได้เงียบ ๆ ใช้เป็นหลักฐานไม่ได้ · ผู้แจ้งที่กลับมาอ่าน
      แล้วเจอข้อความไม่เหมือนที่จำได้ ต้องเห็นว่ามันถูกแก้ ไม่ใช่คิดว่าตัวเองจำผิด
    */
    const c = await addComment(agent, { itemKey, body: `ข้อความแรก ${STAMP}` });
    const before = (await listComments(agent, itemKey)).find((r) => r.id === c.id);
    expect(before?.editedAt ?? null).toBeNull();

    await editComment(agent, BigInt(c.id), `แก้แล้ว ${STAMP}`);
    const after = (await listComments(agent, itemKey)).find((r) => r.id === c.id);
    expect(after?.body).toContain('แก้แล้ว');
    expect(after?.editedAt).not.toBeNull();
  });

  it('**ไม่มีใครแก้ข้อความของคนอื่นได้ แม้จะลบของคนอื่นได้**', async () => {
    /*
      `lead` มี `DELETE_COMMENT` · ถ้าสิทธิ์นั้นเปิดทางให้แก้ด้วย หัวหน้าทีม
      จะเขียนคำพูดใส่ปากลูกน้องได้โดยที่ชื่อยังเป็นลูกน้อง — ปลอมบันทึกโดยไม่มี
      ใครรู้ · ข้อความปฏิเสธจึงบอกทางออกที่ถูก ไม่ใช่ให้ไปหาสิทธิ์เพิ่ม
    */
    const c = await addComment(agent, { itemKey, body: `ของ agent ${STAMP}` });
    await expect(editComment(lead, BigInt(c.id), 'ถูกเขียนแทน')).rejects.toThrow(
      NotCommentAuthorError,
    );
    expect(await bodyOf(BigInt(c.id))).toContain('ของ agent');
  });

  it('แก้เป็นข้อความว่างไม่ได้ — ถ้าจะเอาออกให้ลบ', async () => {
    const c = await addComment(agent, { itemKey, body: `จะลองล้าง ${STAMP}` });
    await expect(editComment(agent, BigInt(c.id), '   ')).rejects.toThrow(EmptyCommentError);
    expect(await bodyOf(BigInt(c.id))).toContain('จะลองล้าง');
  });
});

describe('B · ลบความเห็น', () => {
  it('ผู้เขียนลบของตัวเองได้ โดยไม่ต้องมี DELETE_COMMENT', async () => {
    // `agent` ไม่มีสิทธิ์นั้น แต่เป็นคำพูดของเขาเอง
    const c = await addComment(agent, { itemKey, body: `ลบเอง ${STAMP}` });
    await deleteComment(agent, BigInt(c.id));
    expect((await listComments(agent, itemKey)).some((r) => r.id === c.id)).toBe(false);
  });

  it('**ไม่มี DELETE_COMMENT = ลบของคนอื่นไม่ได้**', async () => {
    const c = await addComment(customer, { itemKey, body: `ของลูกค้า ${STAMP}` });
    await expect(deleteComment(agent, BigInt(c.id))).rejects.toThrow(PermissionDeniedError);
    expect((await listComments(agent, itemKey)).some((r) => r.id === c.id)).toBe(true);
  });

  it('มี DELETE_COMMENT = ลบของคนอื่นได้', async () => {
    const c = await addComment(customer, { itemKey, body: `หัวหน้าจะลบ ${STAMP}` });
    await deleteComment(lead, BigInt(c.id));
    expect((await listComments(lead, itemKey)).some((r) => r.id === c.id)).toBe(false);
  });

  it('**ลบแล้วเนื้อความต้องหายจากฐานข้อมูลด้วย ไม่ใช่แค่ถูกกรอง**', async () => {
    /*
      soft delete มีไว้ให้ audit ตอบได้ว่า "เคยมีความเห็นตรงนี้" ไม่ใช่ให้เนื้อความ
      ค้างอยู่ให้ใครก็ตามที่เปิดตารางดูอ่านได้ · เหตุผลที่คนกดลบมักเป็นเพราะ
      ข้อความนั้นไม่ควรมีอยู่ตั้งแต่แรก
    */
    const secret = `รหัสผ่านคือ ${STAMP}`;
    const c = await addComment(agent, { itemKey, body: secret });
    await deleteComment(agent, BigInt(c.id));
    expect(await bodyOf(BigInt(c.id))).not.toContain(STAMP);
  });

  it('**ลบแล้วต้องลบสำเนาที่ค้างในกล่องแจ้งเตือนด้วย**', async () => {
    /*
      `notification.body` เก็บเนื้อความไว้ตอนแจ้ง · ถ้าลบแค่แถวความเห็น
      ข้อความที่ตั้งใจลบจะยังอ่านได้ในกล่องแจ้งเตือนของทุกคนที่ได้รับ
      และคนที่ลบจะเชื่อว่ามันหายแล้ว

      สิ่งที่ลบไม่ได้คืออีเมลที่ส่งออกไปแล้ว — ข้อจำกัดที่ต้องรู้ ไม่ใช่แกล้งว่าไม่มี
    */
    const c = await addComment(agent, { itemKey, body: `เนื้อความที่จะลบ ${STAMP}` });
    const sent = await prismaClient.notification.count({
      where: { dedupeKey: { startsWith: `comment:${c.id}:` } },
    });
    expect(sent).toBeGreaterThan(0);

    await deleteComment(agent, BigInt(c.id));
    const left = await prismaClient.notification.count({
      where: { dedupeKey: { startsWith: `comment:${c.id}:` } },
    });
    expect(left).toBe(0);
  });

  it('ลบซ้ำ ตอบเหมือนไม่พบ และไม่เขียนประวัติเพิ่ม', async () => {
    const c = await addComment(agent, { itemKey, body: `ลบสองครั้ง ${STAMP}` });
    await deleteComment(agent, BigInt(c.id));
    const before = await prismaClient.auditLog.count({ where: { action: 'comment.delete' } });
    await expect(deleteComment(agent, BigInt(c.id))).rejects.toThrow(CommentNotFoundError);
    const after = await prismaClient.auditLog.count({ where: { action: 'comment.delete' } });
    expect(after).toBe(before);
  });
});

describe('C · บันทึกภายใน', () => {
  it('**บันทึกภายในที่มองไม่เห็น ต้องลบไม่ได้และไม่ยืนยันว่ามีอยู่**', async () => {
    /*
      ถ้าตอบ "ไม่มีสิทธิ์" กับ id ที่เป็นบันทึกภายใน และ "ไม่พบ" กับ id ที่ไม่มีจริง
      การลองลบทีละเลขจะบอกได้ว่าเลขไหนเป็นบันทึกภายในที่มีอยู่ — และจำนวนของมัน
      ก็เป็นข้อมูลที่ผู้แจ้งไม่ควรรู้
    */
    const internal = await addComment(lead, {
      itemKey,
      body: `ลูกค้ารายนี้ค้างชำระ ${STAMP}`,
      isInternal: true,
    });
    await expect(deleteComment(customer, BigInt(internal.id))).rejects.toThrow(
      CommentNotFoundError,
    );
    await expect(
      deleteComment(customer, BigInt(999_999_999)),
    ).rejects.toThrow(CommentNotFoundError);
    // ยังอยู่ครบ
    expect(await bodyOf(BigInt(internal.id))).toContain(STAMP);
  });

  it('ผู้เขียนบันทึกภายในลบของตัวเองได้', async () => {
    const c = await addComment(agent, { itemKey, body: `ภายใน ${STAMP}`, isInternal: true });
    await deleteComment(agent, BigInt(c.id));
    expect((await listComments(lead, itemKey)).some((r) => r.id === c.id)).toBe(false);
  });
});

describe('D · หน้าจอรู้ว่ากดอะไรได้', () => {
  it('**แก้ได้เฉพาะของตัวเอง · ลบได้ตามสิทธิ์จริง**', async () => {
    /*
      การซ่อนปุ่มไม่ใช่การป้องกัน — เซิร์ฟเวอร์ปฏิเสธเองทุกครั้ง (เคสข้างบนพิสูจน์แล้ว)
      ค่านี้มีไว้ไม่ให้ผู้ใช้เห็นปุ่มที่กดแล้วได้ 403 เท่านั้น
    */
    const mine = await addComment(agent, { itemKey, body: `ของ agent อีกใบ ${STAMP}` });

    const asAgent = (await listComments(agent, itemKey)).find((r) => r.id === mine.id);
    expect(asAgent?.canEdit).toBe(true);
    expect(asAgent?.canDelete).toBe(true);

    // หัวหน้าทีมลบได้ แต่แก้ไม่ได้ — สองอย่างนี้ตอบคนละคำถาม
    const asLead = (await listComments(lead, itemKey)).find((r) => r.id === mine.id);
    expect(asLead?.canEdit).toBe(false);
    expect(asLead?.canDelete).toBe(true);

    // ลูกค้าทำอะไรกับความเห็นของทีมไม่ได้เลย
    const asCustomer = (await listComments(customer, itemKey)).find((r) => r.id === mine.id);
    expect(asCustomer?.canEdit).toBe(false);
    expect(asCustomer?.canDelete).toBe(false);
  });
});
