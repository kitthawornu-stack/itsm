/**
 * ตัวตั้งเวลาให้ตัวกวาด `item.idle`
 *
 * ## ทำไมอยู่ในโปรเซสของ api ไม่ใช่ worker
 *
 * `apps/worker` เรียกโค้ดของ api ไม่ได้ (คนละ workspace คนละโปรเซส — เขียนไว้
 * ที่หัวไฟล์ `worker/src/main.ts`) · การกวาดต้องใช้เอนจิน กฎ และ service
 * ที่ลงมือทำจริง (มอบหมาย · เขียนความเห็น · เปลี่ยนสถานะ) ซึ่งอยู่ฝั่ง api
 * ทั้งหมด · การคัดลอกไปไว้ที่ worker คือการมีสองความจริง
 *
 * เมื่อไรที่ automation ย้ายไป worker จริงตามแผน (ADR-004) ไฟล์นี้ย้ายตาม
 *
 * ## ทำไม `setInterval` ไม่ใช่คิว
 *
 * รอบกวาดไม่มีสถานะให้จำ — มันอ่านสภาพจริงจากฐานข้อมูลทุกรอบ · การใส่คิว
 * เพิ่มชิ้นส่วนที่พังได้โดยไม่ได้ประโยชน์ และ "คิวไม่ใช่ที่เก็บถาวร" อยู่แล้ว
 *
 * ## ถ้ามี api หลายตัว
 *
 * ทุกตัวจะกวาดพร้อมกัน · **ไม่เป็นไรโดยการออกแบบ** เพราะตัวกันไม่ให้ทำซ้ำ
 * อยู่ในฐานข้อมูล (ดู `automation-scan.ts`) ตัวที่สองจะข้ามทั้งหมด ·
 * ที่เสียคือแรงเครื่อง ไม่ใช่ความถูกต้อง — และชุดที่ส่งมอบตอนนี้เป็นตัวเดียว
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { systemClock } from '@itsm/types';

import { withSystemScope } from '../../infrastructure/prisma/tenant-scope';
import { scanIdleItems } from './automation-scan';

import { schedulersEnabled } from '../../infrastructure/scheduler/enabled';

/**
 * ทุก 5 นาที — เท่ากับ `sla-reconciler`
 *
 * กฎที่วัดเป็นวัน ไม่ต้องการความละเอียดกว่านี้ · ถี่กว่านี้คือการอ่านฐานข้อมูล
 * บ่อยขึ้นโดยไม่มีใครได้อะไรเพิ่ม
 */
export const SCAN_INTERVAL_MS = 5 * 60 * 1000;

/** หน่วงก่อนรอบแรก — ให้ระบบขึ้นครบก่อน ไม่ใช่แย่งทรัพยากรตอนเพิ่งบูต */
export const FIRST_SCAN_DELAY_MS = 30 * 1000;

@Injectable()
export class AutomationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AutomationScheduler');
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  /** กันรอบที่ยังไม่จบทับรอบใหม่ — รอบที่ช้ากว่า interval มีจริงตอนกฎเยอะ */
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
    /*
      ปิดได้ด้วย env — เครื่องของนักพัฒนาที่รัน `pnpm dev` ค้างไว้ทั้งวัน
      ไม่ควรแตะข้อมูลเองทุกห้านาที · และเทสต์ที่ยกทั้งแอปขึ้นมาก็ไม่ควรถูก
      รบกวนจากงานเบื้องหลังที่ไม่เกี่ยวกับสิ่งที่มันวัด
    */
    if (process.env.AUTOMATION_SCAN === 'off') {
      this.log.log('ปิดการกวาดกฎอัตโนมัติไว้ (AUTOMATION_SCAN=off)');
      return;
    }
    this.firstRun = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), SCAN_INTERVAL_MS);
    }, FIRST_SCAN_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.firstRun !== null) clearTimeout(this.firstRun);
    if (this.timer !== null) clearInterval(this.timer);
  }

  /**
   * กวาดหนึ่งรอบให้ทุกองค์กร
   *
   * public เพื่อให้เรียกจากเทสต์ได้โดยไม่ต้องรอ 5 นาที — งานเบื้องหลังที่
   * เรียกเองไม่ได้ ทดสอบได้แค่ว่ามันคอมไพล์ผ่าน
   */
  async tick(now = systemClock.nowUtc()): Promise<void> {
    if (this.running) {
      this.log.warn('รอบก่อนหน้ายังไม่จบ ข้ามรอบนี้');
      return;
    }
    this.running = true;
    try {
      /*
        ต้องอ่านรายชื่อ tenant ข้าม tenant จริง ๆ — งานเบื้องหลังไม่ได้มาจาก
        คำขอของใคร จึงไม่มี tenant ติดมากับบริบท (CLAUDE.md §1.1)
      */
      const tenants = await withSystemScope(
        'ตัวกวาดกฎอัตโนมัติต้องวนทุกองค์กร ไม่ได้มาจากคำขอของผู้ใช้คนใด',
        async (db) => db.tenant.findMany({ select: { id: true } }),
      );

      for (const t of tenants) {
        try {
          const s = await scanIdleItems({ tenantId: t.id, actorId: null }, now);
          if (s.rules === 0) continue;
          this.log.log(
            `องค์กร ${t.id.toString()}: ปลุก ${String(s.fired)} · ข้าม ${String(s.skipped)} · ` +
              `ยกไปรอบหน้า ${String(s.deferred)} · จากกฎ ${String(s.rules)} ข้อ`,
          );
        } catch (e) {
          /*
            ล้มทีละองค์กร ไม่ล้มทั้งรอบ — องค์กรหนึ่งที่ข้อมูลมีปัญหา
            ต้องไม่ทำให้อีกสิบองค์กรไม่ได้กวาดเลย
          */
          this.log.error(
            `กวาดองค์กร ${t.id.toString()} ล้ม: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
