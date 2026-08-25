/**
 * Work Item REST API — v1
 *
 * หลักคิดข้อ 5 (API-first): หน้าเว็บของเราคือลูกค้ารายแรกของ API ตัวเอง
 * ไม่มี endpoint ลับที่หน้าเว็บเรียกได้คนเดียว
 *
 * ⚠️ ยังไม่มีการยืนยันตัวตน — ใช้ resolveDevTenantContext ซึ่งโยน error
 * เมื่อรันบน production ดู ADR-003
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

/* eslint-disable @typescript-eslint/no-deprecated -- resolveDevTenantContext ถูกทำเครื่องหมาย deprecated โดยตั้งใจ
   เพื่อให้ทุกจุดที่ใช้มองเห็นได้ในทันทีเมื่อโมดูล identity พร้อม (ADR-003) จุดเหล่านี้คือรายการที่ต้องลบ */
import { resolveDevTenantContext } from '../../infrastructure/http/dev-tenant.guard';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
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
import { EmptyCommentError, addComment, listComments, type Viewer } from './comment.service';
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
  async options(@Query('project') projectKey?: string): Promise<{
    projects: Array<{ key: string; name: string; type: string }>;
    issueTypes: Array<{ name: string; icon: string }>;
    priorities: Array<{ rank: number; name: string }>;
  }> {
    const ctx = await resolveDevTenantContext();
    const db = tenantScoped(ctx);

    const [unsorted, priorities] = await Promise.all([
      // ตัดโปรเจกต์ที่เก็บเข้ากรุแล้วออก — ยังแจ้งเรื่องเข้าไปไม่ได้อยู่แล้ว
      db.project.findMany({
        where: { isArchived: false },
        select: { key: true, name: true, type: true },
        orderBy: { key: 'asc' },
      }),
      db.priority.findMany({ select: { rank: true, name: true }, orderBy: { rank: 'asc' } }),
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
    const ctx = await resolveDevTenantContext();
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
    // 404 ไม่ใช่ 200 พร้อม body ที่มีคำว่า error — ลูกค้าของ API ต้องแยกสองอย่างนี้ได้
    // จากรหัสสถานะ ไม่ใช่จากการเดาว่ามีคีย์ชื่อ error อยู่ใน body หรือเปล่า
    if (item === null) {
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
      projectKey: item.project.key,
      issueType: item.issueType.name,
      status: { name: item.status.name, category: item.status.category },
      priority: item.priority === null ? null : { rank: item.priority.rank, name: item.priority.name },
      assignee: item.assignee?.displayName ?? null,
      reporter: item.reporter.displayName,
      fieldSnapshot: item.fieldSnapshot,
      sla: sla.get(item.id.toString()) ?? null,
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
    @Param('key') key: string,
    @Query('view') view?: string,
  ): Promise<{ rows: unknown[] }> {
    const ctx = await resolveDevTenantContext();
    const viewer: Viewer = view === 'reporter' ? 'reporter' : 'agent';
    try {
      return { rows: await listComments(ctx, key, viewer) };
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
    @Param('key') key: string,
    @Body() body: { body?: string; isInternal?: boolean | string },
  ): Promise<unknown> {
    const ctx = await resolveDevTenantContext();
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
  async attachments(@Param('key') key: string): Promise<{ rows: unknown[] }> {
    const ctx = await resolveDevTenantContext();
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
    @Param('key') key: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<unknown> {
    const ctx = await resolveDevTenantContext();
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
  async download(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const ctx = await resolveDevTenantContext();
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
