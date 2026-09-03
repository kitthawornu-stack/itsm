/**
 * ตัวตั้งเวลาอ่านกล่องเมล
 *
 * `runEmailIntake` เป็นกลไกที่ดีแต่ **ไม่มีค่าอะไรถ้าไม่มีอะไรเรียกมัน** —
 * รอบก่อนเรียกได้จากสคริปต์เท่านั้น ซึ่งแปลว่าในการใช้งานจริงไม่มีใครเรียกเลย
 *
 * ## ปิดอยู่ต้องบอกว่าทำไม
 *
 * อีเมลขาเข้าที่ปิดเงียบ ๆ แปลว่าคำขอของคนหายไปทุกฉบับ และคนที่ส่งมาจะสรุปว่า
 * ไม่มีใครสนใจ · ตอนบูตจึงเขียน log เสมอว่าเปิดอยู่หรือปิด และถ้าปิดเพราะอะไร
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { systemClock } from '@itsm/types';

import { withSystemScope } from '../../infrastructure/prisma/tenant-scope';
import { runEmailIntake } from './email-intake.service';
import { readIntakeConfig, type IntakeConfig } from './intake-config';
import { MailpitSource } from './mail-source';

import { schedulersEnabled } from '../../infrastructure/scheduler/enabled';

/** หน่วงก่อนรอบแรก — ให้ระบบขึ้นครบก่อน */
export const FIRST_INTAKE_DELAY_MS = 25 * 1000;

/** จำนวนจดหมายสูงสุดต่อรอบ — กล่องที่ค้างมานานต้องไม่ทำให้รอบเดียวยาวเป็นนาที */
export const INTAKE_BATCH = 50;

@Injectable()
export class EmailIntakeScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('EmailIntake');
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private running = false;
  private config: IntakeConfig | null = null;

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
    const result = readIntakeConfig(process.env);
    if (!result.ready) {
      // บอกเหตุผลเสมอ · ความเงียบตรงนี้แปลว่าคำขอของคนหายไปโดยไม่มีใครรู้
      this.log.log(`ไม่ได้เปิดรับอีเมลขาเข้า: ${result.reason}`);
      return;
    }
    this.config = result.config;
    this.log.log(
      `เปิดรับอีเมลขาเข้า — อ่านจาก ${result.config.baseUrl} ทุก ` +
        `${String(Math.round(result.config.intervalMs / 1000))} วินาที ` +
        `เข้าโปรเจกต์ ${result.config.projectKey}`,
    );

    this.firstRun = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), result.config.intervalMs);
    }, FIRST_INTAKE_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.firstRun !== null) clearTimeout(this.firstRun);
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** public เพื่อให้เรียกจากเทสต์ได้โดยไม่ต้องรอรอบ */
  async tick(): Promise<void> {
    const config = this.config;
    if (config === null) return;
    if (this.running) {
      this.log.warn('รอบก่อนหน้ายังไม่จบ ข้ามรอบนี้');
      return;
    }
    this.running = true;

    try {
      /*
        กล่องเมลหนึ่งกล่องต่อหนึ่งองค์กร ยังไม่รองรับ — รอบนี้อ่านให้องค์กรเดียว
        คือองค์กรที่มีโปรเจกต์ตามที่ตั้งค่าไว้ · การเดาว่าเป็นองค์กรแรกในตาราง
        จะทำให้ตั๋วไปโผล่ผิดที่เงียบ ๆ ในวันที่มีองค์กรที่สอง
      */
      const project = await withSystemScope(
        'หาองค์กรเจ้าของโปรเจกต์ที่ตั้งไว้สำหรับอีเมลขาเข้า ไม่ได้มาจากคำขอของผู้ใช้',
        async (db) =>
          db.project.findFirst({
            where: { key: config.projectKey },
            select: { tenantId: true },
          }),
      );
      if (project === null) {
        this.log.error(
          `ไม่พบโปรเจกต์ ${config.projectKey} ที่ตั้งไว้ใน MAIL_INTAKE_PROJECT — ` +
            'อีเมลขาเข้าจะไม่ถูกอ่านจนกว่าจะแก้',
        );
        return;
      }

      const result = await runEmailIntake(
        { tenantId: project.tenantId, actorId: null },
        new MailpitSource(config.baseUrl),
        {
          systemAddress: config.systemAddress,
          projectKey: config.projectKey,
          issueTypeName: config.issueTypeName,
        },
        INTAKE_BATCH,
        systemClock.nowUtc(),
      );

      // เงียบเมื่อไม่มีอะไรเกิดขึ้น — log ที่พูดทุกห้านาทีไม่มีใครอ่าน
      if (result.created + result.commented + result.rejected > 0) {
        this.log.log(
          `อ่านกล่องเมล — สร้าง ${String(result.created)} · ความเห็น ${String(result.commented)} ` +
            `· ปฏิเสธ ${String(result.rejected)} · เคยอ่านแล้ว ${String(result.skipped)}`,
        );
      }
    } catch (e) {
      /*
        ต่อกล่องไม่ได้ไม่ควรทำให้โปรเซสตาย · แต่ต้องไม่เงียบด้วย — กล่องที่
        ต่อไม่ได้เป็นวันคือคำขอที่ค้างอยู่เป็นวัน
      */
      this.log.error(`อ่านกล่องเมลล้ม: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }
}
