/**
 * คิวแจ้งเตือน SLA บน BullMQ
 *
 * หน้าที่สองอย่างที่แยกกันชัดเจน:
 *   - `scheduleSlaJobs`  ตั้ง/แทนที่/ลบงานของนาฬิกาเรือนหนึ่ง
 *   - `slaWorker`        ทำงานเมื่อถึงเวลา
 *
 * กติกาที่ทำให้ไม่เตือนซ้ำ:
 *   1. jobId คำนวณจาก (นาฬิกา, เกณฑ์) เท่านั้น — ตั้งใหม่ = แทนที่
 *   2. ก่อนตั้งใหม่ **ลบของเดิมออกก่อนเสมอ** ไม่พึ่งพฤติกรรม upsert ของ BullMQ
 *      ซึ่งไม่แทนที่ delayed job ที่มี id เดิม แต่จะ "ไม่เพิ่ม" เฉย ๆ
 *      ผลคือเวลาเดิมค้างอยู่ ซึ่งเป็นบั๊กที่หายากที่สุดของฟีเจอร์นี้
 *   3. ตอน job ทำงาน **คำนวณ SLA ใหม่แล้วตรวจซ้ำ** ว่าเกณฑ์ยังถูกข้ามจริง
 *      เพราะ job อาจถูกหยิบขึ้นมาหลังสถานะเปลี่ยนไปแล้ว
 *   4. เขียน notification ด้วย dedupeKey บน unique index — ด่านสุดท้าย
 */
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';

export const SLA_QUEUE = 'sla-notification';

export interface SlaJobPayload {
  tenantId: string;
  workItemId: string;
  workItemSlaId: string;
  threshold: number;
  scheduledFor: string;
}

export interface PlannedJob {
  jobId: string;
  delayMs: number;
  payload: SlaJobPayload;
}

export function createConnection(): IORedis {
  return new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
}

export function createSlaQueue(connection: IORedis): Queue<SlaJobPayload> {
  return new Queue<SlaJobPayload>(SLA_QUEUE, { connection });
}

/**
 * ตั้งงานของนาฬิกาเรือนหนึ่งใหม่ทั้งหมด
 *
 * ลบทุกเกณฑ์ก่อนเสมอ แล้วค่อยตั้งเท่าที่ `planned` บอก
 * `planned` ว่างหมายถึง "ลบทั้งหมด ไม่ต้องตั้งใหม่" ซึ่งเกิดตอนนาฬิกาพักหรือปิด
 */
export async function scheduleSlaJobs(
  queue: Queue<SlaJobPayload>,
  workItemSlaId: string,
  planned: PlannedJob[],
  allThresholds: readonly number[],
): Promise<{ removed: number; added: number }> {
  let removed = 0;
  for (const t of allThresholds) {
    const id = `sla:${workItemSlaId}:${String(Math.round(t * 100))}`;
    const existing = await queue.getJob(id);
    if (existing !== undefined) {
      await existing.remove();
      removed += 1;
    }
  }

  for (const p of planned) {
    await queue.add(SLA_QUEUE, p.payload, {
      jobId: p.jobId,
      delay: p.delayMs,
      removeOnComplete: { age: 7 * 24 * 3600, count: 5_000 },
      // เก็บงานที่ล้มไว้นานกว่า — ต้องดูย้อนหลังได้ว่าทำไมไม่ได้แจ้งเตือน
      removeOnFail: { age: 30 * 24 * 3600 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    });
  }

  return { removed, added: planned.length };
}

export type SlaJobHandler = (payload: SlaJobPayload) => Promise<'sent' | 'skipped' | 'duplicate'>;

export function createSlaWorker(connection: IORedis, handler: SlaJobHandler): Worker<SlaJobPayload> {
  return new Worker<SlaJobPayload>(
    SLA_QUEUE,
    async (job: Job<SlaJobPayload>) => handler(job.data),
    {
      connection,
      // แจ้งเตือนไม่ใช่งานหนัก — ตั้งไว้พอประมาณเพื่อไม่ให้แย่ง connection กับ API
      concurrency: 5,
    },
  );
}
