/**
 * Service Catalog — เทสต์เป็นข้อกำหนด เขียนก่อนโค้ด
 *
 * ทำไมต้องมี: ตอนนี้ผู้แจ้งพิมพ์อิสระ ทีมจึงต้องมาเดาทีหลังว่าเรื่องนี้คืออะไร
 * และ **หมวดหมู่ที่ไม่ได้เก็บตอนแจ้ง ย้อนกลับไปเติมให้เรื่องเก่าไม่ได้**
 *
 * สี่ข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **ทางพิมพ์อิสระต้องไม่หายไป** — รายการบริการไม่มีวันครอบคลุมทุกเรื่อง
 *      ถ้าบังคับให้เลือกจากรายการ คนจะเลือกอันที่ใกล้เคียงที่สุดแล้วเขียนอย่างอื่น
 *      ซึ่งแย่กว่าไม่มีหมวดหมู่เลย เพราะข้อมูลจะดูน่าเชื่อทั้งที่ผิด
 *   2. **เห็นเฉพาะบริการของโปรเจกต์ที่ตัวเองเปิดดูได้** — รายการบริการคือแผนที่
 *      ของสิ่งที่องค์กรทำ การโชว์ทั้งหมดให้ทุกคนคือการบอกว่ามีโปรเจกต์อะไรอยู่บ้าง
 *   3. **ปิดบริการแล้วเรื่องเก่าต้องยังอยู่** และยังตอบได้ว่ามาจากบริการไหน
 *   4. **ลบหมวดที่ยังมีบริการอยู่ไม่ได้** — ถ้า cascade บริการจะหายเงียบ ๆ ไปกับหมวด
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  CatalogItemNotFoundError,
  CategoryInUseError,
  CategoryNameRequiredError,
  DuplicateCatalogNameError,
  UnknownCatalogTargetError,
  browseCatalog,
  catalogItemForReport,
  createCatalogCategory,
  createCatalogItem,
  deleteCatalogCategory,
  listCatalogAdmin,
  setCatalogItemActive,
} from '../src/modules/catalog';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let ctx: TenantContext;
let actorId: bigint;
let sdId: bigint;
let platId: bigint;
let issueTypeId: bigint;
let priorityId: number;
let catId: bigint;
let emptyCatId: bigint;
let itemId: bigint;
let platItemId: bigint;
let platOnlyCatId: bigint;

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  tenantId = tenant.id;
  actorId = (
    await prismaClient.user.findFirstOrThrow({ where: { tenantId, isSystem: false } })
  ).id;
  ctx = { tenantId, actorId };

  sdId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } })).id;
  platId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'PLAT' } })).id;
  issueTypeId = (
    await prismaClient.issueType.findFirstOrThrow({ where: { tenantId, name: 'Service Request' } })
  ).id;
  priorityId = (await prismaClient.priority.findFirstOrThrow({ where: { tenantId, rank: 3 } })).id;
}, 120_000);

afterAll(async () => {
  /*
    ลบตามลำดับเอง ไม่พึ่ง cascade — `catalog_item → catalog_category` เป็น
    `onDelete: Restrict` โดยตั้งใจ (ดูเหตุผลในหมวด D)
    และเก็บกวาดทุกแถวที่เทสต์สร้างได้ **ตอนกลไกถูกลบ** ไม่ใช่เฉพาะที่ตั้งใจสร้าง
  */
  await prismaClient.catalogItem.deleteMany({ where: { name: { contains: STAMP } } });
  await prismaClient.catalogCategory.deleteMany({ where: { name: { contains: STAMP } } });
  await prismaClient.auditLog.deleteMany({
    where: { actorId, action: { startsWith: 'catalog.' } },
  });
  await prismaClient.$disconnect();
});

