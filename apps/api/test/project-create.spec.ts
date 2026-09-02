/**
 * สร้างโปรเจกต์ — เทสต์เป็นข้อกำหนด
 *
 * โปรเจกต์แรกมาจาก `bootstrap.js` · โปรเจกต์ที่สองไม่เคยสร้างได้เลยจากหน้าจอ
 *
 * เคสที่สำคัญที่สุดคือ **สร้างโปรเจกต์ที่ใช้ไม่ได้ไม่ได้** — โปรเจกต์ที่ไม่มี
 * ชุดสิทธิ์ ไม่มี workflow หรือไม่มีตัวนับ สร้างสำเร็จแล้วพังตอนมีคนพยายามใช้
 * ซึ่งเป็นคนละที่กับที่คนตั้งค่าทำผิด
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  DuplicateProjectKeyError,
  InvalidProjectKeyError,
  ProjectNeedsSchemeError,
  ProjectNeedsWorkflowError,
  UnknownReferenceError,
  createProject,
  normalizeProjectKey,
  projectCreationOptions,
} from '../src/modules/tenancy';

const STAMP = String(Date.now()).slice(-5);
const KEY = `ZC${STAMP}`;

let ctx: TenantContext;
let actorId: bigint;
let schemeId: bigint;
let workflowId: bigint;
let emptyWorkflowId: bigint;
let issueTypeId: bigint;
const madeProjects: bigint[] = [];

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  ctx = { tenantId: tenant.id, actorId: null };
  const user = await prismaClient.user.create({
    data: { tenantId: tenant.id, email: `pc-${STAMP}@example.test`, displayName: 'ทดสอบสร้าง' },
    select: { id: true },
  });
  actorId = user.id;
  ctx = { tenantId: tenant.id, actorId };

  schemeId = (
    await prismaClient.permissionScheme.findFirstOrThrow({ where: { tenantId: tenant.id } })
  ).id;
  issueTypeId = (await prismaClient.issueType.findFirstOrThrow({ where: { tenantId: tenant.id } }))
    .id;

  workflowId = (
    await prismaClient.workflow.create({
      data: { tenantId: tenant.id, name: `wf ปกติ ${STAMP}`, version: 1, isActive: true },
      select: { id: true },
    })
  ).id;
  await prismaClient.workflowStatus.create({
    data: {
      tenantId: tenant.id,
      workflowId,
      name: 'เริ่ม',
      category: 'TODO',
      position: 1,
      isInitial: true,
    },
  });

  // workflow ที่ไม่มีสถานะเริ่มต้น — สร้างงานใบแรกไม่ได้
  emptyWorkflowId = (
    await prismaClient.workflow.create({
      data: { tenantId: tenant.id, name: `wf ไม่มีเริ่มต้น ${STAMP}`, version: 1, isActive: true },
      select: { id: true },
    })
  ).id;
  await prismaClient.workflowStatus.create({
    data: {
      tenantId: tenant.id,
      workflowId: emptyWorkflowId,
      name: 'กลางทาง',
      category: 'IN_PROGRESS',
      position: 1,
      isInitial: false,
    },
  });
});

/**
 * คีย์ทุกตัวที่เทสต์นี้ **อาจ** สร้างขึ้นได้ ไม่ใช่เฉพาะที่ตั้งใจให้สำเร็จ
 *
 * เคสที่คาดว่าจะถูกปฏิเสธจะสร้างแถวขึ้นมาจริงตอนกลไกถูกลบออกเพื่อพิสูจน์ว่า
 * เทสต์แดงได้ · ครั้งแรกเก็บกวาดเฉพาะคีย์ `ZC` ผลคือโปรเจกต์ `ZE…` ค้างอยู่
 * ในฐานข้อมูลจริง แล้วไปโผล่ในหน้ารายชื่อโปรเจกต์ของผู้ดูแล
 */
const ALL_KEYS = [KEY, `ZQ${STAMP}`, `ZW${STAMP}`, `ZE${STAMP}`, `ZR${STAMP}`];

