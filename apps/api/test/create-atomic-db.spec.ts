/**
 * การสร้างตั๋วต้องเป็นหน่วยเดียว — ได้ตั๋วที่ครบ หรือไม่ได้ตั๋วเลย
 *
 * ## ทำไมต้องมีไฟล์นี้
 *
 * เดิมการสร้างตั๋วทำสองทรานแซกชัน: สร้างงานหนึ่ง แล้วเขียนค่าฟิลด์อีกหนึ่ง ·
 * คอมเมนต์ตรงนั้นเขียนไว้ว่าทำแบบนี้ได้เพราะ "ค่าบังคับถูกตรวจไปแล้ว
 * ที่เหลือคือการเขียนซึ่งกู้ได้ด้วย `rebuildSnapshot` ถ้าล้ม"
 *
 * **ทั้งสองข้ออ้างไม่ถูก** · `rebuildSnapshot` สร้าง snapshot ใหม่จาก EAV ได้
 * แต่ค่าที่ไม่เคยถูกเขียนลง EAV เลย ไม่มีอะไรให้สร้างใหม่จาก
 *
 * วัดจริงด้วย `loadtest:write 5 6` ตอนยังมี deadlock อยู่: **10 จาก 30 คำขอ
 * ตอบ 500 แต่การเก็บกวาดลบตั๋วไป 30 ใบ** — ส่วนต่างสิบใบนั้นคือตั๋วที่ค้างอยู่
 * โดยขาดฟิลด์บังคับ เดินนาฬิกา SLA อยู่ในคิว และผู้แจ้งเชื่อว่าแจ้งไม่สำเร็จ
 * จึงแจ้งซ้ำ — เสียสองทางพร้อมกัน
 *
 * **ตั๋วที่ไม่ครบ แย่กว่าไม่มีตั๋ว** เพราะมันดูเหมือนของจริงจนกว่าจะมีคนเปิดดู
 *
 * ## จุดที่ทำให้ล้มได้แน่นอน
 *
 * `work_item_field_value.field_id` มี foreign key ไป `field_definition` ·
 * ส่ง `fieldId` ที่ไม่มีอยู่จริงเข้าไป จะชน FK เสมอ ไม่ขึ้นกับจังหวะ —
 * ต่างจาก deadlock ซึ่งจำลองให้แน่นอนไม่ได้
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { createWorkItem } from '../src/modules/workitem';
import type { PermissionKey } from '../src/modules/permission';

const STAMP = String(Date.now()).slice(-6);
/** ทุกหัวข้อที่ไฟล์นี้สร้างมีลายเซ็นนี้ — เก็บกวาดถามจากมัน ไม่ใช่จาก id ที่จำไว้ */
const MARK = `[atomic-${STAMP}]`;

let tenantId: bigint;
let projectKey: string;
let issueTypeName: string;
let ctx: TenantContext;
let actorId: bigint;
let groupId: bigint;
const grantIds: bigint[] = [];
/** ฟิลด์บังคับของโปรเจกต์+ชนิดนี้ พร้อมค่าที่ใช้ได้จริง */
let goodFields: Array<{ fieldId: bigint; type: 'SELECT'; value: string }> = [];

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
  projectKey = project.key;
  if (project.permissionSchemeId === null) throw new Error('โปรเจกต์ SD ไม่มี permission scheme');

  /*
    ชนิดงานอ่านจาก `workflow_scheme` ซึ่งเป็นที่ที่ระบบใช้ตัดสินว่าโปรเจกต์ไหน
    รับชนิดไหน — ไม่ใช่จากตาราง `issue_type` เฉย ๆ ซึ่งรวมชนิดของทุกโปรเจกต์
    (บทเรียนจากเครื่องมือวัดโหลดที่รายงานว่า "ระบบเขียนไม่ได้เลย")
  */
  const scheme = await prismaClient.workflowScheme.findFirstOrThrow({
    where: { projectId: project.id },
    select: { issueTypeId: true, issueType: { select: { name: true } } },
  });
  issueTypeName = scheme.issueType.name;

  const configs = await prismaClient.fieldConfig.findMany({
    where: { projectId: project.id, issueTypeId: scheme.issueTypeId, isRequired: true },
    select: { field: { select: { id: true, options: true } } },
  });
  goodFields = configs.map((c) => {
    const opts: unknown = (c.field.options as { values?: unknown } | null)?.values;
    const values = Array.isArray(opts)
      ? (opts as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    const first = values[0];
    if (first === undefined) {
      throw new Error('ฟิลด์บังคับไม่มีตัวเลือกให้เลือก — เทสต์นี้ประกอบข้อมูลนำเข้าไม่ได้');
    }
    return { fieldId: c.field.id, type: 'SELECT' as const, value: first };
  });

  actorId = (
    await prismaClient.user.create({
      data: {
        tenantId,
        email: `atomic-${STAMP}@example.test`,
        displayName: `QA อะตอมมิก ${STAMP}`,
      },
      select: { id: true },
    })
  ).id;
  ctx = { tenantId, actorId };

  // กลุ่มของเทสต์เอง ไม่แตะกลุ่มของ seed
  groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `อะตอมมิก ${STAMP}` },
      select: { id: true },
    })
  ).id;
  for (const permission of ['BROWSE_PROJECT', 'CREATE_ITEM'] as PermissionKey[]) {
    const g = await prismaClient.permissionGrant.create({
      data: { tenantId, schemeId: project.permissionSchemeId, permission, groupId },
      select: { id: true },
    });
    grantIds.push(g.id);
  }
  await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: actorId } });
}, 120_000);

