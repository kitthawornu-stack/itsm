/**
 * คีย์สิทธิ์ไหนมีผลจริง — เทสต์ที่อ่านซอร์สเอง ไม่เชื่อรายการที่เขียนไว้
 *
 * `UNENFORCED_PERMISSIONS` เป็นรายการที่คนเขียน และรายการที่คนดูแลด้วยมือ
 * คือรายการที่จะไม่ตรงกับความจริงในวันที่มีคนแก้โค้ดแล้วลืมแก้รายการ
 * — ซึ่งเป็นวันที่หน้าตั้งค่าจะเริ่มโกหกโดยไม่มีใครรู้
 *
 * เทสต์นี้จึงสแกนซอร์สจริงเพื่อหาว่าคีย์ไหนถูกถามผ่าน `can()` / `assertCan()`
 * แล้วเทียบกับรายการ · เพิ่มการบังคับใช้เมื่อไร เทสต์แดงทันทีและบังคับให้มาลบชื่อออก
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSION_KEYS,
  UNENFORCED_PERMISSIONS,
  isEnforced,
} from '../src/modules/permission';

const SRC = join(__dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    // ข้ามเทสต์ — การอ้างคีย์ในเทสต์ไม่ได้แปลว่าโค้ดจริงบังคับใช้
    if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
    // ข้ามไฟล์ที่ประกาศรายการเอง ไม่งั้นทุกคีย์จะดู "ถูกใช้" เพราะถูกประกาศ
    if (entry === 'permission-rules.ts') continue;
    out.push(full);
  }
  return out;
}

/**
 * คีย์ที่ถูกถามผ่านด่านตรวจจริง
 *
 * นับเฉพาะที่เป็น **อาร์กิวเมนต์ของฟังก์ชันตรวจสิทธิ์** ไม่ใช่ทุกที่ที่ชื่อคีย์
 * ปรากฏ · `bootstrap.ts` เอ่ยชื่อคีย์ตอนสร้าง grant ซึ่งเป็นการ **ให้** สิทธิ์
 * ไม่ใช่การ **ตรวจ** — สองอย่างนี้ต่างกัน และการนับรวมกันจะทำให้คีย์ที่ไม่มีใคร
 * ตรวจเลย ดูเหมือนมีผลบังคับ
 */
/**
 * ตัดคอมเมนต์ออกก่อนสแกน
 *
 * คอมเมนต์ที่อธิบายวิธีเรียกด่านตรวจ มักยกตัวอย่างที่หน้าตาเหมือนโค้ดจริง
 * แล้วตัวสแกนก็นับมันเป็นการบังคับใช้ · **เกิดขึ้นจริงตอนเขียน
 * `version.service.ts`** — คอมเมนต์ที่ยกตัวอย่างการเรียกด่านตรวจ ทำให้ชื่อคีย์
 * สมมติกลายเป็นคีย์ที่ "บังคับใช้แล้ว" และเทสต์แดงโดยชี้ไปผิดที่
 *
 * เป็นกับดักตัวเดียวกับตัวนับ endpoint ที่เคยนับ `@Get` ในคอมเมนต์
 */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

function scan(text: string): string[] {
  const pattern = /(?:assertCan|\bcan|permissionsFor|PermissionDeniedError)\s*\([^)]*?'([A-Z_]+)'/g;
  const out: string[] = [];
  for (const m of stripComments(text).matchAll(pattern)) if (m[1] !== undefined) out.push(m[1]);
  return out;
}

function enforcedInSource(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    for (const key of scan(readFileSync(file, 'utf8'))) found.add(key);
  }
  return found;
}

