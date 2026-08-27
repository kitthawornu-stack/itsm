/**
 * สร้างฟิลด์เพิ่มเติมและตั้งค่าให้โปรเจกต์ — เทสต์เป็นข้อกำหนด
 *
 * เศษหนึ่งส่วนสามสุดท้ายของเกณฑ์ผ่าน Phase 0 ข้อแรก
 *
 * เคสที่สำคัญที่สุดคือ **ช่องเลือกต้องมีตัวเลือก** และ **ลบตัวเลือกที่ใช้อยู่ไม่ได้**
 * ทั้งสองอย่างทำให้เกิดช่องที่กรอกไม่ได้หรือค่าที่ไม่ตรงกับตัวเลือกใดเลย
 * โดยไม่มี error ที่ไหน — อาการเดียวกับที่เจอจริงตอนอ่านรูปร่าง JSON ผิด
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  DuplicateFieldError,
  FieldInUseError,
  FieldNotFoundError,
  InvalidFieldKeyError,
  OptionInUseError,
  OptionsRequiredError,
  createField,
  formFieldsFor,
  listFields,
  normalizeFieldKey,
  removeField,
  removeFieldConfig,
  setFieldConfig,
  setFieldOptions,
} from '../src/modules/field';

const STAMP = String(Date.now()).slice(-6);
const KEY = `spec_${STAMP}`;

let ctx: TenantContext;
let actorId: bigint;
let fieldId: bigint;
let projectId: bigint;
let issueTypeId: bigint;
let itemId: bigint | null = null;

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  const user = await prismaClient.user.create({
    data: { tenantId: tenant.id, email: `fa-${STAMP}@example.test`, displayName: 'ทดสอบฟิลด์' },
    select: { id: true },
  });
  actorId = user.id;
  ctx = { tenantId: tenant.id, actorId };

  const scheme = await prismaClient.workflowScheme.findFirstOrThrow({
    where: { project: { key: 'SD' } },
  });
  projectId = scheme.projectId;
  issueTypeId = scheme.issueTypeId;
});

afterAll(async () => {
  if (itemId !== null) {
    await prismaClient.workItemFieldValue.deleteMany({ where: { workItemId: itemId } });
    await prismaClient.workItem.deleteMany({ where: { id: itemId } });
  }
  // ครอบทุกคีย์ที่เทสต์ **อาจ** สร้างได้ ไม่ใช่เฉพาะที่ตั้งใจให้สำเร็จ
  const made = await prismaClient.fieldDefinition.findMany({
    where: { key: { startsWith: 'spec_' } },
    select: { id: true },
  });
  const ids = made.map((f) => f.id);
  await prismaClient.workItemFieldValue.deleteMany({ where: { fieldId: { in: ids } } });
  await prismaClient.fieldConfig.deleteMany({ where: { fieldId: { in: ids } } });
  await prismaClient.fieldDefinition.deleteMany({ where: { id: { in: ids } } });
  await prismaClient.auditLog.deleteMany({ where: { actorId } });
  await prismaClient.user.deleteMany({ where: { id: actorId } });

  expect(
    await prismaClient.fieldDefinition.count({ where: { key: { startsWith: 'spec_' } } }),
  ).toBe(0);
  await prismaClient.$disconnect();
});

describe('คีย์ของฟิลด์', () => {
  it('ทำเป็นตัวพิมพ์เล็กและตัดช่องว่าง', () => {
    expect(normalizeFieldKey('  Impact_Level  ')).toBe('impact_level');
  });

  it('**คีย์ภาษาไทยถูกปฏิเสธ** — เป็นคีย์ใน JSON snapshot และใน HQL วันหนึ่ง', () => {
    expect(() => normalizeFieldKey('ผลกระทบ')).toThrow(InvalidFieldKeyError);
  });

  it('ขีดกลางและช่องว่างถูกปฏิเสธ', () => {
    expect(() => normalizeFieldKey('impact-level')).toThrow(InvalidFieldKeyError);
    expect(() => normalizeFieldKey('impact level')).toThrow(InvalidFieldKeyError);
  });

  it('ขึ้นต้นด้วยตัวเลขไม่ได้', () => {
    expect(() => normalizeFieldKey('1impact')).toThrow(InvalidFieldKeyError);
  });
});

describe('สร้างฟิลด์', () => {
  it('**ช่องเลือกที่ไม่มีตัวเลือกถูกปฏิเสธ** — เป็นช่องที่กรอกไม่ได้', async () => {
    // เจอมาแล้วจริงตอนอ่านรูปร่าง JSON ผิด: dropdown ว่างเปล่าโดยไม่มี error
    await expect(
      createField(ctx, { key: `${KEY}_a`, name: 'ไม่มีตัวเลือก', type: 'SELECT', options: [] }),
    ).rejects.toThrow(OptionsRequiredError);
    await expect(
      createField(ctx, { key: `${KEY}_b`, name: 'ตัวเลือกเดียว', type: 'SELECT', options: ['x'] }),
    ).rejects.toThrow(OptionsRequiredError);
  });

  it('สร้างได้ และเก็บตัวเลือกในรูปร่างเดียวกับที่มีอยู่เดิม', async () => {
    const f = await createField(ctx, {
      key: KEY,
      name: `ระดับผลกระทบ ${STAMP}`,
      type: 'SELECT',
      options: ['น้อย', 'ปานกลาง', 'มาก', 'น้อย'],
    });
    fieldId = f.id;
    const row = await prismaClient.fieldDefinition.findFirstOrThrow({ where: { id: fieldId } });
    // รูปร่างต้องเป็น {"values": [...]} ไม่ใช่ array เปล่า — ไม่งั้นอ่านกลับมาว่าง
    expect(row.options).toEqual({ values: ['น้อย', 'ปานกลาง', 'มาก'] });
  });

  it('คีย์ซ้ำถูกปฏิเสธ', async () => {
    await expect(
      createField(ctx, { key: KEY, name: 'ซ้ำ', type: 'TEXT' }),
    ).rejects.toThrow(DuplicateFieldError);
  });

  it('ชื่อที่ผู้ใช้เห็นว่างไม่ได้', async () => {
    await expect(
      createField(ctx, { key: `${KEY}_c`, name: '   ', type: 'TEXT' }),
    ).rejects.toThrow(InvalidFieldKeyError);
  });
});

describe('ตั้งให้โปรเจกต์ถามฟิลด์นี้', () => {
  it('ตั้งแล้วฟอร์มถามจริง', async () => {
    const before = await formFieldsFor(ctx, projectId, issueTypeId);
    await setFieldConfig(ctx, { projectId, issueTypeId, fieldId, isRequired: false, isVisible: true });
    const after = await formFieldsFor(ctx, projectId, issueTypeId);
    expect(after.length).toBe(before.length + 1);
    expect(after.some((f) => f.key === KEY)).toBe(true);
  });

  it('ตั้งซ้ำค่าเดิมไม่เขียนอะไร', async () => {
    const r = await setFieldConfig(ctx, {
      projectId,
      issueTypeId,
      fieldId,
      isRequired: false,
      isVisible: true,
    });
    expect(r.changed).toBe(false);
  });

  it('**ซ่อนแล้วฟอร์มไม่ถาม** — ซ่อนคือไม่ถาม ไม่ใช่ถามแล้วซ่อนคำตอบ', async () => {
    await setFieldConfig(ctx, { projectId, issueTypeId, fieldId, isRequired: false, isVisible: false });
    const fields = await formFieldsFor(ctx, projectId, issueTypeId);
    expect(fields.some((f) => f.key === KEY)).toBe(false);
    await setFieldConfig(ctx, { projectId, issueTypeId, fieldId, isRequired: false, isVisible: true });
  });

  it('**ตั้งซ่อนตั้งแต่แรกก็ต้องไม่ถูกถาม** — ไม่ใช่แค่ตอนแก้ทีหลัง', async () => {
    /*
      เคสข้างบนแก้ config ที่มีอยู่แล้ว จึงวิ่งผ่านเส้นทาง `update` อย่างเดียว
      เส้นทาง `create` ไม่เคยถูกแตะ — ลบ `isVisible` ออกจาก create แล้วเทสต์
      ยังเขียว ซึ่งแปลว่ากลไกนั้นไม่มีอะไรคุ้ม
    */
    await removeFieldConfig(ctx, projectId, issueTypeId, fieldId);
    await setFieldConfig(ctx, { projectId, issueTypeId, fieldId, isRequired: false, isVisible: false });
    expect((await formFieldsFor(ctx, projectId, issueTypeId)).some((f) => f.key === KEY)).toBe(false);

    await removeFieldConfig(ctx, projectId, issueTypeId, fieldId);
    await setFieldConfig(ctx, { projectId, issueTypeId, fieldId, isRequired: false, isVisible: true });
    expect((await formFieldsFor(ctx, projectId, issueTypeId)).some((f) => f.key === KEY)).toBe(true);
  });

  it('ลบฟิลด์ที่ตั้งใช้อยู่ไม่ได้ และบอกจำนวน', async () => {
    try {
      await removeField(ctx, fieldId);
      throw new Error('ควรถูกปฏิเสธ');
    } catch (e) {
      expect(e).toBeInstanceOf(FieldInUseError);
      expect((e as FieldInUseError).configCount).toBeGreaterThan(0);
    }
  });
});