afterAll(async () => {
  const strays = await prismaClient.project.findMany({
    where: { key: { in: ALL_KEYS } },
    select: { id: true },
  });
  const ids = [...new Set([...madeProjects, ...strays.map((p) => p.id)])];
  await prismaClient.workflowScheme.deleteMany({ where: { projectId: { in: ids } } });
  await prismaClient.projectCounter.deleteMany({ where: { projectId: { in: ids } } });
  await prismaClient.project.deleteMany({ where: { id: { in: ids } } });

  // workflow ลบได้ต่อเมื่อไม่มี scheme ชี้อยู่ (onDelete: Restrict โดยตั้งใจ)
  // จึงต้องลบ scheme ที่ค้างให้หมดก่อน ไม่ใช่หวังว่าจะไม่มี
  await prismaClient.workflowScheme.deleteMany({
    where: { workflowId: { in: [workflowId, emptyWorkflowId] } },
  });
  await prismaClient.workflowStatus.deleteMany({
    where: { workflowId: { in: [workflowId, emptyWorkflowId] } },
  });
  await prismaClient.workflow.deleteMany({ where: { id: { in: [workflowId, emptyWorkflowId] } } });
  await prismaClient.auditLog.deleteMany({ where: { actorId } });
  await prismaClient.user.deleteMany({ where: { id: actorId } });

  // ยืนยันว่าไม่เหลือจริง ไม่ใช่เชื่อว่าคำสั่งข้างบนทำงาน
  expect(await prismaClient.project.count({ where: { key: { in: ALL_KEYS } } })).toBe(0);
  expect(
    await prismaClient.workflow.count({ where: { id: { in: [workflowId, emptyWorkflowId] } } }),
  ).toBe(0);
  /*
    **ผู้ใช้ก็ต้องนับด้วย** — ด่านข้างบนตรวจโปรเจกต์กับ workflow แต่ไม่เคยตรวจ
    ผู้ใช้ที่เทสต์สร้าง · วัดจริง: `pc-43735@example.test` ค้างในฐานข้อมูลพัฒนา
    ตั้งแต่ 2026-08-27 โดยไม่มีอะไรส่งเสียง · ตรวจด้วยรูปอีเมล ไม่ใช่ด้วย
    `actorId` ที่จำไว้ เพราะตอนกลางทางล้ม ตัวแปรนั้นอาจยังไม่มีค่า
  */
  expect(
    await prismaClient.user.count({ where: { email: { endsWith: `${STAMP}@example.test` } } }),
    'เก็บกวาดไม่ครบ — เหลือผู้ใช้ของเทสต์ในฐานข้อมูล',
  ).toBe(0);
  await prismaClient.$disconnect();
});

describe('คีย์โปรเจกต์', () => {
  it('ทำเป็นตัวพิมพ์ใหญ่และตัดช่องว่าง', () => {
    expect(normalizeProjectKey('  hr  ')).toBe('HR');
  });

  it('สั้นหรือยาวเกินถูกปฏิเสธ', () => {
    expect(() => normalizeProjectKey('A')).toThrow(InvalidProjectKeyError);
    expect(() => normalizeProjectKey('ABCDEFGHIJK')).toThrow(InvalidProjectKeyError);
  });

  it('**คีย์ภาษาไทยถูกปฏิเสธ** — คีย์ฝังอยู่ใน URL และ item key ของงานทุกใบ', () => {
    expect(() => normalizeProjectKey('ไอที')).toThrow(InvalidProjectKeyError);
  });

  it('ขึ้นต้นด้วยตัวเลขไม่ได้ — จะแยก SD-12 กับ 12-34 ด้วยตาไม่ออก', () => {
    expect(() => normalizeProjectKey('1A')).toThrow(InvalidProjectKeyError);
    expect(normalizeProjectKey('A1')).toBe('A1');
  });

  it('ขีดกลางและช่องว่างกลางคำถูกปฏิเสธ — จะทำให้ item key อ่านไม่ออก', () => {
    expect(() => normalizeProjectKey('SD-X')).toThrow(InvalidProjectKeyError);
    expect(() => normalizeProjectKey('S D')).toThrow(InvalidProjectKeyError);
  });
});

