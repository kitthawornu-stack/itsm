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
import { EmptyCommentError, addComment, listComments } from '../src/modules/workitem/comment.service';
import { WorkItemNotFoundError, createWorkItem } from '../src/modules/workitem/workitem.service';

let ctx: TenantContext;
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

  const created = await createWorkItem(ctx, {
    projectKey: 'SD',
    issueTypeName: 'Incident',
    summary: 'งานสำหรับทดสอบความเห็น',
  });
  createdIds.push(created.id);
  itemKey = created.itemKey;
});

afterAll(async () => {
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

describe('listComments · INVARIANT 3', () => {
  it('**ผู้แจ้งไม่เห็นความเห็นภายใน** — กรองที่ service ไม่ใช่ที่หน้าจอ', async () => {
    const forReporter = await listComments(ctx, itemKey, 'reporter');
    expect(forReporter.every((c) => !c.isInternal)).toBe(true);
    expect(JSON.stringify(forReporter)).not.toContain('ห้ามให้ผู้แจ้งเห็น');
  });

  it('ทีมเห็นทั้งหมด รวมความเห็นภายใน', async () => {
    const forAgent = await listComments(ctx, itemKey, 'agent');
    expect(forAgent.some((c) => c.isInternal)).toBe(true);
  });

  it('ผู้แจ้งเห็นน้อยกว่าทีมเสมอเมื่อมีความเห็นภายใน', async () => {
    const a = await listComments(ctx, itemKey, 'agent');
    const r = await listComments(ctx, itemKey, 'reporter');
    expect(r.length).toBeLessThan(a.length);
  });

  it('เรียงตามเวลาจากเก่าไปใหม่ — บทสนทนาต้องอ่านจากบนลงล่าง', async () => {
    const rows = await listComments(ctx, itemKey, 'agent');
    const ids = rows.map((r) => BigInt(r.id));
    expect([...ids].sort((x, y) => (x < y ? -1 : 1))).toEqual(ids);
  });

  it('ความเห็นที่ถูกลบไม่ถูกส่งออก แต่ยังอยู่ในฐานข้อมูล', async () => {
    const c = await addComment(ctx, { itemKey, body: 'พิมพ์ผิด ขอลบ' });
    await prismaClient.workItemComment.update({
      where: { id: BigInt(c.id) },
      data: { deletedAt: new Date() },
    });
    const rows = await listComments(ctx, itemKey, 'agent');
    expect(rows.some((r) => r.id === c.id)).toBe(false);
    // soft delete — audit ต้องยังตอบได้ว่าเคยมี
    expect(await prismaClient.workItemComment.findFirst({ where: { id: BigInt(c.id) } })).not.toBeNull();
  });
});
