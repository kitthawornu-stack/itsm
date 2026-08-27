/**
 * ตรวจ design token อัตโนมัติ — INVARIANT 4
 *
 * เทสต์ชุดนี้จับบั๊กสามชนิดที่ตรวจด้วยตาไม่เจอ:
 *
 *   1. token ที่นิยามเฉพาะใน media query หรือ [data-theme]
 *      → ผู้ใช้ในสถานะ "ตามระบบ" (ซึ่งเป็นค่าเริ่มต้นและเป็นคนส่วนใหญ่)
 *        จะได้หน้าที่ใช้สีของธีมหนึ่งบนพื้นของอีกธีมหนึ่ง
 *
 *   2. บล็อก [data-theme="dark"] ไม่ตรงกับบล็อก media query
 *      → สลับธีมด้วยมือแล้วได้ผลต่างจากตอนให้ระบบเลือก
 *
 *   3. คู่สีที่ contrast ไม่ผ่าน WCAG AA
 *      → ตรวจ **ทั้งสองธีม** ซึ่งเป็นจุดที่ทีมส่วนใหญ่ตรวจแค่ธีมสว่างแล้วปล่อยผ่าน
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const css = read('./tokens.css');

// ---------- แยกบล็อกออกจากกัน ----------

function blockBody(source: string, startIndex: number): string {
  const open = source.indexOf('{', startIndex);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error('ไม่พบวงเล็บปิดของบล็อก');
}

function tokensIn(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.set(m[1]!, m[2]!.trim());
  return out;
}

/** บล็อก :root ทั้งหมดที่อยู่นอก media query และไม่มี attribute selector */
function rootDefaultTokens(): Map<string, string> {
  const merged = new Map<string, string>();
  const re = /(^|\n)(:root)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const before = css.slice(0, m.index);
    // ข้ามถ้าอยู่ใน @media (นับวงเล็บที่ยังไม่ปิด)
    const opens = (before.match(/@media[^{]*\{/g) ?? []).length;
    const closesAfterMedia = countBalancedMediaClosed(before);
    if (opens > closesAfterMedia) continue;
    for (const [k, v] of tokensIn(blockBody(css, m.index))) merged.set(k, v);
  }
  return merged;
}

function countBalancedMediaClosed(before: string): number {
  // นับจำนวน @media ที่ปิดครบแล้ว
  let closed = 0;
  const re = /@media[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before)) !== null) {
    let depth = 0;
    for (let i = before.indexOf('{', m.index); i < before.length; i += 1) {
      if (before[i] === '{') depth += 1;
      else if (before[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          closed += 1;
          break;
        }
      }
    }
  }
  return closed;
}

function selectorTokens(selector: string): Map<string, string> {
  const idx = css.indexOf(selector);
  if (idx === -1) throw new Error(`ไม่พบ selector: ${selector}`);
  return tokensIn(blockBody(css, idx));
}

const DEFAULT_TOKENS = rootDefaultTokens();
const MEDIA_DARK = selectorTokens(':root:not([data-theme="light"])');
const ATTR_DARK = selectorTokens(':root[data-theme="dark"]');

const SEMANTIC_PREFIXES = ['--surface', '--bg', '--border', '--text', '--accent', '--status', '--elevation', '--focus'];
const isSemantic = (name: string): boolean =>
  SEMANTIC_PREFIXES.some((p) => name === p || name.startsWith(`${p}-`) || name.startsWith(p));

// ---------- สี ----------

const PRIMITIVES = new Map(
  [...DEFAULT_TOKENS].filter(([k]) => k.startsWith('--p-')).map(([k, v]) => [k, v]),
);

/** คลี่ var(--x) ให้เป็นค่า hex จริง */
function resolve(value: string, scope: Map<string, string>): string {
  let v = value.trim();
  for (let i = 0; i < 6; i += 1) {
    const m = /^var\((--[a-z0-9-]+)\)$/i.exec(v);
    if (m === null) return v;
    const next = scope.get(m[1]!) ?? PRIMITIVES.get(m[1]!);
    if (next === undefined) return v;
    v = next.trim();
  }
  return v;
}

function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ============================================================

