/**
 * Work Item REST API — v1
 *
 * หลักคิดข้อ 5 (API-first): หน้าเว็บของเราคือลูกค้ารายแรกของ API ตัวเอง
 * ไม่มี endpoint ลับที่หน้าเว็บเรียกได้คนเดียว
 *
 * ⚠️ ยังไม่มีการยืนยันตัวตน — ใช้ resolveDevTenantContext ซึ่งโยน error
 * เมื่อรันบน production ดู ADR-003
 */
import { Controller, Get, HttpException, HttpStatus, Param, Post, Query } from '@nestjs/common';

/* eslint-disable @typescript-eslint/no-deprecated -- resolveDevTenantContext ถูกทำเครื่องหมาย deprecated โดยตั้งใจ
   เพื่อให้ทุกจุดที่ใช้มองเห็นได้ในทันทีเมื่อโมดูล identity พร้อม (ADR-003) จุดเหล่านี้คือรายการที่ต้องลบ */
import { resolveDevTenantContext } from '../../infrastructure/http/dev-tenant.guard';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { SearchIndexNotReadyError, searchWorkItems } from '../search-index';
import {
  TransitionNotAllowedError,
  ValidationFailedError,
  applyTransition,
  availableTransitions,
} from '../workflow';

export interface WorkItemListRow {
  id: string;
  itemKey: string;
  summary: string;
  status: { name: string; category: string; pausesSla: boolean };
  priority: { rank: number; name: string } | null;
  assignee: { name: string } | null;
  updatedAt: string;
  resolvedAt: string | null;
}

