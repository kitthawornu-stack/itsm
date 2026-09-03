/**
 * ด่านของ **ที่มาของตัวเลขที่เพดานใช้ตัดสิน**
 *
 * `wip-limit.spec.ts` พิสูจน์ตรรกะ · `board-wip-db.spec.ts` พิสูจน์ว่าต่อสายแล้ว
 * และจับได้จริงถ้าใครเปลี่ยนไปนับจาก `cards.length` · ไฟล์นี้เพิ่มด่านที่
 * **อ่านซอร์ส** เพราะเทสต์ต่อฐานข้อมูลจับได้เฉพาะรูปแบบที่มันเดินผ่าน
 * — วันที่มีคนเพิ่มมุมมองใหม่ที่ประกอบคอลัมน์ขึ้นมาเอง มันจะไม่ถูกเรียก
 *
 * ที่ต้องกันไว้: กระดานดึงการ์ดมาคอลัมน์ละไม่เกิน `limitPerColumn` (100) ·
 * คอลัมน์ที่มีงานจริง 150 ใบจะมี `cards.length === 100` · เพดาน 120 ที่ตัดสิน
 * จากตัวเลขนั้นจะอ่านว่า "ยังไม่เต็ม" ทั้งที่เกินไปแล้ว 30 ใบ **โดยไม่มี
 * error ไม่มีคำเตือน และหน้าจอยังดูปกติทุกอย่าง**
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SERVICE = join(__dirname, '..', 'src', 'modules', 'board', 'board.service.ts');
const ENGINE = join(__dirname, '..', 'src', 'modules', 'board', 'wip-limit.ts');

const serviceRaw = readFileSync(SERVICE, 'utf8');
const service = stripComments(serviceRaw);
const engine = stripComments(readFileSync(ENGINE, 'utf8'));

/**
 * ตัดคอมเมนต์ทิ้งก่อนสแกน
 *
 * **เกณฑ์ต้องเป็นการกระทำ ไม่ใช่การเอ่ยถึง** — รอบแรกตัวสแกนนี้แดงเพราะ
 * ไปเจอ `cards.length` ใน *คอมเมนต์ที่อธิบายว่าห้ามใช้ `cards.length`* ·
 * เป็นกับดักเดียวกับที่ `authz-write-scan.spec.ts` เคยเจอ ตอนที่รูปแบบ
 * `PermissionDeniedError` ไปตรงกับตัวแปลง error ของ controller
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\r\n]*/g, ' ');
}

/**
 * เนื้อของฟังก์ชันหนึ่ง — ตัดตั้งแต่ชื่อไปจนจบวงเล็บปีกกาที่สมดุล
 *
 * นับปีกกาแบบตรงไปตรงมา **หลังจากข้ามรายการพารามิเตอร์และชนิดที่คืนค่าแล้ว**
 * — ทั้งสองอย่างมีปีกกาของตัวเองได้ (`{ a: string }` · `Promise<{ id: bigint }>`)
 * ซึ่งเคยทำให้ตัวสแกนอีกตัวรายงานผิดสามรอบติดกัน
 */
function bodyOf(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at === -1) return '';
  const open = src.indexOf('{', src.indexOf('):', at));
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return '';
}

