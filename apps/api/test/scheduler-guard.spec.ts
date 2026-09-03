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
});
