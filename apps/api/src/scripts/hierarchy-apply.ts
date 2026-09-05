/**
 * เติมลำดับชั้นให้ข้อมูลที่มีอยู่แล้ว — ไม่ล้างอะไรทั้งสิ้น
 *
 * `seed.ts` เรียกฟังก์ชันนี้ตอนสร้างข้อมูลใหม่ · `link-hierarchy.ts` เรียกมัน
 * ให้ฐานข้อมูลที่ seed ไปแล้ว **โดยไม่ต้อง seed ใหม่** — การ seed ใหม่ล้าง
 * นาฬิกา SLA การแจ้งเตือน และเซสชันทั้งชุดไปด้วย ซึ่งแพงกว่าปัญหาที่กำลังแก้มาก
 *
 * **แตะเฉพาะแถวที่ `parent_id` ยังว่าง** จึงรันซ้ำได้ และไม่ทับสายที่คนผูกเอง
 * · ไม่เขียน `work_item_history` เพราะนี่คือการสร้างข้อมูลตั้งต้นเหมือน `seed.ts`
 * ไม่ใช่การกระทำของผู้ใช้
 */
import type { PrismaClient } from '@prisma/client';

import { planHierarchy } from './hierarchy-plan';

export async function applyHierarchy(prisma: PrismaClient): Promise<number> {
  const projects = await prisma.project.findMany({
    select: { id: true, key: true, tenantId: true },
    orderBy: { id: 'asc' },
  });

  let total = 0;
  for (const project of projects) {
    /*
      อ่านเรียงตาม id เสมอ — แผนขึ้นกับ *ลำดับ* ของรายการที่ส่งเข้าไป
      ถ้าลำดับไม่แน่นอน สคริปต์เติมย้อนหลังกับ seed จะให้ผลคนละแบบ
      ทั้งที่ตัวสุ่มเหมือนกัน
    */
    const rows = await prisma.workItem.findMany({
      where: { tenantId: project.tenantId, projectId: project.id },
      select: { id: true, parentId: true, issueType: { select: { hierarchyLevel: true } } },
      orderBy: { id: 'asc' },
    });
    if (rows.length === 0) continue;

    const plan = planHierarchy(
      rows.map((r) => ({ id: r.id.toString(), level: r.issueType.hierarchyLevel })),
    );
    const open = new Set(rows.filter((r) => r.parentId === null).map((r) => r.id.toString()));
    const apply = [...plan.links].filter(([child]) => open.has(child));
    if (apply.length === 0) continue;

    /*
      id มาจากฐานข้อมูลของเราเอง ไม่ใช่จากผู้ใช้ — แต่ยังตรวจรูปแบบก่อนต่อสตริง
      เพราะ "ค่านี้มาจากที่ปลอดภัย" เป็นข้อสมมติที่เปลี่ยนได้ในวันที่มีคนแก้คิวรีข้างบน
    */
    for (const [child, parent] of apply)
      if (!/^\d+$/.test(child) || !/^\d+$/.test(parent))
        throw new Error(`id ไม่ใช่ตัวเลขล้วน: ${child} → ${parent}`);

    for (let i = 0; i < apply.length; i += 500) {
      const chunk = apply.slice(i, i + 500);
      const cases = chunk.map(([c, p]) => `WHEN ${c} THEN ${p}`).join(' ');
      const ids = chunk.map(([c]) => c).join(',');
      await prisma.$executeRawUnsafe(
        `UPDATE work_item SET parent_id = CASE id ${cases} END ` +
          `WHERE tenant_id = ? AND id IN (${ids}) AND parent_id IS NULL`,
        project.tenantId,
      );
    }
    total += apply.length;
    console.log(
      `  ${project.key}: ผูก ${String(apply.length)} แถว · ` +
        `Epic ที่มีลูก ${String(plan.epicsWithChildren)} ใบ · ` +
        `เรื่องหลักที่ไม่อยู่ใต้ Epic ${String(plan.topLevelWithoutEpic)} ใบ`,
    );
  }
  return total;
}
