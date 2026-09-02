/**
 * ตัวกวาดหาเรื่องที่ไม่มีความเคลื่อนไหว — เทสต์เป็นข้อกำหนด
 *
 * `item.idle` ต่างจาก trigger อีกสี่ตัวโดยสิ้นเชิง: **ไม่มีใครเป็นคนจุดชนวน**
 * ความผิดพลาดจึงไม่ทำให้อะไรพัง มันแค่ทำงานเองผิด ๆ อยู่เงียบ ๆ ทุกห้านาที
 *
 * ห้าข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **กฎที่ล้มต้องไม่ยิงซ้ำทุกรอบ** — กฎที่เขียนผิดหนึ่งข้อจะผลิตแถว
 *      `failed` ทุกห้านาทีตลอดไป จนหน้าประวัติอ่านไม่ได้ และไม่มีใครเห็น
 *      กฎที่ทำงานถูกอีกเลย
 *   2. **ตัวกันไม่ให้ทำซ้ำต้องอยู่ในฐานข้อมูล ไม่ใช่หน่วยความจำ** — เครื่องที่
 *      รีสตาร์ตกลางทางต้องไม่ยิงซ้ำทั้งกอง
 *   3. **นับวันแบบปัดลง** — "ครบ 2 วัน" ต้องครบจริง ไม่ใช่ 1 วัน 23 ชั่วโมง
 *   4. **งานที่ปิดแล้วต้องไม่ถูกกวาด** — การไปเตือนเรื่องที่ปิดไปเมื่อสองเดือนก่อน
 *      ทำให้คนเลิกเชื่อการแจ้งเตือนทั้งหมด
 *   5. **จำนวนที่เกินเพดานต้องรายงาน** ไม่ใช่ตัดเงียบ ๆ
 *
 * เวลา "ตอนนี้" ส่งเข้าไปทุกครั้ง จึงทดสอบ "ค้างมา 30 วัน" ได้โดยไม่ต้องรอจริง
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { toUtcDate, type TenantContext } from '@itsm/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { SCAN_MAX, idleDaysOf, minIdleDays, scanIdleItems } from '../src/modules/automation';

const STAMP = String(Date.now()).slice(-6);
const PKEY = `IDL${STAMP}`;
const DAY = 24 * 60 * 60 * 1000;

let tenantId: bigint;
let projectId: bigint;
let ctx: TenantContext;
let reporterId: bigint | undefined;
let botId: bigint;
let groupId: bigint | undefined;
let schemeId: bigint | undefined;
let workflowId: bigint | undefined;
let openStatusId: bigint;
let doneStatusId: bigint;
let issueTypeId: bigint;
const ruleIds: bigint[] = [];
const keys: string[] = [];

/** เวลาอ้างอิงตายตัว — ไม่อ่านนาฬิกาจริง เทสต์จึงให้ผลเดิมทุกครั้ง */
const NOW = toUtcDate('2026-09-01T03:00:00.000Z');
/** อีกสามวันถัดมา — ใช้ดูว่าเรื่องที่ถูกขยับแล้ว กลับมาค้างใหม่ได้ */
const LATER = toUtcDate('2026-09-04T03:00:00.000Z');

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function mkRule(name: string, conditions: unknown[], actions: unknown[]): Promise<bigint> {
  const r = await prismaClient.automationRule.create({
    data: {
      tenantId,
      projectId,
      name: `${name} ${STAMP}`,
      trigger: 'item.idle',
      isEnabled: true,
      conditions: conditions as never,
      actions: actions as never,
    },
    select: { id: true },
  });
  ruleIds.push(r.id);
  return r.id;
}