describe('tokens · ความครบถ้วนของสามสถานะ', () => {
  it('ทุก semantic token ต้องนิยามใน :root เปล่าก่อน', () => {
    const missing = [...MEDIA_DARK.keys()].filter(
      (k) => isSemantic(k) && !DEFAULT_TOKENS.has(k),
    );
    expect(
      missing,
      'token เหล่านี้นิยามเฉพาะในธีมมืด — ผู้ใช้สถานะ "ตามระบบ" บนเครื่องสว่างจะไม่ได้ค่า',
    ).toEqual([]);
  });

  it('บล็อก [data-theme="dark"] ต้องมี token ครบเท่ากับบล็อก media query', () => {
    const inMediaOnly = [...MEDIA_DARK.keys()].filter((k) => !ATTR_DARK.has(k));
    const inAttrOnly = [...ATTR_DARK.keys()].filter((k) => !MEDIA_DARK.has(k));
    expect(inMediaOnly, 'มีใน media query แต่ไม่มีใน [data-theme="dark"]').toEqual([]);
    expect(inAttrOnly, 'มีใน [data-theme="dark"] แต่ไม่มีใน media query').toEqual([]);
  });

  it('ค่าของสองบล็อกธีมมืดต้องตรงกันทุกตัว', () => {
    const different: string[] = [];
    for (const [k, v] of MEDIA_DARK) {
      if (ATTR_DARK.get(k) !== v) different.push(`${k}: media="${v}" attr="${ATTR_DARK.get(k) ?? ''}"`);
    }
    expect(different, 'สลับธีมด้วยมือจะได้ผลต่างจากตอนให้ระบบเลือก').toEqual([]);
  });

  it('media query ต้องมี guard :not([data-theme="light"])', () => {
    expect(css).toContain(':root:not([data-theme="light"])');
  });

  it('body ต้องระบุ background ชัดเจน ไม่ปล่อยโปร่งใส', () => {
    const body = blockBody(css, css.indexOf('\nbody {'));
    expect(body).toMatch(/background:\s*var\(--bg\)/);
  });
});

