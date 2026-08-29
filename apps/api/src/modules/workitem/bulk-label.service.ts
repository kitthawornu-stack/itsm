/**
 * ติดและถอดป้ายกำกับหลายเรื่องพร้อมกัน
 *
 * ## เพิ่ม/เอาออก ไม่ใช่เขียนทับ
 *
 * `setFieldValues` เขียนทับทั้งชุดโดยตั้งใจ ซึ่งถูกสำหรับฟอร์มแก้ไขทีละใบ
 * ที่ผู้ใช้เห็นค่าเดิมอยู่ตรงหน้า · **แต่ผิดสำหรับการทำเป็นชุด** — คนที่เลือก
 * 30 ใบแล้วพิมพ์ป้าย "ด่วน" ตั้งใจจะ *เพิ่ม* ป้ายนั้น ไม่ได้ตั้งใจลบป้ายเดิม
 * ของทั้ง 30 ใบทิ้ง · และเขาจะไม่รู้ว่าลบไปแล้วจนกว่าจะมีคนมาถามหาป้ายเก่า
 *
 * ## อ่านจาก EAV ไม่ใช่ snapshot
 *
 * `fieldSnapshot` เป็นสำเนาอ่านอย่างเดียวสำหรับเรนเดอร์ลิสต์ (ADR-001) ·
 * ค่าที่จะเอาไปเขียนต่อต้องมาจาก EAV เสมอ — ถ้า snapshot ไม่ตรงกับ EAV
 * (ซึ่งเป็นความเสี่ยงที่ ADR-001 ยอมรับไว้และมี job ตรวจ) การเขียนกลับจาก
 * snapshot จะทำให้ความไม่ตรงกันกลายเป็นความจริงถาวร
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction, change } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { readFieldValues, setFieldValues } from '../field';
import { assertCan, browsableProjectIds } from '../permission';
import { indexWorkItem } from '../search-index';
import { BULK_MAX, BulkTooManyItemsError, NothingSelectedError } from './bulk-edit.service';

export class NotALabelFieldError extends Error {
  constructor() {
    super('ฟิลด์ที่เลือกไม่ใช่ป้ายกำกับ');
    this.name = 'NotALabelFieldError';
  }
}

export interface BulkLabelChanges {
  /** ฟิลด์ชนิด `LABELS` ที่จะแก้ — ระบุเสมอ เพราะมีได้หลายฟิลด์ */
  fieldId: bigint;
  add?: readonly string[];
  remove?: readonly string[];
}

export interface BulkLabelItemResult {
  itemKey: string;
  outcome: 'changed' | 'unchanged' | 'not-found' | 'failed';
  labels?: string[];
  reason?: string;
}

export interface BulkLabelResult {
  requested: number;
  changed: number;
  unchanged: number;
  failed: number;
  items: BulkLabelItemResult[];
}

/** ตัดช่องว่างหัวท้าย ทิ้งค่าว่าง และตัดซ้ำ — กติกาเดียวกับตอนเข้าดัชนี */
function clean(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const t = v.trim();
    if (t !== '') out.add(t);
  }
  return [...out];
}

/**
 * ติด/ถอดป้ายหลายเรื่องพร้อมกัน
 *
 * ต้องมีทั้ง `BULK_EDIT` และ `EDIT_ITEM` — ป้ายเป็นค่าของงาน การแก้มันคือ
 * การแก้งาน ไม่ใช่การจัดหมวดหมู่ที่แยกออกไปต่างหาก
 */
