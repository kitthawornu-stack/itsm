/**
 * ต่อ SLA service เข้ากับ BullMQ
 *
 * อยู่ใน infrastructure ไม่ใช่ในโมดูล — โค้ดโดเมนไม่ควรรู้จัก Redis
 * ถ้า Redis ล่ม ระบบต้องยังทำงานได้ แค่ไม่มีการแจ้งเตือน จึงจับ error ไว้ที่นี่
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { setSlaJobDispatcher, type SlaJobDispatcher } from '../../modules/sla';

const QUEUE_NAME = 'sla-notification';

let queue: Queue | null = null;
let connection: IORedis | null = null;

export function initSlaDispatcher(): SlaJobDispatcher {
  connection = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  queue = new Queue(QUEUE_NAME, { connection });

  const dispatcher: SlaJobDispatcher = {
    async schedule(workItemSlaId, jobs, thresholds) {
      if (queue === null) return;
      try {
        // ลบทุกเกณฑ์ก่อน แล้วค่อยตั้งใหม่ — BullMQ ไม่แทนที่ delayed job ที่มี id เดิม
        for (const t of thresholds) {
          const id = `sla:${workItemSlaId.toString()}:${String(Math.round(t * 100))}`;
          const existing = await queue.getJob(id);
          if (existing !== undefined) await existing.remove();
        }
        for (const j of jobs) {
          await queue.add(QUEUE_NAME, j.payload, {
            jobId: j.jobId,
            delay: j.delayMs,
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: { age: 7 * 24 * 3600, count: 5_000 },
            removeOnFail: { age: 30 * 24 * 3600 },
          });
        }
      } catch (e) {
        // Redis ล่มไม่ควรทำให้การเปลี่ยนสถานะงานล้มเหลว
        // ผลที่ยอมรับได้: ไม่มีแจ้งเตือนรอบนี้ · แก้ได้ด้วยการ recompute ใหม่
        console.error('[sla-dispatcher] ตั้งงานแจ้งเตือนไม่สำเร็จ:', (e as Error).message);
      }
    },
  };

  setSlaJobDispatcher(dispatcher);
  return dispatcher;
}

export async function closeSlaDispatcher(): Promise<void> {
  setSlaJobDispatcher(null);
  await queue?.close();
  await connection?.quit();
  queue = null;
  connection = null;
}
