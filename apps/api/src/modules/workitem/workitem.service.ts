/**
 * สร้างงานใหม่
 *
 * ก่อนหน้านี้ระบบดูงานได้อย่างเดียว ข้อมูลทั้งหมดมาจาก seed
 * ซึ่งแปลว่ายังนำไปใช้จริงไม่ได้เลย — ไม่มีใครแจ้งปัญหาเข้ามาได้
 *
 * งานหนึ่งใบเกิดขึ้นได้ต้องมีของครบห้าอย่าง และทุกอย่างมาจาก **โปรเจกต์**
 * ไม่ใช่จากชนิดของงาน (Single Work Item Model · CLAUDE.md §3):
 *   1. คีย์ที่มนุษย์อ่าน   จากตัวนับของโปรเจกต์
 *   2. สถานะเริ่มต้น       จาก workflow ที่ผูกกับ (โปรเจกต์, ชนิดงาน)
 *   3. rank                LexoRank ต่อท้ายของเดิม (ADR-002)
 *   4. นาฬิกา SLA         เริ่มนับทันที ไม่ใช่ตอน transition แรก
 *   5. ดัชนีค้นหา          OpenSearch เป็นแหล่งค้นหาเดียว (ADR-005)
 *
 * ข้อ 4 และ 5 อยู่ **นอก** ทรานแซกชันโดยเจตนา — ดูเหตุผลที่ `createWorkItem`
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';
import { between } from '@itsm/lexorank';

import {
  auditedTransaction,
  change,
  type AuditEntry,
} from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan } from '../permission';
import { indexWorkItem } from '../search-index';
import { startSlaFor } from '../sla';

/**
 * งานที่อ้างถึงไม่มีอยู่ (หรืออยู่คนละ tenant ซึ่งแยกไม่ออกโดยตั้งใจ)
 *
 * ⚠️ โมดูล `workflow` มีคลาสชื่อเดียวกันของตัวเอง เพราะโมดูลคุยกันผ่าน
 * `index.ts` เท่านั้น (ADR-004) จึงแชร์คลาสข้ามโมดูลไม่ได้
 * ผลคือ `instanceof` ข้ามโมดูล **จะไม่ตรง** — ผู้เรียกต้องดักของโมดูลที่ตัวเองเรียก
 * ไม่ใช่คิดว่าดักตัวเดียวแล้วครอบทั้งสองที่
 */
export class WorkItemNotFoundError extends Error {
  constructor(keyOrId: string | bigint) {
    super(`ไม่พบงาน ${keyOrId.toString()}`);
    this.name = 'WorkItemNotFoundError';
  }
}

export class ProjectNotFoundError extends Error {
  constructor(key: string) {
    super(`ไม่พบโปรเจกต์ ${key}`);
    this.name = 'ProjectNotFoundError';
  }
}

export class IssueTypeNotConfiguredError extends Error {
  constructor(projectKey: string, issueType: string) {
    super(`โปรเจกต์ ${projectKey} ยังไม่ได้ตั้งค่า workflow สำหรับงานชนิด "${issueType}"`);
    this.name = 'IssueTypeNotConfiguredError';
  }
}

export class NoInitialStatusError extends Error {
  constructor(workflowId: bigint) {
    // workflow ที่ไม่มีสถานะเริ่มต้นคือ workflow ที่สร้างงานไม่ได้เลย
    // ต้องดังตอนสร้าง ไม่ใช่ปล่อยให้งานไปอยู่ในสถานะที่เดาเอา
    super(`workflow ${workflowId.toString()} ไม่มีสถานะเริ่มต้น (isInitial)`);
    this.name = 'NoInitialStatusError';
  }
}

export class SummaryRequiredError extends Error {
  constructor() {
    super('ต้องระบุหัวข้อของงาน');
    this.name = 'SummaryRequiredError';
  }
}

/** ยาวสุดของ `work_item.summary` ตามสคีมา */
export const SUMMARY_MAX = 500;

export interface CreateWorkItemInput {
  projectKey: string;
  issueTypeName: string;
  summary: string;
  /**
   * คำอธิบายแบบข้อความล้วน
   *
   * เก็บเป็น `{ format: 'text', text }` เพราะรูปแบบ rich text ยังไม่ได้ตัดสิน
   * การใส่ `format` ไว้ตั้งแต่ต้นทำให้เพิ่มรูปแบบใหม่ทีหลังได้โดยไม่ต้องเดา
   * ว่าค่าที่อยู่ในฐานข้อมูลเป็นแบบไหน
   */
  description?: string;
  priorityRank?: number;
  assigneeId?: bigint;
  /**
   * แจ้งผ่านรายการบริการไหน — ไม่ส่ง = พิมพ์อิสระ
   *
   * ผู้เรียกต้องยืนยันมาแล้วว่าผู้ใช้เปิดดูบริการนี้ได้ (`catalogItemForReport`)
   * ที่นี่แค่บันทึก — **ต้องบันทึกตอนสร้างเท่านั้น** เพราะย้อนกลับไปเติมทีหลังไม่ได้
   */
  catalogItemId?: bigint;
}

export interface CreatedWorkItem {
  id: bigint;
  itemKey: string;
  statusName: string;
}

