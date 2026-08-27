/**
 * ฟิลด์เพิ่มเติมบนฟอร์มแจ้งเรื่อง — เทสต์เป็นข้อกำหนด
 *
 * `field_config` มี 16 แถวมาตั้งแต่ Spike B และสองในสี่ฟิลด์ของ SD ตั้งเป็น
 * บังคับกรอก · แต่ `work_item_field_value` มี **0 แถว** — ฟอร์มไม่เคยถาม
 * และไม่มีอะไรตรวจ `is_required` เลย
 *
 * เคสที่สำคัญที่สุดคือ **ตรวจก่อนสร้าง** · ถ้าสร้างก่อนแล้วค่อยตรวจ จะได้ตั๋ว
 * ที่ขาดฟิลด์บังคับค้างอยู่ และไม่มีอะไรพากลับไปเติม
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  RequiredFieldsMissingError,
  UnknownFieldOptionError,
  displayFieldsFor,
  formFieldsFor,
  prepareFieldValues,
  saveFieldValues,
} from '../src/modules/field';
import { createWorkItem } from '../src/modules/workitem/workitem.service';

const STAMP = String(Date.now()).slice(-6);

let ctx: TenantContext;
let actorId: bigint;
let projectId: bigint;
let issueTypeId: bigint;
let issueTypeName: string;
const madeItems: bigint[] = [];

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  const it = await prismaClient.userGroup.findFirstOrThrow({
    where: { tenantId: tenant.id, name: 'IT Support' },
  });
  const all = await prismaClient.userGroup.findFirstOrThrow({
    where: { tenantId: tenant.id, name: 'พนักงานทั้งหมด' },
  });
  const user = await prismaClient.user.create({
    data: { tenantId: tenant.id, email: `ff-${STAMP}@example.test`, displayName: 'ทดสอบฟิลด์' },
    select: { id: true },
  });
  actorId = user.id;
  await prismaClient.groupMember.createMany({
    data: [it.id, all.id].map((groupId) => ({ tenantId: tenant.id, groupId, userId: actorId })),
  });
  ctx = { tenantId: tenant.id, actorId };

  const sd = await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } });
  projectId = sd.id;
  const cfg = await prismaClient.fieldConfig.findFirstOrThrow({
    where: { projectId, isRequired: true },
    include: { issueType: { select: { id: true, name: true } } },
  });
  issueTypeId = cfg.issueType.id;
  issueTypeName = cfg.issueType.name;
});

afterAll(async () => {
  await prismaClient.workItemFieldValue.deleteMany({ where: { workItemId: { in: madeItems } } });
  await prismaClient.notification.deleteMany({ where: { workItemId: { in: madeItems } } });
  await prismaClient.slaEvent.deleteMany({ where: { sla: { workItemId: { in: madeItems } } } });
  await prismaClient.workItemSla.deleteMany({ where: { workItemId: { in: madeItems } } });
  await prismaClient.workItemHistory.deleteMany({ where: { workItemId: { in: madeItems } } });
  await prismaClient.workItem.deleteMany({ where: { id: { in: madeItems } } });
  await prismaClient.groupMember.deleteMany({ where: { userId: actorId } });
  await prismaClient.user.deleteMany({ where: { id: actorId } });
  await prismaClient.$disconnect();
});

describe('ฟิลด์ที่ต้องแสดงบนฟอร์ม', () => {
  it('**มีฟิลด์ที่ตั้งค่าไว้จริง** — ไม่ใช่รายการว่างมาตลอด', async () => {
    const fields = await formFieldsFor(ctx, projectId, issueTypeId);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.some((f) => f.isRequired)).toBe(true);
  });

  it('ฟิลด์ SELECT ต้องมาพร้อมตัวเลือก ไม่ใช่ช่องพิมพ์อิสระ', async () => {
    const fields = await formFieldsFor(ctx, projectId, issueTypeId);
    const select = fields.find((f) => f.type === 'SELECT');
    expect(select?.options.length).toBeGreaterThan(0);
  });

  it('เรียงตามลำดับที่ผู้ดูแลตั้งไว้', async () => {
    const fields = await formFieldsFor(ctx, projectId, issueTypeId);
    const configs = await prismaClient.fieldConfig.findMany({
      where: { projectId, issueTypeId, isVisible: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: { field: { select: { key: true } } },
    });
    expect(fields.map((f) => f.key)).toEqual(configs.map((c) => c.field.key));
  });
});

describe('ตรวจค่าที่กรอกมา', () => {
  it('**ฟิลด์บังคับที่ยังไม่กรอกถูกปฏิเสธ พร้อมชื่อฟิลด์**', async () => {
    try {
      await prepareFieldValues(ctx, projectId, issueTypeId, {});
      throw new Error('ควรถูกปฏิเสธ');
    } catch (e) {
      expect(e).toBeInstanceOf(RequiredFieldsMissingError);
      // บอกทุกฟิลด์ที่ขาดในครั้งเดียว ไม่ใช่ทีละอันให้ลองใหม่หลายรอบ
      expect((e as RequiredFieldsMissingError).fields.length).toBeGreaterThan(1);
    }
  });

  it('ตัวเลือกที่ไม่มีในรายการถูกปฏิเสธ', async () => {
    const fields = await formFieldsFor(ctx, projectId, issueTypeId);
    const select = fields.find((f) => f.type === 'SELECT' && f.options.length > 0);
    if (select === undefined) return;
    await expect(
      prepareFieldValues(ctx, projectId, issueTypeId, { [select.key]: 'ตัวเลือกที่ไม่มีอยู่' }),
    ).rejects.toThrow(UnknownFieldOptionError);
  });

  it('**ค่า 0 และ false ถือว่ากรอกแล้ว** — falsy check ตรงนี้เป็นบั๊กคลาสสิก', async () => {
    const fields = await formFieldsFor(ctx, projectId, issueTypeId);
    const required = fields.filter((f) => f.isRequired);
    const submitted: Record<string, unknown> = {};
    for (const f of required) submitted[f.key] = f.options[0] ?? 'x';

    // ฟิลด์ที่ไม่บังคับใส่ค่า 0 เข้าไป — ต้องไม่ถูกมองว่าว่าง
    const optional = fields.find((f) => !f.isRequired);
    if (optional !== undefined) submitted[optional.key] = 0;

    const prepared = await prepareFieldValues(ctx, projectId, issueTypeId, submitted);
    if (optional !== undefined) {
      const row = prepared.find((p) => p.value === 0 || (Array.isArray(p.value) && p.value.includes(0)));
      expect(row).toBeDefined();
    }
  });

  it('ฟิลด์ที่ไม่บังคับและไม่ได้กรอก ไม่ถูกเขียนเป็นค่าว่าง', async () => {
    const fields = await formFieldsFor(ctx, projectId, issueTypeId);
    const submitted: Record<string, unknown> = {};
    for (const f of fields.filter((x) => x.isRequired)) submitted[f.key] = f.options[0] ?? 'x';
    const prepared = await prepareFieldValues(ctx, projectId, issueTypeId, submitted);
    // เขียนเฉพาะที่กรอกมา — แถวว่างใน EAV ตอบไม่ได้ว่า "ไม่ได้กรอก" หรือ "กรอกว่าง"
    expect(prepared).toHaveLength(fields.filter((x) => x.isRequired).length);
  });
});

describe('เขียนและอ่านกลับ', () => {
  it('**ค่าที่กรอกไปถึง EAV และ snapshot** และแสดงเป็นชื่อฟิลด์ ไม่ใช่คีย์ระบบ', async () => {
    const fields = await formFieldsFor(ctx, projectId, issueTypeId);
    const submitted: Record<string, unknown> = {};
    for (const f of fields.filter((x) => x.isRequired)) submitted[f.key] = f.options[0] ?? 'ทดสอบ';

    const created = await createWorkItem(ctx, {
      projectKey: 'SD',
      issueTypeName,
      summary: `ทดสอบฟิลด์เพิ่มเติม ${STAMP}`,
    });
    madeItems.push(created.id);

    const prepared = await prepareFieldValues(ctx, projectId, issueTypeId, submitted);
    await saveFieldValues(ctx, created.id, prepared);

    // EAV คือแหล่งความจริง (ADR-001)
    expect(
      await prismaClient.workItemFieldValue.count({ where: { workItemId: created.id } }),
    ).toBe(prepared.length);

    // snapshot ต้องถูกเขียนในทรานแซกชันเดียวกัน
    const row = await prismaClient.workItem.findFirstOrThrow({ where: { id: created.id } });
    const snap = row.fieldSnapshot as Record<string, unknown>;
    expect(Object.keys(snap).length).toBe(prepared.length);

    const display = await displayFieldsFor(ctx, projectId, issueTypeId, snap);
    expect(display.length).toBe(prepared.length);
    // ชื่อที่คนอ่านได้ ไม่ใช่ `impact` / `urgency`
    for (const d of display) expect(d.name).not.toMatch(/^[a-z_]+$/);
  });

  it('ฟิลด์ที่ไม่มีค่าไม่ถูกแสดงเป็นบรรทัดว่าง', async () => {
    const display = await displayFieldsFor(ctx, projectId, issueTypeId, {});
    expect(display).toEqual([]);
  });
});
