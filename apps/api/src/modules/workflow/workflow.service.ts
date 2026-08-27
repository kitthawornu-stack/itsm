/**
 * Workflow Service — ต่อ engine เข้ากับฐานข้อมูล
 *
 * หน้าที่: โหลดนิยาม transition, ประกอบ context, เรียก engine, แล้วเปลี่ยนสถานะจริง
 * **ทุกการเปลี่ยนสถานะเขียน work_item_history ในทรานแซกชันเดียวกัน** (INVARIANT 2)
 * ซึ่งบังคับโดย `auditedTransaction` — ถ้าไม่คืน AuditEntry ฟังก์ชันจะโยน error
 */
import { systemClock, type TenantContext } from '@itsm/types';

import { auditedTransaction, change, type AuditEntry } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { recomputeSla, recordSlaEvent } from '../sla';
import {
  evaluateTransitions,
  requiredFieldsFor,
  validateTransition,
  type TransitionContext,
  type TransitionDefinition,
  type TransitionRule,
} from './workflow-engine';

/**
 * ⚠️ โมดูล `workitem` มีคลาสชื่อเดียวกัน — คนละคลาสจริง ๆ
 * `instanceof` ข้ามโมดูลจะไม่ตรง ต้องดักของโมดูลที่เรียกใช้เท่านั้น
 */
export class WorkItemNotFoundError extends Error {
  constructor(workItemId: bigint) {
    super(`ไม่พบงาน #${workItemId.toString()} ในขอบเขตของ tenant นี้`);
    this.name = 'WorkItemNotFoundError';
  }
}

export class UnknownResolutionError extends Error {
  constructor(readonly given: string) {
    super(`ไม่รู้จักผลการแก้ไข "${given}"`);
    this.name = 'UnknownResolutionError';
  }
}

export class NoWorkflowError extends Error {
  constructor(projectKey: string, issueType: string) {
    super(
      `โปรเจกต์ ${projectKey} ยังไม่ได้ผูก workflow กับประเภทงาน "${issueType}" — ` +
        `ตั้งค่าได้ที่ Workflow Scheme ของโปรเจกต์`,
    );
    this.name = 'NoWorkflowError';
  }
}

interface LoadedWorkItem {
  id: bigint;
  itemKey: string;
  projectId: bigint;
  projectKey: string;
  issueTypeId: bigint;
  issueTypeName: string;
  statusId: bigint;
  statusName: string;
  assigneeId: bigint | null;
  resolutionId: number | null;
  resolutionName: string | null;
  fieldSnapshot: Record<string, unknown>;
}

async function loadWorkItem(ctx: TenantContext, workItemId: bigint): Promise<LoadedWorkItem> {
  const db = tenantScoped(ctx);
  const item = await db.workItem.findUnique({
    where: { id: workItemId },
    include: { project: true, issueType: true, status: true, resolution: true },
  });
  if (item === null) throw new WorkItemNotFoundError(workItemId);

  return {
    id: item.id,
    itemKey: item.itemKey,
    projectId: item.projectId,
    projectKey: item.project.key,
    issueTypeId: item.issueTypeId,
    issueTypeName: item.issueType.name,
    statusId: item.statusId,
    statusName: item.status.name,
    assigneeId: item.assigneeId,
    resolutionId: item.resolutionId,
    resolutionName: item.resolution?.name ?? null,
    fieldSnapshot:
      item.fieldSnapshot !== null && typeof item.fieldSnapshot === 'object'
        ? (item.fieldSnapshot as Record<string, unknown>)
        : {},
  };
}

async function loadTransitions(
  ctx: TenantContext,
  item: LoadedWorkItem,
): Promise<TransitionDefinition[]> {
  const db = tenantScoped(ctx);
  const scheme = await db.workflowScheme.findFirst({
    where: { projectId: item.projectId, issueTypeId: item.issueTypeId },
  });
  if (scheme === null) throw new NoWorkflowError(item.projectKey, item.issueTypeName);

  const rows = await db.workflowTransition.findMany({
    where: { workflowId: scheme.workflowId },
    include: { rules: true },
  });

  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    fromStatusId: t.fromStatusId,
    toStatusId: t.toStatusId,
    position: t.position,
    rules: t.rules.map(
      (r): TransitionRule => ({
        kind: r.kind,
        ruleType: r.ruleType,
        config: (r.config !== null && typeof r.config === 'object'
          ? r.config
          : {}) as Record<string, unknown>,
        position: r.position,
      }),
    ),
  }));
}

