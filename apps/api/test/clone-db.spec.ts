/**
 * คัดลอกเรื่อง — ต่อของจริง
 *
 * `clone-plan.spec.ts` พิสูจน์ว่า **ตัดสิน** ถูก · ไฟล์นี้พิสูจน์ว่าสิ่งที่
 * ตัดสินไว้เกิดขึ้นจริงในฐานข้อมูล — โดยเฉพาะ **สิ่งที่ต้องไม่ติดไปด้วย**
 * ซึ่งตรวจจากฟังก์ชันบริสุทธิ์ไม่ได้เลย เพราะมันเป็นเรื่องของแถวที่ถูกสร้าง
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 * ตั๋วที่คัดลอกสถานะ "ปิดแล้ว" มาด้วย จะไม่โผล่ในคิว ไม่มีใครทำ และ SLA
 * ไม่เดิน · **มันดูเหมือนตั๋วปกติทุกประการ** จนกว่าจะมีคนถามว่าทำไมเรื่องนี้
 * ไม่มีใครรับ
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { cloneWorkItem, createWorkItem, CLONE_PREFIX } from '../src/modules/workitem';
import { PermissionDeniedError, type PermissionKey } from '../src/modules/permission';

const STAMP = String(Date.now()).slice(-6);
const MARK = `[clone-${STAMP}]`;

let tenantId: bigint;
let projectId: bigint;
let projectKey: string;
let issueTypeName: string;
let ctx: TenantContext;
let readerCtx: TenantContext;
let actorId: bigint;
let readerId: bigint;
let groupId: bigint;
let readerGroupId: bigint;
let doneStatusId: bigint;
let sourceKey: string;
let sourceId: bigint;
const grantIds: bigint[] = [];
/** กลุ่มและผู้ใช้ที่เคสสร้างเพิ่มระหว่างทาง — เก็บกวาดต้องครอบด้วย */
const extraGroupIds: bigint[] = [];
const extraUserIds: bigint[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  const project = await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } });
  projectId = project.id;
  projectKey = project.key;
  if (project.permissionSchemeId === null) throw new Error('โปรเจกต์ SD ไม่มี permission scheme');

  const scheme = await prismaClient.workflowScheme.findFirstOrThrow({
    where: { projectId },
    select: { issueTypeId: true, workflowId: true, issueType: { select: { name: true } } },
  });
  issueTypeName = scheme.issueType.name;
  doneStatusId = (
    await prismaClient.workflowStatus.findFirstOrThrow({
      where: { workflowId: scheme.workflowId, category: 'DONE' },
      select: { id: true },
    })
  ).id;

  const mkUser = async (tag: string): Promise<bigint> =>
    (
      await prismaClient.user.create({
        data: {
          tenantId,
          email: `clone-${tag}-${STAMP}@example.test`,
          displayName: `QA คัดลอก ${tag} ${STAMP}`,
        },
        select: { id: true },
      })
    ).id;
  actorId = await mkUser('author');
  readerId = await mkUser('reader');
  ctx = { tenantId, actorId };
  readerCtx = { tenantId, actorId: readerId };

  const mkGroup = async (name: string, perms: PermissionKey[]): Promise<bigint> => {
    const g = await prismaClient.userGroup.create({
      data: { tenantId, name: `คัดลอก ${name} ${STAMP}` },
      select: { id: true },
    });
    for (const permission of perms) {
      const grant = await prismaClient.permissionGrant.create({
        data: { tenantId, schemeId: project.permissionSchemeId as bigint, permission, groupId: g.id },
        select: { id: true },
      });
      grantIds.push(grant.id);
    }
    return g.id;
  };
  groupId = await mkGroup('ผู้สร้าง', ['BROWSE_PROJECT', 'CREATE_ITEM', 'EDIT_ITEM']);
  /*
    **ผู้อ่านได้แค่ `BROWSE_PROJECT`** — คนที่อ่านได้อย่างเดียวต้องคัดลอกไม่ได้
    มิฉะนั้นการคัดลอกกลายเป็นทางลัดรอบด่านของการสร้าง
  */
  readerGroupId = await mkGroup('ผู้อ่าน', ['BROWSE_PROJECT']);
  await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: actorId } });
  await prismaClient.groupMember.create({
    data: { tenantId, groupId: readerGroupId, userId: readerId },
  });

  // ใบต้นทาง สร้างผ่านเส้นทางจริง เพื่อให้ฟิลด์บังคับถูกกรอกครบ
  const configs = await prismaClient.fieldConfig.findMany({
    where: { projectId, issueTypeId: scheme.issueTypeId, isRequired: true },
    select: { field: { select: { id: true, key: true, type: true, options: true } } },
  });
  const fieldValues = configs.map((c) => {
    const opts: unknown = (c.field.options as { values?: unknown } | null)?.values;
    const first = Array.isArray(opts)
      ? (opts as unknown[]).find((v): v is string => typeof v === 'string')
      : undefined;
    if (first === undefined) throw new Error(`ฟิลด์ ${c.field.key} ไม่มีตัวเลือก`);
    return { fieldId: c.field.id, type: c.field.type, value: first };
  });

  const made = await createWorkItem(ctx, {
    projectKey,
    issueTypeName,
    summary: `ต้นฉบับสำหรับคัดลอก ${MARK}`,
    description: 'รายละเอียดของใบต้นทาง',
    fieldValues,
  });
  sourceKey = made.itemKey;
  sourceId = made.id;

  /*
    **ทำให้ใบต้นทางอยู่ในสภาพที่ "คัดลอกมาแล้วผิด"** — ปิดงาน มอบหมายให้คน
    และตั้งวันครบกำหนดที่ผ่านไปแล้ว · ถ้าสำเนาได้สภาพนี้มาด้วย เคสข้างล่างจะแดง
  */
  await prismaClient.workItem.update({
    where: { id: sourceId },
    data: {
      statusId: doneStatusId,
      assigneeId: actorId,
      dueDate: new Date('2020-01-01T00:00:00.000Z'),
      resolvedAt: new Date('2020-01-02T00:00:00.000Z'),
    },
  });
}, 180_000);

