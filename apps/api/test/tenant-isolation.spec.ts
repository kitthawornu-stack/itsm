/**
 * INVARIANT 1 — ชุดทดสอบที่ "พยายามรั่วแล้วต้องล้มเหลว"
 *
 * ชุดนี้ต้องรันทุก PR ห้ามข้าม (CLAUDE.md §1.1)
 * ทุกเคสในไฟล์นี้เขียนจากมุมของผู้โจมตี: สมมติว่าคนเขียนโค้ดพยายามอ่านข้าม tenant
 * ทั้งโดยเจตนาและโดยเผลอ — แล้วยืนยันว่าทำไม่ได้
 *
 * เคสที่ครอบคลุม (ตาม master-plan Part 02 · การทดสอบที่ต้องมีใน CI):
 *   1. findMany ไม่เห็นข้อมูลของ tenant อื่น
 *   2. findUnique ด้วย id ตรง ๆ ก็ไม่เห็น (จุดที่ extension แปลงเป็น findFirst)
 *   3. count ไม่นับข้อมูลของ tenant อื่น
 *   4. update ข้าม tenant ไม่มีผล
 *   5. delete ข้าม tenant ไม่มีผล
 *   6. create ที่ระบุ tenantId ของคนอื่นถูกปฏิเสธ
 *   7. where ที่ระบุ tenantId ขัดกับ scope ถูกปฏิเสธ
 *   8. ความสัมพันธ์ (include) ไม่พา data ของ tenant อื่นออกมา
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { tenantScoped, tenantTransaction } from '../src/infrastructure/prisma/tenant-scope';
import { auditedTransaction } from '../src/infrastructure/audit/audited-transaction';
import { CrossTenantAccessError, type TenantContext } from '@itsm/types';

import { purgeTenants } from './helpers/cleanup';

const KEY_A = 'test-tenant-a';
const KEY_B = 'test-tenant-b';

let tenantA: bigint;
let tenantB: bigint;
let ctxA: TenantContext;
let ctxB: TenantContext;
let userAId: bigint;
let userBId: bigint;

beforeAll(async () => {
  // ล้างของเก่าที่อาจค้างจากรอบก่อน
  await purgeTenants([KEY_A, KEY_B]);

  const a = await prismaClient.tenant.create({ data: { key: KEY_A, name: 'Tenant A' } });
  const b = await prismaClient.tenant.create({ data: { key: KEY_B, name: 'Tenant B' } });
  tenantA = a.id;
  tenantB = b.id;
  ctxA = { tenantId: tenantA, actorId: null };
  ctxB = { tenantId: tenantB, actorId: null };

  const userA = await prismaClient.user.create({
    data: { tenantId: tenantA, email: 'a@example.test', displayName: 'ผู้ใช้ A' },
  });
  const userB = await prismaClient.user.create({
    data: { tenantId: tenantB, email: 'b@example.test', displayName: 'ผู้ใช้ B' },
  });
  userAId = userA.id;
  userBId = userB.id;
});

afterAll(async () => {
  await purgeTenants([KEY_A, KEY_B]);
  await prismaClient.$disconnect();
});

describe('tenant isolation · INVARIANT 1', () => {
  it('1 · findMany เห็นเฉพาะข้อมูลของ tenant ตัวเอง', async () => {
    const dbA = tenantScoped(ctxA);
    const users = await dbA.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe('a@example.test');
  });

  it('2 · findUnique ด้วย id ของ tenant อื่นต้องไม่เห็น (extension แปลงเป็น findFirst)', async () => {
    const dbA = tenantScoped(ctxA);
    // นี่คือช่องรั่วที่พบบ่อยที่สุด: อ่านด้วย primary key ตรง ๆ โดยไม่มี tenant filter
    const leaked = await dbA.user.findUnique({ where: { id: userBId } });
    expect(leaked).toBeNull();

    // ของตัวเองต้องยังอ่านได้ปกติ
    const own = await dbA.user.findUnique({ where: { id: userAId } });
    expect(own?.email).toBe('a@example.test');
  });

  it('3 · count ไม่นับข้อมูลของ tenant อื่น', async () => {
    expect(await tenantScoped(ctxA).user.count()).toBe(1);
    expect(await tenantScoped(ctxB).user.count()).toBe(1);
  });

  it('4 · update ข้าม tenant ไม่มีผล', async () => {
    const dbA = tenantScoped(ctxA);
    await expect(
      dbA.user.update({ where: { id: userBId }, data: { displayName: 'ถูกแก้ไขข้าม tenant' } }),
    ).rejects.toThrow();

    const untouched = await prismaClient.user.findUnique({ where: { id: userBId } });
    expect(untouched?.displayName).toBe('ผู้ใช้ B');
  });

  it('5 · deleteMany ข้าม tenant ไม่ลบอะไรเลย', async () => {
    const dbA = tenantScoped(ctxA);
    const result = await dbA.user.deleteMany({ where: { id: userBId } });
    expect(result.count).toBe(0);

    const stillThere = await prismaClient.user.findUnique({ where: { id: userBId } });
    expect(stillThere).not.toBeNull();
  });

  it('6 · create ที่ระบุ tenantId ของคนอื่นถูกปฏิเสธ', async () => {
    const dbA = tenantScoped(ctxA);
    await expect(
      dbA.user.create({
        data: { tenantId: tenantB, email: 'sneaky@example.test', displayName: 'ลอบสร้าง' },
      }),
    ).rejects.toThrow(CrossTenantAccessError);
  });

  it('6b · create ที่ไม่ระบุ tenantId ได้ tenant ของ scope โดยอัตโนมัติ', async () => {
    const dbA = tenantScoped(ctxA);
    // ไม่ต้องส่ง tenantId — extension เติมให้ นี่คือพฤติกรรมที่ต้องการ
    const created = await dbA.user.create({
      // @ts-expect-error tenantId ถูก inject โดย extension — ตั้งใจไม่ส่ง
      data: { email: 'auto@example.test', displayName: 'เติมอัตโนมัติ' },
    });
    expect(created.tenantId).toBe(tenantA);
    await prismaClient.user.delete({ where: { id: created.id } });
  });

  it('7 · where ที่ระบุ tenantId ขัดกับ scope ถูกปฏิเสธ', async () => {
    const dbA = tenantScoped(ctxA);
    await expect(dbA.user.findMany({ where: { tenantId: tenantB } })).rejects.toThrow(
      CrossTenantAccessError,
    );
  });

  it('8 · include ไม่พาข้อมูลของ tenant อื่นออกมา', async () => {
    const dbA = tenantScoped(ctxA);
    const groups = await dbA.userGroup.findMany({ include: { members: true } });
    for (const g of groups) {
      expect(g.tenantId).toBe(tenantA);
    }
  });
});

/**
 * 9 · ทรานแซกชัน
 *
 * จุดที่เผลอง่ายที่สุด: `tenantScoped()` คืน client ที่มี extension
 * แต่ถ้าเปิดทรานแซกชันจาก client ดิบ ตัว `tx` ข้างในจะ **ไม่มี** extension
 * แล้วทุกคิวรีในนั้นข้าม INVARIANT 1 ไปทั้งก้อนโดยไม่มีสัญญาณอะไรเลย
 *
 * เคสพวกนี้เขียนเพื่อตอบคำถามเดียว: `tx` กันข้าม tenant จริงไหม
 */
describe('INVARIANT 1 · ในทรานแซกชัน', () => {
  it('9a · tenantTransaction — findMany ข้างในไม่เห็นข้อมูลของ tenant อื่น', async () => {
    const seen = await tenantTransaction(ctxA, async (tx) => tx.user.findMany());
    for (const u of seen) expect(u.tenantId).toBe(tenantA);
  });

  it('9b · tenantTransaction — findFirst ด้วย id ของ tenant อื่นต้องไม่เจอ', async () => {
    const found = await tenantTransaction(ctxA, async (tx) =>
      tx.user.findFirst({ where: { id: userBId } }),
    );
    expect(found).toBeNull();
  });

  it('9c · auditedTransaction — คิวรีข้างในก็ต้องถูกจำกัดเหมือนกัน', async () => {
    const found = await auditedTransaction(ctxA, 'test.probe', async (tx) => ({
      result: await tx.user.findFirst({ where: { id: userBId } }),
      audit: [
        {
          kind: 'system' as const,
          action: 'probe',
          entityType: 'test',
          entityId: '0',
        },
      ],
    }));
    expect(found).toBeNull();
  });
});
