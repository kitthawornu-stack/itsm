/**
 * ไฟล์แนบ — ต่อของจริงทั้ง MySQL และ MinIO
 *
 * `attachment-policy.spec.ts` ตรวจกติกาชื่อไฟล์ ชนิด และขนาดแบบบริสุทธิ์
 * · ไฟล์นี้ถามคำถามที่กติกาตอบไม่ได้:
 *
 *   1. **แนบแล้วโหลดกลับได้ไบต์เดิมไหม** — เส้นทาง MinIO ไม่เคยถูกทดสอบเลย
 *   2. **ใครลบได้** — `deleteAttachment` เขียนไว้ตั้งแต่ต้น **โดยไม่มีการตรวจสิทธิ์
 *      สักบรรทัด** และไม่มีอะไรเรียกมันเลย · การต่อ endpoint เข้าไปโดยไม่เพิ่มด่าน
 *      คือการเปิดช่องให้ใครก็ลบไฟล์ของใครก็ได้ในองค์กรเดียวกัน
 *   3. **ลบแล้วไบต์หายจริงไหม** — แถวที่หายแต่ไฟล์ยังอยู่ คือข้อมูลที่ผู้ใช้
 *      คิดว่าลบไปแล้ว
 *
 * เทสต์สร้างงาน ผู้ใช้ และไฟล์ของตัวเองทั้งหมด แล้วลบทิ้ง ไม่แตะข้อมูล seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError, type PermissionKey } from '../src/modules/permission';
import {
  AttachmentNotFoundError,
  deleteAttachment,
  downloadAttachment,
  listAttachments,
  uploadAttachment,
} from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);
const STARTED_AT = new Date();
/** คีย์และชื่อมี stamp เสมอ — ตอนกลไกถูกลบ ค่าที่ "ไม่ควรถูกใช้" จะถูกใช้จริง */
const ITEM_PREFIX = `SD-AT${STAMP}`;
const GROUP_PREFIX = `QA ไฟล์แนบ ${STAMP}`;

let tenantId: bigint;
let projectId: bigint;
/**
 * ผู้ใช้สามคนของเทสต์นี้ — **ไม่ใช้ผู้ใช้ seed สักคน**
 *
 * เพราะสิ่งที่วัดคือกติกาสิทธิ์ ซึ่งขึ้นกับว่าใครอยู่กลุ่มไหน · การยืมผู้ใช้
 * seed มาใช้ทำให้เทสต์พังในวันที่มีคนแก้กลุ่มของผู้ใช้คนนั้น และทำให้เรา
 * อยากไปแก้กลุ่มของเขา ซึ่งเป็นการทำลายข้อมูลร่วม (CLAUDE.md)
 */
let uploaderCtx: TenantContext;
let keeperCtx: TenantContext;
let outsiderCtx: TenantContext;
const userIds: bigint[] = [];
const groupIds: bigint[] = [];
let itemKey = '';

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function attach(ctx: TenantContext, name: string): Promise<string> {
  const r = await uploadAttachment(ctx, {
    itemKey,
    filename: name,
    mimeType: 'text/plain',
    content: Buffer.from(`ทดสอบ ${name} ${STAMP}`, 'utf8'),
  });
  return r.id;
}

