/**
 * ข้อกำหนดของการแปล HQL เป็นเงื่อนไขของ Prisma — **เขียนก่อนโค้ด**
 *
 * ## ทำไมต้องมีเป้าหมายที่สอง
 *
 * HQL แปลเป็น OpenSearch DSL อยู่แล้ว และหน้าค้นหาใช้ทางนั้น · แต่ **กระดาน
 * อ่านจาก MySQL** ซึ่งเป็นแหล่งความจริง · ตัวกรองที่ตัดสินว่าการ์ดใบไหน
 * ปรากฏบนกระดาน ต้องเห็นข้อมูลชุดเดียวกับที่กระดานเห็น
 *
 * ถ้าให้ตัวกรองเดินผ่านดัชนีแล้วเอาคีย์กลับมากรอง จะได้ปัญหาสองชั้น:
 * ดัชนีตามหลัง MySQL อยู่เสมอ (งานที่เพิ่งสร้างจะหายไปจากกระดานเงียบ ๆ)
 * และรายการคีย์ที่ตรงมีได้เป็นพัน ซึ่งไม่มีเพดานที่ปลอดภัย
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 *   1. **ฟิลด์ข้อความ (`summary` `description`) แปลไม่ได้** — MySQL FULLTEXT
 *      ตัดคำไทยไม่ได้ (ADR-005) และ `LIKE '%...%'` ให้ผลคนละแบบกับหน้าค้นหา ·
 *      ตัวกรองที่ชื่อเหมือนกันแต่ตอบคนละอย่างในสองที่ **แย่กว่าไม่มีตัวกรอง**
 *      · ต้องปฏิเสธพร้อมบอกว่าให้ไปใช้ที่ไหนแทน ไม่ใช่แปลแบบพอไหว
 *   2. **`NOT` กับค่าที่เป็น `null`** — `assignee != "5"` ใน SQL **ไม่คืนแถว
 *      ที่ `assignee_id` เป็น NULL** เพราะการเทียบกับ NULL ได้ UNKNOWN ·
 *      คนอ่าน "ไม่ใช่คนนี้" แล้วคาดว่าจะเห็นงานที่ยังไม่มีผู้รับผิดชอบด้วย
 *   3. **ฟิลด์ที่ไม่รู้จัก ต้องล้ม ไม่ใช่ถูกข้าม** — เงื่อนไขที่ถูกข้ามเงียบ ๆ
 *      ทำให้ตัวกรองคืนผลมากกว่าที่ควร ซึ่งอ่านเหมือนตัวกรองทำงานอยู่
 */
import { describe, expect, it } from 'vitest';

import {
  HqlComparisonUnsupportedError,
  HqlFieldError,
  HqlUnsupportedInPrismaError,
  compilePrisma,
  compilePrismaClause,
  PRISMA_UNSUPPORTED_FIELDS,
} from './index';

/** ผู้ใช้ที่เห็นสองโปรเจกต์ */
const scope = { tenantId: '1', browsableProjectIds: ['10', '20'] };

