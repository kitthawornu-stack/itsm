/**
 * แก้ workflow จากหน้าจอ — เทสต์เป็นข้อกำหนด
 *
 * เกณฑ์ผ่าน Phase 0 ข้อแรกคือ "แอดมินสร้าง workflow 5 สถานะได้จาก UI"
 * ซึ่งไม่เคยผ่าน — เพิ่มสถานะหนึ่งอันต้องเขียน SQL
 *
 * เคสที่สำคัญที่สุดคือ **ลบสถานะที่มีงานอยู่ไม่ได้** และ **ต้องมีสถานะเริ่มต้น
 * เสมอ** · ทั้งสองอย่างทำให้ workflow ที่ใช้งานอยู่พังทันที ไม่ใช่พังตอนสร้างใหม่
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  DuplicateNameError,
  InitialStatusRequiredError,
  NameRequiredError,
  StatusHasTransitionsError,
  StatusInUseError,
  StatusNotFoundError,
  addStatus,
  addTransition,
  createWorkflow,
  listWorkflowsAdmin,
  removeStatus,
  removeTransition,
  setInitialStatus,
} from '../src/modules/workflow';

const STAMP = String(Date.now()).slice(-6);
const WF_NAME = `ทดสอบแก้ workflow ${STAMP}`;

let ctx: TenantContext;
let actorId: bigint;
let workflowId: bigint;
let initialId: bigint;
let doingId: bigint;
const madeItems: bigint[] = [];

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  const user = await prismaClient.user.create({
    data: { tenantId: tenant.id, email: `wa-${STAMP}@example.test`, displayName: 'ทดสอบ workflow' },
    select: { id: true },
  });
  actorId = user.id;
  ctx = { tenantId: tenant.id, actorId };
});

afterAll(async () => {
  await prismaClient.workItem.deleteMany({ where: { id: { in: madeItems } } });
  const wfs = await prismaClient.workflow.findMany({
    where: { name: { startsWith: 'ทดสอบแก้ workflow' } },
    select: { id: true },
  });
  const ids = wfs.map((w) => w.id);
  await prismaClient.workflowScheme.deleteMany({ where: { workflowId: { in: ids } } });
  await prismaClient.workflowTransition.deleteMany({ where: { workflowId: { in: ids } } });
  await prismaClient.workflowStatus.deleteMany({ where: { workflowId: { in: ids } } });
  await prismaClient.workflow.deleteMany({ where: { id: { in: ids } } });
  await prismaClient.auditLog.deleteMany({ where: { actorId } });
  await prismaClient.user.deleteMany({ where: { id: actorId } });

  // ยืนยันว่าไม่เหลือจริง ไม่ใช่เชื่อว่าคำสั่งข้างบนทำงาน
  expect(
    await prismaClient.workflow.count({ where: { name: { startsWith: 'ทดสอบแก้ workflow' } } }),
  ).toBe(0);
  await prismaClient.$disconnect();
});

describe('สร้าง workflow', () => {
  it('**สร้างพร้อมสถานะเริ่มต้นเสมอ** — สร้างเปล่าไม่ได้', async () => {
    // workflow ที่ไม่มีสถานะเริ่มต้น ผูกกับโปรเจกต์แล้วแจ้งเรื่องใหม่ล้มเหลว
    const wf = await createWorkflow(ctx, WF_NAME, 'รับเรื่อง');
    workflowId = wf.id;
    const statuses = await prismaClient.workflowStatus.findMany({ where: { workflowId } });
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.isInitial).toBe(true);
  });

  it('ชื่อ workflow ว่างถูกปฏิเสธ', async () => {
    await expect(createWorkflow(ctx, '   ', 'x')).rejects.toThrow(NameRequiredError);
  });

  it('ชื่อสถานะเริ่มต้นว่างถูกปฏิเสธ — และต้องไม่สร้าง workflow ค้างไว้', async () => {
    const before = await prismaClient.workflow.count();
    await expect(createWorkflow(ctx, `${WF_NAME} ข`, '  ')).rejects.toThrow(NameRequiredError);
    expect(await prismaClient.workflow.count()).toBe(before);
  });

  it('ชื่อซ้ำถูกปฏิเสธ', async () => {
    await expect(createWorkflow(ctx, WF_NAME, 'อะไรก็ได้')).rejects.toThrow(DuplicateNameError);
  });
});

describe('สถานะ', () => {
  it('เพิ่มสถานะได้ และไปต่อท้าย ไม่ใช่แทรกกลาง', async () => {
    initialId = (
      await prismaClient.workflowStatus.findFirstOrThrow({ where: { workflowId, isInitial: true } })
    ).id;
    const st = await addStatus(ctx, workflowId, { name: 'กำลังทำ', category: 'IN_PROGRESS' });
    doingId = st.id;
    const rows = await prismaClient.workflowStatus.findMany({
      where: { workflowId },
      orderBy: { position: 'asc' },
    });
    expect(rows.map((r) => r.name)).toEqual(['รับเรื่อง', 'กำลังทำ']);
  });

  it('**สถานะที่เพิ่มใหม่ไม่ใช่สถานะเริ่มต้นโดยอัตโนมัติ**', async () => {
    // ถ้าเป็น จะมีสองอันพร้อมกัน แล้วงานใหม่จะเริ่มที่อันไหนก็ไม่แน่นอน
    const st = await prismaClient.workflowStatus.findFirstOrThrow({ where: { id: doingId } });
    expect(st.isInitial).toBe(false);
    expect(await prismaClient.workflowStatus.count({ where: { workflowId, isInitial: true } })).toBe(
      1,
    );
  });

  it('**ย้ายสถานะเริ่มต้นแล้วต้องเหลืออันเดียวเสมอ**', async () => {
    await setInitialStatus(ctx, workflowId, doingId);
    const initials = await prismaClient.workflowStatus.findMany({
      where: { workflowId, isInitial: true },
    });
    expect(initials).toHaveLength(1);
    expect(initials[0]?.id).toBe(doingId);
    // ย้ายกลับเพื่อให้เคสถัดไปตั้งต้นเหมือนเดิม
    await setInitialStatus(ctx, workflowId, initialId);
  });

  it('ชื่อสถานะซ้ำใน workflow เดียวกันถูกปฏิเสธ', async () => {
    await expect(
      addStatus(ctx, workflowId, { name: 'กำลังทำ', category: 'IN_PROGRESS' }),
    ).rejects.toThrow(DuplicateNameError);
  });

  it('หมวดที่ไม่รู้จักถูกปฏิเสธ', async () => {
    await expect(
      addStatus(ctx, workflowId, {
        name: 'หมวดมั่ว',
        category: 'ไม่มีหมวดนี้' as never,
      }),
    ).rejects.toThrow(NameRequiredError);
  });

  it('**ลบสถานะเริ่มต้นไม่ได้** — จะแจ้งเรื่องใหม่ไม่ได้เลย', async () => {
    await expect(removeStatus(ctx, workflowId, initialId)).rejects.toThrow(
      InitialStatusRequiredError,
    );
  });

  it('ลบสถานะที่ไม่มีอะไรอ้างถึงได้', async () => {
    const tmp = await addStatus(ctx, workflowId, { name: 'ชั่วคราว', category: 'TODO' });
    await removeStatus(ctx, workflowId, tmp.id);
    expect(await prismaClient.workflowStatus.count({ where: { id: tmp.id } })).toBe(0);
  });

  it('**ลบสถานะที่มีเส้นทางเชื่อมอยู่ไม่ได้** และบอกว่ามีกี่เส้น', async () => {
    const t = await addTransition(ctx, workflowId, {
      name: 'เริ่มทำ',
      fromStatusId: initialId,
      toStatusId: doingId,
    });
    await expect(removeStatus(ctx, workflowId, doingId)).rejects.toThrow(
      StatusHasTransitionsError,
    );
    await removeTransition(ctx, workflowId, t.id);
  });

  it('**ลบสถานะที่มีงานอยู่ไม่ได้** และบอกว่ามีกี่เรื่อง', async () => {
    /*
      ฐานข้อมูลกันไว้ด้วย onDelete: Restrict อยู่แล้ว แต่ error ของฐานข้อมูล
      อ่านไม่รู้เรื่องสำหรับคนที่กดปุ่ม — ต้องตอบเป็นภาษาคนพร้อมจำนวนที่กระทบ
    */
    const project = await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } });
    const issueType = await prismaClient.issueType.findFirstOrThrow({
      where: { tenantId: ctx.tenantId },
    });
    const item = await prismaClient.workItem.create({
      data: {
        tenantId: ctx.tenantId,
        itemKey: `WFA-${STAMP}`,
        projectId: project.id,
        issueTypeId: issueType.id,
        summary: 'งานที่ค้างอยู่ในสถานะที่จะลบ',
        statusId: doingId,
        reporterId: actorId,
        rank: '0|hzzzzz:',
      },
      select: { id: true },
    });
    madeItems.push(item.id);

    try {
      await removeStatus(ctx, workflowId, doingId);
      throw new Error('ควรถูกปฏิเสธ');
    } catch (e) {
      expect(e).toBeInstanceOf(StatusInUseError);
      expect((e as StatusInUseError).itemCount).toBe(1);
    }
    expect(await prismaClient.workflowStatus.count({ where: { id: doingId } })).toBe(1);
  });
});

