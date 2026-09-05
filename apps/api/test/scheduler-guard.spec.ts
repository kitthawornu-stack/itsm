/**
 * ตัวตั้งเวลาทุกตัวต้องเคารพสวิตช์รวม
 *
 * ## ทำไมต้องมีไฟล์นี้
 *
 * เทสต์สองไฟล์ยกแอปทั้งตัวขึ้นในโปรเซสเพื่อไล่ยิงทุกเส้นทาง · การยกแอปขึ้น
 * **สตาร์ตตัวตั้งเวลาทุกตัวไปด้วย** แล้วมันแตะฐานข้อมูลเดียวกับที่ไฟล์เทสต์อื่น
 * กำลังใช้อยู่ — ทำให้ CI แดงเป็นบางครั้งด้วยเหตุผลที่ไม่เกี่ยวกับโค้ดที่เพิ่งแก้
 *
 * ตัวที่ชนกันชัดที่สุดคือ `automation.scheduler` ซึ่งเรียก `scanIdleItems`
 * ตามเวลา — เป็นฟังก์ชันเดียวกับที่ `automation-scan.spec.ts` ทดสอบ
 *
 * **ตัวตั้งเวลาใหม่ที่ใครเพิ่มทีหลังจะเริ่มทำงานในเทสต์ทันทีโดยไม่มีใครนึกถึง** ·
 * ไฟล์นี้คือด่านที่ทำให้ลืมไม่ได้ — ไฟล์ `*.scheduler.ts` ทุกไฟล์ต้องเรียก
 * `schedulersEnabled()` มิฉะนั้น CI แดง
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { schedulersEnabled, SCHEDULERS_OFF } from '../src/infrastructure/scheduler/enabled';

/** ขึ้นบรรทัดใหม่ — เขียนแยกไว้เพราะสคริปต์ที่สร้างไฟล์นี้เคยกลืน escape ไปแล้วสองรอบ */
const NL = String.fromCharCode(10);

function schedulerFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.scheduler.ts')) out.push(p);
    }
  };
  walk('src');
  return out;
}

/**
 * `try` ก้อนนอกสุดใน `tick()` มี `catch` รับหรือไม่
 *
 * เดินนับปีกกาเพื่อหาจุดจบของ `try` ก้อนนั้นจริง ๆ แล้วดูว่าคำถัดไป
 * คือ `catch` หรือไม่ · **การหาแค่ว่า "มี catch ที่ไหนสักแห่ง" ไม่พอ**
 * เพราะลูปด้านในมักมี catch ของตัวเอง แล้วก้อนนอกที่ไม่มีอะไรรับ
 * จะถูกปล่อยผ่าน — ซึ่งเป็นรูปแบบที่ทำให้ API ตายมาแล้วจริง
 *
 * ไฟล์ที่ไม่มี `tick()` ถือว่าผ่าน — ไม่ใช่ทุกตัวตั้งเวลาต้องชื่อนี้
 */
export function outerTryHasCatch(src: string): boolean {
  const at = src.indexOf('async tick(');
  if (at === -1) return true;
  const tryAt = src.indexOf('try {', at);
  if (tryAt === -1) return true;
  let depth = 0;
  for (let i = src.indexOf('{', tryAt); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return /^\s*catch/.test(src.slice(i + 1));
    }
  }
  return false;
}

