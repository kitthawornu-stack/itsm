/**
 * ประเภทงาน และการผูกประเภทงานเข้ากับ workflow ของโปรเจกต์
 *
 * เป็นเกณฑ์ผ่าน Phase 0 ส่วนที่สอง — "แอดมินสร้าง Issue Type ใหม่ได้จาก UI"
 *
 * และเป็นช่องโหว่จริงที่เจอตอนสร้างโปรเจกต์ที่สอง: โปรเจกต์ HR ผูกไว้กับ
 * ประเภทงานเดียวตอนสร้าง และ **ไม่มีทางเพิ่มประเภทที่สองได้เลยหลังจากนั้น**
 * นอกจากเขียน SQL
 *
 * `iconKey` ถามจากผู้ดูแลได้แล้ว เพราะมีของที่เรนเดอร์มันจริง · ค่าที่รับ
 * ถูกแปลผ่าน `normalizeIconKey` เสมอ — คอลัมน์นี้เคยเป็นสตริงอิสระที่ทุก
 * ทางเข้าเขียนคนละแบบ การเปิดให้กรอกโดยไม่แปล คือการเพิ่มทางเข้าที่ห้าให้ปัญหาเดิม
 *
 * ⚠️ `hierarchyLevel` ยังไม่ถามจากฟอร์ม — มันตั้งจาก `isSubtask` และการให้
 * ผู้ดูแลกรอกเองแปลว่าเขาสร้างชั้นที่ระบบไม่รู้จักได้ · ถามค่าที่ตั้งแล้วไม่มีผล
 * คือการสร้างความเชื่อผิด
 */
import { normalizeIconKey, type IssueTypeIconKey, type TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

export class IssueTypeNameRequiredError extends Error {
  constructor() {
    super('ต้องระบุชื่อประเภทงาน');
    this.name = 'IssueTypeNameRequiredError';
  }
}

export class DuplicateIssueTypeError extends Error {
  constructor(readonly given: string) {
    super(`มีประเภทงาน "${given}" อยู่แล้ว`);
    this.name = 'DuplicateIssueTypeError';
  }
}

export class IssueTypeNotFoundError extends Error {
  constructor(id: bigint) {
    super(`ไม่พบประเภทงาน #${id.toString()}`);
    this.name = 'IssueTypeNotFoundError';
  }
}

export class IssueTypeInUseError extends Error {
  constructor(
    readonly typeName: string,
    readonly itemCount: number,
    readonly projectCount: number,
  ) {
    super(
      `ลบประเภทงาน "${typeName}" ไม่ได้ — มีงาน ${String(itemCount)} เรื่อง ` +
        `และผูกอยู่กับ ${String(projectCount)} โปรเจกต์`,
    );
    this.name = 'IssueTypeInUseError';
  }
}

export class BindingInUseError extends Error {
  constructor(
    readonly typeName: string,
    readonly projectKey: string,
    readonly itemCount: number,
  ) {
    super(
      `ถอนประเภทงาน "${typeName}" ออกจากโปรเจกต์ ${projectKey} ไม่ได้ — ` +
        `มีงาน ${String(itemCount)} เรื่องเป็นประเภทนี้อยู่ในโปรเจกต์ ` +
        'ถอนแล้วงานเหล่านั้นจะหา workflow ไม่เจอ และกดเปลี่ยนสถานะไม่ได้อีกเลย',
    );
    this.name = 'BindingInUseError';
  }
}

export class WorkflowUnusableError extends Error {
  constructor(readonly workflowName: string) {
    super(`workflow "${workflowName}" ไม่มีสถานะเริ่มต้น — ผูกแล้วแจ้งเรื่องใหม่จะล้มเหลว`);
    this.name = 'WorkflowUnusableError';
  }
}

const NAME_MAX = 64;

function cleanName(v: unknown): string {
  const s = (typeof v === 'string' ? v : '').trim();
  if (s === '') throw new IssueTypeNameRequiredError();
  return s.slice(0, NAME_MAX);
}

export interface IssueTypeRow {
  id: string;
  name: string;
  /** แปลแล้วเสมอ — แถวเก่าถือค่าดิบอย่าง `alert-triangle` หรือ `x` อยู่ */
  icon: IssueTypeIconKey;
  isSubtask: boolean;
  itemCount: number;
  /** โปรเจกต์ที่ผูกประเภทนี้ไว้ */
  usedBy: string[];
}

export async function listIssueTypes(ctx: TenantContext): Promise<IssueTypeRow[]> {
  const rows = await tenantScoped(ctx).issueType.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { workItems: true } },
      workflowSchemes: { include: { project: { select: { key: true } } } },
    },
  });
  return rows.map((t) => ({
    id: t.id.toString(),
    name: t.name,
    icon: normalizeIconKey(t.iconKey),
    isSubtask: t.isSubtask,
    itemCount: t._count.workItems,
    usedBy: [...new Set(t.workflowSchemes.map((s) => s.project.key))].sort((a, b) =>
      a.localeCompare(b),
    ),
  }));
}

