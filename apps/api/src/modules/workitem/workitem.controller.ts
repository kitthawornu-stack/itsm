/**
 * Work Item REST API — v1
 *
 * หลักคิดข้อ 5 (API-first): หน้าเว็บของเราคือลูกค้ารายแรกของ API ตัวเอง
 * ไม่มี endpoint ลับที่หน้าเว็บเรียกได้คนเดียว
 *
 * ⚠️ ยังไม่มีการยืนยันตัวตน — ใช้ resolveDevTenantContext ซึ่งโยน error
 * เมื่อรันบน production ดู ADR-003
 */
import { Controller, Get, HttpException, HttpStatus, Param, Query } from '@nestjs/common';

import { resolveDevTenantContext } from '../../infrastructure/http/dev-tenant.guard';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { SearchIndexNotReadyError, searchWorkItems } from '../search-index';
import { availableTransitions } from '../workflow';

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

    const transitions =
      ctx.actorId === null ? [] : await availableTransitions(ctx, item.id, ctx.actorId);

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
    };
  }
}
