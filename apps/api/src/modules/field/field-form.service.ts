/**
 * ฟิลด์ที่หน้าจอต้องถาม และการรับค่าที่กรอกมา
 *
 * `field_config` มี 16 แถวในฐานข้อมูลตั้งแต่ Spike B · สี่ฟิลด์ต่อประเภทงาน
 * ของโปรเจกต์ SD และ **สองในนั้นตั้งเป็น `is_required`**
 *
 * แต่ `work_item_field_value` มี **0 แถว** — ฟอร์มแจ้งเรื่องไม่เคยถามฟิลด์เหล่านี้
 * และไม่มีอะไรตรวจ `is_required` เลย · ตั้งค่าไว้ครบแล้วไม่มีใครเรียกใช้
 * เป็นรูปแบบเดียวกับ `work_item_comment` และ `permission_scheme` ตอนก่อนหน้านี้
 */
import type { TenantContext } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { setFieldValues, type FieldValueInput, type ScalarValue } from './field.service';

export class RequiredFieldsMissingError extends Error {
  constructor(readonly fields: string[]) {
    super(`ยังไม่ได้กรอก: ${fields.join(', ')}`);
    this.name = 'RequiredFieldsMissingError';
  }
}

export class UnknownFieldOptionError extends Error {
  constructor(
    readonly fieldName: string,
    readonly given: string,
  ) {
    super(`"${given}" ไม่ใช่ตัวเลือกของฟิลด์ "${fieldName}"`);
    this.name = 'UnknownFieldOptionError';
  }
}

export interface FormField {
  key: string;
  name: string;
  type: string;
  isRequired: boolean;
  /** ตัวเลือกของ SELECT / MULTI_SELECT — รายการว่างเมื่อไม่ใช่ชนิดนั้น */
  options: string[];
}

/**
 * อ่านตัวเลือกจากคอลัมน์ JSON
 *
 * รูปร่างที่เก็บอยู่จริงคือ `{"values": ["ทั้งองค์กร", "ทั้งแผนก", ...]}`
 * ไม่ใช่ array เปล่า ๆ · เขียนตามข้อมูลจริง ไม่ใช่ตามที่คิดว่าน่าจะเป็น —
 * ครั้งแรกเดาว่าเป็น array แล้วได้รายการว่างทุกฟิลด์ ซึ่งจะกลายเป็นช่องเลือก
 * ที่ไม่มีอะไรให้เลือกบนหน้าจอจริง โดยไม่มี error ที่ไหน
 *
 * คอลัมน์เป็น JSON ฐานข้อมูลจึงไม่รับประกันรูปร่าง — กรองเอาเฉพาะข้อความ
 */
