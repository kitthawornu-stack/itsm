/**
 * จัดการผู้ใช้ — เพิ่มคน ตั้งรหัสผ่าน ปิดบัญชี
 *
 * ก่อนมีไฟล์นี้ ระบบรับคนเข้าใช้จริงไม่ได้เลยแม้แต่คนเดียว: บัญชีทั้งหมดมาจาก
 * สคริปต์ seed และใช้รหัสผ่านชุดเดียวกัน
 *
 * กฎที่สำคัญที่สุดสามข้อ และเหตุผล:
 *
 *   1. **เปลี่ยนรหัสผ่าน = ตัดเซสชันอื่นทั้งหมด** — คนที่เปลี่ยนรหัสผ่าน
 *      มักทำเพราะสงสัยว่าบัญชีถูกยึด ถ้าเซสชันเดิมยังใช้ได้ การเปลี่ยนรหัสผ่าน
 *      ก็ไม่ได้ไล่ใครออกไปเลย
 *   2. **ปิดบัญชี = ตัดเซสชันทันที** ไม่ใช่รอหมดอายุ · `resolveSession`
 *      ตรวจ `isActive` อยู่แล้วเป็นด่านสอง แต่การตัดที่นี่ทำให้ตารางเซสชัน
 *      สะท้อนความจริง และตอบได้ว่าใครยังเข้าอยู่บ้าง
 *   3. **ปิดบัญชีตัวเองไม่ได้** — ผู้ดูแลคนสุดท้ายที่เผลอปิดตัวเอง
 *      ทำให้ไม่มีใครแก้อะไรได้อีกเลยโดยไม่แตะฐานข้อมูลตรง ๆ
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import {
  auditedTransaction,
  type AuditEntry,
} from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { hashPassword, verifyPassword } from './password';
import { revokeAllSessions } from './session.service';

export class UserNotFoundError extends Error {
  constructor(id: string) {
    super(`ไม่พบผู้ใช้ ${id}`);
    this.name = 'UserNotFoundError';
  }
}

export class EmailInUseError extends Error {
  constructor(email: string) {
    super(`อีเมล ${email} ถูกใช้ไปแล้ว`);
    this.name = 'EmailInUseError';
  }
}

export class CannotDeactivateSelfError extends Error {
  constructor() {
    super('ปิดบัญชีของตัวเองไม่ได้ — ให้ผู้ดูแลคนอื่นเป็นคนปิด');
    this.name = 'CannotDeactivateSelfError';
  }
}

export class WrongCurrentPasswordError extends Error {
  constructor() {
    super('รหัสผ่านปัจจุบันไม่ถูกต้อง');
    this.name = 'WrongCurrentPasswordError';
  }
}

export interface UserView {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  hasPassword: boolean;
  groups: string[];
  lastLoginAt: string | null;
}

function toView(row: {
  id: bigint;
  email: string;
  displayName: string;
  isActive: boolean;
  passwordHash: string | null;
  lastLoginAt: Date | null;
  groupMemberships: { group: { name: string } }[];
}): UserView {
  return {
    id: row.id.toString(),
    email: row.email,
    displayName: row.displayName,
    isActive: row.isActive,
    // ไม่ส่งแฮชออกไปแม้แต่บางส่วน — บอกแค่ว่าตั้งรหัสผ่านแล้วหรือยัง
    hasPassword: row.passwordHash !== null,
    groups: row.groupMemberships.map((m) => m.group.name),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

const USER_INCLUDE = {
  groupMemberships: { include: { group: { select: { name: true } } } },
} as const;

export async function listUsers(ctx: TenantContext): Promise<UserView[]> {
  const db = tenantScoped(ctx);
  const rows = await db.user.findMany({
    // บัญชีระบบไม่ใช่คน — ไม่แสดงในหน้าจัดการผู้ใช้
    where: { isSystem: false },
    orderBy: { email: 'asc' },
    include: USER_INCLUDE,
  });
  return rows.map(toView);
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  password: string;
  groupIds?: bigint[];
}

export async function createUser(ctx: TenantContext, input: CreateUserInput): Promise<UserView> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();

  const db = tenantScoped(ctx);
  const existing = await db.user.findFirst({ where: { email }, select: { id: true } });
  if (existing !== null) throw new EmailInUseError(email);

  // แฮชก่อนเปิดทรานแซกชัน — scrypt ใช้เวลาราวหนึ่งวินาที
  // การถือทรานแซกชันไว้ตลอดเวลานั้นล็อกแถวโดยไม่จำเป็น
  const passwordHash = await hashPassword(input.password);

  const created = await auditedTransaction(ctx, 'identity.user.create', async (tx) => {
    const row = await tx.user.create({
      data: {
        tenantId: ctx.tenantId,
        email,
        displayName: displayName === '' ? email : displayName,
        passwordHash,
      },
      select: { id: true },
    });
    if (input.groupIds !== undefined && input.groupIds.length > 0) {
      await tx.groupMember.createMany({
        data: input.groupIds.map((groupId) => ({ tenantId: ctx.tenantId, groupId, userId: row.id })),
        skipDuplicates: true,
      });
    }
    const audit: AuditEntry[] = [
      {
        kind: 'system',
        action: 'identity.user.create',
        entityType: 'user',
        entityId: row.id.toString(),
        payload: { email },
      },
    ];
    return { result: row.id, audit };
  });

  const row = await db.user.findFirstOrThrow({ where: { id: created }, include: USER_INCLUDE });
  return toView(row);
}

/**
 * ผู้ดูแลตั้งรหัสผ่านใหม่ให้คนอื่น
 *
 * ตัดเซสชันของเจ้าของบัญชีทั้งหมด — ถ้าตั้งใหม่เพราะสงสัยว่าถูกยึด
 * การปล่อยให้เซสชันเดิมใช้ต่อได้เท่ากับไม่ได้แก้อะไร
 */