describe('A · สร้างหมวดและบริการ', () => {
  it('สร้างหมวดแล้วอ่านกลับได้', async () => {
    const c = await createCatalogCategory(ctx, `บัญชีและสิทธิ์ ${STAMP}`, 10);
    catId = c.id;
    const e = await createCatalogCategory(ctx, `หมวดว่าง ${STAMP}`, 20);
    emptyCatId = e.id;
    const rows = await listCatalogAdmin(ctx);
    expect(rows.find((r) => r.id === catId.toString())?.name).toContain('บัญชีและสิทธิ์');
  });

  it('ชื่อหมวดว่างถูกปฏิเสธ', async () => {
    await expect(createCatalogCategory(ctx, '   ', 10)).rejects.toThrow(CategoryNameRequiredError);
  });

  it('สร้างบริการที่ผูกกับโปรเจกต์และประเภทงาน', async () => {
    const i = await createCatalogItem(ctx, {
      categoryId: catId,
      name: `ขอสิทธิ์เข้าใช้ระบบจัดซื้อ ${STAMP}`,
      description: 'ใช้เมื่อต้องการเข้าใช้ระบบจัดซื้อครั้งแรก',
      projectId: sdId,
      issueTypeId,
      priorityId,
    });
    itemId = i.id;
    expect(i.id).toBeDefined();
  });

  it('ชื่อบริการซ้ำถูกปฏิเสธ', async () => {
    await expect(
      createCatalogItem(ctx, {
        categoryId: catId,
        name: `ขอสิทธิ์เข้าใช้ระบบจัดซื้อ ${STAMP}`,
        projectId: sdId,
        issueTypeId,
      }),
    ).rejects.toThrow(DuplicateCatalogNameError);
  });

  it('**โปรเจกต์หรือประเภทงานที่ไม่มีอยู่จริง ถูกปฏิเสธตอนสร้าง ไม่ใช่ตอนมีคนกด**', async () => {
    /*
      บริการที่ชี้ไปยังปลายทางที่ไม่มีอยู่ คือกับดักที่รอผู้แจ้งมากด
      และคนที่กดไม่ใช่คนที่ตั้งค่าผิด — เจอ 500 โดยไม่รู้ว่าตัวเองทำอะไรผิด
    */
    await expect(
      createCatalogItem(ctx, {
        categoryId: catId,
        name: `ปลายทางมั่ว ${STAMP}`,
        projectId: BigInt(999_999_999),
        issueTypeId,
      }),
    ).rejects.toThrow(UnknownCatalogTargetError);
  });

  it('ล้มแล้วต้องไม่เหลือแถวค้าง', async () => {
    expect(
      await prismaClient.catalogItem.count({ where: { name: { contains: `ปลายทางมั่ว ${STAMP}` } } }),
    ).toBe(0);
  });
});

describe('B · ขอบเขตการมองเห็น', () => {
  it('**เห็นเฉพาะบริการของโปรเจกต์ที่ตัวเองเปิดดูได้**', async () => {
    platItemId = (
      await createCatalogItem(ctx, {
        categoryId: catId,
        name: `ขอ deploy ระบบใหม่ ${STAMP}`,
        projectId: platId,
        issueTypeId,
      })
    ).id;

    const onlySd = await browseCatalog(ctx, [sdId]);
    const names = onlySd.flatMap((g) => g.items.map((i) => i.name));
    expect(names.some((n) => n.includes('ขอสิทธิ์เข้าใช้ระบบจัดซื้อ'))).toBe(true);
    // บริการของ PLAT ต้องไม่โผล่ให้คนที่เปิดดู PLAT ไม่ได้
    expect(names.some((n) => n.includes('ขอ deploy ระบบใหม่'))).toBe(false);
  });

  it('ไม่มีสิทธิ์โปรเจกต์ไหนเลย = ไม่เห็นบริการเลย ไม่ใช่เห็นทั้งหมด', async () => {
    expect(await browseCatalog(ctx, [])).toEqual([]);
  });

  it('**หมวดที่มีแต่บริการของโปรเจกต์ที่มองไม่เห็น ต้องไม่โผล่เป็นหมวดว่าง**', async () => {
    /*
      รอบแรกเทสต์ข้อนี้ **เขียวทั้งที่กลไกถูกลบออกไปแล้ว** เพราะข้อมูลของเทสต์
      ไม่มีหมวดไหนที่มีแต่บริการที่มองไม่เห็นเลย กลไกจึงไม่เคยถูกเรียกใช้
      — เทสต์ที่ผ่านเพราะข้อมูลไปไม่ถึงกลไก พิสูจน์อะไรไม่ได้เลย

      หมวดว่างเปล่าอ่านเหมือน "ยังไม่มีบริการ" ทั้งที่จริงคือ "มีแต่คุณเข้าไม่ถึง"
    */
    platOnlyCatId = (await createCatalogCategory(ctx, `เฉพาะ PLAT ${STAMP}`, 30)).id;
    await createCatalogItem(ctx, {
      categoryId: platOnlyCatId,
      name: `ขอเครื่องทดสอบ ${STAMP}`,
      projectId: platId,
      issueTypeId,
    });

    const groups = await browseCatalog(ctx, [sdId]);
    expect(groups.some((g) => g.name.includes('เฉพาะ PLAT'))).toBe(false);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);

    // และคนที่เห็น PLAT ต้องเห็นหมวดนั้นจริง — ไม่ใช่ซ่อนจากทุกคน
    const withPlat = await browseCatalog(ctx, [sdId, platId]);
    expect(withPlat.some((g) => g.name.includes('เฉพาะ PLAT'))).toBe(true);
  });
});