export async function createWorkItem(
  ctx: TenantContext,
  input: CreateWorkItemInput,
  now: UtcDate = systemClock.nowUtc(),
): Promise<CreatedWorkItem> {
  const summary = input.summary.trim();
  if (summary.length === 0) throw new SummaryRequiredError();
  if (ctx.actorId === null) throw new Error('createWorkItem ต้องมีผู้แจ้ง (actorId)');
  const reporterId = ctx.actorId;

  const db = tenantScoped(ctx);
  const project = await db.project.findFirst({
    where: { key: input.projectKey },
    select: { id: true, key: true },
  });
  if (project === null) throw new ProjectNotFoundError(input.projectKey);

  // ตรวจสิทธิ์ที่ชั้น service ไม่ใช่ที่ controller — บริการนี้ถูกเรียกจากที่อื่นได้อีก
  // (คิวอีเมลขาเข้า, automation) และทุกทางต้องผ่านด่านเดียวกัน
  await assertCan(ctx, project.id, 'CREATE_ITEM');

  const issueType = await db.issueType.findFirst({
    where: { name: input.issueTypeName },
    select: { id: true },
  });
  const scheme =
    issueType === null
      ? null
      : await db.workflowScheme.findFirst({
          where: { projectId: project.id, issueTypeId: issueType.id },
          select: { workflowId: true },
        });
  if (issueType === null || scheme === null) {
    throw new IssueTypeNotConfiguredError(project.key, input.issueTypeName);
  }

  const initial = await db.workflowStatus.findFirst({
    where: { workflowId: scheme.workflowId, isInitial: true },
    select: { id: true, name: true },
  });
  if (initial === null) throw new NoInitialStatusError(scheme.workflowId);

  const priority =
    input.priorityRank === undefined
      ? null
      : await db.priority.findFirst({ where: { rank: input.priorityRank }, select: { id: true } });

  const created = await auditedTransaction(ctx, 'workitem.create', async (tx) => {
    /**
     * คีย์ต้องออกทีละใบไม่ซ้ำกัน แม้มีคนกดพร้อมกัน
     *
     * `increment` แปลเป็น `UPDATE … SET last_value = last_value + 1` ซึ่ง MySQL
     * ล็อกแถวไว้จนจบทรานแซกชัน คนที่มาทีหลังจึงรอ ไม่ใช่อ่านค่าเดิมไปใช้ซ้ำ
     * การอ่านมาบวกในโค้ดแล้วเขียนกลับจะซ้ำได้ทันทีที่มีสองคนพร้อมกัน
     *
     * unique index บน (tenantId, itemKey) เป็นด่านสุดท้าย
     */
    const counter = await tx.projectCounter.upsert({
      where: { projectId: project.id },
      create: { projectId: project.id, tenantId: ctx.tenantId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
      select: { lastValue: true },
    });
    const itemKey = `${project.key}-${String(counter.lastValue)}`;

    // ต่อท้ายรายการเดิมของโปรเจกต์ — งานใหม่ไปอยู่ล่างสุดของ backlog
    const last = await tx.workItem.findFirst({
      where: { projectId: project.id },
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });

    const row = await tx.workItem.create({
      data: {
        tenantId: ctx.tenantId,
        itemKey,
        projectId: project.id,
        issueTypeId: issueType.id,
        summary: summary.slice(0, SUMMARY_MAX),
        description:
          input.description === undefined || input.description.trim().length === 0
            ? undefined
            : { format: 'text', text: input.description.trim() },
        statusId: initial.id,
        priorityId: priority?.id ?? null,
        reporterId,
        assigneeId: input.assigneeId ?? null,
        catalogItemId: input.catalogItemId ?? null,
        rank: between(last?.rank ?? null, null),
        fieldSnapshot: {},
      },
      select: { id: true, itemKey: true },
    });

    const audit: AuditEntry[] = [
      change(row.id, '__created__', null, itemKey),
      change(row.id, 'summary', null, summary),
      change(row.id, 'status', null, initial.name),
    ];
    if (input.assigneeId !== undefined) {
      audit.push(change(row.id, 'assignee', null, input.assigneeId));
    }
    /*
      บันทึกในประวัติด้วย ไม่ใช่แค่ในคอลัมน์

      คอลัมน์ตอบได้ว่า "ตอนนี้ผูกกับบริการไหน" · ประวัติตอบได้ว่า
      "ตอนแจ้งเลือกอะไร" ซึ่งเป็นคนละคำถาม และเป็นคำถามที่รายงานต้องใช้
      แม้ภายหลังบริการนั้นจะถูกลบจนคอลัมน์กลายเป็น null
    */
    if (input.catalogItemId !== undefined) {
      audit.push(change(row.id, 'catalogItem', null, input.catalogItemId.toString()));
    }

    return { result: { id: row.id, itemKey: row.itemKey, statusName: initial.name }, audit };
  });

  /**
   * นาฬิกาและดัชนีอยู่นอกทรานแซกชันโดยเจตนา
   *
   * ทั้งคู่แตะระบบภายนอก (Redis ผ่านตัวจัดคิว · OpenSearch) การเอาเข้าไปในทรานแซกชัน
   * แปลว่าปลายทางที่ล่มจะทำให้ **สร้างงานไม่ได้เลย** ซึ่งแย่กว่าการมีงานที่ยังไม่ถูกจัดดัชนี
   *
   * ตัวกวาดของ worker กู้นาฬิกาที่ตกหล่นได้ และ `reindex` สร้างดัชนีใหม่จาก MySQL ได้เสมอ
   * — ฐานข้อมูลคือแหล่งความจริง อย่างอื่นสร้างใหม่ได้หมด
   */
  await startSlaFor(ctx, created.id, now);

  try {
    await indexWorkItem(ctx, created.id);
  } catch (err) {
    // ค้นหาไม่เจอชั่วคราวยอมรับได้ · สร้างงานไม่ได้ยอมรับไม่ได้
    console.error(
      `[workitem] จัดดัชนี ${created.itemKey} ไม่สำเร็จ:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return created;
}
