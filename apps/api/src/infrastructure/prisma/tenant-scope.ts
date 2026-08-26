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

import { prismaClient, type PrismaClientRaw } from './client';

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
 *
 * **ประกาศชนิดคืนค่าเป็น `PrismaClientRaw` โดยตั้งใจ ไม่ปล่อยให้ TypeScript อนุมาน**
 *
 * ชนิดที่ `$extends` คืนมาเป็น generic ที่ซ้อนลึกมาก และ TypeScript ต้องคลี่มันใหม่
 * ทุกจุดที่เรียก · พอเพิ่มโมเดล `Session` กับ `LoginAttempt` เข้าสคีมา
 * มันข้ามเพดานความลึกทันที แล้ว `tsc` พ่น "Excessive stack depth" 81 ข้อ
 * กระจายไปทุกไฟล์ที่ใช้ client นี้ — รวมถึงไฟล์ที่ไม่ได้แก้อะไรเลย
 *
 * การประกาศชนิดตายตัวตัดการอนุมานซ้ำทิ้ง ราคาที่จ่ายคือชนิดไม่รู้ว่า extension
 * เติม `tenantId` ให้ ผู้เรียกจึงต้องระบุ `tenantId` ตอน `create` เอง
 * ซึ่ง **ดีกว่าในแง่การอ่านโค้ด** — เห็นชัดว่าแถวนี้เป็นของ tenant ไหน
 * และ extension ยังตรวจให้อยู่ดีว่าค่าที่ส่งมาตรงกับ scope (โยน CrossTenantAccessError)
 */
export function tenantScoped(scope: QueryScope, base: PrismaClientRaw = prismaClient): PrismaClientRaw {
  if (isSystemScope(scope)) return base;
  const { tenantId } = scope satisfies TenantContext;

  /* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unnecessary-condition -- signature ของ Prisma extension เป็น any โดยตัวมันเอง ไม่มีชนิดให้ยึด */
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ต้องเรียก model ตามชื่อที่เป็น string
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
  }) as unknown as PrismaClientRaw;
  /* eslint-enable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unnecessary-condition */
}

/**
 * ทางออกฉุกเฉินสำหรับงานระดับระบบ — ชื่อยาวและอ่านสะดุดโดยเจตนา
 * เพื่อให้เห็นชัดใน code review ว่ามีการข้าม tenant scope ตรงไหน
 */
// async ไม่ใช่ฟังก์ชันธรรมดา — ฟังก์ชันที่ประกาศว่าคืน Promise แต่ throw
// แบบ synchronous เป็นกับดัก: ผู้เรียกที่ใช้ .catch() จะจับไม่ได้
// และ error จะหลุดขึ้นไปเป็น uncaught exception แทน
export async function withSystemScope<T>(
  reason: string,
  fn: (db: PrismaClientRaw) => Promise<T>,
): Promise<T> {
  if (reason.trim().length < 10) {
    throw new Error('withSystemScope ต้องระบุเหตุผลที่อ่านเข้าใจได้ อย่างน้อย 10 อักขระ');
  }
  return fn(tenantScoped(SYSTEM_SCOPE));
}

/**
 * ทรานแซกชันที่ผูกกับ tenant — ทางเดียวที่โมดูลเปิดทรานแซกชันได้
 *
 * ถ้าโมดูลเรียก `prismaClient.$transaction` เองจะได้ client ที่ไม่มี tenant scope
 * แล้วทุกคิวรีภายในทรานแซกชันนั้นจะข้าม INVARIANT 1 ไปทั้งก้อน
 * — ซึ่งเป็นสิ่งที่เกิดขึ้นจริงใน field.service.ts จนกระทั่ง lint จับได้
 */
export async function tenantTransaction<T>(
  ctx: TenantContext,
  fn: (tx: TxScopedClient) => Promise<T>,
): Promise<T> {
  // **ต้องเปิดทรานแซกชันจาก client ที่ extend แล้ว** ไม่ใช่ `prismaClient` ดิบ
  // Prisma ส่ง extension ต่อเข้าไปใน tx ให้ก็ต่อเมื่อเปิดจาก client ที่มี extension
  // ถ้าเปิดจาก client ดิบ ทุกคิวรีใน tx จะไม่มี tenant scope เลยทั้งก้อน
  // — พิสูจน์ไว้ใน test/tenant-isolation.spec.ts ข้อ 9
  const scoped = tenantScoped(ctx);
  return scoped.$transaction(async (tx) => fn(tx));
}

export type TxScopedClient = Parameters<Parameters<PrismaClientRaw['$transaction']>[0]>[0];

export type TenantScopedClient = ReturnType<typeof tenantScoped>;
export { Prisma };
