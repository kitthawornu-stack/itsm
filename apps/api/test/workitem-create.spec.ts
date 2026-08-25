/**
 * การสร้างงาน — เทสต์เป็นข้อกำหนด
 *
 * แตะฐานข้อมูลจริง ใช้ข้อมูลจาก seed (CLAUDE.md §4)
 *
 * เคสที่สำคัญที่สุดคือ **คีย์ต้องไม่ซ้ำเมื่อสร้างพร้อมกัน** และ
 * **ทุกใบต้องมีนาฬิกา SLA ตั้งแต่วินาทีแรก** — งานที่ไม่มีนาฬิกาคืองานที่
 * ไม่มีวันหลุด SLA ในสายตาระบบ ซึ่งเป็นความเงียบที่แย่ที่สุดของ ITSM
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  IssueTypeNotConfiguredError,
  ProjectNotFoundError,
  SummaryRequiredError,
  createWorkItem,
} from '../src/modules/workitem/workitem.service';

let ctx: TenantContext;
const created: bigint[] = [];

const make = async (over: Partial<Parameters<typeof createWorkItem>[1]> = {}) => {
  const r = await createWorkItem(ctx, {
    projectKey: 'SD',
    issueTypeName: 'Incident',
    summary: 'เครื่องพิมพ์ชั้น 3 ไม่ทำงาน',
    ...over,
  });
  created.push(r.id);
  return r;
};

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
});

afterAll(async () => {
  // ลบตามลำดับ — งานที่สร้างมีนาฬิกาและประวัติผูกอยู่
  await prismaClient.slaEvent.deleteMany({ where: { sla: { workItemId: { in: created } } } });
  await prismaClient.workItemSla.deleteMany({ where: { workItemId: { in: created } } });
  await prismaClient.workItemHistory.deleteMany({ where: { workItemId: { in: created } } });
  await prismaClient.notification.deleteMany({ where: { workItemId: { in: created } } });
  await prismaClient.workItem.deleteMany({ where: { id: { in: created } } });
  await prismaClient.$disconnect();
});

describe('createWorkItem', () => {
  it('ได้คีย์ที่มนุษย์อ่านได้ และสถานะเริ่มต้นของ workflow', async () => {
    const r = await make();
    expect(r.itemKey).toMatch(/^SD-\d+$/);
    expect(r.statusName).toBe('New');

    const row = await prismaClient.workItem.findFirstOrThrow({ where: { id: r.id } });
    const status = await prismaClient.workflowStatus.findFirstOrThrow({
      where: { id: row.statusId },
    });
    // สถานะต้องมาจาก isInitial ของ workflow ไม่ใช่จากค่าที่ผู้เรียกส่งมา
    expect(status.isInitial).toBe(true);
  });

  it('**คีย์ไม่ซ้ำเมื่อสร้างพร้อมกัน** — ตัวนับต้องล็อกแถว ไม่ใช่อ่านมาบวกเอง', async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => make()));
    const keys = rs.map((r) => r.itemKey);
    expect(new Set(keys).size).toBe(8);
  });

  it('ตัวนับของโปรเจกต์เดินตามจำนวนที่สร้างจริง', async () => {
    const project = await prismaClient.project.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, key: 'SD' },
    });
    const before = await prismaClient.projectCounter.findFirstOrThrow({
      where: { projectId: project.id },
    });
    await make();
    const after = await prismaClient.projectCounter.findFirstOrThrow({
      where: { projectId: project.id },
    });
    expect(after.lastValue).toBe(before.lastValue + 1);
  });

  it('**มีนาฬิกา SLA ตั้งแต่วินาทีแรก** ไม่ต้องรอ transition', async () => {
    const r = await make();
    const clock = await prismaClient.workItemSla.findFirst({ where: { workItemId: r.id } });
    expect(clock).not.toBeNull();
    expect(clock?.state).toBe('running');
  });

  it('เขียนประวัติในทรานแซกชันเดียวกัน (INVARIANT 2)', async () => {
    const r = await make();
    const history = await prismaClient.workItemHistory.findMany({ where: { workItemId: r.id } });
    const fields = history.map((h) => h.field);
    expect(fields).toContain('__created__');
    expect(fields).toContain('status');
  });

  it('rank ต่อท้ายของเดิม ไม่ชนกับงานที่มีอยู่', async () => {
    const a = await make();
    const b = await make();
    const rows = await prismaClient.workItem.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { id: true, rank: true },
    });
    const ra = rows.find((x) => x.id === a.id)!.rank;
    const rb = rows.find((x) => x.id === b.id)!.rank;
    expect(rb > ra).toBe(true);
  });

  it('เก็บคำอธิบายเป็น structured document ไม่ใช่ HTML ดิบ', async () => {
    const r = await make({ description: 'กดปุ่มแล้วไฟกะพริบสามครั้ง' });
    const row = await prismaClient.workItem.findFirstOrThrow({ where: { id: r.id } });
    expect(row.description).toEqual({ format: 'text', text: 'กดปุ่มแล้วไฟกะพริบสามครั้ง' });
  });

  it('คำอธิบายว่างไม่เก็บเป็นเอกสารเปล่า', async () => {
    const r = await make({ description: '   ' });
    const row = await prismaClient.workItem.findFirstOrThrow({ where: { id: r.id } });
    expect(row.description).toBeNull();
  });

  it('หัวข้อว่างถูกปฏิเสธ — ไม่ใช่สร้างงานที่ไม่มีหัวข้อ', async () => {
    await expect(make({ summary: '   ' })).rejects.toThrow(SummaryRequiredError);
  });

  it('หัวข้อยาวเกินถูกตัดที่ 500 ไม่ใช่ให้ฐานข้อมูลปฏิเสธ', async () => {
    const r = await make({ summary: 'ก'.repeat(900) });
    const row = await prismaClient.workItem.findFirstOrThrow({ where: { id: r.id } });
    expect(row.summary.length).toBe(500);
  });

  it('โปรเจกต์ที่ไม่มีจริงถูกปฏิเสธ', async () => {
    await expect(make({ projectKey: 'NOPE' })).rejects.toThrow(ProjectNotFoundError);
  });

  it('ชนิดงานที่โปรเจกต์ยังไม่ได้ตั้ง workflow ถูกปฏิเสธ', async () => {
    await expect(make({ issueTypeName: 'ไม่มีชนิดนี้' })).rejects.toThrow(
      IssueTypeNotConfiguredError,
    );
  });

  it('ผู้แจ้งคือผู้ใช้ปัจจุบัน ไม่ใช่ค่าที่ส่งเข้ามา', async () => {
    const r = await make();
    const row = await prismaClient.workItem.findFirstOrThrow({ where: { id: r.id } });
    expect(row.reporterId).toBe(ctx.actorId);
  });
});