describe('tokens · WCAG AA contrast ทั้งสองธีม', () => {
  const PAIRS: Array<[fg: string, bg: string, min: number, label: string]> = [
    ['--text', '--surface', 4.5, 'ข้อความหลักบนการ์ด'],
    ['--text', '--bg', 4.5, 'ข้อความหลักบนพื้นหน้า'],
    ['--text', '--surface-2', 4.5, 'ข้อความหลักบนพื้นรอง'],
    ['--text-muted', '--surface', 4.5, 'ข้อความรองบนการ์ด'],
    ['--text-muted', '--bg', 4.5, 'ข้อความรองบนพื้นหน้า'],
    /*
      `--surface-2` เป็นพื้นของหัวตาราง แถบเครื่องมือ และกล่อง Alert
      แต่ไม่เคยมีคู่ contrast ของมันในรายการนี้เลย · ผลคือหัวตารางคิวใช้
      `--text-faint` บนพื้นนี้มานาน ได้ **3.8:1 ในธีมมืด** ซึ่งตกเกณฑ์สำหรับ
      ข้อความ 9.5px และไม่มีเทสต์ไหนเห็น — เจอด้วยการวัดในเบราว์เซอร์เท่านั้น
    */
    ['--text-muted', '--surface-2', 4.5, 'ข้อความรองบนพื้นรอง'],
    ['--text-faint', '--surface', 3.0, 'ข้อความจาง (ระดับ UI component)'],
    ['--text-faint', '--surface-2', 3.0, 'ข้อความจางบนพื้นรอง'],
    ['--accent-service', '--surface-2', 3.0, 'สีแบรนด์บนพื้นรอง'],
    ['--status-critical', '--surface-2', 3.0, 'สถานะวิกฤตบนพื้นรอง'],
    ['--status-warning', '--surface-2', 3.0, 'สถานะเตือนบนพื้นรอง'],
    ['--status-success', '--surface-2', 3.0, 'สถานะสำเร็จบนพื้นรอง'],
    ['--accent-service', '--surface', 3.0, 'สีแบรนด์ Service'],
    ['--accent-delivery', '--surface', 3.0, 'สีแบรนด์ Delivery'],
    ['--status-critical', '--surface', 3.0, 'สถานะวิกฤต'],
    ['--status-warning', '--surface', 3.0, 'สถานะเตือน'],
    ['--status-success', '--surface', 3.0, 'สถานะสำเร็จ'],
    ['--status-info', '--surface', 3.0, 'สถานะข้อมูล'],
    ['--status-critical', '--status-critical-soft', 4.5, 'ชิปวิกฤต'],
    ['--status-warning', '--status-warning-soft', 4.5, 'ชิปเตือน'],
    ['--status-success', '--status-success-soft', 4.5, 'ชิปสำเร็จ'],
    ['--status-info', '--status-info-soft', 4.5, 'ชิปข้อมูล'],
  ];

  const themes: Array<[string, Map<string, string>]> = [
    ['สว่าง', DEFAULT_TOKENS],
    ['มืด', new Map([...DEFAULT_TOKENS, ...ATTR_DARK])],
  ];

  for (const [themeName, scope] of themes) {
    describe(`ธีม${themeName}`, () => {
      for (const [fg, bg, min, label] of PAIRS) {
        it(`${label}: ${fg} บน ${bg} ≥ ${min}:1`, () => {
          const fgHex = resolve(scope.get(fg) ?? '', scope);
          const bgHex = resolve(scope.get(bg) ?? '', scope);
          expect(fgHex, `${fg} คลี่ค่าไม่ได้`).toMatch(/^#[0-9a-f]{3,8}$/i);
          expect(bgHex, `${bg} คลี่ค่าไม่ได้`).toMatch(/^#[0-9a-f]{3,8}$/i);
          const ratio = contrast(fgHex, bgHex);
          expect(
            Number(ratio.toFixed(2)),
            `${fgHex} บน ${bgHex} ได้ ${ratio.toFixed(2)}:1 ต่ำกว่าเกณฑ์`,
          ).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }
});

describe('tokens · กติกาภาษาไทย', () => {
  it('line-height ของเนื้อหาต้องไม่ต่ำกว่า 1.6', () => {
    for (const key of ['--line-height-body', '--line-height-dense']) {
      const v = Number(DEFAULT_TOKENS.get(key));
      expect(v, `${key} ต่ำเกินไป — วรรณยุกต์จะชนสระบรรทัดถัดไป`).toBeGreaterThanOrEqual(1.6);
    }
  });

  it('body ต้องตั้ง overflow-wrap เพื่อไม่ให้ข้อความไทยดันตารางล้น', () => {
    const body = blockBody(css, css.indexOf('\nbody {'));
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

/**
 * 4. ตัวแปรที่ถูกใช้แต่ไม่มีใครนิยาม
 *
 * `var(--space-5)` ที่ไม่มีนิยาม **ไม่ error และไม่เตือน** — เบราว์เซอร์ทิ้ง
 * ทั้งประกาศนั้นไปเงียบ ๆ ผลคือระยะห่างหายไปทั้งบล็อกโดยไม่มีสัญญาณอะไรเลย
 * และ stylelint ก็ไม่จับ เพราะไวยากรณ์ถูกต้องทุกอย่าง
 *
 * เจอจริงสองจุด: `--space-5` ในฟอร์มแจ้งปัญหา (ระยะห่างระหว่างช่องกรอกหายไป)
 * และ `--space-7` ในหน้ารายละเอียด — ทั้งคู่ผ่าน stylelint และ typecheck มาแล้ว
 */
describe('4 · ตัวแปรที่ใช้ต้องมีนิยาม', () => {
  const CSS_GLOBS = [
    '../components/primitives.css',
    '../../../../apps/web/src/app/app.css',
  ];

  const defined = new Set<string>();
  for (const src of [css, ...CSS_GLOBS.map(read)]) {
    for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1] as string);
  }

  it.each(CSS_GLOBS)('%s ไม่ใช้ตัวแปรที่ไม่มีใครนิยาม', (file) => {
    const used = new Set<string>();
    for (const m of read(file).matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1] as string);
    const missing = [...used].filter((v) => !defined.has(v)).sort();
    expect(missing).toEqual([]);
  });
});
