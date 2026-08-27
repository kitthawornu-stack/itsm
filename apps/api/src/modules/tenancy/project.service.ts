/**
 * โปรเจกต์ — ข้อมูลหัวเรื่อง
 *
 * ยังไม่มีการสร้างหรือแก้ไขจากที่นี่ · โปรเจกต์แรกมาจาก `bootstrap.js`
 * และการเพิ่มโปรเจกต์ที่สองยังต้องผ่านสคริปต์อยู่ ซึ่งเป็นงานถัดไป
 *
 * ฟังก์ชันที่นี่เป็นการ **อ่าน** เพื่อให้ผู้ดูแลเห็นว่าระบบถูกตั้งไว้อย่างไร
 * — พฤติกรรมเกือบทั้งหมดของ Helix อยู่ในตารางตั้งค่า ไม่ได้อยู่ในโค้ด
 * คนที่มองไม่เห็นตารางเหล่านั้นจึงอธิบายสิ่งที่ระบบทำไม่ได้เลย
 */
import type { TenantContext } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

export class ProjectNotFoundError extends Error {
  constructor(key: string) {
    super(`ไม่พบโปรเจกต์ ${key}`);
    this.name = 'ProjectNotFoundError';
  }
}

export interface ProjectHeader {
  id: bigint;
  key: string;
  name: string;
  type: string;
  isArchived: boolean;
  /** กลุ่มที่รับแจ้งเตือนของงานที่ยังไม่มีผู้รับผิดชอบ — null = ไปไม่ถึงใคร */
  notifyGroup: string | null;
  permissionScheme: string | null;
  itemCount: number;
}

export async function listProjects(ctx: TenantContext): Promise<ProjectHeader[]> {
  const rows = await tenantScoped(ctx).project.findMany({
    orderBy: { key: 'asc' },
    include: {
      notifyGroup: { select: { name: true } },
      permissionScheme: { select: { name: true } },
      _count: { select: { workItems: true } },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    type: p.type,
    isArchived: p.isArchived,
    notifyGroup: p.notifyGroup?.name ?? null,
    permissionScheme: p.permissionScheme?.name ?? null,
    itemCount: p._count.workItems,
  }));
}

export async function projectByKey(ctx: TenantContext, key: string): Promise<ProjectHeader> {
  const found = (await listProjects(ctx)).find((p) => p.key === key);
  if (found === undefined) throw new ProjectNotFoundError(key);
  return found;
}

/**
 * รหัสชุดสิทธิ์ของโปรเจกต์ — null เมื่อยังไม่ได้ผูก
 *
 * null ไม่ได้แปลว่า "เปิดให้ทุกคน" แต่แปลว่า **ไม่มีใครเข้าถึงได้เลย**
 * (ดู `describeGrants`) · ผู้เรียกต้องปฏิเสธการแก้สิทธิ์เมื่อได้ null
 * ไม่ใช่สร้างชุดใหม่ให้เงียบ ๆ ซึ่งจะเปลี่ยนสิทธิ์ทั้งโปรเจกต์โดยไม่มีใครสั่ง
 */
export async function projectSchemeId(
  ctx: TenantContext,
  projectId: bigint,
): Promise<bigint | null> {
  const row = await tenantScoped(ctx).project.findFirst({
    where: { id: projectId },
    select: { permissionSchemeId: true },
  });
  return row?.permissionSchemeId ?? null;
}