/** สร้างกลุ่มของเทสต์พร้อมสิทธิ์ที่ต้องการ แล้วใส่ผู้ใช้หนึ่งคนเข้าไป */
async function member(
  tag: string,
  permissions: PermissionKey[],
  schemeId: bigint,
): Promise<TenantContext> {
  const group = await prismaClient.userGroup.create({
    data: { tenantId, name: `${GROUP_PREFIX} ${tag}` },
    select: { id: true },
  });
  groupIds.push(group.id);
  await prismaClient.permissionGrant.createMany({
    data: permissions.map((permission) => ({ tenantId, schemeId, permission, groupId: group.id })),
  });
  const user = await prismaClient.user.create({
    data: {
      tenantId,
      email: `qa-att-${tag}-${STAMP}@example.invalid`,
      displayName: `QA ${tag} ${STAMP}`,
    },
    select: { id: true },
  });
  userIds.push(user.id);
  await prismaClient.groupMember.create({ data: { tenantId, groupId: group.id, userId: user.id } });
  return { tenantId, actorId: user.id };
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  const project = await prismaClient.project.findFirstOrThrow({
    where: { key: 'SD' },
    select: { id: true, permissionSchemeId: true, },
  });
  projectId = project.id;
  const schemeId = project.permissionSchemeId;
  if (schemeId === null) throw new Error('โปรเจกต์ SD ไม่มีชุดสิทธิ์ — เทสต์นี้ตรวจอะไรไม่ได้');

  /*
    **ไม่มีกลุ่มไหนในข้อมูลตั้งต้นได้ `MANAGE_ATTACHMENT` เลย** (ตรวจแล้วเมื่อ
    2569-08-30) — สิทธิ์นี้จึงยังไม่ให้อะไรกับใครในทางปฏิบัติ · เทสต์สร้างกลุ่ม
    ของตัวเองที่ได้สิทธิ์นี้ เพื่อพิสูจน์ว่าเมื่อผู้ดูแลให้จริง มันทำงาน
  */
  uploaderCtx = await member('ผู้แนบ', ['BROWSE_PROJECT', 'EDIT_ITEM'], schemeId);
  keeperCtx = await member('ผู้ดูแลไฟล์', ['BROWSE_PROJECT', 'MANAGE_ATTACHMENT'], schemeId);
  outsiderCtx = await member('คนดูอย่างเดียว', ['BROWSE_PROJECT'], schemeId);

  const template = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId },
    select: { issueTypeId: true },
  });
  const todo = await prismaClient.workflowStatus.findFirstOrThrow({
    where: { category: 'TODO', workflow: { schemes: { some: { tenantId } } } },
    select: { id: true },
  });
  const w = await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey: `${ITEM_PREFIX}A`,
      issueTypeId: template.issueTypeId,
      statusId: todo.id,
      reporterId: userIds[0] ?? BigInt(0),
      summary: `[ไฟล์แนบ] ทดสอบ ${STAMP}`,
      rank: `zzn${STAMP}`,
    },
    select: { itemKey: true },
  });
  itemKey = w.itemKey;
}, 120_000);

