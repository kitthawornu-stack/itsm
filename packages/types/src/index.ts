/**
 * @itsm/types — shared primitives ที่ทุก workspace ใช้ร่วมกัน
 *
 * เหตุผลที่แพ็กเกจนี้มีอยู่: invariant สองข้อใน CLAUDE.md §1 ต้องบังคับด้วย **ระบบชนิด**
 * ไม่ใช่ด้วยการจำ —
 *   invariant 1 · ทุกคิวรีต้องมี tenant scope  → TenantContext
 *   invariant 6 · เวลาทุกค่าเป็น UTC           → UtcDate + Clock
 */

// ============================================================
// เวลา · INVARIANT 6
// ============================================================

declare const utcBrand: unique symbol;

/**
 * Date ที่รับประกันว่าเป็น UTC และมาจาก Clock ที่ทดสอบได้
 *
 * ทำไมต้อง brand: `new Date()` ในโค้ดทำให้เทสต์ที่เกี่ยวกับเวลาไม่นิ่ง และเปิดช่อง
 * ให้เผลอใช้เวลาท้องถิ่นซึ่งทำให้การคำนวณ SLA ผิดทั้งระบบ
 * ESLint `no-restricted-syntax` ห้าม `new Date()` / `Date.now()` ไว้แล้ว —
 * ชนิดนี้คือทางเดียวที่เหลือ
 */
export type UtcDate = Date & { readonly [utcBrand]: 'UtcDate' };

/** แปลงค่าที่เชื่อถือได้ให้เป็น UtcDate — ใช้กับค่าที่อ่านจาก DB หรือ input ที่ validate แล้ว */
export function toUtcDate(value: Date | string | number): UtcDate {
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`ค่าเวลาไม่ถูกต้อง: ${String(value)}`);
  }
  return d as UtcDate;
}

export interface Clock {
  nowUtc(): UtcDate;
}

/** ใช้ใน production */
export const systemClock: Clock = {
  // นี่คือ "ที่เดียว" ในระบบที่อ่านเวลาจริงได้ ทุกที่อื่นต้องรับ Clock เข้ามาแทน
  // เพื่อให้ทดสอบเวลาได้ และไม่มีเวลาท้องถิ่นหลุดเข้ามาในการคำนวณ SLA
  // eslint-disable-next-line no-restricted-syntax -- ข้อยกเว้นเดียวที่ตั้งใจ
  nowUtc: () => toUtcDate(Date.now()),
};

/**
 * ใช้ในเทสต์ — เวลาหยุดนิ่ง เลื่อนได้ตามต้องการ
 * SLA Engine ต้องทดสอบด้วยตัวนี้เท่านั้น (120 เคสใน CLAUDE.md §4)
 */
export function fixedClock(iso: string): Clock & { advance(ms: number): void } {
  let current = toUtcDate(iso).getTime();
  return {
    nowUtc: () => toUtcDate(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

// ============================================================
// Tenant · INVARIANT 1
// ============================================================

/**
 * บริบทที่ต้องถูกส่งลงไปถึงชั้น repository ทุกครั้ง
 *
 * ทุก repository รับตัวนี้ แล้ว Prisma extension จะ inject `tenantId`
 * ให้ทุกคิวรีโดยอัตโนมัติ — ดู apps/api/src/infrastructure/prisma/tenant-scope.ts
 */
export interface TenantContext {
  readonly tenantId: bigint;
  /** ผู้กระทำ — null เมื่อเป็นงานของระบบ (cron, indexer) */
  readonly actorId: bigint | null;
  /** โยงกลับไป OpenTelemetry trace เพื่อให้ audit log ตามรอยได้ */
  readonly traceId?: string;
}

/**
 * ขอบเขตพิเศษสำหรับงาน admin ระดับระบบที่ต้องข้าม tenant จริง ๆ
 *
 * **ต้องประกาศเจตนาชัดเจนและมีคอมเมนต์อธิบายเหตุผลทุกจุดที่ใช้** (CLAUDE.md §1.1)
 * ตัวอย่างที่ยอมรับได้: การสร้าง tenant ใหม่, งาน migration ข้าม tenant, health check
 */
export const SYSTEM_SCOPE = Symbol('itsm.system-scope');
export type SystemScope = typeof SYSTEM_SCOPE;
export type QueryScope = TenantContext | SystemScope;

export function isSystemScope(scope: QueryScope): scope is SystemScope {
  return scope === SYSTEM_SCOPE;
}

// ============================================================
// Errors
// ============================================================

/** โยนเมื่อ Prisma extension ตรวจพบคิวรีที่ไม่มี tenant scope — ไม่ควรเกิดขึ้นเลยใน production */
export class MissingTenantScopeError extends Error {
  constructor(model: string, operation: string) {
    super(
      `คิวรีไม่มี tenant scope: ${model}.${operation} — ` +
        `ทุกคิวรีต้องผ่าน repository ที่รับ TenantContext (CLAUDE.md §1.1)`,
    );
    this.name = 'MissingTenantScopeError';
  }
}

/** โยนเมื่อพยายามเข้าถึงข้อมูลของ tenant อื่น */
export class CrossTenantAccessError extends Error {
  constructor(model: string, requestedTenantId: bigint, scopeTenantId: bigint) {
    super(
      `พยายามเข้าถึงข้อมูลข้าม tenant: ${model} ` +
        `(ขอ tenant ${requestedTenantId.toString()} แต่ scope คือ ${scopeTenantId.toString()})`,
    );
    this.name = 'CrossTenantAccessError';
  }
}

// ============================================================
// Utility
// ============================================================

/** หน่วยเวลาเป็นวินาที — ระบบเก็บ time tracking เป็นวินาทีเสมอ แปลงหน่วยที่หน้าจอ */
export type Seconds = number;

/** สถานะที่ Board, Burndown และ SLA ใช้ — ไม่ใช่ชื่อสถานะ (ดู master-plan Part 03) */
export const STATUS_CATEGORIES = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
export type StatusCategoryKey = (typeof STATUS_CATEGORIES)[number];
export * from './card-fields';
export * from './schedule';
export * from './csv';
export * from './permission-rules';
export * from './issue-type-icon';
