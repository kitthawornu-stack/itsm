/**
 * หัวตอบกลับที่ไม่ใช่มาตรฐาน ต้องถูกประกาศใน `exposedHeaders`
 *
 * ## ทำไมต้องมีไฟล์นี้
 *
 * ข้ามต้นทาง เบราว์เซอร์ให้ JavaScript เห็นเฉพาะหัวมาตรฐานไม่กี่ตัว ·
 * หัวอื่นถูกซ่อน **โดยไม่มี error ไม่มีคำเตือน** — `res.headers.get()`
 * คืน `null` เหมือนกับกรณีที่เซิร์ฟเวอร์ไม่ได้ส่งมาเลย
 *
 * เจอตอนกดปุ่มดาวน์โหลดจริงในเบราว์เซอร์: ไฟล์ที่ได้ถูกต้องทุกอย่าง
 * (7,021 แถว ภาษาไทยครบ BOM ครบ) แต่หน้าจอตั้งชื่อไฟล์เป็น `SD.csv`
 * แทน `SD-2026-09-02.csv` และขึ้นว่า **"0 เรื่อง"**
 *
 * เทสต์เขียวหมด typecheck ผ่าน lint ผ่าน ไม่มี error ที่ไหนเลย ·
 * **ตัวเลขที่ผิดแบบนี้แย่กว่าไม่แสดงตัวเลข เพราะคนเชื่อมัน**
 *
 * และบนโปรดักชันที่อยู่หลัง reverse proxy ต้นทางเดียวกัน ปัญหานี้จะไม่โผล่เลย
 * — จึงเป็นบั๊กที่มีเฉพาะบนเครื่องพัฒนา ซึ่งเป็นที่ที่คนตัดสินใจว่าฟีเจอร์เสร็จแล้ว
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'src';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/**
 * หัวที่เบราว์เซอร์ให้เห็นอยู่แล้วโดยไม่ต้องประกาศ (CORS-safelisted)
 *
 * รายการนี้มาจากมาตรฐาน ไม่ใช่จากการตัดสินใจของเรา จึงไม่เปลี่ยนตามโค้ด
 */
const SAFELISTED = new Set([
  'cache-control',
  'content-language',
  'content-length',
  'content-type',
  'expires',
  'last-modified',
  'pragma',
]);

/**
 * หัวที่ **ตั้งใจไม่ประกาศ** — ต้องมีเหตุผลกำกับทุกบรรทัด
 *
 * ไม่ใช่ทุกหัวที่ควรให้ JavaScript อ่าน · หัวที่เป็นคำสั่งถึงตัวเบราว์เซอร์เอง
 * ประกาศไปก็ไม่มีใครใช้ และทำให้รายการที่ควรสั้นยาวขึ้นโดยไม่ได้อะไร
 */
const NOT_EXPOSED_BY_DESIGN: ReadonlyMap<string, string> = new Map([
  [
    'x-content-type-options',
    'เป็นคำสั่งถึงเบราว์เซอร์ให้เลิกเดาชนิดไฟล์ (nosniff) — เบราว์เซอร์ทำตามเอง ไม่ใช่ข้อมูลที่หน้าจอต้องอ่าน',
  ],
]);

/** หัวทั้งหมดที่ controller ตั้งเอง ไม่ว่าจะผ่าน `@Header()` หรือ `res.setHeader()` */
function headersSetByControllers(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const f of walk(ROOT).filter((x) => x.endsWith('.controller.ts'))) {
    const t = stripComments(readFileSync(f, 'utf8'));
    const names = [
      ...[...t.matchAll(/@Header\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1] as string),
      ...[...t.matchAll(/setHeader\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1] as string),
    ];
    for (const n of names) {
      const key = n.toLowerCase();
      if (SAFELISTED.has(key)) continue;
      found.set(key, [...(found.get(key) ?? []), f]);
    }
  }
  return found;
}

function exposedInMain(): string[] {
  const main = stripComments(readFileSync(join(ROOT, 'main.ts'), 'utf8'));
  const m = /exposedHeaders:\s*\[([^\]]*)\]/.exec(main);
  if (m === null) return [];
  return [...(m[1] as string).matchAll(/['"]([^'"]+)['"]/g)].map((x) =>
    (x[1] as string).toLowerCase(),
  );
}

