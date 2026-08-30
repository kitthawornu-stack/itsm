/**
 * เซสชันและการล็อกอิน
 *
 * ตัดสินไว้ใน ADR-003: เซสชันฝั่งเซิร์ฟเวอร์ + opaque token ไม่ใช่ JWT
 * เหตุผลหลักคือ **เพิกถอนได้จริงในวินาทีที่กด** และตอบได้ว่าตอนนี้ใครล็อกอินอยู่
 *
 * สิ่งที่ระวังเป็นพิเศษ:
 *
 *   - **เก็บแฮชของโทเคน ไม่เก็บตัวโทเคน** — ฐานข้อมูลที่รั่วต้องไม่ให้สวมรอยได้ทันที
 *   - **ตอบเหมือนกันทุกกรณีที่ล็อกอินไม่ผ่าน** — ไม่บอกว่าอีเมลนี้มีอยู่หรือไม่
 *   - **แฮชรหัสผ่านหลอกเมื่อไม่พบบัญชี** — ไม่งั้นเวลาที่ใช้จะบอกว่าอีเมลมีจริง
 *   - **นับความพยายามตามอีเมลที่กรอก** ไม่ใช่ตาม userId เพราะการยิงสุ่มอีเมล
 *     ที่ไม่มีบัญชีต้องถูกจำกัดด้วย
 */
import { createHash, randomBytes } from 'node:crypto';
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { tenantScoped, withSystemScope } from '../../infrastructure/prisma/tenant-scope';
import { hashPassword, needsRehash, verifyPassword } from './password';

/** อายุเซสชัน — 12 ชั่วโมง พอสำหรับหนึ่งวันทำงาน ไม่ค้างข้ามคืน */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** หน้าต่างและเพดานของการเดารหัสผ่าน */
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MAX_FAILURES = 8;

