/**
 * สร้างฟิลด์เพิ่มเติม และตั้งว่าโปรเจกต์ไหน ประเภทงานไหน ต้องถามฟิลด์อะไร
 *
 * เศษหนึ่งส่วนสามสุดท้ายของเกณฑ์ผ่าน Phase 0 ข้อแรก · ห้าฟิลด์ที่มีอยู่ตอนนี้
 * มาจาก Spike B ทั้งหมด และ `field_config` 16 แถวก็ตั้งด้วย SQL
 *
 * ⚠️ **คีย์ของฟิลด์แก้ไม่ได้** — มันคือคีย์ใน `field_snapshot` ของงานทุกใบ
 * ที่เคยกรอกฟิลด์นั้น การเปลี่ยนคีย์ทำให้ค่าที่เก็บไว้กลายเป็นค่ากำพร้าเงียบ ๆ
 * จึงตรวจตอนสร้างเท่านั้น และไม่มีทางแก้ทีหลัง
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

/** ชนิดที่ `field.service` แปลงลงคอลัมน์ได้จริง — ตรงกับ enum `FieldType` */
export const FIELD_TYPES = [
  'TEXT',
  'TEXTAREA',
  'RICH_TEXT',
  'NUMBER',
  'DECIMAL',
  'DATE',
  'DATETIME',
  'CHECKBOX',
  'SELECT',
  'MULTI_SELECT',
  'USER',
  'MULTI_USER',
  'LABELS',
  'URL',
] as const;
export type FieldTypeName = (typeof FIELD_TYPES)[number];

/** ชนิดที่ต้องมีรายการตัวเลือก */
const OPTION_TYPES = new Set<FieldTypeName>(['SELECT', 'MULTI_SELECT']);
const MIN_OPTIONS = 2;

export class InvalidFieldKeyError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidFieldKeyError';
  }
}

export class DuplicateFieldError extends Error {
  constructor(readonly given: string) {
    super(`มีฟิลด์คีย์ "${given}" อยู่แล้ว`);
    this.name = 'DuplicateFieldError';
  }
}

export class FieldNotFoundError extends Error {
  constructor(id: bigint) {
    super(`ไม่พบฟิลด์ #${id.toString()}`);
    this.name = 'FieldNotFoundError';
  }
}

export class OptionsRequiredError extends Error {
  constructor(readonly type: string) {
    super(
      `ฟิลด์ชนิด ${type} ต้องมีตัวเลือกอย่างน้อย ${String(MIN_OPTIONS)} รายการ — ` +
        'ช่องเลือกที่ไม่มีอะไรให้เลือกคือช่องที่กรอกไม่ได้ และไม่มี error บอกด้วย',
    );
    this.name = 'OptionsRequiredError';
  }
}

export class OptionInUseError extends Error {
  constructor(
    readonly option: string,
    readonly count: number,
  ) {
    super(
      `ลบตัวเลือก "${option}" ไม่ได้ — มีงาน ${String(count)} เรื่องเลือกค่านี้ไว้ ` +
        'ลบแล้วค่าที่เก็บไว้จะไม่ตรงกับตัวเลือกใด และรายงานจะมีกลุ่มที่ไม่มีชื่อ',
    );
    this.name = 'OptionInUseError';
  }
}

export class FieldInUseError extends Error {
  constructor(
    readonly fieldName: string,
    readonly valueCount: number,
    readonly configCount: number,
  ) {
    super(
      `ลบฟิลด์ "${fieldName}" ไม่ได้ — มีค่าที่กรอกไว้ ${String(valueCount)} รายการ ` +
        `และตั้งใช้อยู่ใน ${String(configCount)} ที่`,
    );
    this.name = 'FieldInUseError';
  }
}

export class SystemFieldError extends Error {
  constructor(readonly fieldName: string) {
    super(`"${fieldName}" เป็นฟิลด์ของระบบ ลบไม่ได้`);
    this.name = 'SystemFieldError';
  }
}

/**
 * คีย์ของฟิลด์ — ตัวพิมพ์เล็ก ตัวเลข และขีดล่าง
 *
 * เป็นคีย์ใน `field_snapshot` (JSON) และใน HQL วันหนึ่ง · ภาษาไทยและช่องว่าง
 * ใช้ไม่ได้เพราะต้องพิมพ์ในคิวรีได้โดยไม่ต้องครอบเครื่องหมายคำพูด
 */
export function normalizeFieldKey(raw: unknown): string {
  const key = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
  if (key.length < 2) throw new InvalidFieldKeyError('คีย์ต้องยาวอย่างน้อย 2 ตัวอักษร');
  if (key.length > 64) throw new InvalidFieldKeyError('คีย์ต้องยาวไม่เกิน 64 ตัวอักษร');
  if (!/^[a-z][a-z0-9_]*$/.test(key)) {
    throw new InvalidFieldKeyError('คีย์ใช้ได้เฉพาะ a–z, 0–9 และ _ และต้องขึ้นต้นด้วยตัวอักษร');
  }
  return key;
}

