/**
 * Custom Field — EAV + JSON snapshot (ADR-001)
 *
 * **แหล่งความจริงคือ `work_item_field_value` (EAV) เสมอ**
 * `work_item.field_snapshot` เป็นสำเนาอ่านอย่างเดียวสำหรับเรนเดอร์ลิสต์
 * โดยไม่ต้อง JOIN — สร้างใหม่จาก EAV ได้ตลอดเวลา
 *
 * กติกาที่ห้ามละเมิด (CLAUDE.md §3):
 *   - ห้ามอ่าน snapshot ไปเขียนต่อ — เขียนต้องผ่าน EAV เสมอ
 *   - snapshot เขียนในทรานแซกชันเดียวกับ EAV ห้ามแยก
 *   - ถ้าสองที่ไม่ตรงกัน EAV ถูกเสมอ ให้ rebuild snapshot
 *
 * ทำไมแยกคอลัมน์ตามชนิด ไม่ยัดทุกอย่างเป็นข้อความ:
 * ถ้าเก็บตัวเลขเป็น VARCHAR การเรียงจะได้ลำดับพจนานุกรม (9 มาหลัง 42)
 * และการเทียบช่วง (`> 100`) จะใช้ index ไม่ได้
 */
import type { FieldType } from '@prisma/client';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../../infrastructure/prisma/client';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

export type ScalarValue = string | number | boolean | bigint | null;

export interface FieldValueInput {
  fieldId: bigint;
  type: FieldType;
  /** ค่าเดี่ยว หรือรายการสำหรับฟิลด์หลายค่า */
  value: ScalarValue | ScalarValue[];
}

export class UnsupportedFieldTypeError extends Error {
  constructor(type: string) {
    super(`ยังไม่รองรับชนิดฟิลด์: ${type}`);
    this.name = 'UnsupportedFieldTypeError';
  }
}

/** ชนิดที่เก็บได้หลายค่า — ค่าอื่นเก็บแถวเดียวที่ position 0 */
const MULTI_VALUE_TYPES: ReadonlySet<FieldType> = new Set([
  'MULTI_SELECT',
  'MULTI_USER',
  'LABELS',
] as FieldType[]);

interface ColumnValues {
  valueText: string | null;
  valueNumber: number | null;
  valueDate: Date | null;
  valueBool: boolean | null;
  valueRefId: bigint | null;
}

const EMPTY: ColumnValues = {
  valueText: null,
  valueNumber: null,
  valueDate: null,
  valueBool: null,
  valueRefId: null,
};

/** แปลงค่าหนึ่งค่าไปลงคอลัมน์ที่ถูกชนิด */
function toColumns(type: FieldType, value: ScalarValue): ColumnValues {
  switch (type) {
    case 'TEXT':
    case 'TEXTAREA':
    case 'RICH_TEXT':
    case 'SELECT':
    case 'MULTI_SELECT':
    case 'LABELS':
    case 'URL':
      return { ...EMPTY, valueText: value === null ? null : String(value) };

    case 'NUMBER':
    case 'DECIMAL':
      return { ...EMPTY, valueNumber: value === null ? null : Number(value) };

    case 'DATE':
    case 'DATETIME':
      return { ...EMPTY, valueDate: value === null ? null : new Date(String(value)) };

    case 'CHECKBOX':
      return { ...EMPTY, valueBool: value === null ? null : Boolean(value) };

    case 'USER':
    case 'MULTI_USER':
      return { ...EMPTY, valueRefId: value === null ? null : BigInt(String(value)) };

    default:
      throw new UnsupportedFieldTypeError(type);
  }
}

/** แปลงแถว EAV กลับเป็นค่าที่ใช้งานได้ */
function fromRow(type: FieldType, row: ColumnValues): ScalarValue {
  switch (type) {
    case 'NUMBER':
    case 'DECIMAL':
      return row.valueNumber === null ? null : Number(row.valueNumber);
    case 'DATE':
    case 'DATETIME':
      return row.valueDate === null ? null : row.valueDate.toISOString();
    case 'CHECKBOX':
      return row.valueBool;
    case 'USER':
    case 'MULTI_USER':
      return row.valueRefId === null ? null : row.valueRefId.toString();
    default:
      return row.valueText;
  }
}

function normalise(input: FieldValueInput): ScalarValue[] {
  if (Array.isArray(input.value)) return input.value;
  return input.value === null ? [] : [input.value];
}

/**
 * เขียนค่าฟิลด์ — ลบของเดิมของฟิลด์นั้นทิ้งแล้วเขียนใหม่ทั้งชุด
 *
 * เขียนทับ ไม่ใช่เพิ่มต่อท้าย · รายการว่างหมายถึงลบค่าทั้งหมดของฟิลด์นั้น
 * EAV และ snapshot เขียนในทรานแซกชันเดียวกัน
 */
