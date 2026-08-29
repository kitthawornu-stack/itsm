/**
 * ดัชนีค้นหายังใช้ได้อยู่ไหม — เทสต์เป็นข้อกำหนด
 *
 * เขียนขึ้นจากเหตุการณ์จริง: ดัชนีหายหลัง Docker รีสตาร์ต ทุกการค้นตอบ 503
 * แต่ `/health` ตอบ `ok` ตลอด **เพราะมันเช็คคลัสเตอร์ ไม่ใช่ดัชนี** และคลัสเตอร์
 * ตอนนั้นปกติดีทุกอย่าง
 *
 * สี่ข้อที่ต้องถูก:
 *
 *   1. **คลัสเตอร์ปกติ ไม่ได้แปลว่าค้นหาได้** — เคสที่ตัวตรวจเดิมพลาดทั้งหมด
 *   2. **"ว่างเพราะเพิ่งติดตั้ง" ต้องไม่ถูกรายงานว่าพัง** — คำเตือนที่ผิดบ่อย
 *      สอนให้คนเลิกอ่าน แล้ววันที่มันเตือนจริงก็ไม่มีใครสนใจ
 *   3. **ต่างกันเล็กน้อยเป็นเรื่องปกติ** — ดัชนีตามหลังฐานข้อมูลได้เสมอ
 *   4. **ข้อความต้องบอกว่าต้องทำอะไรต่อ** ไม่ใช่แค่ว่าเกิดอะไรขึ้น
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { judgeIndexHealth, needsAttention, REINDEX_HINT } from './index-health';

function judge(over: Partial<Parameters<typeof judgeIndexHealth>[0]> = {}) {
  return judgeIndexHealth({
    clusterUp: true,
    indexExists: true,
    indexedDocs: 100,
    itemsInDatabase: 100,
    ...over,
  });
}

describe('A · เคสที่ตัวตรวจเดิมพลาด', () => {
  it('**คลัสเตอร์ปกติแต่ดัชนีหาย = พัง**', () => {
    /*
      เคสที่เกิดจริงและตัวตรวจเดิมรายงานว่า `ok` · ตัวตรวจที่เช็คสิ่งที่ไม่พัง
      แล้วบอกว่าปกติ อันตรายกว่าไม่มีตัวตรวจ เพราะมันสร้างความมั่นใจที่ไม่มีมูล
    */
    const r = judge({ indexExists: false, indexedDocs: null });
    expect(r.state).toBe('missing');
    expect(r.detail).toContain(REINDEX_HINT);
  });

  it('**ดัชนีมีอยู่แต่ว่างเปล่าทั้งที่ฐานข้อมูลมีงาน = พัง**', () => {
    // ดัชนีที่ถูกสร้างใหม่แต่ยังไม่ได้ใส่ข้อมูล หน้าตาเหมือนดัชนีที่ใช้ได้ทุกอย่าง
    const r = judge({ indexedDocs: 0, itemsInDatabase: 10_000 });
    expect(r.state).toBe('missing');
    expect(r.detail).toContain('10000');
  });

  it('**ดัชนีหาย ยังพังแม้ยังไม่มีงานสักใบ**', () => {
    /*
      เคสนี้คือเคสเดียวที่แยก "ไม่มีดัชนี" ออกจาก "ดัชนีว่างทั้งที่มีงาน" ได้ ·
      ถ้าไม่มีมัน การลบด่านตรวจ `indexExists` ทิ้ง จะยังเขียวทั้งไฟล์ เพราะ
      สาขา "ว่างเปล่าทั้งที่มีงาน" รับผลไว้แทน (พิสูจน์แล้วตอนลบทีละบรรทัด)

      และมันเป็นเคสจริง: ระบบที่เพิ่งติดตั้งแล้วดัชนียังไม่ถูกสร้าง การค้นครั้งแรก
      จะล้มทันที ไม่ใช่รอจนมีงานใบแรก
    */
    const r = judge({ indexExists: false, indexedDocs: null, itemsInDatabase: 0 });
    expect(r.state).toBe('missing');
    expect(r.detail).toContain(REINDEX_HINT);
  });

  it('ต่อคลัสเตอร์ไม่ได้ = คนละสถานะกับดัชนีหาย', () => {
    /*
      สองอย่างนี้แก้กันคนละแบบ — อันหนึ่งไปดูว่า container ขึ้นไหม
      อีกอันรัน reindex · ข้อความเดียวกันจะพาไปแก้ผิดที่
    */
    const r = judge({ clusterUp: false, indexExists: null, indexedDocs: null });
    expect(r.state).toBe('unreachable');
    expect(r.detail).not.toContain(REINDEX_HINT);
  });
});

describe('B · เคสที่ต้องไม่เตือน', () => {
  it('**ระบบที่เพิ่งติดตั้ง ดัชนีว่างคือเรื่องถูกต้อง**', () => {
    /*
      คำเตือนที่ผิดบ่อยสอนให้คนเลิกอ่าน แล้ววันที่มันเตือนจริงก็ไม่มีใครสนใจ
      เหมือนกัน — ราคาของการเตือนเกิน จ่ายทีหลังและจ่ายแพงกว่า
    */
    expect(judge({ indexedDocs: 0, itemsInDatabase: 0 }).state).toBe('up');
  });

  it('**ตามหลังฐานข้อมูลเล็กน้อยเป็นเรื่องปกติ**', () => {
    // งานที่เพิ่งสร้างยังไม่ถึงตัว indexer — เตือนทุกครั้งที่ต่างกันหนึ่งใบไม่มีใครอ่าน
    expect(judge({ indexedDocs: 9_995, itemsInDatabase: 10_000 }).state).toBe('up');
  });

  it('ระบบเล็กที่ต่างกันไม่กี่ใบ ก็ยังปกติ', () => {
    // เกณฑ์สัดส่วนอย่างเดียวจะเตือนตลอดเวลาบนระบบที่มีงานสิบใบ
    expect(judge({ indexedDocs: 3, itemsInDatabase: 10 }).state).toBe('up');
  });
});