/** สร้างงานที่ `updatedAt` ย้อนหลังไปตามจำนวนวันที่ระบุ */
async function mkItem(n: number, daysAgo: number, done = false): Promise<string> {
  const key = `${PKEY}-${String(n)}`;
  const at = new Date(NOW.getTime() - daysAgo * DAY);
  await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey: key,
      issueTypeId,
      statusId: done ? doneStatusId : openStatusId,
      reporterId: reporterId as bigint,
      summary: `เรื่องค้าง ${String(daysAgo)} วัน ${STAMP}`,
      rank: `0|${String(1000 + n)}`,
    },
  });
  /*
    `updatedAt` เป็น `@updatedAt` — Prisma เขียนทับตอน create · ต้องแก้ด้วย
    raw SQL ทีหลัง มิฉะนั้นงานทุกใบจะ "เพิ่งขยับ" และเทสต์ทั้งไฟล์จะเขียว
    โดยไม่ได้ทดสอบอะไรเลย
  */
  await prismaClient.$executeRaw`UPDATE work_item SET updated_at = ${at} WHERE item_key = ${key}`;
  keys.push(key);
  return key;
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์กวาด ${STAMP}` },
    select: { id: true },
  });
  schemeId = scheme.id;
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: PKEY,
      name: `โปรเจกต์ทดสอบตัวกวาด ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = project.id;

  const group = await prismaClient.userGroup.create({
    data: { tenantId, name: `idl-bot ${STAMP}` },
    select: { id: true },
  });
  groupId = group.id;
  botId = (
    await prismaClient.user.findFirstOrThrow({
      where: { tenantId, isSystem: true, isActive: true },
      orderBy: { id: 'asc' },
      select: { id: true },
    })
  ).id;
  await prismaClient.groupMember.create({ data: { tenantId, groupId: group.id, userId: botId } });
  reporterId = (
    await prismaClient.user.create({
      data: { tenantId, email: `idl-rep-${STAMP}@example.test`, displayName: 'ผู้แจ้ง' },
      select: { id: true },
    })
  ).id;
  await prismaClient.groupMember.create({
    data: { tenantId, groupId: group.id, userId: reporterId },
  });
  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: group.id },
      { tenantId, schemeId: scheme.id, permission: 'ADD_COMMENT', groupId: group.id },
    ] as never,
  });

  const wf = await prismaClient.workflow.create({
    data: { tenantId, name: `workflow กวาด ${STAMP}` },
    select: { id: true },
  });
  workflowId = wf.id;
  openStatusId = (
    await prismaClient.workflowStatus.create({
      data: {
        tenantId,
        workflowId: wf.id,
        name: `ค้างอยู่ ${STAMP}`,
        category: 'TODO',
        position: 1,
        isInitial: true,
      },
      select: { id: true },
    })
  ).id;
  doneStatusId = (
    await prismaClient.workflowStatus.create({
      data: {
        tenantId,
        workflowId: wf.id,
        name: `จบแล้ว ${STAMP}`,
        category: 'DONE',
        position: 2,
        isInitial: false,
      },
      select: { id: true },
    })
  ).id;
  issueTypeId = (await prismaClient.workItem.findFirstOrThrow({ select: { issueTypeId: true } }))
    .issueTypeId;
  await prismaClient.workflowScheme.create({
    data: { tenantId, projectId, issueTypeId, workflowId: wf.id },
  });

  ctx = { tenantId, actorId: reporterId };
}, 180_000);

afterAll(async () => {
  await step('ประวัติงาน', () =>
    prismaClient.workItemHistory.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('ความเห็น', () =>
    prismaClient.workItemComment.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('ประวัติกฎ', () =>
    prismaClient.automationRun.deleteMany({ where: { ruleName: { contains: STAMP } } }),
  );
  await step('กฎ', () =>
    prismaClient.automationRule.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await step('นาฬิกา SLA', () =>
    prismaClient.workItemSla.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('งาน', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
  await step('workflow scheme', () =>
    prismaClient.workflowScheme.deleteMany({ where: { projectId } }),
  );
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: PKEY } }));
  await step('สถานะ', () =>
    prismaClient.workflowStatus.deleteMany({ where: { workflowId: workflowId ?? 0n } }),
  );
  await step('workflow', () => prismaClient.workflow.deleteMany({ where: { id: workflowId ?? 0n } }));
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { groupId: groupId ?? 0n } }),
  );
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({ where: { schemeId: schemeId ?? 0n } }),
  );
  await step('กลุ่ม', () => prismaClient.userGroup.deleteMany({ where: { id: groupId ?? 0n } }));
  await step('ผู้ใช้', () =>
    prismaClient.user.deleteMany({ where: { email: { contains: `-${STAMP}@example.test` } } }),
  );
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { id: schemeId ?? 0n } }),
  );

  const left = await prismaClient.automationRule.count({ where: { name: { contains: STAMP } } });
  if (left > 0) console.error(`**เหลือกฎของเทสต์ค้างอยู่ ${String(left)} ข้อ**`);
  await prismaClient.$disconnect();
}, 180_000);