describe('แปล HQL เป็นเงื่อนไข Prisma', () => {
  describe('A · ขอบเขตที่บังคับเสมอ', () => {
    /**
     * **ทุกคิวรีต้องมี tenant scope** (INVARIANT 1) และต้องจำกัดเฉพาะ
     * โปรเจกต์ที่ผู้ใช้เปิดดูได้ · การลืมข้อใดข้อหนึ่งไม่ทำให้อะไรพัง
     * มันแค่คืนข้อมูลของคนอื่นมาด้วย
     */
    it('**คิวรีเปล่ายังได้ขอบเขตของ tenant และโปรเจกต์**', () => {
      const w = compilePrisma('', scope);
      expect(w.tenantId).toBe(BigInt(1));
      expect(w.projectId).toEqual({ in: [BigInt(10), BigInt(20)] });
    });

    /**
     * **รายการโปรเจกต์ว่าง = ไม่เห็นอะไรเลย ไม่ใช่เห็นทุกอย่าง**
     *
     * การไม่กรองคือค่าปริยายของทุกคิวรี · กติกาข้อนี้เขียนไว้ใน CLAUDE.md
     * เพราะเคยรั่วมาแล้วจากการตีความรายการว่างเป็น "ไม่จำกัด"
     */
    it('**ไม่มีโปรเจกต์ให้ดูเลย = เงื่อนไขที่ไม่มีทางตรงแถวไหน**', () => {
      const w = compilePrisma('status = "New"', { ...scope, browsableProjectIds: [] });
      expect(w.projectId).toEqual({ in: [] });
    });
  });

  describe('B · ฟิลด์ที่แปลได้', () => {
    it('สถานะเทียบด้วยชื่อ ผ่านความสัมพันธ์', () => {
      expect(compilePrisma('status = "New"', scope).AND).toEqual([{ status: { name: 'New' } }]);
    });

    it('หมวดสถานะเทียบด้วยชื่อหมวด', () => {
      expect(compilePrisma('category = "DONE"', scope).AND).toEqual([
        { status: { category: 'DONE' } },
      ]);
    });

    it('ผู้รับผิดชอบเทียบด้วยรหัส เพราะเป็นคอลัมน์ตรง ๆ', () => {
      expect(compilePrisma('assignee = "7"', scope).AND).toEqual([{ assigneeId: BigInt(7) }]);
    });

    it('คีย์งานเทียบตรงตัว', () => {
      expect(compilePrisma('key = "SD-1"', scope).AND).toEqual([{ itemKey: 'SD-1' }]);
    });

    it('IN แปลเป็น in', () => {
      expect(compilePrisma('status IN ("New", "Closed")', scope).AND).toEqual([
        { status: { name: { in: ['New', 'Closed'] } } },
      ]);
    });

    it('AND ซ้อนกันได้', () => {
      const w = compilePrisma('status = "New" AND assignee = "7"', scope);
      expect(w.AND).toEqual([{ AND: [{ status: { name: 'New' } }, { assigneeId: BigInt(7) }] }]);
    });

    it('OR แปลเป็น OR', () => {
      const w = compilePrisma('key = "SD-1" OR key = "SD-2"', scope);
      expect(w.AND).toEqual([{ OR: [{ itemKey: 'SD-1' }, { itemKey: 'SD-2' }] }]);
    });
  });

  describe('C · ค่าว่างกับการปฏิเสธ', () => {
    it('IS EMPTY แปลเป็น null', () => {
      expect(compilePrisma('assignee IS EMPTY', scope).AND).toEqual([{ assigneeId: null }]);
    });

    it('IS NOT EMPTY แปลเป็น not null', () => {
      expect(compilePrisma('assignee IS NOT EMPTY', scope).AND).toEqual([
        { assigneeId: { not: null } },
      ]);
    });

    /**
     * **หัวใจของหมวดนี้**
     *
     * `assignee != "7"` ใน SQL ตรง ๆ จะ **ไม่คืนแถวที่ `assignee_id` เป็น NULL**
     * เพราะ `NULL != 7` ได้ UNKNOWN ไม่ใช่ TRUE · แต่คนที่พิมพ์ "ไม่ใช่คนนี้"
     * คาดว่าจะเห็นงานที่ยังไม่มีผู้รับผิดชอบด้วย — ซึ่งบนกระดานศูนย์บริการ
     * คือกองที่สำคัญที่สุด · ถ้าหายไป จะไม่มีอะไรบอกเลย
     */
    it('**`!=` บนคอลัมน์ที่เป็น null ได้ ต้องรวมแถว null ด้วย**', () => {
      expect(compilePrisma('assignee != "7"', scope).AND).toEqual([
        { OR: [{ assigneeId: { not: BigInt(7) } }, { assigneeId: null }] },
      ]);
    });

    it('`!=` บนคอลัมน์ที่ไม่มีทางเป็น null ไม่ต้องเผื่อ null', () => {
      expect(compilePrisma('key != "SD-1"', scope).AND).toEqual([{ itemKey: { not: 'SD-1' } }]);
    });

    it('NOT IN บนคอลัมน์ที่เป็น null ได้ ก็รวมแถว null เหมือนกัน', () => {
      expect(compilePrisma('assignee NOT IN ("7", "8")', scope).AND).toEqual([
        { OR: [{ assigneeId: { notIn: [BigInt(7), BigInt(8)] } }, { assigneeId: null }] },
      ]);
    });
  });

  describe('D · สิ่งที่ต้องปฏิเสธ', () => {
    /**
     * **ฟิลด์ข้อความแปลไม่ได้ และต้องบอกว่าให้ไปทำที่ไหนแทน**
     *
     * MySQL FULLTEXT ตัดคำไทยไม่ได้ · `LIKE '%...%'` ให้ผลคนละแบบกับหน้าค้นหา
     * ตัวกรองชื่อเดียวกันที่ตอบคนละอย่างในสองที่ แย่กว่าไม่มีตัวกรอง
     */
    it('**`summary ~ "..."` ถูกปฏิเสธพร้อมบอกทางเลือก**', () => {
      expect(() => compilePrisma('summary ~ "ปริ้นเตอร์"', scope)).toThrow(
        HqlUnsupportedInPrismaError,
      );
      expect(() => compilePrisma('summary ~ "ปริ้นเตอร์"', scope)).toThrow(/ค้นหา/);
    });

    it('`description` ก็ปฏิเสธเหมือนกัน', () => {
      expect(() => compilePrisma('description ~ "x"', scope)).toThrow(HqlUnsupportedInPrismaError);
    });

    /**
     * รายการฟิลด์ที่แปลไม่ได้ต้อง **ประกาศออกมาให้อ่านได้** ไม่ใช่ซ่อนอยู่ใน
     * เงื่อนไข · หน้าจอที่อยากเตือนผู้ใช้ก่อนกดบันทึกต้องอ่านรายการนี้ได้
     */
    it('รายการฟิลด์ที่แปลไม่ได้ ประกาศไว้และไม่ว่าง', () => {
      expect([...PRISMA_UNSUPPORTED_FIELDS]).toContain('summary');
      expect([...PRISMA_UNSUPPORTED_FIELDS]).toContain('description');
    });

    /**
     * **ฟิลด์ที่ไม่รู้จักต้องล้ม ไม่ใช่ถูกข้าม**
     *
     * เงื่อนไขที่ถูกข้ามเงียบ ๆ ทำให้ตัวกรองคืนผลมากกว่าที่ควร
     * ซึ่งอ่านเหมือนตัวกรองทำงานอยู่
     */
    it('**ฟิลด์ที่ไม่รู้จัก โยน error ไม่ใช่ข้าม**', () => {
      expect(() => compilePrisma('ไม่มีฟิลด์นี้ = "x"', scope)).toThrow(HqlFieldError);
    });

  /**
     * **วันเวลาเทียบตรง ๆ ไม่ได้ แต่ถามว่ามีค่าหรือยังได้**
     *
     * `resolved IS EMPTY` = ยังไม่ปิด · เป็นตัวกรองที่ใช้จริงบนกระดาน ·
     * ส่วน `resolved = "2026-01-01"` ต้องตรงระดับมิลลิวินาที จึงไม่เคยตรง
     * กับอะไรเลย และอ่านเหมือนตัวกรองพัง ไม่ใช่เหมือนคิวรีที่เขียนผิด
     *
     * เคสสามข้อนี้ **เพิ่มเข้ามาหลังจากพบว่ากลไกนี้ไม่มีเทสต์คุ้ม** — ลบ
     * เงื่อนไขที่ปฏิเสธออกแล้วเทสต์ยังเขียวทั้ง 50 เคส ซึ่งเป็นสัญญาณว่า
     * บรรทัดนั้นไม่มีใครตรวจ
     */
    it('**`resolved = "..."` ถูกปฏิเสธ — เทียบวันเวลาตรงมิลลิวินาทีไม่เคยตรง**', () => {
      expect(() => compilePrisma('resolved = "2026-01-01"', scope)).toThrow(
        HqlComparisonUnsupportedError,
      );
    });

    it('`resolved IN (...)` ถูกปฏิเสธเหมือนกัน', () => {
      expect(() => compilePrisma('resolved IN ("2026-01-01")', scope)).toThrow(
        HqlComparisonUnsupportedError,
      );
    });

    it('แต่ `resolved IS EMPTY` ใช้ได้ — "ยังไม่ปิด" คือตัวกรองที่ใช้จริง', () => {
      expect(compilePrisma('resolved IS EMPTY', scope).AND).toEqual([{ resolvedAt: null }]);
    });

    it('ไวยากรณ์ผิดยังล้มเหมือนเดิม', () => {
      expect(() => compilePrisma('status =', scope)).toThrow();
    });
  });

  describe('E · เงื่อนไขล้วน สำหรับที่ที่มีขอบเขตของตัวเองแล้ว', () => {
    /**
     * **เงื่อนไขล้วนต้องไม่มีขอบเขตติดมาด้วย**
     *
     * กระดานจำกัดอยู่ที่โปรเจกต์เดียวอยู่แล้ว · ถ้าเงื่อนไขพา `projectId`
     * ของตัวเองมา จะได้คีย์ซ้ำในอ็อบเจ็กต์เดียวกัน ซึ่งอันหลังทับอันแรก
     * **เงียบ ๆ** แล้วขอบเขตของกระดานจะกว้างกว่าที่ตั้งใจ โดยไม่มี error
     */
    it('**ไม่มี tenantId และ projectId ติดมากับเงื่อนไข**', () => {
      const c = compilePrismaClause('status = "New"');
      expect(c).not.toBeNull();
      expect(Object.keys(c ?? {})).toEqual(['status']);
    });

    it('คิวรีว่างเปล่าได้ null — "ไม่กรองอะไรเพิ่ม" ไม่ใช่ error', () => {
      expect(compilePrismaClause('')).toBeNull();
      expect(compilePrismaClause('   ')).toBeNull();
    });

    it('ยังปฏิเสธสิ่งที่ปฏิเสธเหมือนกัน', () => {
      expect(() => compilePrismaClause('summary ~ "x"')).toThrow(HqlUnsupportedInPrismaError);
    });
  });

  describe('F · ไม่กระทบเป้าหมายเดิม', () => {
    /**
     * เป้าหมาย OpenSearch ต้องทำงานเหมือนเดิมทุกประการ · การเพิ่มเป้าหมาย
     * ที่สองแล้วเผลอเปลี่ยนพฤติกรรมของอันแรก จะทำให้หน้าค้นหาเพี้ยน
     * โดยไม่มีใครไปดู
     */
    it('ฟิลด์ที่แปลเป็น Prisma ไม่ได้ ยังใช้กับหน้าค้นหาได้ตามปกติ', async () => {
      const { compile } = await import('./index');
      const q = compile('summary ~ "ปริ้นเตอร์"', scope);
      expect(q.query.bool.must.length).toBeGreaterThan(0);
    });
  });
});
