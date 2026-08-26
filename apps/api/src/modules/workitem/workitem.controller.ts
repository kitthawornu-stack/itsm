/**
 * Work Item REST API — v1
 *
 * หลักคิดข้อ 5 (API-first): หน้าเว็บของเราคือลูกค้ารายแรกของ API ตัวเอง
 * ไม่มี endpoint ลับที่หน้าเว็บเรียกได้คนเดียว
 *
 * ทุก endpoint ต้องล็อกอิน — `SessionGuard` ระดับแอปปิดไว้เป็นค่าปริยาย
 * บริบทของผู้ใช้มาทาง `@Ctx()` ซึ่งผูกกับเซสชันจริง (ADR-003)
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { Ctx } from '../../infrastructure/http/session.guard';
import {
  assertCan,
  browsableProjectIds,
  can,
  summaryFor,
} from '../permission';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import type { TenantContext } from '@itsm/types';

import { SearchIndexNotReadyError, searchWorkItems } from '../search-index';
import { slaForWorkItems, type SlaSnapshot } from '../sla';
import {
  TransitionNotAllowedError,
  ValidationFailedError,
  applyTransition,
  availableTransitions,
} from '../workflow';
import {
  IssueTypeNotConfiguredError,
  ProjectNotFoundError,
  SummaryRequiredError,
  WorkItemNotFoundError,
  createWorkItem,
} from './workitem.service';
import { EmptyCommentError, addComment, listComments } from './comment.service';
import {
  AssigneeNotEligibleError,
  assignWorkItem,
  assignableUsers,
} from './assign.service';
import {
  InvalidFieldValueError,
  NothingToUpdateError,
  editWorkItem,
  listPriorities,
} from './edit.service';
import {
  AttachmentNotFoundError,
  AttachmentRejectedError,
  downloadAttachment,
  listAttachments,
  uploadAttachment,
} from './attachment.service';
import { MAX_SIZE_BYTES, decodeMultipartFilename } from './attachment-policy';
import { UploadErrorFilter } from '../../infrastructure/http/upload-error.filter';

export interface WorkItemListRow {
  id: string;
  itemKey: string;
  summary: string;
  status: { name: string; category: string; pausesSla: boolean };
  priority: { rank: number; name: string } | null;
  assignee: { name: string } | null;
  updatedAt: string;
  resolvedAt: string | null;
  /** null เมื่อโปรเจกต์ยังไม่ได้ตั้ง SLA Policy หรืองานยังไม่มีนาฬิกา */
  sla: SlaSnapshot | null;
}


/**
 * ดึงข้อความล้วนออกจาก `description` ที่เก็บเป็น structured document
 *
 * รูปแบบ rich text ยังไม่ได้ตัดสิน (ดู CreateWorkItemInput) ตอนนี้จึงเก็บเป็น
 * `{ format: 'text', text }` และหน้าจอแสดงเป็นข้อความล้วน
 */
function descriptionText(value: unknown): string | null {
  if (typeof value === 'string') return value === '' ? null : value;
  if (value === null || typeof value !== 'object') return null;
  const doc = value as Record<string, unknown>;
  return typeof doc['text'] === 'string' && doc['text'] !== '' ? doc['text'] : null;
}