/**
 * @param submitted ค่าที่ผู้ใช้กรอกมา **พร้อมกับการกดปุ่ม** ทับค่าที่เก็บอยู่
 *
 * ถ้าไม่ทับ validator `required-fields: ['resolution']` จะอ่านค่าเดิมซึ่งยังว่าง
 * แล้วปฏิเสธการปิดงานที่ผู้ใช้เพิ่งเลือกผลการแก้ไขมาให้เรียบร้อย — ระบบจะขอ
 * สิ่งที่ได้รับมาแล้ว ซึ่งเป็นทางตันที่ผู้ใช้ออกเองไม่ได้
 */
async function buildContext(
  ctx: TenantContext,
  item: LoadedWorkItem,
  actorId: bigint,
  submitted: Record<string, unknown> = {},
): Promise<TransitionContext> {
  const db = tenantScoped(ctx);
  const memberships = await db.groupMember.findMany({
    where: { userId: actorId },
    select: { groupId: true },
  });

  return {
    currentUserId: actorId,
    currentStatusId: item.statusId,
    assigneeId: item.assigneeId,
    userGroupIds: memberships.map((m) => m.groupId),
    fields: {
      ...item.fieldSnapshot,
      // built-in field ที่ validator อ้างถึงได้เหมือน custom field
      resolution: item.resolutionName,
      assignee: item.assigneeId,
      ...submitted,
    },
  };
}

/**
 * ชื่อผลการแก้ไข → แถวจริง · คืน null เมื่อไม่ได้ส่งอะไรมา
 * ชื่อที่ไม่รู้จักโยน error ไม่ใช่คืน null — สองอย่างนี้ต่างกันคนละเรื่อง
 */
async function resolveResolution(
  ctx: TenantContext,
  name: string | null | undefined,
): Promise<{ id: number; name: string } | null> {
  if (name === undefined || name === null) return null;
  const trimmed = name.trim();
  if (trimmed === '') return null;
  const row = await tenantScoped(ctx).resolution.findFirst({
    where: { name: trimmed },
    select: { id: true, name: true },
  });
  if (row === null) throw new UnknownResolutionError(trimmed);
  return row;
}