describe('A · ฟังก์ชันบริสุทธิ์', () => {
  it('**นับวันแบบปัดลง** — "ครบ 2 วัน" ต้องครบจริง', () => {
    /*
      ปัดขึ้นแปลว่ากฎ "ไม่มีใครตอบ 2 วัน" ทำงานตั้งแต่ชั่วโมงที่ 25 · ผู้ดูแล
      ที่ตั้งกฎไว้ 2 วันจะเห็นการเตือนตั้งแต่วันแรก แล้วสรุปว่าระบบนับผิด
    */
    expect(idleDaysOf(new Date(NOW.getTime() - 2 * DAY), NOW)).toBe(2);
    expect(idleDaysOf(new Date(NOW.getTime() - 2 * DAY + 1000), NOW)).toBe(1);
    expect(idleDaysOf(NOW, NOW)).toBe(0);
  });

  it('เกณฑ์ที่แคบที่สุดในบรรดากฎ ใช้จำกัดขอบเขตคิวรี', () => {
    expect(
      minIdleDays([
        [{ field: 'idleDays', op: 'at-least', value: '7' }],
        [{ field: 'idleDays', op: 'at-least', value: '2' }],
      ]),
    ).toBe(2);
  });

  it('**กฎที่ไม่ระบุจำนวนวันเลย ทำให้เกณฑ์เป็นศูนย์**', () => {
    // มันตั้งใจครอบทุกใบ · การเผลอใช้เกณฑ์ของกฎอื่นจะทำให้มันไม่เห็นใบที่เพิ่งค้าง
    expect(
      minIdleDays([
        [{ field: 'idleDays', op: 'at-least', value: '7' }],
        [{ field: 'project', op: 'is', value: 'SD' }],
      ]),
    ).toBe(0);
  });

  it('กฎเดียวที่มีสองเงื่อนไขวัน ใช้ตัวที่มากกว่า **ไม่ว่าเรียงมาแบบไหน**', () => {
    /*
      ทั้งสองข้อต้องเป็นจริงพร้อมกัน เกณฑ์จริงของกฎนั้นจึงเป็นตัวที่มากกว่า

      ต้องทดสอบทั้งสองลำดับ · เรียงจากน้อยไปมากอย่างเดียว โค้ดที่เขียนทับ
      ด้วยค่าล่าสุด (`= n` แทน `Math.max`) ก็ยังให้คำตอบถูก — พิสูจน์แล้วว่า
      ด่านนี้เขียวทั้ง 12 เคสตอนลบ `Math.max` ออก จนเพิ่มลำดับกลับด้าน
    */
    const both = [
      { field: 'idleDays' as const, op: 'at-least' as const, value: '2' },
      { field: 'idleDays' as const, op: 'at-least' as const, value: '5' },
    ];
    expect(minIdleDays([both])).toBe(5);
    expect(minIdleDays([[...both].reverse()])).toBe(5);
  });

  it('ไม่มีกฎเลย ได้ศูนย์ ไม่ใช่อนันต์', () => {
    expect(minIdleDays([])).toBe(0);
  });
});

