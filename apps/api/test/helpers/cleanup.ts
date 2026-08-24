/**
 * ล้างข้อมูลของ tenant ตามลำดับที่ถูกต้อง
 *
 * **ห้ามพึ่ง cascade ของ `tenant`** — `workflow_scheme -> workflow` เป็น
 * `onDelete: Restrict` โดยตั้งใจ (กันลบ workflow ที่ยังมีโปรเจกต์ใช้อยู่)
 * เมื่อ MySQL ไล่ cascade จาก tenant ลำดับการลบไม่รับประกัน จึงชนกับ Restrict
 * และได้ error P2003
 *
 * เจอปัญหานี้ครั้งแรกตอนเขียน seed แล้วแก้เฉพาะที่นั่น ทำให้เจอซ้ำอีกครั้ง
 * ในเทสต์ — จึงย้ายมาเป็นตัวช่วยกลางเพื่อไม่ให้เจอเป็นครั้งที่สาม
 */
import { prismaClient } from '../../src/infrastructure/prisma/client';

export async function purgeTenants(keys: string[]): Promise<void> {
  const tenants = await prismaClient.tenant.findMany({
    where: { key: { in: keys } },
    select: { id: true },
  });
  for (const { id } of tenants) {
    await prismaClient.workItemFieldValue.deleteMany({ where: { tenantId: id } });
    await prismaClient.workItemHistory.deleteMany({ where: { tenantId: id } });
    await prismaClient.workItemKeyAlias.deleteMany({ where: { tenantId: id } });
    await prismaClient.workItem.deleteMany({ where: { tenantId: id } });
    await prismaClient.workflowScheme.deleteMany({ where: { tenantId: id } });
    await prismaClient.fieldConfig.deleteMany({ where: { tenantId: id } });
    await prismaClient.fieldDefinition.deleteMany({ where: { tenantId: id } });
    await prismaClient.transitionRule.deleteMany({ where: { tenantId: id } });
    await prismaClient.workflowTransition.deleteMany({ where: { tenantId: id } });
    await prismaClient.workflowStatus.deleteMany({ where: { tenantId: id } });
    await prismaClient.workflow.deleteMany({ where: { tenantId: id } });
    await prismaClient.projectCounter.deleteMany({ where: { tenantId: id } });
    await prismaClient.project.deleteMany({ where: { tenantId: id } });
    await prismaClient.auditLog.deleteMany({ where: { tenantId: id } });
    await prismaClient.tenant.delete({ where: { id } });
  }
}