export class LoginFailedError extends Error {
  constructor() {
    // ข้อความเดียวสำหรับทุกสาเหตุ — อีเมลผิด รหัสผิด บัญชีปิด ต้องแยกไม่ออก
    super('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    this.name = 'LoginFailedError';
  }
}

export class TooManyAttemptsError extends Error {
  constructor(readonly retryAfterMs: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
    super(`ลองผิดหลายครั้งเกินไป — รออีก ${String(minutes)} นาทีแล้วลองใหม่`);
    this.name = 'TooManyAttemptsError';
  }
}

/** โทเคนที่ส่งให้ผู้ใช้ — สุ่ม 32 ไบต์ ไม่มีความหมายในตัว */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * แฮชโทเคนด้วย SHA-256 ไม่ใช่ scrypt
 *
 * ต่างจากรหัสผ่านตรงที่โทเคนสุ่มมา 256 บิตอยู่แล้ว การเดาแบบ brute force
 * เป็นไปไม่ได้ในทางปฏิบัติ จึงไม่ต้องการ KDF ที่ช้าโดยตั้งใจ —
 * และ **ต้องไม่ช้า** เพราะทำงานทุกคำขอ
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface LoginContext {
  tenantId: bigint;
  email: string;
  password: string;
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

export interface LoginResult {
  token: string;
  expiresAt: UtcDate;
  user: { id: bigint; email: string; displayName: string };
}

/**
 * แฮชหลอกสำหรับกรณีที่ไม่พบบัญชี
 *
 * ถ้าไม่ทำ การล็อกอินด้วยอีเมลที่ไม่มีอยู่จะเร็วกว่าอีเมลที่มีอยู่อย่างชัดเจน
 * (เพราะข้ามการแฮชไป) ซึ่งเท่ากับบอกผู้โจมตีว่าอีเมลไหนมีบัญชีจริง
 * สร้างครั้งเดียวตอนโหลดโมดูล แล้วใช้ซ้ำ — ค่าไม่ต้องเป็นความลับ
 */
let decoyHash: Promise<string> | null = null;
function getDecoyHash(): Promise<string> {
  decoyHash ??= hashPassword('รหัสผ่านหลอกที่ไม่มีใครใช้จริงและยาวพอ');
  return decoyHash;
}

export async function login(
  input: LoginContext,
  now: UtcDate = systemClock.nowUtc(),
): Promise<LoginResult> {
  const identifier = input.email.trim().toLowerCase();

  // รู้ tenant ตั้งแต่ต้นแล้ว (มาจาก env หรือโดเมนย่อย) จึงผูก scope ได้ตามปกติ
  const db = tenantScoped({ tenantId: input.tenantId, actorId: null });

  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MS);
  const failures = await db.loginAttempt.count({
    where: { identifier, succeeded: false, createdAt: { gte: since } },
  });
  if (failures >= LOCKOUT_MAX_FAILURES) {
    const oldest = await db.loginAttempt.findFirst({
      where: { identifier, succeeded: false, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    const unlockAt = (oldest?.createdAt.getTime() ?? now.getTime()) + LOCKOUT_WINDOW_MS;
    throw new TooManyAttemptsError(Math.max(0, unlockAt - now.getTime()));
  }

  const user = await db.user.findFirst({
    where: { email: identifier },
    select: { id: true, email: true, displayName: true, passwordHash: true, isActive: true, isSystem: true },
  });

  const record = async (succeeded: boolean, userId: bigint | null): Promise<void> => {
    await db.loginAttempt.create({
      data: {
        tenantId: input.tenantId,
        identifier,
        userId,
        succeeded,
        ipAddress: input.ipAddress ?? null,
      },
    });
  };

  // บัญชีระบบล็อกอินไม่ได้ — มันคือ actor ของ automation ไม่ใช่คน
  const usable =
    user !== null && user.isActive && !user.isSystem && user.passwordHash !== null;

  const ok = await verifyPassword(
    input.password,
    usable ? (user.passwordHash as string) : await getDecoyHash(),
  );

  if (!usable || !ok) {
    await record(false, user?.id ?? null);
    throw new LoginFailedError();
  }

  // รหัสผ่านที่แฮชด้วยพารามิเตอร์เก่า แข็งขึ้นได้ตอนล็อกอินสำเร็จเท่านั้น
  if (needsRehash(user.passwordHash as string)) {
    const upgraded = await hashPassword(input.password);
    await db.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
  }

  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS) as UtcDate;

  await db.session.create({
    data: {
      tenantId: input.tenantId,
      userId: user.id,
      tokenHash: hashToken(token),
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      ipAddress: input.ipAddress ?? null,
      expiresAt,
      lastSeenAt: now,
    },
  });

  await Promise.all([
    record(true, user.id),
    db.user.update({ where: { id: user.id }, data: { lastLoginAt: now } }),
  ]);

  return {
    token,
    expiresAt,
    user: { id: user.id, email: user.email, displayName: user.displayName },
  };
}

export interface ResolvedSession {
  ctx: TenantContext;
  user: { id: bigint; email: string; displayName: string };
  expiresAt: UtcDate;
}

/**
 * ตรวจโทเคนและคืนบริบทของผู้ใช้
 *
 * คืน `null` ทุกกรณีที่ใช้ไม่ได้ — หมดอายุ ถูกเพิกถอน ไม่มีจริง หรือบัญชีถูกปิด
 * ผู้เรียกไม่ควรรู้ว่าเป็นกรณีไหน และไม่ควรมีเส้นทางไหนโยน error ที่ต่างกัน
 */
export async function resolveSession(
  token: string,
  now: UtcDate = systemClock.nowUtc(),
): Promise<ResolvedSession | null> {
  if (token.trim() === '') return null;

  /**
   * ค้นข้าม tenant **โดยจำเป็น** — โทเคนคือสิ่งที่บอกว่าเป็น tenant ไหน
   *
   * ตอนตรวจโทเคนเรายังไม่รู้ tenant จึงผูก scope ก่อนค้นไม่ได้เลย
   * นี่คือกรณีที่ `withSystemScope()` มีไว้เพื่อ — ประกาศเจตนาให้เห็นชัด
   * แทนที่จะหยิบ client ดิบมาใช้เงียบ ๆ
   *
   * ปลอดภัยเพราะค้นด้วย `tokenHash` ซึ่งมี unique index และเป็นค่าสุ่ม 256 บิต
   * ผู้เรียกไม่มีทางเดาโทเคนของ tenant อื่น และ `ctx` ที่คืนออกไปผูกกับ
   * `tenantId` ของแถวนั้นเสมอ
   */
  const row = await withSystemScope(
    'ตรวจโทเคนเซสชัน — ยังไม่รู้ tenant จนกว่าจะหาแถวเจอ (ADR-003)',
    async (raw) =>
      raw.session.findFirst({
        where: { tokenHash: hashToken(token) },
        include: {
          user: {
            select: { id: true, email: true, displayName: true, isActive: true, isSystem: true },
          },
        },
      }),
  );
  if (row === null) return null;
  if (row.revokedAt !== null) return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null;
  if (!row.user.isActive || row.user.isSystem) return null;

  /**
   * อัปเดต `lastSeenAt` แบบหยาบ — ไม่เขียนทุกคำขอ
   *
   * เขียนทุกคำขอทำให้ตารางนี้กลายเป็นจุดที่ทุกคำขอต้อง UPDATE แถวเดียวกัน
   * ซึ่งเป็นคอขวดที่ไม่คุ้มกับความละเอียดระดับวินาทีที่ไม่มีใครต้องการ
   */
  if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
    const scoped = tenantScoped({ tenantId: row.tenantId, actorId: row.user.id });
    await scoped.session.update({ where: { id: row.id }, data: { lastSeenAt: now } });
  }

  return {
    ctx: { tenantId: row.tenantId, actorId: row.user.id },
    user: { id: row.user.id, email: row.user.email, displayName: row.user.displayName },
    expiresAt: row.expiresAt as UtcDate,
  };
}

/** ออกจากระบบเซสชันเดียว */
export async function revokeSession(
  token: string,
  now: UtcDate = systemClock.nowUtc(),
): Promise<void> {
  // updateMany ไม่โยนเมื่อไม่เจอ — การกดออกจากระบบซ้ำต้องไม่เป็น error
  await withSystemScope(
    'เพิกถอนเซสชันด้วยโทเคน — ยังไม่รู้ tenant จนกว่าจะหาแถวเจอ (ADR-003)',
    async (raw) =>
      raw.session.updateMany({
        where: { tokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: now },
      }),
  );
}

/** เพิกถอนทุกเซสชันของผู้ใช้ — ใช้ตอนเปลี่ยนรหัสผ่านหรือสงสัยว่าบัญชีถูกยึด */
export async function revokeAllSessions(
  userId: bigint,
  now: UtcDate = systemClock.nowUtc(),
): Promise<number> {
  // userId เป็น primary key ที่ผู้เรียกยืนยันตัวตนมาแล้ว จึงไม่ต้องรู้ tenant ล่วงหน้า
  const r = await withSystemScope(
    'เพิกถอนทุกเซสชันของผู้ใช้คนหนึ่ง — เรียกจาก endpoint ที่ยืนยันตัวตนแล้ว',
    async (raw) =>
      raw.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
  );
  return r.count;
}
