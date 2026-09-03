/**
 * ตารางเวลาส่งรายงาน — ต่อกับฐานข้อมูลจริง
 *
 * `schedule.spec.ts` พิสูจน์ว่าเอนจินคำนวณเวลาถูก · ไฟล์นี้พิสูจน์ว่า
 * **สิ่งที่เก็บลงฐานข้อมูลกลับมาเป็นตารางเวลาเดิมได้** และที่สำคัญกว่า
 * คือกฎสองข้อที่ผิดแล้วเงียบ:
 *
 *   1. **แถวที่ข้อมูลไม่ครบต้องล้ม ไม่ใช่เดาค่าที่ขาด** — `weekly` ที่ไม่มี
 *      `weekday` ถ้าเดาเป็นวันอาทิตย์ รายงานจะไปโผล่วันที่ไม่มีใครตั้ง
 *      และไม่มีอะไรบอกว่าเพี้ยน
 *   2. **ไม่มีใครเห็นหรือแก้ตารางของคนอื่นได้** — `ownerId` มาจากเซสชันเสมอ
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toUtcDate, type TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  InvalidScheduleError,
  ScheduleNotFoundError,
  ScheduleProjectNotFoundError,
  createSchedule,
  deleteSchedule,
  mySchedules,
  scheduleFromRow,
  setScheduleEnabled,
} from '../src/modules/reporting';

const STAMP = String(Date.now()).slice(-6);
const NOW = toUtcDate(Date.parse('2026-09-03T00:00:00.000Z'));

let tenantId: bigint;
let projectId: bigint;
let projectKey = '';
/** ดูรายงานได้ */
let owner: TenantContext;
/** เห็นโปรเจกต์ แต่ดูรายงานไม่ได้ */
let outsider: TenantContext;
let ownerId: bigint | undefined;
let outsiderId: bigint | undefined;

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์ตารางเวลา ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `RS${STAMP}`,
      name: `โปรเจกต์ทดสอบตารางเวลา ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true, key: true },
  });
  projectId = project.id;
  projectKey = project.key;

  const mkGroup = async (n: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `rs-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  const ownerGroupId = await mkGroup('owner');
  const outGroupId = await mkGroup('out');

  const mkUser = async (n: string, groupId: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `rs-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  ownerId = await mkUser('owner', ownerGroupId);
  outsiderId = await mkUser('out', outGroupId);

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: ownerGroupId },
      { tenantId, schemeId: scheme.id, permission: 'VIEW_REPORT', groupId: ownerGroupId },
      // เห็นโปรเจกต์ แต่ดูรายงานไม่ได้
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: outGroupId },
    ] as never,
  });
  owner = { tenantId, actorId: ownerId };
  outsider = { tenantId, actorId: outsiderId };
}, 180_000);

afterAll(async () => {
  const owners = [ownerId, outsiderId].filter((v): v is bigint => v !== undefined);
  await step('ตารางเวลา', () =>
    prismaClient.reportSchedule.deleteMany({ where: { projectId } }),
  );
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: `RS${STAMP}` } }));
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({ where: { scheme: { name: { contains: STAMP } } } }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { userId: { in: owners } } }),
  );
  await step('ผู้ใช้', () => prismaClient.user.deleteMany({ where: { id: { in: owners } } }));
  await step('กลุ่ม', () =>
    prismaClient.userGroup.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await prismaClient.$disconnect();
});

describe('A · บันทึกและอ่านกลับ', () => {
  it('ยังไม่ได้ตั้ง = รายการว่าง', async () => {
    expect(await mySchedules(owner, NOW)).toEqual([]);
  });

  it('ตั้งรายวันแล้วอ่านกลับได้ พร้อมเวลาครั้งต่อไป', async () => {
    const made = await createSchedule(
      owner,
      projectKey,
      { name: `ทุกเช้า ${STAMP}`, schedule: { kind: 'daily', hour: 8, minute: 0 } },
      NOW,
    );
    expect(made.schedule).toEqual({ kind: 'daily', hour: 8, minute: 0 });
    expect(made.lastRunAt).toBeNull();
    // 08:00 ไทย = 01:00 UTC · "ตอนนี้" คือเที่ยงคืน UTC จึงเป็นวันเดียวกัน
    expect(made.nextRunAt).toBe('2026-09-03T01:00:00.000Z');
    await deleteSchedule(owner, made.id);
  });

  it('รายสัปดาห์เก็บวันในสัปดาห์ และอ่านกลับได้', async () => {
    const made = await createSchedule(
      owner,
      projectKey,
      { name: `ทุกจันทร์ ${STAMP}`, schedule: { kind: 'weekly', weekday: 1, hour: 9, minute: 30 } },
      NOW,
    );
    expect(made.schedule).toEqual({ kind: 'weekly', weekday: 1, hour: 9, minute: 30 });
    await deleteSchedule(owner, made.id);
  });

  it('รายเดือนเก็บวันที่ และอ่านกลับได้', async () => {
    const made = await createSchedule(
      owner,
      projectKey,
      { name: `สิ้นเดือน ${STAMP}`, schedule: { kind: 'monthly', day: 31, hour: 7, minute: 0 } },
      NOW,
    );
    expect(made.schedule).toEqual({ kind: 'monthly', day: 31, hour: 7, minute: 0 });
    // กันยายนมี 30 วัน — เอนจินใช้วันสุดท้ายของเดือน
    expect(made.nextRunAt).toBe('2026-09-30T00:00:00.000Z');
    await deleteSchedule(owner, made.id);
  });

  /**
   * **คำตอบทั้งก้อนต้องแปลงเป็น JSON ได้**
   *
   * `JSON.stringify` โยน TypeError กับ BigInt · เทสต์ที่เรียก service ตรง ๆ
   * ไม่เคยผ่านชั้น serialise (CLAUDE.md)
   */
  it('**คำตอบทั้งก้อนแปลงเป็น JSON ได้**', async () => {
    const made = await createSchedule(
      owner,
      projectKey,
      { name: `json ${STAMP}`, schedule: { kind: 'daily', hour: 6, minute: 0 } },
      NOW,
    );
    const rows = await mySchedules(owner, NOW);
    expect(() => JSON.stringify(rows)).not.toThrow();
    expect(() => JSON.stringify(made)).not.toThrow();
    await deleteSchedule(owner, made.id);
  });

  it('ปิดไว้ต่างจากลบทิ้ง — ยังอยู่ในรายการแต่ไม่ทำงาน', async () => {
    const made = await createSchedule(
      owner,
      projectKey,
      { name: `ปิดไว้ ${STAMP}`, schedule: { kind: 'daily', hour: 8, minute: 0 } },
      NOW,
    );
    const off = await setScheduleEnabled(owner, made.id, false, NOW);
    expect(off.isEnabled).toBe(false);
    expect(await mySchedules(owner, NOW)).toHaveLength(1);
    await deleteSchedule(owner, made.id);
    expect(await mySchedules(owner, NOW)).toHaveLength(0);
  });
});

describe('B · แถวที่ข้อมูลไม่ครบ', () => {
  /**
   * **หัวใจของหมวดนี้**
   *
   * `weekly` ที่ไม่มี `weekday` ถ้าเดาเป็นวันอาทิตย์ รายงานจะไปโผล่วันที่
   * ไม่มีใครตั้ง และไม่มีอะไรบอกว่าเพี้ยน · ข้อมูลที่ไม่ครบต้องล้ม
   */
  it('**รายสัปดาห์ที่ไม่มีวันในสัปดาห์ ต้องล้ม ไม่ใช่เดาวันอาทิตย์**', () => {
    expect(() =>
      scheduleFromRow({ kind: 'weekly', hour: 9, minute: 0, weekday: null, day: null }),
    ).toThrow(InvalidScheduleError);
  });

  it('รายเดือนที่ไม่มีวันที่ ต้องล้ม', () => {
    expect(() =>
      scheduleFromRow({ kind: 'monthly', hour: 9, minute: 0, weekday: null, day: null }),
    ).toThrow(InvalidScheduleError);
  });

  it('รอบที่ไม่รู้จัก ต้องล้มพร้อมบอกว่ามีอะไรให้เลือก', () => {
    expect(() =>
      scheduleFromRow({ kind: 'รายปี', hour: 9, minute: 0, weekday: null, day: null }),
    ).toThrow(/daily/);
  });

  it('เวลานอกช่วงต้องล้ม', () => {
    expect(() =>
      scheduleFromRow({ kind: 'daily', hour: 24, minute: 0, weekday: null, day: null }),
    ).toThrow(InvalidScheduleError);
    expect(() =>
      scheduleFromRow({ kind: 'daily', hour: 8, minute: 60, weekday: null, day: null }),
    ).toThrow(InvalidScheduleError);
  });

  it('ชื่อว่างเปล่าถูกปฏิเสธ', async () => {
    await expect(
      createSchedule(
        owner,
        projectKey,
        { name: '   ', schedule: { kind: 'daily', hour: 8, minute: 0 } },
        NOW,
      ),
    ).rejects.toThrow(InvalidScheduleError);
    expect(await mySchedules(owner, NOW)).toHaveLength(0);
  });
});

describe('C · สิทธิ์และความเป็นเจ้าของ', () => {
  it('**ไม่มี VIEW_REPORT ตั้งไม่ได้**', async () => {
    await expect(
      createSchedule(
        outsider,
        projectKey,
        { name: `ของคนนอก ${STAMP}`, schedule: { kind: 'daily', hour: 8, minute: 0 } },
        NOW,
      ),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('โปรเจกต์ที่เปิดดูไม่ได้ ตั้งไม่ได้', async () => {
    const nobody: TenantContext = { tenantId, actorId: null };
    await expect(
      createSchedule(
        nobody,
        projectKey,
        { name: `ของใครก็ไม่รู้ ${STAMP}`, schedule: { kind: 'daily', hour: 8, minute: 0 } },
        NOW,
      ),
    ).rejects.toThrow(ScheduleProjectNotFoundError);
  });

  /**
   * **ไม่มีใครเห็นหรือแก้ตารางของคนอื่นได้**
   *
   * `ownerId` มาจาก `ctx.actorId` เสมอ ไม่ใช่จากพารามิเตอร์ · การรับตัวตน
   * จากฝั่งผู้เรียกเป็นวิธีที่ระบบสิทธิ์รั่วบ่อยที่สุด
   */
  it('**ตารางของคนอื่นไม่โผล่ในรายการของเรา และลบไม่ได้**', async () => {
    const made = await createSchedule(
      owner,
      projectKey,
      { name: `ของเจ้าของ ${STAMP}`, schedule: { kind: 'daily', hour: 8, minute: 0 } },
      NOW,
    );
    expect(await mySchedules(outsider, NOW), 'คนอื่นเห็นตารางของเรา').toEqual([]);
    await expect(deleteSchedule(outsider, made.id)).rejects.toThrow(ScheduleNotFoundError);
    expect(await mySchedules(owner, NOW), 'ถูกคนอื่นลบไปแล้ว').toHaveLength(1);
    await deleteSchedule(owner, made.id);
  });
});
