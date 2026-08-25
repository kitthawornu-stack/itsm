/**
 * เทียบฐานข้อมูลกับคิว — ด่านสุดท้ายกันการเงียบ
 *
 * **ปัญหาที่แก้**: งานแจ้งเตือนอยู่ใน Redis เท่านั้น ซึ่งไม่ใช่ที่เก็บถาวร
 * ถ้า Redis ถูกล้าง ถูกย้าย หรือดับตอนที่ไม่ได้เปิด persistence
 * งานที่ตั้งค้างไว้ทั้งหมดหายไปเงียบ ๆ และไม่มีอะไรกู้คืนมันเลย
 * ตั๋วที่หลุด SLA จะไม่มีใครได้รับแจ้ง ทั้งที่ฐานข้อมูลรู้อยู่เต็ม ๆ ว่ามันหลุดแล้ว
 *
 * วัดจริงในฐานข้อมูล dev: นาฬิกาหลุดแล้ว 96 เรือน มีแจ้งเตือน 11 อีก 85 เงียบสนิท
 *
 * **ขอบเขต: เกณฑ์ 100% เท่านั้น** — เพราะ `breach_at` ถูกเก็บไว้ในตาราง
 * เวลาของเกณฑ์ 50%/75% ไม่ได้เก็บ ต้องคำนวณจากปฏิทินเวลาทำการซึ่งอยู่ฝั่ง api
 * การเตือนล่วงหน้าที่หายไปหนึ่งครั้งเสียหายน้อยกว่าการไม่รู้ว่าหลุดแล้วมาก
 * จึงเลือกกู้เฉพาะอันที่สำคัญที่สุด แทนที่จะกู้ครึ่ง ๆ กลาง ๆ ทุกอัน
 *
 * ปลอดภัยที่จะรันซ้ำ: unique index บน (tenantId, dedupeKey) กันการส่งซ้ำอีกชั้น
 */
import type { PlannedJob } from './sla-queue';

/** สถานะที่ยังนับเวลาอยู่ — นาฬิกาที่พักหรือปิดแล้วไม่ต้องกู้ */
const LIVE_STATES = new Set(['running', 'breached']);

export interface ClockRow {
  id: bigint;
  tenantId: bigint;
  workItemId: bigint;
  state: string;
  /**
   * เวลาที่หลุดไปแล้วจริง — **ไม่ใช่** `breachAt`
   *
   * `breachAt` เป็นกำหนดในอนาคตและกลายเป็น null ทันทีที่หลุด
   * ถ้าใช้ค่านั้น ตัวกวาดจะหาไม่เจอสักเรือนเดียว เพราะทุกเรือนที่ควรเจอเป็น null หมด
   */
  breachedAt: Date | null;
}

/**
 * เลือกนาฬิกาที่หลุดแล้วแต่ยังไม่มีใครได้รับแจ้ง
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์ เพื่อให้เทสต์เงื่อนไขการข้าม
 * ได้โดยไม่ต้องมีฐานข้อมูล — ทุกเงื่อนไขที่นี่คือเหตุผลที่จะ **ไม่** ส่ง
 */
export function pickMissedBreaches(params: {
  clocks: ClockRow[];
  notifiedKeys: ReadonlySet<string>;
  now: Date;
}): PlannedJob[] {
  const out: PlannedJob[] = [];
  for (const c of params.clocks) {
    if (!LIVE_STATES.has(c.state)) continue;
    if (c.breachedAt === null) continue;
    // ยังไม่ถึงเวลาหลุด — งานที่ตั้งไว้ตามปกติจะจัดการเอง
    if (c.breachedAt.getTime() > params.now.getTime()) continue;
    if (params.notifiedKeys.has(reconcileDedupeKey(c.id))) continue;

    out.push({
      jobId: `sla:${c.id.toString()}:100`,
      delayMs: 0,
      payload: {
        tenantId: c.tenantId.toString(),
        workItemId: c.workItemId.toString(),
        workItemSlaId: c.id.toString(),
        threshold: 1,
        // เวลาที่ตั้งใจให้ทำงานคือเวลาที่มันหลุดจริง ไม่ใช่ตอนนี้
        // เพื่อให้ประวัติบอกได้ว่าการแจ้งเตือนนี้ช้าไปเท่าไร
        scheduledFor: c.breachedAt.toISOString(),
      },
    });
  }
  return out;
}

export function reconcileDedupeKey(workItemSlaId: bigint): string {
  return `sla-threshold:${workItemSlaId.toString()}:100`;
}

export interface ReconcileDeps {
  /** นาฬิกาที่ยังเดินหรือหลุดแล้ว และเลยเวลาหลุดมาแล้ว */
  loadOverdueClocks(limit: number): Promise<ClockRow[]>;
  /** คืนเฉพาะคีย์ที่มีอยู่จริงในตาราง notification */
  loadNotifiedKeys(candidates: string[]): Promise<string[]>;
  enqueue(jobs: PlannedJob[]): Promise<void>;
  now(): Date;
}

/**
 * รอบการกู้หนึ่งรอบ
 *
 * `limit` กันไม่ให้รอบเดียวยิงงานเป็นหมื่น ๆ ตอนเปิดระบบครั้งแรก
 * หรือหลัง Redis หาย — ที่เหลือจะถูกกู้ในรอบถัดไป ทยอยไปเรื่อย ๆ
 * ถ้าไม่จำกัด การกู้จะกลายเป็นการยิงแจ้งเตือนถล่มผู้ใช้ในนาทีเดียว
 */
export async function runReconcile(
  deps: ReconcileDeps,
  limit = 200,
): Promise<{ scanned: number; enqueued: number }> {
  const clocks = await deps.loadOverdueClocks(limit);
  if (clocks.length === 0) return { scanned: 0, enqueued: 0 };

  const candidates = clocks.map((c) => reconcileDedupeKey(c.id));
  const notified = await deps.loadNotifiedKeys(candidates);

  const jobs = pickMissedBreaches({
    clocks,
    notifiedKeys: new Set(notified),
    now: deps.now(),
  });
  if (jobs.length > 0) await deps.enqueue(jobs);

  return { scanned: clocks.length, enqueued: jobs.length };
}
