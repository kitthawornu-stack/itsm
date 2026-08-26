/**
 * แฮชรหัสผ่าน — เทสต์เป็นข้อกำหนด
 *
 * เขียนจากมุมของคนที่พยายามเข้าโดยไม่รู้รหัสผ่าน
 * ทุกเคสที่นี่คือช่องทางที่เคยทำให้ระบบอื่นถูกเจาะมาแล้วจริง
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MIN_LENGTH,
  WeakPasswordError,
  assertPasswordAcceptable,
  hashPassword,
  needsRehash,
  verifyPassword,
} from './password';

const GOOD = 'ปลาทูอบเกลือสามตัว';

describe('hashPassword', () => {
  it('รหัสผ่านที่ถูกต้องตรวจผ่าน', async () => {
    expect(await verifyPassword(GOOD, await hashPassword(GOOD))).toBe(true);
  });

  it('รหัสผ่านผิดตรวจไม่ผ่าน', async () => {
    expect(await verifyPassword('ปลาทูอบเกลือสี่ตัว', await hashPassword(GOOD))).toBe(false);
  });

  it('**เกลือไม่ซ้ำ** — รหัสผ่านเดียวกันสองคน ต้องได้แฮชคนละอัน', async () => {
    // ถ้าซ้ำ ตารางรหัสผ่านที่รั่วจะบอกทันทีว่าใครใช้รหัสเดียวกัน
    // และเปิดทางให้ rainbow table ใช้ได้กับทั้งระบบพร้อมกัน
    const a = await hashPassword(GOOD);
    const b = await hashPassword(GOOD);
    expect(a).not.toBe(b);
    expect(await verifyPassword(GOOD, a)).toBe(true);
    expect(await verifyPassword(GOOD, b)).toBe(true);
  });

  it('พารามิเตอร์อยู่ในสตริงแฮช ไม่ใช่ในโค้ด', async () => {
    const h = await hashPassword(GOOD);
    const parts = h.split('$');
    expect(parts[0]).toBe('scrypt');
    expect(Number(parts[1])).toBeGreaterThanOrEqual(65_536);
    expect(parts).toHaveLength(6);
  });

  it('ไม่มีรหัสผ่านต้นฉบับหลงเหลือในแฮช', async () => {
    expect(await hashPassword(GOOD)).not.toContain(GOOD);
  });

  it('รูปแบบยูนิโค้ดต่างกันแต่ตัวอักษรเดียวกัน ตรวจผ่าน (NFKC)', async () => {
    // ผู้ใช้ไทย/แมคพิมพ์อักขระประกอบมาคนละรูปแบบได้ ทั้งที่เห็นเป็นตัวเดียวกัน
    const composed = 'éclair-ยาวพอสมควรนะ';
    const precomposed = 'éclair-ยาวพอสมควรนะ';
    expect(await verifyPassword(precomposed, await hashPassword(composed))).toBe(true);
  });
});

describe('assertPasswordAcceptable', () => {
  it(`สั้นกว่า ${String(PASSWORD_MIN_LENGTH)} ตัวถูกปฏิเสธ`, () => {
    expect(() => {
      assertPasswordAcceptable('สั้นไป');
    }).toThrow(WeakPasswordError);
  });

  it('ยาวพอผ่าน แม้ไม่มีอักขระพิเศษ — ความยาวคือสิ่งที่ได้ผลจริง', () => {
    expect(() => {
      assertPasswordAcceptable('correcthorsebatterystaple');
    }).not.toThrow();
  });

  it('ช่องว่างล้วนถูกปฏิเสธ แม้จะยาว', () => {
    expect(() => {
      assertPasswordAcceptable(' '.repeat(50));
    }).toThrow(WeakPasswordError);
  });

  it('ยาวเกินเพดานถูกปฏิเสธ — กัน DoS ตอนแฮช', () => {
    expect(() => {
      assertPasswordAcceptable('ก'.repeat(2000));
    }).toThrow(WeakPasswordError);
  });

  it('hashPassword ปฏิเสธรหัสผ่านอ่อนด้วย ไม่ใช่ตรวจแค่ที่ชั้นบน', async () => {
    await expect(hashPassword('123')).rejects.toThrow(WeakPasswordError);
  });
});

describe('verifyPassword · แฮชที่เสียหรือถูกดัดแปลง', () => {
  it.each([
    ['สตริงว่าง', ''],
    ['ไม่มีรูปแบบ', 'not-a-hash'],
    ['อัลกอริทึมอื่น', 'bcrypt$10$abc$def$ghi$jkl'],
    ['ส่วนไม่ครบ', 'scrypt$65536$8$1$onlysalt'],
    ['เกลือว่าง', 'scrypt$65536$8$1$$aGFzaA=='],
    ['แฮชว่าง', 'scrypt$65536$8$1$c2FsdA==$'],
    ['N ไม่ใช่ตัวเลข', 'scrypt$abc$8$1$c2FsdA==$aGFzaA=='],
  ])('**คืน false ไม่ใช่โยน error**: %s', async (_label, stored) => {
    // ผู้โจมตีต้องแยกไม่ออกระหว่าง "รหัสผิด" กับ "ข้อมูลในฐานข้อมูลเสีย"
    // ถ้าโยน error จะได้ 500 ซึ่งบอกว่าบัญชีนี้มีอยู่จริงแต่ข้อมูลผิดปกติ
    await expect(verifyPassword(GOOD, stored)).resolves.toBe(false);
  });

  it('แฮชที่ถูกแก้ให้ N สูงจนเกินหน่วยความจำถูกปฏิเสธ ไม่ใช่ค้างเครื่อง', async () => {
    const start = Date.now();
    expect(await verifyPassword(GOOD, 'scrypt$1073741824$8$1$c2FsdA==$aGFzaA==')).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('**แฮชที่ผ่าน maxmem ได้แต่ช้ามาก ก็ถูกปฏิเสธ** — นี่คือเคสที่ maxmem จับไม่ได้', async () => {
    // N=524288, r=2 ใช้ราว 134 MB ซึ่งต่ำกว่าเพดาน 256 MB จึงผ่าน maxmem ไปได้
    // แต่กินเวลาหลายวินาทีต่อการล็อกอินหนึ่งครั้ง = ทำให้เซิร์ฟเวอร์ใช้ไม่ได้
    // โดยแค่แก้แถวเดียวในฐานข้อมูล
    const start = Date.now();
    expect(await verifyPassword(GOOD, 'scrypt$524288$2$1$c2FsdA==$aGFzaA==')).toBe(false);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('แฮชของรหัสผ่านอื่นตรวจไม่ผ่าน', async () => {
    const other = await hashPassword('รหัสผ่านของคนอื่นที่ยาวพอ');
    expect(await verifyPassword(GOOD, other)).toBe(false);
  });

  it('แก้ไบต์เดียวในแฮชทำให้ตรวจไม่ผ่าน', async () => {
    const h = await hashPassword(GOOD);
    const parts = h.split('$');
    const key = Buffer.from(parts[5] ?? '', 'base64');
    key[0] = (key[0] ?? 0) ^ 0xff;
    parts[5] = key.toString('base64');
    expect(await verifyPassword(GOOD, parts.join('$'))).toBe(false);
  });
});

describe('needsRehash', () => {
  it('แฮชที่สร้างด้วยค่าปัจจุบันไม่ต้องทำใหม่', async () => {
    expect(needsRehash(await hashPassword(GOOD))).toBe(false);
  });

  it('แฮชที่ใช้ N ต่ำกว่าปัจจุบันต้องทำใหม่', () => {
    expect(needsRehash('scrypt$16384$8$1$c2FsdA==$aGFzaA==')).toBe(true);
  });

  it('แฮชจากอัลกอริทึมอื่นต้องทำใหม่', () => {
    expect(needsRehash('bcrypt$10$whatever')).toBe(true);
  });

  it('ค่าขยะต้องทำใหม่ ไม่ใช่ปล่อยผ่าน', () => {
    expect(needsRehash('')).toBe(true);
  });
});

/**
 * การเทียบแบบคงเวลา พิสูจน์ด้วยการวัดเวลาไม่ได้อย่างน่าเชื่อถือ
 *
 * เทสต์ที่วัดเวลาจริงจะแกว่งตามภาระเครื่องจน false positive บ่อยกว่าจับของจริง
 * และเทสต์ที่แดงสลับเขียวเองคือเทสต์ที่คนจะปิดทิ้งภายในสัปดาห์เดียว
 *
 * สิ่งที่ตรวจได้จริงคือ **โค้ดยังเรียก `timingSafeEqual` อยู่** — เพราะในเรื่องนี้
 * ตัวการรับประกันคือฟังก์ชันที่เลือกใช้ ไม่ใช่พฤติกรรมที่สังเกตจากข้างนอก
 * ถ้าใครเปลี่ยนไปใช้ `===` หรือ `.equals()` เทสต์นี้จะบอก
 */
describe('การเทียบต้องคงเวลา', () => {
  // API เป็น CommonJS จึงใช้ __dirname ไม่ใช่ import.meta
  const source = readFileSync(join(__dirname, 'password.ts'), 'utf8');

  it('verifyPassword เรียก timingSafeEqual', () => {
    expect(source).toContain('timingSafeEqual(actual, expected)');
  });

  it('ไม่มีการเทียบแฮชด้วย equals หรือ === ที่ไหนเลย', () => {
    expect(source).not.toMatch(/actual\.equals\(/);
    expect(source).not.toMatch(/actual === expected/);
  });
});
