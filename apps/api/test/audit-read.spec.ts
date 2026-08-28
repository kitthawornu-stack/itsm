/**
 * อ่าน audit log — เทสต์เป็นข้อกำหนด
 *
 * INVARIANT 2 บังคับให้ทุก mutation เขียน `audit_log` และ `auditedTransaction`
 * โยน error ถ้าไม่เขียน · แต่ **ไม่มีหน้าจอไหนอ่านมันเลย** — เราบังคับให้เก็บ
 * หลักฐานมาตลอด แล้วไม่เคยเปิดดู
 *
 * ห้าข้อที่ทำให้หน้าจออ่าน audit เชื่อถือได้:
 *
 *   1. **ขอบเขต tenant** — audit คือร่องรอยของทุกคน หลุดข้ามองค์กรไม่ได้
 *   2. **"ไม่มีรายการที่ตรงเงื่อนไข" ต้องต่างจาก "ไม่มีกิจกรรมเลย"**
 *   3. **ระบบทำเอง ต่างจาก คนทำแต่ลบบัญชีไปแล้ว** — สองอย่างนี้ตอบคนละคำถาม
 *   4. **ชนิดของการกระทำมาจากข้อมูลจริง** ไม่ใช่รายการที่หน้าจอเขียนเอง
 *   5. **ยอดรวมคือยอดของเงื่อนไข ไม่ใช่จำนวนที่คืนมาในหน้านี้**
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  AUDIT_PAGE_MAX,
  auditTrailOf,
  readAuditLog,
  sinceFromRange,
} from '../src/modules/audit';

const STAMP = String(Date.now()).slice(-6);
const ENTITY = `test-entity-${STAMP}`;

let ctx: TenantContext;
let otherCtx: TenantContext;
let tenantId: bigint;
let otherTenantId: bigint;
let actorId: bigint;
let ghostId: bigint;

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  tenantId = tenant.id;
  actorId = (await prismaClient.user.findFirstOrThrow({ where: { tenantId, isSystem: false } })).id;
  ctx = { tenantId, actorId };

  const other = await prismaClient.tenant.create({
    data: { key: `t${STAMP}`, name: `องค์กรอื่น ${STAMP}` },
    select: { id: true },
  });
  otherTenantId = other.id;
  otherCtx = { tenantId: otherTenantId, actorId: null };

  /*
    ผู้ใช้ที่จะถูกลบทีหลัง — เพื่อพิสูจน์ว่า "คนทำแต่ลบบัญชีไปแล้ว"
    ต่างจาก "ระบบทำเอง" · `actor` เป็น `onDelete: SetNull`
  */
  ghostId = (
    await prismaClient.user.create({
      data: { tenantId, email: `ghost-${STAMP}@example.test`, displayName: `ผีน้อย ${STAMP}` },
      select: { id: true },
    })
  ).id;

  await prismaClient.auditLog.createMany({
    data: [
      { tenantId, actorId, action: `test.alpha.${STAMP}`, entityType: ENTITY, entityId: '1' },
      { tenantId, actorId, action: `test.beta.${STAMP}`, entityType: ENTITY, entityId: '1' },
      // ระบบทำเอง — actorId เป็น null ตั้งแต่ต้น
      { tenantId, actorId: null, action: `test.system.${STAMP}`, entityType: ENTITY, entityId: '2' },
      /*
        คนทำ แต่บัญชีจะถูกลบทีหลัง · เก็บ `actorName` ไว้เหมือนที่
        `auditedTransaction` ทำจริง — ถ้าไม่เก็บ ร่องรอยนี้จะแยกจาก
        "ระบบทำเอง" ไม่ได้เลยหลังลบบัญชี
      */
      {
        tenantId,
        actorId: ghostId,
        actorName: `ผีน้อย ${STAMP}`,
        action: `test.ghost.${STAMP}`,
        entityType: ENTITY,
        entityId: '2',
      },
      // ของอีก tenant — ต้องไม่หลุดมา
      {
        tenantId: otherTenantId,
        actorId: null,
        action: `test.other.${STAMP}`,
        entityType: ENTITY,
        entityId: '9',
      },
    ],
  });
}, 120_000);

