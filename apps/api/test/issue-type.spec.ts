/**
 * ประเภทงานและการผูกเข้ากับโปรเจกต์ — เทสต์เป็นข้อกำหนด
 *
 * เคสที่สำคัญที่สุดคือ **ถอนประเภทงานที่ยังมีงานอยู่ไม่ได้** · ถอนแล้ว
 * `loadTransitions` หา workflow_scheme ไม่เจอและโยน NoWorkflowError
 * งานที่เปิดค้างอยู่จะกดเปลี่ยนสถานะไม่ได้อีกเลย โดยไม่มีอะไรบอกว่าเพราะอะไร
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  BindingInUseError,
  DuplicateIssueTypeError,
  IssueTypeInUseError,
  IssueTypeNameRequiredError,
  IssueTypeNotFoundError,
  WorkflowUnusableError,
  bindIssueType,
  createIssueType,
  listIssueTypes,
  removeIssueType,
  unbindIssueType,
} from '../src/modules/field';
import { NoWorkflowError, availableTransitions } from '../src/modules/workflow';

const STAMP = String(Date.now()).slice(-6);
const TYPE_NAME = `ประเภททดสอบ ${STAMP}`;

let ctx: TenantContext;
let actorId: bigint;
let typeId: bigint;
let emptyWorkflowId: bigint;
let sdId: bigint;
let sdWorkflowId: bigint;
let itemId: bigint | null = null;

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  const user = await prismaClient.user.create({
    data: { tenantId: tenant.id, email: `it-${STAMP}@example.test`, displayName: 'ทดสอบประเภทงาน' },
    select: { id: true },
  });
  actorId = user.id;
  ctx = { tenantId: tenant.id, actorId };

  const sd = await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } });
  sdId = sd.id;
  sdWorkflowId = (await prismaClient.workflowScheme.findFirstOrThrow({ where: { projectId: sdId } }))
    .workflowId;

  emptyWorkflowId = (
    await prismaClient.workflow.create({
      data: { tenantId: tenant.id, name: `it-spec ว่าง ${STAMP}`, version: 1, isActive: true },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  if (itemId !== null) {
    await prismaClient.workItemHistory.deleteMany({ where: { workItemId: itemId } });
    await prismaClient.workItem.deleteMany({ where: { id: itemId } });
  }
  // ครอบทุกอย่างที่เทสต์ **อาจ** สร้างได้ ไม่ใช่เฉพาะที่ตั้งใจให้สำเร็จ
  const types = await prismaClient.issueType.findMany({
    where: { name: { startsWith: 'ประเภททดสอบ' } },
    select: { id: true },
  });
  const ids = types.map((t) => t.id);
  await prismaClient.workflowScheme.deleteMany({ where: { issueTypeId: { in: ids } } });
  await prismaClient.issueType.deleteMany({ where: { id: { in: ids } } });
  await prismaClient.workflow.deleteMany({ where: { id: emptyWorkflowId } });
  await prismaClient.auditLog.deleteMany({ where: { actorId } });
  await prismaClient.user.deleteMany({ where: { id: actorId } });

  expect(
    await prismaClient.issueType.count({ where: { name: { startsWith: 'ประเภททดสอบ' } } }),
  ).toBe(0);
  await prismaClient.$disconnect();
});

describe('ประเภทงาน', () => {
  it('สร้างได้', async () => {
    const t = await createIssueType(ctx, TYPE_NAME);
    typeId = t.id;
    const rows = await listIssueTypes(ctx);
    const mine = rows.find((r) => r.id === typeId.toString());
    expect(mine?.name).toBe(TYPE_NAME);
    expect(mine?.itemCount).toBe(0);
    expect(mine?.usedBy).toEqual([]);
  });

  it('ชื่อว่างถูกปฏิเสธ', async () => {
    await expect(createIssueType(ctx, '   ')).rejects.toThrow(IssueTypeNameRequiredError);
  });

  it('ชื่อซ้ำถูกปฏิเสธ', async () => {
    await expect(createIssueType(ctx, TYPE_NAME)).rejects.toThrow(DuplicateIssueTypeError);
  });

  it('ลบประเภทงานที่ไม่มีอะไรอ้างถึงได้', async () => {
    const t = await createIssueType(ctx, `ประเภททดสอบ ชั่วคราว ${STAMP}`);
    await removeIssueType(ctx, t.id);
    expect(await prismaClient.issueType.count({ where: { id: t.id } })).toBe(0);
  });

  it('ประเภทงานที่ไม่มีอยู่ถูกปฏิเสธ', async () => {
    await expect(removeIssueType(ctx, BigInt(99_999_999))).rejects.toThrow(IssueTypeNotFoundError);
  });
});

describe('ผูกเข้ากับโปรเจกต์', () => {
  it('ผูกได้ และปรากฏว่าใช้ในโปรเจกต์ไหน', async () => {
    const r = await bindIssueType(ctx, sdId, typeId, sdWorkflowId);
    expect(r.changed).toBe(true);
    const rows = await listIssueTypes(ctx);
    expect(rows.find((x) => x.id === typeId.toString())?.usedBy).toContain('SD');
  });

  it('ผูกซ้ำด้วย workflow เดิมไม่เป็น error และไม่เขียนอะไร', async () => {
    const before = await prismaClient.workflowScheme.count({ where: { projectId: sdId } });
    expect((await bindIssueType(ctx, sdId, typeId, sdWorkflowId)).changed).toBe(false);
    expect(await prismaClient.workflowScheme.count({ where: { projectId: sdId } })).toBe(before);
  });

  it('**workflow ที่ไม่มีสถานะเริ่มต้นผูกไม่ได้** — แจ้งเรื่องใหม่จะล้มเหลว', async () => {
    await expect(bindIssueType(ctx, sdId, typeId, emptyWorkflowId)).rejects.toThrow(
      WorkflowUnusableError,
    );
  });

  it('ลบประเภทงานที่ผูกอยู่กับโปรเจกต์ไม่ได้ และบอกจำนวน', async () => {
    try {
      await removeIssueType(ctx, typeId);
      throw new Error('ควรถูกปฏิเสธ');
    } catch (e) {
      expect(e).toBeInstanceOf(IssueTypeInUseError);
      expect((e as IssueTypeInUseError).projectCount).toBe(1);
    }
  });

  it('ถอนออกได้เมื่อยังไม่มีงานประเภทนั้น', async () => {
    await unbindIssueType(ctx, sdId, typeId);
    expect(
      await prismaClient.workflowScheme.count({ where: { projectId: sdId, issueTypeId: typeId } }),
    ).toBe(0);
  });

  it('**ถอนไม่ได้เมื่อมีงานประเภทนั้นอยู่ในโปรเจกต์**', async () => {
    await bindIssueType(ctx, sdId, typeId, sdWorkflowId);
    const status = await prismaClient.workflowStatus.findFirstOrThrow({
      where: { workflowId: sdWorkflowId, isInitial: true },
    });
    const item = await prismaClient.workItem.create({
      data: {
        tenantId: ctx.tenantId,
        itemKey: `ITS-${STAMP}`,
        projectId: sdId,
        issueTypeId: typeId,
        summary: 'งานที่จะกลายเป็นกำพร้าถ้าถอนประเภท',
        statusId: status.id,
        reporterId: actorId,
        rank: '0|hzzzzz:',
      },
      select: { id: true },
    });
    itemId = item.id;

    try {
      await unbindIssueType(ctx, sdId, typeId);
      throw new Error('ควรถูกปฏิเสธ');
    } catch (e) {
      expect(e).toBeInstanceOf(BindingInUseError);
      expect((e as BindingInUseError).itemCount).toBe(1);
    }
  });

  it('**และนี่คือผลจริงถ้าถอนสำเร็จ** — งานนั้นหา workflow ไม่เจอ', async () => {
    /*
      พิสูจน์ว่าเหตุผลของการปฏิเสธเป็นเรื่องจริง ไม่ใช่ความระแวง —
      ถอน scheme ออกชั่วคราวแล้วดูว่า engine ตอบอะไร
    */
    const scheme = await prismaClient.workflowScheme.findFirstOrThrow({
      where: { projectId: sdId, issueTypeId: typeId },
    });
    await prismaClient.workflowScheme.delete({ where: { id: scheme.id } });
    try {
      if (itemId === null) return;
      await expect(availableTransitions(ctx, itemId, actorId)).rejects.toThrow(NoWorkflowError);
    } finally {
      // คืนเสมอ — การเก็บกวาดต้องไม่ตั้งอยู่บนสมมติฐานว่า assertion ข้างบนผ่าน
      await prismaClient.workflowScheme.create({
        data: {
          tenantId: ctx.tenantId,
          projectId: sdId,
          issueTypeId: typeId,
          workflowId: sdWorkflowId,
        },
      });
    }
  });
});
