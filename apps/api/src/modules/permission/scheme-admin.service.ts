/**
 * สร้างและผูกชุดสิทธิ์จากหน้าจอ
 *
 * เป็นรายการสุดท้ายในกลุ่ม "ยังต้องใช้ SQL" ที่ทำได้เอง (เหลือแต่ผู้ใช้คนแรก
 * ตอนติดตั้ง ซึ่งเป็นสคริปต์โดยธรรมชาติ — ฐานข้อมูลใหม่ยังไม่มีใครล็อกอินได้)
 *
 * **อันตรายที่แท้จริงของหน้าจอนี้คือการสลับชุดสิทธิ์ของโปรเจกต์** —
 * ไม่ใช่การสร้างใบใหม่ · โปรเจกต์ที่ถูกสลับไปใช้ชุดที่ไม่มี `BROWSE_PROJECT`
 * จะหายไปจากสายตาทุกคนทันที รวมทั้งคนที่กดสลับเอง และไม่มี error สักบรรทัด
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

export class SchemeNameRequiredError extends Error {
  constructor() {
    super('ต้องตั้งชื่อชุดสิทธิ์');
    this.name = 'SchemeNameRequiredError';
  }
}

export class DuplicateSchemeNameError extends Error {
  constructor(readonly given: string) {
    super(`มีชุดสิทธิ์ชื่อ "${given}" อยู่แล้ว`);
    this.name = 'DuplicateSchemeNameError';
  }
}

export class SchemeNotFoundError extends Error {
  constructor() {
    super('ไม่พบชุดสิทธิ์ที่เลือก');
    this.name = 'SchemeNotFoundError';
  }
}

export class SchemeInUseError extends Error {
  constructor(readonly projects: string[]) {
    super(`ลบไม่ได้ — ยังมีโปรเจกต์ใช้ชุดนี้อยู่: ${projects.join(' · ')}`);
    this.name = 'SchemeInUseError';
  }
}

/**
 * สลับไปใช้ชุดที่ไม่มีใครเปิดดูโปรเจกต์ได้
 *
 * ถ้าปล่อยผ่าน โปรเจกต์จะหายไปจากสายตาทุกคนทันที — รวมทั้งคนที่กดสลับเอง —
 * และวิธีเดียวที่จะกู้คือแก้ฐานข้อมูลตรง ๆ · เป็นความผิดพลาดที่แก้จากหน้าจอ
 * ไม่ได้อีกเลยหลังจากกด จึงต้องกันตอนกด
 */
export class WouldHideProjectError extends Error {
  constructor(readonly schemeName: string) {
    super(
      `ชุด "${schemeName}" ไม่มีกลุ่มไหนได้สิทธิ์เปิดดูโปรเจกต์เลย — ` +
        'ถ้าสลับไปใช้ จะไม่มีใครเห็นโปรเจกต์นี้อีก รวมทั้งคุณเอง',
    );
    this.name = 'WouldHideProjectError';
  }
}

export interface SchemeRow {
  id: string;
  name: string;
  grantCount: number;
  /** โปรเจกต์ที่ใช้ชุดนี้ — แก้ที่นี่กระทบทุกใบในรายการ */
  projects: string[];
  /** มีกลุ่มไหนเปิดดูโปรเจกต์ได้บ้างไหม — ชุดที่ไม่มีเลยใช้ไม่ได้จริง */
  canBrowse: boolean;
}

export async function listSchemes(ctx: TenantContext): Promise<SchemeRow[]> {
  const rows = await tenantScoped(ctx).permissionScheme.findMany({
    orderBy: { name: 'asc' },
    include: {
      projects: { select: { key: true } },
      grants: { select: { permission: true, groupId: true } },
    },
  });
  return rows.map((s) => ({
    id: s.id.toString(),
    name: s.name,
    grantCount: s.grants.length,
    projects: s.projects.map((p) => p.key),
    canBrowse: s.grants.some((g) => g.permission === 'BROWSE_PROJECT' && g.groupId !== null),
  }));
}

/**
 * สร้างชุดสิทธิ์ใบใหม่
 *
 * **คัดลอกจากใบที่มีอยู่ได้ และควรทำ** — ชุดเปล่าคือชุดที่ไม่มีใครเปิดดู
 * โปรเจกต์ได้เลย · ผู้ดูแลที่สร้างชุดเปล่าแล้วผูกเข้าโปรเจกต์ทันที
 * จะทำให้โปรเจกต์นั้นหายไปจากทุกคน · การคัดลอกทำให้จุดเริ่มต้นใช้งานได้จริง
 * แล้วค่อยแก้ทีละช่อง
 */
