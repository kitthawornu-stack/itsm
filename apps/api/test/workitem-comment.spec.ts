/**
 * ความเห็นบนงาน — เทสต์เป็นข้อกำหนด
 *
 * เคสที่สำคัญที่สุดคือ **ความเห็นภายในต้องไม่หลุดออกจาก service**
 * ไม่ใช่ "ไม่แสดงบนหน้าจอ" — ถ้าส่งออกไปแล้วให้ UI ซ่อน ใครเปิด DevTools ก็เห็น
 * (INVARIANT 3 · สิทธิ์ระดับฟิลด์ต้องตรวจก่อน serialize)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { auditedTransaction } from '../src/infrastructure/audit/audited-transaction';
import { EmptyCommentError, addComment, listComments } from '../src/modules/workitem/comment.service';
import { WorkItemNotFoundError, createWorkItem } from '../src/modules/workitem/workitem.service';

let ctx: TenantContext;
/** อยู่กลุ่ม IT Support → มีสิทธิ์ VIEW_INTERNAL_COMMENT */
let staffCtx: TenantContext;
/** ไม่อยู่กลุ่มที่มีสิทธิ์นั้น → คือผู้ใช้ทั่วไปที่แจ้งเรื่องเข้ามา */
let plainCtx: TenantContext;
let tenantId: bigint;
let itGroupId: bigint;
let itemKey: string;
const createdIds: bigint[] = [];

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirst({ where: { key: 'default' } });
  if (tenant === null) {
    throw new Error('ยังไม่มีข้อมูล seed — รัน `pnpm --filter @itsm/api seed` ก่อน');
  }
  const actor = await prismaClient.user.findFirstOrThrow({
    where: { tenantId: tenant.id, isSystem: false },
    orderBy: { id: 'asc' },
  });
  ctx = { tenantId: tenant.id, actorId: actor.id };
  tenantId = tenant.id;

  const itGroup = await prismaClient.userGroup.findFirstOrThrow({
    where: { tenantId: tenant.id, name: 'IT Support' },
  });
  itGroupId = itGroup.id;

  const staff = await prismaClient.groupMember.findFirstOrThrow({
    where: { groupId: itGroup.id },
    select: { userId: true },
  });
  staffCtx = { tenantId: tenant.id, actorId: staff.userId };

  const staffIds = (
    await prismaClient.groupMember.findMany({
      where: { groupId: itGroup.id },
      select: { userId: true },
    })
  ).map((m) => m.userId);
  const plain = await prismaClient.user.findFirstOrThrow({
    where: { tenantId: tenant.id, isSystem: false, id: { notIn: staffIds } },
    orderBy: { id: 'asc' },
  });
  plainCtx = { tenantId: tenant.id, actorId: plain.id };

  const created = await createWorkItem(ctx, {
    projectKey: 'SD',
    issueTypeName: 'Incident',
    summary: 'งานสำหรับทดสอบความเห็น',
  });
  createdIds.push(created.id);
  itemKey = created.itemKey;
});

afterAll(async () => {
  await prismaClient.notificationDelivery.deleteMany({
    where: { notification: { workItemId: { in: createdIds } } },
  });
  await prismaClient.notification.deleteMany({ where: { workItemId: { in: createdIds } } });
  await prismaClient.workItemComment.deleteMany({ where: { workItemId: { in: createdIds } } });
  await prismaClient.slaEvent.deleteMany({ where: { sla: { workItemId: { in: createdIds } } } });
  await prismaClient.workItemSla.deleteMany({ where: { workItemId: { in: createdIds } } });
  await prismaClient.workItemHistory.deleteMany({ where: { workItemId: { in: createdIds } } });
  await prismaClient.workItem.deleteMany({ where: { id: { in: createdIds } } });
  await prismaClient.$disconnect();
});

