/**
 * ส่งรายงานตามตารางเวลา
 *
 * **ตรรกะ "ส่งหรือไม่ส่ง" เป็นฟังก์ชันบริสุทธิ์** และ SMTP กับฐานข้อมูล
 * ฉีดเข้ามา · มิฉะนั้นจะทดสอบเคส "เมื่อไรจะไม่ส่ง" ไม่ได้เลย ซึ่งเป็น
 * เคสส่วนใหญ่ (CLAUDE.md)
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 *   1. **บันทึกหลังส่งสำเร็จ** — เครื่องที่ดับระหว่างรอ SMTP ตอบ จะกลับมา
 *      ส่งซ้ำทั้งชุด · จึงต้อง **จองก่อนทำ**
 *   2. **ล้มทั้งรอบเพราะใบเดียว** — ตารางหนึ่งพังแล้วอีกเก้าใบไม่ได้ส่ง
 *   3. **ตามเก็บรอบที่ตกไปทั้งหมด** — ผู้รับเห็นเป็นสแปมแล้วเลิกอ่าน ·
 *      ส่งรอบเดียวแล้ว **บอกในเนื้อความว่าตกไปกี่รอบ**
 *   4. **สิทธิ์ที่ถูกถอนไปแล้วยังส่งต่อ** — ผู้เรียกต้องตรวจสิทธิ์ทุกรอบ
 */
import { missedRuns, nextRunAt, toUtcDate, type Schedule, type UtcDate } from '@itsm/types';

import type { MailSender } from './email-notifier';

/** ตารางเวลาหนึ่งแถว ตามที่อ่านมาจากฐานข้อมูล */
export interface ScheduleRowRaw {
  id: bigint;
  tenantId: bigint;
  name: string;
  projectKey: string;
  ownerEmail: string;
  schedule: Schedule;
  isEnabled: boolean;
  lastRunAt: Date | null;
}

/** ผลการตัดสินว่าจะส่งหรือไม่ */
export type SendDecision =
  | { send: false; reason: string }
  | { send: true; to: string; missed: number };

/**
 * ตัดสินว่าตารางนี้ถึงรอบส่งหรือยัง — **ฟังก์ชันบริสุทธิ์**
 *
 * **เหตุผลที่ไม่ส่งก็ต้องบอกได้** · แถวที่เงียบไปโดยไม่มีเหตุผล คือความเงียบ
 * ที่ไม่มีใครสืบต่อได้ว่าทำไมคนถึงไม่ได้รับ (CLAUDE.md)
 */
export function decideSend(row: ScheduleRowRaw, now: UtcDate): SendDecision {
  if (!row.isEnabled) return { send: false, reason: 'ปิดไว้' };
  if (row.ownerEmail.trim() === '') return { send: false, reason: 'เจ้าของไม่มีอีเมล' };

  const last = row.lastRunAt === null ? null : toUtcDate(row.lastRunAt);
  /*
    **นับรอบถัดไปจากครั้งล่าสุด ไม่ใช่จากตอนนี้**

    `nextRunAt(s, now, last)` ให้รอบถัดไปที่อยู่ *ข้างหน้า* เสมอ · ถ้าใช้
    ค่านั้นมาตัดสิน ตารางที่เลยกำหนดมาแล้วจะไม่มีวันถึงรอบเลย เพราะคำตอบ
    จะเป็นอนาคตทุกครั้งที่ถาม — **เงียบสนิท ไม่มี error และไม่มีใครได้รับ
    รายงานอีกเลย** · ต้องถามว่า "รอบแรกหลังจากครั้งล่าสุดคือเมื่อไร"
    แล้วดูว่ามันมาถึงหรือยัง
  */
  const due = nextRunAt(row.schedule, last ?? now, last);
  if (due.getTime() > now.getTime()) {
    return { send: false, reason: `ยังไม่ถึงรอบ (${due.toISOString()})` };
  }
  /*
    **ส่งรอบเดียว ไม่ตามเก็บย้อนหลัง** · แต่บอกจำนวนรอบที่ตกไป เพื่อให้
    ผู้รับรู้ว่าเคยมีรอบที่ไม่ได้ส่ง — ถ้าเงียบไปเลยจะไม่มีใครรู้
  */
  return { send: true, to: row.ownerEmail.trim(), missed: missedRuns(row.schedule, last, now) };
}

