/**
 * ล็อกอินและเซสชัน — เทสต์เป็นข้อกำหนด (ADR-003)
 *
 * แตะฐานข้อมูลจริง ไม่ mock
 *
 * เขียนจากมุมของคนที่พยายามเข้าโดยไม่มีสิทธิ์: เดารหัสผ่าน หาว่าอีเมลไหนมีบัญชี
 * ใช้เซสชันที่ถูกตัดไปแล้ว และอ่านโทเคนจากฐานข้อมูลที่รั่ว
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toUtcDate } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { hashPassword } from '../src/modules/identity/password';
import {
  LOCKOUT_MAX_FAILURES,
  LoginFailedError,
  SESSION_TTL_MS,
  TooManyAttemptsError,
  hashToken,
  login,
  resolveSession,
  revokeAllSessions,
  revokeSession,
} from '../src/modules/identity/session.service';

const PASSWORD = 'ปลาทูอบเกลือสามตัว';
const EMAIL = 'login-test@example.test';
const INACTIVE_EMAIL = 'inactive-test@example.test';

let tenantId: bigint;
let userId: bigint;
let inactiveId: bigint;

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirst({ where: { key: 'default' } });
  if (tenant === null) {
    throw new Error('ยังไม่มีข้อมูล seed — รัน `pnpm --filter @itsm/api seed` ก่อน');
  }
  tenantId = tenant.id;

  const hash = await hashPassword(PASSWORD);
  const mk = async (email: string, isActive: boolean): Promise<bigint> => {
    const u = await prismaClient.user.upsert({
      where: { tenantId_email: { tenantId, email } },
      create: { tenantId, email, displayName: 'ผู้ใช้ทดสอบ', passwordHash: hash, isActive },
      update: { passwordHash: hash, isActive },
      select: { id: true },
    });
    return u.id;
  };
  userId = await mk(EMAIL, true);
  inactiveId = await mk(INACTIVE_EMAIL, false);
});

beforeEach(async () => {
  await prismaClient.loginAttempt.deleteMany({ where: { tenantId } });
  await prismaClient.session.deleteMany({ where: { userId: { in: [userId, inactiveId] } } });
});

afterAll(async () => {
  await prismaClient.session.deleteMany({ where: { userId: { in: [userId, inactiveId] } } });
  await prismaClient.loginAttempt.deleteMany({ where: { tenantId } });
  await prismaClient.user.deleteMany({ where: { id: { in: [userId, inactiveId] } } });
  await prismaClient.$disconnect();
});

describe('login', () => {
  it('รหัสผ่านถูกต้องได้เซสชัน', async () => {
    const r = await login({ tenantId, email: EMAIL, password: PASSWORD });
    expect(r.token.length).toBeGreaterThan(20);
    expect(r.user.id).toBe(userId);
  });

  it('อีเมลไม่สนใจตัวพิมพ์ใหญ่เล็กและช่องว่างหัวท้าย', async () => {
    const r = await login({ tenantId, email: `  ${EMAIL.toUpperCase()}  `, password: PASSWORD });
    expect(r.user.id).toBe(userId);
  });

  it('รหัสผ่านผิดถูกปฏิเสธ', async () => {
    await expect(login({ tenantId, email: EMAIL, password: 'ผิดแน่นอนแต่ยาวพอ' })).rejects.toThrow(
      LoginFailedError,
    );
  });

  it('**อีเมลที่ไม่มีบัญชี ได้ error เหมือนรหัสผ่านผิดทุกประการ**', async () => {
    // ถ้าข้อความหรือชนิด error ต่างกัน ผู้โจมตีจะรู้ว่าอีเมลไหนมีบัญชีอยู่
    const a = await login({ tenantId, email: EMAIL, password: 'ผิดแน่นอนแต่ยาวพอ' }).catch(
      (e: unknown) => e,
    );
    const b = await login({ tenantId, email: 'ไม่มีจริง@example.test', password: PASSWORD }).catch(
      (e: unknown) => e,
    );
    expect((a as Error).name).toBe((b as Error).name);
    expect((a as Error).message).toBe((b as Error).message);
  });

  it('บัญชีที่ถูกปิดล็อกอินไม่ได้ แม้รหัสผ่านถูก', async () => {
    await expect(login({ tenantId, email: INACTIVE_EMAIL, password: PASSWORD })).rejects.toThrow(
      LoginFailedError,
    );
  });

  it('บัญชีระบบล็อกอินไม่ได้ — มันคือ actor ของ automation ไม่ใช่คน', async () => {
    const sys = await prismaClient.user.findFirst({ where: { tenantId, isSystem: true } });
    if (sys === null) return;
    await prismaClient.user.update({
      where: { id: sys.id },
      data: { passwordHash: await hashPassword(PASSWORD) },
    });
    await expect(login({ tenantId, email: sys.email, password: PASSWORD })).rejects.toThrow(
      LoginFailedError,
    );
    await prismaClient.user.update({ where: { id: sys.id }, data: { passwordHash: null } });
  });

  it('**ฐานข้อมูลเก็บแฮชของโทเคน ไม่ใช่ตัวโทเคน**', async () => {
    const r = await login({ tenantId, email: EMAIL, password: PASSWORD });
    const row = await prismaClient.session.findFirstOrThrow({ where: { userId } });
    expect(row.tokenHash).not.toBe(r.token);
    expect(row.tokenHash).toBe(hashToken(r.token));
    // อ่านทั้งตารางแล้วต้องไม่เจอโทเคนจริงที่ไหนเลย
    const all = await prismaClient.session.findMany();
    expect(JSON.stringify(all.map((s) => s.tokenHash))).not.toContain(r.token);
  });

  it('บันทึกความพยายามทั้งที่สำเร็จและล้มเหลว', async () => {
    await login({ tenantId, email: EMAIL, password: PASSWORD });
    await login({ tenantId, email: EMAIL, password: 'ผิดแน่นอนแต่ยาวพอ' }).catch(() => null);
    const rows = await prismaClient.loginAttempt.findMany({ where: { tenantId } });
    expect(rows.filter((r) => r.succeeded)).toHaveLength(1);
    expect(rows.filter((r) => !r.succeeded)).toHaveLength(1);
  });

  it('อัปเดต lastLoginAt เมื่อสำเร็จ', async () => {
    const before = await prismaClient.user.findFirstOrThrow({ where: { id: userId } });
    await login({ tenantId, email: EMAIL, password: PASSWORD });
    const after = await prismaClient.user.findFirstOrThrow({ where: { id: userId } });
    expect(after.lastLoginAt).not.toBeNull();
    expect(after.lastLoginAt?.getTime() ?? 0).toBeGreaterThanOrEqual(
      before.lastLoginAt?.getTime() ?? 0,
    );
  });
});

describe('การจำกัดจำนวนครั้งที่เดารหัสผ่าน', () => {
  it(`ล้มครบ ${String(LOCKOUT_MAX_FAILURES)} ครั้งแล้วถูกกั้น`, async () => {
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i += 1) {
      await login({ tenantId, email: EMAIL, password: 'ผิดแน่นอนแต่ยาวพอ' }).catch(() => null);
    }
    await expect(login({ tenantId, email: EMAIL, password: PASSWORD })).rejects.toThrow(
      TooManyAttemptsError,
    );
  });

  it('**กั้นแม้รหัสผ่านถูก** — ไม่งั้นการเดาที่สำเร็จก็ยังผ่านเข้าไปได้', async () => {
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i += 1) {
      await login({ tenantId, email: EMAIL, password: 'ผิดแน่นอนแต่ยาวพอ' }).catch(() => null);
    }
    const err = await login({ tenantId, email: EMAIL, password: PASSWORD }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TooManyAttemptsError);
  });

  it('**นับตามอีเมลที่กรอก** — ยิงสุ่มอีเมลที่ไม่มีบัญชีก็ถูกจำกัด', async () => {
    const ghost = 'ไม่มีบัญชีนี้@example.test';
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i += 1) {
      await login({ tenantId, email: ghost, password: 'อะไรก็ได้ที่ยาวพอ' }).catch(() => null);
    }
    await expect(login({ tenantId, email: ghost, password: 'อะไรก็ได้ที่ยาวพอ' })).rejects.toThrow(
      TooManyAttemptsError,
    );
  });

  it('อีเมลอื่นไม่ถูกกั้นไปด้วย — ไม่งั้นใครก็ล็อกบัญชีคนอื่นได้', async () => {
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i += 1) {
      await login({ tenantId, email: 'เป้าหมาย@example.test', password: 'มั่ว' }).catch(() => null);
    }
    await expect(login({ tenantId, email: EMAIL, password: PASSWORD })).resolves.toBeTruthy();
  });

  it('ความล้มเหลวที่เก่ากว่าหน้าต่างไม่ถูกนับ', async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await prismaClient.loginAttempt.createMany({
      data: Array.from({ length: LOCKOUT_MAX_FAILURES + 3 }, () => ({
        tenantId,
        identifier: EMAIL,
        succeeded: false,
        createdAt: old,
      })),
    });
    await expect(login({ tenantId, email: EMAIL, password: PASSWORD })).resolves.toBeTruthy();
  });
});

describe('resolveSession', () => {
  it('โทเคนที่ถูกต้องคืนบริบทของผู้ใช้', async () => {
    const r = await login({ tenantId, email: EMAIL, password: PASSWORD });
    const s = await resolveSession(r.token);
    expect(s?.ctx).toEqual({ tenantId, actorId: userId });
  });

  it.each([
    ['โทเคนว่าง', ''],
    ['โทเคนมั่ว', 'ไม่ใช่โทเคนจริง'],
  ])('%s คืน null ไม่ใช่โยน error', async (_l, token) => {
    await expect(resolveSession(token)).resolves.toBeNull();
  });

  it('**เซสชันที่ถูกเพิกถอนใช้ไม่ได้ทันที** — นี่คือเหตุผลที่ไม่ใช้ JWT', async () => {
    const r = await login({ tenantId, email: EMAIL, password: PASSWORD });
    expect(await resolveSession(r.token)).not.toBeNull();
    await revokeSession(r.token);
    expect(await resolveSession(r.token)).toBeNull();
  });

  it('เซสชันที่หมดอายุใช้ไม่ได้', async () => {
    const r = await login({ tenantId, email: EMAIL, password: PASSWORD });
    const later = toUtcDate(new Date(Date.now() + SESSION_TTL_MS + 1000).toISOString());
    expect(await resolveSession(r.token, later)).toBeNull();
  });

  it('บัญชีที่ถูกปิดหลังล็อกอิน ใช้เซสชันเดิมต่อไม่ได้', async () => {
    const r = await login({ tenantId, email: EMAIL, password: PASSWORD });
    await prismaClient.user.update({ where: { id: userId }, data: { isActive: false } });
    expect(await resolveSession(r.token)).toBeNull();
    await prismaClient.user.update({ where: { id: userId }, data: { isActive: true } });
  });

  it('ออกจากระบบซ้ำไม่เป็น error', async () => {
    const r = await login({ tenantId, email: EMAIL, password: PASSWORD });
    await revokeSession(r.token);
    await expect(revokeSession(r.token)).resolves.toBeUndefined();
  });

  it('เพิกถอนทุกเครื่องตัดทุกเซสชันพร้อมกัน', async () => {
    const a = await login({ tenantId, email: EMAIL, password: PASSWORD });
    const b = await login({ tenantId, email: EMAIL, password: PASSWORD });
    expect(await revokeAllSessions(userId)).toBe(2);
    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).toBeNull();
  });

  it('เพิกถอนของคนหนึ่งไม่กระทบอีกคน', async () => {
    const mine = await login({ tenantId, email: EMAIL, password: PASSWORD });
    await prismaClient.user.update({ where: { id: inactiveId }, data: { isActive: true } });
    const theirs = await login({ tenantId, email: INACTIVE_EMAIL, password: PASSWORD });
    await revokeAllSessions(inactiveId);
    expect(await resolveSession(mine.token)).not.toBeNull();
    expect(await resolveSession(theirs.token)).toBeNull();
    await prismaClient.user.update({ where: { id: inactiveId }, data: { isActive: false } });
  });
});