afterAll(async () => {
  const mine = await prismaClient.workItem.findMany({
    where: { OR: [{ summary: { contains: MARK } }, { reporterId: { in: [actorId, readerId] } }] },
    select: { id: true },
  });
  const ids = mine.map((m) => m.id);
  if (ids.length > 0) {
    await step('แจ้งเตือน', () =>
      prismaClient.notification.deleteMany({ where: { workItemId: { in: ids } } }),
    );
    const clocks = await prismaClient.workItemSla.findMany({
      where: { workItemId: { in: ids } },
      select: { id: true },
    });
    if (clocks.length > 0) {
      await step('เหตุการณ์ SLA', () =>
        prismaClient.slaEvent.deleteMany({ where: { workItemSlaId: { in: clocks.map((c) => c.id) } } }),
      );
    }
    await step('นาฬิกา SLA', () =>
      prismaClient.workItemSla.deleteMany({ where: { workItemId: { in: ids } } }),
    );
    await step('ประวัติ', () =>
      prismaClient.workItemHistory.deleteMany({ where: { workItemId: { in: ids } } }),
    );
    await step('ค่าฟิลด์', () =>
      prismaClient.workItemFieldValue.deleteMany({ where: { workItemId: { in: ids } } }),
    );
    await step('งานทดสอบ', () => prismaClient.workItem.deleteMany({ where: { id: { in: ids } } }));
  }
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({ where: { actorId: { in: [actorId, readerId, ...extraUserIds] } } }),
  );
  await step('สิทธิ์', () =>
    prismaClient.permissionGrant.deleteMany({ where: { id: { in: grantIds } } }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { userId: { in: [actorId, readerId, ...extraUserIds] } } }),
  );
  await step('ผู้ใช้', () =>
    prismaClient.user.deleteMany({ where: { email: { endsWith: `-${STAMP}@example.test` } } }),
  );
  await step('กลุ่ม', () =>
    prismaClient.userGroup.deleteMany({ where: { id: { in: [groupId, readerGroupId, ...extraGroupIds] } } }),
  );

  const leftUsers = await prismaClient.user.count({
    where: { email: { endsWith: `-${STAMP}@example.test` } },
  });
  const leftItems = await prismaClient.workItem.count({ where: { summary: { contains: MARK } } });
  await prismaClient.$disconnect();
  expect(leftUsers, `เหลือผู้ใช้ของเทสต์ ${String(leftUsers)} คน`).toBe(0);
  expect(leftItems, `เหลืองานของเทสต์ ${String(leftItems)} ใบ`).toBe(0);
});

