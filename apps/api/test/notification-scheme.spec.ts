/**
 * สวิตช์แจ้งเตือนกับข้อมูลจริง — เทสต์เป็นข้อกำหนด
 *
 * `notification-policy.spec.ts` พิสูจน์ว่าตรรกะตัดสินถูก · **มันไม่ได้พิสูจน์ว่า
 * มีอะไรอ่านสวิตช์จากฐานข้อมูลมาให้ตรรกะนั้นเลย** — ตอนลบกลไกออกทีละบรรทัด
 * เพื่อพิสูจน์ว่าแดงได้ ด่านสามในสี่ยังเขียวสนิท เพราะเทสต์ที่มีอยู่แตะแต่
 * ฟังก์ชันบริสุทธิ์ · นี่คือไฟล์ที่ปิดช่องนั้น
 *
 * สี่ข้อที่ต้องถูก:
 *
 *   1. **ไม่ตั้งอะไรเลย = ได้รับ** — ค่าปริยายต้องไม่เปลี่ยนพฤติกรรมเดิม
 *      การเพิ่มตารางสวิตช์แล้วทำให้ทุกคนหยุดได้รับ คือการทำลายระบบเงียบ ๆ
 *   2. **ผู้ดูแลปิดแล้วไม่มีแถวเกิดขึ้น** — ไม่ใช่เขียนแถวไว้แล้วซ่อนบนหน้าจอ
 *   3. **สวิตช์ระดับโปรเจกต์ต้องถูกอ่านจริง** ไม่ใช่อ่านแต่สวิตช์รวม
 *   4. **แถวระดับทีม (ไม่มีเจ้าของ) ต้องไม่ไปหยิบค่าของใครมาใช้**
 */
import type { TenantContext } from '@itsm/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { createNotifications } from '../src/modules/notification';

const STAMP = String(Date.now()).slice(-6);
const PKEY = `NSC${STAMP}`;
const KIND = 'comment.added';

