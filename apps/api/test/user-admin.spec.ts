/**
 * จัดการผู้ใช้ — เทสต์เป็นข้อกำหนด
 *
 * แตะฐานข้อมูลจริง · สร้างผู้ใช้และกลุ่มของตัวเองแล้วลบทิ้งใน `finally`
 * **ไม่แตะข้อมูล seed** (บทเรียนจากเทสต์สิทธิ์ที่ทำ agent1 หลุดกลุ่มค้างไว้)
 *
 * เคสที่สำคัญที่สุดคือ **เปลี่ยนรหัสผ่านแล้วเซสชันเดิมต้องใช้ไม่ได้**
 * ถ้าเซสชันเดิมยังใช้ได้ การเปลี่ยนรหัสผ่านเพราะสงสัยว่าถูกยึดบัญชี
 * ก็ไม่ได้ไล่ใครออกไปเลย
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { WeakPasswordError } from '../src/modules/identity/password';
import { login, resolveSession } from '../src/modules/identity/session.service';
import {
  CannotDeactivateSelfError,
  EmailInUseError,
  UserNotFoundError,
  WrongCurrentPasswordError,
  changeOwnPassword,
  createUser,
  listUsers,
  setActive,
  setGroups,
  setPassword,
} from '../src/modules/identity/user-admin.service';

const PW = 'รหัสผ่านทดสอบที่ยาวพอ';
const PREFIX = `admin-spec-${String(Date.now())}`;
let ctx: TenantContext;
let tenantId: bigint;
let groupId: bigint;
const madeUsers: bigint[] = [];

const email = (n: string): string => `${PREFIX}-${n}@example.test`;

async function make(n: string, password = PW): Promise<bigint> {
  const u = await createUser(ctx, { email: email(n), displayName: `ทดสอบ ${n}`, password });
  const id = BigInt(u.id);
  madeUsers.push(id);
  return id;
}

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirst({ where: { key: 'default' } });
  if (tenant === null) {
    throw new Error('ยังไม่มีข้อมูล seed — รัน `pnpm --filter @itsm/api seed` ก่อน');
  }
  tenantId = tenant.id;
  const actor = await prismaClient.user.findFirstOrThrow({
    where: { tenantId, isSystem: false },
    orderBy: { id: 'asc' },
  });
  ctx = { tenantId, actorId: actor.id };

  const g = await prismaClient.userGroup.create({
    data: { tenantId, name: `${PREFIX}-กลุ่มทดสอบ` },
    select: { id: true },
  });
  groupId = g.id;
});

afterAll(async () => {
  await prismaClient.session.deleteMany({ where: { userId: { in: madeUsers } } });
  await prismaClient.loginAttempt.deleteMany({ where: { identifier: { startsWith: PREFIX } } });
  await prismaClient.groupMember.deleteMany({ where: { userId: { in: madeUsers } } });
  await prismaClient.auditLog.deleteMany({
    where: { entityType: 'user', entityId: { in: madeUsers.map((u) => u.toString()) } },
  });
  await prismaClient.user.deleteMany({ where: { id: { in: madeUsers } } });
  await prismaClient.groupMember.deleteMany({ where: { groupId } });
  await prismaClient.userGroup.deleteMany({ where: { id: groupId } });
  await prismaClient.$disconnect();
});

describe('createUser', () => {
  it('ผู้ใช้ใหม่ล็อกอินได้ทันที', async () => {
    await make('login-now');
    const r = await login({ tenantId, email: email('login-now'), password: PW });
    expect(r.user.email).toBe(email('login-now'));
  });

  it('อีเมลถูกทำให้เป็นตัวพิมพ์เล็กและตัดช่องว่าง', async () => {
    const u = await createUser(ctx, {
      email: `  ${PREFIX}-UPPER@Example.Test  `,
      displayName: 'ตัวพิมพ์ใหญ่',
      password: PW,
    });
    madeUsers.push(BigInt(u.id));
    expect(u.email).toBe(`${PREFIX}-upper@example.test`);
  });

  it('อีเมลซ้ำถูกปฏิเสธ', async () => {
    await make('dup');
    await expect(
      createUser(ctx, { email: email('dup'), displayName: 'ซ้ำ', password: PW }),
    ).rejects.toThrow(EmailInUseError);
  });

  it('รหัสผ่านอ่อนถูกปฏิเสธ และ **ไม่สร้างบัญชีค้างไว้**', async () => {
    const before = await prismaClient.user.count({ where: { tenantId } });
    await expect(
      createUser(ctx, { email: email('weak'), displayName: 'อ่อน', password: '123' }),
    ).rejects.toThrow(WeakPasswordError);
    expect(await prismaClient.user.count({ where: { tenantId } })).toBe(before);
  });

  it('ไม่ส่งแฮชรหัสผ่านออกไป บอกแค่ว่าตั้งแล้วหรือยัง', async () => {
    const u = await createUser(ctx, {
      email: email('nohash'),
      displayName: 'ไม่มีแฮช',
      password: PW,
    });
    madeUsers.push(BigInt(u.id));
    expect(u.hasPassword).toBe(true);
    expect(JSON.stringify(u)).not.toContain('scrypt');
  });

  it('ไม่ระบุชื่อ ใช้อีเมลแทน — ไม่ใช่ชื่อว่าง', async () => {
    const u = await createUser(ctx, { email: email('noname'), displayName: '  ', password: PW });
    madeUsers.push(BigInt(u.id));
    expect(u.displayName).toBe(email('noname'));
  });

  it('ใส่กลุ่มให้ตั้งแต่สร้าง', async () => {
    const u = await createUser(ctx, {
      email: email('withgroup'),
      displayName: 'มีกลุ่ม',
      password: PW,
      groupIds: [groupId],
    });
    madeUsers.push(BigInt(u.id));
    expect(u.groups).toEqual([`${PREFIX}-กลุ่มทดสอบ`]);
  });
});

describe('setPassword · ผู้ดูแลตั้งให้', () => {
  it('**ตัดเซสชันของเจ้าของบัญชีทั้งหมด**', async () => {
    const id = await make('reset');
    const a = await login({ tenantId, email: email('reset'), password: PW });
    const b = await login({ tenantId, email: email('reset'), password: PW });
    expect(await resolveSession(a.token)).not.toBeNull();

    const r = await setPassword(ctx, id, 'รหัสผ่านใหม่ที่ยาวพอ');
    expect(r.revokedSessions).toBe(2);
    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).toBeNull();
  });

  it('รหัสผ่านเดิมใช้ไม่ได้ รหัสใหม่ใช้ได้', async () => {
    const id = await make('swap');
    await setPassword(ctx, id, 'รหัสผ่านใหม่ที่ยาวพอ');
    await expect(login({ tenantId, email: email('swap'), password: PW })).rejects.toThrow();
    await expect(
      login({ tenantId, email: email('swap'), password: 'รหัสผ่านใหม่ที่ยาวพอ' }),
    ).resolves.toBeTruthy();
  });

  it('รหัสผ่านอ่อนถูกปฏิเสธ และรหัสเดิมยังใช้ได้', async () => {
    const id = await make('keepold');
    await expect(setPassword(ctx, id, 'สั้น')).rejects.toThrow(WeakPasswordError);
    await expect(login({ tenantId, email: email('keepold'), password: PW })).resolves.toBeTruthy();
  });

  it('ผู้ใช้ที่ไม่มีอยู่ถูกปฏิเสธ', async () => {
    await expect(setPassword(ctx, 999_999_999n, PW)).rejects.toThrow(UserNotFoundError);
  });
});

describe('changeOwnPassword', () => {
  it('ต้องกรอกรหัสผ่านปัจจุบันให้ถูก', async () => {
    const id = await make('self');
    const selfCtx = { tenantId, actorId: id };
    await expect(changeOwnPassword(selfCtx, 'ผิดแน่นอนแต่ยาวพอ', 'ใหม่ที่ยาวพอสมควร')).rejects.toThrow(
      WrongCurrentPasswordError,
    );
    // รหัสเดิมต้องยังใช้ได้ หลังพยายามเปลี่ยนแล้วล้มเหลว
    await expect(login({ tenantId, email: email('self'), password: PW })).resolves.toBeTruthy();
  });

  it('กรอกถูกแล้วเปลี่ยนได้ และเซสชันเดิมถูกตัด', async () => {
    const id = await make('selfok');
    const selfCtx = { tenantId, actorId: id };
    const s = await login({ tenantId, email: email('selfok'), password: PW });
    await changeOwnPassword(selfCtx, PW, 'รหัสใหม่ของตัวเองที่ยาวพอ');
    expect(await resolveSession(s.token)).toBeNull();
    await expect(
      login({ tenantId, email: email('selfok'), password: 'รหัสใหม่ของตัวเองที่ยาวพอ' }),
    ).resolves.toBeTruthy();
  });

  it('รหัสใหม่ที่อ่อนถูกปฏิเสธ แม้รหัสปัจจุบันถูก', async () => {
    const id = await make('weaknew');
    await expect(changeOwnPassword({ tenantId, actorId: id }, PW, '123')).rejects.toThrow(
      WeakPasswordError,
    );
  });
});

describe('setActive', () => {
  it('**ปิดบัญชีแล้วเซสชันเดิมใช้ไม่ได้ทันที**', async () => {
    const id = await make('deact');
    const s = await login({ tenantId, email: email('deact'), password: PW });
    const r = await setActive(ctx, id, false);
    expect(r.revokedSessions).toBe(1);
    expect(await resolveSession(s.token)).toBeNull();
  });

  it('บัญชีที่ปิดแล้วล็อกอินไม่ได้ แม้รหัสผ่านถูก', async () => {
    const id = await make('deact2');
    await setActive(ctx, id, false);
    await expect(login({ tenantId, email: email('deact2'), password: PW })).rejects.toThrow();
  });

  it('เปิดกลับมาแล้วล็อกอินได้อีก', async () => {
    const id = await make('react');
    await setActive(ctx, id, false);
    await setActive(ctx, id, true);
    await expect(login({ tenantId, email: email('react'), password: PW })).resolves.toBeTruthy();
  });

  it('**ปิดบัญชีตัวเองไม่ได้** — ผู้ดูแลคนสุดท้ายจะล็อกตัวเองออกจากระบบ', async () => {
    const id = await make('selfdeact');
    await expect(setActive({ tenantId, actorId: id }, id, false)).rejects.toThrow(
      CannotDeactivateSelfError,
    );
  });
});

describe('setGroups', () => {
  it('แทนที่กลุ่มทั้งชุด ไม่ใช่เพิ่มทับ', async () => {
    const id = await make('grp');
    await setGroups(ctx, id, [groupId]);
    const after = await setGroups(ctx, id, []);
    expect(after.groups).toEqual([]);
  });
});

describe('listUsers', () => {
  it('ไม่แสดงบัญชีระบบ — มันไม่ใช่คน', async () => {
    const rows = await listUsers(ctx);
    const systemUsers = await prismaClient.user.findMany({
      where: { tenantId, isSystem: true },
      select: { email: true },
    });
    for (const sys of systemUsers) {
      expect(rows.some((r) => r.email === sys.email)).toBe(false);
    }
  });
});
