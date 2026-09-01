/**
 * เก็บกวาดเซสชันที่ตายแล้ว — ต่อของจริง
 *
 * `session-reaper.spec.ts` ประกอบข้อมูลนำเข้าขึ้นมาเอง จึงพิสูจน์ได้แค่ว่า
 * *ถ้า* ข้อมูลหน้าตาแบบนั้นเข้ามา ผลจะถูก · ไฟล์นี้ถามคำถามที่เอนจินตอบไม่ได้:
 *
 *   1. **มันลบของจริงได้ไหม** — คิวรีที่กรองผิดจะไม่เจออะไรเลย แล้วตัวกวาด
 *      จะรายงานว่า "ไม่มีอะไรให้เก็บ" ตลอดกาล ซึ่งอ่านเหมือนทำงานปกติ
 *   2. **มันแตะเซสชันที่ยังใช้ได้ไหม** — คำถามที่สำคัญกว่าข้อแรก · คนกำลัง
 *      ทำงานอยู่แล้วหลุดกลางคัน เป็นความเสียหายที่หาสาเหตุไม่เจอ
 *   3. **แถวที่เพิ่งตาย ยังอยู่ไหม** — ตารางนี้เป็นร่องรอยความปลอดภัยด้วย
 *   4. **ข้ามทุกองค์กรจริงไหม** — งานเบื้องหลังที่กวาดแค่องค์กรแรกในตาราง
 *      จะทำให้องค์กรที่สองโตต่อไปเงียบ ๆ
 *
 * เทสต์สร้างผู้ใช้และเซสชันของตัวเองทั้งหมด แล้วลบทิ้ง ไม่แตะข้อมูล seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toUtcDate } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { SESSION_KEEP_DAYS, reapSessions } from '../src/modules/identity';

const STAMP = String(Date.now()).slice(-6);
/**
 * "ตอนนี้" ของเทสต์ — **ตั้งไว้ในอดีตโดยตั้งใจ**
 *
 * `reapSessions` ลบทุกองค์กรตามหน้าที่ของมัน · ถ้าตั้ง "ตอนนี้" ไว้ในอนาคต
 * เซสชันจริงของฐานข้อมูลพัฒนาทุกแถวจะตายและถูกลบไปด้วย — ซึ่งเป็นการแก้
 * ข้อมูลที่เทสต์ไม่ได้สร้าง (CLAUDE.md ห้ามไว้)
 *
 * ตั้งไว้ต้นปี 2569 ซึ่งก่อนที่เซสชันจริงใบแรกจะเกิด · แถวของเทสต์วางตำแหน่ง
 * สัมพันธ์กับค่านี้ จึงทำงานเหมือนเดิมทุกอย่าง ส่วนแถวจริงไม่เข้าเงื่อนไขเลย
 */
const NOW = toUtcDate('2026-01-01T00:00:00.000Z');
const DAY = 86_400_000;

function days(n: number): Date {
  return new Date(NOW.getTime() + n * DAY);
}

let tenantId: bigint;
let otherTenantId: bigint;
let userId: bigint;
let otherUserId: bigint;
const made = new Map<string, bigint>();

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

/** โทเคนมี stamp เสมอ — ตอนกลไกถูกลบ ค่าที่ "ไม่ควรถูกใช้" จะถูกใช้จริง */
async function newSession(
  tag: string,
  o: { expires: Date; revoked?: Date | null; tenant?: bigint; user?: bigint },
): Promise<bigint> {
  const s = await prismaClient.session.create({
    data: {
      tenantId: o.tenant ?? tenantId,
      userId: o.user ?? userId,
      tokenHash: `reap-${STAMP}-${tag}`.padEnd(64, '0').slice(0, 64),
      expiresAt: o.expires,
      revokedAt: o.revoked ?? null,
      lastSeenAt: days(-1),
    },
    select: { id: true },
  });
  made.set(tag, s.id);
  return s.id;
}

