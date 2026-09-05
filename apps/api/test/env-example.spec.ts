/**
 * `.env.example` ต้องตรงกับสิ่งที่โค้ดอ่านจริง
 *
 * ไฟล์นั้นคือสิ่งที่ตัดสินว่า "ติดตั้งใหม่แล้วใช้ได้ไหม" และมันเคยล้าหลังไปทั้งรุ่น:
 * ใช้พอร์ตชุดเก่าทั้งหมด (3307 · 6379 · 9200 · 9000 · 4000) ทั้งที่ §9 ย้ายไป
 * 4xxx แล้ว และ **ขาดตัวแปรที่โค้ดอ่านจริงไป 22 ตัว** รวม `API_INTERNAL_URL`
 * กับ `CORS_ORIGINS` ซึ่งเป็นสองในห้าสาเหตุที่ทำให้การยกสแตกจริงครั้งแรก
 * ใช้ไม่ได้ทั้งที่ build ผ่านหมด
 *
 * ตรวจสองทิศ เพราะทั้งสองทางพังคนละแบบ:
 *   - **ขาด** = ติดตั้งแล้วไม่ทำงาน โดยไม่มีอะไรบอกว่าลืมตั้งอะไร
 *   - **เกิน** = ค่าที่ตั้งแล้วไม่มีผล ซึ่งทำให้คนเชื่อว่าตั้งค่าเรียบร้อยแล้ว
 *     (รอบแรกที่รันเจอหกตัว: `JWT_SECRET` `JWT_EXPIRES_IN` `REFRESH_EXPIRES_IN`
 *     `MULTI_TENANT_ENABLED` `DEFAULT_LOCALE` `DEFAULT_TIMEZONE` — เซสชัน
 *     เก็บในฐานข้อมูล ไม่ใช่ JWT มาตั้งแต่ต้น)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');

/**
 * เดินทั้ง `apps` และ `packages` แล้วกรองทีหลัง — **ไม่ไล่ชื่อโฟลเดอร์เอง**
 * รายการที่คนดูแลด้วยมือพังเงียบเสมอในวันที่มีคนเพิ่มโฟลเดอร์ใหม่
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * ถอดคอมเมนต์ออกก่อนสแกน
 *
 * ไฟล์นี้เองอธิบายรูปแบบที่มันจับด้วยการเขียนตัวอย่างไว้ในคอมเมนต์ ·
 * รอบแรกตัวสแกนจึงรายงานว่าโค้ดอ่านตัวแปรชื่อ `X` ที่ไม่มีอยู่จริง
 * — เกณฑ์ต้องเป็น **สิ่งที่โค้ดทำ** ไม่ใช่สิ่งที่คอมเมนต์เอ่ยถึง
 */
function stripComments(src: string): string {
  const noBlock = src.replace(/[/][*][\s\S]*?[*][/]/g, ' ');
  return noBlock.replace(/[/][/][^\n]*/g, ' ');
}

/** ชื่อ env ที่มีคนอ่านจริง — จากซอร์ส · compose · schema ของ Prisma */
function namesRead(): Set<string> {
  const found = new Set<string>();
  const add = (src: string, re: RegExp): void => {
    for (const m of src.matchAll(re)) found.add(m[1] as string);
  };
  for (const f of [...walk(join(ROOT, 'apps')), ...walk(join(ROOT, 'packages'))]) {
    const src = stripComments(readFileSync(f, 'utf8'));
    add(src, /process\.env\.([A-Z_][A-Z0-9_]*)/g);
    add(src, /process\.env\['([A-Z_][A-Z0-9_]*)'\]/g);
    // โค้ดบางส่วนรับ env เป็น record ที่ฉีดเข้ามา แล้วอ่านด้วย `env['X']`
    add(src, /\benv\['([A-Z_][A-Z0-9_]*)'\]/g);
  }
  const compose = join(ROOT, 'infra', 'compose');
  for (const name of readdirSync(compose)) {
    if (!name.endsWith('.yml')) continue;
    add(readFileSync(join(compose, name), 'utf8'), /\$\{([A-Z_][A-Z0-9_]*)/g);
  }
  add(readFileSync(join(ROOT, 'apps', 'api', 'prisma', 'schema.prisma'), 'utf8'), /env\("([A-Z_][A-Z0-9_]*)"\)/g);
  return found;
}

const EXAMPLE = readFileSync(join(ROOT, '.env.example'), 'utf8');
const declared = new Set(
  [...EXAMPLE.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1] as string),
);

