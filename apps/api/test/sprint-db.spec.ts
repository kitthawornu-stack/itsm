/**
 * Sprint — ต่อของจริง
 *
 * `sprint-plan.spec.ts` ประกอบสถานะขึ้นมาเองในเทสต์ จึงพิสูจน์ได้แค่ว่า
 * *ถ้า* สถานะหน้าตาแบบนั้นเข้ามา ผลจะถูก · ไฟล์นี้ถามสิ่งที่เอนจินตอบไม่ได้:
 *
 *   1. **ภาพตอนเริ่มถูกเก็บลงฐานข้อมูลจริงไหม** — ถ้าไม่ คำถาม
 *      "ทำได้ตามที่รับปากไหม" ตอบไม่ได้ตลอดกาล
 *   2. **งานค้างไปไหนตอนปิด** — งานที่ไม่อยู่สปรินต์ไหนและไม่อยู่ backlog
 *      คืองานที่หายจากทุกหน้าจอโดยไม่มีใครลบ
 *   3. **สปรินต์ที่ปิดแล้วรับงานใหม่ได้ไหม** — ถ้าได้ ตัวเลขในรายงาน
 *      ของรอบที่ผ่านมาจะเปลี่ยนย้อนหลัง
 *   4. **`MANAGE_SPRINT` บังคับใช้จริงไหม** — คีย์นี้เพิ่งออกจากรายการ
 *      "ยังไม่บังคับใช้" คอมมิตนี้
 *
 * เทสต์สร้างโปรเจกต์ ผู้ใช้ กลุ่ม และงานของตัวเองทั้งหมด แล้วลบทิ้ง
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toUtcDate, type TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError, type PermissionKey } from '../src/modules/permission';
import {
  DuplicateSprintNameError,
  InvalidStoryPointsError,
  SprintClosedError,
  OneActiveSprintError,
  NotStartedError,
  backlogOf,
  completeSprint,
  createSprint,
  listSprints,
  moveItemToSprint,
  setStoryPoints,
  startSprint,
  velocityFor,
} from '../src/modules/sprint';

const STAMP = String(Date.now()).slice(-6);
const STARTED_AT = new Date();
const PKEY = `SPR${STAMP}`;
const T = (iso: string): ReturnType<typeof toUtcDate> => toUtcDate(iso);

let tenantId: bigint;
let projectId: bigint;
let ctx: TenantContext;
let outsiderCtx: TenantContext;
const userIds: bigint[] = [];
const groupIds: bigint[] = [];
let schemeId: bigint;
let workflowId: bigint;
let issueTypeId: bigint;
let todoStatusId: bigint;
let doneStatusId: bigint;
const itemKeys: string[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function member(tag: string, permissions: PermissionKey[]): Promise<TenantContext> {
  const group = await prismaClient.userGroup.create({
    data: { tenantId, name: `QA สปรินต์ ${tag} ${STAMP}` },
    select: { id: true },
  });
  groupIds.push(group.id);
  await prismaClient.permissionGrant.createMany({
    data: permissions.map((permission) => ({ tenantId, schemeId, permission, groupId: group.id })),
  });
  const user = await prismaClient.user.create({
    data: {
      tenantId,
      email: `qa-spr-${tag}-${STAMP}@example.invalid`,
      displayName: `QA ${tag} ${STAMP}`,
    },
    select: { id: true },
  });
  userIds.push(user.id);
  await prismaClient.groupMember.create({ data: { tenantId, groupId: group.id, userId: user.id } });
  return { tenantId, actorId: user.id };
}

/** งานของเทสต์นี้ — คีย์มี stamp เสมอ ไม่มีทางชนกับของ seed */
async function item(tag: string, points: number | null, done = false): Promise<string> {
  const key = `${PKEY}-${tag}`;
  await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey: key,
      issueTypeId,
      statusId: done ? doneStatusId : todoStatusId,
      reporterId: userIds[0] ?? BigInt(0),
      summary: `งานทดสอบสปรินต์ ${tag} ${STAMP}`,
      rank: `zzs${STAMP}${tag}`,
      ...(points === null ? {} : { storyPoints: points }),
    },
  });
  itemKeys.push(key);
  return key;
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์สปรินต์ ${STAMP}` },
    select: { id: true },
  });
  schemeId = scheme.id;

  /*
    ยืม workflow กับประเภทงานของ seed มาใช้ (อ่านอย่างเดียว) แต่ **สร้าง
    โปรเจกต์ของตัวเอง** — สปรินต์ผูกกับโปรเจกต์ และการทดสอบ "หนึ่งรอบต่อ
    โปรเจกต์" จะรบกวนงานจริงถ้าไปใช้โปรเจกต์ seed
  */
  const tmpl = await prismaClient.workItem.findFirstOrThrow({
    select: { issueTypeId: true, status: { select: { workflowId: true } } },
  });
  issueTypeId = tmpl.issueTypeId;
  workflowId = tmpl.status.workflowId;
  todoStatusId = (
    await prismaClient.workflowStatus.findFirstOrThrow({
      where: { workflowId, category: 'TODO' },
      select: { id: true },
    })
  ).id;
  doneStatusId = (
    await prismaClient.workflowStatus.findFirstOrThrow({
      where: { workflowId, category: 'DONE' },
      select: { id: true },
    })
  ).id;

  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: PKEY,
      name: `โปรเจกต์ทดสอบสปรินต์ ${STAMP}`,
      type: 'SOFTWARE',
      permissionSchemeId: schemeId,
    },
    select: { id: true },
  });
  projectId = project.id;

  ctx = await member('ผู้จัดรอบ', [
    'BROWSE_PROJECT',
    'MANAGE_SPRINT',
    'EDIT_ITEM',
    'VIEW_REPORT',
  ]);
  outsiderCtx = await member('คนดูอย่างเดียว', ['BROWSE_PROJECT']);
}, 120_000);

afterAll(async () => {
  await step('งานของเทสต์', () =>
    prismaClient.workItem.deleteMany({ where: { itemKey: { startsWith: PKEY } } }),
  );
  await step('สปรินต์ของเทสต์', () =>
    prismaClient.sprint.deleteMany({ where: { projectId } }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({
      where: { entityType: 'sprint', createdAt: { gte: STARTED_AT } },
    }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { groupId: { in: groupIds } } }),
  );
  await step('สิทธิ์ที่เทสต์ให้', () =>
    prismaClient.permissionGrant.deleteMany({ where: { groupId: { in: groupIds } } }),
  );
  await step('กลุ่ม', () => prismaClient.userGroup.deleteMany({ where: { id: { in: groupIds } } }));
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: PKEY } }));
  await step('ชุดสิทธิ์', () => prismaClient.permissionScheme.deleteMany({ where: { id: schemeId } }));
  await step('ผู้ใช้', () => prismaClient.user.deleteMany({ where: { id: { in: userIds } } }));

  const left = await prismaClient.workItem.count({ where: { itemKey: { startsWith: PKEY } } });
  if (left > 0) console.error(`เหลืองานของเทสต์ค้างอยู่ ${String(left)} ใบ`);
  await prismaClient.$disconnect();
});

// ============================================================

describe('สปรินต์(จริง) · A · ทะเบียนและ backlog', () => {
  it('สร้างแล้วอ่านกลับได้ พร้อมสถานะ planned', async () => {
    await createSprint(ctx, { projectKey: PKEY, name: 'รอบที่ 1', goal: 'ทดสอบ' });
    const rows = await listSprints(ctx, PKEY);
    expect(rows.map((r) => r.name)).toContain('รอบที่ 1');
    expect(rows.find((r) => r.name === 'รอบที่ 1')?.state).toBe('planned');
  });

  it('ชื่อซ้ำในโปรเจกต์เดียวกันถูกปฏิเสธ', async () => {
    await expect(createSprint(ctx, { projectKey: PKEY, name: 'รอบที่ 1' })).rejects.toThrow(
      DuplicateSprintNameError,
    );
  });

  /** งานที่ยังไม่อยู่สปรินต์ไหน = backlog · ไม่ต้องมีค่าพิเศษแทน */
  it('งานที่สร้างใหม่อยู่ใน backlog โดยอัตโนมัติ', async () => {
    await item('A', 3);
    await item('B', 5);
    const { rows: b } = await backlogOf(ctx, PKEY);
    expect(b.map((r) => r.itemKey)).toEqual([`${PKEY}-A`, `${PKEY}-B`]);
  });

  /** backlog คือ "สิ่งที่ยังต้องทำ" ไม่ใช่ประวัติทั้งหมดของโปรเจกต์ */
  it('งานที่ปิดแล้วไม่อยู่ใน backlog', async () => {
    await item('ปิดแล้ว', 2, true);
    const { rows: b } = await backlogOf(ctx, PKEY);
    expect(b.map((r) => r.itemKey)).not.toContain(`${PKEY}-ปิดแล้ว`);
  });

  /**
   * ขีดจำกัดที่ตัดเงียบ ๆ ทำให้คนเห็น 200 แถวแล้วเชื่อว่านั่นคือทั้งหมด
   *
   * เจอตอนกดจริงในเบราว์เซอร์: โปรเจกต์ PLAT มี 1,100 ใบใน backlog
   * แต่หน้าจอแสดง 200 โดยไม่มีอะไรบอกว่ายังมีอีก
   */
  it('บอกยอดรวมมาด้วย ไม่ใช่แค่แถวที่ตัดมาแล้ว', async () => {
    const r = await backlogOf(ctx, PKEY, 1);
    expect(r.rows).toHaveLength(1);
    expect(r.total).toBeGreaterThan(1);
  });

  it('คนที่ไม่มีสิทธิ์จัดรอบ สร้างสปรินต์ไม่ได้', async () => {
    await expect(
      createSprint(outsiderCtx, { projectKey: PKEY, name: `รอบของคนนอก ${STAMP}` }),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

describe('สปรินต์(จริง) · B · แต้มของงาน', () => {
  it('ตั้งแต้มแล้วอ่านกลับได้', async () => {
    await setStoryPoints(ctx, `${PKEY}-A`, 8);
    const { rows: b } = await backlogOf(ctx, PKEY);
    expect(b.find((r) => r.itemKey === `${PKEY}-A`)?.storyPoints).toBe(8);
  });

  /**
   * `null` = ยังไม่ประเมิน ต่างจากประเมินแล้วได้ศูนย์
   *
   * ศูนย์แปลว่า "ทำแล้วไม่มีขนาด" · `null` แปลว่า "ยังไม่มีใครดู" —
   * สองอย่างนี้ตอบคำถามคนละข้อในการวางแผน
   */
  it('ล้างแต้มได้ และไม่กลายเป็นศูนย์', async () => {
    await setStoryPoints(ctx, `${PKEY}-A`, null);
    const { rows: b } = await backlogOf(ctx, PKEY);
    expect(b.find((r) => r.itemKey === `${PKEY}-A`)?.storyPoints).toBeNull();
    await setStoryPoints(ctx, `${PKEY}-A`, 3);
  });

  it('แต้มติดลบถูกปฏิเสธ ไม่ใช่เก็บแล้วไปลดยอดรวมทีหลัง', async () => {
    await expect(setStoryPoints(ctx, `${PKEY}-A`, -1)).rejects.toThrow(InvalidStoryPointsError);
  });

  it('การตั้งแต้มถูกบันทึกในประวัติของงาน', async () => {
    await setStoryPoints(ctx, `${PKEY}-B`, 13);
    const rows = await prismaClient.workItemHistory.findMany({
      where: { workItem: { itemKey: `${PKEY}-B` }, field: 'storyPoints' },
      select: { newValue: true },
    });
    expect(rows.map((r) => r.newValue)).toContain('13');
  });
});

describe('สปรินต์(จริง) · C · เริ่มและปิด', () => {
  let s1 = BigInt(0);

  it('ย้ายงานเข้าสปรินต์ได้ และหายจาก backlog', async () => {
    s1 = (await createSprint(ctx, { projectKey: PKEY, name: `รอบวิ่ง ${STAMP}` })).id;
    await moveItemToSprint(ctx, `${PKEY}-A`, s1);
    await moveItemToSprint(ctx, `${PKEY}-B`, s1);
    const { rows: b } = await backlogOf(ctx, PKEY);
    expect(b.map((r) => r.itemKey)).not.toContain(`${PKEY}-A`);
  });

  /**
   * **ภาพตอนเริ่มต้องลงฐานข้อมูลจริง**
   *
   * เอนจินคำนวณให้ถูกแล้ว แต่ถ้าไม่มีใครเขียนลง คำถาม "ทำได้ตามที่รับปากไหม"
   * ตอบไม่ได้ตลอดกาล — และไม่มีอะไรฟ้อง เพราะหน้าจอก็แค่ไม่แสดงตัวเลขนั้น
   */
  it('กดเริ่มแล้วคำรับปากถูกเก็บลงฐานข้อมูล', async () => {
    await startSprint(ctx, s1, T('2026-09-01T02:00:00.000Z'));
    const row = await prismaClient.sprint.findFirstOrThrow({ where: { id: s1 } });
    expect(row.state).toBe('active');
    expect(row.startedAt).not.toBeNull();
    expect(row.committedCount).toBe(2);
    expect(Number(row.committedPoints)).toBe(16);
  });

  it('มีสปรินต์ที่กำลังทำอยู่ เริ่มอันที่สองไม่ได้', async () => {
    const s2 = (await createSprint(ctx, { projectKey: PKEY, name: `รอบซ้อน ${STAMP}` })).id;
    await expect(startSprint(ctx, s2, T('2026-09-02T02:00:00.000Z'))).rejects.toThrow(
      OneActiveSprintError,
    );
  });

  it('สปรินต์ที่ยังไม่เริ่ม ปิดไม่ได้', async () => {
    const s3 = (await createSprint(ctx, { projectKey: PKEY, name: `รอบยังไม่เริ่ม ${STAMP}` })).id;
    await expect(completeSprint(ctx, s3, null)).rejects.toThrow(NotStartedError);
  });

  /**
   * **งานค้างต้องไปอยู่ที่ที่บอกไว้ ไม่ใช่ค้างในสปรินต์ที่ปิดแล้ว**
   *
   * ถ้าค้างอยู่ มันจะไม่โผล่ทั้งใน backlog และในสปรินต์ถัดไป — หายจาก
   * ทุกหน้าจอโดยไม่มีใครลบมัน
   */
  it('ปิดแล้วงานที่ยังไม่เสร็จกลับเข้า backlog ตามที่สั่ง', async () => {
    // ทำ A ให้เสร็จ ปล่อย B ค้าง
    await prismaClient.workItem.updateMany({
      where: { itemKey: `${PKEY}-A` },
      data: { statusId: doneStatusId },
    });
    const r = await completeSprint(ctx, s1, null, T('2026-09-15T02:00:00.000Z'));
    expect(r.doneCount).toBe(1);
    expect(r.undoneCount).toBe(1);
    expect(r.completedPoints).toBe(3);

    const { rows: b } = await backlogOf(ctx, PKEY);
    expect(b.map((x) => x.itemKey)).toContain(`${PKEY}-B`);
  });

  it('ผลตอนปิดถูกเก็บลงฐานข้อมูล', async () => {
    const row = await prismaClient.sprint.findFirstOrThrow({ where: { id: s1 } });
    expect(row.state).toBe('completed');
    expect(row.completedCount).toBe(1);
    expect(Number(row.completedPoints)).toBe(3);
  });

  it('สปรินต์ที่ปิดแล้ว ปิดซ้ำไม่ได้', async () => {
    await expect(completeSprint(ctx, s1, null)).rejects.toThrow(SprintClosedError);
  });

  /** ตัวเลขในรายงานของรอบที่ผ่านมาต้องไม่เปลี่ยนย้อนหลัง */
  it('สปรินต์ที่ปิดแล้ว รับงานใหม่ไม่ได้', async () => {
    await expect(moveItemToSprint(ctx, `${PKEY}-B`, s1)).rejects.toThrow(SprintClosedError);
  });
});

describe('สปรินต์(จริง) · D · ความเร็ว', () => {
  it('คำนวณจากสปรินต์ที่ปิดแล้วเท่านั้น และบอกจำนวนรอบ', async () => {
    const v = await velocityFor(ctx, PKEY);
    expect(v.usedSprints).toBe(1);
    expect(v.average).toBe(3);
  });

  it('โปรเจกต์ที่ยังไม่มีสปรินต์ปิดเลย ได้ null ไม่ใช่ศูนย์', async () => {
    const other = await prismaClient.project.create({
      data: {
        tenantId,
        key: `${PKEY}B`,
        name: `โปรเจกต์ว่าง ${STAMP}`,
        type: 'SOFTWARE',
        permissionSchemeId: schemeId,
      },
      select: { key: true },
    });
    const v = await velocityFor(ctx, other.key);
    expect(v.average).toBeNull();
    expect(v.usedSprints).toBe(0);
    await prismaClient.project.deleteMany({ where: { key: `${PKEY}B` } });
  });
});
