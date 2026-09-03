/**
 * ตัวเก็บกวาดเซสชันที่เดินเป็นรอบ
 *
 * **กลไกที่ไม่มีอะไรเรียกใช้ ป้องกันอะไรไม่ได้เลย** (CLAUDE.md) — `reapSessions`
 * ที่ไม่มีตัวเดิน ก็คือตารางที่โตต่อไปเหมือนเดิม
 *
 * ทุก 6 ชั่วโมง ไม่ใช่ทุกนาที · แถวที่ตายแล้วไม่รีบไปไหน และรอบถี่ ๆ
 * บนตารางที่คนกำลังล็อกอินอยู่มีแต่เสีย
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { systemClock } from '@itsm/types';

import { reapSessions } from './session-reaper.service';

import { schedulersEnabled } from '../../infrastructure/scheduler/enabled';

/** หน่วงก่อนรอบแรก — ให้ระบบขึ้นครบก่อน */
export const FIRST_REAP_DELAY_MS = 60 * 1000;
export const REAP_INTERVAL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class SessionReaperScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SessionReaper');
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private running = false;

  onModuleInit(): void {
    /*
      สวิตช์รวมของงานเบื้องหลัง — ปิดพร้อมกันทุกตัวด้วย `SCHEDULERS=off`
      เทสต์ที่ยกแอปขึ้นทั้งตัวใช้สิ่งนี้ เพื่อไม่ให้ตัวตั้งเวลาไปแตะฐานข้อมูล
      ที่ไฟล์เทสต์อื่นกำลังใช้อยู่ (ดูเหตุผลเต็มใน `infrastructure/scheduler/enabled.ts`)
    */
    if (!schedulersEnabled()) {
      this.log.log('ปิดงานเบื้องหลังไว้ (SCHEDULERS=off)');
      return;
    }
    this.log.log(
      `เก็บกวาดเซสชันทุก ${String(Math.round(REAP_INTERVAL_MS / 3_600_000))} ชั่วโมง`,
    );
    this.firstRun = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), REAP_INTERVAL_MS);
    }, FIRST_REAP_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.firstRun !== null) clearTimeout(this.firstRun);
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** public เพื่อให้เรียกจากเทสต์ได้โดยไม่ต้องรอรอบ */
  async tick(): Promise<void> {
    if (this.running) {
      this.log.warn('รอบก่อนหน้ายังไม่จบ ข้ามรอบนี้');
      return;
    }
    this.running = true;
    try {
      const r = await reapSessions(systemClock.nowUtc());
      /*
        **รายงานเฉพาะรอบที่ลบจริง** — ตัวกวาดที่พิมพ์ "ลบ 0 แถว" ทุกหกชั่วโมง
        ทำให้ log เต็มไปด้วยบรรทัดที่ไม่มีความหมาย แล้ววันที่มันพัง
        ก็ไม่มีใครสังเกตความเงียบ
      */
      if (r.deleted > 0) {
        this.log.log(`เก็บกวาดเซสชันที่ตายแล้ว ${String(r.deleted)} แถว (ตรวจ ${String(r.scanned)})`);
      }
    } catch (e) {
      this.log.error(`เก็บกวาดเซสชันล้ม: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }
}