describe('addComment', () => {
  it('เขียนความเห็นแล้วอ่านกลับมาได้', async () => {
    const c = await addComment(ctx, { itemKey, body: 'ลองรีสตาร์ตเราเตอร์ดูหรือยังครับ' });
    expect(c.body).toBe('ลองรีสตาร์ตเราเตอร์ดูหรือยังครับ');
    expect(c.isInternal).toBe(false);
    expect(c.author.length).toBeGreaterThan(0);
  });

  it('เก็บเป็น structured document ไม่ใช่สตริงดิบ', async () => {
    const c = await addComment(ctx, { itemKey, body: 'ตรวจสอบ log แล้ว' });
    const row = await prismaClient.workItemComment.findFirstOrThrow({
      where: { id: BigInt(c.id) },
    });
    expect(row.body).toEqual({ format: 'text', text: 'ตรวจสอบ log แล้ว' });
  });

  it('เขียนประวัติในทรานแซกชันเดียวกัน (INVARIANT 2)', async () => {
    const before = await prismaClient.workItemHistory.count({
      where: { workItemId: createdIds[0] },
    });
    await addComment(ctx, { itemKey, body: 'อัปเดตความคืบหน้า' });
    const after = await prismaClient.workItemHistory.count({
      where: { workItemId: createdIds[0] },
    });
    expect(after).toBe(before + 1);
  });

  it('**ประวัติไม่เก็บเนื้อความ** — ไม่งั้นความเห็นภายในรั่วผ่านไทม์ไลน์', async () => {
    const secret = 'ห้ามให้ผู้แจ้งเห็นข้อความนี้เด็ดขาด';
    await addComment(ctx, { itemKey, body: secret, isInternal: true });
    const rows = await prismaClient.workItemHistory.findMany({
      where: { workItemId: createdIds[0] },
    });
    // JSON.stringify ตรง ๆ ไม่ได้ เพราะแถวมี BigInt — ต่อเฉพาะช่องที่เก็บข้อความ
    const all = rows.map((r) => `${r.field}|${r.oldValue ?? ''}|${r.newValue ?? ''}`).join(' ');
    expect(all).not.toContain(secret);
  });

  it('ความเห็นว่างถูกปฏิเสธ — ไม่ใช่บันทึกแถวเปล่า', async () => {
    await expect(addComment(ctx, { itemKey, body: '   ' })).rejects.toThrow(EmptyCommentError);
  });

  it('งานที่ไม่มีอยู่ถูกปฏิเสธ', async () => {
    await expect(addComment(ctx, { itemKey: 'SD-999999', body: 'x' })).rejects.toThrow(
      WorkItemNotFoundError,
    );
  });
});

describe('listComments · INVARIANT 3 · สิทธิ์จริง ไม่ใช่พารามิเตอร์', () => {
  /**
   * เคสสำคัญที่สุดของทั้งไฟล์
   *
   * เดิม `listComments` รับ `viewer` มาจากผู้เรียก และ controller ก็รับต่อมาจาก
   * `?view=` บน URL · วัดจริงกับระบบที่รันอยู่: ล็อกอินเป็นผู้ใช้ทั่วไปแล้วเรียก
   * `/comments` **อ่านบันทึกภายในได้ครบทุกฉบับ** รวมถึงข้อความอย่าง
   * "อย่าเพิ่งบอกลูกค้า" และ "ลูกค้ารายนี้ค้างชำระอยู่"
   *
   * ตอนนี้ตัดสินจากสิทธิ์ VIEW_INTERNAL_COMMENT บนโปรเจกต์ของงานใบนั้น
   */
  it('**ผู้ใช้ทั่วไปไม่เห็นบันทึกภายใน** แม้เรียก service ตรง ๆ', async () => {
    const rows = await listComments(plainCtx, itemKey);
    expect(rows.every((c) => !c.isInternal)).toBe(true);
    expect(rows.map((c) => c.body).join(' ')).not.toContain('ห้ามให้ผู้แจ้งเห็น');
  });

  it('ทีมที่มีสิทธิ์เห็นทั้งหมด รวมบันทึกภายใน', async () => {
    const rows = await listComments(staffCtx, itemKey);
    expect(rows.some((c) => c.isInternal)).toBe(true);
  });

  it('ผู้ใช้ทั่วไปเห็นน้อยกว่าทีมเสมอเมื่อมีบันทึกภายใน', async () => {
    const staff = await listComments(staffCtx, itemKey);
    const plain = await listComments(plainCtx, itemKey);
    expect(plain.length).toBeLessThan(staff.length);
  });

  it('ถอดคนออกจากกลุ่มแล้วเห็นบันทึกภายในไม่ได้ทันที', async () => {
    // สิทธิ์มาจากกลุ่ม ไม่ใช่จากบทบาทที่ฝังในบัญชี — ถอดออกต้องมีผลทันที
    const before = await listComments(staffCtx, itemKey);
    expect(before.some((c) => c.isInternal)).toBe(true);

    await prismaClient.groupMember.deleteMany({
      where: { userId: staffCtx.actorId as bigint, groupId: itGroupId },
    });
    const after = await listComments(staffCtx, itemKey);
    expect(after.some((c) => c.isInternal)).toBe(false);

    await prismaClient.groupMember.create({
      data: { tenantId, groupId: itGroupId, userId: staffCtx.actorId as bigint },
    });
  });

  it('เรียงตามเวลาจากเก่าไปใหม่ — บทสนทนาต้องอ่านจากบนลงล่าง', async () => {
    const rows = await listComments(staffCtx, itemKey);
    const ids = rows.map((r) => BigInt(r.id));
    expect([...ids].sort((x, y) => (x < y ? -1 : 1))).toEqual(ids);
  });

  it('ความเห็นที่ถูกลบไม่ถูกส่งออก แต่ยังอยู่ในฐานข้อมูล', async () => {
    const c = await addComment(ctx, { itemKey, body: 'พิมพ์ผิด ขอลบ' });
    await prismaClient.workItemComment.update({
      where: { id: BigInt(c.id) },
      data: { deletedAt: new Date() },
    });
    const rows = await listComments(staffCtx, itemKey);
    expect(rows.some((r) => r.id === c.id)).toBe(false);
    // soft delete — audit ต้องยังตอบได้ว่าเคยมี
    expect(
      await prismaClient.workItemComment.findFirst({ where: { id: BigInt(c.id) } }),
    ).not.toBeNull();
  });
});

