/**
 * ตัวกรองที่บันทึกไว้ — เทสต์เป็นข้อกำหนด
 *
 * เคสที่สำคัญที่สุดสองข้อ:
 *
 *   1. **ตัวกรองที่แชร์ ทำงานด้วยขอบเขตของคนที่กด ไม่ใช่ของเจ้าของ**
 *      ถ้าไม่ใช่ การแชร์ตัวกรองจะกลายเป็นการแชร์สิทธิ์ของเจ้าของ
 *      ซึ่งเป็นช่องโหว่ที่ไม่มีอะไรบนหน้าจอบอก
 *
 *   2. **คิวรีต้องแปลได้ก่อนบันทึก** — ตัวกรองที่บันทึกไว้ทั้งที่พัง
 *      คือกับดักที่รอคนกดในวันข้างหน้า และคนที่กดไม่ใช่คนที่พิมพ์ผิด
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  DuplicateFilterNameError,
  FilterNameRequiredError,
  FilterNotFoundError,
  InvalidFilterQueryError,
  NotFilterOwnerError,
  createSavedFilter,
  deleteSavedFilter,
  listSavedFilters,
  reindexAll,
  searchByHql,
  updateSavedFilter,
} from '../src/modules/search-index';

const STAMP = String(Date.now()).slice(-6);

let owner: TenantContext;
let other: TenantContext;
let ownerId: bigint;
let otherId: bigint;
let sdId: bigint;
let platId: bigint;
let filterId: bigint;

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  const mk = async (n: string): Promise<bigint> =>
    (
      await prismaClient.user.create({
        data: { tenantId: tenant.id, email: `sf-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
        select: { id: true },
      })
    ).id;
  ownerId = await mk('เจ้าของ');
  otherId = await mk('คนอื่น');
  owner = { tenantId: tenant.id, actorId: ownerId };
  other = { tenantId: tenant.id, actorId: otherId };

  sdId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } })).id;
  platId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'PLAT' } })).id;
  await reindexAll(owner, { batchSize: 2_000 });
}, 300_000);

afterAll(async () => {
  await prismaClient.savedFilter.deleteMany({ where: { ownerId: { in: [ownerId, otherId] } } });
  await prismaClient.auditLog.deleteMany({ where: { actorId: { in: [ownerId, otherId] } } });
  await prismaClient.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prismaClient.$disconnect();
});

describe('บันทึกตัวกรอง', () => {
  it('บันทึกแล้วอ่านกลับได้', async () => {
    const f = await createSavedFilter(owner, `งานที่ยังไม่จบ ${STAMP}`, 'status IS NOT EMPTY', false);
    filterId = f.id;
    const mine = await listSavedFilters(owner);
    const row = mine.find((r) => r.id === filterId.toString());
    expect(row?.hql).toBe('status IS NOT EMPTY');
    expect(row?.isMine).toBe(true);
  });

  it('**คิวรีที่แปลไม่ได้บันทึกไม่ได้** — กับดักที่รอคนอื่นมากด', async () => {
    await expect(
      createSavedFilter(owner, `พัง ${STAMP}`, 'สถานะ = Open', false),
    ).rejects.toThrow(InvalidFilterQueryError);
    await expect(
      createSavedFilter(owner, `พังอีก ${STAMP}`, '(status = A', false),
    ).rejects.toThrow(InvalidFilterQueryError);
  });

  it('ล้มแล้วต้องไม่เหลือแถวค้าง', async () => {
    expect(
      await prismaClient.savedFilter.count({ where: { name: { contains: `พัง ${STAMP}` } } }),
    ).toBe(0);
  });

  it('ชื่อว่างและชื่อซ้ำถูกปฏิเสธ', async () => {
    await expect(createSavedFilter(owner, '   ', 'status IS NOT EMPTY', false)).rejects.toThrow(
      FilterNameRequiredError,
    );
    await expect(
      createSavedFilter(owner, `งานที่ยังไม่จบ ${STAMP}`, 'status IS NOT EMPTY', false),
    ).rejects.toThrow(DuplicateFilterNameError);
  });

  it('ชื่อซ้ำกันได้ถ้าคนละเจ้าของ — ตัวกรองเป็นของแต่ละคน', async () => {
    const f = await createSavedFilter(other, `งานที่ยังไม่จบ ${STAMP}`, 'status IS NOT EMPTY', false);
    expect(f.id).toBeDefined();
  });

  it('**แก้จนพังก็บันทึกไม่ได้** — ตัวกรองที่เคยใช้ได้แล้วพังหลอกกว่า', async () => {
    await expect(updateSavedFilter(owner, filterId, { hql: 'ฟิลด์มั่ว = 1' })).rejects.toThrow(
      InvalidFilterQueryError,
    );
    const still = await listSavedFilters(owner);
    expect(still.find((r) => r.id === filterId.toString())?.hql).toBe('status IS NOT EMPTY');
  });
});

describe('การแชร์', () => {
  it('ไม่แชร์ = คนอื่นไม่เห็น', async () => {
    const seen = await listSavedFilters(other);
    expect(seen.some((r) => r.id === filterId.toString())).toBe(false);
  });

  it('แชร์แล้วคนอื่นเห็น แต่รู้ว่าไม่ใช่ของตัวเอง', async () => {
    await updateSavedFilter(owner, filterId, { isShared: true });
    const seen = await listSavedFilters(other);
    const row = seen.find((r) => r.id === filterId.toString());
    expect(row?.isMine).toBe(false);
    expect(row?.owner).toBe('ผู้ใช้ เจ้าของ');
  });

  it('**คนอื่นแก้ตัวกรองที่แชร์ไม่ได้**', async () => {
    await expect(updateSavedFilter(other, filterId, { isShared: false })).rejects.toThrow(
      NotFilterOwnerError,
    );
  });

  it('**คนอื่นลบตัวกรองที่แชร์ไม่ได้**', async () => {
    await expect(deleteSavedFilter(other, filterId)).rejects.toThrow(NotFilterOwnerError);
    expect(await prismaClient.savedFilter.count({ where: { id: filterId } })).toBe(1);
  });
});

describe('ขอบเขตของตัวกรองที่แชร์', () => {
  it('**ตัวกรองที่แชร์ทำงานด้วยขอบเขตของคนที่กด ไม่ใช่ของเจ้าของ**', async () => {
    /*
      เจ้าของเห็นทั้ง SD และ PLAT · คนที่กดเห็นเฉพาะ SD
      คิวรีเดียวกันต้องให้ผลต่างกัน — ถ้าเหมือนกัน แปลว่าตัวกรองพกสิทธิ์
      ของเจ้าของติดไปด้วย ซึ่งเป็นช่องโหว่ที่ไม่มีอะไรบนหน้าจอบอก
    */
    const hql = 'status IS NOT EMPTY';
    const asOwner = await searchByHql(owner, hql, [sdId, platId], 50);
    const asOther = await searchByHql(other, hql, [sdId], 50);

    expect(asOwner.length).toBeGreaterThan(0);
    expect(asOther.length).toBeGreaterThan(0);

    const platKeys = new Set(asOwner.filter((h) => h.itemKey.startsWith('PLAT-')).map((h) => h.itemKey));
    expect(platKeys.size).toBeGreaterThan(0);
    // คนที่เห็นเฉพาะ SD ต้องไม่ได้ผลของ PLAT สักใบ
    for (const h of asOther) expect(h.itemKey.startsWith('PLAT-')).toBe(false);
  });

  it('ตัวกรองเก็บเป็นข้อความ ไม่ใช่ DSL ที่แปลไว้แล้ว', async () => {
    // DSL ที่แปลไว้จะค้างกติกาของวันที่บันทึก และจะพกขอบเขตของเจ้าของติดไปด้วย
    const row = await prismaClient.savedFilter.findFirstOrThrow({ where: { id: filterId } });
    expect(row.hql).toBe('status IS NOT EMPTY');
    expect(row.hql).not.toContain('bool');
    expect(row.hql).not.toContain('tenantId');
  });
});

describe('ลบ', () => {
  it('เจ้าของลบได้', async () => {
    await deleteSavedFilter(owner, filterId);
    expect(await prismaClient.savedFilter.count({ where: { id: filterId } })).toBe(0);
  });

  it('ลบตัวที่ไม่มีอยู่ถูกปฏิเสธ', async () => {
    await expect(deleteSavedFilter(owner, BigInt(99_999_999))).rejects.toThrow(FilterNotFoundError);
  });
});
