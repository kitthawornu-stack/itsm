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
import {
  CannotMuteError,
  UnknownKindError,
  CannotMuteRoleError,
  UnknownRoleError,
  createNotifications,
  listAdminSwitches,
  listAudienceRules,
  setAudienceRule,
  myPreferences,
  setAdminSwitch,
  setMyPreference,
} from '../src/modules/notification';
import { PermissionDeniedError } from '../src/modules/permission';

const STAMP = String(Date.now()).slice(-6);
const PKEY = `NSC${STAMP}`;
const KIND = 'comment.added';

let tenantId: bigint;
let projectId: bigint;
let otherProjectId: bigint;
let workItemId: bigint;
let ctx: TenantContext;
/**
 * ผู้ดูแลจริงจากข้อมูลตั้งต้น — **อ่านอย่างเดียว ไม่ย้าย grant ของใคร**
 *
 * ต้องใช้เพราะ `setAudienceRule` ผ่าน `assertTenantAdmin` · ส่วน `ctx`
 * เป็นผู้ใช้ของเทสต์ที่ไม่อยู่กลุ่มไหนเลย เก็บไว้พิสูจน์ว่าด่านสิทธิ์ทำงาน
 */
let adminCtx: TenantContext;
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
  over: { kind?: string; userId?: bigint | null; seed?: string; reason?: string } = {},
): Promise<{
  created: number;
  mutedByAudience: number;
  mutedByAdmin: number;
  mutedByUser: number;
  emailSuppressed: number;
  rows: number;
}> {
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
        // ไฟล์นี้วัดสวิตช์ของ **ชนิด** จึงใช้บทบาทที่ไม่มีกฎปิดไว้
        reason: over.reason ?? 'assignee',
      },
    ]),
  );
  const after = await prismaClient.notification.count({ where: { workItemId } });
  return {
    created: r.created,
    mutedByAudience: r.mutedByAudience,
    mutedByAdmin: r.mutedByAdmin,
    mutedByUser: r.mutedByUser,
    emailSuppressed: r.emailSuppressed,
    rows: after - before,
  };
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  const grant = await prismaClient.permissionGrant.findFirstOrThrow({
    where: { tenantId, permission: 'ADMINISTER_TENANT', groupId: { not: null } },
    select: { groupId: true },
  });
  const member = await prismaClient.groupMember.findFirstOrThrow({
    where: { groupId: grant.groupId ?? 0n },
    select: { userId: true },
  });
  adminCtx = { tenantId, actorId: member.userId };

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
  /*
    กฎบทบาทระดับ tenant ก็ไม่ผูกกับโปรเจกต์ของเทสต์เหมือนสวิตช์รวม —
    ถ้าเก็บกวาดพลาด มันจะปิดผู้รับบทบาทนั้นค้างไว้ทั้งองค์กรอย่างเงียบ ๆ
  */
  await step('กฎบทบาทของเทสต์', () =>
    prismaClient.notificationAudienceRule.deleteMany({
      where: {
        tenantId,
        kind: KIND,
        OR: [{ projectId: null }, { projectId: { in: [projectId, otherProjectId] } }],
      },
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

  it('**ปิดอีเมลอย่างเดียว ยังได้แถว และแถวนั้นถูกทำเครื่องหมายว่าห้ามส่งอีเมล**', async () => {
    /*
      เครื่องหมายบนแถวคือสิ่งเดียวที่ worker อ่านได้ · worker เรียกโค้ดของ api
      ไม่ได้ (คนละ workspace คนละโปรเซส) ถ้าไม่เขียนเครื่องหมายไว้ **คนที่ปิด
      อีเมลไว้จะยังได้รับอีเมลต่อไป** โดยหน้าจอบอกว่าปิดแล้ว
    */
    await prismaClient.notificationPreference.deleteMany({ where: { userId: userId ?? 0n } });
    await prismaClient.notificationPreference.create({
      data: { tenantId, userId: userId as bigint, kind: KIND, channel: 'email', isEnabled: false },
    });
    const seed = `nsc-mail:${STAMP}`;
    const r = await send({ seed });
    expect(r.created).toBe(1);
    expect(r.emailSuppressed).toBe(1);

    const row = await prismaClient.notification.findFirstOrThrow({
      where: { tenantId, dedupeKey: seed },
      select: { emailSuppressed: true },
    });
    expect(row.emailSuppressed).toBe(true);
  }, 60_000);

  it('ไม่ได้ปิดอีเมล = แถวไม่ถูกทำเครื่องหมาย', async () => {
    // เคสตรงข้ามต้องมีด้วย — ถ้าเขียน true ทุกแถว เคสข้างบนก็ยังเขียว
    await prismaClient.notificationPreference.deleteMany({ where: { userId: userId ?? 0n } });
    const seed = `nsc-mail-ok:${STAMP}`;
    await send({ seed });
    const row = await prismaClient.notification.findFirstOrThrow({
      where: { tenantId, dedupeKey: seed },
      select: { emailSuppressed: true },
    });
    expect(row.emailSuppressed).toBe(false);
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

describe('D · ตั้งค่าจากหน้าจอ', () => {
  it('**คนที่ไม่ใช่ผู้ดูแล แตะสวิตช์ระดับองค์กรไม่ได้**', async () => {
    // ผู้ใช้ของเทสต์ไม่ได้อยู่กลุ่มไหนเลย จึงไม่ใช่ผู้ดูแลระบบ
    await expect(listAdminSwitches(ctx)).rejects.toThrow(PermissionDeniedError);
    await expect(
      setAdminSwitch(ctx, { kind: KIND, isEnabled: false }),
    ).rejects.toThrow(PermissionDeniedError);
  }, 60_000);

  it('**ชนิดที่ปิดไม่ได้ ต้องถูกปฏิเสธตอนบันทึก ไม่ใช่แค่ตอนตัดสินใจส่ง**', async () => {
    /*
      ตรรกะกันไว้อยู่แล้ว แต่ถ้ายอมให้บันทึก ผู้ใช้จะเห็นสวิตช์ปิดอยู่บนหน้าจอ
      แล้วเชื่อว่าปิดได้ · หน้าจอที่โกหกแย่กว่าหน้าจอที่ปฏิเสธ
    */
    await expect(
      setMyPreference(ctx, { kind: 'approval.requested', channel: 'email', isEnabled: false }),
    ).rejects.toThrow(CannotMuteError);
  }, 60_000);

  it('ชนิดที่ไม่รู้จัก ถูกปฏิเสธ', async () => {
    await expect(
      setMyPreference(ctx, { kind: 'comment.explode', channel: 'email', isEnabled: false }),
    ).rejects.toThrow(UnknownKindError);
  }, 60_000);

  it('**กลับไปใช้ค่าปริยาย = ลบแถวทิ้ง ไม่ใช่เขียน true**', async () => {
    /*
      แถวที่เขียน `true` ไว้จะกลายเป็นการยืนยันว่า "คนนี้เลือกจะรับ" ซึ่งไม่จริง
      · และถ้าวันหนึ่งค่าปริยายเปลี่ยน คนที่มีแถวค้างจะไม่ตามค่าปริยายใหม่
      โดยไม่มีใครรู้ว่าทำไม
    */
    await setMyPreference(ctx, { kind: KIND, channel: 'email', isEnabled: false });
    expect(
      await prismaClient.notificationPreference.count({
        where: { userId: userId ?? 0n, kind: KIND, channel: 'email' },
      }),
    ).toBe(1);

    await setMyPreference(ctx, { kind: KIND, channel: 'email', isEnabled: true });
    expect(
      await prismaClient.notificationPreference.count({
        where: { userId: userId ?? 0n, kind: KIND, channel: 'email' },
      }),
    ).toBe(0);
  }, 60_000);

  it('รายการของผู้ใช้แสดงครบทุกชนิด รวมชนิดที่ยังไม่เคยแตะ', async () => {
    /*
      ช่องว่างคือคำตอบที่มีความหมายพอ ๆ กับรายชื่อ · การแสดงเฉพาะชนิดที่มีแถว
      ทำให้ผู้ใช้ไม่รู้ว่ามีอะไรให้ปิดได้บ้าง แล้วเขาจะไปตั้งกฎกรองในอีเมลแทน
      ซึ่งระบบมองไม่เห็นเลย
    */
    await prismaClient.notificationPreference.deleteMany({ where: { userId: userId ?? 0n } });
    const rows = await myPreferences(ctx);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((r) => r.inApp && r.email)).toBe(true);
    // ชนิดที่ปิดไม่ได้ ต้องบอกหน้าจอไว้ ไม่ใช่ให้กดแล้วเจอ error
    expect(rows.some((r) => r.alwaysOn)).toBe(true);
  }, 60_000);
});

// ============================================================

describe('สวิตช์แจ้งเตือน(จริง) · ใครควรได้รับ', () => {
  /**
   * ด่านที่พิสูจน์ว่า **มีอะไรอ่านกฎบทบาทจากฐานข้อมูลมาให้เอนจินจริง**
   *
   * `audience-policy.spec.ts` พิสูจน์แค่ว่าตรรกะถูกเมื่อกฎถูกส่งเข้าไป ·
   * ไฟล์นี้ตอบว่ามีใครส่งให้หรือเปล่า — คำถามที่เอนจินตอบเองไม่ได้
   */
  it('ไม่ตั้งกฎอะไรเลย = ได้รับ (ค่าปริยายไม่เปลี่ยนพฤติกรรมเดิม)', async () => {
    const r = await send({ reason: 'watcher' });
    expect(r.rows).toBe(1);
    expect(r.mutedByAudience).toBe(0);
  });

  it('ปิดบทบาทแล้วไม่มีแถวเกิดขึ้น — ไม่ใช่เขียนแถวแล้วซ่อนบนหน้าจอ', async () => {
    await setAudienceRule(adminCtx, { kind: KIND, role: 'watcher', isEnabled: false });
    const r = await send({ reason: 'watcher' });
    expect(r.rows).toBe(0);
    expect(r.mutedByAudience).toBe(1);
  });

  it('ปิดบทบาทหนึ่ง ไม่กระทบบทบาทอื่นในชนิดเดียวกัน', async () => {
    const r = await send({ reason: 'assignee' });
    expect(r.rows).toBe(1);
  });

  it('เปิดคืนแล้วได้รับอีกครั้ง', async () => {
    await setAudienceRule(adminCtx, { kind: KIND, role: 'watcher', isEnabled: true });
    const r = await send({ reason: 'watcher' });
    expect(r.rows).toBe(1);
  });

  it('บทบาทที่ปิดไม่ได้ ถูกปฏิเสธตั้งแต่ตอนตั้งค่า', async () => {
    await expect(
      setAudienceRule(adminCtx, { kind: KIND, role: 'mention', isEnabled: false }),
    ).rejects.toThrow(CannotMuteRoleError);
  });

  it('บทบาทที่ไม่รู้จัก ถูกปฏิเสธ ไม่ใช่เขียนแถวขยะ', async () => {
    await expect(
      setAudienceRule(adminCtx, { kind: KIND, role: 'ไม่มีจริง', isEnabled: false }),
    ).rejects.toThrow(UnknownRoleError);
    expect(
      await prismaClient.notificationAudienceRule.count({ where: { role: 'ไม่มีจริง' } }),
    ).toBe(0);
  });

  /**
   * ปิดครบทุกบทบาทที่ปิดได้ **ของชนิดที่ไม่มีบทบาทซึ่งปิดไม่ได้**
   *
   * `comment.added` มี `mention` อยู่ด้วยจึงไม่มีวันว่าง · ใช้ชนิดอื่นแทน
   */
  it('ปิดครบทุกบทบาทของชนิดหนึ่ง ถูกปฏิเสธพร้อมบอกทางออก', async () => {
    const K = 'workitem.assigned';
    const closable = ['reporter', 'assignee', 'team', 'watcher'];
    try {
      for (const role of closable) {
        await setAudienceRule(adminCtx, { kind: K, role, isEnabled: false });
      }
      throw new Error('ควรถูกปฏิเสธก่อนถึงบทบาทสุดท้าย');
    } catch (e) {
      expect((e as Error).message).toContain('ปิดทั้งชนิด');
    } finally {
      await prismaClient.notificationAudienceRule.deleteMany({
        where: { tenantId, kind: K },
      });
    }
  });

  it('ทุกการตั้งค่าเขียน audit', async () => {
    await setAudienceRule(adminCtx, { kind: KIND, role: 'team', isEnabled: false });
    const rows = await prismaClient.auditLog.findMany({
      where: { entityType: 'notification_audience_rule' },
      select: { action: true },
    });
    expect(rows.map((r) => r.action)).toContain('notification.audience.off');
    await setAudienceRule(adminCtx, { kind: KIND, role: 'team', isEnabled: true });
  });

  it('รายการที่หน้าจอใช้ บอกบทบาทที่ปิดไม่ได้ให้ด้วย', async () => {
    const rows = await listAudienceRules(adminCtx);
    const comment = rows.find((r) => r.kind === KIND);
    expect(comment?.roles.find((r) => r.role === 'mention')?.alwaysReached).toBe(true);
    expect(comment?.roles.find((r) => r.role === 'watcher')?.alwaysReached).toBe(false);
  });
});
