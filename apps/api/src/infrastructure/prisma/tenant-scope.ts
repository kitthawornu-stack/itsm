/**
 * INVARIANT 1 — ทุกคิวรีต้องมี tenant scope
 *
 * ไฟล์นี้คือกลไกบังคับ ไม่ใช่แนวปฏิบัติ:
 *   - `tenantScoped(ctx)` คืน client ที่ inject `tenant_id` ให้ทุก operation อัตโนมัติ
 *   - โมดูลเข้าถึง Prisma ได้เฉพาะผ่านตัวนี้ (ESLint `import/no-restricted-paths` กัน client ดิบไว้)
 *   - `findUnique` ถูกแปลงเป็น `findFirst` เพราะ `findUnique` ไม่ยอมรับ filter เพิ่ม
 *     ถ้าไม่แปลง การอ่านด้วย id เดี่ยวจะข้าม tenant ได้ — ช่องรั่วที่ใหญ่ที่สุดของแนวทางนี้
 *
 * ทำไมต้องเป็น extension ไม่ใช่ให้ developer จำ: AI (และคน) เขียน happy path ได้ดี
 * แต่ลืมกฎที่ต้องจำข้ามไฟล์ `tenant_id` ที่หายไปหนึ่งคิวรี = ข้อมูลรั่วข้ามองค์กร
 * ดู CLAUDE.md §1.1 และ master-plan Part 13.3
 */
import { Prisma } from '@prisma/client';
import {
  CrossTenantAccessError,
  isSystemScope,
  SYSTEM_SCOPE,
  type QueryScope,
  type TenantContext,
} from '@itsm/types';

import { prismaClient, type PrismaClientRaw } from './client.js';

/** โมเดลเดียวที่ไม่มีคอลัมน์ tenant_id — ตัว tenant เอง */
const UNSCOPED_MODELS = new Set<string>(['Tenant']);

/** operation ที่ต้อง inject scope ลงใน `where` */
const WHERE_OPS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
  'update',
  'delete',
]);

/** operation ที่ต้อง inject scope ลงใน `data` */
const DATA_OPS = new Set<string>(['create', 'createMany', 'createManyAndReturn']);

type AnyArgs = Record<string, unknown>;

function assertNoConflictingTenant(model: string, where: AnyArgs, tenantId: bigint): void {
  const existing = where['tenant_id'] ?? where['tenantId'];
  if (existing === undefined || existing === null) return;
  if (typeof existing === 'bigint' && existing !== tenantId) {
    throw new CrossTenantAccessError(model, existing, tenantId);
  }
  if (typeof existing === 'number' && BigInt(existing) !== tenantId) {
    throw new CrossTenantAccessError(model, BigInt(existing), tenantId);
  }
}

function injectIntoData(model: string, data: unknown, tenantId: bigint): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => injectIntoData(model, row, tenantId));
  }
  if (data === null || typeof data !== 'object') return data;
  const row = data as AnyArgs;
  const existing = row['tenantId'];
  if (typeof existing === 'bigint' && existing !== tenantId) {
    throw new CrossTenantAccessError(model, existing, tenantId);
  }
  return { ...row, tenantId };
}

/**
 * คืน Prisma client ที่ผูกกับ tenant เดียว
 *
 * ส่ง `SYSTEM_SCOPE` ได้เฉพาะงาน admin ระดับระบบ และ **ต้องมีคอมเมนต์อธิบายเหตุผล**
 * ทุกจุดที่เรียก (CLAUDE.md §1.1)
 */
export function tenantScoped(scope: QueryScope, base: PrismaClientRaw = prismaClient) {
  if (isSystemScope(scope)) return base;
  const { tenantId } = scope satisfies TenantContext;

  return base.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- signature ของ Prisma extension
        async $allOperations({ model, operation, args, query }: any): Promise<unknown> {
          if (model === undefined || UNSCOPED_MODELS.has(model)) {
            return query(args) as Promise<unknown>;
          }

          const next: AnyArgs = { ...(args as AnyArgs) };

          // findUnique ไม่ยอมรับ filter เพิ่ม → แปลงเป็น findFirst เพื่อให้ inject ได้
          // ถ้าไม่ทำ การอ่านด้วย id เดี่ยวจะข้าม tenant ได้ทั้งหมด
          if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
            const where = { ...((next['where'] as AnyArgs) ?? {}) };
            assertNoConflictingTenant(model, where, tenantId);
            next['where'] = { ...where, tenantId };
            const target = operation === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
            return (base as any)[model][target](next) as Promise<unknown>;
          }

          if (WHERE_OPS.has(operation)) {
            const where = { ...((next['where'] as AnyArgs) ?? {}) };
            assertNoConflictingTenant(model, where, tenantId);
            next['where'] = { ...where, tenantId };
          }

          if (DATA_OPS.has(operation) && next['data'] !== undefined) {
            next['data'] = injectIntoData(model, next['data'], tenantId);
          }

          if (operation === 'upsert') {
            const where = { ...((next['where'] as AnyArgs) ?? {}) };
            assertNoConflictingTenant(model, where, tenantId);
            next['where'] = { ...where, tenantId };
            if (next['create'] !== undefined) {
              next['create'] = injectIntoData(model, next['create'], tenantId);
            }
          }

          return query(next) as Promise<unknown>;
        },
      },
    },
  });
}

/**
 * ทางออกฉุกเฉินสำหรับงานระดับระบบ — ชื่อยาวและอ่านสะดุดโดยเจตนา
 * เพื่อให้เห็นชัดใน code review ว่ามีการข้าม tenant scope ตรงไหน
 */
export function withSystemScope<T>(reason: string, fn: (db: PrismaClientRaw) => Promise<T>) {
  if (reason.trim().length < 10) {
    throw new Error('withSystemScope ต้องระบุเหตุผลที่อ่านเข้าใจได้ อย่างน้อย 10 อักขระ');
  }
  return fn(tenantScoped(SYSTEM_SCOPE) as PrismaClientRaw);
}

export type TenantScopedClient = ReturnType<typeof tenantScoped>;
export { Prisma };