describe('เส้นทาง', () => {
  it('เพิ่มเส้นทางได้', async () => {
    const t = await addTransition(ctx, workflowId, {
      name: 'ส่งต่อ',
      fromStatusId: initialId,
      toStatusId: doingId,
    });
    expect(await prismaClient.workflowTransition.count({ where: { id: t.id } })).toBe(1);
  });

  it('**เส้นทางที่ทำได้จากทุกสถานะใช้ from เป็น null**', async () => {
    const t = await addTransition(ctx, workflowId, {
      name: 'ยกเลิกได้ทุกเมื่อ',
      fromStatusId: null,
      toStatusId: doingId,
    });
    const row = await prismaClient.workflowTransition.findFirstOrThrow({ where: { id: t.id } });
    expect(row.fromStatusId).toBeNull();
  });

  it('**สถานะปลายทางที่อยู่คนละ workflow ถูกปฏิเสธ**', async () => {
    // ถ้าปล่อยผ่าน จะได้เส้นทางที่ไม่มีวันปรากฏ เพราะสถานะปัจจุบันไม่มีทางตรงกับมัน
    const other = await prismaClient.workflowStatus.findFirstOrThrow({
      where: { workflowId: { not: workflowId } },
    });
    await expect(
      addTransition(ctx, workflowId, {
        name: 'ข้าม workflow',
        fromStatusId: initialId,
        toStatusId: other.id,
      }),
    ).rejects.toThrow(StatusNotFoundError);
  });

  it('สถานะต้นทางที่อยู่คนละ workflow ก็ถูกปฏิเสธ', async () => {
    const other = await prismaClient.workflowStatus.findFirstOrThrow({
      where: { workflowId: { not: workflowId } },
    });
    await expect(
      addTransition(ctx, workflowId, {
        name: 'ต้นทางข้าม workflow',
        fromStatusId: other.id,
        toStatusId: doingId,
      }),
    ).rejects.toThrow(StatusNotFoundError);
  });

  it('ชื่อปุ่มซ้ำถูกปฏิเสธ — สองปุ่มชื่อเดียวกันเลือกไม่ถูก', async () => {
    await expect(
      addTransition(ctx, workflowId, {
        name: 'ส่งต่อ',
        fromStatusId: doingId,
        toStatusId: initialId,
      }),
    ).rejects.toThrow(DuplicateNameError);
  });
});

describe('รายการ workflow', () => {
  it('**บอกว่าโปรเจกต์ไหนใช้อยู่** — แก้ที่นี่กระทบตั๋วที่เปิดอยู่ทันที', async () => {
    const rows = await listWorkflowsAdmin(ctx);
    const used = rows.find((w) => w.usedBy.length > 0);
    expect(used).toBeDefined();
    const mine = rows.find((w) => w.id === workflowId.toString());
    expect(mine?.usedBy).toEqual([]);
    expect(mine?.statusCount).toBeGreaterThan(0);
  });
});
