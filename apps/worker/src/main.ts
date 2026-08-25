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
import {
  EMAIL_CHANNEL,
  MAX_ATTEMPTS,
  runEmailDelivery,
  type PendingNotification,
} from './email-notifier';
import { createMailer } from './mailer';
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

/**
 * ทุกกี่มิลลิวินาทีจึงส่งอีเมลที่ค้างหนึ่งรอบ
 *
 * ถี่กว่าตัวกวาด SLA เพราะคนรอเห็นอีเมล ไม่ใช่รอให้ระบบตรวจสอบตัวเอง
 * แต่ไม่ถี่จนกลายเป็นการ poll ฐานข้อมูลทุกวินาที — ครึ่งนาทีคือจุดที่รับได้ทั้งสองทาง
 */
const EMAIL_EVERY_MS = Number(process.env['EMAIL_DELIVERY_INTERVAL_MS'] ?? 30_000);
const WEB_BASE_URL = process.env['WEB_BASE_URL'] ?? 'http://localhost:3000';

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

  /**
   * ส่งการแจ้งเตือนที่ค้างออกทางอีเมล
   *
   * เลือกจาก "ยังไม่มีแถวส่งของช่องทางนี้" หรือ "ล้มแต่ยังไม่ครบจำนวนครั้ง"
   * ไม่เลือกจาก `pending` เพราะแถว pending คือใบที่มีคนกำลังส่งอยู่
   */
  const mailer = createMailer();
  const emailDeps = {
    loadUndelivered: async (limit: number): Promise<PendingNotification[]> => {
      const rows = await prisma.notification.findMany({
        where: {
          OR: [
            { deliveries: { none: { channel: EMAIL_CHANNEL } } },
            {
              deliveries: {
                some: { channel: EMAIL_CHANNEL, state: 'failed', attempts: { lt: MAX_ATTEMPTS } },
              },
            },
          ],
        },
        orderBy: { id: 'asc' },
        take: limit,
        select: {
          id: true,
          tenantId: true,
          title: true,
          body: true,
          readAt: true,
          workItemId: true,
          userId: true,
        },
      });

      /**
       * ดึงคีย์งานและผู้รับแยกกัน
       *
       * `notification` ตั้งใจไม่มี FK ไปทั้ง `work_item` และ `user` —
       * ประวัติการแจ้งเตือนต้องอยู่ต่อแม้งานถูกลบหรือผู้ใช้ถูกลบ
       * ราคาที่จ่ายคือคิวรีเพิ่มสองครั้งต่อรอบ ซึ่งถูกกว่าการเสียประวัติ
       */
      const itemIds = [...new Set(rows.map((r) => r.workItemId).filter((v) => v !== null))];
      const userIds = [...new Set(rows.map((r) => r.userId).filter((v) => v !== null))];
      const [items, users] = await Promise.all([
        prisma.workItem.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, itemKey: true },
        }),
        prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, displayName: true },
        }),
      ]);
      const keyById = new Map(items.map((i) => [i.id.toString(), i.itemKey]));
      const userById = new Map(users.map((u) => [u.id.toString(), u]));

      return rows.map((r) => {
        const u = r.userId === null ? undefined : userById.get(r.userId.toString());
        return {
          id: r.id,
          tenantId: r.tenantId,
          title: r.title,
          body: r.body,
          itemKey: r.workItemId === null ? null : (keyById.get(r.workItemId.toString()) ?? null),
          recipientEmail: u?.email ?? null,
          recipientName: u?.displayName ?? null,
          readAt: r.readAt,
        };
      });
    },

    claim: async (notificationId: bigint, tenantId: bigint, target: string | null) => {
      try {
        await prisma.notificationDelivery.upsert({
          where: { notificationId_channel: { notificationId, channel: EMAIL_CHANNEL } },
          create: {
            tenantId,
            notificationId,
            channel: EMAIL_CHANNEL,
            state: 'pending',
            target,
            attempts: 1,
          },
          // มีแถวอยู่แล้ว = เคยล้มมาก่อน ลองใหม่ได้แต่ต้องนับครั้ง
          update: { state: 'pending', target, attempts: { increment: 1 } },
        });
        return true;
      } catch (err) {
        // แข่งกับ worker อีกตัวแล้วแพ้ — ปล่อยให้อีกตัวส่ง ไม่ส่งทับ
        console.error(
          `[อีเมล] จองไม่ได้ ${notificationId.toString()}:`,
          err instanceof Error ? err.message : String(err),
        );
        return false;
      }
    },

    markSent: async (notificationId: bigint) => {
      await prisma.notificationDelivery.update({
        where: { notificationId_channel: { notificationId, channel: EMAIL_CHANNEL } },
        data: { state: 'sent', sentAt: systemClock.nowUtc(), lastError: null },
      });
    },
    markFailed: async (notificationId: bigint, error: string) => {
      await prisma.notificationDelivery.update({
        where: { notificationId_channel: { notificationId, channel: EMAIL_CHANNEL } },
        data: { state: 'failed', lastError: error.slice(0, 500) },
      });
    },
    markSkipped: async (notificationId: bigint, reason: string) => {
      await prisma.notificationDelivery.update({
        where: { notificationId_channel: { notificationId, channel: EMAIL_CHANNEL } },
        data: { state: 'skipped', lastError: reason.slice(0, 500) },
      });
    },
    mailer,
    webBaseUrl: WEB_BASE_URL,
  };

  const deliverOnce = async (): Promise<void> => {
    try {
      const r = await runEmailDelivery(emailDeps);
      if (r.sent > 0 || r.failed > 0 || r.skipped > 0) {
        console.log(
          `[อีเมล] ส่ง ${String(r.sent)} · ข้าม ${String(r.skipped)} · ล้ม ${String(r.failed)} จาก ${String(r.scanned)} ที่ค้าง`,
        );
      }
    } catch (err) {
      // SMTP ล่มต้องไม่ทำให้ worker ตาย — คิว SLA ยังต้องเดินต่อ
      console.error('[อีเมล] รอบส่งล้มเหลว:', err instanceof Error ? err.message : String(err));
    }
  };

  await deliverOnce();
  const emailTimer = setInterval(() => void deliverOnce(), EMAIL_EVERY_MS);

  console.log(
    `Worker พร้อมทำงาน — คิว sla-notification · กวาดหาที่ตกหล่นทุก ${String(Math.round(RECONCILE_EVERY_MS / 1000))} วินาที · ส่งอีเมลทุก ${String(Math.round(EMAIL_EVERY_MS / 1000))} วินาที`,
  );

  const shutdown = async (): Promise<void> => {
    console.log('\nกำลังปิด worker…');
    // ปิดอย่างนุ่มนวล — งานที่กำลังทำอยู่ต้องจบก่อน ไม่งั้นจะถูกลองใหม่โดยไม่จำเป็น
    clearInterval(reconcileTimer);
    clearInterval(emailTimer);
    mailer.close();
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
