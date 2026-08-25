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
import { systemClock } from '@itsm/types';

import { createSlaHandler } from './sla-handler';
import {
  createConnection,
  createSlaQueue,
  createSlaWorker,
  enqueueReconciled,
  type PlannedJob,
} from './sla-queue';
import { runReconcile, type ClockRow } from './sla-reconciler';

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

/** ทุกกี่มิลลิวินาทีจึงเทียบฐานข้อมูลกับคิวหนึ่งครั้ง */
const RECONCILE_EVERY_MS = Number(process.env['SLA_RECONCILE_INTERVAL_MS'] ?? 5 * 60_000);

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

  /**
   * กู้การแจ้งเตือนที่หายไปกับคิว
   *
   * รันตอนเปิดเครื่องก่อนหนึ่งรอบ เพราะเหตุที่ทำให้งานหายคือ Redis หาย
   * ซึ่งมักเกิดพร้อมกับการรีสตาร์ตพอดี — รอบแรกจึงสำคัญที่สุด
   */
  const queue = createSlaQueue(connection);
  const reconcileDeps = {
    loadOverdueClocks: async (limit: number): Promise<ClockRow[]> =>
      // ข้ามขอบเขต tenant โดยเจตนา: นี่คืองานกวาดของระบบ ไม่ใช่คำขอของผู้ใช้
      // ตัวจัดการงานจะอ่านซ้ำแบบผูก tenant อีกครั้งก่อนส่งจริง
      prisma.workItemSla.findMany({
        where: { state: { in: ['running', 'breached'] }, breachedAt: { lte: systemClock.nowUtc() } },
        select: { id: true, tenantId: true, workItemId: true, state: true, breachedAt: true },
        orderBy: { breachedAt: 'asc' },
        take: limit,
      }),
    loadNotifiedKeys: async (candidates: string[]): Promise<string[]> => {
      const rows = await prisma.notification.findMany({
        where: { dedupeKey: { in: candidates } },
        select: { dedupeKey: true },
      });
      return rows.map((r) => r.dedupeKey);
    },
    enqueue: async (jobs: PlannedJob[]): Promise<void> => enqueueReconciled(queue, jobs),
    now: (): Date => systemClock.nowUtc(),
  };

  const reconcileOnce = async (): Promise<void> => {
    try {
      const r = await runReconcile(reconcileDeps);
      if (r.enqueued > 0) {
        console.log(`[กู้] พบนาฬิกาหลุดที่ยังไม่ได้แจ้ง ${String(r.enqueued)} เรือน จาก ${String(r.scanned)} ที่ตรวจ`);
      }
    } catch (err) {
      // การกู้ล้มเหลวต้องไม่ทำให้ worker ตาย — งานปกติยังต้องเดินต่อ
      console.error('[กู้] ล้มเหลว:', err instanceof Error ? err.message : String(err));
    }
  };

  await reconcileOnce();
  const reconcileTimer = setInterval(() => void reconcileOnce(), RECONCILE_EVERY_MS);

  console.log(
    `Worker พร้อมทำงาน — คิว sla-notification · กวาดหาที่ตกหล่นทุก ${String(Math.round(RECONCILE_EVERY_MS / 1000))} วินาที`,
  );

  const shutdown = async (): Promise<void> => {
    console.log('\nกำลังปิด worker…');
    // ปิดอย่างนุ่มนวล — งานที่กำลังทำอยู่ต้องจบก่อน ไม่งั้นจะถูกลองใหม่โดยไม่จำเป็น
    clearInterval(reconcileTimer);
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