describe('ที่มาของตัวเลขที่เพดาน WIP ใช้', () => {
  /*
    **probe ทั้งสองทิศ** — ตัวสแกนที่หาอะไรไม่เจอเลยจะรายงานว่าทุกอย่างเรียบร้อย
    เพราะเซ็ตว่างไม่มีอะไรให้ผิด · และตัวที่จับกว้างเกินจะรายงานว่ามีด่าน
    ทั้งที่ไม่มี ซึ่งเป็นทางที่อันตรายกว่า
  */
  it('probe · แกะเนื้อฟังก์ชันที่รู้ว่ามีได้จริง', () => {
    const body = bodyOf(service, 'boardOf');
    expect(body.length).toBeGreaterThan(500);
    expect(body).toContain('groupBy');
  });

  it('probe · ฟังก์ชันที่ไม่มีอยู่ ต้องได้ค่าว่าง ไม่ใช่ทั้งไฟล์', () => {
    expect(bodyOf(service, 'ฟังก์ชันที่ไม่มีอยู่จริง')).toBe('');
  });

  /*
    probe ของตัวตัดคอมเมนต์เอง · ถ้ามันไม่ทำงาน เกณฑ์ทั้งหมดข้างล่าง
    จะไปจับคอมเมนต์ที่ *อธิบายว่าห้ามทำ* แล้วรายงานว่ามีคนทำ
  */
  it('probe · ตัวตัดคอมเมนต์ทำงานจริง', () => {
    expect(stripComments(['const a = 1; // cards.length', ''].join('\n'))).not.toContain(
      'cards.length',
    );
    expect(stripComments('/* cards.length */ const b = 2;')).not.toContain('cards.length');
    // แต่ต้องไม่กินโค้ดจริงไปด้วย
    expect(stripComments('const c = cards.length;')).toContain('cards.length');
    expect(serviceRaw, 'ไฟล์ต้นทางต้องมีคอมเมนต์ที่พูดถึง cards.length จริง').toContain(
      'cards.length',
    );
  });

  /**
   * **จำนวนที่ส่งให้ `evaluateWip` ต้องไม่ได้มาจากรายการการ์ด**
   *
   * ถ้าวันหนึ่งมีคนเขียน `evaluateWip(cards.length, …)` เพราะมันอ่านง่ายกว่า
   * เพดานจะเงียบตั้งแต่ใบที่ 101 · เทสต์ต่อฐานข้อมูลจับได้ แต่ต้องมีคน
   * เรียกเส้นทางเดิม — ด่านนี้จับที่ตัวอักษร
   */
  it('**`boardOf` ไม่นับจำนวนจากรายการการ์ด**', () => {
    const body = bodyOf(service, 'boardOf');
    expect(body, 'ไม่ได้เรียก evaluateWip เลย — เพดานหลุดออกจากกระดานไปแล้ว').toContain(
      'evaluateWip(',
    );
    expect(body, 'นับจากรายการที่ถูกตัดที่ limitPerColumn').not.toMatch(/cards\.length/);
    expect(body, 'นับจากแถวที่ดึงมาแสดง ซึ่งถูกตัดเหมือนกัน').not.toMatch(
      /count\s*[:=]\s*rows\.length/,
    );
  });

  /**
   * **เอนจินต้องไม่รู้จักการ์ดเลย**
   *
   * เป็นข้อกำหนดที่พิสูจน์ในเทสต์ของเอนจินเองไม่ได้ (เคยเขียนแล้วมันผ่าน
   * ทุกกรณีไม่ว่าโค้ดทำอะไร จึงลบทิ้ง) · ถ้าเอนจินรับการ์ดได้เมื่อไร
   * ผู้เรียกจะส่ง `column.cards` เข้ามาโดยธรรมชาติ
   */
  it('**เอนจินรับจำนวน ไม่รับรายการการ์ด**', () => {
    expect(engine).not.toMatch(/BoardCard|cards\s*:/);
    expect(engine).toMatch(/export function evaluateWip\(count: number, limit: WipLimit\)/);
  });

  /**
   * ตัวเลขที่ผิดแย่กว่าไม่มีตัวเลข — `count` ต้องเป็นส่วนหนึ่งของคำตอบเสมอ
   * ไม่ใช่คำนวณเฉพาะตอนที่มีเพดาน · มิฉะนั้นหน้าจอที่อยากแสดงจำนวนจริง
   * จะกลับไปใช้ `cards.length` เอง
   */
  it('คอลัมน์ที่ส่งออกมีทั้ง `count` และ `wip` เสมอ', () => {
    expect(service).toMatch(/count:\s*number;/);
    expect(service).toMatch(/wip:\s*WipState;/);
  });
});
