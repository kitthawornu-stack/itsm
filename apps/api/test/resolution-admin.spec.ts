/**
 * ตั้งค่าผลการแก้ไข — เทสต์เป็นข้อกำหนด
 *
 * ประเด็นที่สำคัญที่สุดคือ **ไม่มีการลบ** · `work_item.resolution_id` เป็น
 * `onDelete: SetNull` การลบแถวเดียวจึงล้างค่าบนงานที่ปิดไปแล้วทุกใบพร้อมกัน
 * โดยไม่มีอะไรเตือน และ `work_item_history` เก็บเป็นชื่อ ไม่ใช่ id จึงกู้กลับไม่ได้
 *
 * สร้างข้อมูลของตัวเองแล้วลบทิ้ง ไม่แตะของ seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  DuplicateLookupNameError,
  LastActiveLookupError,
  LookupNameRequiredError,
  LookupNotFoundError,
  createResolution,
  listResolutions,
  listResolutionsAdmin,
  renameResolution,
  setResolutionActive,
} from '../src/modules/field';

const STAMP = String(Date.now()).slice(-6);
const NAME = `ทดสอบผล ${STAMP}`;

let ctx: TenantContext;
let actorId: bigint;
let madeId = 0;

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  const user = await prismaClient.user.create({
    data: {
      tenantId: tenant.id,
      email: `res-admin-${STAMP}@example.test`,
      displayName: 'ทดสอบตั้งค่าผล',
    },
    select: { id: true },
  });
  actorId = user.id;
  ctx = { tenantId: tenant.id, actorId };
});

/**
 * เก็บกวาดจาก **audit trail** ไม่ใช่จาก id ที่จำไว้ตัวเดียว
 *
 * เคสที่คาดว่าจะถูกปฏิเสธ (ชื่อว่าง ชื่อซ้ำ) จะสร้างแถวขึ้นมาจริง **ตอนที่เรา
 * ลบกลไกออกเพื่อพิสูจน์ว่าเทสต์แดงได้** ซึ่งเป็นสิ่งที่ต้องทำทุกครั้งตามกติกา
 * · ครั้งแรกที่เขียนไฟล์นี้ เก็บแค่ id เดียว ผลคือมีแถวชื่อ "   " และแถวที่มี
 * ช่องว่างหัวท้าย ค้างอยู่ในฐานข้อมูลจริง แล้วไปโผล่เป็นตัวเลือกว่างเปล่า
 * ในฟอร์มปิดงาน
 *
 * audit_log ตอบได้ว่าผู้ใช้คนนี้แตะแถวไหนบ้าง — ซึ่งเป็นเหตุผลที่มันมีอยู่
 */
afterAll(async () => {
  const touched = await prismaClient.auditLog.findMany({
    where: { actorId, entityType: 'resolution' },
    select: { entityId: true },
  });
  const ids = [...new Set(touched.map((t) => Number(t.entityId)))].filter(Number.isInteger);
  if (ids.length > 0) {
    await prismaClient.resolution.deleteMany({ where: { id: { in: ids }, workItems: { none: {} } } });
  }
  await prismaClient.auditLog.deleteMany({ where: { actorId } });
  await prismaClient.user.deleteMany({ where: { id: actorId } });
  await prismaClient.$disconnect();
});

describe('เพิ่มผลการแก้ไข', () => {
  it('เพิ่มได้ และไปต่อท้ายรายการ ไม่ใช่แทรกกลาง', async () => {
    const before = await listResolutions(ctx);
    const row = await createResolution(ctx, NAME);
    madeId = row.id;
    expect(row.isActive).toBe(true);
    expect(row.inUse).toBe(0);

    const after = await listResolutions(ctx);
    // ลำดับเดิมต้องไม่ขยับ — ตัวเลือกที่สลับที่เองทำให้คนกดผิดปุ่มที่เคยกดถูก
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after[after.length - 1]).toBe(NAME);
  });

  it('ชื่อว่างถูกปฏิเสธ', async () => {
    await expect(createResolution(ctx, '   ')).rejects.toThrow(LookupNameRequiredError);
  });

  it('ชื่อซ้ำถูกปฏิเสธ — ตัวเลือกสองอันชื่อเหมือนกันเลือกไม่ถูก', async () => {
    await expect(createResolution(ctx, NAME)).rejects.toThrow(DuplicateLookupNameError);
  });

  it('ตัดช่องว่างหัวท้ายก่อนเทียบชื่อซ้ำ', async () => {
    await expect(createResolution(ctx, `  ${NAME}  `)).rejects.toThrow(DuplicateLookupNameError);
  });

  it('**บันทึก audit** — ทุก mutation ต้องตอบได้ว่าใครทำเมื่อไร', async () => {
    const log = await prismaClient.auditLog.findFirst({
      where: { entityType: 'resolution', entityId: String(madeId), action: 'resolution.create' },
    });
    expect(log).not.toBeNull();
    expect(log?.actorId).toBe(actorId);
  });
});

