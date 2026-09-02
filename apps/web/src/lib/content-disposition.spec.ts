/**
 * ข้อกำหนดของการอ่านชื่อไฟล์จาก `Content-Disposition`
 *
 * ทั้งหมดในไฟล์นี้พังแบบเงียบ — ไฟล์ยังดาวน์โหลดสำเร็จทุกกรณี
 * สิ่งที่ผิดคือชื่อของมัน ซึ่งไม่มีใครเห็นจนกว่าจะเปิดโฟลเดอร์
 */
import { describe, expect, it } from 'vitest';

import { filenameFrom } from './content-disposition';

describe('ชื่อไฟล์จาก Content-Disposition', () => {
  it('ไม่มีหัวเลย คืน null — ผู้เรียกตั้งชื่อเองได้', () => {
    expect(filenameFrom(null)).toBeNull();
  });

  it('มีแค่แบบ ASCII ก็อ่านได้', () => {
    expect(filenameFrom('attachment; filename="SD-2026-09-02.csv"')).toBe('SD-2026-09-02.csv');
  });

  /**
   * **หัวใจของไฟล์นี้**
   *
   * เซิร์ฟเวอร์ส่งทั้งสองแบบในบรรทัดเดียว · อ่านแบบ ASCII ก่อนจะได้ชื่อที่
   * ถูกแทนอักขระไทยทิ้งไปแล้ว โดยที่ทุกอย่างยัง "สำเร็จ"
   */
  it('**มีทั้งสองแบบ ต้องเอาแบบ UTF-8**', () => {
    const h =
      "attachment; filename=\"report.csv\"; filename*=UTF-8''%E0%B8%A3%E0%B8%B2%E0%B8%A2%E0%B8%87%E0%B8%B2%E0%B8%99.csv";
    expect(filenameFrom(h)).toBe('รายงาน.csv');
  });

  it('ลำดับสลับกัน ก็ยังเอาแบบ UTF-8', () => {
    const h = "attachment; filename*=UTF-8''%E0%B8%87%E0%B8%B2%E0%B8%99.csv; filename=\"a.csv\"";
    expect(filenameFrom(h)).toBe('งาน.csv');
  });

  /**
   * เปอร์เซ็นต์ที่ตามด้วยอะไรก็ไม่รู้ ทำให้ `decodeURIComponent` โยน ·
   * **ไฟล์สำคัญกว่าชื่อไฟล์** — ต้องตกไปใช้แบบ ASCII ไม่ใช่ทำให้พังทั้งการดาวน์โหลด
   */
  it('**แบบ UTF-8 ที่ถอดรหัสไม่ได้ ตกไปใช้แบบ ASCII ไม่ใช่พังทั้งอัน**', () => {
    const h = "attachment; filename=\"a.csv\"; filename*=UTF-8''%E0%A";
    expect(filenameFrom(h)).toBe('a.csv');
  });

  it('ถอดรหัสไม่ได้และไม่มีแบบ ASCII เลย คืน null', () => {
    expect(filenameFrom("attachment; filename*=UTF-8''%E0%A")).toBeNull();
  });

  it('หัวที่ไม่มีชื่อไฟล์เลย คืน null', () => {
    expect(filenameFrom('inline')).toBeNull();
  });

  /** ชื่อฟิลด์ตัวพิมพ์ใหญ่เล็กไม่ตรง เป็นเรื่องปกติของ HTTP */
  it('ไม่สนใจตัวพิมพ์ใหญ่เล็กของชื่อฟิลด์', () => {
    expect(filenameFrom('attachment; FileName="b.csv"')).toBe('b.csv');
  });
});