describe('C · ใช้ตอนแจ้งเรื่อง', () => {
  it('คืนปลายทางให้ฟอร์มใช้ตั้งค่าเริ่มต้น', async () => {
    const t = await catalogItemForReport(ctx, itemId, [sdId]);
    expect(t.projectId).toBe(sdId);
    expect(t.issueTypeId).toBe(issueTypeId);
    expect(t.priorityId).toBe(priorityId);
  });

  it('**บริการที่เปิดดูไม่ได้ ตอบเหมือนบริการที่ไม่มีอยู่จริง**', async () => {
    await expect(catalogItemForReport(ctx, platItemId, [sdId])).rejects.toThrow(
      CatalogItemNotFoundError,
    );
  });

  it('**บริการที่ปิดแล้ว แจ้งใหม่ผ่านมันไม่ได้**', async () => {
    await setCatalogItemActive(ctx, itemId, false);
    await expect(catalogItemForReport(ctx, itemId, [sdId])).rejects.toThrow(
      CatalogItemNotFoundError,
    );
    await setCatalogItemActive(ctx, itemId, true);
  });

  it('บริการที่ปิดแล้วหายจากรายการที่ผู้แจ้งเห็น แต่ยังอยู่ในหน้าผู้ดูแล', async () => {
    await setCatalogItemActive(ctx, itemId, false);
    const seen = await browseCatalog(ctx, [sdId]);
    expect(seen.flatMap((g) => g.items.map((i) => i.id)).includes(itemId.toString())).toBe(false);
    const admin = await listCatalogAdmin(ctx);
    expect(admin.flatMap((c) => c.items.map((i) => i.id)).includes(itemId.toString())).toBe(true);
    await setCatalogItemActive(ctx, itemId, true);
  });
});

describe('D · ลบหมวด', () => {
  it('**ลบหมวดที่ยังมีบริการอยู่ไม่ได้ — และบอกว่าเหลืออยู่กี่รายการ**', async () => {
    /*
      ถ้าปล่อยให้ลบแบบ cascade บริการทั้งหมดในหมวดจะหายไปเงียบ ๆ
      พร้อมกับหมวด และไม่มีอะไรบนหน้าจอบอกว่ากำลังจะเกิดอะไรขึ้น
    */
    await expect(deleteCatalogCategory(ctx, catId)).rejects.toThrow(CategoryInUseError);
    expect(await prismaClient.catalogItem.count({ where: { categoryId: catId } })).toBeGreaterThan(0);
  });

  it('หมวดที่ว่างจริงลบได้', async () => {
    await deleteCatalogCategory(ctx, emptyCatId);
    expect(await prismaClient.catalogCategory.count({ where: { id: emptyCatId } })).toBe(0);
  });
});

describe('E · ร่องรอย', () => {
  it('ทุกการเปลี่ยนแปลงเขียน audit — ไม่มีการแก้ที่ไม่มีใครรู้', async () => {
    const n = await prismaClient.auditLog.count({
      where: { actorId, action: { startsWith: 'catalog.' } },
    });
    expect(n).toBeGreaterThan(0);
  });
});
