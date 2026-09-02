/**
 * กระดานแบบ Scrum — ต่อของจริง
 *
 * `scrum-scope.spec.ts` พิสูจน์ว่าการ **ตัดสินใจ** ถูก · ไฟล์นี้พิสูจน์ว่า
 * การตัดสินใจนั้นถูกเอาไปใช้จริง — ซึ่งเป็นคนละเรื่องกัน และเป็นช่องว่างที่
 * CLAUDE.md บันทึกไว้ว่าเทสต์ที่ประกอบข้อมูลนำเข้าเองพิสูจน์ไม่ได้
 *
 * ## คำถามที่ตอบได้เฉพาะที่นี่
 *
 *   1. โหมด scrum กรองด้วย `sprintId` จริงไหม หรือแค่คืนค่า `scope` มาสวย ๆ
 *      แล้วยังแสดงงานทั้งโปรเจกต์
 *   2. **ไม่มีรอบที่กำลังทำ แล้วได้กระดานเปล่าจริงไหม** — หรือตกไปแสดงทุกงาน
 *      ซึ่งเป็นความล้มเหลวที่อันตรายที่สุดของฟีเจอร์นี้
 *   3. โหมด kanban ยังเห็นทุกงานเหมือนเดิมไหม (ไม่ทำของเดิมพัง)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { boardOf } from '../src/modules/board';
import type { PermissionKey } from '../src/modules/permission';

const STAMP = String(Date.now()).slice(-6);
const MARK = `[scrum-${STAMP}]`;

let tenantId: bigint;
let projectId: bigint;
let projectKey: string;
let ctx: TenantContext;
let actorId: bigint;
let groupId: bigint;
let sprintId: bigint;
const grantIds: bigint[] = [];
/** คีย์ของงานที่อยู่ในรอบ · และที่อยู่นอกรอบ */
const inSprint: string[] = [];
const outside: string[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  const project = await prismaClient.project.findFirstOrThrow({ where: { key: 'PLAT' } });
  projectId = project.id;
  projectKey = project.key;
  if (project.permissionSchemeId === null) throw new Error('โปรเจกต์ PLAT ไม่มี permission scheme');

  const scheme = await prismaClient.workflowScheme.findFirstOrThrow({
    where: { projectId },
    select: { issueTypeId: true, workflowId: true },
  });
  const status = await prismaClient.workflowStatus.findFirstOrThrow({
    where: { workflowId: scheme.workflowId, isInitial: true },
    select: { id: true },
  });

  actorId = (
    await prismaClient.user.create({
      data: {
        tenantId,
        email: `scrum-${STAMP}@example.test`,
        displayName: `QA กระดาน ${STAMP}`,
      },
      select: { id: true },
    })
  ).id;
  ctx = { tenantId, actorId };

  groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `กระดาน ${STAMP}` },
      select: { id: true },
    })
  ).id;
  for (const permission of ['BROWSE_PROJECT'] as PermissionKey[]) {
    const g = await prismaClient.permissionGrant.create({
      data: { tenantId, schemeId: project.permissionSchemeId, permission, groupId },
      select: { id: true },
    });
    grantIds.push(g.id);
  }
  await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: actorId } });

  /*
    สปรินต์ของเทสต์เอง — เริ่มเป็น `planned` ก่อน เพื่อให้เคส "ยังไม่มีรอบที่
    กำลังทำ" ทดสอบได้ก่อน แล้วค่อยเปลี่ยนเป็น `active` ในเคสถัดไป
  */
  sprintId = (
    await prismaClient.sprint.create({
      data: { tenantId, projectId, name: `รอบทดสอบ ${STAMP}`, goal: `เป้าหมาย ${STAMP}`, state: 'planned' },
      select: { id: true },
    })
  ).id;

  const mk = async (n: number, withSprint: boolean): Promise<void> => {
    const itemKey = `SCR-${STAMP}-${String(n)}`;
    await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey,
        summary: `งานทดสอบกระดาน ${String(n)} ${MARK}`,
        issueTypeId: scheme.issueTypeId,
        statusId: status.id,
        reporterId: actorId,
        rank: `zzz${STAMP}${String(n)}`,
        ...(withSprint ? { sprintId } : {}),
      },
    });
    (withSprint ? inSprint : outside).push(itemKey);
  };
  await mk(1, true);
  await mk(2, true);
  await mk(3, false);
  await mk(4, false);
}, 120_000);

afterAll(async () => {
  await step('งานทดสอบ', () =>
    prismaClient.workItem.deleteMany({ where: { summary: { contains: MARK } } }),
  );
  await step('สปรินต์', () => prismaClient.sprint.deleteMany({ where: { id: sprintId } }));
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actorId } }));
  await step('สิทธิ์', () =>
    prismaClient.permissionGrant.deleteMany({ where: { id: { in: grantIds } } }),
  );
  await step('สมาชิกกลุ่ม', () => prismaClient.groupMember.deleteMany({ where: { userId: actorId } }));
  await step('ผู้ใช้', () =>
    prismaClient.user.deleteMany({ where: { email: { endsWith: `-${STAMP}@example.test` } } }),
  );
  await step('กลุ่ม', () => prismaClient.userGroup.deleteMany({ where: { id: groupId } }));

  const leftItems = await prismaClient.workItem.count({ where: { summary: { contains: MARK } } });
  const leftSprints = await prismaClient.sprint.count({ where: { id: sprintId } });
  await prismaClient.$disconnect();
  expect(leftItems, `เหลืองานของเทสต์ ${String(leftItems)} ใบ`).toBe(0);
  expect(leftSprints, 'เหลือสปรินต์ของเทสต์').toBe(0);
});

