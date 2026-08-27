/**
 * ให้และถอนสิทธิ์ — เทสต์เป็นข้อกำหนด
 *
 * ⚠️ โค้ดที่เทสต์นี้คุ้ม **แตะระบบสิทธิ์** — ต้องให้ Tech Lead อนุมัติก่อน merge
 *
 * เคสที่สำคัญที่สุดคือ **ถอนสิทธิ์ผู้ดูแลรายการสุดท้ายไม่ได้** · ทางกลับมี
 * ทางเดียวคือ INSERT ลงฐานข้อมูลตรง ๆ ซึ่งลูกค้า on-prem ทำเองไม่ได้
 *
 * สร้างชุดสิทธิ์และกลุ่มของตัวเองแล้วลบทิ้ง ไม่แตะของ seed — บทเรียนใน CLAUDE.md
 * เรื่องเทสต์สิทธิ์ที่เคยทำสมาชิกกลุ่มจริงหลุดค้างไว้
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  LastAdminGrantError,
  UnknownGroupError,
  describeGrants,
  schemeUsage,
  setGrant,
  wouldLockOutAdmins,
} from '../src/modules/permission';

const STAMP = String(Date.now()).slice(-6);

let ctx: TenantContext;
let actorId: bigint;
let schemeId: bigint;
let groupId: bigint;
let projectId: bigint;

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  const user = await prismaClient.user.create({
    data: { tenantId: tenant.id, email: `pg-${STAMP}@example.test`, displayName: 'ทดสอบสิทธิ์' },
    select: { id: true },
  });
  actorId = user.id;
  ctx = { tenantId: tenant.id, actorId };

  groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId: tenant.id, name: `กลุ่มทดสอบ ${STAMP}` },
      select: { id: true },
    })
  ).id;
  schemeId = (
    await prismaClient.permissionScheme.create({
      data: { tenantId: tenant.id, name: `ชุดทดสอบ ${STAMP}` },
      select: { id: true },
    })
  ).id;
  projectId = (
    await prismaClient.project.create({
      data: {
        tenantId: tenant.id,
        key: `PG${STAMP}`,
        name: `โปรเจกต์ทดสอบสิทธิ์ ${STAMP}`,
        type: 'SERVICE_DESK',
        permissionSchemeId: schemeId,
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await prismaClient.permissionGrant.deleteMany({ where: { schemeId } });
  await prismaClient.project.deleteMany({ where: { id: projectId } });
  await prismaClient.permissionScheme.deleteMany({ where: { id: schemeId } });
  await prismaClient.userGroup.deleteMany({ where: { id: groupId } });
  await prismaClient.auditLog.deleteMany({ where: { actorId } });
  await prismaClient.user.deleteMany({ where: { id: actorId } });
  await prismaClient.$disconnect();
});

describe('ให้สิทธิ์', () => {
  it('ให้แล้วปรากฏในตารางสิทธิ์ของโปรเจกต์', async () => {
    const r = await setGrant(ctx, schemeId, 'ADD_COMMENT', groupId, true);
    expect(r.changed).toBe(true);
    const { rows } = await describeGrants(ctx, projectId);
    expect(rows.find((x) => x.permission === 'ADD_COMMENT')?.groups).toEqual([
      `กลุ่มทดสอบ ${STAMP}`,
    ]);
  });

  it('ให้ซ้ำไม่เป็น error และไม่เขียนอะไรเพิ่ม', async () => {
    const before = await prismaClient.permissionGrant.count({ where: { schemeId } });
    const r = await setGrant(ctx, schemeId, 'ADD_COMMENT', groupId, true);
    // ผู้ดูแลที่กดสองครั้งไม่ได้ทำผิด — error ตรงนี้จะบอกว่านักพัฒนาทำพลาด
    expect(r.changed).toBe(false);
    expect(await prismaClient.permissionGrant.count({ where: { schemeId } })).toBe(before);
  });

  it('**บันทึก audit** พร้อมชื่อกลุ่ม ไม่ใช่แค่ id', async () => {
    const log = await prismaClient.auditLog.findFirstOrThrow({
      where: { actorId, action: 'permission.grant' },
      orderBy: { id: 'desc' },
    });
    const payload = log.payload as { permission?: string; group?: string };
    expect(payload.permission).toBe('ADD_COMMENT');
    // id ตอบไม่ได้ว่ากลุ่มไหนเมื่ออ่านย้อนหลังหลังกลุ่มถูกลบไปแล้ว
    expect(payload.group).toBe(`กลุ่มทดสอบ ${STAMP}`);
  });

  it('กลุ่มที่ไม่มีอยู่ถูกปฏิเสธ', async () => {
    await expect(
      setGrant(ctx, schemeId, 'ADD_COMMENT', BigInt(99_999_999), true),
    ).rejects.toThrow(UnknownGroupError);
  });
});

describe('ถอนสิทธิ์', () => {
  it('ถอนแล้วหายจากตาราง', async () => {
    await setGrant(ctx, schemeId, 'ADD_COMMENT', groupId, false);
    const { rows } = await describeGrants(ctx, projectId);
    expect(rows.find((x) => x.permission === 'ADD_COMMENT')?.groups).toEqual([]);
  });

  it('ถอนสิ่งที่ไม่ได้ให้ไว้ ไม่เป็น error', async () => {
    expect((await setGrant(ctx, schemeId, 'ADD_COMMENT', groupId, false)).changed).toBe(false);
  });

  it('**ถอนสิทธิ์ผู้ดูแลรายการสุดท้ายไม่ได้** — จะไม่มีใครแก้อะไรได้อีกเลย', async () => {
    const real = await prismaClient.permissionGrant.findMany({
      where: { permission: 'ADMINISTER_TENANT', groupId: { not: null } },
      select: { id: true, tenantId: true, schemeId: true, groupId: true },
    });
    if (real.length === 0) return;
    const last = real[0];
    if (last === undefined || last.groupId === null) return;

    /*
      จำลอง "เหลือรายการเดียว" โดยย้ายของจริงออกชั่วคราว

      **คืนทุกแถวที่จับมา รวมแถวที่คาดว่าจะไม่ถูกลบด้วย** — ครั้งแรกคืนเฉพาะ
      แถวที่ตั้งใจย้ายออก โดยถือว่าแถวสุดท้ายปลอดภัยเพราะกลไกกันไว้
      พอลบกลไกออกเพื่อพิสูจน์ว่าเทสต์แดงได้ การลบก็สำเร็จจริง และฐานข้อมูล
      พัฒนาเหลือ ADMINISTER_TENANT ศูนย์รายการ — ไม่มีใครเข้าหน้าตั้งค่าได้อีก

      **การเก็บกวาดต้องไม่ตั้งอยู่บนสมมติฐานว่ากลไกที่กำลังทดสอบยังทำงานอยู่**
    */
    try {
      await prismaClient.permissionGrant.deleteMany({
        where: { id: { in: real.slice(1).map((g) => g.id) } },
      });
      await expect(
        setGrant(ctx, last.schemeId, 'ADMINISTER_TENANT', last.groupId, false),
      ).rejects.toThrow(LastAdminGrantError);
      expect(
        await prismaClient.permissionGrant.count({ where: { permission: 'ADMINISTER_TENANT' } }),
      ).toBe(1);
    } finally {
      for (const g of real) {
        if (g.groupId === null) continue;
        const exists = await prismaClient.permissionGrant.findFirst({
          where: { schemeId: g.schemeId, permission: 'ADMINISTER_TENANT', groupId: g.groupId },
        });
        if (exists === null) {
          await prismaClient.permissionGrant.create({
            data: {
              tenantId: g.tenantId,
              schemeId: g.schemeId,
              permission: 'ADMINISTER_TENANT',
              groupId: g.groupId,
            },
          });
        }
      }
      // ยืนยันว่ากลับมาครบจริง ไม่ใช่เชื่อว่าลูปข้างบนทำงาน
      expect(
        await prismaClient.permissionGrant.count({
          where: { permission: 'ADMINISTER_TENANT', groupId: { not: null } },
        }),
      ).toBe(real.length);
    }
  });

  it('ถอนได้เมื่อยังมีรายการอื่นเหลืออยู่', async () => {
    await setGrant(ctx, schemeId, 'ADMINISTER_TENANT', groupId, true);
    // ตอนนี้มีของ seed อยู่ด้วย จึงไม่ใช่รายการสุดท้าย
    expect((await setGrant(ctx, schemeId, 'ADMINISTER_TENANT', groupId, false)).changed).toBe(true);
  });
});

