/**
 * สร้างโปรเจกต์
 *
 * โปรเจกต์แรกมาจาก `bootstrap.js` ตอนติดตั้ง · โปรเจกต์ที่สองไม่เคยสร้างได้เลย
 * นอกจากรันสคริปต์ซ้ำหรือ INSERT ด้วยมือ ซึ่งลูกค้า on-prem ทำเองไม่ได้
 *
 * ไฟล์นี้เป็นทางเดียวที่สร้างโปรเจกต์ได้ และ `bootstrap` ก็เรียกตัวนี้ —
 * เส้นทางที่ผู้ใช้ใช้จริงจึงถูกรันทุกครั้งที่มีการติดตั้ง ไม่ใช่แค่ตอนมีคนกดปุ่ม
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

export const PROJECT_KEY_MAX = 10;
export const PROJECT_KEY_MIN = 2;

export type ProjectTypeName = 'SERVICE_DESK' | 'SOFTWARE' | 'BUSINESS';
export const PROJECT_TYPES: readonly ProjectTypeName[] = [
  'SERVICE_DESK',
  'SOFTWARE',
  'BUSINESS',
] as const;

export class InvalidProjectKeyError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidProjectKeyError';
  }
}

export class DuplicateProjectKeyError extends Error {
  constructor(readonly given: string) {
    super(`มีโปรเจกต์คีย์ ${given} อยู่แล้ว`);
    this.name = 'DuplicateProjectKeyError';
  }
}

export class ProjectNeedsSchemeError extends Error {
  constructor() {
    super(
      'ต้องเลือกชุดสิทธิ์ — โปรเจกต์ที่ไม่มีชุดสิทธิ์ไม่มีใครเข้าถึงได้เลย รวมถึงผู้สร้างเอง',
    );
    this.name = 'ProjectNeedsSchemeError';
  }
}

export class ProjectNeedsWorkflowError extends Error {
  constructor() {
    super('ต้องเลือก workflow และประเภทงานอย่างน้อยหนึ่งชนิด ไม่งั้นแจ้งเรื่องใหม่จะล้มเหลว');
    this.name = 'ProjectNeedsWorkflowError';
  }
}

export class UnknownReferenceError extends Error {
  constructor(what: string) {
    super(`ไม่พบ${what}ที่เลือก`);
    this.name = 'UnknownReferenceError';
  }
}

/**
 * ตรวจคีย์โปรเจกต์ — ฟังก์ชันบริสุทธิ์
 *
 * คีย์ฝังอยู่ใน `item_key` ของงานทุกใบ (`SD-1042`) จึง **แก้ทีหลังไม่ได้**
 * โดยไม่ทำให้ลิงก์ที่คนส่งกันไว้ในอีเมลและแชตเสียทั้งหมด · การตรวจตอนสร้าง
 * จึงเป็นด่านเดียวที่มี
 *
 * ตัวพิมพ์ใหญ่และตัวเลขเท่านั้น และห้ามขึ้นต้นด้วยตัวเลข เพราะคีย์ที่ขึ้นต้น
 * ด้วยตัวเลขทำให้ `SD-12` กับ `12-34` แยกกันด้วยสายตาไม่ออกในรายการเดียวกัน
 */
export function normalizeProjectKey(raw: unknown): string {
  const key = (typeof raw === 'string' ? raw : '').trim().toUpperCase();
  if (key.length < PROJECT_KEY_MIN) {
    throw new InvalidProjectKeyError(`คีย์ต้องยาวอย่างน้อย ${String(PROJECT_KEY_MIN)} ตัวอักษร`);
  }
  if (key.length > PROJECT_KEY_MAX) {
    throw new InvalidProjectKeyError(`คีย์ต้องยาวไม่เกิน ${String(PROJECT_KEY_MAX)} ตัวอักษร`);
  }
  if (!/^[A-Z][A-Z0-9]*$/.test(key)) {
    throw new InvalidProjectKeyError('คีย์ใช้ได้เฉพาะ A–Z และ 0–9 และต้องขึ้นต้นด้วยตัวอักษร');
  }
  return key;
}

export interface CreateProjectInput {
  key: string;
  name: string;
  type: ProjectTypeName;
  permissionSchemeId: bigint;
  workflowId: bigint;
  issueTypeIds: readonly bigint[];
  notifyGroupId?: bigint | null;
}

export interface CreatedProject {
  id: bigint;
  key: string;
}