/**
 * ชื่อที่โฮสต์ต้องเป็นชื่อโดเมนได้ เพราะ **เบราว์เซอร์** เป็นคนเรียก
 * ที่เหลือชี้ไปบริการใน Docker จึงต้องเป็น `127.0.0.1` (ดูหัวไฟล์ `.env.example`)
 */
const BROWSER_FACING = ['API_BASE_URL', 'WEB_BASE_URL', 'CORS_ORIGINS', 'PUBLIC_API_URL', 'PUBLIC_WEB_URL'];

/** พอร์ตในคอนเทนเนอร์ ไม่ใช่พอร์ตที่ map ออกมา จึงไม่อยู่ในชุด 4xxx */
const CONTAINER_PORTS = ['SMTP_PORT_INTERNAL'];

describe('.env.example ตรงกับสิ่งที่โค้ดอ่าน', () => {
  const read = namesRead();

  it('probe · ตัวสแกนเห็นครบทุกแหล่ง (ซอร์ส · compose · prisma)', () => {
    // probe ทิศเดียวจับได้แค่ครึ่งเดียว และ probe ตัวเดียวไม่พิสูจน์ว่าครอบทุกแหล่ง
    expect(read, 'ไม่เห็นซอร์ส TypeScript').toContain('SCHEDULERS');
    expect(read, 'ไม่เห็น env ที่ฉีดเข้ามาแบบ record').toContain('MAIL_INTAKE');
    expect(read, 'ไม่เห็น docker-compose').toContain('PUBLIC_API_URL');
    expect(read, 'ไม่เห็น schema.prisma').toContain('DATABASE_URL');
    expect(read.size).toBeGreaterThan(30);
  });

  it('probe · ไม่จับของที่ไม่ใช่ชื่อ env', () => {
    expect(read).not.toContain('NODE');
    expect(read).not.toContain('SELECT');
    expect(declared).not.toContain('MYSQL');
  });

  it('probe · ตัวถอดคอมเมนต์ทำงานจริง และไม่กินโค้ดทิ้ง', () => {
    const NL = String.fromCharCode(10);
    expect(stripComments('/* process.env.GHOST */ x')).not.toContain('GHOST');
    expect(stripComments('// process.env.GHOST' + NL + 'y')).not.toContain('GHOST');
    // ถ้าตัวถอดกินทุกอย่าง ตัวสแกนจะรายงานว่าไม่มีใครอ่าน env เลย แล้วเขียวสนิท
    expect(stripComments('process.env.' + 'KEEP')).toContain('KEEP');
    expect(read, 'ถอดคอมเมนต์แล้วหาอะไรไม่เจอเลย').toContain('SCHEDULERS');
  });

  it('**ทุกตัวที่โค้ดอ่าน ต้องอยู่ใน .env.example**', () => {
    expect([...read].filter((n) => !declared.has(n)).sort()).toEqual([]);
  });

  it('**ทุกตัวใน .env.example ต้องมีคนอ่าน** — ค่าที่ตั้งแล้วไม่มีผลคือคำโกหก', () => {
    expect([...declared].filter((n) => !read.has(n)).sort()).toEqual([]);
  });

  it('พอร์ตทุกตัวอยู่ในชุด 4xxx ตาม §9', () => {
    const bad: string[] = [];
    for (const m of EXAMPLE.matchAll(/^([A-Z_][A-Z0-9_]*_PORT)=(\d+)/gm)) {
      const [, name, port] = m as unknown as [string, string, string];
      if (CONTAINER_PORTS.includes(name)) continue;
      if (!/^4\d{3}$/.test(port)) bad.push(`${name}=${port}`);
    }
    expect(bad).toEqual([]);
  });

  it('**โฮสต์ของบริการใน Docker ใช้ 127.0.0.1 ไม่ใช่ localhost**', () => {
    const bad: string[] = [];
    for (const m of EXAMPLE.matchAll(/^([A-Z_][A-Z0-9_]*)=.*localhost/gm)) {
      const name = m[1] as string;
      if (!BROWSER_FACING.includes(name)) bad.push(name);
    }
    expect(bad, 'บนวินโดวส์ localhost แปลเป็น IPv6 ก่อน แล้วต่อไม่ติดเป็นบางครั้ง').toEqual([]);
  });
});
