/**
 * ข้อกำหนดของสิทธิเจ้าของข้อมูลตาม PDPA — **เขียนก่อนโค้ด**
 *
 * พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล ให้สิทธิสองอย่างที่ระบบนี้ต้องรองรับ:
 * **ขอสำเนาข้อมูลของตัวเอง** และ **ขอให้ลบ**
 *
 * ## "ลบ" ในระบบตั๋วงาน แปลว่าทำให้เป็นนิรนาม ไม่ใช่ลบแถว
 *
 * ประวัติของคนอื่นอ้างถึงคนคนนี้ — ตั๋วที่เขาเคยรับผิดชอบ คอมเมนต์ที่คนอื่น
 * ตอบเขา ร่องรอยการอนุมัติ · ลบแถวผู้ใช้ทิ้งแปลว่าประวัติของคนอื่นตอบไม่ได้
 * ว่าใครทำอะไร ซึ่งเป็นสิ่งที่ INVARIANT 2 มีไว้กันตั้งแต่ต้น · และ FK
 * `onDelete: Restrict` ที่ตั้งใจใส่ไว้ก็จะขวางอยู่ดี
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 *   1. **รายงานว่า "ลบแล้ว" ทั้งที่ข้อมูลส่วนบุคคลยังอยู่ในข้อความอิสระ** —
 *      ชื่อและเบอร์โทรที่คนพิมพ์ไว้ในคอมเมนต์ ลบด้วยการล้างฟิลด์ไม่ได้ ·
 *      การเงียบเรื่องนี้ทำให้องค์กรเชื่อว่าทำตามกฎหมายแล้ว ซึ่งอันตรายกว่า
 *      การรู้ว่ายังไม่ครบ
 *   2. **ลบผู้ดูแลคนสุดท้าย** — ไม่มีใครเข้าหน้าตั้งค่าได้อีก และกู้ได้ทาง SQL
 *      ทางเดียว (เคยเกิดขึ้นจริงกับโปรเจกต์นี้มาแล้ว)
 *   3. **ลบทั้งที่ยังถืองานอยู่** — งานกลายเป็นของคนที่ไม่มีตัวตน
 *      แล้วไม่มีใครรู้ว่าต้องไปตามใคร
 */
import { describe, expect, it } from 'vitest';

import {
  LastAdminError,
  StillAssignedError,
  AlreadyErasedError,
  assertErasable,
  residualRisks,
  tombstoneFor,
  type ErasureContext,
} from './personal-data';

function ctx(over: Partial<ErasureContext> = {}): ErasureContext {
  return {
    alreadyErased: false,
    isLastAdmin: false,
    openAssignments: 0,
    ...over,
  };
}

// ============================================================

describe('PDPA · A · ป้ายหลุมศพ', () => {
  /** อีเมลจริงห้ามเหลืออยู่ · `.invalid` สงวนไว้ให้ใช้แบบนี้โดยเฉพาะ (RFC 2606) */
  it('**อีเมลใหม่ไม่ใช่อีเมลที่ส่งถึงใครได้**', () => {
    expect(tombstoneFor(BigInt(42)).email).toMatch(/\.invalid$/);
  });

  it('อีเมลใหม่ไม่ซ้ำกันระหว่างคนละคน', () => {
    expect(tombstoneFor(BigInt(1)).email).not.toBe(tombstoneFor(BigInt(2)).email);
  });

  /**
   * **ชื่อใหม่ต้องอ่านออกว่าเป็นคนที่ถูกลบ ไม่ใช่ช่องว่าง**
   *
   * ชื่อว่างจะไปโผล่เป็นบรรทัดเปล่าในไทม์ไลน์และรายการผู้รับผิดชอบ
   * แล้วคนอ่านจะคิดว่าข้อมูลหาย ไม่ใช่ว่าถูกลบตามคำขอ
   */
  it('**ชื่อใหม่บอกได้ว่าเป็นคนที่ถูกลบตามคำขอ**', () => {
    const t = tombstoneFor(BigInt(42));
    expect(t.displayName.trim()).not.toBe('');
    expect(t.displayName).toContain('ลบ');
  });

  it('ป้ายของ id เดิม ได้ค่าเดิมทุกครั้ง', () => {
    expect(tombstoneFor(BigInt(7))).toEqual(tombstoneFor(BigInt(7)));
  });
});

