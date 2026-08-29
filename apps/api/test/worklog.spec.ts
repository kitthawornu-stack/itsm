/**
 * บันทึกเวลาทำงาน — เทสต์เป็นข้อกำหนด
 *
 * `duration.spec.ts` พิสูจน์ว่าการอ่านค่าถูก · ไฟล์นี้พิสูจน์สิ่งที่ต่างออกไป:
 * **ยอดรวมกับของจริงตรงกันไหม เมื่อมีคนบันทึก ลบ และแก้**
 *
 * ห้าข้อที่ต้องถูก:
 *
 *   1. **ยอดรวมต้องตรงกับผลบวกของ work_log เสมอ** — ยอดที่เพี้ยนอ่านเหมือน
 *      ยอดจริงทุกประการ และไม่มีอะไรบอกว่ามันเริ่มเพี้ยนตั้งแต่เมื่อไร
 *   2. **ลบแล้วยอดต้องลดตาม** — ยอดที่ไม่ลดคือยอดที่โกหกทันทีที่มีคนลบใบแรก
 *   3. **`startedAt` คือเวลาที่ทำงาน ไม่ใช่เวลาที่บันทึก** — คนลงงานวันศุกร์
 *      ในเช้าวันจันทร์เป็นเรื่องปกติ
 *   4. **บันทึกเวลาในอนาคตไม่ได้** — รายงานเดือนนี้จะนับงานของเดือนหน้าเข้ามา
 *      แล้วเดือนหน้าตัวเลขหายไปเฉย ๆ
 *   5. **แก้/ลบได้เฉพาะของตัวเอง** — บันทึกเวลาของคนอื่นเป็นข้อมูลที่ใช้
 *      ประเมินเขา การให้ใครก็แก้ได้ทำให้ตัวเลขไม่มีความหมาย
 */
import { toUtcDate, type TenantContext } from '@itsm/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  InvalidDurationError,
  NotYourWorkLogError,
  WorkLogInFutureError,
  deleteWorkLog,
  logWork,
  setEstimate,
  timeOf,
} from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);
const PKEY = `WLG${STAMP}`;
const NOW = toUtcDate('2026-09-10T04:00:00.000Z');

let tenantId: bigint;
let projectId: bigint;
let itemKey = '';
let me: TenantContext;
let other: TenantContext;
let outsider: TenantContext;
let myId: bigint | undefined;
let otherId: bigint | undefined;
let outsiderId: bigint | undefined;
let groupId: bigint | undefined;
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

/** ผลบวกจริงจาก work_log — แหล่งความจริง ไม่ใช่ค่าที่เก็บซ้ำไว้ */
async function actualSum(): Promise<number> {
  const r = await prismaClient.workLog.aggregate({
    where: { workItem: { itemKey } },
    _sum: { spentMinutes: true },
  });
  return r._sum.spentMinutes ?? 0;
}