function cleanOptions(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const v of list) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s !== '' && !out.includes(s)) out.push(s);
  }
  return out;
}

export interface FieldRow {
  id: string;
  key: string;
  name: string;
  type: string;
  isSystem: boolean;
  options: string[];
  valueCount: number;
  /** ตั้งใช้อยู่กี่ที่ — (โปรเจกต์ × ประเภทงาน) */
  configCount: number;
}

/** อ่านตัวเลือกจากรูปร่างที่เก็บจริง `{"values": [...]}` (ดู field-form.service) */
function storedOptions(raw: unknown): string[] {
  const list = raw !== null && typeof raw === 'object' && 'values' in raw ? raw.values : raw;
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
}

export async function listFields(ctx: TenantContext): Promise<FieldRow[]> {
  const rows = await tenantScoped(ctx).fieldDefinition.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { values: true, configs: true } } },
  });
  return rows.map((f) => ({
    id: f.id.toString(),
    key: f.key,
    name: f.name,
    type: f.type,
    isSystem: f.isSystem,
    options: storedOptions(f.options),
    valueCount: f._count.values,
    configCount: f._count.configs,
  }));
}

export async function createField(
  ctx: TenantContext,
  input: { key: string; name: string; type: FieldTypeName; options?: unknown },
): Promise<{ id: bigint; key: string }> {
  const db = tenantScoped(ctx);
  const key = normalizeFieldKey(input.key);
  const name = (typeof input.name === 'string' ? input.name : '').trim().slice(0, 255);
  if (name === '') throw new InvalidFieldKeyError('ต้องระบุชื่อฟิลด์ที่ผู้ใช้จะเห็น');
  if (!FIELD_TYPES.includes(input.type)) throw new InvalidFieldKeyError('ชนิดฟิลด์ที่ระบบไม่รู้จัก');

  const options = cleanOptions(input.options);
  // ช่องเลือกที่ไม่มีตัวเลือกคือช่องที่กรอกไม่ได้ — เจอมาแล้วตอนอ่านรูปร่าง JSON ผิด
  if (OPTION_TYPES.has(input.type) && options.length < MIN_OPTIONS) {
    throw new OptionsRequiredError(input.type);
  }

  if ((await db.fieldDefinition.findFirst({ where: { key }, select: { id: true } })) !== null) {
    throw new DuplicateFieldError(key);
  }

  return auditedTransaction(ctx, 'field.create', async (tx) => {
    const f = await tx.fieldDefinition.create({
      data: {
        tenantId: ctx.tenantId,
        key,
        name,
        type: input.type,
        // เก็บรูปร่างเดียวกับที่ Spike B เก็บไว้ ไม่ใช่ array เปล่า ๆ
        options: OPTION_TYPES.has(input.type) ? { values: options } : undefined,
        isSystem: false,
      },
      select: { id: true, key: true },
    });
    return {
      result: f,
      audit: [
        {
          kind: 'system',
          action: 'field.create',
          entityType: 'field_definition',
          entityId: f.id.toString(),
          payload: { key, name, type: input.type, options },
        },
      ],
    };
  });
}

/**
 * แก้รายการตัวเลือก
 *
 * เพิ่มได้เสมอ · **ลบได้เฉพาะตัวเลือกที่ไม่มีงานไหนเลือกไว้** — ลบตัวที่ใช้อยู่
 * ทำให้ค่าที่เก็บไว้ไม่ตรงกับตัวเลือกใดเลย และ `prepareFieldValues` จะปฏิเสธ
 * การแก้ไขงานใบนั้นทุกครั้งหลังจากนั้น โดยที่ผู้ใช้ไม่ได้ทำอะไรผิด
 */
export async function setFieldOptions(
  ctx: TenantContext,
  fieldId: bigint,
  raw: unknown,
): Promise<void> {
  const db = tenantScoped(ctx);
  const f = await db.fieldDefinition.findFirst({ where: { id: fieldId } });
  if (f === null) throw new FieldNotFoundError(fieldId);
  // ชนิดจาก Prisma กับ FieldTypeName เป็น union เดียวกัน — cast ตรงนี้จึงไม่เปลี่ยนอะไร
  if (!OPTION_TYPES.has(f.type)) {
    throw new OptionsRequiredError(`${f.type} (ไม่ใช่ชนิดที่มีตัวเลือก)`);
  }

  const next = cleanOptions(raw);
  if (next.length < MIN_OPTIONS) throw new OptionsRequiredError(f.type);

  const before = storedOptions(f.options);
  for (const gone of before.filter((o) => !next.includes(o))) {
    const used = await db.workItemFieldValue.count({ where: { fieldId, valueText: gone } });
    if (used > 0) throw new OptionInUseError(gone, used);
  }

  await auditedTransaction(ctx, 'field.options', async (tx) => {
    await tx.fieldDefinition.update({ where: { id: fieldId }, data: { options: { values: next } } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'field.options',
          entityType: 'field_definition',
          entityId: fieldId.toString(),
          payload: { field: f.name, from: before, to: next },
        },
      ],
    };
  });
}