export async function createProject(
  ctx: TenantContext,
  input: CreateProjectInput,
): Promise<CreatedProject> {
  const db = tenantScoped(ctx);
  const key = normalizeProjectKey(input.key);
  const name = (typeof input.name === 'string' ? input.name : '').trim().slice(0, 255);
  if (name === '') throw new InvalidProjectKeyError('ต้องระบุชื่อโปรเจกต์');
  if (!PROJECT_TYPES.includes(input.type)) throw new UnknownReferenceError('ประเภทโปรเจกต์');

  if ((await db.project.findFirst({ where: { key }, select: { id: true } })) !== null) {
    throw new DuplicateProjectKeyError(key);
  }

  /**
   * โปรเจกต์ที่ไม่มีชุดสิทธิ์ = ไม่มีใครเข้าถึงได้ (ดู `describeGrants`)
   *
   * ปล่อยให้สร้างได้แล้วค่อยไปผูกทีหลัง ฟังดูยืดหยุ่นกว่า แต่ผลจริงคือมีโปรเจกต์
   * ที่มองไม่เห็นจากทุกหน้าจอ และคนสร้างจะคิดว่าระบบพัง ไม่ใช่ว่าตั้งค่าไม่ครบ
   */
  const scheme = await db.permissionScheme.findFirst({
    where: { id: input.permissionSchemeId },
    select: { id: true, name: true },
  });
  if (scheme === null) throw new ProjectNeedsSchemeError();

  const issueTypeIds = [...new Set(input.issueTypeIds)];
  if (issueTypeIds.length === 0) throw new ProjectNeedsWorkflowError();
  const workflow = await db.workflow.findFirst({
    where: { id: input.workflowId },
    select: { id: true, name: true },
  });
  if (workflow === null) throw new ProjectNeedsWorkflowError();

  const issueTypes = await db.issueType.findMany({
    where: { id: { in: [...issueTypeIds] } },
    select: { id: true, name: true },
  });
  if (issueTypes.length !== issueTypeIds.length) throw new UnknownReferenceError('ประเภทงาน');

  // workflow ที่ไม่มีสถานะเริ่มต้น สร้างงานใบแรกไม่ได้ และล้มตอนกดแจ้งเรื่อง
  // ไม่ใช่ตอนสร้างโปรเจกต์ — ซึ่งเป็นคนละที่กับที่ผู้ใช้ทำผิด
  const initial = await db.workflowStatus.count({
    where: { workflowId: workflow.id, isInitial: true },
  });
  if (initial === 0) {
    throw new ProjectNeedsWorkflowError();
  }

  let notifyGroupId: bigint | null = null;
  if (input.notifyGroupId !== undefined && input.notifyGroupId !== null) {
    const g = await db.userGroup.findFirst({
      where: { id: input.notifyGroupId },
      select: { id: true },
    });
    if (g === null) throw new UnknownReferenceError('กลุ่มรับแจ้งเตือน');
    notifyGroupId = g.id;
  }

  return auditedTransaction(ctx, 'project.create', async (tx) => {
    const project = await tx.project.create({
      data: {
        tenantId: ctx.tenantId,
        key,
        name,
        type: input.type,
        permissionSchemeId: scheme.id,
        notifyGroupId,
      },
      select: { id: true, key: true },
    });

    /**
     * ตัวนับต้องมีตั้งแต่แรก
     *
     * ไม่มีตัวนับ = สร้างงานใบแรกไม่ได้ และ error ไปโผล่ที่หน้าแจ้งเรื่อง
     * ของผู้ใช้ทั่วไป ไม่ใช่ที่หน้าตั้งค่าของคนที่ลืมสร้างมัน
     * (บทเรียนเดียวกับที่ `bootstrap` เจอตอนยกสแตกครั้งแรก)
     */
    await tx.projectCounter.create({
      data: { tenantId: ctx.tenantId, projectId: project.id, lastValue: 0 },
    });

    for (const it of issueTypes) {
      await tx.workflowScheme.create({
        data: {
          tenantId: ctx.tenantId,
          projectId: project.id,
          issueTypeId: it.id,
          workflowId: workflow.id,
        },
      });
    }

    return {
      result: { id: project.id, key: project.key },
      audit: [
        {
          kind: 'system',
          action: 'project.create',
          entityType: 'project',
          entityId: project.id.toString(),
          payload: {
            key,
            name,
            type: input.type,
            // เก็บชื่อ ไม่ใช่ id — audit ที่อ่านย้อนหลังแล้วต้องไปเปิดตารางอื่นต่อ
            // คือ audit ที่ไม่มีใครอ่าน
            permissionScheme: scheme.name,
            workflow: workflow.name,
            issueTypes: issueTypes.map((t) => t.name),
          },
        },
      ],
    };
  });
}

/** ตัวเลือกที่หน้าจอสร้างโปรเจกต์ต้องใช้ */
export async function projectCreationOptions(ctx: TenantContext): Promise<{
  schemes: Array<{ id: string; name: string; usedBy: string[] }>;
  workflows: Array<{ id: string; name: string; statusCount: number; hasInitial: boolean }>;
  issueTypes: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
}> {
  const db = tenantScoped(ctx);
  const [schemes, workflows, issueTypes, groups] = await Promise.all([
    db.permissionScheme.findMany({
      orderBy: { name: 'asc' },
      include: { projects: { select: { key: true }, orderBy: { key: 'asc' } } },
    }),
    db.workflow.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: { statuses: { select: { isInitial: true } } },
    }),
    db.issueType.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.userGroup.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  return {
    // บอกว่าชุดสิทธิ์ใบไหนถูกใช้อยู่แล้ว — เลือกใบเดิมแปลว่าสิทธิ์ผูกกันสองโปรเจกต์
    schemes: schemes.map((s) => ({
      id: s.id.toString(),
      name: s.name,
      usedBy: s.projects.map((p) => p.key),
    })),
    workflows: workflows.map((w) => ({
      id: w.id.toString(),
      name: w.name,
      statusCount: w.statuses.length,
      // workflow ที่ไม่มีสถานะเริ่มต้น สร้างงานไม่ได้ — ต้องเห็นก่อนเลือก
      hasInitial: w.statuses.some((st) => st.isInitial),
    })),
    issueTypes: issueTypes.map((t) => ({ id: t.id.toString(), name: t.name })),
    groups: groups.map((g) => ({ id: g.id.toString(), name: g.name })),
  };
}
