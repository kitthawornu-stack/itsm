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
  it('**จำนวน endpoint**', () => {
    const files = walk(join(REPO, 'apps', 'api', 'src'), (f) => f.endsWith('.controller.ts'));
    expect(files.length, 'หาไฟล์ controller ไม่เจอ — ตัวสแกนพัง').toBeGreaterThan(3);
    const actual = files
      .map((f) => (readFileSync(f, 'utf8').match(/@(Get|Post|Patch|Put|Delete)\(/g) ?? []).length)
      .reduce((a, b) => a + b, 0);
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
    const actual = files
      .map((f) => (readFileSync(join(dir, f), 'utf8').match(/^export const \w+\s*[:=]/gm) ?? []).length)
      .reduce((a, b) => a + b, 0);
    for (const m of [...DOC.matchAll(/(\d+) ตัว · (\d+) story/g)]) {
      expect(Number(m[2])).toBe(actual);
    }
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
      .map((w) => w.name);

    expect(workspaces.length, 'หา workspace ที่มีเทสต์ไม่เจอ — ตัวสแกนพัง').toBeGreaterThan(3);

    let sum = 0;
    for (const name of workspaces) {
      const m = new RegExp(String.raw`\b${name}\s+(\d+)`).exec(DOC);
      expect(m, `เอกสารไม่ได้บอกยอดเทสต์ของ workspace "${name}"`).not.toBeNull();
      sum += Number((m as RegExpExecArray)[1]);
    }
    expect(sum).toBe(Number((total as RegExpExecArray)[1]?.replace(/,/g, '')));
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
