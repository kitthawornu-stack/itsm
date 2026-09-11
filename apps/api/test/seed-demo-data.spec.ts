/**
 * ฟีเจอร์ที่เสร็จแล้ว ต้องมีข้อมูลตัวอย่างให้เห็น
 *
 * เจ็ดตารางเคยว่างเปล่าบนทุกเครื่อง เพราะ `seed.ts` ไม่เคยสร้างมัน · ฟีเจอร์
 * ที่เช็กลิสต์กาว่าเสร็จจึงเปิดหน้าจอแล้วว่างเปล่าเสมอ และไม่มีใครเคยเห็น
 * มันทำงาน — **"ฟีเจอร์ยังไม่มี" กับ "ไม่เคยมีข้อมูลตัวอย่างเลย" ให้อาการ
 * เหมือนกันบนหน้าจอ** และมันบล็อกการตรวจจริงไปแล้วสามครั้ง
 *
 * ด่านนี้ถามฐานข้อมูลตรง ๆ ว่ายังมีของอยู่ไหม · ใช้ขอบล่างเท่านั้น จึงไม่แกว่ง
 * ตามแถวที่ไฟล์เทสต์อื่นสร้างขึ้นพร้อมกัน
 *
 * ถ้าแดง: รัน `pnpm --filter @itsm/api seed`
 *
 * **ยังไม่ครอบ**: `change_window` · `automation_rule` · `dashboard`
 * ซึ่งยังไม่มีข้อมูลตัวอย่าง — เขียนไว้ตรงนี้เพราะด่านที่ไม่บอกขอบเขต
 * ของตัวเอง ทำให้คนเชื่อว่ามันครอบหมด
 */
import { afterAll, describe, expect, it } from 'vitest';