export async function setFieldValues(
  ctx: TenantContext,
  workItemId: bigint,
  inputs: FieldValueInput[],
): Promise<void> {
  await prismaClient.$transaction(async (tx) => {
    const item = await tx.workItem.findFirst({
      where: { id: workItemId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (item === null) throw new Error(`ไม่พบงาน #${workItemId.toString()} ใน tenant นี้`);

    for (const input of inputs) {
      await tx.workItemFieldValue.deleteMany({
        where: { workItemId, fieldId: input.fieldId, tenantId: ctx.tenantId },
      });

      const values = normalise(input);
      if (values.length === 0) continue;
      const slice = MULTI_VALUE_TYPES.has(input.type) ? values : values.slice(0, 1);

      await tx.workItemFieldValue.createMany({
        data: slice.map((v, position) => ({
          tenantId: ctx.tenantId,
          workItemId,
          fieldId: input.fieldId,
          position,
          ...toColumns(input.type, v),
        })),
      });
    }

    await writeSnapshot(tx, ctx, workItemId);
  });
}

type Tx = Parameters<Parameters<typeof prismaClient.$transaction>[0]>[0];

/** สร้าง snapshot จาก EAV แล้วเขียนลง work_item — ใช้ในทรานแซกชันเดียวกับการเขียน EAV */
async function writeSnapshot(tx: Tx, ctx: TenantContext, workItemId: bigint): Promise<void> {
  const snapshot = await buildSnapshot(tx, ctx, workItemId);
  await tx.workItem.update({
    where: { id: workItemId },
    data: { fieldSnapshot: snapshot as never },
  });
}

async function buildSnapshot(
  tx: Tx,
  ctx: TenantContext,
  workItemId: bigint,
): Promise<Record<string, unknown>> {
  const rows = await tx.workItemFieldValue.findMany({
    where: { workItemId, tenantId: ctx.tenantId },
    include: { field: { select: { key: true, type: true } } },
    orderBy: [{ fieldId: 'asc' }, { position: 'asc' }],
  });

  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const value = fromRow(row.field.type, row);
    if (MULTI_VALUE_TYPES.has(row.field.type)) {
      const list = (out[row.field.key] as ScalarValue[] | undefined) ?? [];
      list.push(value);
      out[row.field.key] = list;
    } else {
      out[row.field.key] = value;
    }
  }
  return out;
}

/** อ่านค่าฟิลด์จาก **EAV** — ใช้เมื่อต้องการค่าที่ถูกต้องแน่นอน เช่น ก่อนเขียนทับ */
export async function readFieldValues(
  ctx: TenantContext,
  workItemId: bigint,
): Promise<Record<string, unknown>> {
  return buildSnapshot(prismaClient as unknown as Tx, ctx, workItemId);
}

export interface ConsistencyReport {
  checked: number;
  mismatched: string[];
}

/**
 * ตรวจว่า snapshot ตรงกับ EAV หรือไม่
 *
 * ADR-001 กำหนดให้มี job แบบนี้รันรายวัน — ความเสี่ยงที่ยอมรับไว้ของการเก็บสองที่
 * คือมันอาจไม่ตรงกัน จึงต้องมีตัวจับ ไม่ใช่หวังว่าจะไม่เกิด
 */
export async function checkSnapshotConsistency(
  ctx: TenantContext,
  workItemIds?: bigint[],
): Promise<ConsistencyReport> {
  const db = tenantScoped(ctx);
  const items = await db.workItem.findMany({
    ...(workItemIds === undefined ? {} : { where: { id: { in: workItemIds } } }),
    select: { id: true, fieldSnapshot: true },
    take: 5_000,
  });

  const mismatched: string[] = [];
  for (const item of items) {
    const expected = await buildSnapshot(prismaClient as unknown as Tx, ctx, item.id);
    const actual = (item.fieldSnapshot ?? {}) as Record<string, unknown>;
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      mismatched.push(item.id.toString());
    }
  }
  return { checked: items.length, mismatched };
}

/** สร้าง snapshot ใหม่จาก EAV — ปลอดภัยเสมอเพราะ EAV คือแหล่งความจริง */
export async function rebuildSnapshot(ctx: TenantContext, workItemIds: bigint[]): Promise<number> {
  let rebuilt = 0;
  for (const id of workItemIds) {
    await prismaClient.$transaction(async (tx) => {
      await writeSnapshot(tx, ctx, id);
    });
    rebuilt += 1;
  }
  return rebuilt;
}