describe('เปลี่ยนชื่อ', () => {
  it('เปลี่ยนได้ และ audit เก็บทั้งชื่อเดิมและชื่อใหม่', async () => {
    await renameResolution(ctx, madeId, `${NAME} แก้แล้ว`);
    const log = await prismaClient.auditLog.findFirstOrThrow({
      where: { entityType: 'resolution', entityId: String(madeId), action: 'resolution.rename' },
    });
    const payload = log.payload as { from?: string; to?: string };
    expect(payload.from).toBe(NAME);
    expect(payload.to).toBe(`${NAME} แก้แล้ว`);
  });

  it('ส่งชื่อเดิมกลับมาไม่เป็น error และไม่เขียนอะไร', async () => {
    const before = await prismaClient.auditLog.count({
      where: { entityType: 'resolution', entityId: String(madeId) },
    });
    // auditedTransaction โยนเมื่อไม่มี audit — ถ้าไม่ดักตรงนี้ ผู้ใช้ที่กดบันทึก
    // ซ้ำจะเจอ error ที่บอกว่านักพัฒนาทำพลาด
    await renameResolution(ctx, madeId, `${NAME} แก้แล้ว`);
    expect(
      await prismaClient.auditLog.count({
        where: { entityType: 'resolution', entityId: String(madeId) },
      }),
    ).toBe(before);
  });

  it('เปลี่ยนเป็นชื่อที่มีอยู่แล้วถูกปฏิเสธ', async () => {
    const other = (await listResolutions(ctx))[0];
    if (other === undefined) return;
    await expect(renameResolution(ctx, madeId, other)).rejects.toThrow(DuplicateLookupNameError);
  });

  it('รหัสที่ไม่มีอยู่ถูกปฏิเสธ', async () => {
    await expect(renameResolution(ctx, 99_999_999, 'อะไรก็ได้')).rejects.toThrow(
      LookupNotFoundError,
    );
  });
});

describe('เลิกใช้', () => {
  it('**เลิกใช้แล้วหายจากตัวเลือก แต่ยังอยู่ในหน้าตั้งค่า**', async () => {
    await setResolutionActive(ctx, madeId, false);
    const picker = await listResolutions(ctx);
    const admin = await listResolutionsAdmin(ctx);
    expect(picker).not.toContain(`${NAME} แก้แล้ว`);
    expect(admin.find((r) => r.id === madeId)?.isActive).toBe(false);
  });

  it('กลับมาใช้ใหม่ได้', async () => {
    await setResolutionActive(ctx, madeId, true);
    expect(await listResolutions(ctx)).toContain(`${NAME} แก้แล้ว`);
  });

  it('สั่งซ้ำสถานะเดิมไม่เป็น error', async () => {
    await expect(setResolutionActive(ctx, madeId, true)).resolves.toBeUndefined();
  });

  it('**ปิดตัวสุดท้ายไม่ได้** — ตารางว่างแปลว่าปิดงานไม่ได้ทั้งระบบ', async () => {
    const all = await listResolutionsAdmin(ctx);
    const active = all.filter((r) => r.isActive);
    const keep = active[active.length - 1];
    if (keep === undefined) return;

    const turnedOff: number[] = [];
    try {
      for (const r of active) {
        if (r.id === keep.id) continue;
        await setResolutionActive(ctx, r.id, false);
        turnedOff.push(r.id);
      }
      await expect(setResolutionActive(ctx, keep.id, false)).rejects.toThrow(LastActiveLookupError);
      expect(await listResolutions(ctx)).toHaveLength(1);
    } finally {
      // ต้องคืนใน finally — assertion ที่ล้มกลางทางเคยทำข้อมูล seed พังมาแล้ว
      for (const id of turnedOff) await setResolutionActive(ctx, id, true);
    }
  });

  it('**ไม่มีฟังก์ชันลบผลการแก้ไขให้เรียก** — การลบล้างค่าบนงานเก่าทุกใบ', async () => {
    /*
      เดิมสแกนทั้งโมดูล `field` แล้วยืนยันว่าไม่มีชื่อไหนตรง /delete|remove/
      ซึ่งกว้างเกินเจตนา — พอโมดูลมี `removeIssueType` เข้ามา เทสต์ก็แดง
      ทั้งที่กฎเรื่องผลการแก้ไขไม่ได้เปลี่ยนอะไรเลย

      กฎคือ "ห้ามลบ**ผลการแก้ไข**" ไม่ใช่ "ห้ามโมดูลนี้มีคำว่าลบ"
    */
    const mod: Record<string, unknown> = await import('../src/modules/field');
    const resolutionDeleters = Object.keys(mod).filter(
      (k) => /resolution/i.test(k) && /delete|remove/i.test(k),
    );
    expect(resolutionDeleters).toEqual([]);
  });
});

describe('จำนวนงานที่ใช้อยู่', () => {
  it('รายงานจำนวนงานที่ถือค่านั้นอยู่ ไม่ใช่ให้ผู้ดูแลเดา', async () => {
    const rows = await listResolutionsAdmin(ctx);
    const used = rows.filter((r) => r.inUse > 0);
    const total = used.reduce((n, r) => n + r.inUse, 0);
    const actual = await prismaClient.workItem.count({
      where: { tenantId: ctx.tenantId, resolutionId: { not: null } },
    });
    expect(total).toBe(actual);
    expect(rows.find((r) => r.id === madeId)?.inUse).toBe(0);
  });
});
