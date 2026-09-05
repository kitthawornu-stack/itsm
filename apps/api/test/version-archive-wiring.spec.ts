/**
 * ปุ่มเก็บรุ่นเข้าคลังต่อสายจริง — ตรวจด้วยการสแกนซอร์ส
 *
 * **ทำไมไม่กดในเบราว์เซอร์**: `MANAGE_PROJECT` ยังไม่มีกลุ่มไหนได้เลยในข้อมูล
 * ตั้งต้น (0 แถว) — ไม่มีผู้ใช้คนไหนกดปุ่มนี้ได้ เช่นเดียวกับ WIP limit ·
 * Quick Filter · นำเข้า CSV · ปล่อยรุ่น · ตัวสแกนจับ "ต่อสายผิด" ได้
 * แต่ไม่จับ "หน้าตาถูกไหม" — ด่านต้องบอกเองว่าไม่ครอบอะไร
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = readFileSync(
  join(__dirname, '..', '..', '..', 'apps', 'web', 'src', 'components', 'version-board.tsx'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ');

describe('ปุ่มเก็บรุ่นเข้าคลัง · ต่อสายแล้ว', () => {
  it('probe · อ่านไฟล์ถูกตัว และตัวถอดคอมเมนต์ไม่ได้กินทุกอย่าง', () => {
    expect(SRC).toContain('/reopen');
    expect(SRC.length).toBeGreaterThan(2_000);
  });

  it('probe · ไม่จับของที่อยู่ในคอมเมนต์', () => {
    // หัวไฟล์ฝั่ง web อธิบายกติกาไว้ในคอมเมนต์ ซึ่งต้องไม่ถูกนับเป็นการต่อสาย
    expect(SRC).not.toContain('เซิร์ฟเวอร์ปฏิเสธอยู่แล้ว');
  });

  it('**เรียก endpoint เก็บเข้าคลังจริง และส่งค่าที่จะเปลี่ยนไป**', () => {
    expect(SRC).toContain('/archive');
    expect(SRC).toMatch(/archived:\s*!v\.archived/);
  });

  it('**แสดงจำนวนงานค้างที่เซิร์ฟเวอร์ส่งกลับ** — ไม่ใช่แค่รู้ว่าสำเร็จ', () => {
    expect(SRC).toContain('unfinished');
    // ศูนย์ต้องพูดออกมา ไม่ใช่เงียบ
    expect(SRC).toContain('ไม่มีงานค้างในรุ่นนี้');
  });

  it('รุ่นในคลังไม่แสดงปุ่มปล่อย — ปุ่มที่กดแล้วได้ error คือหน้าจอที่หลอกคน', () => {
    expect(SRC).toMatch(/v\.archived \? null :/);
  });
});