export async function bulkEditLabels(
  ctx: TenantContext,
  itemKeys: readonly string[],
  changes: BulkLabelChanges,
): Promise<BulkLabelResult> {
  const add = clean(changes.add ?? []);
  const remove = clean(changes.remove ?? []);
  if (add.length === 0 && remove.length === 0) {
    throw new NothingSelectedError('ยังไม่ได้ระบุป้ายที่จะเพิ่มหรือเอาออก');
  }

  const keys = [...new Set(itemKeys.map((k) => k.trim()).filter((k) => k !== ''))];
  if (keys.length === 0) throw new NothingSelectedError();
  // ปฏิเสธทั้งชุด ไม่ตัดเงียบ ๆ — ตัดเงียบแปลว่าผู้ใช้เชื่อว่าทำครบแล้ว
  if (keys.length > BULK_MAX) throw new BulkTooManyItemsError(keys.length);

  const db = tenantScoped(ctx);

  /*
    ฟิลด์ต้องเป็นชนิด `LABELS` จริง

    ถ้าไม่ตรวจ ผู้เรียกจะส่ง id ของฟิลด์ข้อความมาแล้วเขียนค่าหลายค่าลงไป
    ซึ่งฟิลด์ค่าเดี่ยวจะเก็บได้แค่ค่าแรก · ค่าที่เหลือหายไปเงียบ ๆ
    และไม่มีอะไรบอกว่าเกิดขึ้น
  */
  const field = await db.fieldDefinition.findFirst({
    where: { id: changes.fieldId },
    select: { id: true, key: true, type: true },
  });
  if (field === null || field.type !== 'LABELS') throw new NotALabelFieldError();

  const allowed = await browsableProjectIds(ctx);
  const items =
    allowed.length === 0
      ? []
      : await db.workItem.findMany({
          where: { itemKey: { in: keys }, projectId: { in: allowed } },
          select: { id: true, itemKey: true, projectId: true, issueTypeId: true },
        });

  // ตรวจสิทธิ์ก่อนแตะใบไหน และตรวจทุกโปรเจกต์ที่ชุดนี้แตะ
  const projectIds = [...new Set(items.map((i) => i.projectId.toString()))].map((s) => BigInt(s));
  for (const pid of projectIds) {
    await assertCan(ctx, pid, 'BULK_EDIT');
    await assertCan(ctx, pid, 'EDIT_ITEM');
  }

  const byKey = new Map(items.map((i) => [i.itemKey, i]));
  const results: BulkLabelItemResult[] = [];

  for (const key of keys) {
    const item = byKey.get(key);
    if (item === undefined) {
      results.push({ itemKey: key, outcome: 'not-found' });
      continue;
    }

    try {
      /*
        ฟิลด์ต้องถูกตั้งให้โปรเจกต์และประเภทงานนี้ถามด้วย

        เขียนค่าลงฟิลด์ที่โปรเจกต์นั้นไม่ได้ใช้ จะได้ข้อมูลที่ไม่มีหน้าจอไหน
        แสดง — คนติดป้ายแล้วเปิดดูไม่เห็น จึงติดซ้ำอีกรอบ
      */
      const configured = await db.fieldConfig.findFirst({
        where: { projectId: item.projectId, issueTypeId: item.issueTypeId, fieldId: field.id },
        select: { id: true },
      });
      if (configured === null) {
        results.push({
          itemKey: key,
          outcome: 'failed',
          reason: 'โปรเจกต์นี้ไม่ได้ใช้ฟิลด์ป้ายนี้',
        });
        continue;
      }

      // อ่านจาก EAV ไม่ใช่ snapshot — ค่าที่จะเอาไปเขียนต่อต้องมาจากแหล่งความจริง
      const current = await readFieldValues(ctx, item.id);
      const raw = current[field.key];
      const before = clean(
        (Array.isArray(raw) ? raw : [raw]).filter((v): v is string => typeof v === 'string'),
      );

      /*
        เอาออกก่อน แล้วค่อยเพิ่ม

        ถ้าป้ายเดียวกันอยู่ทั้งสองฝั่ง เจตนาที่อ่านง่ายที่สุดคือ "ให้มันอยู่"
        — ผู้ใช้ที่พิมพ์ผิดสองช่องควรได้ผลที่คาดเดาได้ ไม่ใช่ผลที่ขึ้นกับลำดับ
      */
      const next = [...new Set([...before.filter((l) => !remove.includes(l)), ...add])].sort();

      /*
        เทียบด้วย JSON ไม่ใช่ join ด้วยตัวคั่น

        ป้ายมีอักขระอะไรก็ได้ · ตัวคั่นที่เลือกเองจะทำให้ `["a b"]` กับ
        `["a","b"]` ดูเท่ากัน แล้วการแก้จริงจะถูกมองว่า "ไม่มีอะไรเปลี่ยน"
      */
      if (JSON.stringify(next) === JSON.stringify([...before].sort())) {
        // ตั้งค่าเดิมซ้ำ = ไม่เขียนอะไรเลย · ประวัติที่รกเท่ากับไม่มีประวัติ
        results.push({ itemKey: key, outcome: 'unchanged', labels: next });
        continue;
      }

      await setFieldValues(ctx, item.id, [
        { fieldId: field.id, type: 'LABELS', value: next },
      ]);

      /*
        เขียนประวัติเอง — **`setFieldValues` ไม่เขียนให้**

        มันใช้ `tenantTransaction` ไม่ใช่ `auditedTransaction` ผลคือการแก้ค่า
        ฟิลด์เพิ่มเติมไม่เคยปรากฏในไทม์ไลน์เลย (ตรวจฐานข้อมูลจริงแล้ว: แถวที่
        ไม่ใช่ฟิลด์ built-in มีแต่ `summary`) — เป็นช่องโหว่ของ INVARIANT 2
        ที่มีมาก่อนไฟล์นี้ และต้องแก้ที่ต้นทางเป็นงานแยก เพราะแตะขอบเขต
        ทรานแซกชันที่ ADR-001 กำหนดไว้

        ที่นี่จึงเขียนเอง เพื่อไม่ให้เส้นทางใหม่สืบทอดช่องโหว่นั้นต่อ
      */
      await auditedTransaction(ctx, 'workitem.labels', () =>
        /*
          ไม่มีอะไรต้องเขียนในทรานแซกชันนี้นอกจากประวัติ — ค่าฟิลด์ถูกเขียน
          ไปแล้วโดย `setFieldValues` ซึ่งมีทรานแซกชันของตัวเอง (ADR-001)
          จึงคืน Promise ตรง ๆ แทนที่จะประกาศ async แล้วไม่ await อะไรเลย
        */
        Promise.resolve({
          result: undefined,
          audit: [change(item.id, field.key, before.join(', '), next.join(', '))],
        }),
      );
      // ดัชนีตามหลังได้ · ล้มที่นี่ไม่ควรทำให้การแก้ที่สำเร็จแล้วดูเหมือนล้ม
      await indexWorkItem(ctx, item.id).catch(() => undefined);
      results.push({ itemKey: key, outcome: 'changed', labels: next });
    } catch (e) {
      results.push({
        itemKey: key,
        outcome: 'failed',
        reason: e instanceof Error ? e.message : 'ติดป้ายไม่สำเร็จ',
      });
    }
  }

  return {
    requested: keys.length,
    changed: results.filter((r) => r.outcome === 'changed').length,
    unchanged: results.filter((r) => r.outcome === 'unchanged').length,
    failed: results.filter((r) => r.outcome === 'not-found' || r.outcome === 'failed').length,
    items: results,
  };
}

/** ฟิลด์ชนิด `LABELS` ที่มีอยู่ — ให้หน้าจอเลือกได้ว่าจะแก้ฟิลด์ไหน */
export async function labelFields(
  ctx: TenantContext,
): Promise<Array<{ id: string; name: string }>> {
  const rows = await tenantScoped(ctx).fieldDefinition.findMany({
    where: { type: 'LABELS' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return rows.map((r) => ({ id: r.id.toString(), name: r.name }));
}
