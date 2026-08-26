/**
 * อ่านสิทธิ์จริงจากฐานข้อมูล
 *
 * โครงสร้าง: โปรเจกต์ → permission scheme → grant → กลุ่ม → ผู้ใช้
 * ผู้ใช้ได้สิทธิ์ผ่านกลุ่มเท่านั้น จึงตอบได้เสมอว่า "ได้เพราะอยู่กลุ่มไหน"
 *
 * กฎการตัดสินอยู่ใน `permission-rules.ts` ซึ่งเป็นฟังก์ชันบริสุทธิ์
 * ไฟล์นี้มีแต่การอ่านข้อมูล
 */
import type { TenantContext } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import {
  resolveGrants,
  summarize,
  type PermissionKey,
  type PermissionSummary,
} from './permission-rules';

export class PermissionDeniedError extends Error {
  constructor(
    readonly permission: PermissionKey,
    readonly projectKey?: string,
  ) {
    // ไม่บอกว่าขาดสิทธิ์อะไร — ผู้ใช้ทำอะไรกับข้อมูลนั้นไม่ได้อยู่ดี
    // และการไล่บอกทีละสิทธิ์คือการวาดแผนที่ระบบสิทธิ์ให้คนที่กำลังลอง
    super('ไม่มีสิทธิ์ดำเนินการนี้');
    this.name = 'PermissionDeniedError';
  }
}

/**
 * สิทธิ์ทั้งหมดของผู้ใช้ปัจจุบันบนโปรเจกต์หนึ่ง
 *
 * คืนเซ็ตว่างเมื่อโปรเจกต์ไม่มี scheme ผูกอยู่ — **ไม่ใช่ให้ทุกสิทธิ์**
 * โปรเจกต์ที่ตั้งค่าไม่ครบต้องใช้ไม่ได้ ไม่ใช่เปิดหมด
 */
export async function permissionsFor(
  ctx: TenantContext,
  projectId: bigint,
): Promise<Set<PermissionKey>> {
  if (ctx.actorId === null) return new Set();

  const db = tenantScoped(ctx);
  const project = await db.project.findFirst({
    where: { id: projectId },
    select: { permissionSchemeId: true },
  });
  if (project?.permissionSchemeId == null) return new Set();

  const [grants, memberships] = await Promise.all([
    db.permissionGrant.findMany({
      where: { schemeId: project.permissionSchemeId },
      select: { permission: true, groupId: true },
    }),
    db.groupMember.findMany({ where: { userId: ctx.actorId }, select: { groupId: true } }),
  ]);

  return resolveGrants(
    grants,
    memberships.map((m) => m.groupId),
  );
}

export async function can(
  ctx: TenantContext,
  projectId: bigint,
  permission: PermissionKey,
): Promise<boolean> {
  return (await permissionsFor(ctx, projectId)).has(permission);
}

/** โยนเมื่อไม่มีสิทธิ์ — ใช้ในจุดที่การไม่มีสิทธิ์ต้องหยุดการทำงาน */
export async function assertCan(
  ctx: TenantContext,
  projectId: bigint,
  permission: PermissionKey,
): Promise<void> {
  if (!(await can(ctx, projectId, permission))) {
    throw new PermissionDeniedError(permission);
  }
}

/** สรุปให้หน้าจอใช้ซ่อนปุ่มที่กดไม่ได้ — ไม่ใช่กลไกป้องกัน */
export async function summaryFor(
  ctx: TenantContext,
  projectId: bigint,
): Promise<PermissionSummary> {
  return summarize(await permissionsFor(ctx, projectId));
}

/**
 * โปรเจกต์ทั้งหมดที่ผู้ใช้คนนี้เปิดดูได้
 *
 * ใช้กรองรายการงาน — **กรองที่คิวรี ไม่ใช่กรองผลลัพธ์ทีหลัง**
 * ถ้าดึงมาทั้งหมดแล้วค่อยคัดออก จำนวนรวมและการแบ่งหน้าจะผิด และงานของโปรเจกต์
 * ที่ไม่มีสิทธิ์ยังถูกอ่านออกจากฐานข้อมูลมาแล้วหนึ่งรอบ
 *
 * คืนรายการว่างเมื่อไม่มีสิทธิ์ที่ไหนเลย ซึ่งแปลว่าเห็นงานศูนย์รายการ — ถูกต้อง
 */
export async function browsableProjectIds(ctx: TenantContext): Promise<bigint[]> {
  if (ctx.actorId === null) return [];

  const db = tenantScoped(ctx);
  const [projects, memberships] = await Promise.all([
    db.project.findMany({
      where: { isArchived: false },
      select: { id: true, permissionSchemeId: true },
    }),
    db.groupMember.findMany({ where: { userId: ctx.actorId }, select: { groupId: true } }),
  ]);

  const schemeIds = [
    ...new Set(projects.map((p) => p.permissionSchemeId).filter((v) => v !== null)),
  ];
  if (schemeIds.length === 0) return [];

  const grants = await db.permissionGrant.findMany({
    where: { schemeId: { in: schemeIds }, permission: 'BROWSE_PROJECT' },
    select: { schemeId: true, groupId: true },
  });

  const mine = new Set(memberships.map((m) => m.groupId.toString()));
  const allowedSchemes = new Set(
    grants
      .filter((g) => g.groupId !== null && mine.has(g.groupId.toString()))
      .map((g) => g.schemeId.toString()),
  );

  return projects
    .filter((p) => p.permissionSchemeId !== null && allowedSchemes.has(p.permissionSchemeId.toString()))
    .map((p) => p.id);
}

/**
 * เป็นผู้ดูแลระบบของ tenant นี้หรือไม่
 *
 * `ADMINISTER_TENANT` ไม่ผูกกับโปรเจกต์ แต่โครงสร้าง grant ในสคีมาผูกกับ
 * permission scheme ซึ่งผูกกับโปรเจกต์อีกที · จึงตีความว่า **มีคีย์นี้ใน
 * scheme ใดก็ตาม = เป็นผู้ดูแลทั้ง tenant**
 *
 * เขียนไว้ให้ชัดเพราะมันไม่ตรงไปตรงมา: การให้ ADMINISTER_TENANT
 * ใน scheme ของโปรเจกต์เดียว ให้สิทธิ์ระดับ tenant ทั้งก้อน
 * ถ้าวันหนึ่งต้องการผู้ดูแลระดับโปรเจกต์ ต้องแยกคีย์ใหม่ ไม่ใช่ตีความคีย์นี้ใหม่
 */
export async function isTenantAdmin(ctx: TenantContext): Promise<boolean> {
  if (ctx.actorId === null) return false;

  const db = tenantScoped(ctx);
  const memberships = await db.groupMember.findMany({
    where: { userId: ctx.actorId },
    select: { groupId: true },
  });
  if (memberships.length === 0) return false;

  const grant = await db.permissionGrant.findFirst({
    where: {
      permission: 'ADMINISTER_TENANT',
      groupId: { in: memberships.map((m) => m.groupId) },
    },
    select: { id: true },
  });
  return grant !== null;
}

/** โยนเมื่อไม่ใช่ผู้ดูแลระบบ */
export async function assertTenantAdmin(ctx: TenantContext): Promise<void> {
  if (!(await isTenantAdmin(ctx))) throw new PermissionDeniedError('ADMINISTER_TENANT');
}
