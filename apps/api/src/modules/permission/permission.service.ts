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

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import {
  ALL_PERMISSION_KEYS,
  IMPLIED_BY,
  isEnforced,
  wouldLockOutAdmins,
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

/**
 * สิทธิ์ทั้งหมดของโปรเจกต์หนึ่ง — ใครได้อะไร เพราะอยู่กลุ่มไหน
 *
 * CLAUDE.md สัญญาไว้ว่า "ให้สิทธิ์ผ่านกลุ่มเท่านั้น เพื่อให้ตอบได้ว่าได้เพราะ
 * อยู่กลุ่มไหน" · สัญญานั้นจะเป็นจริงก็ต่อเมื่อมีคนเปิดดูได้จริง ไม่ใช่ต้อง
 * ไล่ JOIN สามตารางในฐานข้อมูลทุกครั้งที่มีคนถามว่า "ทำไมกดปุ่มนี้ไม่ได้"
 *
 * คืนคีย์ **ครบทุกตัวที่ระบบรู้จัก** รวมที่ไม่มีใครได้ — ช่องว่างคือคำตอบ
 * ที่มีความหมายพอ ๆ กับรายชื่อ และการซ่อนแถวที่ว่างทำให้ดูเหมือนไม่มีคีย์นั้นอยู่
 */
export async function describeGrants(
  ctx: TenantContext,
  projectId: bigint,
): Promise<{
  schemeName: string | null;
  rows: Array<{
    permission: string;
    groups: string[];
    impliedBy: string | null;
    impliedGroups: string[];
    /** มีโค้ดตรวจคีย์นี้จริงหรือยัง — ให้สิทธิ์ที่ไม่มีผลคือการสร้างความเชื่อผิด */
    enforced: boolean;
  }>;
}> {
  const db = tenantScoped(ctx);
  const project = await db.project.findFirst({
    where: { id: projectId },
    select: { permissionScheme: { select: { id: true, name: true } } },
  });
  const scheme = project?.permissionScheme ?? null;
  const empty = ALL_PERMISSION_KEYS.map((permission) => ({
    permission,
    groups: [] as string[],
    impliedBy: IMPLIED_BY[permission] ?? null,
    impliedGroups: [] as string[],
    enforced: isEnforced(permission),
  }));
  // โปรเจกต์ที่ไม่มี scheme = ไม่มีใครทำอะไรได้เลย ไม่ใช่ทุกคนทำได้
  if (scheme === null) return { schemeName: null, rows: empty };

  const grants = await db.permissionGrant.findMany({
    where: { schemeId: scheme.id },
    select: { permission: true, group: { select: { name: true } } },
  });

  const byKey = new Map<string, string[]>(ALL_PERMISSION_KEYS.map((k) => [k, []]));
  for (const g of grants) {
    // grant ที่ไม่มีกลุ่มถือว่าไม่ให้สิทธิ์ใคร (ข้อมูลไม่ครบ = ไม่มีสิทธิ์)
    if (g.group === null) continue;
    byKey.get(g.permission)?.push(g.group.name);
  }
  return {
    schemeName: scheme.name,
    rows: ALL_PERMISSION_KEYS.map((permission) => {
      const source = IMPLIED_BY[permission] ?? null;
      return {
        permission,
        groups: (byKey.get(permission) ?? []).sort((a, b) => a.localeCompare(b, 'th')),
        impliedBy: source,
        // กลุ่มที่ได้สิทธิ์นี้มาโดยปริยาย ไม่ได้อยู่ในตาราง grant ของคีย์นี้เลย
        impliedGroups:
          source === null
            ? []
            : (byKey.get(source) ?? []).sort((a, b) => a.localeCompare(b, 'th')),
        enforced: isEnforced(permission),
      };
    }),
  };
}

export class SchemeNotFoundError extends Error {
  constructor(projectKey: string) {
    super(`โปรเจกต์ ${projectKey} ยังไม่ได้ผูกชุดสิทธิ์ จึงแก้สิทธิ์ไม่ได้`);
    this.name = 'SchemeNotFoundError';
  }
}

export class UnknownGroupError extends Error {
  constructor(readonly groupId: string) {
    super(`ไม่พบกลุ่ม #${groupId}`);
    this.name = 'UnknownGroupError';
  }
}

export class LastAdminGrantError extends Error {
  constructor() {
    super(
      'ถอนสิทธิ์ผู้ดูแลระบบรายการสุดท้ายไม่ได้ — จะไม่มีใครเข้าหน้าตั้งค่าได้อีกเลย ' +
        'และกู้กลับได้ทางฐานข้อมูลทางเดียว',
    );
    this.name = 'LastAdminGrantError';
  }
}

/**
 * ให้หรือถอนสิทธิ์หนึ่งรายการกับกลุ่มหนึ่ง
 *
 * ⚠️ **โค้ดนี้แตะระบบสิทธิ์ — ต้องให้ Tech Lead อนุมัติก่อน merge (CLAUDE.md §4)**
 *
 * ทำงานที่ระดับ **ชุดสิทธิ์ ไม่ใช่โปรเจกต์** เพราะโครงสร้างเป็นอย่างนั้นจริง
 * ชุดสิทธิ์ใบเดียวใช้ร่วมกันหลายโปรเจกต์ได้ · การแก้จากหน้าโปรเจกต์หนึ่ง
 * จึงเปลี่ยนอีกโปรเจกต์ไปด้วย — `schemeUsage` มีไว้ให้หน้าจอบอกเรื่องนี้ก่อนกด
 */
export async function setGrant(
  ctx: TenantContext,
  schemeId: bigint,
  permission: PermissionKey,
  groupId: bigint,
  granted: boolean,
): Promise<{ changed: boolean }> {
  const db = tenantScoped(ctx);
  const group = await db.userGroup.findFirst({ where: { id: groupId }, select: { name: true } });
  if (group === null) throw new UnknownGroupError(groupId.toString());

  const existing = await db.permissionGrant.findFirst({
    where: { schemeId, permission, groupId },
    select: { id: true },
  });
  // สั่งซ้ำสถานะเดิมไม่ใช่ความผิดพลาด — auditedTransaction โยนเมื่อไม่มีอะไรเปลี่ยน
  if (granted === (existing !== null)) return { changed: false };

  /**
   * ล็อกตัวเองออกจากระบบไม่ได้
   *
   * `ADMINISTER_TENANT` เป็นทางเดียวที่เข้าหน้าตั้งค่าได้ · ถอนรายการสุดท้ายทิ้ง
   * แปลว่าไม่มีใครแก้อะไรได้อีกเลย รวมถึงแก้ความผิดพลาดนี้ · ทางกลับมีทางเดียว
   * คือ INSERT ลงฐานข้อมูลตรง ๆ ซึ่งลูกค้า on-prem ทำเองไม่ได้
   *
   * ตรวจ **ทั้ง tenant** ไม่ใช่แค่ชุดสิทธิ์ใบนี้ เพราะ `isTenantAdmin` ถือว่า
   * มีคีย์นี้ในชุดไหนก็ตาม = เป็นผู้ดูแลทั้ง tenant
   */
  if (!granted) {
    const others = await db.permissionGrant.count({
      where: { permission: 'ADMINISTER_TENANT', groupId: { not: null }, id: { not: existing?.id } },
    });
    if (wouldLockOutAdmins(permission, others)) throw new LastAdminGrantError();
  }

  await auditedTransaction(ctx, granted ? 'permission.grant' : 'permission.revoke', async (tx) => {
    if (granted) {
      await tx.permissionGrant.create({
        data: { tenantId: ctx.tenantId, schemeId, permission, groupId },
      });
    } else if (existing !== null) {
      await tx.permissionGrant.delete({ where: { id: existing.id } });
    }
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: granted ? 'permission.grant' : 'permission.revoke',
          entityType: 'permission_scheme',
          entityId: schemeId.toString(),
          payload: { permission, group: group.name, granted },
        },
      ],
    };
  });
  return { changed: true };
}

/** โปรเจกต์ทั้งหมดที่ใช้ชุดสิทธิ์ใบนี้ — หน้าจอต้องบอกก่อนแก้ */
export async function schemeUsage(ctx: TenantContext, schemeId: bigint): Promise<string[]> {
  const rows = await tenantScoped(ctx).project.findMany({
    where: { permissionSchemeId: schemeId },
    orderBy: { key: 'asc' },
    select: { key: true },
  });
  return rows.map((p) => p.key);
}
