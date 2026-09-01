/**
 * นำเข้าข้อมูลจาก Excel/CSV — ต่อฐานข้อมูล
 *
 * `csv-import.ts` อ่านไฟล์และตัดสินว่าแถวไหนใช้ได้ · ไฟล์นี้หา "สิ่งที่ระบบ
 * รู้จัก" มาให้มันตัดสิน แล้วเขียนลงฐานข้อมูลในทรานแซกชันเดียว
 *
 * ## รายการที่ใช้ตรวจ มาจากฐานข้อมูลจริง ไม่ใช่รายการที่พิมพ์ไว้
 *
 * สถานะมาจาก workflow ของโปรเจกต์นั้นจริง ๆ · ความสำคัญและอีเมลมาจากตาราง ·
 * **รายการที่คนดูแลด้วยมือจะไม่ตรงกับความจริงในวันที่มีคนเพิ่มสถานะใหม่**
 * แล้วการนำเข้าจะปฏิเสธค่าที่ถูกต้อง โดยบอกว่า "ไม่รู้จัก"
 *
 * ## ทั้งไฟล์ในทรานแซกชันเดียว
 *
 * การนำเข้าครึ่งไฟล์ทำให้องค์กรอยู่ในสภาพครึ่ง ๆ กลาง ๆ โดยไม่มีใครบอกได้ว่า
 * แถวไหนเข้าไปแล้ว · ล้มกลางทาง = ไม่มีอะไรเข้าเลย แล้วแก้ไฟล์นำเข้าใหม่
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan } from '../permission';
import {
  parseCsv,
  planImport,
  type ImportCatalog,
  type ImportPlan,
  type ImportProblem,
} from './csv-import';

/** แหล่งที่มา — เก็บไว้ในแถวเพื่อให้แยกได้เมื่อวันหน้ามีที่อื่น */
export const IMPORT_SOURCE = 'excel';

/**
 * จำนวนแถวสูงสุดต่อไฟล์
 *
 * ทั้งไฟล์อยู่ในทรานแซกชันเดียว · ไฟล์ที่ใหญ่เกินจะล็อกตารางนานเกินไป
 * และถ้าล้มก็ต้องย้อนทั้งหมด · ให้แบ่งไฟล์ดีกว่ารอสิบนาทีแล้วล้ม
 */
export const MAX_IMPORT_ROWS = 2000;

export class ProjectNotFoundForImportError extends Error {
  constructor(key: string) {
    super(`ไม่พบโปรเจกต์ ${key}`);
    this.name = 'ProjectNotFoundForImportError';
  }
}

export class FileTooLargeError extends Error {
  constructor(readonly rows: number) {
    super(
      `ไฟล์มี ${String(rows)} แถว เกินเพดาน ${String(MAX_IMPORT_ROWS)} แถวต่อครั้ง — ` +
        'แบ่งไฟล์แล้วนำเข้าทีละส่วน',
    );
    this.name = 'FileTooLargeError';
  }
}

export interface ImportPreview {
  problems: ImportProblem[];
  /** จำนวนแถวในไฟล์ทั้งหมด */
  totalRows: number;
  /** แถวที่จะถูกสร้างใหม่ */
  toCreate: number;
  /** แถวที่เคยนำเข้าไปแล้ว — ข้าม ไม่ใช่สร้างซ้ำ */
  alreadyImported: number;
}

async function projectFor(ctx: TenantContext, key: string): Promise<{ id: bigint; key: string }> {
  const p = await tenantScoped(ctx).project.findFirst({
    where: { key },
    select: { id: true, key: true },
  });
  if (p === null) throw new ProjectNotFoundForImportError(key);
  return p;
}

/**
 * สิ่งที่ระบบรู้จัก — อ่านจากฐานข้อมูลทุกครั้ง
 *
 * สถานะมาจาก workflow ที่ผูกกับโปรเจกต์นั้น ไม่ใช่ทุกสถานะใน tenant ·
 * สถานะของโปรเจกต์อื่นที่นำเข้ามาไม่ได้ ต้องถูกปฏิเสธ ไม่ใช่รับไว้แล้วพัง
 * ตอนเปลี่ยนสถานะครั้งแรก
 */
async function catalogFor(ctx: TenantContext, projectId: bigint): Promise<ImportCatalog> {
  const db = tenantScoped(ctx);
  const statuses = await db.workflowStatus.findMany({
    where: { workflow: { schemes: { some: { project: { id: projectId } } } } },
    select: { name: true },
    distinct: ['name'],
  });
  const priorities = await db.priority.findMany({
    where: { isActive: true },
    select: { name: true },
  });
  const users = await db.user.findMany({ where: { isActive: true }, select: { email: true } });
  return {
    statuses: statuses.map((s) => s.name),
    priorities: priorities.map((p) => p.name),
    emails: users.map((u) => u.email),
  };
}

/** ตรวจไฟล์โดยไม่เขียนอะไรเลย — คนต้องได้เห็นปัญหาทั้งหมดก่อนกดจริง */
export async function previewImport(
  ctx: TenantContext,
  projectKey: string,
  csvText: string,
): Promise<ImportPreview> {
  const project = await projectFor(ctx, projectKey);
  await assertCan(ctx, project.id, 'MANAGE_PROJECT');

  const file = parseCsv(csvText);
  if (file.rows.length > MAX_IMPORT_ROWS) throw new FileTooLargeError(file.rows.length);

  const plan = planImport(file, await catalogFor(ctx, project.id));
  const already = await existingKeys(ctx, plan);
  return {
    problems: plan.problems,
    totalRows: plan.wouldImport,
    toCreate: plan.ready.filter((r) => !already.has(r.externalKey)).length,
    alreadyImported: plan.ready.filter((r) => already.has(r.externalKey)).length,
  };
}