describe('แจ้งเตือนเมื่อมีความเห็น', () => {
  const notifsFor = async (commentId: string) =>
    prismaClient.notification.findMany({
      where: { dedupeKey: { startsWith: `comment:${commentId}:` } },
    });

  it('ทีมตอบ → ผู้แจ้งได้รับแจ้งเตือน', async () => {
    const c = await addComment(ctx, { itemKey, body: 'กำลังดำเนินการให้อยู่ครับ' });
    const rows = await notifsFor(c.id);
    // ผู้เขียนคือ actor ซึ่งเป็นผู้แจ้งของงานนี้ด้วย จึงไม่แจ้งตัวเอง
    // งานยังไม่มีผู้รับผิดชอบ → แจ้งระดับทีม
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.kind === 'comment.added')).toBe(true);
  });

  it('ตรวจก่อนเขียน — หัวข้อว่างไม่แตะฐานข้อมูลเลย', async () => {
    // หมายเหตุ: เคสนี้ **ไม่ได้** พิสูจน์ขอบเขตทรานแซกชัน เพราะการตรวจข้อความว่าง
    // เกิดก่อนเปิดทรานแซกชัน · การพิสูจน์ว่า notification ย้อนกลับพร้อมความเห็น
    // อยู่ในเคส "ย้อนกลับพร้อมกัน" ข้างล่าง ซึ่งบังคับให้ล้มกลางทรานแซกชันจริง
    const before = await prismaClient.notification.count();
    await expect(addComment(ctx, { itemKey, body: '  ' })).rejects.toThrow();
    expect(await prismaClient.notification.count()).toBe(before);
  });

  it('**แจ้งเตือนที่เขียนผ่าน tx ย้อนกลับพร้อมกันเมื่อทรานแซกชันล้ม**', async () => {
    // บังคับให้ล้ม **หลัง** เขียนแจ้งเตือนไปแล้ว เพื่อพิสูจน์ว่ามันย้อนกลับจริง
    // ถ้าเขียนผ่าน client นอกทรานแซกชัน แถวจะค้างอยู่ทั้งที่ทุกอย่างล้มไปแล้ว
    const before = await prismaClient.notification.count();
    const marker = `rollback-probe:${String(before)}`;

    await expect(
      auditedTransaction(ctx, 'test.rollback', async (tx) => {
        await tx.notification.createMany({
          data: [
            {
              tenantId: ctx.tenantId,
              userId: ctx.actorId,
              kind: 'comment.added',
              title: 'ควรถูกย้อนกลับ',
              body: null,
              dedupeKey: marker,
            },
          ],
        });
        throw new Error('ล้มโดยตั้งใจหลังเขียนแจ้งเตือนแล้ว');
      }),
    ).rejects.toThrow('ล้มโดยตั้งใจ');

    expect(await prismaClient.notification.count()).toBe(before);
    expect(await prismaClient.notification.findFirst({ where: { dedupeKey: marker } })).toBeNull();
  });

  it('เนื้อหาการแจ้งเตือนมีข้อความที่เพิ่งเขียน', async () => {
    const c = await addComment(ctx, { itemKey, body: 'เปลี่ยนสายเรียบร้อยแล้วครับ' });
    const rows = await notifsFor(c.id);
    expect(rows[0]?.body).toContain('เปลี่ยนสายเรียบร้อยแล้วครับ');
  });

  it('**บันทึกภายในไม่สร้างแจ้งเตือนถึงผู้แจ้ง**', async () => {
    const secret = 'ราคาต้นทุนจริงคือหนึ่งหมื่นห้า';
    const c = await addComment(ctx, { itemKey, body: secret, isInternal: true });
    const rows = await notifsFor(c.id);
    const reporterRows = rows.filter((r) => r.userId === ctx.actorId);
    expect(reporterRows).toEqual([]);
  });

  it('เขียนซ้ำได้แจ้งเตือนใหม่ ไม่ใช่ทับของเดิม — คีย์ผูกกับความเห็น ไม่ใช่กับงาน', async () => {
    const a = await addComment(ctx, { itemKey, body: 'ข้อความหนึ่ง' });
    const b = await addComment(ctx, { itemKey, body: 'ข้อความสอง' });
    expect((await notifsFor(a.id)).length).toBeGreaterThan(0);
    expect((await notifsFor(b.id)).length).toBeGreaterThan(0);
  });
});
