/**
 * นโยบายระยะเวลาเก็บข้อมูล — ต่อของจริง
 *
 * ## ไฟล์นี้อันตรายที่สุดในชุดเทสต์ทั้งหมด และนี่คือวิธีที่มันถูกกันไว้
 *
 * `runRetention` **ลบแถวจริงในฐานข้อมูล** และทำงานกับทุกแถวขององค์กร ·
 * บทเรียนที่แพงที่สุดของโปรเจกต์นี้คือเทสต์ของตัวเก็บกวาดเซสชัน ซึ่งแตะแต่
 * ของตัวเองทุกอย่าง แต่ส่ง `now` เป็นปี 2572 เข้าไป — แถวจริง 187 แถวจึงเข้า
 * เงื่อนไขไปด้วย และหายไปโดยกู้ไม่ได้
 *
 * **"ตอนนี้" ของไฟล์นี้จึงอยู่ที่ปี 2020** ซึ่งเก่ากว่าแถวจริงที่เก่าที่สุด
 * ในฐานข้อมูลพัฒนา (2026-08-25) หลายปี · เส้นแบ่งที่คำนวณจากมันจึงไปไม่ถึง
 * ข้อมูลจริงได้เลย ไม่ว่า `keepDays` จะเป็นเท่าไร · แถวของเทสต์ถูกวางไว้
 * รอบ ๆ ปี 2020 โดยตั้ง `createdAt` เอง
 *
 * และก่อนรัน คำถามที่ต้องตอบไม่ใช่ "เทสต์ของฉันสร้างอะไรไว้" แต่คือ
 * **"ถ้าฟังก์ชันนี้ทำงานถูกต้องทุกประการ มันจะแตะแถวของใครบ้าง"**
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import { retentionSettings, runRetention, setRetention } from '../src/modules/identity';
import { InvalidKeepDaysError } from '../src/modules/identity/retention';

const STAMP = String(Date.now()).slice(-6);

/** ก่อนแถวจริงใบแรกในฐานข้อมูลพัฒนา (2026-08-25) หลายปี */
const NOW = new Date('2020-06-01T00:00:00.000Z');
/** เก่ากว่าเส้นแบ่ง (NOW − 30 วัน = 2020-05-02) → ต้องถูกลบ */
const OLD = new Date('2020-01-01T00:00:00.000Z');
/** ใหม่กว่าเส้นแบ่ง → ต้องรอด */
const RECENT = new Date('2020-05-31T00:00:00.000Z');

let tenantId: bigint;
let adminId: bigint;
let outsiderId: bigint;
let adminCtx: TenantContext;
let outsiderCtx: TenantContext;
let groupId: bigint;
const grantIds: bigint[] = [];
const madeNotificationIds: bigint[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

interface Census {
  notification: number;
  notificationDelivery: number;
  auditLog: number;
  workItemHistory: number;
}

/**
 * ยอดรวมของทุกตารางที่นโยบายแตะได้ — ใช้เทียบก่อนและหลัง
 *
 * ประกาศชนิดตายตัว ไม่ใช่ `Record<string, number>` · ชนิดที่หลวมทำให้
 * `census().notifcation` (พิมพ์ผิด) กลายเป็น `undefined` แล้วการเทียบผ่าน
 * ไปเงียบ ๆ — ซึ่งเป็นชนิดของบั๊กที่ไฟล์นี้มีไว้จับพอดี
 */
async function census(): Promise<Census> {
  return {
    notification: await prismaClient.notification.count(),
    notificationDelivery: await prismaClient.notificationDelivery.count(),
    auditLog: await prismaClient.auditLog.count(),
    workItemHistory: await prismaClient.workItemHistory.count(),
  };
}

async function mkNotification(createdAt: Date, tag: string): Promise<bigint> {
  const n = await prismaClient.notification.create({
    data: {
      tenantId,
      userId: adminId,
      kind: 'sla.threshold',
      title: `เทสต์ระยะเวลาเก็บ ${tag} ${STAMP}`,
      dedupeKey: `retention-${STAMP}-${tag}`,
      createdAt,
    },
    select: { id: true },
  });
  madeNotificationIds.push(n.id);
  return n.id;
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  const project = await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } });
  if (project.permissionSchemeId === null) throw new Error('โปรเจกต์ SD ไม่มี permission scheme');

  const mkUser = async (tag: string): Promise<bigint> =>
    (
      await prismaClient.user.create({
        data: {
          tenantId,
          email: `ret-${tag}-${STAMP}@example.test`,
          displayName: `QA ระยะเวลาเก็บ ${tag} ${STAMP}`,
        },
        select: { id: true },
      })
    ).id;
  adminId = await mkUser('admin');
  outsiderId = await mkUser('outsider');
  adminCtx = { tenantId, actorId: adminId };
  outsiderCtx = { tenantId, actorId: outsiderId };

  /*
    กลุ่มผู้ดูแลของเทสต์เอง — **ไม่แตะ grant ของ seed** · เคยมีเทสต์ที่ย้าย
    grant `ADMINISTER_TENANT` ออกไปชั่วคราวแล้วคืนไม่ครบ ทำให้ฐานข้อมูลพัฒนา
    เหลือผู้ดูแลศูนย์คน และกู้ได้ทาง SQL ทางเดียว (CLAUDE.md)
  */
  groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `ระยะเวลาเก็บ ${STAMP}` },
      select: { id: true },
    })
  ).id;
  const grant = await prismaClient.permissionGrant.create({
    data: {
      tenantId,
      schemeId: project.permissionSchemeId,
      permission: 'ADMINISTER_TENANT',
      groupId,
    },
    select: { id: true },
  });
  grantIds.push(grant.id);
  await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: adminId } });
}, 120_000);