export async function setPassword(
  ctx: TenantContext,
  userId: bigint,
  newPassword: string,
  now: UtcDate = systemClock.nowUtc(),
): Promise<{ revokedSessions: number }> {
  const db = tenantScoped(ctx);
  const user = await db.user.findFirst({ where: { id: userId }, select: { id: true } });
  if (user === null) throw new UserNotFoundError(userId.toString());

  const passwordHash = await hashPassword(newPassword);

  await auditedTransaction(ctx, 'identity.user.set-password', async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'identity.user.set-password',
          entityType: 'user',
          entityId: userId.toString(),
        },
      ],
    };
  });

  return { revokedSessions: await revokeAllSessions(userId, now) };
}

/**
 * ผู้ใช้เปลี่ยนรหัสผ่านของตัวเอง
 *
 * ต้องกรอกรหัสผ่านปัจจุบัน — ไม่งั้นใครที่เจอเครื่องเปิดค้างไว้
 * ยึดบัญชีถาวรได้ด้วยการเปลี่ยนรหัสผ่านทับ
 */
export async function changeOwnPassword(
  ctx: TenantContext,
  currentPassword: string,
  newPassword: string,
  now: UtcDate = systemClock.nowUtc(),
): Promise<{ revokedSessions: number }> {
  if (ctx.actorId === null) throw new UserNotFoundError('ไม่ทราบ');
  const userId = ctx.actorId;

  const db = tenantScoped(ctx);
  const user = await db.user.findFirst({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (user?.passwordHash == null) throw new WrongCurrentPasswordError();
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new WrongCurrentPasswordError();
  }

  const passwordHash = await hashPassword(newPassword);
  await auditedTransaction(ctx, 'identity.user.change-password', async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'identity.user.change-password',
          entityType: 'user',
          entityId: userId.toString(),
        },
      ],
    };
  });

  return { revokedSessions: await revokeAllSessions(userId, now) };
}

export async function setActive(
  ctx: TenantContext,
  userId: bigint,
  isActive: boolean,
  now: UtcDate = systemClock.nowUtc(),
): Promise<{ revokedSessions: number }> {
  if (!isActive && ctx.actorId === userId) throw new CannotDeactivateSelfError();

  const db = tenantScoped(ctx);
  const user = await db.user.findFirst({ where: { id: userId }, select: { id: true } });
  if (user === null) throw new UserNotFoundError(userId.toString());

  await auditedTransaction(ctx, 'identity.user.set-active', async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: isActive ? 'identity.user.activate' : 'identity.user.deactivate',
          entityType: 'user',
          entityId: userId.toString(),
        },
      ],
    };
  });

  // ปิดบัญชีแล้วต้องออกจากระบบทันที ไม่ใช่รอเซสชันหมดอายุ
  return { revokedSessions: isActive ? 0 : await revokeAllSessions(userId, now) };
}

export async function setGroups(
  ctx: TenantContext,
  userId: bigint,
  groupIds: bigint[],
): Promise<UserView> {
  const db = tenantScoped(ctx);
  const user = await db.user.findFirst({ where: { id: userId }, select: { id: true } });
  if (user === null) throw new UserNotFoundError(userId.toString());

  await auditedTransaction(ctx, 'identity.user.set-groups', async (tx) => {
    await tx.groupMember.deleteMany({ where: { userId } });
    if (groupIds.length > 0) {
      await tx.groupMember.createMany({
        data: groupIds.map((groupId) => ({ tenantId: ctx.tenantId, groupId, userId })),
        skipDuplicates: true,
      });
    }
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'identity.user.set-groups',
          entityType: 'user',
          entityId: userId.toString(),
          payload: { groupIds: groupIds.map((g) => g.toString()) },
        },
      ],
    };
  });

  return toView(await db.user.findFirstOrThrow({ where: { id: userId }, include: USER_INCLUDE }));
}

export async function listGroups(
  ctx: TenantContext,
): Promise<Array<{ id: string; name: string; memberCount: number }>> {
  const db = tenantScoped(ctx);
  const rows = await db.userGroup.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { members: true } } },
  });
  return rows.map((g) => ({
    id: g.id.toString(),
    name: g.name,
    memberCount: g._count.members,
  }));
}