function optionsOf(raw: unknown): string[] {
  const list = raw !== null && typeof raw === 'object' && 'values' in raw ? raw.values : raw;
  if (!Array.isArray(list)) return [];
  return list.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

/**
 * ฟิลด์ที่ต้องแสดงบนฟอร์มของ (โปรเจกต์ × ประเภทงาน)
 *
 * เรียงตาม `position` ที่ผู้ดูแลตั้งไว้ · ฟิลด์ที่ `isVisible = false` ไม่ถูกส่งมา
 * — ซ่อนไว้แปลว่าไม่ต้องถาม ไม่ใช่ถามแล้วซ่อนคำตอบ
 */
export async function formFieldsFor(
  ctx: TenantContext,
  projectId: bigint,
  issueTypeId: bigint,
): Promise<FormField[]> {
  const rows = await tenantScoped(ctx).fieldConfig.findMany({
    where: { projectId, issueTypeId, isVisible: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    include: { field: true },
  });
  return rows.map((c) => ({
    key: c.field.key,
    name: c.field.name,
    type: c.field.type,
    isRequired: c.isRequired,
    options: optionsOf(c.field.options),
  }));
}

/**
 * ตรวจค่าที่กรอกมา แล้วแปลงเป็นรูปที่ `setFieldValues` รับ
 *
 * แยกจากการเขียนโดยตั้งใจ — ผู้เรียกต้องตรวจ **ก่อน** สร้างงาน ไม่ใช่สร้างแล้ว
 * ค่อยพบว่าฟิลด์บังคับยังว่าง ซึ่งจะได้ตั๋วที่ไม่ครบค้างอยู่ในระบบ
 */
export async function prepareFieldValues(
  ctx: TenantContext,
  projectId: bigint,
  issueTypeId: bigint,
  submitted: Record<string, unknown>,
): Promise<FieldValueInput[]> {
  const rows = await tenantScoped(ctx).fieldConfig.findMany({
    where: { projectId, issueTypeId, isVisible: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    include: { field: true },
  });

  const missing: string[] = [];
  const out: FieldValueInput[] = [];

  for (const c of rows) {
    const raw = submitted[c.field.key];
    const options = optionsOf(c.field.options);
    const values = toValues(raw);

    /**
     * ตัวเลือกที่ไม่มีอยู่ในรายการถูกปฏิเสธ ไม่ใช่เก็บไว้เฉย ๆ
     *
     * ค่าที่หลุดรายการมาได้แปลว่าฟอร์มกับฐานข้อมูลไม่ตรงกัน — เก็บไว้แล้ว
     * รายงานที่จัดกลุ่มตามฟิลด์นี้จะมีกลุ่มที่ไม่มีใครตั้งใจให้มี
     */
    if (options.length > 0) {
      for (const v of values) {
        if (typeof v === 'string' && !options.includes(v)) {
          throw new UnknownFieldOptionError(c.field.name, v);
        }
      }
    }

    if (c.isRequired && values.length === 0) {
      missing.push(c.field.name);
      continue;
    }
    // ฟิลด์ที่ไม่ได้กรอกและไม่บังคับ = ไม่เขียนอะไร ต่างจากเขียนค่าว่าง
    if (values.length === 0) continue;

    out.push({ fieldId: c.field.id, type: c.field.type, value: values });
  }

  if (missing.length > 0) throw new RequiredFieldsMissingError(missing);
  return out;
}

/**
 * ค่าที่ถือว่า "ยังไม่กรอก"
 *
 * ระวัง: `0` และ `false` **ถือว่ากรอกแล้ว** — falsy check ตรง ๆ ที่นี่คือบั๊ก
 * คลาสสิกที่ทำให้ฟิลด์ตัวเลขค่า 0 และ checkbox ที่ไม่ติ๊ก ถูกมองว่าว่าง
 * (กฎเดียวกับ `isEmpty` ใน workflow-engine)
 */
function toValues(raw: unknown): ScalarValue[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is ScalarValue => v !== null && v !== undefined && v !== '');
  }
  if (typeof raw === 'string') return raw.trim() === '' ? [] : [raw.trim()];
  if (typeof raw === 'number' || typeof raw === 'boolean') return [raw];
  return [];
}

/** เขียนค่าที่เตรียมไว้ — ห่อ `setFieldValues` ไว้เพื่อให้ผู้เรียกไม่ต้องรู้จัก EAV */
export async function saveFieldValues(
  ctx: TenantContext,
  workItemId: bigint,
  inputs: FieldValueInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  await setFieldValues(ctx, workItemId, inputs);
}

/**
 * ค่าฟิลด์ของงานหนึ่งใบ สำหรับแสดงผล
 *
 * อ่านจาก `field_snapshot` ตามที่ ADR-001 กำหนด — เร็วกว่า JOIN EAV 7.4 เท่า
 * และ **ห้ามอ่านไปเขียนต่อ** (CLAUDE.md §3) ที่นี่จึงเป็นทางอ่านอย่างเดียว
 */
export async function displayFieldsFor(
  ctx: TenantContext,
  projectId: bigint,
  issueTypeId: bigint,
  snapshot: unknown,
): Promise<Array<{ name: string; value: string }>> {
  const fields = await formFieldsFor(ctx, projectId, issueTypeId);
  const snap = (snapshot !== null && typeof snapshot === 'object' ? snapshot : {}) as Record<
    string,
    unknown
  >;

  const out: Array<{ name: string; value: string }> = [];
  for (const f of fields) {
    const v = snap[f.key];
    const text = Array.isArray(v) ? v.map(asText).filter((t) => t !== '').join(' · ') : asText(v);
    if (text === '') continue;
    out.push({ name: f.name, value: text });
  }
  return out;
}

/**
 * ค่าหนึ่งค่าเป็นข้อความ
 *
 * ไม่ใช้ `String(v)` ตรง ๆ — object จะกลายเป็น `[object Object]` บนหน้าจอผู้ใช้
 * ซึ่งเป็นกับดักเดียวกับที่ `change()` ใน audited-transaction บันทึกไว้
 * snapshot มาจากคอลัมน์ JSON รูปร่างจึงไม่รับประกัน
 */
function asText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // ค่าที่ไม่ใช่ scalar แปลว่าข้อมูลผิดรูป — ไม่แสดงดีกว่าแสดงขยะ
  return '';
}
