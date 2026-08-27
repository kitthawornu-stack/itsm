/**
 * ปิดงานแล้วต้องตอบได้ว่า "จบยังไง" — เทสต์เป็นข้อกำหนด
 *
 * สถานะบอกแค่ว่างานอยู่ตรงไหน · "เสร็จแล้ว" เท่ากันหมดทั้งงานที่แก้ได้จริง
 * งานที่ซ้ำกับใบอื่น และงานที่ผู้แจ้งยกเลิกเอง — ผลการแก้ไขคือสิ่งเดียวที่แยกออก
 *
 * สร้าง workflow · โปรเจกต์ · ผู้ใช้ ของตัวเองทั้งหมดแล้วลบทิ้ง ไม่แตะข้อมูล seed
 * (บทเรียนใน CLAUDE.md — เทสต์ที่คืนค่าตอนท้ายไม่พอ เพราะกลางทางล้มแล้วไม่ถึง)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  UnknownResolutionError,
  ValidationFailedError,
  applyTransition,
  availableTransitions,
} from '../src/modules/workflow';

const STAMP = String(Date.now()).slice(-6);
const PROJECT_KEY = `ZR${STAMP}`;

let ctx: TenantContext;
let actorId: bigint;
let itemId: bigint;
let doingId: bigint;
let doneId: bigint;
let closeId: bigint;
let reopenId: bigint;
let cancelId: bigint;
let workflowId: bigint;
let projectId: bigint;
let issueTypeId: bigint;
let resolvedName: string;
let otherName: string;

const reload = async () =>
  prismaClient.workItem.findFirstOrThrow({
    where: { id: itemId },
    include: { resolution: { select: { name: true } } },
  });

/** พาตั๋วกลับไปสถานะ "กำลังทำ" โดยไม่ผ่าน transition — ใช้ตั้งต้นเคสถัดไป */
const resetToDoing = async (): Promise<void> => {
  await prismaClient.workItem.update({
    where: { id: itemId },
    data: { statusId: doingId, resolutionId: null, resolvedAt: null },
  });
};

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  const tenantId = tenant.id;

  // ต้องมีสองชื่อจริง — เคส "ค่าตายตัวชนะค่าที่ส่งมา" พิสูจน์อะไรไม่ได้เลย
  // ถ้าค่าที่ส่งมาเป็นชื่อที่ไม่มีอยู่ เพราะมันถูกปฏิเสธด้วยเหตุผลอื่นตั้งแต่ต้น
  const [first, second] = await prismaClient.resolution.findMany({
    where: { tenantId },
    orderBy: { id: 'asc' },
    take: 2,
  });
  if (first === undefined || second === undefined) {
    throw new Error('ต้องมีผลการแก้ไขอย่างน้อยสองแบบ — รัน bootstrap หรือ seed ก่อน');
  }
  resolvedName = first.name;
  otherName = second.name;

  const user = await prismaClient.user.create({
    data: { tenantId, email: `res-spec-${STAMP}@example.test`, displayName: 'ทดสอบผลการแก้ไข' },
    select: { id: true },
  });
  actorId = user.id;
  ctx = { tenantId, actorId };

  const workflow = await prismaClient.workflow.create({
    data: { tenantId, name: `ทดสอบ ${STAMP}`, version: 1, isActive: true },
    select: { id: true },
  });
  workflowId = workflow.id;

  const mkStatus = async (
    name: string,
    category: 'TODO' | 'IN_PROGRESS' | 'DONE',
    position: number,
  ): Promise<bigint> =>
    (
      await prismaClient.workflowStatus.create({
        data: { tenantId, workflowId, name, category, position, isInitial: position === 1 },
        select: { id: true },
      })
    ).id;

  doingId = await mkStatus('กำลังทำ', 'IN_PROGRESS', 1);
  doneId = await mkStatus('จบแล้ว', 'DONE', 2);

  // ปุ่มปิดงาน: ต้องเลือกผลการแก้ไข แล้วบันทึกค่าที่เลือก
  closeId = (
    await prismaClient.workflowTransition.create({
      data: {
        tenantId,
        workflowId,
        name: 'ปิดงาน',
        fromStatusId: doingId,
        toStatusId: doneId,
        position: 1,
        rules: {
          create: [
            {
              tenantId,
              kind: 'VALIDATOR',
              ruleType: 'required-fields',
              config: { fields: ['resolution'] },
              position: 1,
            },
            { tenantId, kind: 'POST_FUNCTION', ruleType: 'set-resolution', config: {}, position: 1 },
            { tenantId, kind: 'POST_FUNCTION', ruleType: 'stop-sla', config: {}, position: 2 },
          ],
        },
      },
      select: { id: true },
    })
  ).id;

  // ปุ่มเปิดใหม่: ไม่มีกฎอะไรเลย — การล้างผลการแก้ไขต้องเกิดเองโดยไม่ต้องตั้ง
  reopenId = (
    await prismaClient.workflowTransition.create({
      data: {
        tenantId,
        workflowId,
        name: 'เปิดใหม่',
        fromStatusId: doneId,
        toStatusId: doingId,
        position: 2,
      },
      select: { id: true },
    })
  ).id;

  // ปุ่มที่กำหนดผลตายตัว — ไม่ถามผู้ใช้ และไม่ยอมให้ผู้ใช้เปลี่ยน
  cancelId = (
    await prismaClient.workflowTransition.create({
      data: {
        tenantId,
        workflowId,
        name: 'ยกเลิกเรื่องนี้',
        fromStatusId: doingId,
        toStatusId: doneId,
        position: 3,
        rules: {
          create: [
            {
              tenantId,
              kind: 'POST_FUNCTION',
              ruleType: 'set-resolution',
              config: { resolution: resolvedName },
              position: 1,
            },
          ],
        },
      },
      select: { id: true },
    })
  ).id;

  const scheme = await prismaClient.permissionScheme.findFirstOrThrow({ where: { tenantId } });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: PROJECT_KEY,
      name: `ทดสอบผลการแก้ไข ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = project.id;
  await prismaClient.projectCounter.create({ data: { tenantId, projectId, lastValue: 1 } });

  issueTypeId = (
    await prismaClient.issueType.create({
      data: { tenantId, name: `Incident ${STAMP}`, iconKey: 'incident', isSubtask: false },
      select: { id: true },
    })
  ).id;
  await prismaClient.workflowScheme.create({
    data: { tenantId, projectId, issueTypeId, workflowId },
  });

  itemId = (
    await prismaClient.workItem.create({
      data: {
        tenantId,
        itemKey: `${PROJECT_KEY}-1`,
        projectId,
        issueTypeId,
        summary: 'งานสำหรับทดสอบผลการแก้ไข',
        statusId: doingId,
        reporterId: actorId,
        assigneeId: actorId,
        rank: '0|hzzzzz:',
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await prismaClient.workItemHistory.deleteMany({ where: { workItemId: itemId } });
  await prismaClient.workItem.deleteMany({ where: { id: itemId } });
  await prismaClient.workflowScheme.deleteMany({ where: { projectId } });
  await prismaClient.issueType.deleteMany({ where: { id: issueTypeId } });
  await prismaClient.projectCounter.deleteMany({ where: { projectId } });
  await prismaClient.project.deleteMany({ where: { id: projectId } });
  await prismaClient.workflowTransition.deleteMany({ where: { workflowId } });
  await prismaClient.workflowStatus.deleteMany({ where: { workflowId } });
  await prismaClient.workflow.deleteMany({ where: { id: workflowId } });
  await prismaClient.user.deleteMany({ where: { id: actorId } });
  await prismaClient.$disconnect();
});

describe('ปิดงานพร้อมผลการแก้ไข', () => {
  it('**หน้าจอรู้ก่อนกดว่าต้องกรอกอะไร** ไม่ใช่รู้จากข้อความผิดพลาดหลังกด', async () => {
    const list = await availableTransitions(ctx, itemId, actorId);
    expect(list.find((t) => t.id === closeId)?.requiredFields).toEqual(['resolution']);
    // ปุ่มที่ไม่ขออะไรต้องรายงานเป็นรายการว่าง ไม่ใช่ undefined
    expect(list.find((t) => t.id === cancelId)?.requiredFields).toEqual([]);
  });

  it('ปิดงานโดยไม่เลือกผลการแก้ไขถูกปฏิเสธ และสถานะไม่ขยับ', async () => {
    await resetToDoing();
    await expect(applyTransition(ctx, itemId, closeId, actorId)).rejects.toThrow(
      ValidationFailedError,
    );
    expect((await reload()).statusId).toBe(doingId);
  });

  it('**เลือกผลการแก้ไขแล้วปิดได้** — ค่าที่ส่งมาพร้อมปุ่มต้องนับเป็นค่าที่กรอกแล้ว', async () => {
    await resetToDoing();
    await applyTransition(ctx, itemId, closeId, actorId, { resolutionName: resolvedName });
    const item = await reload();
    expect(item.statusId).toBe(doneId);
    expect(item.resolution?.name).toBe(resolvedName);
  });

  it('บันทึกลงประวัติเป็นชื่อผลการแก้ไข ไม่ใช่ id', async () => {
    const h = await prismaClient.workItemHistory.findFirstOrThrow({
      where: { workItemId: itemId, field: 'resolution' },
      orderBy: { id: 'desc' },
    });
    expect(h.newValue).toBe(resolvedName);
  });

  it('ผลการแก้ไขที่ไม่มีในระบบถูกปฏิเสธ — ไม่ใช่ถูกมองข้ามจนงานปิดโดยไม่มีผล', async () => {
    await resetToDoing();
    await expect(
      applyTransition(ctx, itemId, closeId, actorId, { resolutionName: 'ผลที่ไม่มีอยู่จริง' }),
    ).rejects.toThrow(UnknownResolutionError);
    expect((await reload()).statusId).toBe(doingId);
  });

  it('**ค่าที่ workflow กำหนดตายตัวชนะค่าที่หน้าจอส่งมา**', async () => {
    await resetToDoing();
    // ส่งชื่อที่มีอยู่จริงแต่คนละตัว — ถ้าส่งชื่อที่ไม่มีอยู่ เคสนี้จะผ่าน
    // เพราะถูกปฏิเสธตั้งแต่ต้น ไม่ใช่เพราะค่าตายตัวชนะ
    await applyTransition(ctx, itemId, cancelId, actorId, { resolutionName: otherName });
    expect((await reload()).resolution?.name).toBe(resolvedName);
  });

  it('ชื่อที่ไม่มีในระบบถูกปฏิเสธแม้ปุ่มนั้นจะไม่ใช้ค่าที่ส่งมา', async () => {
    // ยอมรับเงียบ ๆ ก็ได้เพราะค่านั้นไม่ถูกใช้ แต่จะกลบบั๊กของฝั่งที่ส่งมา
    // ไว้จนถึงวันที่มันไปโผล่กับปุ่มที่ใช้ค่านั้นจริง
    await resetToDoing();
    await expect(
      applyTransition(ctx, itemId, cancelId, actorId, { resolutionName: 'ผลที่ไม่มีอยู่จริง' }),
    ).rejects.toThrow(UnknownResolutionError);
    expect((await reload()).statusId).toBe(doingId);
  });
});

describe('เปิดงานใหม่', () => {
  it('**ผลการแก้ไขถูกล้างเมื่อออกจากหมวด DONE** แม้ transition นั้นไม่มีกฎอะไรเลย', async () => {
    await resetToDoing();
    await applyTransition(ctx, itemId, closeId, actorId, { resolutionName: resolvedName });
    expect((await reload()).resolutionId).not.toBeNull();

    await applyTransition(ctx, itemId, reopenId, actorId);
    const item = await reload();
    expect(item.statusId).toBe(doingId);
    // งานที่กำลังทำอยู่แต่ติดป้ายว่า "แก้ไขแล้ว" ตอบคำถามผิดให้ทุกคนที่อ่าน
    expect(item.resolutionId).toBeNull();
  });

  it('resolvedAt ถูกล้างด้วย — ไม่งั้น MTTR นับว่างานเสร็จตั้งแต่รอบก่อน', async () => {
    await resetToDoing();
    await applyTransition(ctx, itemId, closeId, actorId, { resolutionName: resolvedName });
    expect((await reload()).resolvedAt).not.toBeNull();

    await applyTransition(ctx, itemId, reopenId, actorId);
    expect((await reload()).resolvedAt).toBeNull();
  });

  it('การล้างค่าถูกบันทึกลงประวัติ ไม่ใช่หายไปเงียบ ๆ', async () => {
    const rows = await prismaClient.workItemHistory.findMany({
      where: { workItemId: itemId, field: 'resolution', newValue: null },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.oldValue).toBe(resolvedName);
  });
});
