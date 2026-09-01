/**
 * ข้อกำหนดของการนำเข้าข้อมูลจาก Excel/CSV — **เขียนก่อนโค้ด**
 *
 * องค์กรนี้ทำงานอยู่บน LINE กับ Excel · วันแรกที่เปิดใช้ระบบ ของเก่าต้อง
 * ตามมาด้วย มิฉะนั้นทุกคนจะเปิด Excel ควบคู่ไปอีกปี
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 *   1. **ภาษาไทยที่ถอดรหัสผิด นำเข้าไปได้เรียบร้อย** — ไฟล์ที่ Excel ไทย
 *      บันทึกเป็น TIS-620 พออ่านเป็น UTF-8 จะกลายเป็นอักขระแทนที่ · ระบบ
 *      จะรับเข้าไปโดยไม่มี error แล้วไม่มีใครรู้จนกว่าจะค้นหาไม่เจอ
 *      — เป็นกับดักตัวเดียวกับที่ §9 ของ CLAUDE.md เคยเจอกับ `curl`
 *   2. **ค่าที่แมปไม่ได้ ถูกใส่ค่าเริ่มต้นให้เงียบ ๆ** — ตั๋วที่ไฟล์บอกว่า
 *      "ปิดแล้ว" กลายเป็น "ใหม่" และตั๋วที่มีเจ้าของกลายเป็นไม่มีใครถือ ·
 *      ประวัติที่กำลังย้ายมาเสียหายตั้งแต่วินาทีแรก
 *   3. **นำเข้าครึ่งไฟล์แล้วล้ม** — องค์กรอยู่ในสภาพครึ่ง ๆ กลาง ๆ
 *      โดยไม่มีใครบอกได้ว่าแถวไหนเข้าไปแล้ว
 *   4. **เลขบรรทัดผิดเมื่อมีฟิลด์ที่ขึ้นบรรทัดใหม่ข้างใน** — รายงานปัญหา
 *      ที่ชี้ผิดบรรทัด แย่กว่าไม่ชี้เลย เพราะคนจะไปแก้แถวที่ไม่ผิด
 */
import { describe, expect, it } from 'vitest';

import {
  BROKEN_TEXT_MARKER,
  parseCsv,
  planImport,
  type ImportCatalog,
} from './csv-import';

const catalog: ImportCatalog = {
  statuses: ['ใหม่', 'กำลังดำเนินการ', 'ปิดแล้ว'],
  priorities: ['สูง', 'กลาง', 'ต่ำ'],
  emails: ['somchai@example.co.th', 'malee@example.co.th'],
};

const HEAD = 'externalKey,summary,status,priority,reporterEmail';

function csv(...rows: string[]): string {
  return [HEAD, ...rows].join('\n');
}

// ============================================================

describe('นำเข้า CSV · A · การอ่านไฟล์', () => {
  it('อ่านหัวตารางและแถวข้อมูลได้', () => {
    const r = parseCsv(csv('A-1,เครื่องพิมพ์เสีย,ใหม่,สูง,somchai@example.co.th'));
    expect(r.header).toEqual(['externalKey', 'summary', 'status', 'priority', 'reporterEmail']);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.values[1]).toBe('เครื่องพิมพ์เสีย');
    // บรรทัดที่ 1 คือหัวตาราง แถวแรกจึงเป็นบรรทัดที่ 2
    expect(r.rows[0]?.line).toBe(2);
  });

  it('ฟิลด์ในเครื่องหมายคำพูดที่มีจุลภาคข้างใน ไม่ถูกตัด', () => {
    const r = parseCsv(csv('A-1,"เครื่องพิมพ์เสีย, กระดาษติดด้วย",ใหม่,สูง,somchai@example.co.th'));
    expect(r.rows[0]?.values[1]).toBe('เครื่องพิมพ์เสีย, กระดาษติดด้วย');
  });

  /**
   * **เลขบรรทัดต้องนับบรรทัดจริงในไฟล์**
   *
   * ฟิลด์ที่มีขึ้นบรรทัดใหม่ข้างในทำให้แถวหนึ่งกินหลายบรรทัด · รายงานปัญหา
   * ที่ชี้ผิดบรรทัด แย่กว่าไม่ชี้เลย เพราะคนจะไปแก้แถวที่ไม่ผิด
   */
  it('**ฟิลด์ที่ขึ้นบรรทัดใหม่ข้างใน ไม่ทำให้เลขบรรทัดของแถวถัดไปเพี้ยน**', () => {
    const r = parseCsv(
      csv(
        'A-1,"บรรทัดแรก\nบรรทัดสอง",ใหม่,สูง,somchai@example.co.th',
        'A-2,ปกติ,ใหม่,สูง,somchai@example.co.th',
      ),
    );
    expect(r.rows[0]?.values[1]).toBe('บรรทัดแรก\nบรรทัดสอง');
    expect(r.rows[0]?.line).toBe(2);
    // แถวแรกกินสองบรรทัด แถวที่สองจึงอยู่บรรทัดที่ 4
    expect(r.rows[1]?.line).toBe(4);
  });

  /** Excel ใส่ BOM ให้ทุกครั้งที่บันทึกเป็น "CSV UTF-8" */
  it('**BOM ของ Excel ไม่ติดไปกับชื่อคอลัมน์แรก**', () => {
    const r = parseCsv(`﻿${csv('A-1,ทดสอบ,ใหม่,สูง,somchai@example.co.th')}`);
    expect(r.header[0]).toBe('externalKey');
  });

  it('เครื่องหมายคำพูดซ้อนสองตัว หมายถึงคำพูดหนึ่งตัว', () => {
    const r = parseCsv(csv('A-1,"เขาบอกว่า ""ไม่ติด""",ใหม่,สูง,somchai@example.co.th'));
    expect(r.rows[0]?.values[1]).toBe('เขาบอกว่า "ไม่ติด"');
  });

  it('ท้ายบรรทัดแบบ Windows (CRLF) ไม่ติดมากับค่า', () => {
    const r = parseCsv(`${HEAD}\r\nA-1,ทดสอบ,ใหม่,สูง,somchai@example.co.th\r\n`);
    expect(r.rows[0]?.values[4]).toBe('somchai@example.co.th');
  });

  it('ไฟล์ที่มีแต่หัวตาราง ไม่ใช่ error แต่ไม่มีอะไรให้นำเข้า', () => {
    const r = parseCsv(HEAD);
    expect(r.rows).toEqual([]);
  });
});