describe('C · เคสที่ต้องเตือน', () => {
  it('**ต่างกันมากพอ = ค้างมานาน**', () => {
    const r = judge({ indexedDocs: 5_000, itemsInDatabase: 10_000 });
    expect(r.state).toBe('stale');
    expect(r.detail).toContain('5000');
    expect(r.detail).toContain(REINDEX_HINT);
  });

  it('ดัชนีมีมากกว่าฐานข้อมูล ก็ผิดเหมือนกัน', () => {
    /*
      งานที่ถูกลบแล้วแต่ยังค้างในดัชนี จะโผล่ในผลการค้นหาแล้วกดเข้าไปเจอ 404
      · ทิศทางของความต่างไม่สำคัญ ความต่างต่างหากที่สำคัญ
    */
    expect(judge({ indexedDocs: 10_000, itemsInDatabase: 5_000 }).state).toBe('stale');
  });
});

describe('D · สรุปว่าต้องมีคนทำอะไรไหม', () => {
  it('เฉพาะ `up` ที่ไม่ต้องทำอะไร', () => {
    expect(needsAttention('up')).toBe(false);
    for (const s of ['missing', 'stale', 'unreachable'] as const) {
      expect(needsAttention(s), s).toBe(true);
    }
  });

  it('**ทุกสถานะที่ผิดปกติ ต้องมีข้อความบอกทางแก้**', () => {
    // สถานะที่บอกแต่ว่าพัง โดยไม่บอกว่าทำอะไรต่อ ทำให้คนอ่านแล้วปิดไป
    const bad = [
      judge({ indexExists: false, indexedDocs: null }),
      judge({ indexedDocs: 0, itemsInDatabase: 100 }),
      judge({ indexedDocs: 1, itemsInDatabase: 100 }),
      judge({ clusterUp: false, indexExists: null, indexedDocs: null }),
    ];
    for (const r of bad) {
      expect(needsAttention(r.state), r.detail).toBe(true);
      expect(r.detail.length, r.detail).toBeGreaterThan(20);
    }
  });
});

describe('E · มีอะไรเรียกมันจริงไหม', () => {
  /*
    ตรรกะที่ถูกต้องแต่ไม่มีอะไรเรียก ก็ยังเงียบเหมือนเดิม — เทสต์ทุกข้อข้างบน
    เขียวได้โดยที่ `/health` ยังเช็คแต่คลัสเตอร์อยู่ · บทเรียนที่โครงการนี้
    เจอซ้ำที่สุด (CLAUDE.md §4)
  */
  const ROOT = join(__dirname, '..', '..');
  const health = readFileSync(join(ROOT, 'modules', 'health', 'health.controller.ts'), 'utf8');
  const appModule = readFileSync(join(ROOT, 'app.module.ts'), 'utf8');
  const watcher = readFileSync(join(__dirname, 'index-watch.scheduler.ts'), 'utf8');

  it('ตัวสแกนอ่านไฟล์เจอจริง', () => {
    expect(health).toContain('@Controller');
    expect(appModule).toContain('providers');
    expect(watcher).toContain('WATCH_INTERVAL_MS');
  });

  it('**`/health` ตรวจดัชนี ไม่ใช่แค่คลัสเตอร์**', () => {
    /*
      ดูที่ **ตำแหน่งเรียก** ไม่ใช่แค่ชื่อที่ปรากฏในไฟล์ · ชื่อยังอยู่ใน import
      แม้จะไม่มีใครเรียกแล้ว — พิสูจน์แล้วว่าเทสต์ที่หาแค่ชื่อ ยังเขียวตอนที่
      โค้ดถูกเปลี่ยนให้คืนรายการว่างแทนการเรียกจริง
    */
    expect(health).toContain('await indexHealthOfAll()');
    expect(health).toContain("components['search-index']");
  });

  it('**ตัวเฝ้าระวังถูกลงทะเบียนใน AppModule**', () => {
    // ประกาศคลาสไว้เฉย ๆ ไม่ทำให้ NestJS สร้างมันขึ้นมา
    const providers = /providers:\s*\[([\s\S]*?)\]\s*,?\s*\}\)/.exec(appModule)?.[1] ?? '';
    expect(providers).toContain('IndexWatchScheduler');
  });

  it('**ตัวเฝ้าระวังเตือนเมื่อสถานะเปลี่ยน ไม่ใช่ทุกนาที**', () => {
    // คำเตือนเดิมซ้ำทุกห้านาทีทำให้ log อ่านไม่ได้ แล้วคนเลิกอ่าน
    expect(watcher).toContain('if (before === row.state) continue;');
    // และต้องบอกตอนกลับมาปกติด้วย ไม่งั้นไม่มีใครรู้ว่าแก้สำเร็จหรือยัง
    expect(watcher).toContain('กลับมาปกติแล้ว');
  });
});