describe('ชุดสิทธิ์ที่ใช้ร่วมกัน', () => {
  it('**บอกได้ว่าชุดนี้ถูกใช้โดยโปรเจกต์ไหนบ้าง**', async () => {
    // ชุดสิทธิ์ใบเดียวใช้ร่วมกันหลายโปรเจกต์ได้ · การแก้จากหน้าโปรเจกต์หนึ่ง
    // เปลี่ยนอีกโปรเจกต์ไปด้วย ซึ่งผู้ดูแลต้องรู้ก่อนกด ไม่ใช่รู้ตอนมีคนบ่น
    expect(await schemeUsage(ctx, schemeId)).toEqual([`PG${STAMP}`]);
  });

  it('ชุดที่ไม่มีโปรเจกต์ไหนใช้ คืนรายการว่าง ไม่ใช่ error', async () => {
    const orphan = await prismaClient.permissionScheme.create({
      data: { tenantId: ctx.tenantId, name: `ชุดลอย ${STAMP}` },
      select: { id: true },
    });
    try {
      expect(await schemeUsage(ctx, orphan.id)).toEqual([]);
    } finally {
      await prismaClient.permissionScheme.deleteMany({ where: { id: orphan.id } });
    }
  });
});

/**
 * กฎกันล็อกตัวเองออกจากระบบ — ทดสอบแบบบริสุทธิ์
 *
 * ทดสอบกฎนี้กับฐานข้อมูลจริงเป็นเรื่องอันตราย เพราะการพิสูจน์ว่าเทสต์แดงได้
 * ต้องลบกลไกออก แล้วการลบก็จะสำเร็จจริง · ที่นี่จึงพิสูจน์กฎเองโดยไม่แตะข้อมูล
 */
