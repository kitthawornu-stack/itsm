/**
 * ทดสอบวงจรจริงกับ Redis — ตั้งงาน แทนที่ ลบ และให้ worker ทำงาน
 *
 * ไม่ใช่ unit test เพราะต้องมี Redis จริง · รันด้วย pnpm --filter @itsm/worker smoke
 */
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@itsm/types';

import { createConnection, createSlaQueue, createSlaWorker, scheduleSlaJobs } from './sla-queue';

const THRESHOLDS = [0.5, 0.75, 1];
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const connection = createConnection();
  const queue = createSlaQueue(connection);
  await queue.obliterate({ force: true }).catch(() => undefined);

  const slaId = '999';
  const mk = (t: number, delayMs: number) => ({
    jobId: `sla:${slaId}:${String(Math.round(t * 100))}`,
    delayMs,
    payload: {
      tenantId: '1', workItemId: '42', workItemSlaId: slaId,
      threshold: t, scheduledFor: new Date(systemClock.nowUtc().getTime() + delayMs).toISOString(),
    },
  });

  console.log('1) ตั้งงานสามเกณฑ์');
  let r = await scheduleSlaJobs(queue, slaId, [mk(0.5, 60_000), mk(0.75, 120_000), mk(1, 180_000)], THRESHOLDS);
  console.log(`   ลบ ${r.removed} · ตั้ง ${r.added} · ในคิว ${await queue.getDelayedCount()}`);

  console.log('2) ตั้งใหม่ด้วยเวลาที่ต่างออกไป — ต้องแทนที่ ไม่ใช่เพิ่มซ้อน');
  r = await scheduleSlaJobs(queue, slaId, [mk(0.5, 600_000), mk(0.75, 700_000), mk(1, 800_000)], THRESHOLDS);
  const afterReplace = await queue.getDelayedCount();
  console.log(`   ลบ ${r.removed} · ตั้ง ${r.added} · ในคิว ${afterReplace} ${afterReplace === 3 ? '(ถูกต้อง)' : '(ผิด! ควรเป็น 3)'}`);

  console.log('3) นาฬิกาพัก — ต้องลบทุกงาน');
  r = await scheduleSlaJobs(queue, slaId, [], THRESHOLDS);
  const afterPause = await queue.getDelayedCount();
  console.log(`   ลบ ${r.removed} · ในคิว ${afterPause} ${afterPause === 0 ? '(ถูกต้อง)' : '(ผิด! ควรเป็น 0)'}`);

  console.log('4) worker ทำงานกับงานที่ถึงเวลาแล้ว');
  const seen: string[] = [];
  const worker = createSlaWorker(connection, (p) => {
    seen.push(`${p.workItemSlaId}:${String(p.threshold)}`);
    return Promise.resolve('skipped'); // ไม่มีนาฬิกาจริงในฐานข้อมูล
  });
  await scheduleSlaJobs(queue, slaId, [mk(1, 0)], THRESHOLDS);
  await new Promise((res) => setTimeout(res, 3000));
  console.log(`   worker หยิบงาน: ${seen.length > 0 ? seen.join(', ') + ' (ถูกต้อง)' : '(ผิด! ไม่ได้หยิบงานเลย)'}`);

  await worker.close();

  // 5) พิสูจน์ข้ออ้างในคอมเมนต์ของ sla-queue.ts:
  //    ถ้า **ไม่ลบก่อน** BullMQ จะไม่แทนที่ delayed job ที่มี id เดิม
  //    ถ้าข้ออ้างนี้ผิด แปลว่าโค้ดลบก่อนตั้งเป็นงานที่ไม่จำเป็น
  console.log('5) พิสูจน์ว่าจำเป็นต้องลบก่อน — เพิ่ม jobId เดิมซ้ำโดยไม่ลบ');
  await queue.obliterate({ force: true }).catch(() => undefined);
  const id = `sla:proof:100`;
  await queue.add('sla-notification', mk(1, 600_000).payload, { jobId: id, delay: 600_000 });
  await queue.add('sla-notification', mk(1, 5_000).payload, { jobId: id, delay: 5_000 });
  const job = await queue.getJob(id);
  const delay = job?.opts.delay ?? -1;
  console.log(
    `   delay หลังเพิ่มซ้ำ = ${String(delay)} ms ` +
      (delay === 600_000
        ? '(ค่าเดิมค้าง — ข้ออ้างถูก การลบก่อนจำเป็นจริง)'
        : '(ถูกแทนที่แล้ว — ข้ออ้างผิด ต้องแก้คอมเมนต์)'),
  );
  console.log(`   จำนวนงานในคิว = ${String(await queue.getDelayedCount())} (ไม่ได้เพิ่มเป็น 2)`);

  await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close();
  await connection.quit();
  await prisma.$disconnect();
}

main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
