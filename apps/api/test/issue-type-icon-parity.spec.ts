/**
 * คำศัพท์ไอคอนถูกเขียนสองที่ — ด่านนี้บังคับให้ตรงกัน
 *
 * `packages/ui` ไม่ได้พึ่ง `@itsm/types` (ไม่มี dependency ระหว่างสองแพ็กเกจนี้
 * และ `apps/web` ก็พึ่งแค่ `@itsm/ui`) รายการค่าจึงอยู่สองไฟล์ · ถ้าเพิ่มคีย์
 * ที่เดียว ค่าใหม่จะตกไปเป็นไอคอนทั่วไปเงียบ ๆ — **หน้าจอยังเรนเดอร์ได้ปกติ
 * แค่ผิด** ซึ่งเป็นอาการที่ไม่มีเครื่องมือไหนจับได้นอกจากเทสต์
 *
 * เป็นกรณีเดียวกับ `var(--space-5)` ที่ไม่มีนิยาม: ผิดแล้วยังเรนเดอร์ได้
 * จึงต้องมีเทสต์ ไม่ใช่พึ่งการมองเห็น
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { ISSUE_TYPE_ICONS } from '@itsm/types';

const ROOT = join(__dirname, '..', '..', '..');
const UI = readFileSync(
  join(ROOT, 'packages', 'ui', 'src', 'components', 'issue-type-icon.tsx'),
  'utf8',
);

/** ค่าที่ union `IssueTypeIconName` ประกาศไว้ */
function unionNames(src: string): string[] {
  const block = /export type IssueTypeIconName =([\s\S]*?);/.exec(src);
  if (block === null) return [];
  return [...(block[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1] as string);
}

/** คีย์ที่ตาราง `PATHS` วาดจริง — ประกาศชนิดไว้ไม่เท่ากับวาดได้ */
function drawnNames(src: string): string[] {
  const block = /const PATHS: Readonly<Record<IssueTypeIconName, ReactNode>> = \{([\s\S]*?)\n\};/.exec(
    src,
  );
  if (block === null) return [];
  return [...(block[1] ?? '').matchAll(/^ {2}([a-z]+):/gm)].map((m) => m[1] as string);
}

describe('คำศัพท์ไอคอนประเภทงาน · types ↔ ui', () => {
  it('probe · ตัวแกะหาของที่รู้ว่ามีเจอจริง', () => {
    // เซ็ตว่างเท่ากับเซ็ตว่าง — ถ้าไม่ยืนยันข้อนี้ ตัวแกะที่พังจะทำให้ทุกอย่างเขียว
    expect(unionNames(UI)).toContain('incident');
    expect(drawnNames(UI)).toContain('incident');
    expect(unionNames(UI).length).toBeGreaterThan(5);
  });

  it('probe · ตัวแกะไม่จับของที่ไม่ใช่', () => {
    // `ariaLabel` เป็น prop ไม่ใช่ไอคอน · `IssueTypeIconProps` ก็มีปีกกาเหมือนกัน
    expect(drawnNames(UI)).not.toContain('ariaLabel');
    expect(drawnNames(UI)).not.toContain('size');
    expect(unionNames(UI)).not.toContain('sm');
  });

  it('**ชนิดใน ui ตรงกับคำศัพท์ใน types ทุกค่า**', () => {
    expect([...unionNames(UI)].sort()).toEqual([...ISSUE_TYPE_ICONS].sort());
  });

  it('**ทุกค่ามีเส้นให้วาดจริง** — ประกาศชนิดไว้ไม่เท่ากับวาดได้', () => {
    expect([...drawnNames(UI)].sort()).toEqual([...ISSUE_TYPE_ICONS].sort());
  });

  it('ทุกไอคอนใช้ currentColor — สีดิบในไอคอนละเมิด INVARIANT 4', () => {
    expect(UI).toContain('stroke="currentColor"');
    expect(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(UI)).toBe(false);
  });
});