afterAll(async () => {
  await step('การแจ้งเตือนของเทสต์', () =>
    prismaClient.notification.deleteMany({ where: { dedupeKey: { contains: STAMP } } }),
  );
  await step('นโยบาย', () =>
    prismaClient.retentionPolicy.deleteMany({ where: { tenantId } }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({ where: { actorId: { in: [adminId, outsiderId] } } }),
  );
  await step('สิทธิ์ของเทสต์', () =>
    prismaClient.permissionGrant.deleteMany({ where: { id: { in: grantIds } } }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { userId: { in: [adminId, outsiderId] } } }),
  );
  await step('ผู้ใช้', () =>
    prismaClient.user.deleteMany({ where: { email: { endsWith: `-${STAMP}@example.test` } } }),
  );
  await step('กลุ่ม', () => prismaClient.userGroup.deleteMany({ where: { id: groupId } }));

  const left = await prismaClient.user.count({
    where: { email: { endsWith: `-${STAMP}@example.test` } },
  });
  const policiesLeft = await prismaClient.retentionPolicy.count({ where: { tenantId } });
  await prismaClient.$disconnect();
  expect(left, `เก็บกวาดไม่ครบ — เหลือผู้ใช้ของเทสต์ ${String(left)} คน`).toBe(0);
  expect(policiesLeft, 'เหลือนโยบายของเทสต์ค้างในฐานข้อมูล').toBe(0);
});

