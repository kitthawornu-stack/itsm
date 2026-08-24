/**
 * ตัวแก้ TenantContext ชั่วคราวสำหรับ development เท่านั้น
 *
 * ⚠️ **นี่ไม่ใช่ระบบยืนยันตัวตน** — โมดูล `identity` ยังสร้างไม่ได้
 * เพราะ ADR-003 (Keycloak หรือ in-house) ยังไม่มีคำตอบ
 *
 * ไฟล์นี้ทำสามอย่างเพื่อไม่ให้มันกลายเป็นช่องโหว่โดยไม่ตั้งใจ:
 *   1. **โยน error ทันทีเมื่อ NODE_ENV เป็น production** — เอาขึ้น production ไม่ได้เลย
 *   2. ตั้งชื่อไฟล์และ export ให้อ่านสะดุดตาใน code review
 *   3. คืน actorId ที่มีอยู่จริง ไม่ใช่ค่าปลอม เพื่อให้ audit log ยังตรวจสอบได้
 *
 * ต้องถูกลบทิ้งเมื่อโมดูล identity พร้อม
 */
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../prisma/client';

export class DevAuthNotAllowedInProductionError extends Error {
  constructor() {
    super(
      'dev-tenant.guard ถูกเรียกใน production — ' +
        'ไฟล์นี้เป็นทางลัดสำหรับ development เท่านั้น ต้องใช้โมดูล identity แทน (ADR-003)',
    );
    this.name = 'DevAuthNotAllowedInProductionError';
  }
}

let cached: TenantContext | null = null;

/** @deprecated ใช้ได้เฉพาะ development — แทนที่ด้วยโมดูล identity เมื่อ ADR-003 มีคำตอบ */
export async function resolveDevTenantContext(): Promise<TenantContext> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new DevAuthNotAllowedInProductionError();
  }
  if (cached !== null) return cached;

  const key = process.env['DEFAULT_TENANT_KEY'] ?? 'default';
  const tenant = await prismaClient.tenant.findFirst({ where: { key } });
  if (tenant === null) {
    throw new Error(`ไม่พบ tenant "${key}" — รัน \`pnpm --filter @itsm/api seed\` ก่อน`);
  }
  const actor = await prismaClient.user.findFirst({
    where: { tenantId: tenant.id, isSystem: false },
    orderBy: { id: 'asc' },
  });

  cached = { tenantId: tenant.id, actorId: actor?.id ?? null };
  return cached;
}