afterAll(async () => {
  /*
    ลบ **ทุกแถวที่เกิดในช่วงเทสต์** ไม่ใช่เฉพาะที่จำ id ไว้

    เคส "คนอื่นลบไม่ได้" ไม่ควรลบอะไร · แต่ตอนถอดด่านสิทธิ์เพื่อพิสูจน์ว่า
    เทสต์แดงได้ มันจะลบจริง — รายการที่จำไว้ตอนเขียนไม่ครอบสิ่งที่เกิด
    ตอนกลไกหายไป
  */
  await step('ไฟล์แนบของเทสต์', () =>
    prismaClient.workItemAttachment.deleteMany({
      where: { workItem: { itemKey: { startsWith: ITEM_PREFIX } } },
    }),
  );
  await step('ประวัติของงานเทสต์', () =>
    prismaClient.workItemHistory.deleteMany({
      where: { workItem: { itemKey: { startsWith: ITEM_PREFIX } } },
    }),
  );
  await step('งานของเทสต์', () =>
    prismaClient.workItem.deleteMany({ where: { itemKey: { startsWith: ITEM_PREFIX } } }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({
      where: { action: { startsWith: 'workitem.attachment.' }, createdAt: { gte: STARTED_AT } },
    }),
  );
  /*
    ลำดับสำคัญ: สมาชิก → grant → กลุ่ม → ผู้ใช้ · และลบ **ตาม id ที่จับมาเอง**
    ไม่ใช่ตามชื่อ เพราะชื่ออาจถูกแก้ระหว่างเทสต์ตอนกลไกหายไป
  */
  await step('สมาชิกกลุ่มของเทสต์', () =>
    prismaClient.groupMember.deleteMany({ where: { groupId: { in: groupIds } } }),
  );
  await step('สิทธิ์ที่เทสต์ให้ไว้', () =>
    prismaClient.permissionGrant.deleteMany({ where: { groupId: { in: groupIds } } }),
  );
  await step('กลุ่มของเทสต์', () =>
    prismaClient.userGroup.deleteMany({ where: { id: { in: groupIds } } }),
  );
  await step('ผู้ใช้ของเทสต์', () =>
    prismaClient.user.deleteMany({ where: { id: { in: userIds } } }),
  );

  const left = await prismaClient.workItemAttachment.count({
    where: { workItem: { itemKey: { startsWith: ITEM_PREFIX } } },
  });
  if (left > 0) console.error(`เหลือไฟล์แนบของเทสต์ค้างอยู่ ${String(left)} ไฟล์`);
  const grantsLeft = await prismaClient.permissionGrant.count({
    where: { groupId: { in: groupIds } },
  });
  if (grantsLeft > 0) console.error(`เหลือสิทธิ์ที่เทสต์ให้ไว้ ${String(grantsLeft)} รายการ`);
  await prismaClient.$disconnect();
});

// ============================================================

describe('ไฟล์แนบ · A · แนบแล้วโหลดกลับได้', () => {
  it('แนบแล้วขึ้นในรายการ', async () => {
    await attach(uploaderCtx, `ภาพหน้าจอ-${STAMP}.txt`);
    const rows = await listAttachments(uploaderCtx, itemKey);
    expect(rows.map((r) => r.filename)).toContain(`ภาพหน้าจอ-${STAMP}.txt`);
  });

  /** เส้นทาง MinIO ไม่เคยถูกทดสอบเลย — ไบต์ที่กลับมาต้องเหมือนที่ส่งไป */
  it('โหลดกลับได้ไบต์เดิมเป๊ะ รวมข้อความไทย', async () => {
    const id = await attach(uploaderCtx, `เอกสาร-${STAMP}.txt`);
    const got = await downloadAttachment(uploaderCtx, BigInt(id));
    expect(got.content.toString('utf8')).toBe(`ทดสอบ เอกสาร-${STAMP}.txt ${STAMP}`);
  });

  it('ไฟล์ที่ไม่มีอยู่ให้ error ที่บอกได้ว่าไม่พบ ไม่ใช่ระเบิด', async () => {
    await expect(downloadAttachment(uploaderCtx, BigInt('999999999'))).rejects.toThrow(
      AttachmentNotFoundError,
    );
  });
});

describe('ไฟล์แนบ · B · ใครลบได้', () => {
  /**
   * ด่านนี้ไม่เคยมีมาก่อน
   *
   * `deleteAttachment` เขียนไว้ครบตั้งแต่ต้นโดยไม่ตรวจสิทธิ์อะไรเลย และรอด
   * มาได้เพราะ **ไม่มีอะไรเรียกมัน** · วันที่ต่อ endpoint เข้าไป มันจะกลายเป็น
   * ช่องโหว่ทันทีโดยไม่มีอะไรในไฟล์นั้นเปลี่ยนเลย — รูปแบบเดียวกับ `listComments`
   * ที่รับ `viewer` จาก query string (CLAUDE.md)
   */
  it('เจ้าของลบไฟล์ของตัวเองได้', async () => {
    const id = await attach(uploaderCtx, `ของฉัน-${STAMP}.txt`);
    await deleteAttachment(uploaderCtx, BigInt(id));
    const rows = await listAttachments(uploaderCtx, itemKey);
    expect(rows.map((r) => r.id)).not.toContain(id);
  });

  it('คนที่ดูได้อย่างเดียว ลบไฟล์ของคนอื่นไม่ได้', async () => {
    const id = await attach(uploaderCtx, `ห้ามแตะ-${STAMP}.txt`);
    await expect(deleteAttachment(outsiderCtx, BigInt(id))).rejects.toThrow(PermissionDeniedError);
    // และต้องยังอยู่จริง ไม่ใช่แค่โยน error หลังลบไปแล้ว
    expect(
      await prismaClient.workItemAttachment.count({ where: { id: BigInt(id) } }),
    ).toBe(1);
  });

  it('คนที่ได้สิทธิ์จัดการไฟล์แนบ ลบของคนอื่นได้', async () => {
    const id = await attach(uploaderCtx, `ผู้ดูแลลบได้-${STAMP}.txt`);
    await deleteAttachment(keeperCtx, BigInt(id));
    expect(await prismaClient.workItemAttachment.count({ where: { id: BigInt(id) } })).toBe(0);
  });

  /**
   * `EDIT_ITEM` ให้แนบได้ แต่ไม่ให้ลบของคนอื่น
   *
   * ตั้งใจให้ต่างกัน — การลบหลักฐานที่คนอื่นแนบไว้หนักกว่าการแนบเพิ่ม
   * และกู้กลับไม่ได้ · ถ้าให้สิทธิ์เดียวกันคุมทั้งสองอย่าง คนที่ได้สิทธิ์แก้งาน
   * จะลบไฟล์ของใครก็ได้โดยไม่มีใครตั้งใจให้เป็นแบบนั้น
   */
  it('สิทธิ์แก้งานอย่างเดียว ลบไฟล์ของคนอื่นไม่ได้', async () => {
    const id = await attach(keeperCtx, `ของผู้ดูแลไฟล์-${STAMP}.txt`);
    await expect(deleteAttachment(uploaderCtx, BigInt(id))).rejects.toThrow(PermissionDeniedError);
    expect(await prismaClient.workItemAttachment.count({ where: { id: BigInt(id) } })).toBe(1);
  });

  it('ลบไฟล์ที่ไม่มีอยู่ ได้ error ว่าไม่พบ', async () => {
    await expect(deleteAttachment(uploaderCtx, BigInt('999999999'))).rejects.toThrow(
      AttachmentNotFoundError,
    );
  });
});

describe('ไฟล์แนบ · C · สิ่งที่หน้าจอใช้ตัดสินใจ', () => {
  /** ผู้แนบไม่มี `MANAGE_ATTACHMENT` — ธงที่เป็นจริงจึงมาจากความเป็นเจ้าของล้วน ๆ */
  it('เจ้าของเห็น canDelete เป็นจริงสำหรับไฟล์ของตัวเอง', async () => {
    const id = await attach(uploaderCtx, `ของผู้แนบเอง-${STAMP}.txt`);
    const seen = (await listAttachments(uploaderCtx, itemKey)).find((r) => r.id === id);
    expect(seen?.canDelete).toBe(true);
  });

  it('คนที่ได้สิทธิ์จัดการไฟล์แนบ เห็น canDelete เป็นจริงแม้เป็นไฟล์ของคนอื่น', async () => {
    const id = await attach(uploaderCtx, `ผู้ดูแลเห็น-${STAMP}.txt`);
    const seen = (await listAttachments(keeperCtx, itemKey)).find((r) => r.id === id);
    expect(seen?.canDelete).toBe(true);
  });

  it('คนที่ไม่มีสิทธิ์ เห็น canDelete เป็นเท็จสำหรับไฟล์ของคนอื่น', async () => {
    const id = await attach(uploaderCtx, `ของผู้ดูแล-${STAMP}.txt`);
    const seen = (await listAttachments(outsiderCtx, itemKey)).find((r) => r.id === id);
    expect(seen?.canDelete).toBe(false);
  });

  /**
   * ธงบนหน้าจอต้องตรงกับสิ่งที่เซิร์ฟเวอร์ทำจริง
   *
   * ธงที่บอกว่าลบได้แต่กดแล้ว 403 กับธงที่บอกว่าลบไม่ได้แต่ API ยอมให้ลบ
   * ผิดคนละแบบ · อย่างหลังคือช่องโหว่ อย่างแรกคือหน้าจอที่ทำให้คนเลิกเชื่อ
   */
  it('canDelete ที่เป็นเท็จ ต้องแปลว่าเซิร์ฟเวอร์ปฏิเสธจริง', async () => {
    const id = await attach(uploaderCtx, `ตรงกัน-${STAMP}.txt`);
    const seen = (await listAttachments(outsiderCtx, itemKey)).find((r) => r.id === id);
    expect(seen?.canDelete).toBe(false);
    await expect(deleteAttachment(outsiderCtx, BigInt(id))).rejects.toThrow(PermissionDeniedError);
  });
});

describe('ไฟล์แนบ · D · ลบแล้วไบต์หายด้วย', () => {
  it('ลบแล้วโหลดไม่ได้อีก', async () => {
    const id = await attach(uploaderCtx, `จะลบ-${STAMP}.txt`);
    await deleteAttachment(uploaderCtx, BigInt(id));
    await expect(downloadAttachment(uploaderCtx, BigInt(id))).rejects.toThrow(AttachmentNotFoundError);
  });

  it('ลบแล้วมีร่องรอยในประวัติของงาน', async () => {
    const id = await attach(uploaderCtx, `มีร่องรอย-${STAMP}.txt`);
    await deleteAttachment(uploaderCtx, BigInt(id));
    const rows = await prismaClient.workItemHistory.findMany({
      where: { workItem: { itemKey }, field: '__attachment_deleted__' },
      select: { oldValue: true },
    });
    expect(rows.map((r) => r.oldValue)).toContain(`มีร่องรอย-${STAMP}.txt`);
  });
});
