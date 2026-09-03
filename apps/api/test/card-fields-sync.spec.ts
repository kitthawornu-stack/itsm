/**
 * รายการฟิลด์บนการ์ด **เขียนไว้สามที่** — ต้องตรงกันทั้งสามที่
 *
 * `@itsm/types` เป็นแหล่งจริง · `apps/web` คัดมาไว้เองเพราะไม่ได้พึ่งแพ็กเกจนั้น
 * (แบบเดียวกับ `WipState` และ `Scope`) · และตัวเลือกในหน้าจอมีป้ายภาษาไทย
 * ของตัวเอง
 *
 * **รายการที่คนดูแลด้วยมือ ต้องมีเทสต์ที่อ่านของจริงมาเทียบ** (CLAUDE.md) ·
 * ถ้าไม่มี วันที่มีคนเพิ่มฟิลด์ที่ `@itsm/types` แล้วลืมแก้ฝั่ง web
 * ตัวเลือกใหม่จะไม่โผล่ และไม่มีอะไรส่งเสียง — ผู้ใช้จะเห็นเมนูที่ขาดไป
 * โดยไม่รู้ว่าขาด
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALL_CARD_FIELDS, CARD_FIELD_LABEL, DEFAULT_CARD_FIELDS } from '@itsm/types';

const REPO = join(__dirname, '..', '..', '..');
const view = readFileSync(join(REPO, 'apps', 'web', 'src', 'components', 'board-view.tsx'), 'utf8');
const picker = readFileSync(
  join(REPO, 'apps', 'web', 'src', 'components', 'card-field-picker.tsx'),
  'utf8',
);

/**
 * ชื่อในอาร์เรย์ `const NAME = [...]` ที่ประกาศไว้ในซอร์ส
 *
 * ต้องรับ **ทั้งแบบที่มีและไม่มีคำอธิบายชนิดคั่นอยู่** —
 * `const A = [...]` กับ `const B: readonly T[] = [...]` ·
 * รอบแรกหาแค่ `NAME = [` แล้วได้รายการว่างจากแบบหลัง ซึ่งเทียบกับ
 * เซ็ตว่างได้เท่ากันเสมอ ถ้าฝั่งโน้นบังเอิญว่างด้วย
 */
function listInSource(src: string, name: string): string[] {
  const m = new RegExp(`${name}\\s*(?::[^=]*)?=\\s*\\[`).exec(src);
  if (m === null) return [];
  const at = m.index + m[0].length;
  const end = src.indexOf(']', at);
  if (end === -1) return [];
  return [...src.slice(at, end).matchAll(/'([a-zA-Z]+)'/g)].map((x) => x[1] ?? '');
}

describe('รายการฟิลด์บนการ์ดต้องตรงกันทุกที่', () => {
  /*
    **probe ทั้งสองทิศ** — ตัวแกะที่หาอะไรไม่เจอจะได้เซ็ตว่าง แล้วเทียบกับ
    เซ็ตว่างได้เท่ากันเสมอ · ตัวเลขจากตัวสแกนที่ไม่ได้ probe คือตัวเลข
    ที่ยังไม่รู้ว่าวัดอะไร
  */
  it('probe · แกะรายการที่รู้ว่ามีได้จริง', () => {
    expect(listInSource(view, 'CARD_FIELDS').length).toBeGreaterThan(2);
  });

  it('probe · ชื่อที่ไม่มีอยู่ ได้รายการว่าง ไม่ใช่ทั้งไฟล์', () => {
    expect(listInSource(view, 'ชื่อที่ไม่มีอยู่จริง')).toEqual([]);
  });

  it('**รายการฝั่ง web ตรงกับ `ALL_CARD_FIELDS`**', () => {
    expect(listInSource(view, 'CARD_FIELDS')).toEqual([...ALL_CARD_FIELDS]);
  });

  it('**ค่าปริยายฝั่ง web ตรงกับ `DEFAULT_CARD_FIELDS`**', () => {
    expect(listInSource(view, 'DEFAULT_CARD_FIELDS')).toEqual([...DEFAULT_CARD_FIELDS]);
  });

  /**
   * ทุกฟิลด์ต้องมีป้ายในหน้าจอ · ฟิลด์ที่ไม่มีป้ายจะขึ้นเป็นช่องติ๊กเปล่า
   * ซึ่งไม่มีใครรู้ว่ากดแล้วได้อะไร
   */
  it('**ทุกฟิลด์มีป้ายภาษาไทยในตัวเลือก และตรงกับฝั่ง types**', () => {
    for (const f of ALL_CARD_FIELDS) {
      expect(picker, `ตัวเลือกไม่มีฟิลด์ "${f}"`).toContain(`${f}:`);
      expect(picker, `ป้ายของ "${f}" ไม่ตรงกับฝั่ง types`).toContain(CARD_FIELD_LABEL[f]);
    }
  });

  /**
   * **การ์ดต้องเรนเดอร์ทุกฟิลด์ที่ประกาศว่าเลือกได้**
   *
   * ตัวเลือกที่ติ๊กได้แต่ไม่มีผลอะไร คือหน้าจอที่สร้างความเชื่อขึ้นมาเอง —
   * อาการเดียวกับสิทธิ์ที่ให้แล้วไม่มีผลใน CLAUDE.md
   */
  it('**ทุกฟิลด์ที่เลือกได้ มีโค้ดเรนเดอร์จริงบนการ์ด**', () => {
    for (const f of ALL_CARD_FIELDS) {
      expect(view, `เลือก "${f}" ได้ แต่การ์ดไม่เคยแสดงมัน`).toContain(`cardFields.includes('${f}')`);
    }
  });
});