// ============================================================

describe('นำเข้า CSV · B · ภาษาไทยที่ถอดรหัสผิด', () => {
  it('ภาษาไทยปกติ ผ่าน', () => {
    const p = planImport(parseCsv(csv('A-1,เครื่องพิมพ์เสีย,ใหม่,สูง,somchai@example.co.th')), catalog);
    expect(p.problems).toEqual([]);
    expect(p.ready).toHaveLength(1);
  });

  /**
   * **หัวใจของหมวดนี้**
   *
   * ไฟล์ที่ Excel ไทยบันทึกเป็น TIS-620 พออ่านเป็น UTF-8 ทุกไบต์ภาษาไทย
   * จะกลายเป็นอักขระแทนที่ (U+FFFD) · ระบบจะรับเข้าไปโดยไม่มี error
   * แล้วไม่มีใครรู้จนกว่าจะค้นหาไม่เจอ
   */
  it('**อักขระแทนที่แม้ตัวเดียว ปฏิเสธทั้งไฟล์**', () => {
    const p = planImport(
      parseCsv(csv(`A-1,เครื่องพิมพ์${BROKEN_TEXT_MARKER}เสีย,ใหม่,สูง,somchai@example.co.th`)),
      catalog,
    );
    expect(p.ready).toEqual([]);
    expect(p.problems[0]?.line).toBe(2);
    expect(p.problems[0]?.message).toContain('รหัสอักขระ');
  });

  /**
   * **ด่าน "หัวตารางเสีย" ต้องทำงานเอง ไม่ใช่ถูกด่าน "คอลัมน์ขาด" บังไว้**
   *
   * เคสเดิมทำให้ชื่อคอลัมน์ `summary` เพี้ยนไปด้วย ปัญหาที่รายงานจึงเป็น
   * "หัวตารางขาดคอลัมน์" ไม่ใช่ "รหัสอักขระผิด" · ลบด่านอักขระเสียออกแล้ว
   * ยังเขียว — เจอตอนลบกลไกทีละบรรทัด
   */
  it('**อักขระแทนที่ในหัวตาราง ปฏิเสธด้วยเหตุผลเรื่องรหัสอักขระ**', () => {
    const p = planImport(
      parseCsv(`${HEAD},หมายเหตุ${BROKEN_TEXT_MARKER}เพิ่ม`),
      catalog,
    );
    const first = p.problems.find((x) => x.line === 1);
    expect(first?.message).toContain('รหัสอักขระ');
  });

  it('แถวว่างท้ายไฟล์ที่ Excel ทิ้งไว้ ไม่ถูกนับเป็นข้อมูล', () => {
    const r = parseCsv(`${csv('A-1,ทดสอบ,ใหม่,สูง,somchai@example.co.th')}

`);
    expect(r.rows).toHaveLength(1);
  });
});

// ============================================================