describe('สวิตช์รวมของงานเบื้องหลัง', () => {
  it('ค่าปริยายคือเปิด — สวิตช์ที่ปิดโดยปริยายทำให้ production เงียบสนิท', () => {
    expect(schedulersEnabled({})).toBe(true);
    expect(schedulersEnabled({ SCHEDULERS: 'on' })).toBe(true);
  });

  it('ปิดได้ด้วยค่าเดียวที่กำหนดไว้', () => {
    expect(schedulersEnabled({ SCHEDULERS: SCHEDULERS_OFF })).toBe(false);
  });

  /** ค่าที่พิมพ์ผิดต้องไม่ปิด — การปิดโดยไม่ตั้งใจเงียบกว่าการเปิดโดยไม่ตั้งใจ */
  it('**ค่าที่พิมพ์ผิดไม่ปิด**', () => {
    expect(schedulersEnabled({ SCHEDULERS: 'OFF' })).toBe(true);
    expect(schedulersEnabled({ SCHEDULERS: 'false' })).toBe(true);
  });

  it('**ตัวสแกนหาไฟล์ตัวตั้งเวลาเจอจริง** — ไม่ใช่ผ่านเพราะรายการว่าง', () => {
    expect(schedulerFiles().length, 'หาไฟล์ `*.scheduler.ts` ไม่เจอ').toBeGreaterThan(3);
  });

  /**
   * **ด่านหลัก**
   *
   * ตัวตั้งเวลาที่ไม่เรียก `schedulersEnabled()` จะทำงานระหว่างเทสต์
   * แล้วแตะข้อมูลที่ไฟล์อื่นกำลังใช้ — ซึ่งเป็นบั๊กที่โผล่เป็นบางครั้ง
   */
  it('**ทุกตัวตั้งเวลาต้องเรียก `schedulersEnabled()`**', () => {
    const missing = schedulerFiles().filter(
      (f) => !readFileSync(f, 'utf8').includes('schedulersEnabled'),
    );
    expect(
      missing,
      ['ตัวตั้งเวลาที่ไม่เคารพสวิตช์รวม:', ...missing].join('\n'),
    ).toEqual([]);
  });

  /**
   * **ตัวตั้งเวลาต้องไม่ทำให้โปรเซสตาย**
   *
   * ทุกตัวเรียก `tick()` ด้วย `void` · promise ที่ถูกปฏิเสธจึงกลายเป็น
   * unhandled rejection ซึ่ง **Node 22 ปิดโปรเซสทิ้ง** · ตัวตั้งเวลาที่
   * ไม่ดัก error จึงเปลี่ยนความผิดพลาดชั่วคราวให้เป็นระบบล่ม
   *
   * **เกิดขึ้นจริง**: ฐานข้อมูลสะดุดชั่วขณะ แล้ว `automation.scheduler`
   * โยนออกมาจาก `try/finally` ที่ไม่มี `catch` — API ตายทั้งตัว ขณะที่
   * worker รอดเพราะดักไว้ · ลูปด้านในของมันดักทีละองค์กรอยู่แล้ว
   * **แต่การอ่านรายชื่อองค์กรอยู่นอกลูป** จึงไม่มีอะไรรับ
   *
   * เกณฑ์คือ **มี `catch` อยู่ในไฟล์** ไม่ใช่มี `try` — `try/finally`
   * ที่ไม่มี `catch` คือรูปแบบที่ทำให้เกิดเรื่องนี้พอดี
   */
  it('**ทุกตัวตั้งเวลาต้องดัก error ไม่ให้หลุดออกจาก tick()**', () => {
    const bad = schedulerFiles().filter((f) => !outerTryHasCatch(readFileSync(f, 'utf8')));
    expect(bad, ['ตัวตั้งเวลาที่ error หลุดออกจาก tick() ได้:', ...bad].join(NL)).toEqual([]);
  });

  /*
    **probe ทั้งสองทิศ** · รอบแรกเกณฑ์คือ "มี `} catch` ที่ไหนก็ได้หลัง
    `async tick(`" ซึ่ง **หลวมเกินไป** — ลูปด้านในของ automation.scheduler
    มี catch ของตัวเองอยู่แล้ว ตัวสแกนจึงเขียวทั้งที่ถอดกลไกออก
    · เจอเพราะพิสูจน์ว่าแดงได้ ไม่ใช่เพราะอ่านโค้ด
  */
  it('probe · จับ try/finally ที่ไม่มี catch ได้ แม้ข้างในจะมี catch', () => {
    const withInner = [
      'async tick(): Promise<void> {',
      '  try {',
      '    for (const t of xs) {',
      '      try { await go(t); } catch (e) { log(e); }',
      '    }',
      '  } finally { this.running = false; }',
      '}',
    ].join(NL);
    expect(outerTryHasCatch(withInner), 'ปล่อยผ่าน try/finally ที่มี catch ข้างใน').toBe(false);
  });

  it('probe · ไม่จับตัวที่ดักไว้ถูกต้อง', () => {
    const ok = [
      'async tick(): Promise<void> {',
      '  try {',
      '    await go();',
      '  } catch (e) { this.log.error(e); } finally { this.running = false; }',
      '}',
    ].join(NL);
    expect(outerTryHasCatch(ok)).toBe(true);
  });

  it('probe · ตัวสแกนหา tick() เจอจริง', () => {
    const withTick = schedulerFiles().filter((f) => readFileSync(f, 'utf8').includes('async tick('));
    expect(withTick.length, 'หา tick() ไม่เจอสักไฟล์ — ตัวสแกนพัง').toBeGreaterThan(3);
  });
});
