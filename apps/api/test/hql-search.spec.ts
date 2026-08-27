/**
 * HQL ที่ต่อกับดัชนีจริง — เทสต์เป็นข้อกำหนด
 *
 * `packages/hql` พิสูจน์ตัวเองได้ครบว่าแปล DSL ถูก แต่มันไม่รู้ว่าดัชนีจริง
 * ตอบอะไรกลับมา · เทสต์นี้ยิงเข้า OpenSearch ของจริงเพื่อตอบคำถามเดียว
 * ที่เทสต์บริสุทธิ์ตอบไม่ได้: **คิวรีที่แปลออกมา ตรงกับเอกสารจริงหรือเปล่า**
 *
 * **สร้างดัชนีเอง ไม่ข้ามเมื่อไม่มี**
 *
 * รอบแรกเขียนเป็น `if (!ready) return;` เมื่อหาดัชนีไม่เจอ · ผลคือเทสต์ทั้งหก
 * เขียวหมดโดยไม่ได้ยิงคิวรีสักครั้ง และการลบกลไกออกเพื่อพิสูจน์ว่าแดงได้
 * ก็ยังเขียวทั้งสามรอบ — **เทสต์ที่ตรวจอะไรไม่ได้แล้วรายงานว่าผ่าน
 * อันตรายกว่าไม่มีเทสต์** เพราะมันสร้างความมั่นใจที่ไม่มีอะไรรองรับ
 *
 * สาเหตุที่หาดัชนีไม่เจอ: `search-indexer.spec.ts` ลบดัชนีทิ้งใน `afterAll`
 * ไฟล์นี้จึงต้องสร้างเอง ไม่ใช่หวังว่าจะมีคนสร้างไว้ให้
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { reindexAll, searchByHql } from '../src/modules/search-index';

let ctx: TenantContext;
let sdId: bigint;
let platId: bigint;

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  ctx = { tenantId: tenant.id, actorId: null };
  sdId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } })).id;
  platId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'PLAT' } })).id;
  await reindexAll(ctx, { batchSize: 2_000 });
}, 300_000);

afterAll(async () => {
  // ไม่ลบดัชนีทิ้ง — `search-indexer.spec.ts` เป็นเจ้าของวงจรชีวิตของมัน
  // และการทิ้งดัชนีที่ใช้ได้ไว้ ดีกว่าทิ้งสภาพที่ไฟล์ถัดไปต้องสร้างใหม่เอง
  await prismaClient.$disconnect();
});

describe('HQL บนดัชนีจริง', () => {
  it('**ชื่อฟิลด์ตรงกับดัชนีจริง — คิวรีคืนผลลัพธ์ ไม่ใช่ศูนย์เสมอ**', async () => {
    /*
      นี่คือเคสที่จับความผิดพลาดจริงที่เกิดขึ้น: เขียน target เป็น `status`
      ทั้งที่ดัชนีเก็บ `statusName` · DSL ถูกต้องทุกประการ OpenSearch ไม่ฟ้อง
      และคืนศูนย์ผลลัพธ์ทุกครั้ง ซึ่งอ่านเหมือน "ไม่มีข้อมูลตรงเงื่อนไข"
    */
    const hits = await searchByHql(ctx, 'status IS NOT EMPTY', [sdId, platId], 5);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('กรองด้วยสถานะแล้วได้เฉพาะสถานะนั้น', async () => {
    const one = await searchByHql(ctx, 'status IS NOT EMPTY', [sdId], 1);
    const target = one[0]?.statusName;
    if (target === undefined) return;
    const hits = await searchByHql(ctx, `status = "${target}"`, [sdId], 20);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.statusName).toBe(target);
  });

  it('**ขอบเขตโปรเจกต์บังคับได้จริง ไม่ใช่แค่ปรากฏใน DSL**', async () => {
    // ถามหางานของ PLAT ทั้งที่มีสิทธิ์เฉพาะ SD — ต้องไม่เห็นอะไรเลย
    const hits = await searchByHql(ctx, 'project = PLAT', [sdId], 20);
    expect(hits).toHaveLength(0);
  });

  it('**ไม่มีสิทธิ์โปรเจกต์ไหนเลย = ไม่เห็นอะไรเลย** ไม่ใช่เห็นทั้งหมด', async () => {
    const hits = await searchByHql(ctx, 'status IS NOT EMPTY', [], 20);
    expect(hits).toHaveLength(0);
  });

  it('AND แคบกว่าเงื่อนไขเดียวเสมอ', async () => {
    const one = await searchByHql(ctx, 'status IS NOT EMPTY', [sdId], 1);
    const st = one[0]?.statusName;
    if (st === undefined) return;
    const single = await searchByHql(ctx, `status = "${st}"`, [sdId], 50);
    const both = await searchByHql(ctx, `status = "${st}" AND summary ~ ไม่มีทางตรงแน่นอน`, [sdId], 50);
    expect(both.length).toBeLessThanOrEqual(single.length);
  });

  it('ค้นข้อความไทยด้วย ~ เจอจริง', async () => {
    const sample = await searchByHql(ctx, 'status IS NOT EMPTY', [sdId], 1);
    const summary = sample[0]?.summary;
    if (summary === undefined || summary.length < 8) return;
    // ใช้คำที่อยู่ในหัวข้อจริง ไม่ใช่คำที่แต่งขึ้น — คำที่แต่งขึ้นพิสูจน์ได้แค่ว่า
    // "ไม่เจอ" ซึ่งเป็นผลลัพธ์เดียวกับตอนที่ระบบค้นหาพังทั้งระบบ
    const word = summary.slice(0, 8);
    const hits = await searchByHql(ctx, `summary ~ "${word}"`, [sdId], 20);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('**คำทับศัพท์ที่ตัวตัดคำตัดไม่ลง ต้องหาเจอด้วยสาขา n-gram**', async () => {
    /*
      "โฟลเดอร์" คือคำที่ ADR-005 บันทึกไว้ว่าตัวตัดคำ `thai_text` ตัดเป็น
      "โฟลเด|อร์" ซึ่งไม่ตรงกับสิ่งที่ผู้ใช้พิมพ์ · สาขา n-gram มีไว้กู้ตรงนี้

      ยิงสาขาหลักอย่างเดียวแล้วคำนี้หาไม่เจอเลย — ความล้มเหลวแบบเงียบ
      ที่หน้าจอแสดงว่า "ไม่พบข้อมูล" ซึ่งอ่านเหมือนไม่มีเรื่องนี้ในระบบ
    */
    const all = await searchByHql(ctx, 'summary ~ โฟลเดอร์', [sdId, platId], 20);
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((h) => h.summary.includes('โฟลเดอร์'))).toBe(true);
  });
});
