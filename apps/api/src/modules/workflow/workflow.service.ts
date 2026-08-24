/**
 * Workflow Service — ต่อ engine เข้ากับฐานข้อมูล
 *
 * หน้าที่: โหลดนิยาม transition, ประกอบ context, เรียก engine, แล้วเปลี่ยนสถานะจริง
 * **ทุกการเปลี่ยนสถานะเขียน work_item_history ในทรานแซกชันเดียวกัน** (INVARIANT 2)
 * ซึ่งบังคับโดย `auditedTransaction` — ถ้าไม่คืน AuditEntry ฟังก์ชันจะโยน error
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction, change, type AuditEntry } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import {
  evaluateTransitions,
  validateTransition,
  type TransitionContext,
  type TransitionDefinition,
  type TransitionRule,
} from './workflow-engine';

export class WorkItemNotFoundError extends Error {
  constructor(workItemId: bigint) {
    super(`ไม่พบงาน #${workItemId.toString()} ในขอบเขตของ tenant นี้`);
    this.name = 'WorkItemNotFoundError';
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

async function buildContext(
  ctx: TenantContext,
  item: LoadedWorkItem,
  actorId: bigint,
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
    },
  };
}

/** transition ที่ผู้ใช้ควรเห็นปุ่มบนงานใบนี้ */
export async function availableTransitions(
  ctx: TenantContext,
  workItemId: bigint,
  actorId: bigint,
): Promise<Array<{ id: bigint; name: string; toStatusId: bigint }>> {
  const item = await loadWorkItem(ctx, workItemId);
  const [transitions, tctx] = await Promise.all([
    loadTransitions(ctx, item),
    buildContext(ctx, item, actorId),
  ]);
  return evaluateTransitions(transitions, tctx).map((t) => ({
    id: t.id,
    name: t.name,
    toStatusId: t.toStatusId,
  }));
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
): Promise<TransitionResult> {
  const item = await loadWorkItem(ctx, workItemId);
  const transitions = await loadTransitions(ctx, item);
  const tctx = await buildContext(ctx, item, actorId);

  const definition = transitions.find((t) => t.id === transitionId);
  if (definition === undefined) {
    throw new WorkItemNotFoundError(workItemId);
  }

  // engine ตรวจครบสามชั้นและคืน post function ที่ต้องรัน
  const outcome = validateTransition(definition, tctx);

  const toStatus = await tenantScoped(ctx).workflowStatus.findUnique({
    where: { id: outcome.toStatusId },
  });
  if (toStatus === null) throw new WorkItemNotFoundError(workItemId);

  return auditedTransaction(
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
              data['resolvedAt'] = new Date();
              audit.push(change(item.id, 'resolvedAt', null, 'set'));
            }
            break;
          default:
            // start-sla / pause-sla / notify / fire-webhook / set-resolution
            // จะทำงานเมื่อ SLA และ Notification module พร้อม — ตอนนี้บันทึกว่าถูกเรียก
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
}