/** เนื้อความอีเมล — บอกจำนวนรอบที่ตกไปเมื่อมี */
export function renderReportEmail(
  row: ScheduleRowRaw,
  missed: number,
  rows: number,
  webBaseUrl: string,
): { subject: string; text: string } {
  const late =
    missed > 1
      ? `\n\nหมายเหตุ: รอบก่อนหน้าไม่ได้ถูกส่ง ${String(missed - 1)} ครั้ง` +
        ' (ระบบส่งเฉพาะรอบล่าสุด ไม่ส่งย้อนหลังทั้งหมด)'
      : '';
  return {
    subject: `รายงาน ${row.name} · ${row.projectKey}`,
    text:
      `รายงานตามตารางเวลา "${row.name}" ของโปรเจกต์ ${row.projectKey}\n` +
      `ไฟล์แนบมี ${String(rows)} รายการ\n\n` +
      `ดูบนหน้าจอ: ${webBaseUrl}/reports${late}`,
  };
}

export interface ReportSenderDeps {
  /** ตารางที่เปิดอยู่ทั้งหมด — กรองว่าใบไหนถึงรอบเป็นหน้าที่ของ `decideSend` */
  loadEnabled(limit: number): Promise<ScheduleRowRaw[]>;
  /**
   * จองรอบนี้ — บันทึก `lastRunAt` **ก่อน** ประกอบไฟล์และติดต่อ SMTP
   *
   * คืน false เมื่อมี worker อีกตัวจองไปก่อน · เครื่องที่ดับหลังจองแล้ว
   * จะไม่ส่งซ้ำ เพราะรอบนั้นถูกทำเครื่องหมายว่าใช้ไปแล้ว —
   * **ยอมพลาดหนึ่งรอบ ดีกว่าส่งซ้ำโดยไม่มีใครรู้ว่ากี่ครั้ง**
   */
  claim(id: bigint, at: Date): Promise<boolean>;
  /** ประกอบไฟล์ด้วยสิทธิ์ของเจ้าของ · โยน error เมื่อสิทธิ์ถูกถอนไปแล้ว */
  buildCsv(row: ScheduleRowRaw): Promise<{ csv: string; filename: string; rows: number }>;
  markError(id: bigint, error: string): Promise<void>;
  clearError(id: bigint): Promise<void>;
  mailer: MailSender;
  webBaseUrl: string;
}

export interface SenderReport {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * รอบการส่งหนึ่งรอบ
 *
 * **ล้มทีละใบ ไม่ล้มทั้งรอบ** — ตารางหนึ่งที่พัง (สิทธิ์ถูกถอน · โปรเจกต์
 * ถูกลบ · SMTP ปฏิเสธ) ต้องไม่ทำให้อีกเก้าใบไม่ได้ส่ง
 */
export async function runReportSender(
  deps: ReportSenderDeps,
  /**
   * "ตอนนี้" ส่งเข้ามาเสมอ — **ห้ามอ่านนาฬิกาเอง**
   *
   * กติกาเดียวกับเอนจิน SLA · ทำให้ทดสอบเคสข้ามวันข้ามเดือนได้โดยไม่ต้อง
   * รอจริง และไม่มีเทสต์ไหนขึ้นกับเวลาที่รันมัน
   */
  now: UtcDate,
  limit = 50,
): Promise<SenderReport> {
  const rows = await deps.loadEnabled(limit);
  const report: SenderReport = { scanned: rows.length, sent: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    const decision = decideSend(row, now);
    if (!decision.send) {
      report.skipped += 1;
      continue;
    }

    /*
      **จองก่อนทำ** · การประกอบไฟล์กับการติดต่อ SMTP ใช้เวลาได้หลายวินาที
      ถ้าบันทึกหลังส่งสำเร็จ เครื่องที่ดับระหว่างนั้นจะกลับมาส่งซ้ำทั้งชุด
      โดยไม่มีอะไรจำได้ว่าเคยพยายามแล้ว
    */
    const claimed = await deps.claim(row.id, new Date(now.getTime()));
    if (!claimed) {
      report.skipped += 1;
      continue;
    }

    try {
      const file = await deps.buildCsv(row);
      const mail = renderReportEmail(row, decision.missed, file.rows, deps.webBaseUrl);
      await deps.mailer.send({ to: decision.to, subject: mail.subject, text: mail.text });
      await deps.clearError(row.id);
      report.sent += 1;
    } catch (e) {
      /*
        **เหตุผลที่ล้มต้องถูกบันทึก** ไม่ใช่แค่ log แล้วหาย · เจ้าของตาราง
        ต้องเห็นบนหน้าจอว่าทำไมรายงานไม่มา มิฉะนั้นเขาจะไม่รู้ด้วยซ้ำ
        ว่าควรได้รับ
      */
      await deps.markError(row.id, e instanceof Error ? e.message : String(e));
      report.failed += 1;
    }
  }
  return report;
}