/** ผลการแก้ไขทั้งหมดของ tenant — ใช้เติมตัวเลือกตอนปิดงาน */
export async function listResolutions(ctx: TenantContext): Promise<string[]> {
  const rows = await tenantScoped(ctx).resolution.findMany({
    orderBy: { id: 'asc' },
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

/** transition ที่ผู้ใช้ควรเห็นปุ่มบนงานใบนี้ */
export async function availableTransitions(
  ctx: TenantContext,
  workItemId: bigint,
  actorId: bigint,
): Promise<Array<{ id: bigint; name: string; toStatusId: bigint; requiredFields: string[] }>> {
  const item = await loadWorkItem(ctx, workItemId);
  const [transitions, tctx] = await Promise.all([
    loadTransitions(ctx, item),
    buildContext(ctx, item, actorId),
  ]);
  return evaluateTransitions(transitions, tctx).map((t) => ({
    id: t.id,
    name: t.name,
    toStatusId: t.toStatusId,
    // หน้าจอถามฟิลด์เหล่านี้ก่อนกด แทนที่จะให้กดแล้วเจอ 422
    requiredFields: requiredFieldsFor(t),
  }));
}

export interface TransitionInput {
  /** ผลการแก้ไขที่ผู้ใช้เลือกตอนกดปุ่ม — ใช้ชื่อ ไม่ใช่ id เพราะหน้าจอเห็นแต่ชื่อ */
  resolutionName?: string | null;
}

export interface TransitionResult {
  workItemId: bigint;
  fromStatusId: bigint;
  toStatusId: bigint;
  appliedPostFunctions: string[];
}

/**
 * เปลี่ยนสถานะงานตาม transition ที่ระบุ
 *
 * ทุกอย่างเกิดในทรานแซกชันเดียว: อัปเดตสถานะ → รัน post function → เขียนประวัติ
 * ถ้าขั้นใดล้ม ทั้งหมดถูกย้อนกลับ และจะไม่มีประวัติที่ชี้ไปสถานะที่ไม่เคยเกิดขึ้นจริง
 */
export async function applyTransition(
  ctx: TenantContext,
  workItemId: bigint,
  transitionId: bigint,
  actorId: bigint,
  input: TransitionInput = {},
): Promise<TransitionResult> {
  const item = await loadWorkItem(ctx, workItemId);
  const transitions = await loadTransitions(ctx, item);

  // แปลงชื่อผลการแก้ไขเป็นแถวจริงก่อนตรวจอะไรทั้งสิ้น
  // ชื่อที่ไม่มีในระบบต้องถูกปฏิเสธ ไม่ใช่ถูกมองข้ามจนงานปิดโดยไม่มีผลการแก้ไข
  const submittedResolution = await resolveResolution(ctx, input.resolutionName);
  const tctx = await buildContext(
    ctx,
    item,
    actorId,
    submittedResolution === null ? {} : { resolution: submittedResolution.name },
  );

  const definition = transitions.find((t) => t.id === transitionId);
  if (definition === undefined) {
    throw new WorkItemNotFoundError(workItemId);
  }

  // engine ตรวจครบสามชั้นและคืน post function ที่ต้องรัน
  const outcome = validateTransition(definition, tctx);

  const [toStatus, fromStatus] = await Promise.all([
    tenantScoped(ctx).workflowStatus.findUnique({ where: { id: outcome.toStatusId } }),
    tenantScoped(ctx).workflowStatus.findUnique({ where: { id: item.statusId } }),
  ]);
  if (toStatus === null) throw new WorkItemNotFoundError(workItemId);

  /**
   * ผลการแก้ไขที่จะบันทึก — ตัดสินก่อนเปิดทรานแซกชัน
   *
   * ค่าที่ workflow กำหนดตายตัวมาก่อนค่าที่ผู้ใช้เลือก: ปุ่ม "ยกเลิกเรื่องนี้"
   * ต้องได้ผลว่ายกเลิกเสมอ ไม่ว่าหน้าจอจะส่งอะไรมาก็ตาม
   */
  const fixed = outcome.postFunctions.find((f) => f.ruleType === 'set-resolution');
  const fixedName =
    typeof fixed?.config['resolution'] === 'string' ? fixed.config['resolution'] : null;
  const chosenResolution =
    fixedName === null ? submittedResolution : await resolveResolution(ctx, fixedName);

  const result = await auditedTransaction(
    { ...ctx, actorId },
    `workflow.transition:${definition.name}`,
    async (tx) => {
      const audit: AuditEntry[] = [
        // บันทึกทั้งการเปลี่ยนสถานะและตัว transition ที่ใช้ —
        // ไทม์ไลน์ต้องตอบได้ว่า "ผ่านปุ่มไหน" ไม่ใช่แค่ "สถานะเปลี่ยนจากอะไรเป็นอะไร"
        change(item.id, 'status', item.statusName, toStatus.name),
        change(item.id, '__transition__', null, definition.name),
      ];

      const applied: string[] = [];
      const data: Record<string, unknown> = { statusId: outcome.toStatusId };

      /**
       * ---------- ผลการแก้ไข ----------
       *
       * งานที่ไม่ได้อยู่ในหมวด DONE **ต้องไม่มีผลการแก้ไข** และข้อนี้ไม่ใช่
       * ตัวเลือกที่แอดมินตั้งได้ แต่เป็นความจริงของข้อมูล — คำว่า "แก้ไขแล้ว"
       * บนงานที่กำลังดำเนินการอยู่ ตอบคำถามผิดให้ทุกคนที่อ่าน และทำให้ตัวกรอง
       * "งานที่ยังไม่จบ" ตกงานใบนั้นไปเงียบ ๆ
       *
       * Jira ให้ตั้งการล้างค่าเป็น post function ที่แอดมินต้องเพิ่มเอง
       * ผลคือทีมจำนวนมากมีงานที่เปิดใหม่แล้วแต่ยังติดป้ายว่าแก้ไขแล้วค้างอยู่
       * ที่นี่จึงบังคับไว้ในโค้ด ไม่ใช่ฝากไว้กับคนที่ตั้งค่า
       */
      if (toStatus.category === 'DONE') {
        if (chosenResolution !== null && chosenResolution.id !== item.resolutionId) {
          data['resolutionId'] = chosenResolution.id;
          audit.push(change(item.id, 'resolution', item.resolutionName, chosenResolution.name));
        }
      } else {
        if (item.resolutionId !== null) {
          data['resolutionId'] = null;
          audit.push(change(item.id, 'resolution', item.resolutionName, null));
        }
        if (fromStatus?.category === 'DONE') {
          // resolvedAt เป็นฐานของ MTTR — งานที่กลับมาเปิดใหม่ยังไม่เสร็จ
          // ถ้าปล่อยค่าเดิมไว้ รายงานจะนับว่ามันเสร็จตั้งแต่รอบก่อน
          data['resolvedAt'] = null;
          audit.push(change(item.id, 'resolvedAt', 'set', null));
        }
      }

      for (const fn of outcome.postFunctions) {
        switch (fn.ruleType) {
          case 'assign-to-current-user':
            data['assigneeId'] = actorId;
            audit.push(change(item.id, 'assignee', item.assigneeId, actorId));
            break;
          case 'clear-assignee':
            data['assigneeId'] = null;
            audit.push(change(item.id, 'assignee', item.assigneeId, null));
            break;
          case 'stop-sla':
            // สถานะ DONE ตั้ง resolvedAt ซึ่งเป็นฐานของ MTTR ทุกรายงาน
            if (toStatus.category === 'DONE') {
              // clock.nowUtc() ไม่ใช่ new Date() — INVARIANT 6
              // resolvedAt เป็นฐานของ MTTR ทุกรายงาน ถ้าเป็นเวลาท้องถิ่นจะเพี้ยนทั้งระบบ
              data['resolvedAt'] = systemClock.nowUtc();
              audit.push(change(item.id, 'resolvedAt', null, 'set'));
            }
            break;
          case 'set-resolution':
            // จัดการไปแล้วข้างบน ก่อนวนลูปนี้ — ต้องอยู่นอกลูปเพราะการล้างค่า
            // ตอนออกจากหมวด DONE เกิดขึ้นแม้ transition นั้นไม่มี post function เลย
            break;
          default:
            // start-sla / pause-sla / notify / fire-webhook
            // จะทำงานเมื่อ Notification module ต่อครบ — ตอนนี้บันทึกว่าถูกเรียก
            break;
        }
        applied.push(fn.ruleType);
      }

      await tx.workItem.update({ where: { id: item.id }, data: data as never });

      return {
        result: {
          workItemId: item.id,
          fromStatusId: item.statusId,
          toStatusId: outcome.toStatusId,
          appliedPostFunctions: applied,
        },
        audit,
      };
    },
  );

  // นาฬิกา SLA ตามสถานะใหม่ — ทำ **หลัง** ทรานแซกชันสำเร็จ
  //
  // เหตุผลที่ไม่รวมในทรานแซกชันเดียวกัน: การคำนวณ SLA อ่านปฏิทินและเหตุการณ์
  // ทั้งหมด ถ้าอยู่ในทรานแซกชันจะถือล็อกบนแถว work_item นานเกินจำเป็น
  // ผลที่ยอมรับได้: ถ้าขั้นนี้ล้ม สถานะเปลี่ยนแล้วแต่นาฬิกายังไม่อัปเดต
  // ซึ่งแก้ได้ด้วย recomputeSla() และไม่ทำให้ข้อมูลผิดถาวร
  const now = systemClock.nowUtc();
  if (toStatus.category === 'DONE') {
    await recordSlaEvent(ctx, item.id, 'stop', now);
  } else if (toStatus.pausesSla && fromStatus?.pausesSla !== true) {
    await recordSlaEvent(ctx, item.id, 'pause', now);
  } else if (!toStatus.pausesSla && fromStatus?.pausesSla === true) {
    await recordSlaEvent(ctx, item.id, 'resume', now);
  } else {
    // transition ที่ไม่กระทบการพัก/เดินของนาฬิกา **ก็ยังต้องคำนวณใหม่**
    //
    // เวอร์ชันแรกข้ามกรณีนี้ไป ผลคือนาฬิกาที่เพิ่งเริ่ม (New -> Investigating)
    // ไม่เคยตั้งงานแจ้งเตือนเลย เพราะงานถูกตั้งตอน recomputeSla เท่านั้น
    // และ recomputeSla ถูกเรียกเฉพาะตอนมีเหตุการณ์พัก/เดินต่อ/ปิด
    await recomputeSla(ctx, item.id, now);
  }

  return result;
}
