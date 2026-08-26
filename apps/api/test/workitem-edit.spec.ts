/**
 * แก้ไขงาน — เทสต์เป็นข้อกำหนด
 *
 * สร้างผู้ใช้และงานของตัวเองแล้วลบทิ้งใน `finally` · ไม่แตะข้อมูล seed
 *
 * เคสที่สำคัญที่สุดคือ **บันทึกเฉพาะฟิลด์ที่เปลี่ยนจริง** และ
 * **"ไม่ส่งฟิลด์" ต้องต่างจาก "ส่ง null"** — ถ้าสองอย่างนี้กลายเป็นสิ่งเดียวกัน
 * การกดบันทึกหนึ่งครั้งจะล้างค่าในช่องที่ผู้ใช้ไม่ได้แตะเลย
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  InvalidFieldValueError,
  NothingToUpdateError,
  editWorkItem,
} from '../src/modules/workitem/edit.service';
import { SummaryRequiredError, createWorkItem } from '../src/modules/workitem/workitem.service';

const PREFIX = `edit-spec-${String(Date.now())}`;
let tenantId: bigint;
let staffCtx: TenantContext;
let plainCtx: TenantContext;
let itemKey: string;
let itemId: bigint;
const madeUsers: bigint[] = [];

const reload = async () =>
  prismaClient.workItem.findFirstOrThrow({
    where: { id: itemId },
    include: { priority: { select: { rank: true } } },
  });

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirst({ where: { key: 'default' } });
  if (tenant === null) {
    throw new Error('ยังไม่มีข้อมูล seed — รัน `pnpm --filter @itsm/api seed` ก่อน');
  }
  tenantId = tenant.id;

  const it = await prismaClient.userGroup.findFirstOrThrow({
    where: { tenantId, name: 'IT Support' },
  });
  const all = await prismaClient.userGroup.findFirstOrThrow({
    where: { tenantId, name: 'พนักงานทั้งหมด' },
  });

  const mk = async (n: string, groups: bigint[]): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `${PREFIX}-${n}@example.test`, displayName: `ทดสอบ ${n}` },
      select: { id: true },
    });
    madeUsers.push(u.id);
    await prismaClient.groupMember.createMany({
      data: groups.map((groupId) => ({ tenantId, groupId, userId: u.id })),
    });
    return u.id;
  };

  staffCtx = { tenantId, actorId: await mk('staff', [it.id, all.id]) };
  plainCtx = { tenantId, actorId: await mk('plain', [all.id]) };

  const created = await createWorkItem(staffCtx, {
    projectKey: 'SD',
    issueTypeName: 'Incident',
    summary: 'หัวข้อเดิมก่อนแก้ไข',
    description: 'คำอธิบายเดิม',
  });
  itemKey = created.itemKey;
  itemId = created.id;
});

afterAll(async () => {
  await prismaClient.notification.deleteMany({ where: { workItemId: itemId } });
  await prismaClient.slaEvent.deleteMany({ where: { sla: { workItemId: itemId } } });
  await prismaClient.workItemSla.deleteMany({ where: { workItemId: itemId } });
  await prismaClient.workItemHistory.deleteMany({ where: { workItemId: itemId } });
  await prismaClient.workItem.deleteMany({ where: { id: itemId } });
  await prismaClient.groupMember.deleteMany({ where: { userId: { in: madeUsers } } });
  await prismaClient.user.deleteMany({ where: { id: { in: madeUsers } } });
  await prismaClient.$disconnect();
});

describe('editWorkItem', () => {
  it('แก้หัวข้อได้ และบันทึกประวัติจากค่าเดิมเป็นค่าใหม่', async () => {
    const r = await editWorkItem(staffCtx, itemKey, { summary: 'หัวข้อใหม่หลังแก้ไข' });
    expect(r.changed).toEqual(['summary']);
    expect((await reload()).summary).toBe('หัวข้อใหม่หลังแก้ไข');

    const h = await prismaClient.workItemHistory.findFirstOrThrow({
      where: { workItemId: itemId, field: 'summary' },
      orderBy: { id: 'desc' },
    });
    expect(h.oldValue).toBe('หัวข้อเดิมก่อนแก้ไข');
    expect(h.newValue).toBe('หัวข้อใหม่หลังแก้ไข');
  });

  it('**บันทึกเฉพาะฟิลด์ที่เปลี่ยนจริง** — ส่งค่าเดิมมาไม่นับเป็นการแก้ไข', async () => {
    const current = await reload();
    const before = await prismaClient.workItemHistory.count({ where: { workItemId: itemId } });
    await expect(
      editWorkItem(staffCtx, itemKey, { summary: current.summary }),
    ).rejects.toThrow(NothingToUpdateError);
    expect(await prismaClient.workItemHistory.count({ where: { workItemId: itemId } })).toBe(before);
  });

  it('**ไม่ส่งฟิลด์ = ไม่แตะ** — แก้หัวข้ออย่างเดียวไม่ล้างคำอธิบาย', async () => {
    await editWorkItem(staffCtx, itemKey, { description: 'คำอธิบายที่ต้องอยู่ต่อ' });
    await editWorkItem(staffCtx, itemKey, { summary: 'แก้หัวข้ออีกรอบ' });
    expect((await reload()).description).toEqual({
      format: 'text',
      text: 'คำอธิบายที่ต้องอยู่ต่อ',
    });
  });

  it('**ส่ง null = ล้างค่า** ซึ่งต่างจากไม่ส่ง', async () => {
    await editWorkItem(staffCtx, itemKey, { description: 'มีค่าอยู่ก่อน' });
    const r = await editWorkItem(staffCtx, itemKey, { description: null });
    expect(r.changed).toEqual(['description']);
    expect((await reload()).description).toBeNull();
  });

  it('ช่องว่างล้วนถือเป็นการล้างค่า ไม่ใช่เก็บช่องว่าง', async () => {
    await editWorkItem(staffCtx, itemKey, { description: 'ค่าก่อนหน้า' });
    await editWorkItem(staffCtx, itemKey, { description: '   ' });
    expect((await reload()).description).toBeNull();
  });

  it('เปลี่ยนความสำคัญได้ และบันทึกชื่อระดับ ไม่ใช่ตัวเลข', async () => {
    const p = await prismaClient.priority.findFirst({ where: { tenantId }, orderBy: { rank: 'asc' } });
    if (p === null) return;
    const r = await editWorkItem(staffCtx, itemKey, { priorityRank: p.rank });
    expect(r.changed).toContain('priority');

    const h = await prismaClient.workItemHistory.findFirstOrThrow({
      where: { workItemId: itemId, field: 'priority' },
      orderBy: { id: 'desc' },
    });
    expect(h.newValue).toBe(p.name);
  });

  it('ระดับความสำคัญที่ไม่มีอยู่ถูกปฏิเสธ และค่าเดิมไม่เปลี่ยน', async () => {
    const before = (await reload()).priorityId;
    await expect(editWorkItem(staffCtx, itemKey, { priorityRank: 99 })).rejects.toThrow(
      InvalidFieldValueError,
    );
    expect((await reload()).priorityId).toBe(before);
  });

  it('หัวข้อว่างถูกปฏิเสธ — งานต้องมีหัวข้อเสมอ', async () => {
    await expect(editWorkItem(staffCtx, itemKey, { summary: '   ' })).rejects.toThrow(
      SummaryRequiredError,
    );
  });

  it('หัวข้อยาวเกินถูกตัดที่ 500 ไม่ใช่ให้ฐานข้อมูลปฏิเสธ', async () => {
    await editWorkItem(staffCtx, itemKey, { summary: 'ก'.repeat(900) });
    expect((await reload()).summary.length).toBe(500);
  });

  it('แก้หลายฟิลด์พร้อมกันได้ และรายงานเฉพาะที่เปลี่ยน', async () => {
    await editWorkItem(staffCtx, itemKey, { summary: 'ตั้งค่าก่อนทดสอบหลายฟิลด์', description: 'ค่า ก' });
    const r = await editWorkItem(staffCtx, itemKey, {
      summary: 'ตั้งค่าก่อนทดสอบหลายฟิลด์', // เหมือนเดิม
      description: 'ค่า ข', // เปลี่ยน
    });
    expect(r.changed).toEqual(['description']);
  });

  it('**คนที่ไม่มีสิทธิ์ EDIT_ITEM แก้ไม่ได้**', async () => {
    await expect(
      editWorkItem(plainCtx, itemKey, { summary: 'ไม่ควรแก้ได้' }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('งานที่ไม่มีอยู่ถูกปฏิเสธ', async () => {
    await expect(editWorkItem(staffCtx, 'SD-999999', { summary: 'x' })).rejects.toThrow();
  });
});