/** รหัสที่เคยนำเข้าไปแล้ว — นำเข้าซ้ำต้องข้าม ไม่ใช่สร้างซ้ำ */
async function existingKeys(ctx: TenantContext, plan: ImportPlan): Promise<Set<string>> {
  if (plan.ready.length === 0) return new Set();
  const rows = await tenantScoped(ctx).importRecord.findMany({
    where: { source: IMPORT_SOURCE, externalKey: { in: plan.ready.map((r) => r.externalKey) } },
    select: { externalKey: true },
  });
  return new Set(rows.map((r) => r.externalKey));
}

export interface ImportResult {
  created: number;
  skipped: number;
  problems: ImportProblem[];
}

/**
 * นำเข้าจริง
 *
 * **มีปัญหาแม้ข้อเดียว ไม่เขียนอะไรเลย** — คืน `problems` ให้ไปแก้ไฟล์
 * แล้วนำเข้าใหม่ทั้งไฟล์
 *
 * @throws {ProjectNotFoundForImportError} ไม่มีโปรเจกต์ หรือเปิดดูไม่ได้
 * @throws {FileTooLargeError} เกินเพดานแถวต่อครั้ง
 */
export async function runImport(
  ctx: TenantContext,
  projectKey: string,
  csvText: string,
  now: UtcDate = systemClock.nowUtc(),
): Promise<ImportResult> {
  const actorId = ctx.actorId;
  if (actorId === null) throw new ProjectNotFoundForImportError(projectKey);
  const project = await projectFor(ctx, projectKey);
  await assertCan(ctx, project.id, 'MANAGE_PROJECT');

  const file = parseCsv(csvText);
  if (file.rows.length > MAX_IMPORT_ROWS) throw new FileTooLargeError(file.rows.length);

  const plan = planImport(file, await catalogFor(ctx, project.id));
  if (plan.problems.length > 0) {
    return { created: 0, skipped: 0, problems: plan.problems };
  }

  const already = await existingKeys(ctx, plan);
  const todo = plan.ready.filter((r) => !already.has(r.externalKey));
  const skipped = plan.ready.length - todo.length;
  if (todo.length === 0) return { created: 0, skipped, problems: [] };

  const db = tenantScoped(ctx);
  const issueType = await db.workItem.findFirstOrThrow({
    where: { projectId: project.id },
    select: { issueTypeId: true },
  });
  const statusIds = new Map(
    (
      await db.workflowStatus.findMany({
        where: { workflow: { schemes: { some: { project: { id: project.id } } } } },
        select: { id: true, name: true },
      })
    ).map((s) => [s.name, s.id]),
  );
  const priorityIds = new Map(
    (await db.priority.findMany({ select: { id: true, name: true } })).map((p) => [p.name, p.id]),
  );
  const userIds = new Map(
    (await db.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email, u.id]),
  );

  return auditedTransaction(ctx, 'import.run', async (tx) => {
    let created = 0;
    for (const row of todo) {
      /*
        ขอเลขทีละใบผ่าน `projectCounter` เหมือนการสร้างงานปกติ — ไม่คำนวณ
        เลขล่วงหน้าเป็นชุด · ถ้ามีคนสร้างงานจากหน้าจอระหว่างที่นำเข้ากำลังวิ่ง
        เลขที่คำนวณไว้ล่วงหน้าจะชนกัน แล้ว unique index จะล้มทั้งไฟล์
      */
      const counter = await tx.projectCounter.upsert({
        where: { projectId: project.id },
        create: { projectId: project.id, tenantId: ctx.tenantId, lastValue: 1 },
        update: { lastValue: { increment: 1 } },
        select: { lastValue: true },
      });
      const item = await tx.workItem.create({
        data: {
          tenantId: ctx.tenantId,
          projectId: project.id,
          itemKey: `${project.key}-${String(counter.lastValue)}`,
          issueTypeId: issueType.issueTypeId,
          statusId: statusIds.get(row.status) as bigint,
          ...(row.priority === null ? {} : { priorityId: priorityIds.get(row.priority) }),
          reporterId: userIds.get(row.reporterEmail) as bigint,
          summary: row.summary,
          // เรียงตามลำดับในไฟล์ — ของที่ย้ายมาควรอยู่ท้าย backlog ตามลำดับเดิม
          rank: `zzi${String(counter.lastValue).padStart(9, '0')}`,
        },
        select: { id: true },
      });
      await tx.importRecord.create({
        data: {
          tenantId: ctx.tenantId,
          source: IMPORT_SOURCE,
          externalKey: row.externalKey,
          workItemId: item.id,
          importedById: actorId,
          importedAt: now,
        },
      });
      created += 1;
    }

    return {
      result: { created, skipped, problems: [] as ImportProblem[] },
      audit: [
        {
          kind: 'system' as const,
          action: 'import.run',
          entityType: 'project',
          entityId: project.id.toString(),
          payload: { source: IMPORT_SOURCE, created, skipped },
        },
      ],
    };
  });
}