/** คีย์ทั้งหมดที่ปรากฏบนกระดาน */
function keysOn(board: { columns: Array<{ cards: Array<{ itemKey: string }> }> }): string[] {
  return board.columns.flatMap((c) => c.cards.map((k) => k.itemKey));
}

describe('กระดาน Scrum · ต่อของจริง', () => {
  /**
   * **หัวใจของไฟล์นี้**
   *
   * ยังไม่มีรอบที่กำลังทำ → กระดานต้อง **เปล่า** พร้อมเหตุผล ·
   * การตกไปแสดงงานทั้งโปรเจกต์คือความล้มเหลวที่อันตรายที่สุดของฟีเจอร์นี้
   * เพราะกระดานจะดูปกติทุกประการ
   */
  it('**ยังไม่เริ่มรอบไหน — กระดาน scrum เปล่า ไม่ใช่แสดงทั้งโปรเจกต์**', async () => {
    const board = await boardOf(ctx, projectKey, 100, 'scrum');
    expect(board.columns).toEqual([]);
    expect(board.scope.kind).toBe('no-active');
    if (board.scope.kind === 'no-active') expect(board.scope.planned).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('โหมด kanban ยังเห็นงานทั้งโปรเจกต์เหมือนเดิม', async () => {
    const board = await boardOf(ctx, projectKey, 500, 'kanban');
    const keys = keysOn(board);
    for (const k of [...inSprint, ...outside]) expect(keys, `ไม่เห็น ${k}`).toContain(k);
    expect(board.scope.kind).toBe('not-scrum');
  }, 120_000);

  it('**เริ่มรอบแล้ว — scrum เห็นเฉพาะงานในรอบ ไม่เห็นงานนอกรอบ**', async () => {
    await prismaClient.sprint.update({ where: { id: sprintId }, data: { state: 'active' } });

    const board = await boardOf(ctx, projectKey, 500, 'scrum');
    const keys = keysOn(board);
    for (const k of inSprint) expect(keys, `งานในรอบ ${k} ไม่อยู่บนกระดาน`).toContain(k);
    for (const k of outside) expect(keys, `งานนอกรอบ ${k} หลุดขึ้นกระดาน`).not.toContain(k);

    expect(board.scope.kind).toBe('sprint');
    if (board.scope.kind === 'sprint') {
      expect(board.scope.name).toBe(`รอบทดสอบ ${STAMP}`);
      expect(board.scope.goal, 'เป้าหมายของรอบต้องถูกส่งไปให้หน้าจอ').toBe(`เป้าหมาย ${STAMP}`);
    }
  }, 120_000);

  /**
   * **คำตอบต้องแปลงเป็น JSON ได้**
   *
   * เคสข้างบนเรียก service ตรง ๆ จึงไม่เคยผ่านชั้น serialise · รอบแรกที่กด
   * ในเบราว์เซอร์จริงได้ **HTTP 500 ที่ไม่มีข้อความอะไรเลย** เพราะ
   * `scope.sprintId` เป็น `bigint` และ `JSON.stringify` โยน TypeError กับมัน
   *
   * เทสต์ที่ผ่านทั้งห้าเคสอยู่แล้ว ไม่ได้บอกอะไรเกี่ยวกับเรื่องนี้เลย —
   * เพราะมันวัดคนละชั้นกับที่ผู้ใช้เจอ
   */
  it('**คำตอบทั้งก้อนแปลงเป็น JSON ได้** — ชั้นที่เทสต์ service ไม่เคยแตะ', async () => {
    const board = await boardOf(ctx, projectKey, 50, 'scrum');
    expect(() => JSON.stringify(board), 'มี BigInt หลุดออกไปทาง JSON').not.toThrow();
    const round = JSON.parse(JSON.stringify(board)) as typeof board;
    expect(round.scope.kind).toBe('sprint');
    if (round.scope.kind === 'sprint') expect(typeof round.scope.sprintId).toBe('string');
  }, 120_000);

  it('kanban ยังเห็นงานนอกรอบ แม้รอบจะเริ่มแล้ว — สองโหมดไม่ปนกัน', async () => {
    const board = await boardOf(ctx, projectKey, 500, 'kanban');
    const keys = keysOn(board);
    for (const k of outside) expect(keys).toContain(k);
  }, 120_000);

  /**
   * **ค่าปริยายต้องเป็น kanban**
   *
   * ผู้เรียกเดิมทุกรายไม่ได้ส่งโหมดมา · ถ้าค่าปริยายกลายเป็น scrum
   * กระดานของทุกโปรเจกต์ที่ไม่มีสปรินต์จะว่างเปล่าทันที
   */
  it('**ไม่ระบุโหมด = kanban** — ของเดิมไม่พัง', async () => {
    const board = await boardOf(ctx, projectKey);
    expect(board.mode).toBe('kanban');
    expect(keysOn(board).length).toBeGreaterThan(0);
  }, 120_000);
});
