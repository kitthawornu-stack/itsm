/**
 * Worker — งานที่ทำนอกคำขอของผู้ใช้
 *
 * ตอนนี้มีคิวเดียว: การแจ้งเตือน SLA
 * แผนระบุว่าโมดูล `automation` `search-index` และ `notification` จะย้ายมาที่นี่
 * เมื่อถึงเวลา เพราะทั้งหมดเป็นงาน async ที่ scale คนละแบบกับ API (ADR-004)
 *
 * รันด้วย: pnpm --filter @itsm/worker dev
 */
import { PrismaClient } from '@prisma/client';

import { createSlaHandler } from './sla-handler';
import { createConnection, createSlaWorker } from './sla-queue';

const prisma = new PrismaClient();

/**
 * คำนวณ SLA ใหม่จากฐานข้อมูล
 *
 * worker เรียกโค้ดของ api ไม่ได้ (คนละ workspace และคนละ process)
 * จึงอ่านค่า denormalise จาก `work_item_sla` แทนการคำนวณเอง
 * ค่าที่ได้อาจช้ากว่าความจริงเล็กน้อย — ยอมรับได้เพราะ handler
 * ใช้มันเพื่อ **ตัดสินว่าจะไม่ส่ง** ซึ่งการพลาดไปทางไม่ส่งปลอดภัยกว่าส่งผิด
 *
 * TODO เมื่อแยก service: ให้ api เปิด endpoint recompute แล้ว worker เรียกผ่าน HTTP
 */
async function recompute(
  tenantId: bigint,
  workItemId: bigint,
): Promise<{ state: string; ratio: number; goalName: string } | null> {
  const row = await prisma.workItemSla.findFirst({
    where: { tenantId, workItemId },
    include: { goal: true },
  });
  if (row === null) return null;
  return {
    state: row.state,
    ratio: row.targetMs === 0 ? 1 : row.elapsedMs / row.targetMs,
    goalName: row.goal.name,
  };
}

function dedupeKey(workItemSlaId: bigint, threshold: number): string {
  return `sla-threshold:${workItemSlaId.toString()}:${String(Math.round(threshold * 100))}`;
}

function text(p: {
  itemKey: string;
  summary: string;
  goalName: string;
  threshold: number;
}): { title: string; body: string } {
  const pct = Math.round(p.threshold * 100);
  return {
    title:
      p.threshold >= 1
        ? `${p.itemKey} หลุด SLA แล้ว`
        : `${p.itemKey} ใช้เวลาไปแล้ว ${String(pct)}% ของเป้าหมาย`,
    body: `${p.summary}\nเป้าหมาย: ${p.goalName}`,
  };
}

async function main(): Promise<void> {
  const connection = createConnection();
  const handler = createSlaHandler({ prisma, recompute, dedupeKey, text });
  const worker = createSlaWorker(connection, handler);

  worker.on('completed', (job, result) => {
    console.log(`[sla] ${job.id ?? '?'} -> ${String(result)}`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[sla] ${job?.id ?? '?'} ล้มเหลว:`, err.message);
  });

  console.log('Worker พร้อมทำงาน — คิว sla-notification');

  const shutdown = async (): Promise<void> => {
    console.log('\nกำลังปิด worker…');
    // ปิดอย่างนุ่มนวล — งานที่กำลังทำอยู่ต้องจบก่อน ไม่งั้นจะถูกลองใหม่โดยไม่จำเป็น
    await worker.close();
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // ค้างไว้จนกว่าจะถูกสั่งปิด — worker เป็น process ที่ต้องอยู่ยาว
  await new Promise(() => {
    /* ไม่ resolve โดยเจตนา · ออกทาง shutdown() เท่านั้น */
  });
}

void main();