const alive = async (tag: string): Promise<boolean> =>
  (await prismaClient.session.count({ where: { id: made.get(tag) ?? BigInt(0) } })) === 1;

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  userId = (
    await prismaClient.user.create({
      data: {
        tenantId,
        email: `reap-${STAMP}@example.test`,
        displayName: `QA เก็บกวาดเซสชัน ${STAMP}`,
      },
      select: { id: true },
    })
  ).id;

  /*
    **สร้างองค์กรที่สองเอง ไม่ใช่ข้ามเมื่อไม่มี**

    จำเป็นเพื่อพิสูจน์ว่าตัวกวาดข้ามทุก tenant จริง — ถ้ามีองค์กรเดียว
    การกวาดที่ผูกกับ tenant แรกจะยังเขียว · ฐานข้อมูลพัฒนามีองค์กรเดียว
    ตอนเขียนไฟล์นี้ และ "เทสต์ที่ต้องการของนอกตัว ต้องสร้างของนั้นเอง
    ไม่ใช่ข้ามเมื่อไม่มี" (CLAUDE.md)

    องค์กรนี้มีแค่ผู้ใช้กับเซสชัน ไม่มี workflow scheme จึงลบได้ตรง ๆ —
    แต่ยังลบตามลำดับเอง ไม่พึ่ง cascade ตามกติกาเดียวกับ `seed.ts`
  */
  otherTenantId = (
    await prismaClient.tenant.create({
      data: { key: `reap-${STAMP}`, name: `องค์กรทดสอบเก็บกวาด ${STAMP}` },
      select: { id: true },
    })
  ).id;
  otherUserId = (
    await prismaClient.user.create({
      data: {
        tenantId: otherTenantId,
        email: `reap2-${STAMP}@example.test`,
        displayName: `QA เก็บกวาดเซสชัน 2 ${STAMP}`,
      },
      select: { id: true },
    })
  ).id;
}, 120_000);

afterAll(async () => {
  await step('เซสชันของเทสต์', () =>
    prismaClient.session.deleteMany({ where: { tokenHash: { contains: STAMP } } }),
  );
  await step('ผู้ใช้ของเทสต์', () =>
    prismaClient.user.deleteMany({ where: { email: { contains: STAMP } } }),
  );
  await step('องค์กรของเทสต์', () =>
    prismaClient.tenant.deleteMany({ where: { key: { contains: STAMP } } }),
  );

  // ยืนยันด้วยการนับหลังคืน ไม่ใช่เชื่อว่าลูปทำงาน
  const left =
    (await prismaClient.session.count({ where: { tokenHash: { contains: STAMP } } })) +
    (await prismaClient.tenant.count({ where: { key: { contains: STAMP } } }));
  if (left > 0) console.error(`เหลือของเทสต์ค้างอยู่ ${String(left)} รายการ`);
  await prismaClient.$disconnect();
});

describe('เก็บกวาดเซสชัน · ต่อของจริง', () => {
  it('**ลบของจริงได้ และไม่แตะเซสชันที่ยังใช้ได้**', async () => {
    await newSession('LIVE', { expires: days(7) });
    await newSession('DEAD', { expires: days(-SESSION_KEEP_DAYS - 5) });

    const r = await reapSessions(NOW);
    expect(r.deleted, 'ไม่ลบอะไรเลย — คิวรีอาจกรองผิดจนไม่เจอของที่ตายแล้ว').toBeGreaterThan(0);

    expect(await alive('DEAD')).toBe(false);
    /*
      **คำถามที่สำคัญกว่าข้อแรก** — คนกำลังทำงานอยู่แล้วหลุดกลางคัน
      เป็นความเสียหายที่หาสาเหตุไม่เจอ
    */
    expect(await alive('LIVE')).toBe(true);
  });

  it('**แถวที่เพิ่งตาย ยังอยู่ — ตารางนี้เป็นร่องรอยความปลอดภัยด้วย**', async () => {
    await newSession('RECENT', { expires: days(-1) });
    await newSession('JUSTREVOKED', { expires: days(30), revoked: days(-2) });

    await reapSessions(NOW);
    expect(await alive('RECENT')).toBe(true);
    expect(await alive('JUSTREVOKED')).toBe(true);
  });

  it('เซสชันที่ถูกเพิกถอนนานแล้ว ถูกลบแม้ยังไม่ถึงวันหมดอายุ', async () => {
    await newSession('OLDREVOKED', {
      expires: days(365),
      revoked: days(-SESSION_KEEP_DAYS - 3),
    });
    await reapSessions(NOW);
    expect(await alive('OLDREVOKED')).toBe(false);
  });

  it('**ข้ามทุกองค์กร ไม่ใช่แค่องค์กรแรก**', async () => {
    // ยืนยันว่าองค์กรที่สองคนละใบกับใบแรกจริง ไม่ใช่ตัวแปรที่ชี้ซ้ำ
    expect(otherTenantId).not.toBe(tenantId);
    await newSession('OTHERTENANT', {
      expires: days(-SESSION_KEEP_DAYS - 2),
      tenant: otherTenantId,
      user: otherUserId,
    });
    await reapSessions(NOW);
    expect(await alive('OTHERTENANT')).toBe(false);
  });

  it('รอบที่สองไม่มีอะไรให้ลบ — กวาดซ้ำแล้วผลเหมือนเดิม (idempotent)', async () => {
    const first = await reapSessions(NOW);
    const second = await reapSessions(NOW);
    expect(second.deleted).toBe(0);
    expect(first.deleted).toBeGreaterThanOrEqual(0);
    // ของที่ยังใช้ได้ยังอยู่หลังกวาดสองรอบ
    expect(await alive('LIVE')).toBe(true);
  });
});
