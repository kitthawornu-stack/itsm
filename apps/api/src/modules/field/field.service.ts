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
import type { FieldType, Prisma } from '@prisma/client';
import type { TenantContext } from '@itsm/types';

import {
  auditedTransaction,
  change,
  type AuditEntry,
} from '../../infrastructure/audit/audited-transaction';
import {
  tenantScoped,
  tenantTransaction,
  type TxScopedClient,
} from '../../infrastructure/prisma/tenant-scope';

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

/**
 * รูปแบบที่ **อ่านกลับมาจริง** จาก Prisma
 *
 * ต่างจาก ColumnValues ตรงที่คอลัมน์ DECIMAL คืนเป็น `Prisma.Decimal`
 * ไม่ใช่ `number` — ประกาศผิดในตอนแรกทำให้ ESLint มองว่า `Number()` ซ้ำซ้อน
 * พอเอาออกตามที่ lint บอก เทสต์พังทันทีเพราะได้ object กลับมาแทนตัวเลข
 *
 * บทเรียน: lint ตรวจตาม type ที่เราประกาศ ถ้า type โกหก lint ก็โกหกตาม
 */
interface RowValues extends Omit<ColumnValues, 'valueNumber'> {
  valueNumber: Prisma.Decimal | number | null;
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
function fromRow(type: FieldType, row: RowValues): ScalarValue {
  switch (type) {
    case 'NUMBER':
    case 'DECIMAL':
      // Prisma.Decimal ต้องแปลงเป็น number — ไม่ใช่การแปลงซ้ำซ้อน
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

/** ค่าฟิลด์หนึ่งตัวเป็นข้อความสำหรับประวัติ — รายการหลายค่าต่อด้วย ", " */
function historyText(values: ScalarValue[]): string | null {
  if (values.length === 0) return null;
  /*
    `ScalarValue` ไม่มี `Date` อยู่ในชนิด — วันที่ถูกแปลงเป็นสตริงมาก่อนแล้ว
    ตอนอ่านจาก EAV · การเขียน `instanceof Date` ตรงนี้จึงเป็นโค้ดที่ไม่มีทาง
    ทำงาน และ TypeScript ปฏิเสธให้เห็นทันที (ต่างจาก `as any` ที่จะกลบไว้)
  */
  return values.map((v) => (v === null ? '' : String(v))).join(', ');
}

/**
 * เขียนค่าฟิลด์ — ลบของเดิมของฟิลด์นั้นทิ้งแล้วเขียนใหม่ทั้งชุด
 *
 * เขียนทับ ไม่ใช่เพิ่มต่อท้าย · รายการว่างหมายถึงลบค่าทั้งหมดของฟิลด์นั้น
 * EAV · snapshot · **และประวัติ** เขียนในทรานแซกชันเดียวกัน
 *
 * ## ทำไมต้องเป็น `auditedTransaction`
 *
 * ฟังก์ชันนี้เคยใช้ `tenantTransaction` ธรรมดา ผลคือ **การแก้ค่าฟิลด์เพิ่มเติม
 * ไม่เคยปรากฏในไทม์ไลน์เลย** — ตรวจฐานข้อมูลจริงแล้ว แถวประวัติที่ไม่ใช่ฟิลด์
 * built-in มีแต่ `summary` เท่านั้น · เป็นการละเมิด INVARIANT 2 ที่เงียบสนิท
 * เพราะไม่มีอะไรบังคับให้ mutation เรียก `auditedTransaction`
 *
 * ในระบบ ITSM ที่ฟิลด์เพิ่มเติมเก็บผลกระทบ ความเร่งด่วน และบริการที่เกี่ยวข้อง
 * คำถาม "ใครเปลี่ยนผลกระทบจากต่ำเป็นสูง" คือคำถามที่ประวัติมีไว้ตอบพอดี
 *
 * **การเขียนค่าเดิมซ้ำจะไม่เขียนประวัติ และไม่เปิดทรานแซกชันเลย** —
 * `auditedTransaction` โยน `MissingAuditError` เมื่อรายการ audit ว่าง
 * ซึ่งถูกต้องสำหรับ mutation ที่ไม่เปลี่ยนอะไร: มันไม่ควรถูกเรียกตั้งแต่แรก
 */
export async function setFieldValues(
  ctx: TenantContext,
  workItemId: bigint,
  inputs: FieldValueInput[],
): Promise<void> {
  if (inputs.length === 0) return;

  /*
    อ่านค่าเดิมก่อนเปิดทรานแซกชัน เพื่อรู้ว่ามีอะไรเปลี่ยนจริงไหม

    ถ้าไม่มีอะไรเปลี่ยน จะไม่เปิดทรานแซกชันเลย — ประวัติที่รกเท่ากับไม่มีประวัติ
    และการเปิดทรานแซกชันเพื่อไม่เขียนอะไร คือการถือล็อกฟรี ๆ
  */
  const before = await readFieldValues(ctx, workItemId);
  const keys = await tenantScoped(ctx).fieldDefinition.findMany({
    where: { id: { in: inputs.map((i) => i.fieldId) } },
    select: { id: true, key: true },
  });
  const keyOf = new Map(keys.map((k) => [k.id.toString(), k.key]));

  const changes: AuditEntry[] = [];
  for (const input of inputs) {
    const key = keyOf.get(input.fieldId.toString());
    if (key === undefined) continue;
    const oldRaw = before[key];
    const oldValues = (Array.isArray(oldRaw) ? oldRaw : oldRaw === undefined ? [] : [oldRaw]) as
      ScalarValue[];
    const newValues = normalise(input);
    const oldText = historyText(oldValues);
    const newText = historyText(
      MULTI_VALUE_TYPES.has(input.type) ? newValues : newValues.slice(0, 1),
    );
    if (oldText === newText) continue;
    changes.push(change(workItemId, key, oldText, newText));
  }

  // ไม่มีอะไรเปลี่ยน = ไม่ต้องเขียนอะไรเลย
  if (changes.length === 0) return;

  await auditedTransaction(ctx, 'workitem.fields', async (tx) => {
    const item = await tx.workItem.findFirst({
      where: { id: workItemId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (item === null) throw new Error(`ไม่พบงาน #${workItemId.toString()} ใน tenant นี้`);

    for (const input of inputs) {
      /*
        **ลบด้วย id ที่หามาก่อน ไม่ใช่ลบด้วยเงื่อนไขช่วง**

        `deleteMany({ where: { workItemId, fieldId } })` ที่ไม่ตรงแถวไหนเลย
        (ซึ่งคือกรณีของงานที่เพิ่งสร้าง) ยังทำให้ MySQL จับ **gap lock**
        ถึง supremum ของ unique index `(work_item_id, field_id, position)` ·
        สองทรานแซกชันที่สร้างงานคนละใบพร้อมกัน จับ gap เดียวกันได้ทั้งคู่
        (gap lock เข้ากันได้) แล้วต่างฝ่ายต่างขอ insert intention ซึ่งชนกัน
        → **deadlock**

        วัดจริงด้วย `loadtest:write 5 6`: 10 จาก 30 คำขอตอบ HTTP 500 และ
        `SHOW ENGINE INNODB STATUS` ชี้มาที่ดัชนีนี้ตรง ๆ

        การอ่านด้วย SELECT ธรรมดาใน REPEATABLE READ เป็น consistent read
        จึงไม่จับล็อก · แล้วลบด้วย primary key ได้ record lock อย่างเดียว
        ไม่มี gap · พฤติกรรมเหมือนเดิมทุกประการ
      */
      const existing = await tx.workItemFieldValue.findMany({
        where: { workItemId, fieldId: input.fieldId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (existing.length > 0) {
        await tx.workItemFieldValue.deleteMany({
          where: { id: { in: existing.map((r) => r.id) } },
        });
      }

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
    return { result: undefined, audit: changes };
  });
}

type Tx = TxScopedClient;

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
  return tenantTransaction(ctx, async (tx) => buildSnapshot(tx, ctx, workItemId));
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
    const expected = await tenantTransaction(ctx, async (tx) => buildSnapshot(tx, ctx, item.id));
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
    await tenantTransaction(ctx, async (tx) => {
      await writeSnapshot(tx, ctx, id);
    });
    rebuilt += 1;
  }
  return rebuilt;
}
