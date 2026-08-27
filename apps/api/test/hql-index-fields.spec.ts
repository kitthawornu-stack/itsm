/**
 * ชื่อฟิลด์ที่ HQL อ้างถึง ต้องมีอยู่ในดัชนีจริง
 *
 * `packages/hql` เป็นฟังก์ชันบริสุทธิ์ ทดสอบตัวเองได้ครบทุกเคส **แต่มันไม่รู้จัก
 * ดัชนี** · เขียนรอบแรกด้วยการเดาชื่อฟิลด์ (`status`, `priority`, `issueType`)
 * ทั้งที่ mapping จริงเก็บเป็น `statusName`, `priorityRank`, `issueTypeName`
 *
 * คิวรีที่ชี้ไปยังฟิลด์ที่ไม่มีในดัชนี **ไม่ใช่ error ของ OpenSearch** —
 * มันแค่ไม่ตรงกับเอกสารไหนเลยและคืนศูนย์ผลลัพธ์ทุกครั้ง ซึ่งดูเหมือน
 * "ไม่มีข้อมูลตรงเงื่อนไข" ไม่ใช่ "ถามผิดฟิลด์"
 *
 * เทสต์นี้จึงเป็นสะพานเดียวที่จับความไม่ตรงกันของสองฝั่งได้
 */
import { describe, expect, it } from 'vitest';

import { INDEX_TARGETS, compile } from '@itsm/hql';
import { WORK_ITEM_INDEX_SETTINGS } from '../src/modules/search-index/index-mapping';

/** ชื่อฟิลด์ระดับบนสุดใน mapping */
function mappedFields(): Set<string> {
  const mapping = WORK_ITEM_INDEX_SETTINGS as unknown as {
    mappings: { properties: Record<string, unknown> };
  };
  return new Set(Object.keys(mapping.mappings.properties));
}

describe('HQL ↔ ดัชนี', () => {
  it('**ทุกฟิลด์ที่ HQL อ้างถึงมีอยู่ในดัชนีจริง**', () => {
    const mapped = mappedFields();
    const missing = INDEX_TARGETS.filter((t) => !mapped.has(t));
    // ถ้าแดง: แก้ `FIELDS` ใน packages/hql ให้ตรง mapping — อย่าแก้เทสต์
    expect(missing).toEqual([]);
  });

  it('ตัวตรวจหาเจอจริง — ไม่ใช่ผ่านเพราะอ่าน mapping ไม่ออก', () => {
    // เซ็ตว่างเทียบเซ็ตว่างจะเขียวเสมอ ต้องยืนยันว่าอ่าน mapping ได้จริง
    const mapped = mappedFields();
    expect(mapped.has('tenantId')).toBe(true);
    expect(mapped.has('summary')).toBe(true);
    expect(mapped.size).toBeGreaterThan(10);
    expect(INDEX_TARGETS.length).toBeGreaterThan(5);
  });

  it('ตัวกรองที่ระบบบังคับใช้ชื่อฟิลด์ของดัชนีเช่นกัน', () => {
    const mapped = mappedFields();
    const dsl = compile('status = Open', { tenantId: '1', browsableProjectIds: ['2'] });
    for (const clause of dsl.query.bool.filter) {
      const obj = clause as Record<string, Record<string, unknown>>;
      const inner = obj['term'] ?? obj['terms'];
      if (inner === undefined) continue;
      for (const field of Object.keys(inner)) expect(mapped.has(field)).toBe(true);
    }
  });
});
