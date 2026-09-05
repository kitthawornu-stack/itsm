/**
 * ข้อมูลตั้งต้นต้องมีลำดับชั้นจริง
 *
 * เอกสารกาว่า "ลำดับชั้น Epic → Story → Sub-task" เสร็จแล้วมานาน · โค้ดถูก
 * และมีเทสต์คุม **แต่ไม่มีแถวไหนในฐานข้อมูลมีแม่เลยสักใบ** (0 จาก 10,000)
 * ทุกฟีเจอร์ที่อ่านสายแม่-ลูกจึงดูว่างเปล่าเสมอโดยไม่มีอะไรผิดสักอย่าง
 *
 * ด่านนี้ถามฐานข้อมูลตรง ๆ ไม่ใช่ถามเอกสาร · ใช้ขอบล่างและค่าคงที่ที่เป็น
 * **ศูนย์** เท่านั้น จึงไม่แกว่งตามแถวที่ไฟล์เทสต์อื่นสร้างขึ้นพร้อมกัน
 *
 * ถ้าแดงเพราะยอด "มีแม่" เป็นศูนย์ ให้รัน `pnpm --filter @itsm/api link-hierarchy`
 * ซึ่งเติมให้โดยไม่ล้างอะไร
 */
import { afterAll, describe, expect, it } from 'vitest';

import { prismaClient as prisma } from '../src/infrastructure/prisma/client';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ลำดับชั้นในข้อมูลตั้งต้น', () => {
  it('**มีงานที่มีแม่จริง** — ข้อที่เคยเป็นศูนย์โดยไม่มีใครรู้', async () => {
    const withParent = await prisma.workItem.count({ where: { parentId: { not: null } } });
    expect(withParent, 'ไม่มีงานที่มีแม่เลย — รัน link-hierarchy').toBeGreaterThan(500);
  });

  it('**มีสายที่ลึกครบ 3 ชั้น** — ไม่งั้นโค้ดที่ไต่ชั้นเดียวก็ดูถูกต้อง', async () => {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM work_item c
      JOIN work_item p ON p.id = c.parent_id
      JOIN work_item g ON g.id = p.parent_id`;
    expect(Number(rows[0]?.n ?? 0)).toBeGreaterThan(100);
  });

  it('แม่สูงกว่าลูกหนึ่งชั้นพอดี และอยู่โปรเจกต์เดียวกัน', async () => {
    const bad = await prisma.$queryRaw<{ level: bigint; project: bigint }[]>`
      SELECT
        SUM(tp.hierarchy_level <> tc.hierarchy_level + 1) AS level,
        SUM(p.project_id <> c.project_id) AS project
      FROM work_item c
      JOIN work_item p ON p.id = c.parent_id
      JOIN issue_type tc ON tc.id = c.issue_type_id
      JOIN issue_type tp ON tp.id = p.issue_type_id`;
    expect(Number(bad[0]?.level ?? -1)).toBe(0);
    expect(Number(bad[0]?.project ?? -1)).toBe(0);
  });
});
