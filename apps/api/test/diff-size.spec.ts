/**
 * ด่านขนาดของสิ่งที่กำลังจะคอมมิต
 *
 * CLAUDE.md §4 ตั้งเพดานไว้ 400 บรรทัด และเคยเขียนว่า "บังคับด้วย CI" ·
 * **ไม่มีอะไรบังคับเลย** จนถึงวันที่เขียนไฟล์นี้ · กฎจึงถูกละเมิดซ้ำหลายครั้ง
 * โดยไม่มีอะไรส่งเสียง — เป็นบทเรียน "กลไกที่ไม่มีอะไรเรียกใช้ ป้องกันอะไร
 * ไม่ได้เลย" ที่เกิดกับกฎในเอกสารนั้นเอง
 *
 * เทสต์นี้ตรวจสองอย่างคนละชนิดกัน:
 *
 *   1. **ตัวคำนวณถูกไหม** — ฟังก์ชันบริสุทธิ์ ทดสอบด้วยข้อมูลที่ประกอบเอง
 *   2. **ต้นไม้ตอนนี้ผ่านเพดานไหม** — อ่าน `git diff` จริง · ข้อนี้คือด่าน
 *      ตัวจริง และเป็นเหตุผลที่มันอยู่ใน `pnpm ci` ซึ่งกติกาบอกให้รันก่อน
 *      คอมมิตทุกครั้งอยู่แล้ว
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GENERATED,
  MAX_DIFF_LINES,
  isGenerated,
  measure,
  parseNumstat,
  report,
  untrackedRows,
} from '../src/scripts/diff-size';

const REPO = join(__dirname, '..', '..', '..');

describe('ขนาดของสิ่งที่กำลังจะคอมมิต', () => {
  describe('A · ตัวคำนวณ', () => {
    it('นับบรรทัดที่เพิ่มบวกที่ลบ — การลบก็ต้องถูกอ่านเหมือนกัน', () => {
      const s = measure([{ path: 'a.ts', added: 300, removed: 300 }]);
      expect(s.total, 'นับแต่บรรทัดที่เพิ่ม — การแทนที่ทั้งไฟล์จะดูเหมือนครึ่งเดียว').toBe(600);
    });

    it('เรียงไฟล์จากใหญ่ไปเล็ก เพื่อบอกได้ว่าจะแตกตรงไหน', () => {
      const s = measure([
        { path: 'small.ts', added: 1, removed: 0 },
        { path: 'big.ts', added: 90, removed: 0 },
      ]);
      expect(s.files.map((f) => f.path)).toEqual(['big.ts', 'small.ts']);
    });

    /**
     * **ไฟล์ที่เครื่องสร้างไม่นับ แต่ต้องรายงานว่าข้ามอะไรไป**
     *
     * รายการยกเว้นคือทางที่กฎจะถูกปิดเงียบ ๆ ถ้าใครเติมของที่คนต้องอ่าน
     * ลงไป · การรายงานทำให้เห็นตอนมันโตขึ้น
     */
    it('**ไฟล์ที่เครื่องสร้างไม่นับ และถูกรายงานว่าข้าม**', () => {
      const s = measure([
        { path: 'pnpm-lock.yaml', added: 5000, removed: 4000 },
        { path: 'docs/openapi.json', added: 200, removed: 10 },
        { path: 'src/a.ts', added: 10, removed: 0 },
      ]);
      expect(s.total).toBe(10);
      expect(s.skipped).toEqual(['pnpm-lock.yaml', 'docs/openapi.json']);
    });

    it('ทุกรายการยกเว้นมีเหตุผลกำกับ ไม่ใช่รายชื่อลอย ๆ', () => {
      for (const g of GENERATED) expect(g.why.length).toBeGreaterThan(5);
    });

    /**
     * **probe ทั้งสองทิศ** — รายการยกเว้นที่จับกว้างเกินจะปิดกฎทั้งข้อ
     * โดยที่ทุกอย่างยังเขียว ซึ่งเป็นทางที่อันตรายกว่าจับแคบเกิน
     */
    it('probe · จับของที่ควรข้ามได้', () => {
      expect(isGenerated('pnpm-lock.yaml')).toBe(true);
      expect(isGenerated('apps/api/prisma/migrations/x/migration.sql')).toBe(true);
    });

    it('probe · **ไม่จับ**ของที่คนต้องอ่าน', () => {
      expect(isGenerated('apps/api/src/modules/board/board.service.ts')).toBe(false);
      expect(isGenerated('apps/api/test/board.spec.ts')).toBe(false);
      expect(isGenerated('docs/jira-parity-checklist.md')).toBe(false);
      // ชื่อที่คล้ายของที่ข้าม แต่ไม่ใช่
      expect(isGenerated('docs/openapi.json.md')).toBe(false);
      expect(isGenerated('apps/api/prisma/schema.prisma')).toBe(false);
    });

    it('แปลงผลของ git ได้ รวมถึงไฟล์ไบนารีที่รายงานเป็น -', () => {
      const rows = parseNumstat(['10\t2\tsrc/a.ts', '-\t-\tdocs/x.png', ''].join('\n'));
      expect(rows).toEqual([
        { path: 'src/a.ts', added: 10, removed: 2 },
        { path: 'docs/x.png', added: 0, removed: 0 },
      ]);
    });

    /**
     * **ไฟล์ใหม่ที่ยังไม่ถูก track ต้องนับด้วย**
     *
     * `git diff HEAD` ไม่เห็นมันเลย · รอบแรกที่เขียนด่านนี้ ทดลองวางไฟล์ใหม่
     * 500 บรรทัดแล้วเทสต์ยังเขียว — ซึ่งแปลว่าด่านจะปล่อยผ่านคอมมิตที่
     * ประกอบด้วยไฟล์ใหม่ทั้งหมด อันเป็นหน้าตาของคอมมิตที่ใหญ่เกินทุกใบ
     * ที่ผ่านมา · **เจอเพราะพิสูจน์ว่าเทสต์แดงได้ ไม่ใช่เพราะอ่านโค้ด**
     */
    it('**ไฟล์ใหม่ที่ยังไม่ถูก track นับเป็นบรรทัดที่เพิ่ม**', () => {
      const rows = untrackedRows(['new.ts'], () => 500);
      expect(measure(rows).total).toBe(500);
    });

    /**
     * **ชื่อไฟล์ภาษาไทยต้องนับได้**
     *
     * ค่าปริยายของ git แปลงชื่อที่ไม่ใช่ ASCII เป็นรหัสฐานแปดในเครื่องหมาย
     * คำพูด (`"apps/\340\270..."`) · ถ้าไม่ปิด `core.quotepath` ไฟล์แบบนั้น
     * จะอ่านไม่ออก ถูกนับเป็น 0 บรรทัด และ **ด่านจะมองไม่เห็นมันเลย** ·
     * โปรเจกต์นี้เขียนเป็นภาษาไทยทั้งใบ จึงเป็นรูที่เปิดอยู่จริง
     */
    it('**ชื่อไฟล์ภาษาไทยไม่ถูกนับเป็นศูนย์**', () => {
      const rows = parseNumstat('12	3	apps/api/src/scripts/ตัวอย่าง.ts');
      expect(rows[0]?.path).toBe('apps/api/src/scripts/ตัวอย่าง.ts');
      expect(measure(rows).total).toBe(15);
    });

    it('รายงานบอกไฟล์ที่ใหญ่ที่สุด ไม่ใช่บอกแค่ว่าเกิน', () => {
      const text = report(measure([{ path: 'big.ts', added: 500, removed: 0 }]));
      expect(text).toContain('big.ts');
      expect(text).toContain('500');
    });
  });

  describe('B · ด่านจริง', () => {
    /**
     * **หัวใจของไฟล์นี้**
     *
     * วัด **สิ่งที่ยังไม่ได้คอมมิต** ไม่ใช่คอมมิตล่าสุด — เวลาที่กฎนี้
     * มีประโยชน์คือ *ก่อน* ลงมือคอมมิต · คอมมิตแล้วต้นไม้สะอาด ตัวเลข
     * เป็น 0 และผ่านเอง ซึ่งถูกต้อง เพราะของที่คอมมิตไปแล้วแตกไม่ได้อีก
     *
     * ถ้าเทสต์นี้แดง **อย่าขยายเพดาน** — แตกงานเป็นหลายคอมมิตที่แต่ละใบ
     * สมบูรณ์ในตัว ตามที่ §4 บอกไว้
     */
    it('**สิ่งที่รอคอมมิตต้องไม่เกินเพดาน**', () => {
      let raw = '';
      try {
        /*
          **`core.quotepath=false` จำเป็น** — ค่าปริยายของ git แปลงชื่อไฟล์
          ที่ไม่ใช่ ASCII เป็นรหัสฐานแปดในเครื่องหมายคำพูด · โปรเจกต์นี้
          ตั้งชื่อไฟล์เป็นภาษาไทยได้ และไฟล์แบบนั้นจะอ่านไม่ออก แล้วถูกนับ
          เป็น 0 บรรทัด — **ด่านจะมองไม่เห็นมันเลย** · เจอตอนพิสูจน์ว่า
          เทสต์แดงได้ ด้วยไฟล์ทดลองที่บังเอิญตั้งชื่อไทย
        */
        raw = execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '--numstat', 'HEAD'], {
          cwd: REPO,
          encoding: 'utf8',
        });
      } catch {
        /*
          ไม่มี git หรือไม่ใช่ repo — ข้ามไม่ได้เงียบ ๆ เพราะเทสต์ที่ผ่าน
          ทั้งที่ไม่ได้ตรวจอะไร คือสิ่งที่ CLAUDE.md ห้ามไว้ตรง ๆ ·
          แต่ที่นี่ต่างออกไป: `git` ไม่มี = สภาพแวดล้อมต่างจากที่ออกแบบไว้
          ไม่ใช่ของที่เราสร้างเองได้ · จึงล้มพร้อมบอกเหตุผล
        */
        throw new Error('รัน git ไม่ได้ — ด่านขนาด diff ตรวจอะไรไม่ได้เลย');
      }
      /*
        ไฟล์ใหม่ต้องถามแยก — `git diff` ไม่เห็นสิ่งที่ยังไม่ถูก track
      */
      const untracked = execFileSync(
        'git',
        ['-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard'],
        {
          cwd: REPO,
          encoding: 'utf8',
        },
      )
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter((x) => x !== '');
      const size = measure([
        ...parseNumstat(raw),
        ...untrackedRows(untracked, (p) => {
          try {
            return readFileSync(join(REPO, p), 'utf8').split(/\r?\n/).length;
          } catch {
            // ไฟล์ไบนารีหรืออ่านไม่ได้ — นับ 0 แต่ยังอยู่ในรายการ
            return 0;
          }
        }),
      ]);
      expect(size.total, report(size)).toBeLessThanOrEqual(MAX_DIFF_LINES);
    });
  });
});