describe('แก้รายการตัวเลือก', () => {
  beforeAll(async () => {
    const status = await prismaClient.workflowStatus.findFirstOrThrow({
      where: { workflow: { schemes: { some: { projectId, issueTypeId } } }, isInitial: true },
    });
    const item = await prismaClient.workItem.create({
      data: {
        tenantId: ctx.tenantId,
        itemKey: `FA-${STAMP}`,
        projectId,
        issueTypeId,
        summary: 'งานที่เลือกตัวเลือกไว้',
        statusId: status.id,
        reporterId: actorId,
        rank: '0|hzzzzz:',
      },
      select: { id: true },
    });
    itemId = item.id;
    await prismaClient.workItemFieldValue.create({
      data: { tenantId: ctx.tenantId, workItemId: item.id, fieldId, position: 0, valueText: 'มาก' },
    });
  });

  it('เพิ่มตัวเลือกได้', async () => {
    await setFieldOptions(ctx, fieldId, ['น้อย', 'ปานกลาง', 'มาก', 'วิกฤต']);
    const fields = await listFields(ctx);
    expect(fields.find((f) => f.id === fieldId.toString())?.options).toEqual([
      'น้อย',
      'ปานกลาง',
      'มาก',
      'วิกฤต',
    ]);
  });

  it('**ลบตัวเลือกที่มีงานเลือกไว้ไม่ได้**', async () => {
    // ลบแล้วค่าที่เก็บไว้จะไม่ตรงกับตัวเลือกใดเลย และ prepareFieldValues
    // จะปฏิเสธการแก้ไขงานใบนั้นทุกครั้ง โดยที่ผู้ใช้ไม่ได้ทำอะไรผิด
    try {
      await setFieldOptions(ctx, fieldId, ['น้อย', 'ปานกลาง']);
      throw new Error('ควรถูกปฏิเสธ');
    } catch (e) {
      expect(e).toBeInstanceOf(OptionInUseError);
      expect((e as OptionInUseError).option).toBe('มาก');
    }
  });

  it('ลบตัวเลือกที่ไม่มีใครใช้ได้', async () => {
    await setFieldOptions(ctx, fieldId, ['น้อย', 'ปานกลาง', 'มาก']);
    const fields = await listFields(ctx);
    expect(fields.find((f) => f.id === fieldId.toString())?.options).not.toContain('วิกฤต');
  });

  it('เหลือตัวเลือกน้อยกว่าสองรายการไม่ได้', async () => {
    await expect(setFieldOptions(ctx, fieldId, ['มาก'])).rejects.toThrow(OptionsRequiredError);
  });
});