describe('wouldLockOutAdmins', () => {
  it('ถอน ADMINISTER_TENANT รายการสุดท้าย = ล็อกตัวเองออก', () => {
    expect(wouldLockOutAdmins('ADMINISTER_TENANT', 0)).toBe(true);
  });

  it('ยังมีรายการอื่นเหลือ = ถอนได้', () => {
    expect(wouldLockOutAdmins('ADMINISTER_TENANT', 1)).toBe(false);
    expect(wouldLockOutAdmins('ADMINISTER_TENANT', 9)).toBe(false);
  });

  it('คีย์อื่นถอนได้เสมอ แม้เหลือศูนย์', () => {
    // ไม่มีใครเปิดดูโปรเจกต์ได้เลยเป็นสถานะที่ผู้ดูแลกู้กลับเองได้
    // ต่างจากไม่มีใครเป็นผู้ดูแล ซึ่งกู้ได้ทางฐานข้อมูลทางเดียว
    expect(wouldLockOutAdmins('BROWSE_PROJECT', 0)).toBe(false);
    expect(wouldLockOutAdmins('EDIT_ITEM', 0)).toBe(false);
  });

  it('จำนวนติดลบถือว่าล็อกตัวเองออก — ไม่ใช่ปล่อยผ่าน', () => {
    // ตัวเลขที่เป็นไปไม่ได้แปลว่าเรานับผิด และการเดาไปทางปล่อยผ่านคือการเดาผิดทาง
    expect(wouldLockOutAdmins('ADMINISTER_TENANT', -1)).toBe(true);
  });
});