export async function createIssueType(
  ctx: TenantContext,
  rawName: string,
  isSubtask = false,
  rawIcon: unknown = null,
): Promise<{ id: bigint; name: string }> {
  const db = tenantScoped(ctx);
  const name = cleanName(rawName);
  if ((await db.issueType.findFirst({ where: { name }, select: { id: true } })) !== null) {
    throw new DuplicateIssueTypeError(name);
  }

  return auditedTransaction(ctx, 'issuetype.create', async (tx) => {
    const t = await tx.issueType.create({
      data: {
        tenantId: ctx.tenantId,
        name,
        /*
          แปลก่อนเก็บเสมอ · ค่าที่ไม่รู้จักกลายเป็น `generic` ไม่ใช่ถูกปฏิเสธ
          — ผู้ดูแลเลือกจากรายการที่ API ให้มา ค่าประหลาดจึงมาจากการเรียก
          endpoint ตรง ๆ เท่านั้น และไม่ควรทำให้สร้างประเภทงานไม่ได้
        */
        iconKey: normalizeIconKey(typeof rawIcon === 'string' ? rawIcon : null),
        isSubtask,
        hierarchyLevel: isSubtask ? -1 : 0,
      },
      select: { id: true, name: true },
    });
    return {
      result: t,
      audit: [
        {
          kind: 'system',
          action: 'issuetype.create',
          entityType: 'issue_type',
          entityId: t.id.toString(),
          payload: { name, isSubtask, icon: normalizeIconKey(typeof rawIcon === 'string' ? rawIcon : null) },
        },
      ],
    };
  });
}

/**
 * ลบประเภทงาน
 *
 * ปฏิเสธเมื่อมีงานเป็นประเภทนี้ หรือยังผูกกับโปรเจกต์อยู่ · ทั้งสองอย่างเป็น
 * `onDelete: Restrict` ในสคีมา แต่ต้องตอบเป็นภาษาคนพร้อมจำนวนที่กระทบ
 */
export async function removeIssueType(ctx: TenantContext, id: bigint): Promise<void> {
  const db = tenantScoped(ctx);
  const t = await db.issueType.findFirst({ where: { id }, select: { id: true, name: true } });
  if (t === null) throw new IssueTypeNotFoundError(id);

  const [items, schemes] = await Promise.all([
    db.workItem.count({ where: { issueTypeId: id } }),
    db.workflowScheme.count({ where: { issueTypeId: id } }),
  ]);
  if (items > 0 || schemes > 0) throw new IssueTypeInUseError(t.name, items, schemes);

  await auditedTransaction(ctx, 'issuetype.remove', async (tx) => {
    await tx.issueType.delete({ where: { id } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'issuetype.remove',
          entityType: 'issue_type',
          entityId: id.toString(),
          payload: { name: t.name },
        },
      ],
    };
  });
}

// ============================================================
// ผูกประเภทงานเข้ากับโปรเจกต์
// ============================================================

/**
 * ผูกประเภทงานเข้ากับ workflow ของโปรเจกต์
 *
 * เรียกซ้ำด้วย workflow ใหม่ = เปลี่ยน workflow ของประเภทนั้น ซึ่งกระทบงาน
 * ที่เปิดอยู่ทันที — งานที่อยู่ในสถานะของ workflow เดิมจะไม่มีปุ่มให้กดเลย
 * เพราะ `loadTransitions` หา transition จาก workflow ใหม่ที่ไม่มีสถานะนั้นอยู่
 */
