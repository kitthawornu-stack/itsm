/**
 * หน้าจอต้องใช้คอมโพเนนต์จาก `packages/ui` เท่านั้น — สแกนซอร์สจริง
 *
 * CLAUDE.md §6 ห้ามประดิษฐ์คอมโพเนนต์ใหม่นอก `packages/ui` แต่ไม่มีอะไรบังคับ
 * จนถึงตอนนี้ · ผลที่เกิดขึ้นจริง: หน้าจอแอดมินเจ็ดไฟล์มี
 * `<button className="admin-linkish">` รวม 16 จุด ซึ่งเป็น `LinkButton`
 * ที่เขียนซ้ำขึ้นมาเอง — CSS เหมือนกันเกือบทุกบรรทัด
 *
 * ราคาที่จ่ายไม่ใช่โค้ดซ้ำ แต่เป็นเรื่อง **ชื่อสำหรับ screen reader**:
 * ปุ่มดิบรับ `aria-label` ได้โดย TypeScript ไม่เคยตรวจว่าใส่หรือยัง คนจึงไม่ได้ใส่
 * แล้วหน้าตั้งค่า workflow มีปุ่ม "ลบกฎ" สี่ปุ่มติดกันที่อ่านออกเสียงเหมือนกันหมด
 * — วัดจริงด้วย accessibility tree ในเบราว์เซอร์
 *
 * `LinkButton` รับ `ariaLabel` (ไม่มีขีดกลาง) TypeScript จึงตรวจให้ได้
 *
 * อีกรูปแบบหนึ่งที่เจอ: หน้าจอห้าที่ส่งสตริง
 * `'<span className="ui-sr-only">การกระทำ</span>'` เป็นหัวคอลัมน์ให้ `Table`
 * เพราะคอมโพเนนต์ไม่มีทางบอกว่า "หัวนี้มีไว้ให้สกรีนรีดเดอร์เท่านั้น" ·
 * React escape ให้ แล้วแท็กถูกพิมพ์ออกมาเป็นข้อความบนหัวตารางจริง ๆ
 * — **typecheck ผ่านเพราะมันเป็น string ที่ถูกต้อง** เห็นได้ทางเดียวคือเปิดดู
 *
 * เทสต์นี้ต้องมีเคสที่พิสูจน์ว่า **ตัวสแกนหาเจอจริง** ด้วย มิฉะนั้นตัวสแกน
 * ที่พังจะทำให้ทุกอย่างเขียว เพราะเซ็ตว่างเท่ากับเซ็ตว่าง
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (full.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** ชื่อคลาสที่เคยเป็นคอมโพเนนต์เขียนเอง — ห้ามกลับมา */
const HOMEMADE = ['admin-linkish'];

/**
 * คลาสของ `packages/ui` ที่หน้าจอไม่ควรเขียนเอง
 *
 * การยืมชื่อคลาสภายในของ design system มาแปะบนปุ่มดิบ **ไม่ดีกว่าเดิม** —
 * มันแค่ย้ายการซ้ำจาก CSS ไปอยู่ใน JSX แล้วยังตรวจชื่อ aria ไม่ได้เหมือนเดิม
 */
const UI_INTERNAL = ['ui-btn', 'ui-linkbtn', 'ui-select', 'ui-input', 'ui-sr-only'];

describe('ขอบเขตของ design system', () => {
  const files = walk(ROOT).filter((f) => !f.endsWith('.spec.tsx'));

  it('ตัวสแกนหาไฟล์เจอจริง', () => {
    // เซ็ตว่างเท่ากับเซ็ตว่าง — ถ้าไม่ตรวจข้อนี้ ตัวสแกนที่พังจะทำให้ทุกอย่างเขียว
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.includes('workflow-admin'))).toBe(true);
  });

  it('**ไม่มีคอมโพเนนต์ที่เขียนเองนอก packages/ui**', () => {
    const bad = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return HOMEMADE.some((c) => src.includes(c));
    });
    expect(bad.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  it('**หน้าจอไม่ยืมคลาสภายในของ packages/ui มาแปะเอง**', () => {
    const bad = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return UI_INTERNAL.some((c) => src.includes(`"${c}`) || src.includes(`'${c}`));
    });
    expect(bad.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  it('**ตัวสแกนจับได้จริง** — ป้อนซอร์สปลอมที่มีปัญหาแล้วต้องเจอ', () => {
    /*
      ข้อพิสูจน์ว่าเงื่อนไขข้างบนไม่ได้เขียวเพราะตัวสแกนหาอะไรไม่เจอ ·
      สองข้อข้างบนตรวจว่า "ไม่มี" ซึ่งผ่านได้ทั้งตอนที่ไม่มีจริง และตอนที่
      ตัวสแกนพัง — แยกสองอย่างนี้ออกจากกันไม่ได้ถ้าไม่มีเคสนี้
    */
    const fake = '<button type="button" className="admin-linkish">ลบ</button>';
    expect(HOMEMADE.some((c) => fake.includes(c))).toBe(true);
    const fake2 = '<button className="ui-linkbtn" aria-label="ลบ">ลบ</button>';
    expect(UI_INTERNAL.some((c) => fake2.includes(`"${c}`))).toBe(true);
  });
});