afterAll(async () => {
  await step('audit ของเทสต์', () =>
    prismaClient.auditLog.deleteMany({ where: { entityType: ENTITY } }),
  );
  await step('ผู้ใช้ผี', () => prismaClient.user.deleteMany({ where: { id: ghostId } }));
  await step('tenant อื่น', () => prismaClient.tenant.deleteMany({ where: { id: otherTenantId } }));
  await prismaClient.$disconnect();
});

describe('A · ขอบเขต', () => {
  it('**ไม่เห็น audit ของ tenant อื่น**', async () => {
    // audit คือร่องรอยของทุกคนในองค์กร หลุดข้ามองค์กรคือความเสียหายที่กู้ไม่ได้
    const page = await readAuditLog(ctx, { entityType: ENTITY });
    expect(page.rows.some((r) => r.action.includes('test.other'))).toBe(false);
    expect(page.total).toBe(4);
  });

  it('อีก tenant เห็นเฉพาะของตัวเอง', async () => {
    const page = await readAuditLog(otherCtx, { entityType: ENTITY });
    expect(page.total).toBe(1);
    expect(page.rows[0]?.action).toContain('test.other');
  });
});

describe('B · ใครเป็นคนทำ', () => {
  it('**ระบบทำเอง ต่างจาก คนทำแต่ลบบัญชีไปแล้ว**', async () => {
    /*
      ทั้งสองกรณี `actor` เป็น null เหมือนกันหลังผู้ใช้ถูกลบ (onDelete: SetNull)
      แต่ตอบคนละคำถาม: อย่างแรกคือ "ระบบทำ ไม่มีคนเกี่ยว" อย่างหลังคือ
      "มีคนทำ แต่บัญชีนั้นไม่อยู่แล้ว" — ซึ่งเป็นเรื่องที่ผู้ตรวจสอบต้องรู้
    */
    const before = await readAuditLog(ctx, { entityType: ENTITY, entityId: '2' });
    const ghost = before.rows.find((r) => r.action.includes('test.ghost'));
    expect(ghost?.actor).toContain('ผีน้อย');
    expect(ghost?.actorRemoved).toBe(false);

    await prismaClient.user.delete({ where: { id: ghostId } });

    const after = await readAuditLog(ctx, { entityType: ENTITY, entityId: '2' });
    const system = after.rows.find((r) => r.action.includes('test.system'));
    const orphan = after.rows.find((r) => r.action.includes('test.ghost'));
    // ระบบทำเอง — ไม่มีทั้ง actorId และ actorName
    expect(system?.actor).toBeNull();
    expect(system?.actorRemoved).toBe(false);

    /*
      คนทำแต่บัญชีถูกลบ — **ยังตอบได้ว่าใครทำ**

      รอบแรกฟิลด์ `actorRemoved` เป็นสถานะที่ **ไปถึงไม่ได้เลย**: `onDelete: SetNull`
      ทำให้ `actorId` เป็น null ตอนลบ แล้วแยกจาก "ระบบทำเอง" ไม่ได้
      พิสูจน์ได้เพราะลบบรรทัดที่คำนวณมันออกแล้วเทสต์ยังเขียวทั้ง 12 เคส

      แก้ด้วยการเก็บชื่อไว้ในแถวตอนเขียน — audit ที่ลืมว่าใครทำเมื่อบัญชี
      ถูกลบ ไม่ใช่ audit และแย่กว่านั้นคือมันโกหกว่า "ระบบทำเอง"
    */
    expect(orphan?.actor).toContain('ผีน้อย');
    expect(orphan?.actorRemoved).toBe(true);
  });
});