// ============================================================

describe('PDPA · B · เมื่อไรลบไม่ได้', () => {
  it('ปกติแล้วลบได้', () => {
    expect(() => {
      assertErasable(ctx());
    }).not.toThrow();
  });

  /** เคยเกิดขึ้นจริงกับโปรเจกต์นี้: เหลือ `ADMINISTER_TENANT` ศูนย์รายการ */
  it('**ผู้ดูแลคนสุดท้าย ลบไม่ได้**', () => {
    expect(() => {
      assertErasable(ctx({ isLastAdmin: true }));
    }).toThrow(LastAdminError);
  });

  it('**ยังถืองานที่เปิดอยู่ ลบไม่ได้ และบอกว่ากี่ใบ**', () => {
    let thrown: unknown;
    try {
      assertErasable(ctx({ openAssignments: 3 }));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StillAssignedError);
    expect((thrown as StillAssignedError).count).toBe(3);
    expect((thrown as StillAssignedError).message).toContain('3');
  });

  /** งานที่ปิดแล้วไม่ขวาง — ไม่มีใครต้องไปตามต่อ */
  it('งานที่ปิดแล้วไม่นับ — นับเฉพาะที่ยังเปิดอยู่', () => {
    expect(() => {
      assertErasable(ctx({ openAssignments: 0 }));
    }).not.toThrow();
  });

  it('ลบไปแล้ว ลบซ้ำไม่ได้', () => {
    expect(() => {
      assertErasable(ctx({ alreadyErased: true }));
    }).toThrow(AlreadyErasedError);
  });
});

// ============================================================

describe('PDPA · C · สิ่งที่ลบไม่ได้ ต้องบอก', () => {
  /**
   * **หัวใจของทั้งไฟล์**
   *
   * ชื่อและเบอร์โทรที่คนพิมพ์ไว้ในคอมเมนต์ ลบด้วยการล้างฟิลด์ไม่ได้ ·
   * การรายงานว่า "ลบแล้ว" เฉย ๆ ทำให้องค์กรเชื่อว่าทำตามกฎหมายแล้ว
   * ซึ่งอันตรายกว่าการรู้ว่ายังไม่ครบ
   */
  it('**คอมเมนต์ที่เขาเขียนไว้ อยู่ในรายการความเสี่ยงคงเหลือ พร้อมจำนวน**', () => {
    const r = residualRisks({ comments: 12, workLogs: 0, reportedItems: 0, attachments: 0 });
    expect(r).toHaveLength(1);
    expect(r[0]?.kind).toBe('comments');
    expect(r[0]?.count).toBe(12);
    expect(r[0]?.detail).toContain('12');
  });

  it('รวมทุกชนิดที่มีของค้าง และเรียงจากมากไปน้อย', () => {
    const r = residualRisks({ comments: 2, workLogs: 9, reportedItems: 5, attachments: 0 });
    expect(r.map((x) => x.kind)).toEqual(['workLogs', 'reportedItems', 'comments']);
  });

  /** ไม่มีของค้าง = รายการว่าง **ไม่ใช่ null** — ผู้เรียกไม่ต้องแยกสองกรณี */
  it('ไม่มีอะไรค้าง ได้รายการว่าง ไม่ใช่ null', () => {
    expect(residualRisks({ comments: 0, workLogs: 0, reportedItems: 0, attachments: 0 })).toEqual(
      [],
    );
  });

  it('ทุกรายการมีข้อความภาษาคนที่บอกว่าทำไมลบไม่ได้', () => {
    const r = residualRisks({ comments: 1, workLogs: 1, reportedItems: 1, attachments: 1 });
    expect(r).toHaveLength(4);
    for (const x of r) {
      expect(x.detail.trim().length).toBeGreaterThan(10);
    }
  });
});