@Controller('work-items')
export class WorkItemController {
  @Get()
  async list(
    @Ctx() ctx: TenantContext,
    @Query('project') projectKey?: string,
    @Query('q') q?: string,
    @Query('open') openOnly?: string,
    @Query('limit') limit?: string,
    @Query('mine') mine?: string,
  ): Promise<{ rows: WorkItemListRow[]; total: number }> {
    const db = tenantScoped(ctx);
    const take = Math.min(Number(limit ?? 50) || 50, 200);

    /**
     * กรองด้วยโปรเจกต์ที่ผู้ใช้เปิดดูได้ **ที่ระดับคิวรี**
     *
     * ถ้าดึงมาทั้งหมดแล้วค่อยคัดออกทีหลัง ยอดรวมและการแบ่งหน้าจะผิด
     * และแถวของโปรเจกต์ที่ไม่มีสิทธิ์ก็ถูกอ่านออกมาแล้วหนึ่งรอบอยู่ดี
     */
    const allowedProjectIds = await browsableProjectIds(ctx);

    const project =
      projectKey === undefined
        ? null
        : await db.project.findFirst({ where: { key: projectKey }, select: { id: true } });

    // ขอโปรเจกต์ที่เปิดดูไม่ได้ = เห็นศูนย์รายการ ไม่ใช่ 403
    // เพราะ 403 บอกว่าโปรเจกต์นี้มีอยู่จริง ซึ่งเป็นข้อมูลที่ไม่ควรบอก
    const scopedProjectIds =
      project === null
        ? allowedProjectIds
        : allowedProjectIds.filter((id) => id === project.id);

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

    /**
     * `mine=assigned` งานที่ฉันรับผิดชอบ · `mine=reported` งานที่ฉันแจ้ง
     *
     * แยกสองอย่างโดยตั้งใจ — ผู้แจ้งกับผู้รับผิดชอบเป็นคนละบทบาท
     * และคนคนเดียวกันอยากเห็นคนละรายการ ("งานที่ฉันต้องทำ" กับ "เรื่องที่ฉันแจ้งไว้")
     *
     * ค่าที่ไม่รู้จักถูกละเลย ไม่ใช่ตีความเป็น "ของฉัน" — ตัวกรองที่เดาเอง
     * ทำให้ผู้ใช้เห็นรายการผิดโดยไม่รู้ว่าทำไม
     */
    const mineFilter =
      ctx.actorId === null || mine === undefined
        ? {}
        : mine === 'assigned'
          ? { assigneeId: ctx.actorId }
          : mine === 'reported'
            ? { reporterId: ctx.actorId }
            : {};

    const where = {
      projectId: { in: scopedProjectIds },
      ...mineFilter,
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

    const sla = await slaForWorkItems(
      ctx,
      rows.map((w) => w.id),
    );

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
        sla: sla.get(w.id.toString()) ?? null,
      })),
    };
  }

  /**
   * ตัวเลือกสำหรับฟอร์มแจ้งงาน
   *
   * ชนิดงานมาจาก workflow scheme ของโปรเจกต์ ไม่ใช่รายการชนิดงานทั้งหมด
   * — ชนิดที่โปรเจกต์ยังไม่ได้ผูก workflow ไว้ สร้างไม่ได้อยู่ดี
   * การให้เลือกแล้วค่อยปฏิเสธทีหลังคือการโยนความผิดพลาดของเราไปให้ผู้ใช้
   *
   * ⚠️ ต้องประกาศ **ก่อน** `@Get(':key')` มิฉะนั้น Nest จะจับ "options" เป็นคีย์งาน
   * (คีย์จริงเป็นรูปแบบ ABC-123 จึงไม่มีทางชนกัน แต่ลำดับยังต้องถูก)
   */
  @Get('options')
  async options(
    @Ctx() ctx: TenantContext,
    @Query('project') projectKey?: string,
  ): Promise<{
    projects: Array<{ key: string; name: string; type: string }>;
    issueTypes: Array<{ name: string; icon: string }>;
    priorities: Array<{ rank: number; name: string }>;
  }> {
    const db = tenantScoped(ctx);

    const [unsorted, priorities] = await Promise.all([
      // ตัดโปรเจกต์ที่เก็บเข้ากรุแล้วออก — ยังแจ้งเรื่องเข้าไปไม่ได้อยู่แล้ว
      db.project.findMany({
        // เห็นเฉพาะโปรเจกต์ที่ตัวเองเปิดดูได้ — ฟอร์มแจ้งงานต้องไม่โฆษณา
        // โปรเจกต์ที่ผู้ใช้เข้าไม่ถึง
        where: { isArchived: false, id: { in: await browsableProjectIds(ctx) } },
        select: { key: true, name: true, type: true },
        orderBy: { key: 'asc' },
      }),
      listPriorities(ctx),
    ]);

    /**
     * Service Desk มาก่อนเสมอ เพราะฟอร์มแจ้งปัญหาเลือกตัวแรกเป็นค่าเริ่มต้น
     * เรียงตามตัวอักษรเฉย ๆ จะได้ "PLAT" มาก่อน "SD" แล้วคนแจ้งปัญหาไอที
     * จะไปลงโปรเจกต์พัฒนาซอฟต์แวร์โดยไม่รู้ตัว (เกิดขึ้นจริงตอนทดสอบฟอร์ม)
     *
     * เรียงที่นี่ ไม่ใช่ใน orderBy เพราะ MySQL เรียง enum ตามลำดับที่ประกาศ
     * ซึ่งแปลว่าการสลับบรรทัดใน schema.prisma จะเปลี่ยนค่าเริ่มต้นของฟอร์มโดยเงียบ ๆ
     *
     * **เรียงก่อนเลือก `target`** — ตอนแรกเรียงเฉพาะตอนคืนค่า ผลคือชนิดงาน
     * มาจากโปรเจกต์หนึ่งแต่ฟอร์มตั้งค่าเริ่มต้นเป็นอีกโปรเจกต์ แล้วกดส่งได้ 422 ทันที
     */
    const projects = [...unsorted].sort(
      (a, b) => Number(b.type === 'SERVICE_DESK') - Number(a.type === 'SERVICE_DESK'),
    );

    const target = projectKey ?? projects[0]?.key;
    const project =
      target === undefined
        ? null
        : await db.project.findFirst({ where: { key: target }, select: { id: true } });

    const schemes =
      project === null
        ? []
        : await db.workflowScheme.findMany({
            where: { projectId: project.id },
            include: { issueType: { select: { name: true, iconKey: true } } },
          });

    return {
      projects,
      issueTypes: schemes.map((s) => ({ name: s.issueType.name, icon: s.issueType.iconKey })),
      priorities,
    };
  }

  /**
   * สร้างงานใหม่
   *
   * ตั้งใจไม่รับ `statusId` `rank` หรือ `itemKey` จากผู้เรียก — ทั้งสามอย่าง
   * ระบบเป็นคนกำหนด ถ้ารับเข้ามา ลูกค้าของ API จะกำหนดสถานะเริ่มต้นเองได้
   * ซึ่งข้าม workflow ไปทั้งอัน
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Ctx() ctx: TenantContext,
    @Body()
    // ชนิดที่นี่ต้องสะท้อน **สิ่งที่มาจากสาย** ไม่ใช่สิ่งที่เราหวังว่าจะได้
    // Nest ไม่ตรวจ body ให้โดยปริยาย ลูกค้าส่ง "3" มาแทน 3 ได้เสมอ
    // ถ้าประกาศเป็น number เฉย ๆ lint จะบอกว่า Number() ซ้ำซ้อน แล้วเราจะลบมันทิ้ง
    // แล้วสตริงจะไหลเข้า Prisma โดยไม่มีอะไรกั้น (CLAUDE.md §4 — บทเรียนเรื่อง Prisma.Decimal)
    body: {
      project?: string;
      issueType?: string;
      summary?: string;
      description?: string;
      priorityRank?: number | string;
      assigneeId?: string;
    },
  ): Promise<{ id: string; itemKey: string; status: string }> {
    if (ctx.actorId === null) {
      throw new HttpException({ message: 'ไม่พบผู้ใช้สำหรับแจ้งงาน' }, HttpStatus.FORBIDDEN);
    }
    if (body.project === undefined || body.issueType === undefined) {
      throw new HttpException(
        { error: 'validation_failed', message: 'ต้องระบุโปรเจกต์และชนิดของงาน' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      const created = await createWorkItem(ctx, {
        projectKey: body.project,
        issueTypeName: body.issueType,
        summary: body.summary ?? '',
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.priorityRank === undefined ? {} : { priorityRank: Number(body.priorityRank) }),
        ...(body.assigneeId === undefined ? {} : { assigneeId: BigInt(body.assigneeId) }),
      });
      return { id: created.id.toString(), itemKey: created.itemKey, status: created.statusName };
    } catch (e) {
      if (e instanceof SummaryRequiredError) {
        throw new HttpException(
          { error: 'validation_failed', message: e.message, missingFields: ['summary'] },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (e instanceof ProjectNotFoundError) {
        throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
      }
      if (e instanceof IssueTypeNotConfiguredError) {
        // 422 ไม่ใช่ 404 — โปรเจกต์มีจริง แต่ยังตั้งค่าไม่ครบ ซึ่งแก้ได้ที่หน้า admin
        throw new HttpException(
          { error: 'issue_type_not_configured', message: e.message },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw e;
    }
  }

  @Get(':key')
  async detail(@Ctx() ctx: TenantContext, @Param('key') key: string): Promise<unknown> {
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
    // 404 ไม่ใช่ 200 พร้อม body ที่มีคำว่า error — ลูกค้าของ API ต้องแยกสองอย่างนี้ได้
    // จากรหัสสถานะ ไม่ใช่จากการเดาว่ามีคีย์ชื่อ error อยู่ใน body หรือเปล่า
    if (item === null) {
      throw new HttpException({ error: 'not_found', message: `ไม่พบงาน ${key}` }, HttpStatus.NOT_FOUND);
    }

    // เปิดดูโปรเจกต์นี้ไม่ได้ = ตอบเหมือนไม่มีงานใบนี้
    // ตอบ 403 เท่ากับยืนยันว่างานคีย์นี้มีอยู่จริง ซึ่งเป็นข้อมูลรั่วเล็ก ๆ ที่ไล่เก็บได้
    if (!(await can(ctx, item.projectId, 'BROWSE_PROJECT'))) {
      throw new HttpException({ error: 'not_found', message: `ไม่พบงาน ${key}` }, HttpStatus.NOT_FOUND);
    }

    const [transitions, history, sla] = await Promise.all([
      ctx.actorId === null ? Promise.resolve([]) : availableTransitions(ctx, item.id, ctx.actorId),
      db.workItemHistory.findMany({
        where: { workItemId: item.id },
        orderBy: { id: 'desc' },
        take: 20,
        include: { actor: { select: { displayName: true } } },
      }),
      // อ่านค่าที่ denormalise ไว้ เหมือนหน้าลิสต์ — ไม่คำนวณใหม่ตอน GET
      // เพราะการคำนวณใหม่เขียนฐานข้อมูล และ GET ต้องไม่เขียน
      // `breachAt` เป็นเวลาสัมบูรณ์อยู่แล้ว หน้าจอจึงนับถอยหลังเองได้ถูกต้อง
      slaForWorkItems(ctx, [item.id]),
    ]);

    return {
      id: item.id.toString(),
      itemKey: item.itemKey,
      summary: item.summary,
      /**
       * คำอธิบายไม่เคยถูกส่งออกมาเลยจนถึงตอนนี้
       *
       * ผู้แจ้งพิมพ์ลงฟอร์ม ระบบเก็บลงฐานข้อมูลและจัดดัชนีให้ค้นเจอ
       * แต่หน้ารายละเอียดไม่แสดง — ข้อมูลที่สำคัญที่สุดของการแจ้งเรื่อง
       * มองไม่เห็นด้วยตา เห็นได้ทางการค้นหาอย่างเดียว
       */
      description: descriptionText(item.description),
      projectKey: item.project.key,
      issueType: item.issueType.name,
      status: { name: item.status.name, category: item.status.category },
      priority: item.priority === null ? null : { rank: item.priority.rank, name: item.priority.name },
      assignee: item.assignee?.displayName ?? null,
      reporter: item.reporter.displayName,
      fieldSnapshot: item.fieldSnapshot,
      sla: sla.get(item.id.toString()) ?? null,
      // ให้หน้าจอซ่อนปุ่มที่กดไม่ได้ — ไม่ใช่กลไกป้องกัน เซิร์ฟเวอร์ปฏิเสธเองอยู่แล้ว
      permissions: await summaryFor(ctx, item.projectId),
      // ตัวเลือกสำหรับฟอร์มแก้ไข ส่งมาพร้อมหน้าเลย ไม่ต้องยิงอีกคำขอ
      priorities: await listPriorities(ctx),
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
   * ความเห็นบนงาน
   *
   * `view=reporter` ตัดความเห็นภายในออก **ที่ชั้น service** ไม่ใช่ให้หน้าจอซ่อน
   * (INVARIANT 3) ตอนนี้ผู้เรียกเป็นคนบอกมุมมองเพราะยังไม่มีโมดูล permission
   * เมื่อ identity พร้อม ให้ตัดสินจากสิทธิ์จริงของผู้ใช้แทน — ดู ADR-003
   */
  @Get(':key/comments')
  async comments(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
  ): Promise<{ rows: unknown[] }> {
    try {
      // ไม่มีพารามิเตอร์ `view` อีกแล้ว — service ถามสิทธิ์เอง
      return { rows: await listComments(ctx, key) };
    } catch (e) {
      if (e instanceof WorkItemNotFoundError) {
        throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }

  @Post(':key/comments')
  @HttpCode(HttpStatus.CREATED)
  async comment(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { body?: string; isInternal?: boolean | string },
  ): Promise<unknown> {
    if (ctx.actorId === null) {
      throw new HttpException({ message: 'ไม่พบผู้ใช้สำหรับเขียนความเห็น' }, HttpStatus.FORBIDDEN);
    }
    try {
      return await addComment(ctx, {
        itemKey: key,
        body: body.body ?? '',
        // มาจาก JSON ดิบ — "true" เป็นสตริงได้ ต้องแปลงเอง ไม่ใช่เชื่อชนิดที่ประกาศ
        isInternal: body.isInternal === true || body.isInternal === 'true',
      });
    } catch (e) {
      if (e instanceof EmptyCommentError) {
        throw new HttpException(
          { error: 'validation_failed', message: 'ต้องพิมพ์ข้อความก่อนส่ง', missingFields: ['body'] },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (e instanceof WorkItemNotFoundError) {
        throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }

  /**
   * ไฟล์แนบของงาน
   */
  @Get(':key/attachments')
  async attachments(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
  ): Promise<{ rows: unknown[] }> {
    try {
      return { rows: await listAttachments(ctx, key) };
    } catch (e) {
      if (e instanceof WorkItemNotFoundError) {
        throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }

  /**
   * แนบไฟล์
   *
   * ไฟล์ผ่าน API ไม่ใช่ presigned URL ตรงเข้า bucket — ทำให้ตรวจขนาดและชนิด
   * ได้จริงก่อนเก็บ · เพดานของ multer ตั้งไว้เท่ากับเพดานของ policy
   * เพื่อไม่ให้ไฟล์ใหญ่มากกินหน่วยความจำก่อนถูกปฏิเสธ
   */
  @Post(':key/attachments')
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(UploadErrorFilter)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIZE_BYTES } }))
  async upload(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<unknown> {
    if (ctx.actorId === null) {
      throw new HttpException({ message: 'ไม่พบผู้ใช้สำหรับแนบไฟล์' }, HttpStatus.FORBIDDEN);
    }
    if (file === undefined) {
      throw new HttpException(
        { error: 'validation_failed', message: 'ไม่พบไฟล์ในคำขอ', missingFields: ['file'] },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      return await uploadAttachment(ctx, {
        itemKey: key,
        // ถอดรหัสชื่อใหม่ก่อน (busboy ถอดเป็น latin-1) แล้วจึงส่งต่อ
        // การตัด path และอักขระอันตราย ทำที่ชั้น service ด้วย safeDisplayName
        filename: decodeMultipartFilename(file.originalname),
        mimeType: file.mimetype,
        content: file.buffer,
      });
    } catch (e) {
      if (e instanceof AttachmentRejectedError) {
        // 413 เฉพาะไฟล์ใหญ่เกิน · ที่เหลือเป็น 422 เพราะคำขอถูกต้องแต่เนื้อหาไม่ผ่าน
        throw new HttpException(
          { error: e.code, message: e.message },
          e.code === 'too_large' ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (e instanceof WorkItemNotFoundError) {
        throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }

  /**
   * ดาวน์โหลดไฟล์แนบ
   *
   * ตั้ง `Content-Disposition: attachment` เสมอ และ `X-Content-Type-Options: nosniff`
   * เพื่อไม่ให้เบราว์เซอร์เดาชนิดไฟล์เองแล้วเปิดสิ่งที่ไม่ควรเปิด
   */
  @Get('attachments/:id/download')
  async download(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const f = await downloadAttachment(ctx, BigInt(id));
      res.setHeader('Content-Type', f.mimeType);
      res.setHeader('Content-Disposition', f.disposition);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(f.content);
    } catch (e) {
      if (e instanceof AttachmentNotFoundError) {
        throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }

  /**
   * มอบหมายงาน — ส่ง `assigneeId` เป็น null เพื่อคืนงานเข้ากอง
   */
  @Post(':key/assign')
  @HttpCode(HttpStatus.OK)
  async assign(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { assigneeId?: unknown },
  ): Promise<unknown> {
    // "me" คือการรับงานเอง ซึ่งเป็นการกระทำที่ต่างจากการจ่ายให้คนอื่น
    // ในสายตาผู้ใช้ แต่เป็นเรื่องเดียวกันในระบบ
    const raw = body.assigneeId;
    let assigneeId: bigint | null;
    if (raw === null || raw === undefined || raw === '') {
      assigneeId = null;
    } else if (raw === 'me') {
      assigneeId = ctx.actorId;
    } else if (typeof raw === 'string' || typeof raw === 'number') {
      try {
        assigneeId = BigInt(raw);
      } catch {
        throw new HttpException(
          { error: 'validation_failed', message: 'รหัสผู้รับผิดชอบไม่ถูกต้อง' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    } else {
      // object หรือ array จะกลายเป็น "[object Object]" ถ้าปล่อยให้ String() จัดการ
      // แล้ว BigInt() จะโยน error ที่ไม่บอกอะไรกับผู้เรียกเลย
      throw new HttpException(
        { error: 'validation_failed', message: 'รหัสผู้รับผิดชอบไม่ถูกต้อง' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      return await assignWorkItem(ctx, key, assigneeId);
    } catch (e) {
      if (e instanceof AssigneeNotEligibleError) {
        throw new HttpException(
          { error: 'assignee_not_eligible', message: e.message },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (e instanceof WorkItemNotFoundError) {
        throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }

  /** รายชื่อคนที่มอบหมายงานใบนี้ให้ได้ */
  @Get(':key/assignable')
  async assignable(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
  ): Promise<{ rows: unknown[] }> {
    const db = tenantScoped(ctx);
    const item = await db.workItem.findFirst({
      where: { itemKey: key },
      select: { projectId: true },
    });
    if (item === null) {
      throw new HttpException({ error: 'not_found', message: `ไม่พบงาน ${key}` }, HttpStatus.NOT_FOUND);
    }
    await assertCan(ctx, item.projectId, 'ASSIGN_ITEM');
    return { rows: await assignableUsers(ctx, item.projectId) };
  }

  /**
   * แก้ไขงานที่แจ้งไปแล้ว
   *
   * ฟิลด์ที่ไม่ส่งมา = ไม่แตะ · ส่ง null = ล้างค่า
   * แยกสองอย่างนี้ให้ชัด ไม่งั้น "ไม่ได้แก้ช่องนี้" กับ "ตั้งใจลบค่าในช่องนี้"
   * จะกลายเป็นสิ่งเดียวกัน แล้วการบันทึกหนึ่งครั้งจะล้างข้อมูลที่ไม่ได้ตั้งใจแตะ
   */
  @Post(':key/edit')
  @HttpCode(HttpStatus.OK)
  async edit(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body()
    body: { summary?: unknown; description?: unknown; priorityRank?: unknown },
  ): Promise<unknown> {
    const input: Parameters<typeof editWorkItem>[2] = {};
    if (typeof body.summary === 'string') input.summary = body.summary;
    if (body.description === null || typeof body.description === 'string') {
      input.description = body.description;
    }
    if (body.priorityRank === null) {
      input.priorityRank = null;
    } else if (typeof body.priorityRank === 'string' || typeof body.priorityRank === 'number') {
      const n = Number(body.priorityRank);
      if (!Number.isInteger(n)) {
        throw new HttpException(
          { error: 'validation_failed', message: 'ระดับความสำคัญไม่ถูกต้อง' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      input.priorityRank = n;
    }

    try {
      return await editWorkItem(ctx, key, input);
    } catch (e) {
      if (e instanceof NothingToUpdateError) {
        // 200 ไม่ใช่ error — ผู้ใช้กดบันทึกโดยไม่ได้แก้อะไร ซึ่งไม่ใช่ความผิดพลาด
        return { itemKey: key, changed: [] };
      }
      if (e instanceof SummaryRequiredError) {
        throw new HttpException(
          { error: 'validation_failed', message: e.message, missingFields: ['summary'] },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (e instanceof InvalidFieldValueError) {
        throw new HttpException(
          { error: 'validation_failed', message: e.message, missingFields: [e.field] },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (e instanceof WorkItemNotFoundError) {
        throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }

  /**
   * กด transition — ทางเข้าเดียวที่เปลี่ยนสถานะงานได้
   *
   * ทุกกรณีล้มเหลวมีรหัสสถานะและข้อความของตัวเอง ไม่รวมเป็น 500 ก้อนเดียว
   * เพราะหน้าจอต้องบอกผู้ใช้ได้ว่าต้องทำอะไรต่อ ไม่ใช่แค่ว่า "ผิดพลาด"
   */
  @Post(':key/transitions/:transitionId')
  async transition(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Param('transitionId') transitionId: string,
  ): Promise<unknown> {
    if (ctx.actorId === null) {
      throw new HttpException({ message: 'ไม่พบผู้ใช้สำหรับดำเนินการ' }, HttpStatus.FORBIDDEN);
    }
    const db = tenantScoped(ctx);
    const item = await db.workItem.findFirst({
      where: { itemKey: key },
      select: { id: true, projectId: true },
    });
    if (item === null) {
      throw new HttpException({ message: `ไม่พบงาน ${key}` }, HttpStatus.NOT_FOUND);
    }

    // workflow engine ตรวจ CONDITION ของ transition อยู่แล้ว แต่นั่นคือกฎของ workflow
    // ไม่ใช่สิทธิ์ — โปรเจกต์ที่ไม่ตั้ง CONDITION ไว้จะเปิดให้ทุกคนกดโดยไม่มีอะไรกั้น
    await assertCan(ctx, item.projectId, 'TRANSITION_ITEM');

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
