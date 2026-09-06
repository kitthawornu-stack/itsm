/**
 * ช่องกรอกอีเมลต้องเป็น `type="email"`
 *
 * **ผิดแล้วยังใช้งานได้ปกติบนเดสก์ท็อป** จึงไม่มีใครเห็น — เจอตอนขับเบราว์เซอร์
 * แล้วอ่านแอตทริบิวต์ของช่องล็อกอิน ได้ `type="text"` ทั้งที่คอมโพเนนต์ `Input`
 * รับ `type` มาตลอด และช่องรหัสผ่านข้าง ๆ ก็ใช้ถูกอยู่แล้ว
 *
 * สิ่งที่หายไปเมื่อเป็น `text`: แป้นพิมพ์บนมือถือไม่ขึ้นปุ่ม `@` และตัวจัดการ
 * รหัสผ่านไม่รู้ว่าช่องไหนคือชื่อผู้ใช้ จึงไม่เสนอให้บันทึกคู่กับรหัสผ่าน
 * · ทั้งสองอย่างไม่ทำให้อะไรพัง มันแค่ทำให้คนพิมพ์เองทุกครั้ง
 *
 * ตัวสแกนดูจาก **ป้ายภาษาไทย** ที่ผู้ใช้เห็น ไม่ใช่ชื่อตัวแปร — เพราะป้ายคือ
 * สิ่งที่บอกว่าช่องนี้รับอะไร และมันเปลี่ยนยากกว่าชื่อตัวแปร
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const WEB = join(__dirname, '..', '..', '..', 'apps', 'web', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** ทุกบล็อก `<Field label="อีเมล" …>` พร้อม `<Input …>` ที่อยู่ข้างใน */
function emailFields(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<Field[^>]*label="อีเมล"[\s\S]{0,400}?<\/Field>/g)) {
    out.push(m[0]);
  }
  return out;
}

const FILES = walk(WEB);

describe('ช่องกรอกอีเมลบนหน้าจอ', () => {
  const blocks: { file: string; block: string }[] = FILES.flatMap((f) =>
    emailFields(readFileSync(f, 'utf8')).map((block) => ({ file: f, block })),
  );

  it('probe · ตัวสแกนหาช่องอีเมลเจอจริง', () => {
    // เซ็ตว่างผ่านเงื่อนไขข้างล่างได้หมด ถ้าไม่ยืนยันข้อนี้
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(FILES.length).toBeGreaterThan(20);
  });

  it('probe · ไม่จับช่องที่ไม่ใช่อีเมล', () => {
    expect(emailFields('<Field label="ชื่อที่แสดง"><Input id="x" /></Field>')).toHaveLength(0);
  });

  it('**ทุกช่องอีเมลเป็น type="email"**', () => {
    const bad = blocks.filter((x) => !x.block.includes('type="email"')).map((x) => x.file);
    expect(bad).toEqual([]);
  });
});
