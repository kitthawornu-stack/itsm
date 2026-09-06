/**
 * หน้าจอจัดการตัวกรองด่วนต่อสายจริง
 *
 * ตาราง service และ endpoint ครบมานาน **แต่ไม่มีปุ่มไหนในเว็บเรียกมันเลย**
 * — ตั้งได้ทาง API เท่านั้น · รูปแบบเดียวกับไฟล์แนบที่ API ครบทั้งแนบ
 * รายการ ดาวน์โหลด แต่คนแจ้งปัญหาส่งภาพหน้าจอไม่ได้จริงอยู่หลายเดือน
 * และเอกสารก็เขียนว่า "✔" มาตลอด
 *
 * ตัวสแกนนี้จับ "ต่อสายผิด" ไม่ใช่ "หน้าตาถูกไหม" — เรื่องหลังต้องเปิดดูเอง
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const WEB = join(__dirname, '..', '..', '..', 'apps', 'web', 'src');
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
const ADMIN = strip(readFileSync(join(WEB, 'components', 'quick-filter-admin.tsx'), 'utf8'));
const PAGE = strip(readFileSync(join(WEB, 'app', '(app)', 'board', '[key]', 'page.tsx'), 'utf8'));

describe('จัดการตัวกรองด่วน · ต่อสายแล้ว', () => {
  it('probe · อ่านไฟล์ถูกตัว และตัวถอดคอมเมนต์ไม่กินโค้ดทิ้ง', () => {
    expect(ADMIN).toContain('QuickFilterAdmin');
    expect(PAGE).toContain('BoardView');
    expect(ADMIN.length).toBeGreaterThan(1_500);
  });

  it('probe · ไม่จับของที่อยู่ในคอมเมนต์', () => {
    expect(ADMIN).not.toContain('ไม่มีปุ่มไหนในเว็บเรียกมันเลย');
  });

  it('**เรียก endpoint สร้างและลบจริง**', () => {
    expect(ADMIN).toContain('quick-filters');
    expect(ADMIN).toMatch(/send\('',\s*\{ name, hql \}\)/);
    expect(ADMIN).toMatch(/\/delete/);
  });

  it('**หน้ากระดานวางคอมโพเนนต์นี้จริง และเฉพาะคนที่จัดการโปรเจกต์ได้**', () => {
    expect(PAGE).toContain('<QuickFilterAdmin');
    expect(PAGE).toMatch(/!data\.canManage \? null :/);
  });

  /**
   * ปุ่มต้องอยู่ **นอก** เงื่อนไข "มีตัวกรองแล้ว" — ถ้าซ่อนตอนยังไม่มี
   * จะไม่มีทางสร้างอันแรกได้เลย ซึ่งเป็นทางตันที่มองไม่เห็นจนกว่าจะเจอ
   * โปรเจกต์ที่ยังว่าง
   */
  it('**ปุ่มจัดการไม่ถูกซ่อนตอนยังไม่มีตัวกรองสักอัน**', () => {
    const at = PAGE.indexOf('<QuickFilterAdmin');
    const guard = PAGE.indexOf('filters.length === 0 ? null : (');
    expect(at).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(at);
  });

  it('ล้างฟอร์มเฉพาะตอนเซิร์ฟเวอร์รับแล้ว ไม่ใช่ตอนเรียกฟังก์ชันเสร็จ', () => {
    expect(ADMIN).toMatch(/\.then\(\(ok\) => \{[\s\S]*?if \(ok\)/);
    expect(ADMIN).toMatch(/Promise<boolean>/);
  });
});
