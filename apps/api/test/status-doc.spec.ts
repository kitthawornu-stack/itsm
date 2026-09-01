/**
 * ตัวเลขในเอกสารสถานะ ต้องตรงกับซอร์สจริง
 *
 * `docs/jira-parity-checklist.md` เป็นเอกสารที่คนอ่านเพื่อตอบคำถามว่า
 * "ตอนนี้ถึงไหนแล้ว" — และมันเป็น **รายการที่บอกสถานะของโค้ด** ซึ่ง CLAUDE.md
 * ห้ามไม่ให้เชื่อคำประกาศอย่างเดียว
 *
 * เหตุผลที่ต้องมีไฟล์นี้: ในรอบการทำงานเดียว ตัวเลขในเอกสารผิดสามครั้ง —
 * จำนวนเทสต์ (788 ทั้งที่ 828) · จำนวน endpoint (60 ทั้งที่ 65) · จำนวนคีย์สิทธิ์
 * ที่บังคับใช้ (9 ทั้งที่ 10) · และตารางเฟสกับตาราง exit criteria ในไฟล์เดียวกัน
 * **ขัดกันเอง** (14 กับ 19 คอมโพเนนต์) โดยไม่มีอะไรจับได้เลย
 *
 * เอกสารที่ตัวเลขผิดอันตรายกว่าเอกสารที่ไม่มีตัวเลข เพราะคนใช้มันตัดสินใจ
 * ว่าจะขึ้น pilot ได้หรือยัง
 *
 * **ตัวเลขที่นับจากซอร์สได้ ต้องถูกนับ ไม่ใช่พิมพ์มือ** — ถ้าไฟล์นี้แดง
 * ให้ไปแก้เอกสาร ไม่ใช่แก้เทสต์
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ALL_PERMISSION_KEYS, UNENFORCED_PERMISSIONS } from '../src/modules/permission';

const REPO = join(__dirname, '..', '..', '..');
const DOC = readFileSync(join(REPO, 'docs', 'jira-parity-checklist.md'), 'utf8');

function walk(dir: string, match: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
      out.push(...walk(full, match));
      continue;
    }
    if (match(entry)) out.push(full);
  }
  return out;
}

/** ตัวเลขตัวแรกที่อยู่หน้าคำที่กำหนด เช่น `65 endpoint` → 65 */
function numberBefore(word: string): number {
  const m = new RegExp(`(\\d[\\d,]*)\\s*${word}`).exec(DOC);
  expect(m, `เอกสารไม่มีข้อความ "<เลข> ${word}" ให้ตรวจเลย`).not.toBeNull();
  return Number((m as RegExpExecArray)[1]?.replace(/,/g, ''));
}

describe('เอกสารสถานะ · ช่องหมายถูก', () => {
  const counts = {
    done: (DOC.match(/^- \[x\]/gm) ?? []).length,
    partial: (DOC.match(/^- \[~\]/gm) ?? []).length,
    todo: (DOC.match(/^- \[ \]/gm) ?? []).length,
    cut: (DOC.match(/^- \[❌\]/gm) ?? []).length,
  };

  it('ตัวสแกนหาช่องหมายถูกเจอจริง — ไม่ใช่ผ่านเพราะนับได้ศูนย์ทุกช่อง', () => {
    // เซ็ตว่างเท่ากับเซ็ตว่าง · ถ้าไม่ยืนยันข้อนี้ ตัวสแกนที่พังจะทำให้ทุกอย่างเขียว
    expect(counts.done).toBeGreaterThan(0);
    expect(counts.partial).toBeGreaterThan(0);
    expect(counts.todo).toBeGreaterThan(0);
    expect(counts.done + counts.partial + counts.todo + counts.cut).toBeGreaterThanOrEqual(35);
  });

  it('**สรุปหัวเอกสารตรงกับช่องที่กาไว้จริง**', () => {
    const line = /(\d+) เสร็จ · (\d+) บางส่วน · (\d+) ยังไม่เริ่ม · (\d+) ตัดออก/.exec(DOC);
    expect(line, 'หาบรรทัดสรุปหัวเอกสารไม่เจอ').not.toBeNull();
    const [, d, p, t, c] = line as RegExpExecArray;
    expect({
      done: Number(d),
      partial: Number(p),
      todo: Number(t),
      cut: Number(c),
    }).toEqual(counts);
  });
});