async function storedSum(): Promise<number> {
  return (
    await prismaClient.workItem.findFirstOrThrow({
      where: { itemKey },
      select: { spentMinutes: true },
    })
  ).spentMinutes;
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์บันทึกเวลา ${STAMP}` },
    select: { id: true },
  });
  schemeId = scheme.id;
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: PKEY,
      name: `โปรเจกต์ทดสอบบันทึกเวลา ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = project.id;

  const group = await prismaClient.userGroup.create({
    data: { tenantId, name: `wlg ${STAMP}` },
    select: { id: true },
  });
  groupId = group.id;

  const mkUser = async (n: string, inGroup: boolean): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `wlg-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    if (inGroup) {
      await prismaClient.groupMember.create({ data: { tenantId, groupId: group.id, userId: u.id } });
    }
    return u.id;
  };
  myId = await mkUser('me', true);
  otherId = await mkUser('other', true);
  outsiderId = await mkUser('outsider', false);

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: group.id },
      { tenantId, schemeId: scheme.id, permission: 'EDIT_ITEM', groupId: group.id },
    ] as never,
  });

  const wf = await prismaClient.workflow.create({
    data: { tenantId, name: `wf บันทึกเวลา ${STAMP}` },
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
      itemKey: `${PKEY}-1`,
      issueTypeId: tpl.issueTypeId,
      statusId: status.id,
      reporterId: myId,
      summary: `เรื่องทดสอบบันทึกเวลา ${STAMP}`,
      rank: '0|1000',
    },
    select: { itemKey: true },
  });
  itemKey = item.itemKey;
  keys.push(item.itemKey);

  me = { tenantId, actorId: myId };
  other = { tenantId, actorId: otherId };
  outsider = { tenantId, actorId: outsiderId };
}, 180_000);

afterAll(async () => {
  await step('บันทึกเวลา', () =>
    prismaClient.workLog.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('งาน', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
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
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({
      where: {
        actorId: { in: [myId, otherId, outsiderId].filter((v): v is bigint => v !== undefined) },
      },
    }),
  );
  await step('ผู้ใช้', () =>
    prismaClient.user.deleteMany({ where: { email: { contains: `-${STAMP}@example.test` } } }),
  );
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { id: schemeId ?? 0n } }),
  );
  await prismaClient.$disconnect();
}, 180_000);

describe('A · บันทึกและยอดรวม', () => {
  it('**ยอดรวมตรงกับผลบวกของ work_log**', async () => {
    await logWork(me, { itemKey, spent: '2h', note: 'ตรวจเครื่อง' }, NOW);
    await logWork(other, { itemKey, spent: '30m' }, NOW);
    expect(await storedSum()).toBe(150);
    // เทียบกับแหล่งความจริง ไม่ใช่กับตัวเลขที่เราคาดไว้เอง
    expect(await storedSum()).toBe(await actualSum());
  }, 60_000);

  it('เขียนประวัติทุกครั้ง (INVARIANT 2)', async () => {
    const rows = await prismaClient.workItemHistory.count({
      where: { workItem: { itemKey }, field: 'worklog' },
    });
    expect(rows).toBe(2);
  }, 60_000);

  it('**ระยะเวลาที่อ่านไม่ออก ถูกปฏิเสธ ไม่ใช่บันทึกเป็นศูนย์**', async () => {
    const before = await storedSum();
    await expect(logWork(me, { itemKey, spent: 'สองชั่วโมง' }, NOW)).rejects.toThrow(
      InvalidDurationError,
    );
    expect(await storedSum()).toBe(before);
  }, 60_000);

  it('**บันทึกเวลาในอนาคตไม่ได้**', async () => {
    /*
      ปล่อยผ่านแล้วรายงานเดือนนี้จะนับงานของเดือนหน้าเข้ามาด้วย ซึ่งไม่มีใคร
      สังเกตจนกว่าจะถึงเดือนหน้า แล้วตัวเลขหายไปเฉย ๆ
    */
    await expect(
      logWork(me, { itemKey, spent: '1h', startedAt: '2026-09-11T04:00:00.000Z' }, NOW),
    ).rejects.toThrow(WorkLogInFutureError);
  }, 60_000);

  it('**เก็บเวลาที่ทำงาน ไม่ใช่เวลาที่บันทึก**', async () => {
    // คนลงงานของวันศุกร์ในเช้าวันจันทร์ — รายงานต้องนับให้วันศุกร์
    const past = '2026-09-04T02:00:00.000Z';
    await logWork(me, { itemKey, spent: '15m', startedAt: past }, NOW);
    const row = await prismaClient.workLog.findFirstOrThrow({
      where: { workItem: { itemKey }, spentMinutes: 15 },
      select: { startedAt: true, createdAt: true },
    });
    expect(row.startedAt.toISOString()).toBe(past);
    // เวลาที่บันทึกคือตอนนี้จริง ๆ และต้องต่างจากเวลาที่ทำงาน
    expect(row.createdAt.toISOString()).not.toBe(past);
  }, 60_000);
});

describe('B · เวลาที่ประมาณและเวลาที่เหลือ', () => {
  it('**ตั้งเวลาประมาณครั้งแรก ตั้งเวลาที่เหลือให้เท่ากันด้วย**', async () => {
    /*
      งานที่ประมาณไว้ 4 ชั่วโมงแต่ "เหลือ null" อ่านบนหน้าจอเหมือนยังไม่ได้ประมาณ
      ทั้งที่ประมาณแล้ว — สองช่องที่ควรตรงกันแต่ไม่ตรง คือหน้าจอที่ขัดแย้งกันเอง
    */
    const r = await setEstimate(me, itemKey, { original: '4h' });
    expect(r.originalMinutes).toBe(240);
    expect(r.remainingMinutes).toBe(240);
  }, 60_000);

  it('**บันทึกเวลาแล้ว เวลาที่เหลือลดลง แต่ไม่ต่ำกว่าศูนย์**', async () => {
    await logWork(me, { itemKey, spent: '3h' }, NOW);
    let t = await timeOf(me, itemKey);
    expect(t.remainingMinutes).toBe(60);

    await logWork(me, { itemKey, spent: '5h' }, NOW);
    t = await timeOf(me, itemKey);
    expect(t.remainingMinutes).toBe(0);
    // ใช้เกินที่ประมาณไว้แล้ว — แต่ยอดที่ใช้ไปยังนับต่อ ไม่ได้ถูกตัด
    expect(t.spentMinutes).toBeGreaterThan(t.originalEstimateMinutes ?? 0);
  }, 60_000);

  it('ปรับเวลาที่เหลือด้วยมือได้ โดยไม่แตะเวลาที่ประมาณ', async () => {
    const r = await setEstimate(me, itemKey, { remaining: '2h' });
    expect(r.remainingMinutes).toBe(120);
    expect(r.originalMinutes).toBe(240);
  }, 60_000);

  it('**ล้างค่าได้ และ null ต่างจากศูนย์**', async () => {
    const r = await setEstimate(me, itemKey, { original: '', remaining: '' });
    expect(r.originalMinutes).toBeNull();
    expect(r.remainingMinutes).toBeNull();
    const t = await timeOf(me, itemKey);
    // ไม่เคยประมาณ = ไม่มีข้อความให้แสดง · ต่างจาก "0m"
    expect(t.originalText).toBeNull();
    expect(t.spentText).not.toBe('');
  }, 60_000);
});

describe('C · ลบ', () => {
  it('**ลบแล้วยอดรวมลดตาม และยังตรงกับผลบวกจริง**', async () => {
    const t = await timeOf(me, itemKey);
    const target = t.logs.find((l) => l.spentMinutes === 15);
    expect(target).toBeDefined();

    const before = await storedSum();
    await deleteWorkLog(me, BigInt(target?.id ?? '0'));
    expect(await storedSum()).toBe(before - 15);
    expect(await storedSum()).toBe(await actualSum());
  }, 60_000);

  it('**ลบของคนอื่นไม่ได้**', async () => {
    /*
      บันทึกเวลาของคนอื่นเป็นข้อมูลที่ใช้ประเมินเขา · การให้ใครก็ลบได้ทำให้
      ตัวเลขไม่มีความหมาย และคนที่ถูกลบจะไม่รู้ด้วยซ้ำ
    */
    const t = await timeOf(other, itemKey);
    const mine = t.logs.find((l) => l.author.id === String(myId));
    expect(mine).toBeDefined();
    await expect(deleteWorkLog(other, BigInt(mine?.id ?? '0'))).rejects.toThrow(NotYourWorkLogError);
  }, 60_000);

  it('`canEdit` บอกหน้าจอตรง ๆ ว่าใบไหนแก้ได้', async () => {
    // หน้าจอไม่ต้องเดาเอง · การเดาผิดทำให้ปุ่มโผล่แล้วกดไม่ได้
    const t = await timeOf(other, itemKey);
    expect(t.logs.some((l) => l.author.id === String(otherId) && l.canEdit)).toBe(true);
    expect(t.logs.some((l) => l.author.id === String(myId) && !l.canEdit)).toBe(true);
  }, 60_000);
});

describe('D · คนนอกโปรเจกต์', () => {
  it('**เปิดเรื่องไม่ได้ ก็บันทึกเวลาไม่ได้ และดูไม่ได้**', async () => {
    await expect(timeOf(outsider, itemKey)).rejects.toThrow(PermissionDeniedError);
    await expect(logWork(outsider, { itemKey, spent: '1h' }, NOW)).rejects.toThrow(
      PermissionDeniedError,
    );
  }, 60_000);

  it('คนนอกถูกปฏิเสธ **ก่อน** แตะฐานข้อมูล', async () => {
    const before = await prismaClient.workLog.count({ where: { workItem: { itemKey } } });
    await expect(logWork(outsider, { itemKey, spent: '1h' }, NOW)).rejects.toThrow(
      PermissionDeniedError,
    );
    expect(await prismaClient.workLog.count({ where: { workItem: { itemKey } } })).toBe(before);
  }, 60_000);
});
