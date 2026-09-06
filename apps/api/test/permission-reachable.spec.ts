/**
 * สิทธิ์ที่บังคับใช้แล้ว ต้องมีคนถืออยู่จริง
 *
 * มีบทเรียนอยู่แล้วว่า **สิทธิ์ที่ให้แล้วไม่มีผล อันตรายกว่าสิทธิ์ที่ยังไม่ได้ให้**
 * — `permission-coverage.spec.ts` กันด้านนั้นด้วยการสแกนซอร์ส · ไฟล์นี้กัน
 * **ด้านกลับ**: คีย์ที่มีโค้ดตรวจจริง แต่ไม่มีกลุ่มไหนถืออยู่เลย
 *
 * ผลของด้านกลับคือฟีเจอร์ที่กดไม่ได้ทั้งระบบ โดยหน้าตั้งค่ายังแสดงชื่อคีย์นั้นไว้
 * · เจอจริงตอนจะ QA การเก็บรุ่นเข้าคลัง: `MANAGE_PROJECT` นับได้ 0 แถว
 * จึงไม่มีผู้ใช้คนไหนกดปุ่มได้เลย — และตัวเลขนั้นเกิดจาก **ฐานข้อมูลพัฒนา
 * เก่ากว่า `seed.ts`** ไม่ใช่จากโค้ดผิด ซึ่งเป็นความต่างที่ไม่มีอะไรจับได้มาก่อน
 *
 * ถ้าแดง: รัน `pnpm --filter @itsm/api seed` ใหม่ หรือเติม grant ที่ขาด
 */
import { afterAll, describe, expect, it } from 'vitest';
import { ALL_PERMISSION_KEYS } from '@itsm/types';

import { prismaClient as prisma } from '../src/infrastructure/prisma/client';
import { UNENFORCED_PERMISSIONS } from '../src/modules/permission';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('สิทธิ์ที่บังคับใช้แล้วต้องมีคนถือ', () => {
  it('probe · อ่านรายการคีย์และรายการยกเว้นได้จริง', () => {
    // เซ็ตว่างเท่ากับเซ็ตว่าง — ถ้าไม่ยืนยัน ตัวตรวจที่พังจะเขียวสนิท
    expect(ALL_PERMISSION_KEYS.length).toBeGreaterThan(10);
    expect(ALL_PERMISSION_KEYS).toContain('MANAGE_PROJECT');
    expect(UNENFORCED_PERMISSIONS.length).toBeLessThan(ALL_PERMISSION_KEYS.length);
  });

  it('**ทุกคีย์ที่บังคับใช้แล้ว มีอย่างน้อยหนึ่งกลุ่มถืออยู่**', async () => {
    const rows = await prisma.permissionGrant.groupBy({
      by: ['permission'],
      where: { groupId: { not: null } },
      _count: { _all: true },
    });
    const held = new Set(rows.map((r) => r.permission as string));
    const enforced = ALL_PERMISSION_KEYS.filter(
      (k) => !(UNENFORCED_PERMISSIONS as readonly string[]).includes(k),
    );
    expect(enforced.filter((k) => !held.has(k)).sort()).toEqual([]);
  });

  /**
   * คีย์ที่ยังไม่บังคับใช้ **ไม่ควรถูกให้ใคร** — ผู้ดูแลจะอ่านหน้าตั้งค่า
   * แล้วเชื่อว่าตั้งค่าเรียบร้อยแล้ว ทั้งที่ไม่มีโค้ดไหนถามถึงมันเลย
   */
  it('คีย์ที่ยังไม่บังคับใช้ ต้องไม่มีใครถือ', async () => {
    if (UNENFORCED_PERMISSIONS.length === 0) return;
    const rows = await prisma.permissionGrant.findMany({
      where: { permission: { in: UNENFORCED_PERMISSIONS as never } },
      select: { permission: true },
    });
    expect([...new Set(rows.map((r) => r.permission as string))].sort()).toEqual([]);
  });
});