let tenantId: bigint;
let projectId: bigint;
let otherProjectId: bigint;
let workItemId: bigint;
let ctx: TenantContext;
let userId: bigint | undefined;
let schemeId: bigint | undefined;
let workflowId: bigint | undefined;
const keys: string[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

/** เรียกจุดรวมในทรานแซกชันของตัวเอง แล้วคืนจำนวนแถวที่เกิดขึ้นจริง */
async function send(
  over: { kind?: string; userId?: bigint | null; seed?: string } = {},
): Promise<{ created: number; mutedByAdmin: number; mutedByUser: number; rows: number }> {
  const seed = over.seed ?? `nsc:${STAMP}:${String(Math.floor(performance.now() * 1000))}`;
  const before = await prismaClient.notification.count({ where: { workItemId } });
  const r = await prismaClient.$transaction(async (tx) =>
    createNotifications(ctx, tx, projectId, [
      {
        userId: over.userId === undefined ? (userId as bigint) : over.userId,
        workItemId,
        kind: over.kind ?? KIND,
        title: `เรื่องทดสอบสวิตช์ ${STAMP}`,
        body: null,
        dedupeKey: seed,
      },
    ]),
  );
  const after = await prismaClient.notification.count({ where: { workItemId } });
  return { created: r.created, mutedByAdmin: r.mutedByAdmin, mutedByUser: r.mutedByUser, rows: after - before };
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์สวิตช์ ${STAMP}` },
    select: { id: true },
  });
  schemeId = scheme.id;
  const mkProject = async (suffix: string): Promise<bigint> =>
    (
      await prismaClient.project.create({
        data: {
          tenantId,
          key: `${PKEY}${suffix}`,
          name: `โปรเจกต์ทดสอบสวิตช์ ${suffix} ${STAMP}`,
          type: 'SERVICE_DESK',
          permissionSchemeId: scheme.id,
        },
        select: { id: true },
      })
    ).id;
  projectId = await mkProject('A');
  otherProjectId = await mkProject('B');

  userId = (
    await prismaClient.user.create({
      data: { tenantId, email: `nsc-${STAMP}@example.test`, displayName: 'ผู้รับ' },
      select: { id: true },
    })
  ).id;

  const wf = await prismaClient.workflow.create({
    data: { tenantId, name: `wf สวิตช์ ${STAMP}` },
    select: { id: true },
  });
  workflowId = wf.id;
  const status = await prismaClient.workflowStatus.create({
    data: {
      tenantId,
      workflowId: wf.id,
      name: `เปิด ${STAMP}`,
      category: 'TODO',
      position: 1,
      isInitial: true,
    },
    select: { id: true },
  });
  const tpl = await prismaClient.workItem.findFirstOrThrow({ select: { issueTypeId: true } });
  const item = await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey: `${PKEY}A-1`,
      issueTypeId: tpl.issueTypeId,
      statusId: status.id,
      reporterId: userId,
      summary: `เรื่องทดสอบสวิตช์ ${STAMP}`,
      rank: '0|1000',
    },
    select: { id: true, itemKey: true },
  });
  workItemId = item.id;
  keys.push(item.itemKey);

  ctx = { tenantId, actorId: userId };
}, 180_000);

afterAll(async () => {
  await step('แจ้งเตือน', () =>
    prismaClient.notification.deleteMany({ where: { workItemId } }),
  );
  await step('สวิตช์ผู้ดูแล', () =>
    prismaClient.notificationRule.deleteMany({
      where: { projectId: { in: [projectId, otherProjectId] } },
    }),
  );
  await step('สวิตช์รวม', () =>
    prismaClient.notificationRule.deleteMany({ where: { tenantId, projectId: null, kind: KIND } }),
  );
  await step('ค่าของผู้ใช้', () =>
    prismaClient.notificationPreference.deleteMany({ where: { userId: userId ?? 0n } }),
  );
  await step('งาน', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
  await step('โปรเจกต์', () =>
    prismaClient.project.deleteMany({ where: { key: { startsWith: PKEY } } }),
  );
  await step('สถานะ', () =>
    prismaClient.workflowStatus.deleteMany({ where: { workflowId: workflowId ?? 0n } }),
  );
  await step('workflow', () => prismaClient.workflow.deleteMany({ where: { id: workflowId ?? 0n } }));
  await step('ผู้ใช้', () =>
    prismaClient.user.deleteMany({ where: { email: { contains: `nsc-${STAMP}@example.test` } } }),
  );
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { id: schemeId ?? 0n } }),
  );

  /*
    สวิตช์รวมของ tenant ไม่ผูกกับโปรเจกต์ของเทสต์ · ถ้าเก็บกวาดพลาด มันจะ
    **ปิดการแจ้งเตือนของทั้งองค์กรค้างไว้** ซึ่งเงียบสนิทและตามยากมาก
  */
  const left = await prismaClient.notificationRule.count({
    where: { tenantId, projectId: null, kind: KIND },
  });
  if (left > 0) console.error(`**เหลือสวิตช์รวมของเทสต์ค้างอยู่ ${String(left)} แถว**`);
  await prismaClient.$disconnect();
}, 180_000);

describe('A · ค่าปริยาย', () => {
  it('**ไม่ตั้งอะไรเลย = ได้รับ**', async () => {
    /*
      ค่าปริยายต้องไม่เปลี่ยนพฤติกรรมเดิม · การเพิ่มตารางสวิตช์แล้วทำให้ทุกคน
      หยุดได้รับ คือการทำลายระบบเงียบ ๆ ที่ไม่มี error สักบรรทัด
    */
    const r = await send();
    expect(r.created).toBe(1);
    expect(r.rows).toBe(1);
  }, 60_000);
});

describe('B · ผู้ดูแลปิด', () => {
  it('**ปิดแล้วไม่มีแถวเกิดขึ้นเลย** ไม่ใช่เขียนไว้แล้วซ่อน', async () => {
    await prismaClient.notificationRule.create({
      data: { tenantId, projectId: null, kind: KIND, isEnabled: false },
    });
    const r = await send();
    expect(r.created).toBe(0);
    expect(r.rows).toBe(0);
    expect(r.mutedByAdmin).toBe(1);
  }, 60_000);

  it('**สวิตช์ระดับโปรเจกต์ถูกอ่านจริง — เปิดทับสวิตช์รวมได้**', async () => {
    /*
      ถ้าโค้ดอ่านแต่สวิตช์รวม เคสนี้จะยังคืน 0 · เทสต์ของฟังก์ชันบริสุทธิ์
      จับไม่ได้ เพราะมันได้รายการสวิตช์ส่งมาให้อยู่แล้ว
    */
    await prismaClient.notificationRule.create({
      data: { tenantId, projectId, kind: KIND, isEnabled: true },
    });
    const r = await send();
    expect(r.created).toBe(1);
    expect(r.mutedByAdmin).toBe(0);
  }, 60_000);

  it('สวิตช์ของโปรเจกต์อื่น ไม่หลุดมาใช้กับโปรเจกต์นี้', async () => {
    await prismaClient.notificationRule.deleteMany({ where: { tenantId, projectId, kind: KIND } });
    await prismaClient.notificationRule.create({
      data: { tenantId, projectId: otherProjectId, kind: KIND, isEnabled: true },
    });
    // สวิตช์รวมยังปิดอยู่ · ของโปรเจกต์ B ไม่ควรมาช่วยโปรเจกต์ A
    const r = await send();
    expect(r.created).toBe(0);
  }, 60_000);
});

describe('C · ค่าของผู้ใช้', () => {
  it('ผู้ใช้ปิดกระดิ่งเอง = ไม่มีแถว และรายงานว่าผู้ใช้เป็นคนปิด', async () => {
    await prismaClient.notificationRule.deleteMany({ where: { tenantId, kind: KIND } });
    await prismaClient.notificationPreference.create({
      data: { tenantId, userId: userId as bigint, kind: KIND, channel: 'in-app', isEnabled: false },
    });
    const r = await send();
    expect(r.created).toBe(0);
    expect(r.mutedByUser).toBe(1);
    expect(r.mutedByAdmin).toBe(0);
  }, 60_000);

  it('**แถวระดับทีมไม่หยิบค่าของใครมาใช้**', async () => {
    /*
      งานที่ยังไม่มีผู้รับผิดชอบต้องมีคนเห็น · แถวแบบนี้ไม่มีเจ้าของ ถ้าโค้ด
      เผลอไปอ่านค่าของ `null` เป็นคีย์เดียวกับใครสักคน มันจะเงียบตามคนนั้น
      โดยไม่มีใครรู้ว่าทำไมงานที่ไม่มีเจ้าของถึงไม่มีใครเห็น
    */
    const r = await send({ userId: null });
    expect(r.created).toBe(1);
  }, 60_000);

  it('ปิดอีเมลอย่างเดียว ยังได้แถวบนหน้าเว็บ', async () => {
    await prismaClient.notificationPreference.deleteMany({ where: { userId: userId ?? 0n } });
    await prismaClient.notificationPreference.create({
      data: { tenantId, userId: userId as bigint, kind: KIND, channel: 'email', isEnabled: false },
    });
    const r = await send();
    expect(r.created).toBe(1);
  }, 60_000);

  it('ค่าของชนิดอื่น ไม่กระทบชนิดนี้', async () => {
    await prismaClient.notificationPreference.deleteMany({ where: { userId: userId ?? 0n } });
    await prismaClient.notificationPreference.create({
      data: {
        tenantId,
        userId: userId as bigint,
        kind: 'workitem.assigned',
        channel: 'in-app',
        isEnabled: false,
      },
    });
    const r = await send();
    expect(r.created).toBe(1);
  }, 60_000);
});