@Controller('work-items')
export class WorkItemController {
  @Get()
  async list(
    @Query('project') projectKey?: string,
    @Query('q') q?: string,
    @Query('open') openOnly?: string,
    @Query('limit') limit?: string,
  ): Promise<{ rows: WorkItemListRow[]; total: number }> {
    const ctx = await resolveDevTenantContext();
    const db = tenantScoped(ctx);
    const take = Math.min(Number(limit ?? 50) || 50, 200);

    const project =
      projectKey === undefined
        ? null
        : await db.project.findFirst({ where: { key: projectKey }, select: { id: true } });

    // เมื่อมีคำค้น ให้ OpenSearch คัดก่อน แล้วดึงรายละเอียดจาก MySQL
    // MySQL เป็นแหล่งความจริงเสมอ — OpenSearch คืนแค่ลำดับและ key
    let keyFilter: string[] | undefined;
    if (q !== undefined && q.trim().length > 0) {
      try {
        const hits = await searchWorkItems(ctx, q, {
          ...(project === null ? {} : { projectIds: [project.id] }),
          size: take,
        });
        keyFilter = hits.map((h) => h.itemKey);
      } catch (e) {
        if (e instanceof SearchIndexNotReadyError) {
          // 503 ไม่ใช่ 500 — เป็นปัญหาชั่วคราวของระบบ ไม่ใช่ความผิดของคำขอ
          // และไม่ใช่ 200 พร้อมผลว่าง ซึ่งจะหลอกผู้ใช้ว่าไม่มีข้อมูล
          throw new HttpException(
            { error: 'search_index_not_ready', message: 'ระบบค้นหายังไม่พร้อมใช้งาน กรุณาแจ้งผู้ดูแลระบบ' },
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
        throw e;
      }
      if (keyFilter.length === 0) return { rows: [], total: 0 };
    }

    const where = {
      ...(project === null ? {} : { projectId: project.id }),
      ...(openOnly === 'true' ? { resolvedAt: null } : {}),
      ...(keyFilter === undefined ? {} : { itemKey: { in: keyFilter } }),
    };

    const [rows, total] = await Promise.all([
      db.workItem.findMany({
        where,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          status: { select: { name: true, category: true, pausesSla: true } },
          priority: { select: { rank: true, name: true } },
          assignee: { select: { displayName: true } },
        },
      }),
      db.workItem.count({ where }),
    ]);

    return {
      total,
      rows: rows.map((w) => ({
        id: w.id.toString(),
        itemKey: w.itemKey,
        summary: w.summary,
        status: {
          name: w.status.name,
          category: w.status.category,
          pausesSla: w.status.pausesSla,
        },
        priority: w.priority === null ? null : { rank: w.priority.rank, name: w.priority.name },
        assignee: w.assignee === null ? null : { name: w.assignee.displayName },
        updatedAt: w.updatedAt.toISOString(),
        resolvedAt: w.resolvedAt?.toISOString() ?? null,
      })),
    };
  }

  @Get(':key')
  async detail(@Param('key') key: string): Promise<unknown> {
    const ctx = await resolveDevTenantContext();
    const db = tenantScoped(ctx);
    const item = await db.workItem.findFirst({
      where: { itemKey: key },
      include: {
        status: true,
        priority: true,
        issueType: true,
        project: true,
        assignee: { select: { displayName: true } },
        reporter: { select: { displayName: true } },
      },
    });
    if (item === null) return { error: `ไม่พบงาน ${key}` };

    const [transitions, history] = await Promise.all([
      ctx.actorId === null ? Promise.resolve([]) : availableTransitions(ctx, item.id, ctx.actorId),
      db.workItemHistory.findMany({
        where: { workItemId: item.id },
        orderBy: { id: 'desc' },
        take: 20,
        include: { actor: { select: { displayName: true } } },
      }),
    ]);

    return {
      id: item.id.toString(),
      itemKey: item.itemKey,
      summary: item.summary,
      projectKey: item.project.key,
      issueType: item.issueType.name,
      status: { name: item.status.name, category: item.status.category },
      priority: item.priority === null ? null : { rank: item.priority.rank, name: item.priority.name },
      assignee: item.assignee?.displayName ?? null,
      reporter: item.reporter.displayName,
      fieldSnapshot: item.fieldSnapshot,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      // ปุ่มที่ผู้ใช้คนนี้เห็นได้จริง — ผ่าน CONDITION ชั้นแรกของ workflow engine แล้ว
      transitions: transitions.map((t) => ({ id: t.id.toString(), name: t.name })),
      history: history.map((h) => ({
        id: h.id.toString(),
        field: h.field,
        oldValue: h.oldValue,
        newValue: h.newValue,
        actor: h.actor?.displayName ?? 'ระบบ',
        createdAt: h.createdAt.toISOString(),
      })),
    };
  }

  /**
   * กด transition — ทางเข้าเดียวที่เปลี่ยนสถานะงานได้
   *
   * ทุกกรณีล้มเหลวมีรหัสสถานะและข้อความของตัวเอง ไม่รวมเป็น 500 ก้อนเดียว
   * เพราะหน้าจอต้องบอกผู้ใช้ได้ว่าต้องทำอะไรต่อ ไม่ใช่แค่ว่า "ผิดพลาด"
   */
  @Post(':key/transitions/:transitionId')
  async transition(
    @Param('key') key: string,
    @Param('transitionId') transitionId: string,
  ): Promise<unknown> {
    const ctx = await resolveDevTenantContext();
    if (ctx.actorId === null) {
      throw new HttpException({ message: 'ไม่พบผู้ใช้สำหรับดำเนินการ' }, HttpStatus.FORBIDDEN);
    }
    const db = tenantScoped(ctx);
    const item = await db.workItem.findFirst({ where: { itemKey: key }, select: { id: true } });
    if (item === null) {
      throw new HttpException({ message: `ไม่พบงาน ${key}` }, HttpStatus.NOT_FOUND);
    }

    try {
      const result = await applyTransition(ctx, item.id, BigInt(transitionId), ctx.actorId);
      const status = await db.workflowStatus.findFirst({
        where: { id: result.toStatusId },
        select: { name: true, category: true },
      });
      return {
        ok: true,
        itemKey: key,
        newStatus: status?.name ?? null,
        appliedPostFunctions: result.appliedPostFunctions,
      };
    } catch (e) {
      if (e instanceof ValidationFailedError) {
        // 422 — คำขอถูกต้องตามรูปแบบ แต่ข้อมูลยังไม่ครบ · บอกชื่อฟิลด์ที่ขาด
        throw new HttpException(
          {
            error: 'validation_failed',
            message: e.message,
            missingFields: e.missingFields,
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (e instanceof TransitionNotAllowedError) {
        // 403 — ไม่มีสิทธิ์หรือสถานะไม่ตรง · ห้ามบอกว่าต้องกรอกฟิลด์อะไร
        throw new HttpException(
          { error: 'transition_not_allowed', message: e.message },
          HttpStatus.FORBIDDEN,
        );
      }
      throw e;
    }
  }
}
