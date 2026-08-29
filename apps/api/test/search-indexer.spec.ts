/**
 * Indexer — ทดสอบกับ seed data จริง 10,000 ใบ ไม่ใช่ข้อมูลตัวอย่าง 3 แถว
 *
 * เหตุผล (CLAUDE.md §3): ข้อมูล 3 แถวทำให้ทุกอย่างดูเร็ว
 * ปัญหาจริงของ bulk index และ pagination จะไม่ปรากฏจนกว่าจะมีข้อมูลจริง
 *
 * เทสต์นี้ยังทำหน้าที่เป็น **เกณฑ์สมรรถนะ** ตาม master-plan Part 09:
 * ค้นหา p95 ต้องต่ำกว่า 400 ms
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { reindexAll, searchWorkItems } from '../src/modules/search-index/indexer.service';
import type { TenantContext } from '@itsm/types';

let ctx: TenantContext;
let indexed = 0;
let elapsedMs = 0;

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirst({ where: { key: 'default' } });
  if (tenant === null) {
    throw new Error('ยังไม่มีข้อมูล seed — รัน `pnpm --filter @itsm/api seed` ก่อน');
  }
  ctx = { tenantId: tenant.id, actorId: null };

  const result = await reindexAll(ctx, { batchSize: 2_000 });
  indexed = result.indexed;
  elapsedMs = result.elapsedMs;
}, 300_000);

afterAll(async () => {
  /*
    **ไม่ลบดัชนีทิ้ง** — เดิมลบ แล้วทุกครั้งที่รัน `pnpm ci` การค้นหาบนเครื่อง
    พัฒนาจะพังต่อจากนั้น จนกว่าจะมีคนนึกได้ว่าต้อง `reindex` · ตัวเฝ้าระวัง
    ที่เพิ่งเพิ่มจับได้ว่าดัชนีขององค์กร 57 หายอยู่จริง และต้นเหตุคือไฟล์นี้
    ไม่ใช่ Docker รีสตาร์ตอย่างที่เคยเข้าใจ

    ดัชนีที่ `beforeAll` สร้างไว้ **คือสำเนาที่ตรงกับฐานข้อมูลพอดี** — เหมือน
    ผลของ `pnpm reindex` ทุกประการ · การทิ้งมันไว้จึงทำให้เครื่องพัฒนาอยู่ใน
    สภาพที่ถูกต้องกว่าเดิม ไม่ใช่สกปรกกว่าเดิม

    เทสต์ที่ต้องการดัชนีของตัวเองจริง ๆ ให้ทำอย่าง `thai-search.spec.ts`
    คือสร้างดัชนีชื่อของตัวเองแล้วลบของตัวเอง ไม่แตะของที่ใช้ร่วมกัน
  */
  await prismaClient.$disconnect();
});

describe('indexer · ซิงก์จาก MySQL', () => {
  it('index ครบทุกใบที่มีใน MySQL', async () => {
    const inDb = await prismaClient.workItem.count({ where: { tenantId: ctx.tenantId } });
    expect(indexed).toBe(inDb);
    expect(indexed).toBeGreaterThanOrEqual(10_000);
  });

  it('reindex 10,000 ใบเสร็จภายใน 60 วินาที', () => {
    expect(elapsedMs).toBeLessThan(60_000);
  });
});

describe('indexer · ค้นหาบนข้อมูลจริง', () => {
  it('ค้นคำกลางประโยคเจอผลลัพธ์', async () => {
    const hits = await searchWorkItems(ctx, 'รหัสผ่าน', { size: 10 });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.summary).toMatch(/รหัสผ่าน|รหัส|ผ่าน/);
    }
  });

  it('ค้นคีย์งานตรงเป๊ะได้อันดับหนึ่ง', async () => {
    const sample = await prismaClient.workItem.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, itemKey: 'SD-4242' },
    });
    const hits = await searchWorkItems(ctx, sample.itemKey, { size: 5 });
    expect(hits[0]?.itemKey).toBe(sample.itemKey);
  });

  it('ค้นคำอังกฤษที่ปนอยู่ในข้อความไทยได้', async () => {
    const hits = await searchWorkItems(ctx, 'SSO', { size: 10 });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('กรองตามโปรเจกต์แล้วได้เฉพาะโปรเจกต์นั้น', async () => {
    const plat = await prismaClient.project.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, key: 'PLAT' },
    });
    const hits = await searchWorkItems(ctx, 'workflow', { projectIds: [plat.id], size: 20 });
    for (const h of hits) {
      expect(h.itemKey.startsWith('PLAT-')).toBe(true);
    }
  });

  it('คำที่ไม่มีในข้อมูลเลย ต้องคืนผลว่าง ไม่ใช่คืนทุกอย่าง', async () => {
    const hits = await searchWorkItems(ctx, 'จักรยานยนต์ไฟฟ้าดัดแปลง', { size: 10 });
    expect(hits).toHaveLength(0);
  });
});

describe('indexer · เกณฑ์สมรรถนะ (master-plan Part 09)', () => {
  it('ค้นหา p95 ต่ำกว่า 400 ms บนดัชนี 10,000 ใบ', async () => {
    const queries = [
      'รหัสผ่าน', 'เครื่องพิมพ์', 'VPN', 'สิทธิ์เข้าถึง', 'อีเมล',
      'workflow', 'SLA', 'ระบบล่ม', 'ขอติดตั้ง', 'รายงาน',
      'โฟลเดอร์', 'พนักงานใหม่', 'สัญญาณ', 'ไม่ได้', 'จอ',
    ];

    const timings: number[] = [];
    for (let round = 0; round < 4; round += 1) {
      for (const q of queries) {
        const t0 = performance.now();
        await searchWorkItems(ctx, q, { size: 20 });
        timings.push(performance.now() - t0);
      }
    }

    timings.sort((a, b) => a - b);
    const p95 = timings[Math.floor(timings.length * 0.95)] ?? 0;
    const median = timings[Math.floor(timings.length * 0.5)] ?? 0;
    console.log(`    search: median ${median.toFixed(1)} ms · p95 ${p95.toFixed(1)} ms · n=${timings.length}`);
    expect(p95).toBeLessThan(400);
  }, 120_000);
});
