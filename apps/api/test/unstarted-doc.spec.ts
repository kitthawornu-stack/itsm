/**
 * ช่องที่กาว่า "ยังไม่เริ่ม" ต้องไม่มีโค้ดอยู่จริง
 *
 * ## ทำไมต้องมีไฟล์นี้
 *
 * เอกสารมีตัวสแกนที่ตรวจตัวเลขซึ่งนับได้ (endpoint · หน้าจอ · เทสต์ · โมดูล)
 * และตรวจว่าสรุปหัวเอกสารตรงกับช่องที่กาไว้ · **แต่ไม่มีอะไรตรวจว่าสิ่งที่
 * กาว่า "ยังไม่เริ่ม" ยังไม่เริ่มจริง**
 *
 * ผลคือคำกล่าวอ้างค้างอยู่ได้นานโดยไม่มีใครเห็น · ไล่ตรวจด้วยมือครั้งเดียว
 * เจอสี่ข้อ: `Backlog + Sprint` ทำเสร็จแล้วตั้งแต่ตอนไหนไม่รู้ (ตารางสถานะ
 * รายเฟสในเอกสารเดียวกันนับว่าเสร็จมาตลอด แต่ช่องหมายถูกไม่ได้อัปเดตตาม) ·
 * `Sprint Goal` มีแล้วบางส่วน · Kanban board มีแล้ว · Velocity มีแล้ว 1 จาก 8
 *
 * **คำกล่าวอ้างว่า "ยังทำไม่ได้" อันตรายกว่าคำกล่าวอ้างว่า "ทำได้แล้ว"** —
 * อย่างหลังมีคนไปกดแล้วพบว่าใช้ไม่ได้ · อย่างแรกทำให้ไม่มีใครไปลอง และทำให้
 * มีคนสร้างของที่มีอยู่แล้วขึ้นมาใหม่ (เกือบเกิดขึ้นจริงกับ multi-tenant)
 *
 * ## วิธี: ทำให้ "ยังไม่เริ่ม" เป็นข้อความที่พิสูจน์ผิดได้
 *
 * ทุกช่อง `[ ]` ต้องมีเครื่องหมาย `<!-- ยังไม่มี: <ตัวระบุ> -->` กำกับ ·
 * ตัวระบุคือชื่อที่ **จะต้องมีในซอร์สถ้าฟีเจอร์นั้นถูกสร้าง** · ถ้าวันหนึ่ง
 * มีคนสร้างมันขึ้นมา เทสต์นี้แดงทันทีและบังคับให้ไปแก้ช่องหมายถูก
 *
 * ไม่ใช่ด่านที่สมบูรณ์ — คนที่ตั้งชื่ออย่างอื่นจะเล็ดลอดไปได้ · แต่ดีกว่า
 * ไม่มีอะไรเลย และราคาของมันคือหนึ่งบรรทัดต่อหนึ่งข้อ
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOC = readFileSync('../../docs/jira-parity-checklist.md', 'utf8');

/** เดินทั้ง `apps` และ `packages` แล้วกรองทีหลัง — ไม่ไล่ชื่อโฟลเดอร์เอง */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.next' || e === 'dist' || e === '.turbo') continue;
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(p) && !p.endsWith('.spec.ts') && !p.endsWith('.spec.tsx')) {
        out.push(p);
      }
    }
  };
  walk('../../apps');
  walk('../../packages');
  return out;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

interface Unstarted {
  line: string;
  ident: string;
}

function unstartedItems(doc: string = DOC): Unstarted[] {
  const out: Unstarted[] = [];
  for (const raw of doc.split('\n')) {
    if (!raw.startsWith('- [ ]')) continue;
    const m = /<!--\s*ยังไม่มี:\s*([A-Za-z0-9_]+)\s*-->/.exec(raw);
    out.push({
      line: raw.replace(/<!--[\s\S]*?-->/, '').trim(),
      ident: m?.[1] ?? '',
    });
  }
  return out;
}

