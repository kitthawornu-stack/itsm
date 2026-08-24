/**
 * INVARIANT 2 — ทุก mutation ต้องเขียน audit ในทรานแซกชันเดียวกับการแก้ข้อมูล
 *
 * ทำไมต้องเป็นกลไก ไม่ใช่กติกา: ถ้าปล่อยให้ service แต่ละตัวจำว่าต้องเขียน history
 * จะมีที่ที่ลืมแน่นอน และมันจะเป็นที่ที่สำคัญที่สุด (การเปลี่ยนสถานะ, การให้สิทธิ์)
 * ผลคือ MTTR วิเคราะห์ไม่ได้ และตอบ ISO 27001 ไม่ได้
 *
 * วิธีใช้: mutation ทุกตัว **ต้อง** ห่อด้วย `auditedTransaction()` และ return
 * รายการ AuditEntry ที่อธิบายสิ่งที่เปลี่ยน — ถ้าไม่ return อะไรเลย ฟังก์ชันจะโยน error
 * นั่นคือเหตุผลที่ signature บังคับให้คิดเรื่อง audit ก่อนเขียน mutation
 */
import type { TenantContext } from '@itsm/types';

import { prismaClient, type PrismaClientRaw } from '../prisma/client';

/** ทรานแซกชัน client ของ Prisma — ไม่มี $transaction / $connect ให้เรียกซ้อน */
export type TxClient = Parameters<Parameters<PrismaClientRaw['$transaction']>[0]>[0];

/** การเปลี่ยนแปลงหนึ่งฟิลด์บน work item */
export interface WorkItemChange {
  kind: 'work-item';
  workItemId: bigint;
  /** ชื่อฟิลด์ หรือ `__transition__` เมื่อเป็นการเปลี่ยนสถานะผ่าน workflow */
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/** เหตุการณ์ระดับระบบที่ไม่ได้ผูกกับ work item */
export interface SystemEvent {
  kind: 'system';
  action: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
}

export type AuditEntry = WorkItemChange | SystemEvent;

export class MissingAuditError extends Error {
  constructor(operation: string) {
    super(
      `mutation "${operation}" ไม่ได้บันทึก audit — ` +
        `ทุก mutation ต้องคืน AuditEntry อย่างน้อยหนึ่งรายการ (INVARIANT 2 · CLAUDE.md §1)`,
    );
    this.name = 'MissingAuditError';
  }
}

export interface AuditedResult<T> {
  result: T;
  audit: AuditEntry[];
}

/**
 * รัน mutation พร้อมเขียน audit ในทรานแซกชันเดียวกัน
 *
 * `fn` ต้องคืนทั้งผลลัพธ์และรายการ audit — ถ้ารายการว่าง จะถือว่าเป็นความผิดพลาด
 * ของนักพัฒนา ไม่ใช่กรณีที่ยอมรับได้ (mutation ที่ไม่เปลี่ยนอะไรไม่ควรเรียกฟังก์ชันนี้)
 *
 * @param operation ชื่อที่อ่านเข้าใจได้ ใช้ในข้อความ error และ audit_log.action
 */
export async function auditedTransaction<T>(
  ctx: TenantContext,
  operation: string,
  fn: (tx: TxClient) => Promise<AuditedResult<T>>,
  base: PrismaClientRaw = prismaClient,
): Promise<T> {
  return base.$transaction(async (tx) => {
    const { result, audit } = await fn(tx);

    if (audit.length === 0) throw new MissingAuditError(operation);

    const workItemRows = audit.filter((e): e is WorkItemChange => e.kind === 'work-item');
    const systemRows = audit.filter((e): e is SystemEvent => e.kind === 'system');

    if (workItemRows.length > 0) {
      await tx.workItemHistory.createMany({
        data: workItemRows.map((e) => ({
          tenantId: ctx.tenantId,
          workItemId: e.workItemId,
          actorId: ctx.actorId,
          field: e.field,
          oldValue: e.oldValue,
          newValue: e.newValue,
          traceId: ctx.traceId ?? null,
        })),
      });
    }

    if (systemRows.length > 0) {
      await tx.auditLog.createMany({
        data: systemRows.map((e) => ({
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          action: e.action,
          entityType: e.entityType,
          entityId: e.entityId,
          payload: (e.payload ?? null) as never,
          traceId: ctx.traceId ?? null,
        })),
      });
    }

    return result;
  });
}

/** helper สั้น ๆ สำหรับสร้าง WorkItemChange ที่อ่านง่ายในฝั่ง service */
export function change(
  workItemId: bigint,
  field: string,
  oldValue: unknown,
  newValue: unknown,
): WorkItemChange {
  // ไม่ใช้ String(v) ตรง ๆ — object จะกลายเป็น "[object Object]" ในประวัติ
  // ซึ่งทำให้ audit trail ไร้ประโยชน์พอดีในเคสที่ต้องการมันที่สุด
  const str = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return String(v);
    if (v instanceof Date) return v.toISOString();
    return JSON.stringify(v);
  };
  return { kind: 'work-item', workItemId, field, oldValue: str(oldValue), newValue: str(newValue) };
}
