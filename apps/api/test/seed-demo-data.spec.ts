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
 * **ยังไม่ครอบ**: `change_window` · `sprint` · `project_version` ·
 * `automation_rule` · `dashboard` ซึ่งยังไม่มีข้อมูลตัวอย่าง — เขียนไว้ตรงนี้
 * เพราะด่านที่ไม่บอกขอบเขตของตัวเอง ทำให้คนเชื่อว่ามันครอบหมด
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