describe('คีย์สิทธิ์ที่บังคับใช้จริง', () => {
  it('**รายการที่เขียนไว้ตรงกับซอร์สจริง**', () => {
    const actual = enforcedInSource();
    const declared = ALL_PERMISSION_KEYS.filter((k) => isEnforced(k));
    // ถ้าเทสต์นี้แดง แปลว่ามีคนเพิ่มหรือลบการบังคับใช้แล้วไม่ได้แก้
    // UNENFORCED_PERMISSIONS ตาม — แก้รายการนั้น อย่าแก้เทสต์
    expect([...actual].sort()).toEqual([...declared].sort());
  });

  it('คีย์ที่ประกาศว่ายังไม่บังคับใช้ ต้องไม่ปรากฏในด่านตรวจไหนเลย', () => {
    const actual = enforcedInSource();
    for (const key of UNENFORCED_PERMISSIONS) {
      expect(actual.has(key)).toBe(false);
    }
  });

  it('ทุกคีย์ที่ประกาศไว้เป็นคีย์ที่ระบบรู้จักจริง', () => {
    for (const key of UNENFORCED_PERMISSIONS) {
      expect(ALL_PERMISSION_KEYS).toContain(key);
    }
  });

  it('ตัวสแกนต้องหาเจอจริง — ไม่ใช่ผ่านเพราะไม่เจออะไรเลยทั้งสองฝั่ง', () => {
    // เทสต์ข้อแรกจะเขียวเองถ้าตัวสแกนพัง (เซ็ตว่าง = เซ็ตว่าง)
    // จึงต้องยืนยันแยกว่ามันเจอคีย์ที่รู้แน่ว่ามีการบังคับใช้อยู่
    const actual = enforcedInSource();
    expect(actual.has('BROWSE_PROJECT')).toBe(true);
    expect(actual.has('VIEW_INTERNAL_COMMENT')).toBe(true);
    expect(actual.size).toBeGreaterThan(5);
  });

  /**
   * **คีย์ที่โผล่เฉพาะในคอมเมนต์ ต้องไม่ถูกนับว่าบังคับใช้แล้ว**
   *
   * เจอกับตัวเองตอนเขียน `version.service.ts` — คอมเมนต์ที่ยกตัวอย่างการเรียก
   * ด่านตรวจ ทำให้ชื่อคีย์สมมติกลายเป็นคีย์ที่ "บังคับใช้แล้ว" แล้วเทสต์ก็แดง
   * โดยชี้ไปผิดที่ · เป็นกับดักตัวเดียวกับตัวนับ endpoint ที่เคยนับ decorator
   * ในคอมเมนต์
   */
  it('**ตัวสแกนไม่นับคีย์ที่อยู่ในคอมเมนต์**', () => {
    const sample = [
      '/* ตัวอย่าง: assertCan(ctx, id, ' + String.raw`'ZZ_FAKE_BLOCK'` + ') */',
      '// assertCan(ctx, id, ' + String.raw`'ZZ_FAKE_LINE'` + ')',
      "await assertCan(ctx, id, 'ZZ_REAL');",
    ].join('\n');
    expect(scan(sample)).toEqual(['ZZ_REAL']);

    // และต้องไม่กินโค้ดจริงทิ้งไปด้วย — ตัวตัดที่ตัดมากเกินจะทำให้ทุกอย่างเขียว
    expect(stripComments("assertCan(ctx, id, 'A');").trim()).toBe("assertCan(ctx, id, 'A');");
  });

  it('**การให้สิทธิ์ไม่นับเป็นการบังคับใช้** — สองอย่างนี้ต่างกัน', () => {
    /*
      `bootstrap.ts` เอ่ยชื่อคีย์ตอนสร้าง grant ซึ่งเป็นการ **ให้** สิทธิ์
      ไม่ใช่การ **ตรวจ** · ถ้าตัวสแกนนับทุกที่ที่ชื่อคีย์ปรากฏ คีย์ที่ไม่มีใคร
      ตรวจเลยจะดูเหมือนมีผลบังคับ เพียงเพราะมีคนให้มันกับกลุ่มไว้

      พิสูจน์กับข้อความสังเคราะห์ ไม่ใช่กับไฟล์จริง — ไฟล์จริงบังเอิญให้เฉพาะคีย์
      ที่มีการบังคับใช้อยู่แล้ว จึงแยกสองกรณีนี้ออกจากกันไม่ได้
    */
    expect(scan("await assertCan(ctx, id, 'MANAGE_SPRINT');")).toEqual(['MANAGE_SPRINT']);
    expect(scan("data: { permission: 'MANAGE_SPRINT', groupId }")).toEqual([]);
    expect(scan("const grants = [['MANAGE_SPRINT', adminGroupId]];")).toEqual([]);
  });
});