export async function createScheme(
  ctx: TenantContext,
  name: string,
  copyFromId?: bigint,
): Promise<{ id: bigint; copiedGrants: number }> {
  const trimmed = name.trim().slice(0, 255);
  if (trimmed === '') throw new SchemeNameRequiredError();

  const db = tenantScoped(ctx);
  if ((await db.permissionScheme.findFirst({ where: { name: trimmed } })) !== null) {
    throw new DuplicateSchemeNameError(trimmed);
  }

  let source: Array<{ permission: string; groupId: bigint | null; projectRole: string | null }> = [];
  if (copyFromId !== undefined) {
    const from = await db.permissionScheme.findFirst({
      where: { id: copyFromId },
      include: { grants: { select: { permission: true, groupId: true, projectRole: true } } },
    });
    if (from === null) throw new SchemeNotFoundError();
    source = from.grants;
  }

  return auditedTransaction(ctx, 'permission.scheme.create', async (tx) => {
    const scheme = await tx.permissionScheme.create({
      data: { tenantId: ctx.tenantId, name: trimmed },
      select: { id: true },
    });
    if (source.length > 0) {
      await tx.permissionGrant.createMany({
        data: source.map((g) => ({
          tenantId: ctx.tenantId,
          schemeId: scheme.id,
          // ชนิดของ enum มาจากแถวต้นทางซึ่งผ่าน Prisma มาแล้ว จึงถูกต้องแน่นอน
          permission: g.permission as never,
          groupId: g.groupId,
          projectRole: g.projectRole as never,
        })),
      });
    }
    return {
      result: { id: scheme.id, copiedGrants: source.length },
      audit: [
        {
          kind: 'system',
          action: 'permission.scheme.create',
          entityType: 'permission_scheme',
          entityId: scheme.id.toString(),
          payload: { name: trimmed, copiedGrants: source.length },
        },
      ],
    };
  });
}

/**
 * เปลี่ยนชุดสิทธิ์ที่โปรเจกต์ใช้
 *
 * กันไว้สองชั้น: ชุดต้องมีอยู่จริง และ **ต้องมีกลุ่มที่เปิดดูโปรเจกต์ได้อย่างน้อย
 * หนึ่งกลุ่ม** · ข้อหลังคือข้อที่กู้ไม่ได้จากหน้าจอถ้าพลาด
 */
export async function setProjectScheme(
  ctx: TenantContext,
  projectId: bigint,
  schemeId: bigint,
): Promise<void> {
  const db = tenantScoped(ctx);
  const project = await db.project.findFirst({
    where: { id: projectId },
    select: { id: true, key: true, permissionSchemeId: true },
  });
  if (project === null) throw new SchemeNotFoundError();

  const scheme = await db.permissionScheme.findFirst({
    where: { id: schemeId },
    include: { grants: { select: { permission: true, groupId: true } } },
  });
  if (scheme === null) throw new SchemeNotFoundError();

  const canBrowse = scheme.grants.some(
    (g) => g.permission === 'BROWSE_PROJECT' && g.groupId !== null,
  );
  if (!canBrowse) throw new WouldHideProjectError(scheme.name);

  if (project.permissionSchemeId === schemeId) return;

  await auditedTransaction(ctx, 'permission.scheme.assign', async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { permissionSchemeId: schemeId } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'permission.scheme.assign',
          entityType: 'project',
          entityId: projectId.toString(),
          payload: { project: project.key, scheme: scheme.name },
        },
      ],
    };
  });
}

/**
 * ลบชุดสิทธิ์
 *
 * `Project.permissionSchemeId` เป็น `onDelete: SetNull` — ลบชุดที่ยังมีคนใช้
 * จะทำให้โปรเจกต์นั้นไม่มีชุดสิทธิ์ แปลว่า **ไม่มีใครเข้าถึงได้เลย** เงียบ ๆ
 * ฐานข้อมูลไม่ได้กันให้ จึงต้องกันที่นี่ และบอกด้วยว่ากระทบโปรเจกต์ไหนบ้าง
 */
export async function removeScheme(ctx: TenantContext, schemeId: bigint): Promise<void> {
  const db = tenantScoped(ctx);
  const scheme = await db.permissionScheme.findFirst({
    where: { id: schemeId },
    include: { projects: { select: { key: true } } },
  });
  if (scheme === null) throw new SchemeNotFoundError();
  if (scheme.projects.length > 0) {
    throw new SchemeInUseError(scheme.projects.map((p) => p.key));
  }

  await auditedTransaction(ctx, 'permission.scheme.remove', async (tx) => {
    await tx.permissionGrant.deleteMany({ where: { schemeId } });
    await tx.permissionScheme.delete({ where: { id: schemeId } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'permission.scheme.remove',
          entityType: 'permission_scheme',
          entityId: schemeId.toString(),
          payload: { name: scheme.name },
        },
      ],
    };
  });
}
