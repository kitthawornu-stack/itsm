/**
 * ตัวส่ง webhook ที่เดินเป็นรอบ
 *
 * `dispatchDue` เป็นกลไกที่ดีแต่ **ไม่มีค่าอะไรถ้าไม่มีอะไรเรียกมัน** —
 * ใบจองจะค้างเป็น `pending` ตลอดไป แล้วผู้ดูแลจะเห็นว่า "จองแล้วแต่ไม่ส่ง"
 * ซึ่งดูเหมือนระบบพัง ทั้งที่แค่ไม่มีใครกดปุ่มเดิน
 *
 * ## ทำไมเป็น timer ไม่ใช่คิว
 *
 * งานนี้อ่านสภาพจากตารางทุกครั้ง ไม่ได้พึ่งอะไรที่ค้างอยู่ในหน่วยความจำ ·
 * เครื่องที่ดับแล้วเปิดใหม่จึงกลับมาส่งต่อได้เอง ไม่ต้องมีตัวกู้แยกต่างหาก
 * แบบที่คิว SLA ต้องมี (`sla-reconciler.ts`) — **ทุกอย่างที่พึ่งพาคิว
 * ต้องมีทางกลับมาจากฐานข้อมูล** ที่นี่ฐานข้อมูลเป็นทางเดียวตั้งแต่ต้น
 *
 * ## เดินให้ทุกองค์กร
 *
 * ต่างจากตัวอ่านอีเมลที่ผูกกับโปรเจกต์เดียวตามค่าตั้ง · ปลายทาง webhook
 * เป็นของแต่ละองค์กร จึงต้องไล่ทุกองค์กรที่มีปลายทางเปิดอยู่ ·
 * การเดาว่าเป็นองค์กรแรกในตารางจะทำให้เหตุการณ์ขององค์กรที่สองค้างเงียบ ๆ
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { systemClock } from '@itsm/types';

import { withSystemScope } from '../../infrastructure/prisma/tenant-scope';
import { dispatchDue } from './webhook.service';

/** หน่วงก่อนรอบแรก — ให้ระบบขึ้นครบก่อน */
export const FIRST_DISPATCH_DELAY_MS = 15 * 1000;
/** ระยะห่างระหว่างรอบ — ถี่กว่านี้ไม่ได้อะไร เพราะระยะรอลองใหม่สั้นสุดคือ 30 วินาที */
export const DISPATCH_INTERVAL_MS = 20 * 1000;

@Injectable()
export class WebhookScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Webhook');
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private running = false;

  onModuleInit(): void {
    this.log.log(
      `ตัวส่ง webhook ทำงานทุก ${String(Math.round(DISPATCH_INTERVAL_MS / 1000))} วินาที`,
    );
    this.firstRun = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), DISPATCH_INTERVAL_MS);
    }, FIRST_DISPATCH_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.firstRun !== null) clearTimeout(this.firstRun);
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** public เพื่อให้เรียกจากเทสต์ได้โดยไม่ต้องรอรอบ */
  async tick(): Promise<void> {
    if (this.running) {
      // รอบที่ซ้อนกันจะส่งใบเดียวกันสองครั้ง — ปลายทางได้ของซ้ำโดยไม่ผิดที่เรา
      this.log.warn('รอบก่อนหน้ายังไม่จบ ข้ามรอบนี้');
      return;
    }
    this.running = true;
    try {
      const tenants = await withSystemScope(
        'ไล่ทุกองค์กรที่มีปลายทาง webhook เปิดอยู่ — งานเบื้องหลัง ไม่ได้มาจากคำขอของผู้ใช้',
        async (db) =>
          db.webhook.findMany({
            where: { isActive: true },
            select: { tenantId: true },
            distinct: ['tenantId'],
          }),
      );

      const now = systemClock.nowUtc();
      for (const t of tenants) {
        /*
          ล้มทีละองค์กร ไม่ล้มทั้งรอบ — องค์กรหนึ่งที่ข้อมูลมีปัญหา
          ต้องไม่ทำให้อีกองค์กรไม่ได้ส่ง
        */
        try {
          const r = await dispatchDue({ tenantId: t.tenantId, actorId: null }, now);
          if (r.attempted > 0) {
            this.log.log(
              `ส่ง ${String(r.sent)} · รอลองใหม่ ${String(r.retrying)} · ` +
                `เลิกลอง ${String(r.gaveUp)} (องค์กร ${t.tenantId.toString()})`,
            );
          }
        } catch (e) {
          this.log.error(
            `ส่ง webhook ขององค์กร ${t.tenantId.toString()} ล้ม: ` +
              (e instanceof Error ? e.message : String(e)),
          );
        }
      }
    } catch (e) {
      // ห้ามเงียบ · รอบที่ล้มโดยไม่มีร่องรอย คือ webhook ที่ "ไม่ส่งบางครั้ง"
      this.log.error(`รอบส่ง webhook ล้ม: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }
}
