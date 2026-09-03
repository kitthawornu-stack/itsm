/**
 * ด่านของช่องตั้งเพดาน — **อ่านซอร์ส**
 *
 * เทสต์ของ web รันบน environment `node` จึงเรนเดอร์ JSX ไม่ได้ · สองอย่างที่
 * ผิดแล้วเงียบและเคยเกิดขึ้นจริงในโปรเจกต์นี้:
 *
 *   1. **ตัวช่วยส่งข้อมูลที่กลืน error แล้วคืน `void`** — promise ของมัน
 *      สำเร็จเสมอ · ผู้เรียกที่เขียน `send(...).then(() => ปิดฟอร์ม())`
 *      จึงปิดฟอร์มทั้งตอนที่เซิร์ฟเวอร์รับและตอนที่ปฏิเสธ ผู้ใช้เสียทุกอย่าง
 *      ที่พิมพ์เพราะพิมพ์ผิดช่องเดียว (บทเรียนใน CLAUDE.md)
 *   2. **ค่าปริยายของสิทธิ์ที่เปิดไว้** — หน้าจอใหม่ที่ลืมส่ง `canManage`
 *      จะแสดงช่องกรอกให้ทุกคน แล้วคนที่กดได้ 403 · การไม่รู้ต้องแปลว่าไม่ได้
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const EDITOR = join(__dirname, '..', 'components', 'wip-limit-editor.tsx');
const VIEW = join(__dirname, '..', 'components', 'board-view.tsx');
const PAGE = join(__dirname, '..', 'app', '(app)', 'board', '[key]', 'page.tsx');

const editor = readFileSync(EDITOR, 'utf8');
const view = readFileSync(VIEW, 'utf8');
const page = readFileSync(PAGE, 'utf8');

describe('การต่อสายช่องตั้งเพดาน', () => {
  it('probe · อ่านทั้งสามไฟล์ได้จริง', () => {
    expect(editor).toContain('WipLimitEditor');
    expect(view).toContain('board-col-head');
    expect(page).toContain('BoardView');
  });

  it('probe · ไม่เจอสิ่งที่รู้ว่าไม่มี', () => {
    expect(editor).not.toContain('ชื่อที่ไม่มีทางอยู่ในไฟล์นี้');
  });

  /**
   * **`send` ต้องคืนว่าสำเร็จหรือไม่ ไม่ใช่ `void`**
   *
   * และการปิดฟอร์มต้องผูกกับ "เซิร์ฟเวอร์รับแล้ว" ไม่ใช่ "เรียกฟังก์ชันเสร็จ"
   * ซึ่งเป็นคนละเรื่องกัน
   */
  it('**ตัวส่งข้อมูลคืนผลสำเร็จ ไม่ใช่ void**', () => {
    expect(editor, 'send() คืน void — ผู้เรียกแยกสำเร็จจากล้มเหลวไม่ได้').toMatch(
      /async function send\([^)]*\): Promise<boolean>/,
    );
    expect(editor, 'ปิดฟอร์มโดยไม่ดูว่าเซิร์ฟเวอร์รับหรือยัง').toMatch(/if \(!ok\) return;/);
  });

  /**
   * **ค่าปริยายของ `canManage` ต้องเป็นเท็จ**
   *
   * กติกาเดียวกับสิทธิ์ทุกข้อในโปรเจกต์นี้: ข้อมูลที่ไม่ครบต้องแปลว่าไม่มีสิทธิ์
   */
  it('**canManage มีค่าปริยายเป็นเท็จ**', () => {
    expect(view, 'ค่าปริยายเปิดไว้ — หน้าจอที่ลืมส่งจะแสดงช่องกรอกให้ทุกคน').toMatch(
      /canManage = false,/,
    );
    expect(page, 'หน้ากระดานไม่ได้ส่งค่าจากเซิร์ฟเวอร์').toMatch(/canManage=\{data\.canManage\}/);
  });

  /**
   * ช่องกรอกและปุ่มทุกตัวมีชื่อสำหรับ screen reader ที่ **มีชื่อคอลัมน์อยู่ด้วย**
   *
   * กระดานมีห้าคอลัมน์ แต่ละคอลัมน์มีปุ่ม "ตั้งเพดาน" เหมือนกันหมด · คนที่ไล่
   * ด้วยคีย์บอร์ดจะได้ยิน "ตั้งเพดาน" ห้าครั้งโดยไม่รู้ว่าอันไหนของคอลัมน์ไหน
   * — อาการเดียวกับปุ่ม "ถอด" ใน CLAUDE.md
   */
  it('**ชื่อสำหรับ screen reader มีชื่อคอลัมน์กำกับทุกปุ่ม**', () => {
    /*
      อ่านเป็น **หน้าต่างหลังตำแหน่งที่เจอ** ไม่ใช่ "ที่เหลือของบรรทัด" —
      รอบแรกเขียนแบบหลัง แล้วมันจับค่าว่างจาก `ariaLabel={` ที่ขึ้นบรรทัดใหม่
      แล้วรายงานว่าไม่มีชื่อคอลัมน์ ทั้งที่มี
    */
    const at = [...editor.matchAll(/ariaLabel=/g)].map((m) => m.index);
    expect(at.length, 'ไม่มี ariaLabel เลย').toBeGreaterThanOrEqual(4);
    for (const i of at) {
      const window = editor.slice(i, i + 220);
      expect(window, `ariaLabel ไม่มีชื่อคอลัมน์: ${window.slice(0, 60)}`).toContain('column');
    }
    /*
      ต้องเป็น `ariaLabel` ไม่ใช่ `aria-label` — TypeScript ไม่ตรวจแอตทริบิวต์
      ที่มีขีดกลางใน JSX มันจึงผ่าน typecheck แล้วหายไปตอนเรนเดอร์
    */
    expect(editor, 'ใช้ aria-label ซึ่งคอมโพเนนต์ของเราไม่รับ').not.toMatch(/aria-label=/);
  });
});