describe('ระยะเวลาเก็บ · ต่อของจริง', () => {
  it('**คนที่ไม่ใช่ผู้ดูแลองค์กร ดูไม่ได้และตั้งไม่ได้**', async () => {
    await expect(retentionSettings(outsiderCtx, NOW)).rejects.toThrow(PermissionDeniedError);
    await expect(setRetention(outsiderCtx, 'notification', 90, true, NOW)).rejects.toThrow(
      PermissionDeniedError,
    );
    await expect(runRetention(outsiderCtx, NOW)).rejects.toThrow(PermissionDeniedError);
  }, 120_000);

  /**
   * **หัวใจของไฟล์นี้**
   *
   * องค์กรที่ยังไม่เคยตั้งนโยบาย ต้องไม่มีอะไรถูกลบ · ถ้าข้อนี้พัง ความเสียหาย
   * คือข้อมูลที่กู้ไม่ได้ ไม่ใช่หน้าจอที่แสดงผิด
   */
  it('**ยังไม่ได้ตั้งนโยบาย — กดลบแล้วไม่มีอะไรหายไปสักแถว**', async () => {
    const before = await census();
    const result = await runRetention(adminCtx, NOW);
    expect(result.deleted).toEqual([]);
    expect(await census()).toEqual(before);
  }, 120_000);

  it('หน้าจอแสดงทุกตารางที่ตั้งได้ รวมตารางที่ยังไม่เคยตั้ง', async () => {
    const view = await retentionSettings(adminCtx, NOW);
    expect(view.rows.length).toBeGreaterThan(2);
    expect(view.rows.every((r) => r.keepDays === null)).toBe(true);
    expect(view.rows.every((r) => r.why.length > 10)).toBe(true);
  }, 120_000);

  it('**ค่าที่ต่ำกว่าขั้นต่ำ บันทึกไม่ได้เลย**', async () => {
    await expect(setRetention(adminCtx, 'audit_log', 30, true, NOW)).rejects.toThrow(
      InvalidKeepDaysError,
    );
    const view = await retentionSettings(adminCtx, NOW);
    expect(view.rows.find((r) => r.target === 'audit_log')?.keepDays, 'ค่าที่ผิดถูกบันทึกไป').toBeNull();
  }, 120_000);

  /**
   * **นโยบายที่ปิดอยู่ ต้องไม่ลบอะไร**
   *
   * ตั้งค่าไว้แต่ยังไม่เปิด เป็นสถานะที่คนใช้จริง — ตั้งไว้ก่อนแล้วค่อยตัดสินใจ ·
   * ถ้ามันลบทันทีที่บันทึก จะไม่มีใครกล้าตั้งอะไรเลย
   */
  it('**ตั้งแล้วแต่ยังไม่เปิด — ไม่มีอะไรถูกลบ**', async () => {
    await mkNotification(OLD, 'off');
    await setRetention(adminCtx, 'notification', 30, false, NOW);
    const before = await census();
    const result = await runRetention(adminCtx, NOW);
    expect(result.deleted).toEqual([]);
    expect(await census()).toEqual(before);
  }, 120_000);

  /**
   * **ลบของที่เก่ากว่าเส้นแบ่ง และไม่แตะของที่ใหม่กว่า**
   *
   * นับยอดทุกตารางก่อนและหลัง แล้วยืนยันว่าเปลี่ยนเฉพาะจำนวนที่ประกาศไว้ —
   * ไม่ใช่แค่ดูว่าแถวของเทสต์หายไป · แถวของคนอื่นที่หายไปด้วยจะไม่มีใครเห็น
   * ถ้าไม่นับทั้งตาราง
   */
  it('**ลบเฉพาะที่เก่ากว่าเส้นแบ่ง — ตารางอื่นและแถวใหม่กว่าไม่ถูกแตะ**', async () => {
    const doomed = await mkNotification(OLD, 'doomed');
    const survivor = await mkNotification(RECENT, 'survivor');

    await setRetention(adminCtx, 'notification', 30, true, NOW);

    const before = await census();
    const result = await runRetention(adminCtx, NOW);

    const one = result.deleted.find((d) => d.target === 'notification');
    expect(one?.count, 'ต้องลบแถวที่เก่ากว่าเส้นแบ่ง').toBeGreaterThanOrEqual(1);

    const after = await census();
    expect(
      before.notification - after.notification,
      'จำนวนที่หายไปต้องตรงกับจำนวนที่รายงาน',
    ).toBe(one?.count);
    // ตารางอื่นห้ามขยับเลย — นโยบายเปิดอยู่แค่ตารางเดียว
    expect(after.auditLog - before.auditLog, 'audit เพิ่มได้เท่าที่เทสต์เขียนเอง').toBeGreaterThanOrEqual(0);
    expect(after.workItemHistory).toBe(before.workItemHistory);

    expect(await prismaClient.notification.findUnique({ where: { id: doomed } })).toBeNull();
    expect(
      await prismaClient.notification.findUnique({ where: { id: survivor } }),
      'แถวที่ใหม่กว่าเส้นแบ่งต้องรอด',
    ).not.toBeNull();
  }, 120_000);

  /**
   * **ข้อมูลจริงในฐานข้อมูลพัฒนาต้องไม่ถูกแตะเลย**
   *
   * เส้นแบ่งที่คำนวณจาก `NOW` ปี 2020 ไปไม่ถึงแถวปี 2026 ได้ · เคสนี้พิสูจน์
   * ว่าเป็นอย่างนั้นจริง แทนที่จะเชื่อการคำนวณในหัว
   */
  it('**แถวจริงปี 2026 ไม่เข้าเงื่อนไขของเส้นแบ่งปี 2020**', async () => {
    const realOnes = await prismaClient.notification.count({
      where: { createdAt: { gte: new Date('2026-01-01T00:00:00.000Z') } },
    });
    await setRetention(adminCtx, 'notification', 30, true, NOW);
    await runRetention(adminCtx, NOW);
    expect(
      await prismaClient.notification.count({
        where: { createdAt: { gte: new Date('2026-01-01T00:00:00.000Z') } },
      }),
      'แถวจริงถูกลบไป — เส้นแบ่งไปไกลเกินกว่าที่ตั้งใจ',
    ).toBe(realOnes);
  }, 120_000);

  /** ครั้งที่ลบต้องถูกบันทึก แม้ลบ 0 แถว — ไม่งั้นตอบไม่ได้ว่าเคยทำงานหรือยัง */
  it('**บันทึกว่าเคยลบเมื่อไรและกี่แถว แม้ลบศูนย์แถว**', async () => {
    await setRetention(adminCtx, 'notification', 30, true, NOW);
    await runRetention(adminCtx, NOW);
    // รอบสองไม่มีอะไรเหลือให้ลบแล้ว แต่ยังต้องบันทึก
    await runRetention(adminCtx, NOW);
    const view = await retentionSettings(adminCtx, NOW);
    const row = view.rows.find((r) => r.target === 'notification');
    expect(row?.lastRunAt, 'ไม่ได้บันทึกว่าเคยลบ').not.toBeNull();
    expect(row?.lastDeleted).toBe(0);
  }, 120_000);
});
