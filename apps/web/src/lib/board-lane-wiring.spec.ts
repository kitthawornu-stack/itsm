/**
 * ด่านของการ **ต่อสาย** เลนเข้ากับกระดาน
 *
 * `swimlanes.spec.ts` พิสูจน์ตรรกะการแบ่งเลน แต่ไม่ได้พิสูจน์ว่าหน้าจอ
 * ส่งอะไรให้ `BoardView` · เทสต์ในโปรเจกต์นี้รันบน environment `node`
 * จึงเรนเดอร์ JSX ไม่ได้ — ด่านของการต่อสายจึงเป็น **ตัวสแกนซอร์ส**
 * แบบเดียวกับ `ui-boundary.spec.ts`
 *
 * สองอย่างที่ผิดแล้วเงียบ:
 *
 *   1. **คำอธิบายปุ่มลัดซ้ำทุกเลน** — ห้าเลนได้ห้าชุด · ไม่มี error
 *      ไม่มีเทสต์ไหนแดง เห็นได้ทางเดียวคือเปิดดู
 *   2. **คอลัมน์ทุกเลนมี `aria-label` เหมือนกันหมด** — คนที่ไล่ด้วย
 *      คีย์บอร์ดได้ยิน "New" ห้าครั้งโดยไม่รู้ว่าอันไหนของใคร ·
 *      เป็นอาการเดียวกับปุ่ม "ถอด" ที่เหมือนกันทุกบรรทัดใน CLAUDE.md
 *      และไม่มีเครื่องมือไหนบอกเลย
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const PAGE = join(__dirname, '..', 'app', '(app)', 'board', '[key]', 'page.tsx');
const VIEW = join(__dirname, '..', 'components', 'board-view.tsx');

const page = readFileSync(PAGE, 'utf8');
const view = readFileSync(VIEW, 'utf8');

describe('การต่อสายเลนเข้ากับกระดาน', () => {
  /*
    **probe ทั้งสองทิศ** — ตัวสแกนโกหกได้สองทาง · ทางที่หาไม่เจอเลย
    จะรายงานว่าทุกอย่างพัง (สังเกตง่าย) · ทางที่หาเจอไปหมดจะรายงานว่า
    ทุกอย่างเรียบร้อย ซึ่งเป็นทางที่อันตรายกว่า
  */
  it('probe · อ่านไฟล์ได้จริงและเจอสิ่งที่รู้ว่ามี', () => {
    expect(page).toContain('splitLanes');
    expect(view).toContain('board-help');
  });

  it('probe · ไม่เจอสิ่งที่รู้ว่าไม่มี', () => {
    expect(page).not.toContain('ชื่อที่ไม่มีทางอยู่ในไฟล์นี้');
    expect(view).not.toContain('ชื่อที่ไม่มีทางอยู่ในไฟล์นี้');
  });

  it('**คำอธิบายปุ่มลัดแสดงเลนเดียว ไม่ใช่ทุกเลน**', () => {
    expect(view, '`BoardView` ไม่มีสวิตช์ปิดคำอธิบาย').toContain('showHelp');
    expect(page, 'หน้ากระดานไม่ได้สั่งให้แสดงเลนเดียว').toMatch(/showHelp=\{i === 0\}/);
  });

  it('**คอลัมน์ของแต่ละเลนมีชื่อต่างกันสำหรับ screen reader**', () => {
    expect(view, '`BoardView` ไม่ได้รับชื่อเลน').toContain('laneLabel');
    expect(view, '`aria-label` ของคอลัมน์ไม่ได้ต่อชื่อเลน').toMatch(
      /aria-label=\{laneLabel === null \? col\.name : `\$\{col\.name\}/,
    );
    expect(page, 'หน้ากระดานไม่ได้ส่งชื่อเลนให้').toMatch(/laneLabel=\{l\.label\}/);
  });

  /*
    ชื่อเลนต้องไม่ซ้ำกัน มิฉะนั้นการต่อท้าย `aria-label` ก็ไม่ช่วยอะไร ·
    `splitLanes` ประกอบชื่อจาก `Set` จึงไม่ซ้ำโดยโครงสร้าง — เทสต์นี้
    ยืนยันว่ายังเป็นแบบนั้นอยู่ ไม่ใช่เชื่อคำอธิบาย
  */
  it('ชื่อเลนไม่ซ้ำกัน', async () => {
    const { splitLanes } = await import('./swimlanes');
    const lanes = splitLanes(
      [
        {
          statusId: '1',
          name: 'ใหม่',
          category: 'TODO',
          cards: [
            { itemKey: 'A', summary: 'ก', assignee: 'สมชาย', priority: null, rank: 'a' },
            { itemKey: 'B', summary: 'ข', assignee: 'สมชาย', priority: null, rank: 'b' },
            { itemKey: 'C', summary: 'ค', assignee: null, priority: null, rank: 'c' },
          ],
        },
      ],
      'assignee',
    );
    expect(new Set(lanes.map((l) => l.label)).size).toBe(lanes.length);
  });
});