export async function bindIssueType(
  ctx: TenantContext,
  projectId: bigint,
  issueTypeId: bigint,
  workflowId: bigint,
): Promise<{ changed: boolean }> {
  const db = tenantScoped(ctx);
  const type = await db.issueType.findFirst({
    where: { id: issueTypeId },
    select: { id: true, name: true },
  });
  if (type === null) throw new IssueTypeNotFoundError(issueTypeId);

  const wf = await db.workflow.findFirst({
    where: { id: workflowId },
    select: { id: true, name: true },
  });
  if (wf === null) throw new WorkflowUnusableError('(ไม่พบ)');
  const initial = await db.workflowStatus.count({ where: { workflowId, isInitial: true } });
  if (initial === 0) throw new WorkflowUnusableError(wf.name);

  const existing = await db.workflowScheme.findFirst({
    where: { projectId, issueTypeId },
    select: { id: true, workflowId: true },
  });
  if (existing !== null && existing.workflowId === workflowId) return { changed: false };

  await auditedTransaction(ctx, 'project.issuetype.bind', async (tx) => {
    if (existing === null) {
      await tx.workflowScheme.create({
        data: { tenantId: ctx.tenantId, projectId, issueTypeId, workflowId },
      });
    } else {
      await tx.workflowScheme.update({ where: { id: existing.id }, data: { workflowId } });
    }
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'project.issuetype.bind',
          entityType: 'project',
          entityId: projectId.toString(),
          payload: { issueType: type.name, workflow: wf.name, replaced: existing !== null },
        },
      ],
    };
  });
  return { changed: true };
}

/**
 * ถอนประเภทงานออกจากโปรเจกต์
 *
 * **ปฏิเสธเมื่อยังมีงานประเภทนั้นอยู่ในโปรเจกต์** — ถอนแล้ว `loadTransitions`
 * หา `workflow_scheme` ไม่เจอและโยน `NoWorkflowError` ผลคืองานที่เปิดค้างอยู่
 * กดเปลี่ยนสถานะไม่ได้อีกเลย และไม่มีอะไรบนหน้าจอบอกว่าเพราะอะไร
 */
export async function unbindIssueType(
  ctx: TenantContext,
  projectId: bigint,
  issueTypeId: bigint,
): Promise<void> {
  const db = tenantScoped(ctx);
  const scheme = await db.workflowScheme.findFirst({
    where: { projectId, issueTypeId },
    include: {
      issueType: { select: { name: true } },
      project: { select: { key: true } },
    },
  });
  if (scheme === null) throw new IssueTypeNotFoundError(issueTypeId);

  const items = await db.workItem.count({ where: { projectId, issueTypeId } });
  if (items > 0) {
    throw new BindingInUseError(scheme.issueType.name, scheme.project.key, items);
  }

  await auditedTransaction(ctx, 'project.issuetype.unbind', async (tx) => {
    await tx.workflowScheme.delete({ where: { id: scheme.id } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'project.issuetype.unbind',
          entityType: 'project',
          entityId: projectId.toString(),
          payload: { issueType: scheme.issueType.name },
        },
      ],
    };
  });
}

/**
 * เปลี่ยนไอคอนของประเภทงานที่มีอยู่แล้ว
 *
 * ต้องมี เพราะประเภทงานทั้งหมดที่มีอยู่ตอนนี้ถือค่าดิบที่เขียนไว้ตอน seed
 * หรือ `generic` ที่ `createIssueType` เคยตั้งให้ · ถ้าตั้งได้แต่ตอนสร้าง
 * ผู้ดูแลจะแก้ของที่มีอยู่ไม่ได้เลย และต้องลบทิ้งสร้างใหม่ ซึ่งลบไม่ได้
 * ถ้ามีงานผูกอยู่
 */
export async function setIssueTypeIcon(
  ctx: TenantContext,
  id: bigint,
  rawIcon: unknown,
): Promise<IssueTypeIconKey> {
  const db = tenantScoped(ctx);
  const before = await db.issueType.findFirst({ where: { id }, select: { iconKey: true } });
  if (before === null) throw new IssueTypeNotFoundError(id);
  const icon = normalizeIconKey(typeof rawIcon === 'string' ? rawIcon : null);

  return auditedTransaction(ctx, 'issuetype.icon', async (tx) => {
    await tx.issueType.update({ where: { id }, data: { iconKey: icon } });
    return {
      result: icon,
      audit: [
        {
          kind: 'system',
          action: 'issuetype.icon',
          entityType: 'issue_type',
          entityId: id.toString(),
          /* เก็บค่าเดิมไว้ด้วย — "เปลี่ยนเป็นอะไร" ตอบได้ครึ่งเดียวว่าเกิดอะไรขึ้น */
          payload: { from: normalizeIconKey(before.iconKey), to: icon },
        },
      ],
    };
  });
}