import { prismaClient as prisma } from '../src/infrastructure/prisma/client';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ข้อมูลตัวอย่างของฟีเจอร์ที่เสร็จแล้ว', () => {
  it('**ทะเบียน CI มีของ และมีเส้นพึ่งพา**', async () => {
    expect(await prisma.configurationItem.count()).toBeGreaterThanOrEqual(10);
    expect(await prisma.ciDependency.count()).toBeGreaterThanOrEqual(10);
  });

  /**
   * **สายพึ่งพาต้องลึกอย่างน้อยสามชั้น** — เส้นชั้นเดียวทำให้แผงผลกระทบ
   * แสดงว่า "ไม่กระทบอะไร" ทุกใบ ซึ่งอ่านเหมือนฟีเจอร์พัง ไม่ใช่เหมือน
   * ข้อมูลตัวอย่างบาง
   */
  it('**สายพึ่งพาลึกพอที่ผลกระทบจะไม่เป็นศูนย์**', async () => {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM ci_dependency a
      JOIN ci_dependency b ON b.dependent_id = a.depends_on_id
      JOIN ci_dependency c ON c.dependent_id = b.depends_on_id`;
    expect(Number(rows[0]?.n ?? 0)).toBeGreaterThan(0);
  });

  it('มีเรื่องที่ผูก CI ไว้จริง — แผงผลกระทบจึงมีของให้แสดง', async () => {
    expect(await prisma.workItemCi.count()).toBeGreaterThanOrEqual(5);
  });

  /**
   * **ต้องมีทั้งที่เผยแพร่แล้วและที่ยังไม่เผยแพร่** · ถ้ามีแต่แบบเดียว
   * ความต่างระหว่าง "ทีมเห็น" กับ "ผู้แจ้งเห็นด้วย" จะไม่มีใครเคยเห็น
   */
  it('**คลังความรู้มีทั้งสองสถานะ**', async () => {
    expect(await prisma.knowledgeArticle.count({ where: { isPublished: true } })).toBeGreaterThan(0);
    expect(await prisma.knowledgeArticle.count({ where: { isPublished: false } })).toBeGreaterThan(
      0,
    );
  });

  it('มีบทความที่ถูกแนบกับเรื่องจริง — คลังที่ไม่เคยถูกแนบอ่านเหมือนไม่มีใครใช้', async () => {
    expect(await prisma.workItemArticle.count()).toBeGreaterThan(0);
  });
});

describe('ข้อมูลตัวอย่างของรอบการทำงานและรุ่น', () => {
  it('**มีทั้งรอบที่ปิดแล้ว รอบที่กำลังเดิน และรอบที่ยังไม่เริ่ม**', async () => {
    const byState = async (state: string): Promise<number> =>
      prisma.sprint.count({ where: { state } });
    /* ความเร็วทีมต้องมีอย่างน้อยสองรอบที่ปิดแล้ว ไม่งั้นมันบอกได้แค่ตัวเลขเดียว */
    expect(await byState('completed')).toBeGreaterThanOrEqual(2);
    expect(await byState('active')).toBeGreaterThanOrEqual(1);
    expect(await byState('planned')).toBeGreaterThanOrEqual(1);
  });

  it('มีงานผูกกับรอบจริง — backlog ที่ไม่มีงานในรอบไหนเลย อ่านเหมือนฟีเจอร์พัง', async () => {
    expect(await prisma.workItem.count({ where: { sprintId: { not: null } } })).toBeGreaterThan(10);
  });

  /**
   * **ตัวเลขสรุปต้องมาจากแถวที่ผูกจริง ไม่ใช่ค่าที่พิมพ์ลงไป**
   *
   * ยอดที่ตั้งขึ้นเองจะทำให้ burndown ขัดกับข้อมูล ซึ่งเป็นเกณฑ์ที่เฟส 2
   * ต้องผ่าน · และเป็นรูปแบบเดียวกับ "ตัวเลขที่ไม่มีใครวัด" ที่เอกสารสถานะ
   * เคยมีอยู่ — ถ้าวันหนึ่งมีคนแก้ข้อมูลตัวอย่างแล้วลืมแก้ยอด ข้อนี้แดง
   */
  it('**ยอดที่ทำเสร็จของรอบที่ปิดแล้ว ตรงกับจำนวนงานที่ปิดจริงในรอบนั้น**', async () => {
    const closed = await prisma.sprint.findMany({
      where: { state: 'completed' },
      select: { id: true, name: true, completedCount: true },
    });
    expect(closed.length).toBeGreaterThanOrEqual(2);
    for (const s of closed) {
      const done = await prisma.workItem.count({
        where: { sprintId: s.id, resolvedAt: { not: null } },
      });
      expect(s.completedCount, `รอบ ${s.name} ยอดที่บันทึกไว้ไม่ตรงกับแถวจริง`).toBe(done);
    }
  });

  it('**มีรุ่นครบทั้งที่ปล่อยแล้ว ยังไม่ปล่อย และที่เก็บเข้าคลัง**', async () => {
    expect(await prisma.projectVersion.count({ where: { releasedAt: { not: null } } })).toBeGreaterThan(0);
    expect(await prisma.projectVersion.count({ where: { releasedAt: null } })).toBeGreaterThan(0);
    expect(await prisma.projectVersion.count({ where: { archived: true } })).toBeGreaterThan(0);
  });

  /**
   * **รุ่นที่ปล่อยแล้วต้องไม่มีงานค้าง** — ระบบห้ามปล่อยรุ่นที่ยังมีงานค้าง
   * อยู่แล้ว · ข้อมูลตัวอย่างที่ขัดกับกฎของระบบเอง ทำให้คนที่เปิดดูสรุปว่า
   * กฎนั้นไม่ทำงาน ทั้งที่มันทำงาน
   */
  it('**รุ่นที่ปล่อยแล้วไม่มีงานค้างสักใบ**', async () => {
    const leaked = await prisma.workItemVersion.count({
      where: { version: { releasedAt: { not: null } }, workItem: { resolvedAt: null } },
    });
    expect(leaked).toBe(0);
  });

  /** ถ้าทุกรุ่นที่ยังไม่ปล่อยมีงานค้างเป็นศูนย์ บันทึกการปล่อยจะบอก "ยังค้าง 0" เสมอ */
  it('มีรุ่นที่ยังไม่ปล่อยและยังมีงานค้าง — บันทึกการปล่อยจึงมีอะไรให้เตือน', async () => {
    const pending = await prisma.workItemVersion.count({
      where: { version: { releasedAt: null }, workItem: { resolvedAt: null } },
    });
    expect(pending).toBeGreaterThan(0);
  });
});
