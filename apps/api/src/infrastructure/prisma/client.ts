/**
 * Prisma client ดิบ — **ห้าม import จากโมดูลใด ๆ**
 *
 * ESLint `import/no-restricted-paths` บล็อกไฟล์นี้ไว้จาก `apps/api/src/modules/**`
 * ทางเดียวที่โมดูลเข้าถึงฐานข้อมูลได้คือผ่าน `tenantScoped(ctx)` ใน ./tenant-scope.ts
 * ซึ่ง inject `tenant_id` ให้ทุกคิวรี (INVARIANT 1 · CLAUDE.md §1.1)
 */
import { PrismaClient } from '@prisma/client';

export type PrismaClientRaw = PrismaClient;

const logLevels =
  process.env['NODE_ENV'] === 'development'
    ? (['warn', 'error'] as const)
    : (['error'] as const);

/**
 * singleton — Next.js dev server และ NestJS hot reload สร้าง module ใหม่หลายรอบ
 * ถ้าไม่ cache ไว้จะเปิด connection pool ซ้ำจนชน max_connections ของ MySQL
 */
const globalForPrisma = globalThis as unknown as { __itsmPrisma?: PrismaClient };

export const prismaClient: PrismaClient =
  globalForPrisma.__itsmPrisma ??
  new PrismaClient({
    log: [...logLevels],
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.__itsmPrisma = prismaClient;
}
