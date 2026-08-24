/**
 * INVARIANT 2 — การเปลี่ยนสถานะต้องเขียนประวัติในทรานแซกชันเดียวกัน
 *
 * เทสต์นี้แตะฐานข้อมูลจริง ไม่ mock (CLAUDE.md §4)
 * ใช้ข้อมูลจาก seed — ต้องรัน `pnpm --filter @itsm/api seed` ก่อน
 *
 * เคสที่สำคัญที่สุดคือข้อสุดท้าย: **เมื่อ transition ล้มกลางทาง
 * ต้องไม่มีทั้งการเปลี่ยนสถานะและประวัติ** ถ้าย้อนกลับไม่ครบ จะเกิดประวัติ
 * ที่ชี้ไปสถานะที่ไม่เคยเกิดขึ้นจริง ซึ่งทำลายความน่าเชื่อถือของ audit trail ทั้งระบบ
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { MissingAuditError, auditedTransaction } from '../src/infrastructure/audit/audited-transaction';
import { applyTransition, availableTransitions } from '../src/modules/workflow/workflow.service';
import { ValidationFailedError } from '../src/modules/workflow/workflow-engine';
import type { TenantContext } from '@itsm/types';

let ctx: TenantContext;
let agentId: bigint;
let itemId: bigint;
let statusNew: bigint;
let statusInvestigating: bigint;

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirst({ where: { key: 'default' } });
  if (tenant === null) {
    throw new Error('ยังไม่มีข้อมูล seed — รัน `pnpm --filter @itsm/api seed` ก่อน');
  }
  ctx = { tenantId: tenant.id, actorId: null };

  const agent = await prismaClient.user.findFirstOrThrow({
    where: { tenantId: tenant.id, email: 'agent1@plusdentalclinic.co.th' },
  });
  agentId = agent.id;

  const wf = await prismaClient.workflow.findFirstOrThrow({
    where: { tenantId: tenant.id, name: 'ITSM: Incident Management' },
  });
  const statuses = await prismaClient.workflowStatus.findMany({ where: { workflowId: wf.id } });
  statusNew = statuses.find((s) => s.name === 'New')!.id;
  statusInvestigating = statuses.find((s) => s.name === 'Investigating')!.id;

  // สร้างงานทดสอบของตัวเอง ไม่แตะข้อมูล seed
  const project = await prismaClient.project.findFirstOrThrow({
    where: { tenantId: tenant.id, key: 'SD' },
  });
  const issueType = await prismaClient.issueType.findFirstOrThrow({
    where: { tenantId: tenant.id, name: 'Incident' },
  });
  const created = await prismaClient.workItem.create({
    data: {
      tenantId: tenant.id,
      itemKey: 'SD-TEST-1',
      projectId: project.id,
      issueTypeId: issueType.id,
      summary: 'งานทดสอบสำหรับชุดทดสอบ workflow',
      statusId: statusNew,
      reporterId: agentId,
      assigneeId: agentId,
      rank: '0|zzzz',
    },
  });
  itemId = created.id;
});

afterAll(async () => {
  await prismaClient.workItem.deleteMany({ where: { itemKey: 'SD-TEST-1' } });
  await prismaClient.$disconnect();
});

describe('workflow transition · INVARIANT 2', () => {
  it('แสดงเฉพาะ transition ที่ทำได้จากสถานะปัจจุบัน', async () => {
    const available = await availableTransitions(ctx, itemId, agentId);
    expect(available.map((t) => t.name)).toEqual(['เริ่มตรวจสอบ']);
  });

  it('เปลี่ยนสถานะสำเร็จ และเขียนประวัติสองรายการในทรานแซกชันเดียวกัน', async () => {
    const before = await prismaClient.workItemHistory.count({ where: { workItemId: itemId } });

    const start = (await availableTransitions(ctx, itemId, agentId))[0]!;
    const result = await applyTransition(ctx, itemId, start.id, agentId);

    expect(result.fromStatusId).toBe(statusNew);
    expect(result.toStatusId).toBe(statusInvestigating);

    const item = await prismaClient.workItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.statusId).toBe(statusInvestigating);

    const history = await prismaClient.workItemHistory.findMany({
      where: { workItemId: itemId },
      orderBy: { id: 'asc' },
    });
    expect(history.length).toBe(before + 2);

    // ประวัติต้องตอบได้ทั้ง "สถานะเปลี่ยนเป็นอะไร" และ "ผ่านปุ่มไหน"
    const statusRow = history.find((h) => h.field === 'status');
    expect(statusRow?.oldValue).toBe('New');
    expect(statusRow?.newValue).toBe('Investigating');
    expect(history.find((h) => h.field === '__transition__')?.newValue).toBe('เริ่มตรวจสอบ');

    // actor ต้องถูกบันทึก ไม่ใช่ null
    expect(statusRow?.actorId).toBe(agentId);
  });

  it('VALIDATOR ที่ไม่ผ่านทำให้ transition ถูกปฏิเสธ และไม่เกิดประวัติใด ๆ', async () => {
    const before = await prismaClient.workItemHistory.count({ where: { workItemId: itemId } });
    const beforeItem = await prismaClient.workItem.findUniqueOrThrow({ where: { id: itemId } });

    // "แก้ไขเสร็จแล้ว" มี VALIDATOR required-fields: resolution ซึ่งงานนี้ยังไม่มี
    const all = await availableTransitions(ctx, itemId, agentId);
    const resolve = all.find((t) => t.name === 'แก้ไขเสร็จแล้ว');
    expect(resolve, 'ปุ่มต้องยังเห็นแม้ validator ไม่ผ่าน').toBeDefined();

    await expect(applyTransition(ctx, itemId, resolve!.id, agentId)).rejects.toThrow(
      ValidationFailedError,
    );

    const afterItem = await prismaClient.workItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(afterItem.statusId).toBe(beforeItem.statusId);
    expect(await prismaClient.workItemHistory.count({ where: { workItemId: itemId } })).toBe(before);
  });

  it('CONDITION ที่ไม่ผ่านทำให้ปุ่มไม่ปรากฏเลย', async () => {
    const otherAgent = await prismaClient.user.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, email: 'agent2@plusdentalclinic.co.th' },
    });
    // agent2 ไม่ใช่ผู้รับผิดชอบ → assignee-is-current-user ไม่ผ่าน
    const available = await availableTransitions(ctx, itemId, otherAgent.id);
    expect(available.map((t) => t.name)).not.toContain('แก้ไขเสร็จแล้ว');
  });

  it('mutation ที่ไม่คืน audit ถูกปฏิเสธ — INVARIANT 2 บังคับด้วยกลไก ไม่ใช่วินัย', async () => {
    await expect(
      auditedTransaction(ctx, 'test.no-audit', async (tx) => {
        await tx.workItem.update({ where: { id: itemId }, data: { summary: 'แก้โดยไม่บันทึก' } });
        return { result: null, audit: [] };
      }),
    ).rejects.toThrow(MissingAuditError);

    // ทรานแซกชันถูกย้อนกลับ — summary ต้องไม่เปลี่ยน
    const item = await prismaClient.workItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.summary).toBe('งานทดสอบสำหรับชุดทดสอบ workflow');
  });
});
