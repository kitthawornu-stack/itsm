/**
 * ตัวจัดการงานแจ้งเตือน SLA
 *
 * **ตรวจซ้ำก่อนส่งเสมอ** — job ถูกตั้งไว้ล่วงหน้าเป็นชั่วโมง ระหว่างนั้นตั๋วอาจถูกปิด
 * ถูกพัก หรือเปลี่ยนความสำคัญไปแล้ว การส่งตามที่ตั้งไว้โดยไม่ตรวจ
 * จะได้ข้อความที่ขัดกับสิ่งที่ผู้ใช้เห็นบนหน้าจอ ซึ่งแย่กว่าการไม่ส่งเลย
 */
import type { PrismaClient } from '@prisma/client';

import type { SlaJobPayload } from './sla-queue';

export interface HandlerDeps {
  prisma: PrismaClient;
  /** คำนวณสถานะ SLA ล่าสุด — ฉีดเข้ามาเพื่อให้ทดสอบได้โดยไม่ต้องมีฐานข้อมูล */
  recompute: (
    tenantId: bigint,
    workItemId: bigint,
  ) => Promise<{ state: string; ratio: number; goalName: string; trusted: boolean } | null>;
  dedupeKey: (workItemSlaId: bigint, threshold: number) => string;
  text: (p: {
    itemKey: string;
    summary: string;
    goalName: string;
    threshold: number;
    /** ตัวเลขนี้มาจากปฏิทินที่มีคนยืนยันแล้วหรือยัง */
    trusted: boolean;
  }) => { title: string; body: string };
}

export function createSlaHandler(deps: HandlerDeps) {
  return async function handle(payload: SlaJobPayload): Promise<'sent' | 'skipped' | 'duplicate'> {
    const tenantId = BigInt(payload.tenantId);
    const workItemId = BigInt(payload.workItemId);
    const workItemSlaId = BigInt(payload.workItemSlaId);

    const status = await deps.recompute(tenantId, workItemId);
    // นาฬิกาหายไปแล้ว — ตั๋วถูกลบ หรือ policy ถูกถอด
    if (status === null) return 'skipped';

    // ตั๋วถูกปิดหรือพักไปแล้วระหว่างรอ — ไม่ต้องเตือน
    if (status.state !== 'running' && status.state !== 'breached') return 'skipped';

    // เกณฑ์ยังไม่ถูกข้ามจริง — เกิดได้เมื่อเป้าถูกขยายหลังตั้ง job ไว้
    if (status.ratio < payload.threshold) return 'skipped';

    const item = await deps.prisma.workItem.findFirst({
      where: { id: workItemId, tenantId },
      select: { itemKey: true, summary: true, assigneeId: true, reporterId: true },
    });
    if (item === null) return 'skipped';

    /**
     * ตัวเลขที่เชื่อไม่ได้ **ยังต้องส่ง แต่ต้องไม่กล่าวหา**
     *
     * เงียบไปเลยแปลว่าคนที่หลุด SLA จริงไม่มีใครเตือน · ส่งแบบยืนยันหนักแน่น
     * ทั้งที่ปฏิทินไม่มีวันสงกรานต์อยู่ในนั้น แปลว่าบอกคนว่าเขาทำงานช้า
     * ในวันที่เขาไม่ได้มาทำงาน ซึ่งเป็นความผิดพลาดที่คนจำได้นาน
     * และทำให้เลิกเชื่อตัวเลข SLA ทั้งระบบ (CLAUDE.md)
     *
     * ทางที่เหลือคือส่งพร้อมบอกความจริงว่าตัวเลขนี้เชื่อไม่ได้และเพราะอะไร
     */
    const { title, body } = deps.text({
      itemKey: item.itemKey,
      summary: item.summary,
      goalName: status.goalName,
      threshold: payload.threshold,
      trusted: status.trusted,
    });

    try {
      await deps.prisma.notification.create({
        data: {
          tenantId,
          // ส่งถึงผู้รับผิดชอบ · ถ้ายังไม่มีคนรับ ให้เป็นการแจ้งเตือนระดับทีม
          userId: item.assigneeId,
          workItemId,
          // แยก kind เพื่อให้กรองรายงานภายหลังได้ว่าเตือนไปกี่ครั้งบนตัวเลขที่เชื่อไม่ได้
          kind: status.trusted ? 'sla.threshold' : 'sla.threshold.untrusted',
          title,
          body,
          payload: {
            threshold: payload.threshold,
            scheduledFor: payload.scheduledFor,
            calendarTrusted: status.trusted,
          },
          dedupeKey: deps.dedupeKey(workItemSlaId, payload.threshold),
        },
      });
      return 'sent';
    } catch (e) {
      // unique index บน (tenantId, dedupeKey) คือด่านสุดท้ายกันส่งซ้ำ
      // job ที่ถูกลองใหม่หลังส่งสำเร็จแล้วจะมาถึงตรงนี้ ซึ่งถือว่าปกติ
      if (isUniqueViolation(e)) return 'duplicate';
      throw e;
    }
  };
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === 'P2002';
}
