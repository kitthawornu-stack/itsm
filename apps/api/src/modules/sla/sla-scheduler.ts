/**
 * ตั้งเวลาแจ้งเตือน SLA
 *
 * **จุดที่พลาดง่ายที่สุดของทั้งฟีเจอร์**: ทุกครั้งที่มีเหตุการณ์กับนาฬิกา
 * (พัก กลับมาเดิน เปลี่ยนเป้า ปิดงาน) ต้อง **ยกเลิกงานที่ตั้งไว้เดิมก่อนตั้งใหม่**
 *
 * ถ้าไม่ยกเลิก: ตั๋วที่ถูกพักไว้สองวันแล้วกลับมาเดิน จะยังมี job เก่าที่ตั้งไว้
 * ตามเวลาเดิมค้างอยู่ ผู้ใช้จะได้แจ้งเตือน "ใกล้หลุด SLA" ทั้งที่เพิ่งเริ่มนับใหม่
 * และจะได้ซ้ำอีกครั้งตอน job ใหม่ทำงาน — เป็นความผิดพลาดที่ผู้ใช้จำได้นาน
 * เพราะมันทำให้เลิกเชื่อการแจ้งเตือนทั้งระบบ
 *
 * วิธีกัน: jobId คำนวณจาก (นาฬิกา, เกณฑ์) เท่านั้น ไม่มีเวลาอยู่ในคีย์
 * การตั้งใหม่ด้วยคีย์เดิมจึงแทนที่ของเดิมได้เสมอ
 */
import type { UtcDate } from '@itsm/types';

/** เกณฑ์ที่ระบบแจ้งเตือน — 50% และ 75% เตือนล่วงหน้า, 100% คือหลุดแล้ว */
export const SLA_THRESHOLDS = [0.5, 0.75, 1] as const;
export type SlaThreshold = (typeof SLA_THRESHOLDS)[number];

export interface SlaJobPayload {
  tenantId: string;
  workItemId: string;
  workItemSlaId: string;
  threshold: number;
  /** เวลาที่ตั้งใจให้ทำงาน — ใช้ตรวจว่า job ยังสมเหตุสมผลตอนถูกหยิบขึ้นมา */
  scheduledFor: string;
}

/**
 * คีย์ของงานหนึ่งชิ้น — **ห้ามมีเวลาอยู่ในคีย์**
 *
 * ถ้าใส่เวลาเข้าไป การตั้งใหม่จะสร้าง job เพิ่มแทนที่จะแทนที่ของเดิม
 * แล้วผู้ใช้จะได้แจ้งเตือนหลายรอบจากนาฬิกาเรือนเดียว
 */
export function slaJobId(workItemSlaId: bigint, threshold: number): string {
  return `sla:${workItemSlaId.toString()}:${String(Math.round(threshold * 100))}`;
}

export interface PlannedJob {
  jobId: string;
  delayMs: number;
  payload: SlaJobPayload;
}

/**
 * คำนวณว่าต้องตั้งงานอะไรบ้าง จากสถานะนาฬิกาปัจจุบัน
 *
 * คืนรายการว่างเมื่อไม่ควรมี job เลย (นาฬิกาพัก ปิด หรือหลุดไปแล้ว)
 * — ผู้เรียกต้องตีความว่า "ลบทุก job ของนาฬิกาเรือนนี้" ไม่ใช่ "ไม่ต้องทำอะไร"
 */
export function planSlaJobs(params: {
  tenantId: bigint;
  workItemId: bigint;
  workItemSlaId: bigint;
  state: string;
  notifications: Array<{ threshold: number; at: UtcDate }>;
  now: UtcDate;
}): PlannedJob[] {
  /**
   * นาฬิกาที่หลุดไปแล้วแต่ยังเดินอยู่ ต้องแจ้งเตือนเกณฑ์ 100% **ทันที**
   *
   * ทำไมต้องมีเส้นทางนี้: งานเกณฑ์ 100% ถูกตั้งไว้ตอนที่ยังไม่หลุด
   * ถ้าระบบดับหรือ Redis ถูกล้างในช่วงนั้น งานจะหายไปและไม่มีใครได้รับแจ้งเตือนเลย
   * — ซึ่งเป็นการเงียบในเคสที่สำคัญที่สุด
   *
   * การส่งซ้ำไม่ใช่ปัญหา เพราะ dedupeKey บน unique index กันไว้อีกชั้น
   */
  if (params.state === 'breached') {
    return [
      {
        jobId: slaJobId(params.workItemSlaId, 1),
        delayMs: 0,
        payload: {
          tenantId: params.tenantId.toString(),
          workItemId: params.workItemId.toString(),
          workItemSlaId: params.workItemSlaId.toString(),
          threshold: 1,
          scheduledFor: params.now.toISOString(),
        },
      },
    ];
  }

  if (params.state !== 'running') return [];

  const out: PlannedJob[] = [];
  for (const n of params.notifications) {
    const delayMs = n.at.getTime() - params.now.getTime();
    // เกณฑ์ที่เลยมาแล้วไม่ตั้งย้อนหลัง — แจ้งเตือนที่มาช้ากว่าเหตุการณ์จริงสร้างความสับสน
    if (delayMs < 0) continue;
    out.push({
      jobId: slaJobId(params.workItemSlaId, n.threshold),
      delayMs,
      payload: {
        tenantId: params.tenantId.toString(),
        workItemId: params.workItemId.toString(),
        workItemSlaId: params.workItemSlaId.toString(),
        threshold: n.threshold,
        scheduledFor: n.at.toISOString(),
      },
    });
  }
  return out;
}

/** คีย์กันส่งซ้ำในตาราง notification — เหตุการณ์เดียวกันได้คีย์เดียวกันเสมอ */
export function slaDedupeKey(workItemSlaId: bigint, threshold: number): string {
  return `sla-threshold:${workItemSlaId.toString()}:${String(Math.round(threshold * 100))}`;
}

/** ข้อความแจ้งเตือน — ภาษาคน ไม่ใช่ศัพท์ระบบ (CLAUDE.md §5) */
export function slaNotificationText(params: {
  itemKey: string;
  summary: string;
  goalName: string;
  threshold: number;
}): { title: string; body: string } {
  const pct = Math.round(params.threshold * 100);
  const title =
    params.threshold >= 1
      ? `${params.itemKey} หลุด SLA แล้ว`
      : `${params.itemKey} ใช้เวลาไปแล้ว ${pct}% ของเป้าหมาย`;
  return {
    title,
    body: `${params.summary}\nเป้าหมาย: ${params.goalName}`,
  };
}
