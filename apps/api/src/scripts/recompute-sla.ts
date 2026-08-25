/**
 * คำนวณนาฬิกา SLA ใหม่ทั้งหมด
 *
 * ใช้เมื่อกฎการคำนวณเปลี่ยน แล้วค่าที่ denormalise ไว้ในตารางล้าสมัย
 * เช่นตอนเพิ่มคอลัมน์ `breached_at` — แถวเดิมทั้งหมดเป็น NULL
 * และจะเป็น NULL ตลอดไป เพราะการคำนวณใหม่เกิดเฉพาะตอนมีเหตุการณ์กับตั๋วเท่านั้น
 *
 * ตัวเลขจริงที่เจอ: นาฬิกาที่หลุดแล้ว 96 เรือน ไม่มีเรือนไหนรู้ว่าตัวเองหลุดตอนไหน
 *
 * ปลอดภัยที่จะรันซ้ำ — คำนวณจากรายการเหตุการณ์ซึ่งเป็นแหล่งความจริง ไม่ใช่จากค่าเดิม
 *
 * รัน: pnpm --filter @itsm/api recompute-sla
 */
import { prismaClient } from '../infrastructure/prisma/client';
import { recomputeSla } from '../modules/sla/sla.service';

async function main(): Promise<void> {
  // ตั้งใจวนทุก tenant — นี่คืองานบำรุงรักษาของระบบ ไม่ใช่คำขอของผู้ใช้คนไหน
  const tenants = await prismaClient.tenant.findMany({ select: { id: true, key: true } });
  const actor = await prismaClient.user.findFirst({
    where: { isSystem: true },
    select: { id: true },
  });
  let total = 0;
  let failed = 0;

  for (const tenant of tenants) {
    const clocks = await prismaClient.workItemSla.findMany({
      where: { tenantId: tenant.id },
      select: { workItemId: true },
    });
    process.stdout.write(`${tenant.key}: ${String(clocks.length)} เรือน\n`);

    for (const c of clocks) {
      try {
        await recomputeSla({ tenantId: tenant.id, actorId: actor?.id ?? null }, c.workItemId);
        total += 1;
        if (total % 100 === 0) process.stdout.write(`  …${String(total)}\n`);
      } catch (err) {
        // ไม่ให้เรือนเดียวล้มทั้งงาน — รายงานแล้วไปต่อ
        failed += 1;
        process.stderr.write(
          `  งาน ${c.workItemId.toString()} ล้มเหลว: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  }

  process.stdout.write(`เสร็จ: สำเร็จ ${String(total)} · ล้มเหลว ${String(failed)}\n`);
  await prismaClient.$disconnect();
}

void main();