describe('เอกสารสถานะ · ตัวเลขที่นับจากซอร์สได้', () => {
  /**
   * นับจาก **สเปกที่ประกอบจาก metadata ของเราเตอร์** ไม่ใช่จากการนับข้อความ
   *
   * ตัวนับเดิมนับ `@Get(...)` ทุกที่ที่พบในไฟล์ controller · **รวมที่อยู่ใน
   * คอมเมนต์ด้วย** — `workitem.controller.ts` มีคอมเมนต์เตือนว่า
   * "ต้องประกาศก่อน `@Get(':key')`" ซึ่งถูกนับเป็นเส้นทางหนึ่งเส้น
   * เอกสารจึงบอก 160 มาตลอด ทั้งที่เราเตอร์ให้บริการ 159 เส้น
   *
   * `docs/openapi.json` ถูกคอมมิตไว้และมี `openapi.spec.ts` คุมว่าตรงกับ
   * metadata จริง — การนับจากที่นั่นจึงเป็นการนับจากสภาพจริง ไม่ใช่จากข้อความ
   * ที่บังเอิญหน้าตาเหมือนโค้ด
   */
  it('**จำนวน endpoint**', () => {
    const spec = JSON.parse(readFileSync(join(REPO, 'docs', 'openapi.json'), 'utf8')) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const actual = Object.values(spec.paths).reduce((a, byMethod) => a + Object.keys(byMethod).length, 0);
    expect(actual, 'อ่านเส้นทางจากสเปกไม่เจอ — ไฟล์เสียหรือยังไม่ได้สร้าง').toBeGreaterThan(50);
    expect(numberBefore('endpoint')).toBe(actual);
  });

  it('**จำนวนคอมโพเนนต์ใน packages/ui**', () => {
    /*
      อ่านทุกไฟล์คอมโพเนนต์ ไม่ใช่รายชื่อที่เขียนไว้ตายตัว

      เดิมเขียนว่า `['presentational.tsx', 'interactive.tsx']` · วันที่เพิ่ม
      `modal.tsx` ตัวสแกนจึงมองไม่เห็นและรายงานจำนวนต่ำกว่าจริง —
      **ตัวสแกนที่มีรายชื่อไฟล์ตายตัว ก็คือรายการที่ดูแลด้วยมืออีกแบบหนึ่ง**
      ซึ่งเป็นสิ่งที่ไฟล์นี้มีไว้กันตั้งแต่ต้น
    */
    const dir = join(REPO, 'packages', 'ui', 'src', 'components');
    const actual = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx') && !f.endsWith('.stories.tsx'))
      .map((f) => (readFileSync(join(dir, f), 'utf8').match(/^export function /gm) ?? []).length)
      .reduce((a, b) => a + b, 0);
    expect(actual, 'นับคอมโพเนนต์ไม่ได้ — ตัวสแกนพัง').toBeGreaterThan(5);
    // ปรากฏสองที่ในเอกสาร (ตารางเฟส และตาราง exit criteria) — ต้องตรงกันทั้งคู่
    const mentions = [...DOC.matchAll(/(\d+) ตัว · (\d+) story/g)];
    expect(mentions.length, 'เอกสารต้องบอก "<เลข> ตัว · <เลข> story"').toBeGreaterThan(0);
    for (const m of mentions) expect(Number(m[1])).toBe(actual);
  });

  it('**จำนวน story** — นับจากไฟล์ story จริง', () => {
    const dir = join(REPO, 'packages', 'ui', 'src', 'components');
    const files = readdirSync(dir).filter((f) => f.endsWith('.stories.tsx'));
    expect(files.length, 'หาไฟล์ story ไม่เจอ — ตัวสแกนพัง').toBeGreaterThan(2);
    /*
      `\w` ไม่ตรงกับอักษรไทย และที่สำคัญกว่านั้น **สระกับวรรณยุกต์ไทยเป็น
      Unicode Mark ไม่ใช่ Letter** — `\p{L}` อย่างเดียวจึงยังไม่พอ
      ต้องมี `\p{M}` ด้วย มิฉะนั้น `export const ตัวเลข` ไม่ถูกนับ

      วัดจริง: story ชื่อไทย 8 ตัวหายไปจากยอดทั้งหมด **โดยเทสต์ยังเขียว**
      เพราะเอกสารก็บอกเลขเดิม — ตัวสแกนที่ตาบอดทำให้ทั้งสองฝั่งตรงกันที่ค่าผิด

      กับดักเดียวกับ `token_chars: ['letter','digit']` บน ngram tokenizer
      ที่ทำให้คำค้น "รีเซ็ต" ได้ token ว่างเปล่า (CLAUDE.md §3)
    */
    const actual = files
      .map(
        (f) =>
          (readFileSync(join(dir, f), 'utf8').match(/^export const [\p{L}\p{M}\p{N}_$]+\s*[:=]/gmu) ?? [])
            .length,
      )
      .reduce((a, b) => a + b, 0);
    for (const m of [...DOC.matchAll(/(\d+) ตัว · (\d+) story/g)]) {
      expect(Number(m[2])).toBe(actual);
    }
  });

  /**
   * จำนวนโมดูล **และจำนวนที่มีโค้ดจริง**
   *
   * เอกสารเคยเขียนว่า "23 โมดูล (มีโค้ดจริง 22)" ทั้งที่มีโฟลเดอร์ 22 และในนั้น
   * `sprint` กับ `version` ยังมีแค่ `export {}` ในตอนนั้น — เป็นเปลือกที่
   * ADR-004 กำหนดไว้ล่วงหน้า · ตัวเลขที่พิมพ์มือทั้งคู่จึงเพี้ยนคนละทาง ·
   * ทั้งสองโมดูลมีโค้ดครบแล้ว ด่านจึงพิสูจน์ตัวเองด้วยตัวอย่างที่ประกอบเอง
   * ไม่ใช่พึ่งพาการที่ยังมีเปลือกเปล่าเหลืออยู่จริง
   *
   * "มีโค้ดจริง" นับจาก **มีไฟล์อื่นนอกจาก `index.ts`** หรือ `index.ts`
   * ที่ export อะไรจริง ๆ ไม่ใช่ `export {}`
   */
  /**
   * จำนวนหน้าจอ
   *
   * ตัวเลขนี้ **ไม่มีอะไรคุมมาเลย** จนถึงคอมมิตนี้ — เอกสารเขียน 28
   * ทั้งที่มี 29 ไฟล์ · ตัวเลขที่พิมพ์มือและไม่มีใครตรวจ จะเพี้ยนเสมอ
   * ในวันที่มีคนเพิ่มหน้าใหม่แล้วลืมแก้เอกสาร
   *
   * นับ `page.tsx` ใต้ `apps/web/src/app` ทั้งหมด — Next.js App Router
   * ใช้ชื่อไฟล์นี้เป็นหน้าเสมอ จึงเป็นการนับจากสภาพจริง
   */
  it('**จำนวนหน้าจอ**', () => {
    const pages = walk(
      join(REPO, 'apps', 'web', 'src', 'app'),
      (f) => f.endsWith(`page.tsx`),
    ).length;
    expect(pages, 'หาไฟล์หน้าจอไม่เจอ — ตัวสแกนพัง').toBeGreaterThan(5);
    expect(numberBefore('หน้าจอ')).toBe(pages);
  });

  it('**จำนวนโมดูลและจำนวนที่มีโค้ดจริง**', () => {
    const dir = join(REPO, 'apps', 'api', 'src', 'modules');
    const mods = readdirSync(dir).filter((m) => statSync(join(dir, m)).isDirectory());
    expect(mods.length, 'หาโมดูลไม่เจอ — ตัวสแกนพัง').toBeGreaterThan(10);

    /**
     * โมดูลที่มีโค้ดจริง — เปลือกเปล่าคือมีแค่ `index.ts` ที่ `export {}`
     *
     * `readIndex` เป็นฟังก์ชัน ไม่ใช่ข้อความ · `health` **ไม่มี `index.ts` เลย**
     * (controller อย่างเดียว ไม่มีอะไรให้โมดูลอื่นเรียก) การอ่านไฟล์ล่วงหน้า
     * จึงระเบิดด้วย ENOENT — เจอตอนแก้ด่านนี้เอง
     */
    const hasCode = (files: readonly string[], readIndex: () => string): boolean =>
      files.some((f) => f !== 'index.ts') || !/export\s*\{\s*\}/.test(readIndex());

    const withCode = mods.filter((m) =>
      hasCode(readdirSync(join(dir, m)), () => readFileSync(join(dir, m, 'index.ts'), 'utf8')),
    );

    /*
      **ด่านพิสูจน์ว่าตัวสแกนแยกเปลือกเปล่าออกจริง**

      เดิมเขียนว่า `withCode.length < mods.length` ซึ่งพึ่งพาการที่ยัง **มี**
      โมดูลเปลือกเปล่าเหลืออยู่จริง ๆ · วันที่ `version` มีโค้ดครบ ด่านนี้ก็แดง
      ทั้งที่ไม่มีอะไรผิด — ด่านที่ต้องให้ของเสียคงอยู่ถึงจะทำงานได้ ไม่ใช่ด่าน

      ตรวจกับตัวอย่างที่ประกอบเอง ตัวสแกนจึงพิสูจน์ตัวเองได้เสมอ
      ไม่ว่าโปรเจกต์จะเดินไปถึงไหน
    */
    expect(hasCode(['index.ts'], () => 'export {};')).toBe(false);
    expect(hasCode(['index.ts'], () => "export * from './x';")).toBe(true);
    // โมดูลที่ไม่มี `index.ts` เลย (เช่น `health`) ต้องไม่ทำให้ตัวสแกนพัง
    expect(
      hasCode(['health.controller.ts'], () => {
        throw new Error('ต้องไม่อ่าน index.ts ที่ไม่มีอยู่');
      }),
    ).toBe(true);
    expect(withCode.length, 'ตัวสแกนหาโมดูลที่มีโค้ดไม่เจอเลย').toBeGreaterThan(10);

    const m = /(\d+) โมดูล \(มีโค้ดจริง (\d+)\)/.exec(DOC);
    expect(m, 'หาข้อความจำนวนโมดูลในเอกสารไม่เจอ').not.toBeNull();
    const [, total, real] = m as RegExpExecArray;
    expect(Number(total)).toBe(mods.length);
    expect(Number(real)).toBe(withCode.length);
  });

  it('**จำนวนคีย์สิทธิ์ที่บังคับใช้จริง**', () => {
    const enforced = ALL_PERMISSION_KEYS.length - UNENFORCED_PERMISSIONS.length;
    const m = /\*\*(\d+) จาก (\d+) คีย์บังคับใช้จริง\*\* อีก (\d+) คีย์/.exec(DOC);
    expect(m, 'หาข้อความจำนวนคีย์สิทธิ์ในเอกสารไม่เจอ').not.toBeNull();
    const [, got, total, rest] = m as RegExpExecArray;
    expect(Number(got)).toBe(enforced);
    expect(Number(total)).toBe(ALL_PERMISSION_KEYS.length);
    expect(Number(rest)).toBe(UNENFORCED_PERMISSIONS.length);
  });

  it('**ยอดเทสต์รวมต้องเท่ากับผลบวกรายโครงการที่เขียนไว้เอง**', () => {
    /*
      จำนวนเทสต์นับจากซอร์สแบบนิ่ง ๆ ไม่ได้ (ต้องรันจริง) จึงเป็นตัวเลขที่พิมพ์มือ
      สิ่งที่ตรวจได้คือ **ความสอดคล้องภายใน** — บรรทัดสรุปกับบรรทัดแยกรายโครงการ
      ต้องบวกกันได้ · ที่ผ่านมาสองบรรทัดนี้เพี้ยนคนละทางโดยไม่มีอะไรจับ
    */
    const total = /(\d[\d,]*) เทสต์ผ่าน/.exec(DOC);
    expect(total, 'หายอดรวมเทสต์ไม่เจอ').not.toBeNull();

    /*
      **รายชื่อ workspace อ่านจากดิสก์ ไม่ใช่จากรายการที่พิมพ์ไว้ในเทสต์**

      เคยเขียนเป็น `(?:api|worker|ui|hql|lexorank)` กับ `.toBe(5)` · วันที่
      `apps/web` มีเทสต์ชุดแรก ตัวสแกนอ่านไม่เห็น เอกสารจึงรายงานยอดที่น้อยกว่า
      ความจริง 13 เคส โดยเทสต์ยังเขียว — รายการที่คนดูแลด้วยมือ พังแบบเงียบเสมอ
      ในวันที่มีคนเพิ่มของใหม่ (CLAUDE.md §8)

      `--passWithNoTests` ไม่นับ เพราะ workspace ที่ยังไม่มีเทสต์ ไม่ควรถูก
      บังคับให้ปรากฏในเอกสาร
    */
    const workspaces = ['apps', 'packages']
      .flatMap((g) =>
        readdirSync(join(REPO, g)).map((name) => ({ name, dir: join(REPO, g, name) })),
      )
      .filter((w) => existsSync(join(w.dir, 'package.json')))
      .filter((w) => {
        const pkg = JSON.parse(readFileSync(join(w.dir, 'package.json'), 'utf8')) as {
          scripts?: Record<string, string>;
        };
        const t = pkg.scripts?.test ?? '';
        return t.includes('vitest') && !t.includes('passWithNoTests');
      })

    expect(workspaces.length, 'หา workspace ที่มีเทสต์ไม่เจอ — ตัวสแกนพัง').toBeGreaterThan(3);

    let sum = 0;
    for (const w of workspaces) {
      const m = new RegExp(String.raw`\b${w.name}\s+(\d+)`).exec(DOC);
      expect(m, `เอกสารไม่ได้บอกยอดเทสต์ของ workspace "${w.name}"`).not.toBeNull();
      const claimed = Number((m as RegExpExecArray)[1]);
      sum += claimed;

      /*
        **เทียบรายโครงการกับซอร์สจริง ไม่ใช่แค่บวกกันให้ลงตัว**

        ด่านเดิมตรวจแค่ว่า "ผลบวกของตัวเลขในเอกสาร = ยอดรวมในเอกสาร" ซึ่งเป็น
        การเทียบเอกสารกับตัวมันเอง · ตัวเลขทั้งหกตัวผิดพร้อมกันได้โดยยังเขียว
        ขอแค่บวกกันลงตัว — และมันผิดจริง: `web 34` ค้างอยู่ทั้งที่มี 28 เคส

        นับ `it(` / `test(` จากซอร์สมาเทียบ · workspace ที่ไม่มี `.each`
        นับได้ **ตรงเป๊ะ** ส่วนที่มี `.each` หนึ่ง `it` ขยายเป็นหลายเคส
        จึงตรวจได้แค่ว่ายอดในเอกสารต้องไม่ต่ำกว่าที่นับได้
      */
      const specs = walk(w.dir, (f) => /\.spec\.tsx?$/.test(f)).map((f) => readFileSync(f, 'utf8'));
      const statically = specs
        .map((src) => (src.match(/^\s*(?:it|test)\(/gm) ?? []).length)
        .reduce((a, b) => a + b, 0);
      const expands = specs.some((src) => /\b(?:it|test|describe)\.each\b/.test(src));

      if (expands) {
        expect(
          claimed,
          `ยอดเทสต์ของ "${w.name}" ต่ำกว่าจำนวน it() ที่นับได้จากซอร์ส`,
        ).toBeGreaterThanOrEqual(statically);
      } else {
        expect(claimed, `ยอดเทสต์ของ "${w.name}" ไม่ตรงกับจำนวน it() ในซอร์ส`).toBe(statically);
      }
    }
    expect(sum).toBe(Number((total as RegExpExecArray)[1]?.replace(/,/g, '')));
  });

  /**
   * ด่านพิสูจน์ว่าตัวนับ `it(` ด้านบนหาเจอจริง
   *
   * ตัวนับที่คืนศูนย์เสมอจะทำให้เงื่อนไข `toBeGreaterThanOrEqual` ผ่านหมด
   * — เซ็ตว่างเท่ากับเซ็ตว่างอีกครั้ง
   */
  it('**ตัวนับ it() หาเจอจริง**', () => {
    const here = readFileSync(join(REPO, 'apps', 'api', 'test', 'status-doc.spec.ts'), 'utf8');
    expect((here.match(/^\s*(?:it|test)\(/gm) ?? []).length).toBeGreaterThan(5);
  });

  /**
   * ด่านที่พิสูจน์ว่าตัวสแกนด้านบนหาชื่อไทยเจอจริง
   *
   * ตัวสแกนที่ตาบอดทำให้ทุกอย่างเขียว เพราะเซ็ตว่างเท่ากับเซ็ตว่าง —
   * ยอดที่นับไม่เห็น story ชื่อไทยจะตรงกับเอกสารที่ก็ไม่ได้นับมันเหมือนกัน
   * · เคสนี้จับตอนที่มีคนย้อน `\p{M}` ออกไป
   */
  it('**ตัวสแกน story อ่านชื่อภาษาไทยได้** — สระไทยเป็น Mark ไม่ใช่ Letter', () => {
    const rx = /^export const [\p{L}\p{M}\p{N}_$]+\s*[:=]/gmu;
    const sample = ['export const ตัวเลข: Story = {}', 'export const มีวันที่ไม่มีงานเลย = {}'].join('\n');
    expect(sample.match(rx)).toHaveLength(2);

    // และมีของจริงในโปรเจกต์ให้หาอย่างน้อยหนึ่งตัว ไม่ใช่ตรวจแค่ข้อความตัวอย่าง
    const dir = join(REPO, 'packages', 'ui', 'src', 'components');
    const thai = readdirSync(dir)
      .filter((f) => f.endsWith('.stories.tsx'))
      .flatMap((f) => readFileSync(join(dir, f), 'utf8').match(rx) ?? [])
      .filter((m) => !/^export const \w+\s*[:=]/.test(m));
    expect(thai.length, 'ไม่มี story ชื่อไทยให้ตรวจ — ด่านนี้ไม่ได้พิสูจน์อะไร').toBeGreaterThan(0);
  });

  it('**จำนวนไฟล์เทสต์**', () => {
    /*
      สแกน `apps` กับ `packages` ทั้งก้อน ไม่ใช่ไล่ชื่อ workspace ทีละตัว

      เคยเขียนเป็นรายการตายตัว `[api, worker, packages]` · วันที่ `apps/web`
      มีเทสต์ชุดแรก ตัวสแกนจึงนับไม่เห็น และเอกสารสถานะรายงานตัวเลขที่น้อยกว่า
      ความจริงโดย **เทสต์ยังเขียว** — รายการที่กำหนดขอบเขตไว้ตายตัว คือรายการ
      ที่คนดูแลด้วยมือ ซึ่ง CLAUDE.md ห้ามไว้สำหรับตัวเลขที่บอกสถานะของโค้ด
    */
    const roots = [join(REPO, 'apps'), join(REPO, 'packages')];
    const actual = roots
      .flatMap((r) => walk(r, (f) => f.endsWith('.spec.ts') || f.endsWith('.spec.tsx')))
      .length;
    expect(actual, 'หาไฟล์เทสต์ไม่เจอ — ตัวสแกนพัง').toBeGreaterThan(10);
    expect(numberBefore('ไฟล์เทสต์')).toBe(actual);
  });
});

describe('เอกสารสถานะ · ตารางเฟส', () => {
  /** แถวเฟส: | **N** ชื่อ | ขอบเขต | สถานะ | ทำได้แล้ว | ค้างอะไร | */
  const rows = [...DOC.matchAll(/^\| \*\*(\d)\*\* [^|]*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/gm)];

  it('ตัวสแกนอ่านแถวเฟสเจอครบหกเฟส — ไม่ใช่ผ่านเพราะอ่านไม่เจอสักแถว', () => {
    expect(rows.map((r) => r[1])).toEqual(['0', '1', '2', '3', '4', '5']);
  });

  it('**ตัวเศษกับตัวส่วนต้องตรงกับรายการที่เขียนไว้ในแถวเดียวกัน**', () => {
    /*
      ช่องนี้เคยเป็น "ประมาณ 70%" ซึ่งไม่มีใครตรวจได้ว่า 70% ของอะไร
      เปลี่ยนเป็นจำนวนนับแล้ว ตัวเลขจึงต้องเท่ากับจำนวนรายการที่แจกแจงไว้จริง
      มิฉะนั้นก็กลับไปเป็นตัวเลขที่อ่านเหมือนข้อเท็จจริงแต่ไม่มีอะไรรองรับเหมือนเดิม
    */
    const items = (cell: string): number => {
      const t = cell.trim();
      if (t === '' || t === '—') return 0;
      return t.split('·').filter((x) => x.trim() !== '').length;
    };
    for (const r of rows) {
      const phase = r[1] as string;
      const status = (r[3] ?? '').trim();
      const m = /(\d+) จาก (\d+) รายการ/.exec(status);
      // เฟส 0 วัดด้วย exit criteria ไม่ใช่รายการฟีเจอร์ จึงยกเว้น
      if (m === null) {
        expect(status, `เฟส ${phase} ต้องบอกจำนวน หรือเป็นเฟส 0 ที่วัดด้วยเกณฑ์`).toMatch(/เกณฑ์/);
        continue;
      }
      const done = items(r[4] ?? '');
      const left = items(r[5] ?? '');
      expect(Number(m[1]), `เฟส ${phase}: ตัวเศษไม่ตรงกับรายการในช่อง "ทำได้แล้ว"`).toBe(done);
      expect(Number(m[2]), `เฟส ${phase}: ตัวส่วนไม่ตรงกับผลรวมของสองช่อง`).toBe(done + left);
    }
  });
});

describe('เอกสารสถานะ · ความสอดคล้องภายใน', () => {
  it('**ตารางเฟสกับตาราง exit criteria ต้องไม่ขัดกันเอง**', () => {
    /*
      เคยขัดกันจริง: ตารางเฟสเขียน "Storybook 14 จาก 24 คอมโพเนนต์"
      ส่วนตาราง exit criteria ในไฟล์เดียวกันเขียน "19 ตัว · 59 story"
      คนอ่านสองบรรทัดนี้ในหน้าจอเดียวกันได้คำตอบคนละอย่าง
    */
    const inPhase = /Storybook (\d+) จาก (\d+) คอมโพเนนต์/.exec(DOC);
    const inExit = [...DOC.matchAll(/(\d+) ตัว · (\d+) story/g)];
    if (inPhase !== null && inExit.length > 0) {
      expect(Number(inPhase[1])).toBe(Number(inExit[0]?.[1]));
    }
  });

  it('ไม่มีคำมั่นว่า "ยืนยันแล้ว" กับปฏิทินที่ยังไม่มีใครยืนยัน', () => {
    // ข้อนี้เป็นตัวกันไม่ให้เอกสารบอกว่าพร้อม pilot ทั้งที่ตัวเลข SLA ยังเชื่อไม่ได้
    expect(DOC).toMatch(/ยังไม่มีใครกรอกวันหยุดจริง/);
  });
});