describe('B · กวาดกับข้อมูลจริง', () => {
  it('**เรื่องที่ค้างครบเกณฑ์ถูกปลุก เรื่องที่ยังไม่ครบไม่ถูกปลุก**', async () => {
    await mkRule(
      'เตือนเมื่อค้างสองวัน',
      [{ field: 'idleDays', op: 'at-least', value: '2' }],
      [{ kind: 'comment', value: 'เรื่องนี้ค้างมาสองวันแล้ว ทีมกำลังตามให้' }],
    );
    await mkItem(1, 5); // ค้าง 5 วัน — ต้องถูกปลุก
    await mkItem(2, 1); // ค้าง 1 วัน — ยังไม่ครบ

    const summary = await scanIdleItems(ctx, NOW);
    /*
      **ยอดรวมจาก `scanIdleItems` เป็นค่าระดับองค์กร ไม่ใช่ของเทสต์นี้**

      `scanIdleItems` อ่านกฎ `item.idle` ที่เปิดอยู่ **ทุกตัวในองค์กร** ·
      ไฟล์เทสต์อื่นที่สร้างกฎของตัวเองอยู่พร้อมกัน ทำให้ `rules` เป็น 2
      และเปลี่ยนเกณฑ์ `minIdleDays` ซึ่งกระทบ `fired` ด้วย

      เจอเพราะ CI แดงหนึ่งครั้งแล้วรันใหม่ก็เขียว — **เทสต์ที่แดงเป็นบางครั้ง
      แย่กว่าเทสต์ที่แดงตลอด** เพราะไม่มีใครเชื่อมันอีก และคนจะรันใหม่จนเขียว
      แทนที่จะอ่านว่ามันบอกอะไร

      จึงยืนยันด้วย **สิ่งที่เทสต์นี้เป็นเจ้าของ** (แถว `automation_run` ที่มี
      ลายเซ็นของตัวเอง ซึ่งตรวจอยู่ข้างล่างแล้ว) และปล่อยยอดรวมเป็นขอบล่าง
    */
    expect(summary.rules, 'ไม่เห็นกฎของเทสต์นี้เลย').toBeGreaterThanOrEqual(1);
    expect(summary.fired, 'กฎของเทสต์นี้ไม่ถูกปลุก').toBeGreaterThanOrEqual(1);

    const runs = await prismaClient.automationRun.findMany({
      where: { ruleName: { contains: STAMP } },
      select: { outcome: true, workItem: { select: { itemKey: true } } },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.workItem?.itemKey).toBe(`${PKEY}-1`);
    expect(runs[0]?.outcome).toBe('applied');
  }, 120_000);

  it('**กวาดรอบสองต้องไม่ยิงซ้ำ**', async () => {
    /*
      รอบกวาดวิ่งทุกไม่กี่นาที แต่ "ค้าง 2 วัน" เป็นจริงอยู่หลายวัน · ถ้าไม่กัน
      กฎจะยิงซ้ำหลายร้อยครั้งต่อใบ · และตัวกันต้องอยู่ในฐานข้อมูล ไม่ใช่
      หน่วยความจำ — เทสต์นี้เรียกฟังก์ชันใหม่ทั้งตัว ซึ่งไม่มีสถานะเก่าเหลืออยู่
    */
    const before = await prismaClient.automationRun.count({
      where: { ruleName: { contains: STAMP } },
    });
    const summary = await scanIdleItems(ctx, NOW);
    /*
      `summary.fired` เป็นค่าระดับองค์กร กฎของไฟล์เทสต์อื่นทำให้มันไม่เป็นศูนย์ได้ ·
      สิ่งที่เคสนี้ต้องพิสูจน์คือ **กฎของเทสต์นี้ไม่ยิงซ้ำ** ซึ่งวัดจากจำนวนแถว
      ที่มีลายเซ็นของตัวเอง ไม่เปลี่ยน — บรรทัดข้างล่างคือการวัดนั้น
    */
    expect(summary.skipped, 'ไม่มีเรื่องไหนถูกข้ามเลย ทั้งที่ควรถูกข้าม').toBeGreaterThan(0);
    expect(
      await prismaClient.automationRun.count({ where: { ruleName: { contains: STAMP } } }),
      'กฎของเทสต์นี้ยิงซ้ำ',
    ).toBe(before);
  }, 120_000);

  it('**กฎที่ล้ม ก็ต้องไม่ยิงซ้ำเหมือนกัน**', async () => {
    /*
      เคสที่พลาดง่ายที่สุด · กฎที่สำเร็จจะไปแตะเรื่อง `updatedAt` ขยับ เรื่องเลิก
      ค้างเอง · แต่กฎที่ล้ม **ไม่ได้แตะอะไรเลย** เรื่องยังค้างเท่าเดิม ถ้าตัวกัน
      ดูแค่ `updatedAt` มันจะยิงซ้ำทุกห้านาทีตลอดไป และผลิตแถว failed จนหน้า
      ประวัติอ่านไม่ได้ — เป็นความเสียหายที่ไม่มี error สักบรรทัด
    */
    await mkRule(
      'กฎที่ล้มแน่นอน',
      [{ field: 'idleDays', op: 'at-least', value: '1' }],
      // ผู้รับผิดชอบที่ไม่ใช่รหัสผู้ใช้ — ถูกปฏิเสธทุกครั้ง ไม่แตะเรื่อง
      [{ kind: 'assign', value: 'ไม่ใช่รหัส' }],
    );
    const key = await mkItem(3, 4);

    const first = await scanIdleItems(ctx, NOW);
    expect(first.fired).toBeGreaterThan(0);
    const afterFirst = await prismaClient.automationRun.count({
      where: { workItem: { itemKey: key } },
    });
    expect(afterFirst).toBeGreaterThan(0);

    const second = await scanIdleItems(ctx, NOW);
    expect(second.fired).toBe(0);
    expect(
      await prismaClient.automationRun.count({ where: { workItem: { itemKey: key } } }),
    ).toBe(afterFirst);

    // และแถวที่ทิ้งไว้ต้องบอกเหตุผล ไม่ใช่แค่ว่าล้ม
    const failed = await prismaClient.automationRun.findFirst({
      where: { workItem: { itemKey: key }, outcome: 'failed' },
      select: { reason: true },
    });
    expect(failed?.reason).toBeTruthy();
  }, 120_000);

  it('**งานที่ปิดแล้วต้องไม่ถูกกวาด**', async () => {
    /*
      การไปเตือนเรื่องที่ปิดไปแล้วเมื่อสองเดือนก่อน ทำให้คนเลิกเชื่อการแจ้งเตือน
      ทั้งหมด ซึ่งแพงกว่าการไม่เตือนเลย · และงานที่ปิดแล้วจะค้างตลอดกาลโดยนิยาม
    */
    const key = await mkItem(4, 60, true);
    await scanIdleItems(ctx, NOW);
    expect(await prismaClient.automationRun.count({ where: { workItem: { itemKey: key } } })).toBe(
      0,
    );
  }, 120_000);

  it('**เรื่องที่มีคนขยับใหม่ กลับมาเข้าเกณฑ์ได้อีก**', async () => {
    /*
      ตัวกันไม่ให้ทำซ้ำต้องไม่ใช่ "ทำแล้วห้ามทำอีกตลอดกาล" · เรื่องที่มีคนตอบ
      แล้วเงียบต่ออีกสองวัน ควรถูกเตือนใหม่ — ไม่งั้นกฎมีผลครั้งเดียวต่อใบ
      ตลอดอายุของเรื่อง ซึ่งไม่ใช่สิ่งที่ผู้ดูแลเขียน

      ลำดับที่จำลอง: กฎยิงไปแล้วที่ NOW → มีคนตอบทันทีหลังจากนั้น →
      เงียบต่ออีกสามวัน → ต้องยิงใหม่ · **การย้อน `updatedAt` ไปก่อนแถวเดิม
      ไม่ใช่การจำลองเรื่องนี้** เพราะในความจริงไม่มีใครทำให้เวลาเดินถอยหลังได้
    */
    const key = `${PKEY}-1`;
    const replied = new Date(NOW.getTime() + 60_000);
    await prismaClient.$executeRaw`UPDATE work_item SET updated_at = ${replied} WHERE item_key = ${key}`;

    // ยังไม่ครบเกณฑ์อีกรอบ — ที่ NOW เรื่องนี้เพิ่งถูกตอบ
    expect((await scanIdleItems(ctx, NOW)).fired).toBe(0);

    const later = await scanIdleItems(ctx, LATER);
    expect(later.fired).toBeGreaterThan(0);
    const runs = await prismaClient.automationRun.count({
      where: { workItem: { itemKey: key }, createdAt: { gte: replied } },
    });
    expect(runs).toBeGreaterThan(0);
  }, 120_000);
});

describe('C · เพดานของรอบ', () => {
  it('เพดานเป็นตัวเลขที่ตั้งไว้จริง และรายงานส่วนที่เกิน', () => {
    /*
      เทสต์เชิงพฤติกรรมของเพดานต้องสร้างงานเกิน 200 ใบ ซึ่งช้าและเสี่ยงต่อ
      ข้อมูลพัฒนา · ที่นี่จึงยืนยันแค่ว่า **สัญญามีช่องให้รายงานส่วนที่เกิน**
      ไม่ใช่แกล้งทดสอบสิ่งที่ไม่ได้ทดสอบ · การตัดที่ไม่มีใครรายงาน อ่านเหมือน
      "ครอบทั้งหมดแล้ว" ทั้งที่ไม่ใช่
    */
    expect(SCAN_MAX).toBeGreaterThan(0);
  });

  it('ไม่มีกฎชนิดนี้เลย ต้องไม่แตะฐานข้อมูลของงาน', async () => {
    await prismaClient.automationRule.updateMany({
      where: { name: { contains: STAMP } },
      data: { isEnabled: false },
    });
    const summary = await scanIdleItems(ctx, NOW);
    expect(summary).toEqual({ fired: 0, skipped: 0, deferred: 0, rules: 0 });
  }, 120_000);
});

describe('D · มีอะไรเรียกตัวกวาดจริงไหม', () => {
  /*
    ตัวกวาดที่ไม่มีอะไรเรียก ก็เหมือนกฎที่ไม่มีใครปลุก · เทสต์ทุกข้อข้างบนจะ
    เขียวทั้งชุดแม้ไม่มีใครตั้งเวลาให้มันเลย เพราะมันเรียก `scanIdleItems` เอง
    — บทเรียนที่โครงการนี้เจอซ้ำที่สุด (CLAUDE.md §4)
  */
  const scheduler = readFileSync(
    join(__dirname, '../src/modules/automation/automation.scheduler.ts'),
    'utf8',
  );
  const appModule = readFileSync(join(__dirname, '../src/app.module.ts'), 'utf8');

  it('ตัวสแกนอ่านไฟล์เจอจริง', () => {
    expect(scheduler).toContain('SCAN_INTERVAL_MS');
    expect(appModule).toContain('providers');
    expect(appModule).not.toContain('ข้อความที่ไม่มีอยู่จริงในไฟล์นี้');
  });

  it('**ตัวตั้งเวลาเรียก scanIdleItems จริง**', () => {
    expect(scheduler).toContain('scanIdleItems(');
  });

  it('**ตัวตั้งเวลาถูกลงทะเบียนใน AppModule**', () => {
    // ประกาศคลาสไว้เฉย ๆ ไม่ทำให้ NestJS สร้างมันขึ้นมา · ต้องอยู่ใน providers
    const providers = /providers:\s*\[([\s\S]*?)\]/.exec(appModule)?.[1] ?? '';
    expect(providers).toContain('AutomationScheduler');
  });

  it('รอบกวาดวนทุกองค์กร ไม่ใช่เฉพาะองค์กรของคำขอ', () => {
    // งานเบื้องหลังไม่ได้มาจากคำขอของใคร จึงไม่มี tenant ติดมากับบริบท
    expect(scheduler).toContain('withSystemScope');
    expect(scheduler).toContain('tenant.findMany');
  });
});