describe('ถอนและลบ', () => {
  it('**ถอนออกจากโปรเจกต์ไม่ลบค่าที่กรอกไว้** — ถอนคือเลิกถาม ไม่ใช่ลบคำตอบ', async () => {
    const before = await prismaClient.workItemFieldValue.count({ where: { fieldId } });
    await removeFieldConfig(ctx, projectId, issueTypeId, fieldId);
    expect(await prismaClient.workItemFieldValue.count({ where: { fieldId } })).toBe(before);
    expect((await formFieldsFor(ctx, projectId, issueTypeId)).some((f) => f.key === KEY)).toBe(false);
  });

  it('ลบฟิลด์ที่ยังมีค่ากรอกไว้ไม่ได้ — ค่าจะหายไปพร้อมกันและกู้ไม่ได้', async () => {
    await expect(removeField(ctx, fieldId)).rejects.toThrow(FieldInUseError);
  });

  it('ฟิลด์ที่ไม่มีอยู่ถูกปฏิเสธ', async () => {
    await expect(removeField(ctx, BigInt(99_999_999))).rejects.toThrow(FieldNotFoundError);
  });

  it('ลบได้เมื่อไม่เหลืออะไรอ้างถึง', async () => {
    await prismaClient.workItemFieldValue.deleteMany({ where: { fieldId } });
    await removeField(ctx, fieldId);
    expect(await prismaClient.fieldDefinition.count({ where: { id: fieldId } })).toBe(0);
  });
});
