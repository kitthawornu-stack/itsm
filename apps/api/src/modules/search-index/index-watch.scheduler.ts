/**
 * เฝ้าระวังดัชนีค้นหา
 *
 * ## ทำไม `/health` อย่างเดียวไม่พอ
 *
 * `/health` ตอบถูกก็ต่อเมื่อมีคนถาม · ชุดที่ส่งมอบตอนนี้ไม่มีระบบเฝ้าระวัง
 * ภายนอกที่คอยถาม — Docker healthcheck ดูแค่ว่าโปรเซสยังตอบไหม ไม่ได้อ่าน
 * เนื้อคำตอบ · ดัชนีจึงหายได้เป็นวันโดยไม่มีใครรู้ ซึ่งเกิดขึ้นจริงมาแล้ว
 *
 * ตัวนี้จึงถามเอง แล้ว **เขียนคำเตือนลง log** เมื่อผิดปกติ · log ไม่ใช่การ
 * เฝ้าระวังที่ดีที่สุด แต่เป็นสิ่งเดียวที่มีอยู่จริงในชุดที่ส่งมอบวันนี้
 * และดีกว่าการรอให้ผู้ใช้เป็นคนแรกที่รู้
 *
 * ## เตือนตอนเปลี่ยนสถานะ ไม่ใช่ทุกนาที
 *
 * คำเตือนเดิมซ้ำทุกห้านาทีทำให้ log อ่านไม่ได้ และคนเลิกอ่าน · เตือนเมื่อ
 * **สถานะเปลี่ยน** เท่านั้น รวมถึงตอนกลับมาปกติ — คนที่เห็นคำเตือนต้องเห็นด้วย
 * ว่ามันหายไปเมื่อไร ไม่งั้นไม่มีใครรู้ว่าแก้สำเร็จหรือยัง
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { indexHealthOfAll } from './indexer.service';
import { needsAttention, type IndexHealthState } from './index-health';

import { schedulersEnabled } from '../../infrastructure/scheduler/enabled';

/** ทุก 5 นาที — เท่ากับ sla-reconciler และตัวกวาดกฎอัตโนมัติ */
export const WATCH_INTERVAL_MS = 5 * 60 * 1000;

/** หน่วงก่อนรอบแรก — ให้ระบบขึ้นครบก่อน ไม่ใช่ตกใจตอนเพิ่งบูต */
export const FIRST_WATCH_DELAY_MS = 20 * 1000;

@Injectable()
export class IndexWatchScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('IndexWatch');
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  /** สถานะครั้งก่อนของแต่ละองค์กร — ใช้ตัดสินว่าจะเตือนซ้ำไหม */
  private readonly last = new Map<string, IndexHealthState>();

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
    if (process.env.INDEX_WATCH === 'off') {
      this.log.log('ปิดการเฝ้าระวังดัชนีไว้ (INDEX_WATCH=off)');
      return;
    }
    this.firstRun = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), WATCH_INTERVAL_MS);
    }, FIRST_WATCH_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.firstRun !== null) clearTimeout(this.firstRun);
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** public เพื่อให้เรียกจากเทสต์ได้โดยไม่ต้องรอ 5 นาที */
  async tick(): Promise<void> {
    try {
      for (const row of await indexHealthOfAll()) {
        const before = this.last.get(row.tenantId);
        this.last.set(row.tenantId, row.state);
        // เตือนเมื่อสถานะเปลี่ยนเท่านั้น — คำเตือนที่ซ้ำทุกห้านาที ไม่มีใครอ่าน
        if (before === row.state) continue;

        if (needsAttention(row.state)) {
          this.log.error(`ดัชนีค้นหาขององค์กร ${row.tenantId} ผิดปกติ: ${row.detail}`);
        } else if (before !== undefined) {
          // กลับมาปกติต้องบอกด้วย ไม่งั้นไม่มีใครรู้ว่าแก้สำเร็จหรือยัง
          this.log.log(`ดัชนีค้นหาขององค์กร ${row.tenantId} กลับมาปกติแล้ว: ${row.detail}`);
        }
      }
    } catch (e) {
      /*
        ตัวเฝ้าระวังที่ล้มเงียบ คือตัวเฝ้าระวังที่ไม่มี · แต่ก็ต้องไม่ทำให้
        โปรเซสตาย เพราะมันเป็นงานเบื้องหลังที่ไม่มีใครรออยู่
      */
      this.log.error(`เฝ้าระวังดัชนีล้ม: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