describe('C · ตัวกรอง', () => {
  it('กรองตามชนิดของการกระทำได้', async () => {
    const page = await readAuditLog(ctx, { action: `test.alpha.${STAMP}` });
    expect(page.total).toBe(1);
    expect(page.rows[0]?.action).toBe(`test.alpha.${STAMP}`);
  });

  it('**ตัวกรองที่ไม่ตรงอะไรเลย ต้องแยกจาก "ไม่มีกิจกรรม"**', async () => {
    /*
      หน้าจอที่ขึ้นว่า "ไม่มีรายการ" เฉย ๆ ทำให้ผู้ตรวจสอบสรุปว่าไม่เคยมีใคร
      ทำอะไร ทั้งที่จริงคือกรองแคบเกินไป · `actions` ที่คืนมาพร้อมกันบอกได้ว่า
      ระบบมีกิจกรรมชนิดไหนอยู่บ้าง หน้าจอจึงเขียนข้อความที่ถูกได้
    */
    const page = await readAuditLog(ctx, { action: 'ไม่มีทางมีจริง' });
    expect(page.rows).toHaveLength(0);
    expect(page.total).toBe(0);
    expect(page.actions.length).toBeGreaterThan(0);
  });

  it('**ชนิดของการกระทำมาจากข้อมูลจริง** ไม่ใช่รายการที่เขียนไว้เอง', async () => {
    const page = await readAuditLog(ctx, {});
    expect(page.actions).toContain(`test.alpha.${STAMP}`);
    // ไม่มีค่าซ้ำ — distinct ทำงานจริง
    expect(new Set(page.actions).size).toBe(page.actions.length);
  });

  it('กรองตามช่วงเวลาได้ และ "ทั้งหมด" ต้องไม่กรอง', async () => {
    const now = new Date('2026-08-28T00:00:00.000Z') as never;
    expect(sinceFromRange('all', now)).toBeUndefined();
    const d7 = sinceFromRange('7d', now);
    expect(d7?.toISOString()).toBe('2026-08-21T00:00:00.000Z');
  });
});

describe('D · การแบ่งหน้า', () => {
  it('**ยอดรวมคือยอดของเงื่อนไข ไม่ใช่จำนวนที่คืนมาในหน้านี้**', async () => {
    const page = await readAuditLog(ctx, { entityType: ENTITY, limit: 1 });
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(4);
  });

  it('หน้าถัดไปไม่ซ้ำกับหน้าแรก', async () => {
    const a = await readAuditLog(ctx, { entityType: ENTITY, limit: 2, offset: 0 });
    const b = await readAuditLog(ctx, { entityType: ENTITY, limit: 2, offset: 2 });
    const ids = new Set(a.rows.map((r) => r.id));
    for (const r of b.rows) expect(ids.has(r.id)).toBe(false);
    expect(b.offset).toBe(2);
  });

  it('ขอเกินเพดานได้แค่เพดาน — ไม่ใช่ดึงทั้งตาราง', async () => {
    const page = await readAuditLog(ctx, { limit: 100_000 });
    expect(page.rows.length).toBeLessThanOrEqual(AUDIT_PAGE_MAX);
  });

  it('ค่าที่พังตกกลับเป็นหน้าแรก ไม่ใช่ระเบิด', async () => {
    const page = await readAuditLog(ctx, { entityType: ENTITY, offset: -50, limit: 0 });
    expect(page.offset).toBe(0);
    expect(page.rows.length).toBeGreaterThan(0);
  });
});

describe('E · ร่องรอยของสิ่งหนึ่ง', () => {
  it('ตอบได้ว่าสิ่งนี้ผ่านอะไรมาบ้าง เรียงใหม่สุดก่อน', async () => {
    const trail = await auditTrailOf(ctx, ENTITY, '1');
    expect(trail).toHaveLength(2);
    const times = trail.map((t) => t.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });
});