describe('หัวตอบกลับข้ามต้นทาง', () => {
  /**
   * **probe** — ตัวสแกนต้องหาหัวที่รู้แน่ว่ามีอยู่ให้เจอก่อน
   *
   * ทั้งสองแบบต้องเจอ: `@Header()` (decorator) และ `res.setHeader()` (ตอนรัน) ·
   * ถ้าตาบอดกับแบบใดแบบหนึ่ง หัวที่ตั้งด้วยวิธีนั้นจะหลุดไปเงียบ ๆ
   */
  it('**ตัวสแกนหาหัวที่ตั้งไว้เจอจริง ทั้งสองวิธี**', () => {
    const found = headersSetByControllers();
    expect([...found.keys()], 'หา res.setHeader ไม่เจอ — ตัวสแกนพัง').toContain('x-export-rows');
    expect([...found.keys()], 'หา res.setHeader ไม่เจอ').toContain('content-disposition');
    // `@Header('Cache-Control', …)` มีอยู่จริง แต่เป็นหัวมาตรฐาน จึงต้องถูกกรองทิ้ง
    expect([...found.keys()]).not.toContain('cache-control');
  });

  it('**อ่านรายการ exposedHeaders จาก main.ts ได้จริง**', () => {
    expect(exposedInMain().length, 'อ่าน exposedHeaders ไม่ได้ — ตัวสแกนพัง').toBeGreaterThan(0);
  });

  /**
   * **ด่านหลัก**
   *
   * หัวที่ controller ตั้งแต่ไม่ได้ประกาศไว้ = หัวที่หน้าจออ่านไม่เห็น
   * โดยไม่มีอะไรส่งเสียง
   */
  it('**ทุกหัวที่ controller ตั้งเอง ต้องอยู่ใน exposedHeaders**', () => {
    const exposed = new Set(exposedInMain());
    const missing = [...headersSetByControllers().entries()]
      .filter(([name]) => !exposed.has(name) && !NOT_EXPOSED_BY_DESIGN.has(name))
      .map(([name, files]) => `${name}  (ตั้งที่ ${files.join(', ')})`);
    expect(
      missing,
      ['หัวที่หน้าจออ่านไม่เห็นเพราะไม่ได้ประกาศไว้:', ...missing].join('\n'),
    ).toEqual([]);
  });

  /**
   * รายการที่ประกาศไว้ต้องไม่มีบรรทัดตายแล้ว — ประกาศหัวที่ไม่มีใครตั้ง
   * ทำให้อ่านเหมือนมีฟีเจอร์ที่ไม่มีอยู่จริง
   */
  it('**exposedHeaders ต้องไม่มีหัวที่ไม่มีใครตั้ง**', () => {
    const set = headersSetByControllers();
    const stale = exposedInMain().filter((h) => !set.has(h));
    expect(stale, ['ประกาศไว้แต่ไม่มีใครตั้ง:', ...stale].join('\n')).toEqual([]);
  });

  /**
   * รายการยกเว้นต้องไม่มีบรรทัดที่ตายแล้ว — หัวที่ไม่มีใครตั้งแล้ว
   * หรือหัวที่ถูกประกาศไปแล้ว ทำให้เหตุผลที่เขียนไว้กลายเป็นคำอธิบายของ
   * สิ่งที่ไม่เป็นความจริงอีกต่อไป
   */
  it('**รายการที่ตั้งใจไม่ประกาศ ต้องไม่มีบรรทัดที่ไม่จำเป็นแล้ว**', () => {
    const set = headersSetByControllers();
    const exposed = new Set(exposedInMain());
    const stale: string[] = [];
    for (const [name] of NOT_EXPOSED_BY_DESIGN) {
      if (!set.has(name)) stale.push(`${name} — ไม่มี controller ไหนตั้งแล้ว`);
      else if (exposed.has(name)) stale.push(`${name} — ประกาศไปแล้วใน main.ts`);
    }
    expect(stale, ['รายการยกเว้นที่ควรลบออก:', ...stale].join('\n')).toEqual([]);
  });
});