describe('เอกสารสถานะ · ช่องที่กาว่ายังไม่เริ่ม', () => {
  const items = unstartedItems();
  const files = sourceFiles();
  const sources = new Map(files.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));

  it('**ตัวสแกนอ่านซอร์สเจอจริง** — ไม่ใช่ผ่านเพราะรายการไฟล์ว่าง', () => {
    expect(files.length, 'หาไฟล์ซอร์สไม่เจอเลย — ตัวสแกนพัง').toBeGreaterThan(200);
    /*
      **probe หลายตัว ครอบคนละส่วนของพื้นที่ค้นหา** — ซอร์สของ api · ของ web ·
      และของแพ็กเกจร่วม · probe ตัวเดียวเคยผ่านสบาย ๆ ขณะที่พื้นที่ค้นหา
      ขาดไปทั้งก้อน (CLAUDE.md)
    */
    const all = [...sources.values()].join('\n');
    expect(all, 'หาโค้ดฝั่ง api ไม่เจอ').toContain('insertInitialFieldValues');
    expect(all, 'หาโค้ดฝั่ง web ไม่เจอ').toContain('RetentionBoard');
    expect(all, 'หาโค้ดในแพ็กเกจร่วมไม่เจอ').toContain('UtcDate');
  });

  /**
   * **probe ต้องยิงใส่ข้อความตัวอย่าง ไม่ใช่ใส่จำนวนที่เหลือในเอกสารจริง**
   *
   * ของเดิมเขียนว่า `toBeGreaterThan(3)` โดยเอาจำนวนที่เหลือ ณ วันนั้นมาตั้ง ·
   * **มันแดงในวันที่งานคืบหน้า** — พอเหลือ 3 ข้อ ด่านก็ล้มทั้งที่ไม่มีอะไรผิด
   * และจะแดงตลอดไปเมื่อเหลือ 0 ซึ่งเป็นเป้าหมายของโปรเจกต์ ·
   * เพดานและพื้นที่ตั้งจากตัวเลขที่ขยับได้ จะกลายเป็นด่านที่ห้ามความคืบหน้า
   */
  it('probe · ตัวแกะช่อง `[ ]` ทำงานกับข้อความตัวอย่างได้', () => {
    const sample = ['- [ ] อย่างหนึ่ง <!-- ยังไม่มี: alpha -->', '- [x] อีกอย่าง'].join('\n');
    const got = unstartedItems(sample);
    expect(got).toHaveLength(1);
    expect(got[0]?.ident).toBe('alpha');
  });

  it('probe · ช่องที่ไม่มีเครื่องหมาย ถูกจับได้', () => {
    expect(unstartedItems('- [ ] ไม่มีเครื่องหมาย')[0]?.ident).toBe('');
  });

  it('**ทุกช่อง `[ ]` ต้องมีเครื่องหมายที่พิสูจน์ผิดได้**', () => {
    const missing = items.filter((i) => i.ident === '').map((i) => i.line);
    expect(
      missing,
      ['ช่องที่ยังไม่มีเครื่องหมาย `<!-- ยังไม่มี: … -->`:', ...missing].join('\n'),
    ).toEqual([]);
  });

  /**
   * **ด่านหลัก**
   *
   * ตัวระบุที่โผล่ในซอร์ส แปลว่าฟีเจอร์นั้นเริ่มแล้ว — ช่องหมายถูกต้องเปลี่ยน
   */
  it('**สิ่งที่กาว่ายังไม่เริ่ม ต้องไม่มีโค้ดอยู่จริง**', () => {
    const started: string[] = [];
    for (const item of items) {
      if (item.ident === '') continue;
      const re = new RegExp(item.ident, 'i');
      for (const [file, text] of sources) {
        if (re.test(text)) {
          started.push(`${item.line}\n    เจอ "${item.ident}" ที่ ${file}`);
          break;
        }
      }
    }
    expect(
      started,
      ['ช่องที่กาว่ายังไม่เริ่ม แต่มีโค้ดอยู่แล้ว — ต้องไปแก้ช่องหมายถูก:', ...started].join('\n'),
    ).toEqual([]);
  });

  /**
   * **ด่านพิสูจน์ว่าด่านข้างบนแดงได้**
   *
   * ตัวระบุที่รู้แน่ว่ามีอยู่ในซอร์ส ต้องถูกจับได้ · ถ้าเคสนี้ผ่านโดยที่
   * ด่านข้างบนไม่เคยแดงเลย แปลว่าการค้นหาไม่ได้ทำงาน ไม่ใช่ว่าไม่มีอะไรผิด
   */
  it('**ถ้ามีโค้ดจริง ด่านข้างบนต้องจับได้**', () => {
    const re = new RegExp('insertInitialFieldValues', 'i');
    const hit = [...sources.values()].some((t) => re.test(t));
    expect(hit, 'ตัวระบุที่รู้ว่ามีอยู่ กลับหาไม่เจอ — การค้นหาไม่ทำงาน').toBe(true);
  });
});