describe('คัดลอกเรื่อง · ต่อของจริง', () => {
  it('**สำเนามีหัวข้อ รายละเอียด และค่าฟิลด์บังคับครบ**', async () => {
    const copy = await cloneWorkItem(ctx, sourceKey);
    const row = await prismaClient.workItem.findUniqueOrThrow({
      where: { id: copy.id },
      select: { summary: true, description: true, projectId: true, issueTypeId: true },
    });
    expect(row.summary.startsWith(CLONE_PREFIX)).toBe(true);
    expect(row.summary).toContain(MARK);
    expect(JSON.stringify(row.description)).toContain('รายละเอียดของใบต้นทาง');

    const srcValues = await prismaClient.workItemFieldValue.count({ where: { workItemId: sourceId } });
    const copyValues = await prismaClient.workItemFieldValue.count({ where: { workItemId: copy.id } });
    expect(copyValues, 'ค่าฟิลด์ของสำเนาไม่ครบเท่าต้นฉบับ').toBe(srcValues);
    expect(copyValues).toBeGreaterThan(0);
  }, 180_000);

  /**
   * **หัวใจของไฟล์นี้**
   *
   * ใบต้นทางถูกทำให้ปิดแล้ว มอบหมายแล้ว และเลยกำหนดแล้ว · สำเนาต้องไม่ได้
   * สภาพเหล่านั้นมาเลยสักอย่าง
   */
  it('**สถานะ ผู้รับผิดชอบ วันครบกำหนด และเวลาปิด ไม่ติดไปกับสำเนา**', async () => {
    const copy = await cloneWorkItem(ctx, sourceKey);
    const row = await prismaClient.workItemFieldValue.findFirst({ where: { workItemId: copy.id } });
    expect(row, 'สำเนาไม่มีค่าฟิลด์เลย').not.toBeNull();

    const c = await prismaClient.workItem.findUniqueOrThrow({
      where: { id: copy.id },
      select: {
        assigneeId: true,
        dueDate: true,
        resolvedAt: true,
        resolutionId: true,
        status: { select: { category: true, isInitial: true } },
      },
    });
    expect(c.status.isInitial, 'สำเนาไม่ได้เริ่มที่สถานะแรกของ workflow').toBe(true);
    expect(c.status.category, 'สำเนาถูกสร้างมาในสภาพที่จบแล้ว').not.toBe('DONE');
    expect(c.assigneeId, 'ผู้รับผิดชอบติดมากับสำเนา').toBeNull();
    expect(c.dueDate, 'วันครบกำหนดติดมากับสำเนา').toBeNull();
    expect(c.resolvedAt, 'เวลาปิดติดมากับสำเนา').toBeNull();
    expect(c.resolutionId, 'ผลการแก้ไขติดมากับสำเนา').toBeNull();
  }, 180_000);

  it('**สำเนาได้คีย์ของตัวเอง และเป็นคนละใบกับต้นฉบับ**', async () => {
    const copy = await cloneWorkItem(ctx, sourceKey);
    expect(copy.itemKey).not.toBe(sourceKey);
    expect(copy.itemKey.startsWith(`${projectKey}-`)).toBe(true);
  }, 180_000);

  /** สำเนาของสำเนา ต้องไม่ได้คำนำหน้าซ้อนกัน — ตรวจผ่านเส้นทางจริง */
  it('**คัดลอกสำเนาอีกที ไม่ได้คำนำหน้าซ้อน**', async () => {
    const first = await cloneWorkItem(ctx, sourceKey);
    const second = await cloneWorkItem(ctx, first.itemKey);
    const row = await prismaClient.workItem.findUniqueOrThrow({
      where: { id: second.id },
      select: { summary: true },
    });
    expect(row.summary.startsWith(`${CLONE_PREFIX}${CLONE_PREFIX}`)).toBe(false);
  }, 180_000);

  /**
   * **คนที่อ่านได้อย่างเดียว คัดลอกไม่ได้**
   *
   * ถ้าคัดลอกได้ การคัดลอกกลายเป็นทางลัดรอบด่านของการสร้างเรื่อง
   */
  it('**ต้องมีสิทธิ์สร้างเรื่อง ไม่ใช่แค่เปิดดูได้**', async () => {
    await expect(cloneWorkItem(readerCtx, sourceKey)).rejects.toThrow(PermissionDeniedError);
  }, 180_000);

  /**
   * **สร้างได้แต่เปิดดูไม่ได้ — ต้องคัดลอกไม่ได้**
   *
   * `CREATE_ITEM` **ไม่ได้ implied จาก `BROWSE_PROJECT`** (ดู `IMPLIED_BY`
   * ซึ่งมีแค่ `MANAGE_ATTACHMENT → EDIT_ITEM`) · รูปสิทธิ์นี้จึงตั้งได้จริง
   * จากหน้าจอ
   *
   * ถ้าไม่มีด่านตอนอ่านใบต้นทาง คนแบบนี้จะคัดลอกเรื่องที่ตัวเองเปิดดูไม่ได้ ·
   * **หัวข้อของใบต้นทางกลายเป็นหัวข้อของสำเนา ซึ่งเขาเห็นได้** — ข้อมูลรั่ว
   * ผ่านฟีเจอร์ที่ดูเหมือนไม่เกี่ยวกับการอ่าน
   *
   * เคสนี้คือเคสเดียวที่ทำให้ด่านนั้นแดงได้ · สองเคสข้างล่างถูกด่านของ
   * `createWorkItem` รับไว้ก่อน จึงไม่พิสูจน์อะไรเกี่ยวกับด่านนี้เลย
   */
  it('**สร้างได้แต่เปิดดูไม่ได้ — คัดลอกไม่ได้**', async () => {
    const g = await prismaClient.userGroup.create({
      data: { tenantId, name: `คัดลอก สร้างอย่างเดียว ${STAMP}` },
      select: { id: true },
    });
    const scheme = (
      await prismaClient.project.findFirstOrThrow({
        where: { id: projectId },
        select: { permissionSchemeId: true },
      })
    ).permissionSchemeId as bigint;
    const grant = await prismaClient.permissionGrant.create({
      data: { tenantId, schemeId: scheme, permission: 'CREATE_ITEM', groupId: g.id },
      select: { id: true },
    });
    grantIds.push(grant.id);
    const u = await prismaClient.user.create({
      data: {
        tenantId,
        email: `clone-creator-${STAMP}@example.test`,
        displayName: `QA สร้างอย่างเดียว ${STAMP}`,
      },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId: g.id, userId: u.id } });
    extraGroupIds.push(g.id);
    extraUserIds.push(u.id);

    await expect(cloneWorkItem({ tenantId, actorId: u.id }, sourceKey)).rejects.toThrow(
      PermissionDeniedError,
    );
  }, 180_000);

  /**
   * **คนที่เปิดดูโปรเจกต์ไม่ได้เลย ถูกปฏิเสธตั้งแต่ตอนอ่านใบต้นทาง**
   *
   * ด่านคนละอันกับเคสข้างบน · ถ้าไม่มีด่านนี้ คนนอกจะแยกออกว่า "ไม่มีเรื่องนี้"
   * (404) ต่างจาก "มีแต่คุณสร้างไม่ได้" (403) ซึ่งบอกใบ้ว่าเลขที่เรื่องมีอยู่จริง
   */
  it('**คนที่ไม่อยู่กลุ่มไหนเลย ถูกปฏิเสธตั้งแต่อ่านใบต้นทาง**', async () => {
    const outsider = await prismaClient.user.create({
      data: {
        tenantId,
        email: `clone-outsider-${STAMP}@example.test`,
        displayName: `QA คนนอก ${STAMP}`,
      },
      select: { id: true },
    });
    await expect(
      cloneWorkItem({ tenantId, actorId: outsider.id }, sourceKey),
    ).rejects.toThrow(PermissionDeniedError);
  }, 180_000);

  it('เรื่องที่ไม่มีอยู่ ตอบว่าไม่พบ ไม่ใช่สร้างใบเปล่า', async () => {
    const before = await prismaClient.workItem.count();
    await expect(cloneWorkItem(ctx, `ไม่มี-${STAMP}`)).rejects.toThrow();
    expect(await prismaClient.workItem.count()).toBe(before);
  }, 180_000);
});