export async function removeField(ctx: TenantContext, fieldId: bigint): Promise<void> {
  const db = tenantScoped(ctx);
  const f = await db.fieldDefinition.findFirst({ where: { id: fieldId } });
  if (f === null) throw new FieldNotFoundError(fieldId);
  if (f.isSystem) throw new SystemFieldError(f.name);

  const [values, configs] = await Promise.all([
    db.workItemFieldValue.count({ where: { fieldId } }),
    db.fieldConfig.count({ where: { fieldId } }),
  ]);
  // ค่าที่กรอกไว้หายไปพร้อมฟิลด์ (onDelete: Cascade) และไม่มีทางกู้
  if (values > 0 || configs > 0) throw new FieldInUseError(f.name, values, configs);

  await auditedTransaction(ctx, 'field.remove', async (tx) => {
    await tx.fieldDefinition.delete({ where: { id: fieldId } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'field.remove',
          entityType: 'field_definition',
          entityId: fieldId.toString(),
          payload: { key: f.key, name: f.name },
        },
      ],
    };
  });
}

// ============================================================
// ตั้งว่าโปรเจกต์ไหนถามฟิลด์อะไร
// ============================================================

export async function setFieldConfig(
  ctx: TenantContext,
  input: {
    projectId: bigint;
    issueTypeId: bigint;
    fieldId: bigint;
    isRequired: boolean;
    isVisible: boolean;
  },
): Promise<{ changed: boolean }> {
  const db = tenantScoped(ctx);
  const f = await db.fieldDefinition.findFirst({
    where: { id: input.fieldId },
    select: { id: true, name: true },
  });
  if (f === null) throw new FieldNotFoundError(input.fieldId);

  const existing = await db.fieldConfig.findFirst({
    where: {
      projectId: input.projectId,
      issueTypeId: input.issueTypeId,
      fieldId: input.fieldId,
    },
  });
  if (
    existing !== null &&
    existing.isRequired === input.isRequired &&
    existing.isVisible === input.isVisible
  ) {
    return { changed: false };
  }

  const last = await db.fieldConfig.findFirst({
    where: { projectId: input.projectId, issueTypeId: input.issueTypeId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  await auditedTransaction(ctx, 'field.config', async (tx) => {
    if (existing === null) {
      await tx.fieldConfig.create({
        data: {
          tenantId: ctx.tenantId,
          projectId: input.projectId,
          issueTypeId: input.issueTypeId,
          fieldId: input.fieldId,
          isRequired: input.isRequired,
          isVisible: input.isVisible,
          position: (last?.position ?? -1) + 1,
        },
      });
    } else {
      await tx.fieldConfig.update({
        where: { id: existing.id },
        data: { isRequired: input.isRequired, isVisible: input.isVisible },
      });
    }
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'field.config',
          entityType: 'field_definition',
          entityId: input.fieldId.toString(),
          payload: {
            field: f.name,
            isRequired: input.isRequired,
            isVisible: input.isVisible,
          },
        },
      ],
    };
  });
  return { changed: true };
}

/**
 * ถอนฟิลด์ออกจาก (โปรเจกต์ × ประเภทงาน)
 *
 * **ค่าที่กรอกไว้แล้วไม่ถูกลบ** — ถอนคือการเลิกถาม ไม่ใช่การลบคำตอบเก่า
 * ค่าจะยังอยู่ใน EAV และ snapshot แต่ไม่แสดงบนหน้าจอ เพราะหน้าจออ่านจาก
 * `field_config` · ถ้าผูกกลับมาใหม่ ค่าเดิมจะกลับมาแสดงเอง
 */
export async function removeFieldConfig(
  ctx: TenantContext,
  projectId: bigint,
  issueTypeId: bigint,
  fieldId: bigint,
): Promise<void> {
  const db = tenantScoped(ctx);
  const cfg = await db.fieldConfig.findFirst({
    where: { projectId, issueTypeId, fieldId },
    include: { field: { select: { name: true } } },
  });
  if (cfg === null) throw new FieldNotFoundError(fieldId);

  await auditedTransaction(ctx, 'field.config.remove', async (tx) => {
    await tx.fieldConfig.delete({ where: { id: cfg.id } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'field.config.remove',
          entityType: 'field_definition',
          entityId: fieldId.toString(),
          payload: { field: cfg.field.name },
        },
      ],
    };
  });
}