describe('สร้างโปรเจกต์', () => {
  it('สร้างได้ครบทุกชิ้นที่ต้องมี', async () => {
    const created = await createProject(ctx, {
      key: KEY,
      name: `ทดสอบสร้าง ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: schemeId,
      workflowId,
      issueTypeIds: [issueTypeId],
    });
    madeProjects.push(created.id);
    expect(created.key).toBe(KEY);

    /**
     * ตัวนับต้องมีตั้งแต่แรก — ไม่มีตัวนับ = สร้างงานใบแรกไม่ได้
     * และ error ไปโผล่ที่หน้าแจ้งเรื่องของผู้ใช้ ไม่ใช่ที่หน้าตั้งค่า
     */
    expect(
      await prismaClient.projectCounter.count({ where: { projectId: created.id } }),
    ).toBe(1);
    expect(
      await prismaClient.workflowScheme.count({ where: { projectId: created.id } }),
    ).toBe(1);
  });

  it('**บันทึก audit เป็นชื่อ ไม่ใช่ id**', async () => {
    const log = await prismaClient.auditLog.findFirstOrThrow({
      where: { actorId, action: 'project.create' },
    });
    const payload = log.payload as { workflow?: string; permissionScheme?: string };
    // id ตอบไม่ได้ว่า workflow ไหนเมื่ออ่านย้อนหลังหลัง workflow ถูกลบไปแล้ว
    expect(payload.workflow).toBe(`wf ปกติ ${STAMP}`);
    expect(typeof payload.permissionScheme).toBe('string');
  });

  it('คีย์ซ้ำถูกปฏิเสธ', async () => {
    await expect(
      createProject(ctx, {
        key: KEY,
        name: 'ซ้ำ',
        type: 'SERVICE_DESK',
        permissionSchemeId: schemeId,
        workflowId,
        issueTypeIds: [issueTypeId],
      }),
    ).rejects.toThrow(DuplicateProjectKeyError);
  });

  it('คีย์ซ้ำแบบตัวพิมพ์เล็กก็ยังซ้ำ', async () => {
    await expect(
      createProject(ctx, {
        key: KEY.toLowerCase(),
        name: 'ซ้ำแบบพิมพ์เล็ก',
        type: 'SERVICE_DESK',
        permissionSchemeId: schemeId,
        workflowId,
        issueTypeIds: [issueTypeId],
      }),
    ).rejects.toThrow(DuplicateProjectKeyError);
  });

  it('**ไม่มีชุดสิทธิ์สร้างไม่ได้** — จะเป็นโปรเจกต์ที่ไม่มีใครเข้าถึงได้เลย', async () => {
    await expect(
      createProject(ctx, {
        key: `ZQ${STAMP}`,
        name: 'ไม่มีสิทธิ์',
        type: 'SERVICE_DESK',
        permissionSchemeId: BigInt(99_999_999),
        workflowId,
        issueTypeIds: [issueTypeId],
      }),
    ).rejects.toThrow(ProjectNeedsSchemeError);
  });

  it('ไม่เลือกประเภทงานสร้างไม่ได้ — แจ้งเรื่องใหม่จะล้มเหลว', async () => {
    await expect(
      createProject(ctx, {
        key: `ZW${STAMP}`,
        name: 'ไม่มีประเภทงาน',
        type: 'SERVICE_DESK',
        permissionSchemeId: schemeId,
        workflowId,
        issueTypeIds: [],
      }),
    ).rejects.toThrow(ProjectNeedsWorkflowError);
  });

  it('**workflow ที่ไม่มีสถานะเริ่มต้นถูกปฏิเสธตอนสร้าง** ไม่ใช่ตอนมีคนแจ้งเรื่อง', async () => {
    // ล้มที่หน้าตั้งค่าของคนที่เลือกผิด ดีกว่าล้มที่หน้าแจ้งเรื่องของคนที่ไม่รู้เรื่องด้วย
    await expect(
      createProject(ctx, {
        key: `ZE${STAMP}`,
        name: 'workflow ไม่มีสถานะเริ่มต้น',
        type: 'SERVICE_DESK',
        permissionSchemeId: schemeId,
        workflowId: emptyWorkflowId,
        issueTypeIds: [issueTypeId],
      }),
    ).rejects.toThrow(ProjectNeedsWorkflowError);
  });

  it('ประเภทงานที่ไม่มีอยู่ถูกปฏิเสธ', async () => {
    await expect(
      createProject(ctx, {
        key: `ZR${STAMP}`,
        name: 'ประเภทงานมั่ว',
        type: 'SERVICE_DESK',
        permissionSchemeId: schemeId,
        workflowId,
        issueTypeIds: [BigInt(99_999_999)],
      }),
    ).rejects.toThrow(UnknownReferenceError);
  });

  it('**ล้มแล้วต้องไม่เหลือเศษ** — ไม่มีโปรเจกต์ครึ่งใบค้างอยู่', async () => {
    for (const k of ALL_KEYS.filter((k) => k !== KEY)) {
      expect(await prismaClient.project.count({ where: { key: k } })).toBe(0);
    }
  });
});

describe('ตัวเลือกสำหรับฟอร์ม', () => {
  it('บอกว่าชุดสิทธิ์ใบไหนถูกใช้อยู่แล้ว — เลือกใบเดิมแปลว่าสิทธิ์ผูกกัน', async () => {
    const o = await projectCreationOptions(ctx);
    const used = o.schemes.find((s) => s.usedBy.length > 0);
    expect(used).toBeDefined();
  });

  it('**บอกว่า workflow ใบไหนไม่มีสถานะเริ่มต้น** — ต้องเห็นก่อนเลือก ไม่ใช่หลังกด', async () => {
    const o = await projectCreationOptions(ctx);
    expect(o.workflows.find((w) => w.id === emptyWorkflowId.toString())?.hasInitial).toBe(false);
    expect(o.workflows.find((w) => w.id === workflowId.toString())?.hasInitial).toBe(true);
  });
});