describe('นำเข้า CSV · C · ค่าที่แมปไม่ได้', () => {
  /**
   * **ปฏิเสธ ไม่ใช่ใส่ค่าเริ่มต้นให้เงียบ ๆ**
   *
   * ตั๋วที่ไฟล์บอกว่า "ปิดแล้ว" กลายเป็น "ใหม่" คือประวัติที่เสียหาย
   * ตั้งแต่วินาทีแรกของการย้ายระบบ
   */
  it('**สถานะที่ไม่รู้จัก เป็นปัญหา พร้อมเลขบรรทัดและชื่อคอลัมน์**', () => {
    const p = planImport(
      parseCsv(csv('A-1,ทดสอบ,รอลูกค้าตอบ,สูง,somchai@example.co.th')),
      catalog,
    );
    expect(p.ready).toEqual([]);
    expect(p.problems[0]?.line).toBe(2);
    expect(p.problems[0]?.column).toBe('status');
    expect(p.problems[0]?.message).toContain('รอลูกค้าตอบ');
  });

  it('**ผู้แจ้งที่ไม่มีในระบบ เป็นปัญหา**', () => {
    const p = planImport(parseCsv(csv('A-1,ทดสอบ,ใหม่,สูง,ไม่มีคนนี้@example.co.th')), catalog);
    expect(p.problems[0]?.column).toBe('reporterEmail');
  });

  it('ความสำคัญที่ไม่รู้จัก เป็นปัญหา', () => {
    const p = planImport(parseCsv(csv('A-1,ทดสอบ,ใหม่,ด่วนมาก,somchai@example.co.th')), catalog);
    expect(p.problems[0]?.column).toBe('priority');
  });

  it('หัวข้อว่าง เป็นปัญหา', () => {
    const p = planImport(parseCsv(csv('A-1,   ,ใหม่,สูง,somchai@example.co.th')), catalog);
    expect(p.problems[0]?.column).toBe('summary');
  });

  it('ความสำคัญที่เว้นว่าง ผ่านได้ — ไม่ใช่ทุกองค์กรกรอกช่องนี้', () => {
    const p = planImport(parseCsv(csv('A-1,ทดสอบ,ใหม่,,somchai@example.co.th')), catalog);
    expect(p.problems).toEqual([]);
    expect(p.ready[0]?.priority).toBeNull();
  });

  /** นำเข้าซ้ำเกิดขึ้นจริง — คีย์ซ้ำในไฟล์เดียวกันคือความผิดพลาดของไฟล์ */
  it('**คีย์ภายนอกซ้ำกันในไฟล์เดียว เป็นปัญหา และบอกทั้งสองบรรทัด**', () => {
    const p = planImport(
      parseCsv(
        csv('A-1,ทดสอบ,ใหม่,สูง,somchai@example.co.th', 'A-1,ซ้ำ,ใหม่,สูง,somchai@example.co.th'),
      ),
      catalog,
    );
    expect(p.problems[0]?.line).toBe(3);
    expect(p.problems[0]?.message).toContain('2');
  });

  it('คอลัมน์ที่ขาดไปจากหัวตาราง เป็นปัญหาของทั้งไฟล์', () => {
    const p = planImport(parseCsv('externalKey,summary\nA-1,ทดสอบ'), catalog);
    expect(p.problems.some((x) => x.line === 1 && x.message.includes('status'))).toBe(true);
  });
});

// ============================================================

describe('นำเข้า CSV · D · ทั้งไฟล์หรือไม่เอาเลย', () => {
  /**
   * **มีปัญหาแม้ข้อเดียว ก็ไม่นำเข้าอะไรเลย**
   *
   * การนำเข้าครึ่งไฟล์ทำให้องค์กรอยู่ในสภาพครึ่ง ๆ กลาง ๆ โดยไม่มีใครบอกได้
   * ว่าแถวไหนเข้าไปแล้ว · ให้แก้ไฟล์แล้วนำเข้าใหม่ทั้งไฟล์ดีกว่า
   */
  it('**สองแถวถูก หนึ่งแถวผิด = ไม่นำเข้าเลยสักแถว**', () => {
    const p = planImport(
      parseCsv(
        csv(
          'A-1,ถูก,ใหม่,สูง,somchai@example.co.th',
          'A-2,ผิด,ไม่มีสถานะนี้,สูง,somchai@example.co.th',
          'A-3,ถูก,ใหม่,สูง,malee@example.co.th',
        ),
      ),
      catalog,
    );
    expect(p.ready).toEqual([]);
    expect(p.problems).toHaveLength(1);
    // แต่ยังบอกว่าถ้าแก้แล้วจะได้กี่แถว
    expect(p.wouldImport).toBe(3);
  });

  it('ทุกแถวถูก = พร้อมนำเข้าครบ', () => {
    const p = planImport(
      parseCsv(
        csv('A-1,หนึ่ง,ใหม่,สูง,somchai@example.co.th', 'A-2,สอง,ปิดแล้ว,,malee@example.co.th'),
      ),
      catalog,
    );
    expect(p.problems).toEqual([]);
    expect(p.ready.map((r) => r.externalKey)).toEqual(['A-1', 'A-2']);
    expect(p.wouldImport).toBe(2);
  });

  it('ไม่แก้ข้อมูลที่รับเข้ามา', () => {
    const parsed = parseCsv(csv('A-1,ทดสอบ,ใหม่,สูง,somchai@example.co.th'));
    const snapshot = JSON.stringify(parsed);
    planImport(parsed, catalog);
    expect(JSON.stringify(parsed)).toBe(snapshot);
  });
});