afterAll(async () => {
  const mine = await prismaClient.workItem.findMany({
    where: { summary: { contains: MARK } },
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
        prismaClient.slaEvent.deleteMany({
          where: { workItemSlaId: { in: clocks.map((c) => c.id) } },
        }),
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
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actorId } }));
  await step('สิทธิ์', () =>
    prismaClient.permissionGrant.deleteMany({ where: { id: { in: grantIds } } }),
  );
  await step('สมาชิกกลุ่ม', () => prismaClient.groupMember.deleteMany({ where: { userId: actorId } }));
  await step('ผู้ใช้', () =>
    prismaClient.user.deleteMany({ where: { email: { endsWith: `-${STAMP}@example.test` } } }),
  );
  await step('กลุ่ม', () => prismaClient.userGroup.deleteMany({ where: { id: groupId } }));

  const left = await prismaClient.workItem.count({ where: { summary: { contains: MARK } } });
  const users = await prismaClient.user.count({
    where: { email: { endsWith: `-${STAMP}@example.test` } },
  });
  await prismaClient.$disconnect();
  expect(left, `เหลืองานของเทสต์ ${String(left)} ใบ`).toBe(0);
  expect(users, `เหลือผู้ใช้ของเทสต์ ${String(users)} คน`).toBe(0);
});

describe('สร้างตั๋ว · ครบหรือไม่มีเลย', () => {
  it('**ตั๋วที่สร้างสำเร็จ มีค่าฟิลด์ครบตั้งแต่วินาทีแรก**', async () => {
    const created = await createWorkItem(ctx, {
      projectKey,
      issueTypeName,
      summary: `สร้างครบ ${MARK}`,
      fieldValues: goodFields.map((f) => ({
        fieldId: f.fieldId,
        type: f.type,
        value: f.value,
      })),
    });

    const values = await prismaClient.workItemFieldValue.count({
      where: { workItemId: created.id },
    });
    expect(values, 'ตั๋วถูกสร้างแต่ไม่มีค่าฟิลด์').toBe(goodFields.length);

    // snapshot ถูกเขียนในทรานแซกชันเดียวกัน ไม่ใช่รอบสอง
    const row = await prismaClient.workItem.findUniqueOrThrow({
      where: { id: created.id },
      select: { fieldSnapshot: true },
    });
    expect(Object.keys(row.fieldSnapshot as object).length).toBeGreaterThan(0);
  }, 120_000);

  /**
   * **หัวใจของไฟล์นี้**
   *
   * เขียนค่าฟิลด์ล้ม → ตั๋วต้องไม่เกิด · ก่อนแก้ ตั๋วจะถูกสร้างค้างไว้
   * และเคสนี้จะเจอมันด้วยการนับก่อน–หลัง
   */
  it('**เขียนค่าฟิลด์ล้ม แล้วไม่มีตั๋วเกิดขึ้นเลย**', async () => {
    const before = await prismaClient.workItem.count();

    // fieldId ที่ไม่มีอยู่จริง → ชน foreign key เสมอ ไม่ขึ้นกับจังหวะ
    const ghost = 9_000_000_000n;
    await expect(
      createWorkItem(ctx, {
        projectKey,
        issueTypeName,
        summary: `ต้องไม่เกิด ${MARK}`,
        fieldValues: [{ fieldId: ghost, type: 'SELECT', value: 'อะไรก็ได้' }],
      }),
    ).rejects.toThrow();

    expect(await prismaClient.workItem.count(), 'มีตั๋วเกิดขึ้นทั้งที่การเขียนล้ม').toBe(before);
    expect(
      await prismaClient.workItem.count({ where: { summary: { contains: 'ต้องไม่เกิด' } } }),
      'ตั๋วที่ไม่ควรเกิด ถูกสร้างค้างไว้',
    ).toBe(0);
  }, 120_000);

  /**
   * **ไม่มีเศษค้าง** — ตั๋วที่ล้มต้องไม่ทิ้ง audit ประวัติ หรือค่าฟิลด์ไว้
   *
   * ทรานแซกชันที่ย้อนกลับควรลบทุกอย่าง · เคสนี้ยืนยันแทนที่จะเชื่อ
   */
  it('**ตั๋วที่ล้ม ไม่ทิ้ง audit หรือประวัติไว้**', async () => {
    const auditBefore = await prismaClient.auditLog.count({ where: { actorId } });
    const historyBefore = await prismaClient.workItemHistory.count({ where: { actorId } });

    await expect(
      createWorkItem(ctx, {
        projectKey,
        issueTypeName,
        summary: `ต้องไม่เกิดอีกใบ ${MARK}`,
        fieldValues: [{ fieldId: 9_000_000_001n, type: 'SELECT', value: 'x' }],
      }),
    ).rejects.toThrow();

    expect(await prismaClient.auditLog.count({ where: { actorId } })).toBe(auditBefore);
    expect(await prismaClient.workItemHistory.count({ where: { actorId } })).toBe(historyBefore);
  }, 120_000);

  /** ไม่ส่งค่าฟิลด์มาเลย ยังต้องสร้างได้ — ชนิดงานที่ไม่มีฟิลด์บังคับมีจริง */
  it('ไม่มีค่าฟิลด์เลย ก็สร้างได้ตามปกติ', async () => {
    const created = await createWorkItem(ctx, {
      projectKey,
      issueTypeName,
      summary: `ไม่มีฟิลด์ ${MARK}`,
    });
    expect(created.itemKey.startsWith(`${projectKey}-`)).toBe(true);
  }, 120_000);
});
