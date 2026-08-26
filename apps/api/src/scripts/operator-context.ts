/**
 * บริบทสำหรับสคริปต์บรรทัดคำสั่ง
 *
 * แทนที่ `dev-tenant.guard` ซึ่งถูกลบทิ้งแล้วตามเงื่อนไขของ ADR-003
 *
 * **ต่างจาก guard เดิมตรงที่ไม่โยน error บน production** และนั่นถูกต้อง:
 * guard เดิมเป็นทางลับให้ **คำขอ HTTP** ผ่านโดยไม่ต้องล็อกอิน ซึ่งบน production
 * คือช่องโหว่ · ส่วนไฟล์นี้ใช้ได้เฉพาะกับสคริปต์ที่คนรันเองบนเครื่องที่เข้าถึง
 * ฐานข้อมูลได้อยู่แล้ว การจำกัดมันจึงไม่ได้เพิ่มความปลอดภัย มีแต่ทำให้
 * `pnpm reindex` รันบน production ไม่ได้ ซึ่งเป็นงานที่ต้องทำจริง
 *
 * **ห้าม import ไฟล์นี้จากโค้ดที่ให้บริการคำขอ HTTP** — ESLint บังคับไว้
 */
import type { TenantContext } from '@itsm/types';

import { withSystemScope } from '../infrastructure/prisma/tenant-scope';

export class TenantNotFoundError extends Error {
  constructor(key: string) {
    super(`ไม่พบ tenant "${key}" — รัน \`pnpm --filter @itsm/api seed\` ก่อน`);
    this.name = 'TenantNotFoundError';
  }
}

/**
 * คืนบริบทของ tenant ที่ตั้งไว้ใน env พร้อม actor ที่เป็นบัญชีระบบ
 *
 * ใช้บัญชีระบบ ไม่ใช่ผู้ใช้คนแรกที่หาเจอ — งานที่สคริปต์ทำไม่ใช่การกระทำของคน
 * และ audit log ต้องบอกได้ว่าเป็นระบบทำ ไม่ใช่โยนความรับผิดชอบให้ใครสักคน
 * ที่บังเอิญมี id น้อยที่สุด (ซึ่งเป็นสิ่งที่ guard เดิมทำ)
 */
export async function resolveOperatorContext(): Promise<TenantContext> {
  const key = process.env['DEFAULT_TENANT_KEY'] ?? 'default';

  return withSystemScope(
    'สคริปต์บรรทัดคำสั่ง — ยังไม่มีบริบทผู้ใช้ ต้องหา tenant จากค่าใน env ก่อน',
    async (db) => {
      const tenant = await db.tenant.findFirst({ where: { key }, select: { id: true } });
      if (tenant === null) throw new TenantNotFoundError(key);

      const actor = await db.user.findFirst({
        where: { tenantId: tenant.id, isSystem: true },
        select: { id: true },
      });
      return { tenantId: tenant.id, actorId: actor?.id ?? null };
    },
  );
}
