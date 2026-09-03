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
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
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

import {
  RequiredFieldsMissingError,
  UnknownFieldOptionError,
  displayFieldsFor,
  formFieldsFor,
  listResolutions,
  prepareFieldValues,
} from '../field';
import { CatalogItemNotFoundError, catalogItemForReport } from '../catalog';
import {
  MAX_RESULT_WINDOW,
  SearchDepthExceededError,
  SearchIndexNotReadyError,
  searchByHql,
  searchWorkItems,
} from '../search-index';
import { fireAutomation } from '../automation';
import { slaForWorkItems, type SlaSnapshot } from '../sla';
import {
  TransitionNotAllowedError,
  ValidationFailedError,
  UnknownResolutionError,
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
import { DurationTooLargeError, InvalidDurationError } from './duration';
import {
  ItemNotFoundForWorkLogError,
  NotYourWorkLogError,
  WorkLogInFutureError,
  WorkLogNotFoundError,
  deleteWorkLog,
  logWork,
  setEstimate,
  timeOf,
  type TimeSummary,
} from './worklog.service';
import {
  AssigneeNotEligibleError,
  assignWorkItem,
  assignableUsers,
} from './assign.service';
import {
  BULK_MAX,
  BulkTooManyItemsError,
  NothingSelectedError,
  bulkEditWorkItems,
  type BulkEditResult,
} from './bulk-edit.service';
import {
  bulkTransitionOptions,
  bulkTransitionWorkItems,
  type BulkTransitionOption,
  type BulkTransitionResult,
} from './bulk-transition.service';
import {
  NotALabelFieldError,
  bulkEditLabels,
  labelFields,
  type BulkLabelResult,
} from './bulk-label.service';
import {
  WatchTargetNotFoundError,
  isWatching,
  mentionableUsers,
  unwatch,
  watch,
  watchersOf,
} from './watcher.service';
import {
  CrossProjectParentError,
  HierarchyCycleError,
  HierarchyTargetNotFoundError,
  SelfParentError,
  WrongHierarchyLevelError,
  childrenOf,
  parentOf,
  setParent,
} from './hierarchy.service';
import {
  ArticleNotFoundError,
  articlesOf,
  attachArticle,
  detachArticle,
  rateArticle,
} from '../knowledge';
import {
  CommentNotFoundError,
  NotCommentAuthorError,
  deleteComment,
  editComment,
} from './comment-edit.service';
import {
  DuplicateLinkError,
  LINK_TYPES,
  LinkTargetNotFoundError,
  SelfLinkError,
  linkWorkItems,
  linksOf,
  problemImpactOf,
  unlinkWorkItems,
  workaroundsFor,
  type Workaround,
} from '../link';
import {
  NotResolvedYetError,
  NotTheReporterError,
  RatingOutOfRangeError,
  rateWorkItem,
  satisfactionFor,
} from './satisfaction.service';
import {
  InvalidFieldValueError,
  NothingToUpdateError,
  editWorkItem,
  listPriorities,
} from './edit.service';
import {
  AttachmentNotFoundError,
  AttachmentRejectedError,
  deleteAttachment,
  downloadAttachment,
  listAttachments,
  uploadAttachment,
} from './attachment.service';
import { MAX_SIZE_BYTES, decodeMultipartFilename } from './attachment-policy';
import { NOT_COPIED } from './clone-plan';
import { cloneWorkItem, WorkItemNotFoundForCloneError } from './clone.service';
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
  /** คีย์โปรเจกต์ — หน้าจอใช้ตัดสินว่าแถวนี้ติ๊กเลือกเพื่อแก้ทีละหลายใบได้ไหม */
  projectKey: string;
  /** null เมื่อโปรเจกต์ยังไม่ได้ตั้ง SLA Policy หรืองานยังไม่มีนาฬิกา */
  sla: SlaSnapshot | null;
}


/**
 * หา (projectId, issueTypeId) จากคีย์ที่ผู้ใช้ส่งมา — null เมื่อหาไม่เจอ
 *
 * คืน null แทนการโยน เพราะ `createWorkItem` มี error ของตัวเองที่อธิบายได้ดีกว่า
 * (โปรเจกต์ไม่มีจริง vs ประเภทงานยังไม่ได้ผูก) · ที่นี่แค่ต้องรู้ว่าจะตรวจฟิลด์ไหม
 */
async function resolveFormScope(
  ctx: TenantContext,
  projectKey: string | undefined,
  issueTypeName: string | undefined,
): Promise<{ projectId: bigint; issueTypeId: bigint } | null> {
  if (projectKey === undefined || issueTypeName === undefined) return null;
  const db = tenantScoped(ctx);
  const project = await db.project.findFirst({ where: { key: projectKey }, select: { id: true } });
  if (project === null) return null;
  const scheme = await db.workflowScheme.findFirst({
    where: { projectId: project.id, issueType: { name: issueTypeName } },
    select: { issueTypeId: true },
  });
  if (scheme === null) return null;
  return { projectId: project.id, issueTypeId: scheme.issueTypeId };
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


/**
 * error ของ **คำขอทั้งชุด** → HTTP
 *
 * ใช้ร่วมกันสองปลายทาง เพราะถ้าแยกกันเขียน วันหนึ่งจะมีปลายทางเดียวที่ตอบ 500
 * ให้กับเรื่องเดียวกัน แล้วหน้าจอจะแสดงข้อความคนละแบบให้ผู้ใช้คนเดียวกัน
 */
function toBulkHttpError(e: unknown): unknown {
  if (e instanceof BulkTooManyItemsError) {
    return new HttpException(
      { error: 'too_many_items', message: e.message, max: BULK_MAX },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (e instanceof NothingSelectedError) {
    return new HttpException(
      { error: 'nothing_selected', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return e;
}


/** ป้ายภาษาคนของแต่ละความสัมพันธ์ — ให้หน้าจอไม่ต้องเก็บรายการของตัวเอง */
const LINK_TYPE_LABEL: Record<(typeof LINK_TYPES)[number], string> = {
  RELATES_TO: 'เกี่ยวข้องกับ',
  BLOCKS: 'ขวางเรื่อง',
  IS_BLOCKED_BY: 'ติดอยู่ที่',
  DUPLICATES: 'ซ้ำกับ',
  CAUSES: 'เป็นสาเหตุของ',
  IS_CAUSED_BY: 'เกิดจาก',
};

/** error ของการเชื่อมโยง → HTTP */
function toLinkHttpError(e: unknown): unknown {
  if (e instanceof LinkTargetNotFoundError) {
    return new HttpException({ message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof SelfLinkError || e instanceof DuplicateLinkError) {
    return new HttpException(
      { error: 'invalid_link', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return e;
}


/**
 * id ของความเห็นจาก URL
 *
 * ค่าที่ไม่ใช่ตัวเลขต้องตอบ 404 เหมือนความเห็นที่ไม่มีอยู่ ไม่ใช่ระเบิดเป็น 500
 * — `BigInt('abc')` โยน SyntaxError ซึ่งไปโผล่เป็น Internal Server Error
 */
function parseCommentId(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new HttpException({ message: 'ไม่พบความเห็นที่ระบุ' }, HttpStatus.NOT_FOUND);
  }
}

/** error ของการแก้/ลบความเห็น → HTTP */
function toCommentHttpError(e: unknown): unknown {
  if (e instanceof CommentNotFoundError) {
    return new HttpException({ message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof NotCommentAuthorError) {
    return new HttpException({ error: 'not_author', message: e.message }, HttpStatus.FORBIDDEN);
  }
  if (e instanceof EmptyCommentError) {
    return new HttpException(
      { error: 'validation_failed', message: 'ต้องพิมพ์ข้อความก่อนบันทึก', missingFields: ['body'] },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return e;
}


/**
 * แปลง error ของบันทึกเวลาเป็น HTTP
 *
 * แยก 422 (คำขอถูกรูปแบบแต่ข้อมูลใช้ไม่ได้) ออกจาก 403 (ไม่มีสิทธิ์) และ
 * 404 (ไม่มีของ) — สามอย่างนี้ผู้ใช้ต้องทำต่อคนละแบบ
 */
function toTimeHttp(e: unknown): unknown {
  if (e instanceof ItemNotFoundForWorkLogError || e instanceof WorkLogNotFoundError) {
    return new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof NotYourWorkLogError) {
    return new HttpException({ message: e.message }, HttpStatus.FORBIDDEN);
  }
  if (
    e instanceof InvalidDurationError ||
    e instanceof DurationTooLargeError ||
    e instanceof WorkLogInFutureError
  ) {
    return new HttpException(
      { error: 'validation_failed', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return e;
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
    @Query('hql') hql?: string,
    @Query('offset') offset?: string,
  ): Promise<{
    rows: WorkItemListRow[];
    total: number;
    hqlError?: string;
    /** คีย์โปรเจกต์ที่ผู้ใช้คนนี้แก้ทีละหลายใบได้ — ใช้ตัดสินว่าจะโชว์ช่องติ๊กไหม */
    bulkEditable?: string[];
    /** ตำแหน่งเริ่มของหน้านี้ — หน้าจอใช้คำนวณว่ากำลังดูช่วงไหนของทั้งหมด */
    offset?: number;
  }> {
    const db = tenantScoped(ctx);
    const take = Math.min(Number(limit ?? 50) || 50, 200);
    /*
      ตำแหน่งเริ่มของหน้า — ค่าติดลบหรือค่าที่ไม่ใช่ตัวเลขตกเป็น 0
      ไม่ใช่โยน error · ลิงก์ที่พังไม่ควรทำให้หน้าจอพัง แค่กลับไปหน้าแรก
    */
    const skip = Math.max(0, Math.floor(Number(offset ?? 0)) || 0);

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

    /**
     * HQL — ผู้ใช้เขียนเงื่อนไขเอง
     *
     * ข้อผิดพลาดของภาษาคืนเป็น 200 พร้อม `hqlError` ไม่ใช่ 4xx โดยตั้งใจ:
     * คนกำลังพิมพ์คิวรีอยู่ และการพิมพ์ยังไม่จบไม่ใช่คำขอที่ผิด
     * หน้าจอต้องแสดงข้อความช่วยแก้ ไม่ใช่หน้าจอ error เต็มจอ
     *
     * ขอบเขตโปรเจกต์ส่งเข้าไปเสมอ — `compile` เป็นคนใส่ลง filter ไม่ใช่ที่นี่
     */
    /**
     * ยอดรวมของเส้นทาง HQL มาจาก **ดัชนี** ไม่ใช่จากจำนวนคีย์ที่คัดมาได้
     *
     * เดิมนับจาก `keyFilter` ซึ่งยาวไม่เกิน `take` เสมอ ยอดที่ได้จึงเท่ากับ
     * จำนวนที่แสดงทุกครั้ง — เป็นการรายงานเพดานของตัวเองเป็นข้อเท็จจริง
     * เกี่ยวกับข้อมูล · หน้าจอเลยต้องเขียนเลี่ยงว่า "แสดง N รายการ (สูงสุด 50)"
     * ตอนนี้ตอบได้จริงว่าทั้งหมดมีเท่าไร และแบ่งหน้าได้
     */
    let hqlTotal: number | null = null;
    if (hql !== undefined && hql.trim().length > 0) {
      try {
        const page = await searchByHql(ctx, hql, scopedProjectIds, take, skip);
        hqlTotal = page.total;
        keyFilter = page.hits.map((h) => h.itemKey);
      } catch (e) {
        if (e instanceof SearchIndexNotReadyError) {
          throw new HttpException(
            { error: 'search_index_not_ready', message: 'ระบบค้นหายังไม่พร้อมใช้งาน กรุณาแจ้งผู้ดูแลระบบ' },
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
        /*
          เพดานความลึกไม่ใช่ความผิดของคิวรี — คิวรีถูกทุกตัวอักษร แค่ขอหน้าที่ลึกเกิน
          คืนยอดรวมเท่าเพดานเพื่อให้หน้าจอยังบอกได้ว่าดูได้ถึงไหน
        */
        if (e instanceof SearchDepthExceededError) {
          return { rows: [], total: MAX_RESULT_WINDOW, hqlError: e.message, offset: skip };
        }
        if (e instanceof Error && e.name.startsWith('Hql')) {
          return { rows: [], total: 0, hqlError: e.message };
        }
        throw e;
      }
      // หน้าที่เลยผลลัพธ์ไปแล้ว ต้องคืนยอดรวมจริงมาด้วย ไม่ใช่ 0
      // ไม่งั้นการกดหน้าถัดไปเกินขอบจะทำให้หน้าจอบอกว่า "ไม่พบอะไรเลย"
      if (keyFilter.length === 0) return { rows: [], total: hqlTotal, offset: skip };
    } else if (q !== undefined && q.trim().length > 0) {
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
        /*
          เส้นทาง HQL เลื่อนหน้าที่ **ดัชนี** ไปแล้ว (`from`) — ถ้าเลื่อนซ้ำที่นี่
          จะข้ามผลลัพธ์ไปสองเท่า · เส้นทางปกติเลื่อนที่ MySQL
        */
        ...(hqlTotal === null ? { skip } : {}),
        orderBy: { updatedAt: 'desc' },
        include: {
          status: { select: { name: true, category: true, pausesSla: true } },
          priority: { select: { rank: true, name: true } },
          assignee: { select: { displayName: true } },
          project: { select: { key: true } },
        },
      }),
      db.workItem.count({ where }),
    ]);

    /*
      โปรเจกต์ไหนที่ผู้ใช้คนนี้แก้ทีละหลายใบได้ — **เฉพาะที่ปรากฏในผลลัพธ์**

      คืนเป็นรายการ ไม่ใช่ค่าบูลีนใบเดียว เพราะคิวรี HQL เลือกงานข้ามโปรเจกต์ได้
      ค่าบูลีนใบเดียวจะบังคับให้เลือกระหว่าง "โชว์ช่องติ๊กบนแถวที่กดแล้วไม่ผ่าน"
      กับ "ซ่อนทั้งหน้าเพราะมีโปรเจกต์เดียวที่ไม่มีสิทธิ์" — ผิดทั้งคู่

      นี่คือการ **ซ่อนปุ่มที่กดแล้วได้ 403** ไม่ใช่กลไกป้องกัน
      เซิร์ฟเวอร์ตรวจซ้ำเองทุกครั้งใน `bulkEditWorkItems`
    */
    const seenProjectIds = [...new Set(rows.map((w) => w.projectId.toString()))];
    const bulkEditable: string[] = [];
    for (const idText of seenProjectIds) {
      if (await can(ctx, BigInt(idText), 'BULK_EDIT')) {
        const key = rows.find((w) => w.projectId.toString() === idText)?.project.key;
        if (key !== undefined) bulkEditable.push(key);
      }
    }

    const sla = await slaForWorkItems(
      ctx,
      rows.map((w) => w.id),
    );

    return {
      // ยอดรวมของเส้นทาง HQL มาจากดัชนี ส่วนเส้นทางปกติมาจาก MySQL
      total: hqlTotal ?? total,
      offset: skip,
      bulkEditable,
      rows: rows.map((w) => ({
        id: w.id.toString(),
        itemKey: w.itemKey,
        projectKey: w.project.key,
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
      /**
       * ฟิลด์ที่ต้องถามมาพร้อมประเภทงานเลย
       *
       * `field_config` มีข้อมูลอยู่ตั้งแต่ Spike B แต่ฟอร์มไม่เคยถามมันเลย —
       * และสองในสี่ฟิลด์ของ SD ตั้งเป็นบังคับกรอกไว้ด้วย
       */
      issueTypes: await Promise.all(
        schemes.map(async (s) => ({
          name: s.issueType.name,
          icon: s.issueType.iconKey,
          fields:
            project === null ? [] : await formFieldsFor(ctx, project.id, s.issueTypeId),
        })),
      ),
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
      /** แจ้งผ่านรายการบริการไหน — ไม่ส่ง = พิมพ์อิสระ */
      catalogItemId?: string;
      /** ค่าฟิลด์เพิ่มเติม คีย์คือ `field_definition.key` */
      fields?: Record<string, unknown>;
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

    /**
     * ตรวจฟิลด์บังคับ **ก่อน** สร้างงาน
     *
     * ถ้าสร้างก่อนแล้วค่อยตรวจ จะได้ตั๋วที่ขาดฟิลด์บังคับค้างอยู่ในระบบ
     * และไม่มีอะไรพากลับไปเติม — ผู้ใช้เห็นข้อความผิดพลาดแล้วปิดหน้าไป
     * โดยที่ตั๋วถูกสร้างไปแล้วเรียบร้อย
     */
    /*
      **ตรวจบริการที่อ้างมาเองทุกครั้ง ไม่เชื่อว่าหน้าจอส่งมาถูก**

      `catalogItemForReport` ปฏิเสธบริการที่ปิดอยู่หรืออยู่ในโปรเจกต์ที่ผู้ใช้
      เปิดดูไม่ได้ · ถ้าเชื่อ id ที่ส่งมาดื้อ ๆ ใครก็ผูกเรื่องเข้ากับบริการของ
      โปรเจกต์ที่ตัวเองเข้าไม่ถึงได้ แล้วรายงานของโปรเจกต์นั้นจะมีเรื่องแปลกปลอม
      โดยไม่มีใครรู้ว่ามาจากไหน
    */
    let catalogItemId: bigint | undefined;
    if (body.catalogItemId !== undefined && body.catalogItemId !== '') {
      try {
        const target = await catalogItemForReport(
          ctx,
          BigInt(body.catalogItemId),
          await browsableProjectIds(ctx),
        );
        catalogItemId = target.itemId;
      } catch (e) {
        if (e instanceof CatalogItemNotFoundError) {
          throw new HttpException(
            { error: 'not_found', message: e.message },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        throw e;
      }
    }

    const scope = await resolveFormScope(ctx, body.project, body.issueType);
    let fieldValues: Awaited<ReturnType<typeof prepareFieldValues>> = [];
    try {
      if (scope !== null) {
        fieldValues = await prepareFieldValues(
          ctx,
          scope.projectId,
          scope.issueTypeId,
          body.fields ?? {},
        );
      }
    } catch (e) {
      if (e instanceof RequiredFieldsMissingError) {
        throw new HttpException(
          { error: 'validation_failed', message: e.message, missingFields: e.fields },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (e instanceof UnknownFieldOptionError) {
        throw new HttpException(
          { error: 'validation_failed', message: e.message },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw e;
    }

    try {
      const created = await createWorkItem(ctx, {
        projectKey: body.project,
        issueTypeName: body.issueType,
        summary: body.summary ?? '',
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.priorityRank === undefined ? {} : { priorityRank: Number(body.priorityRank) }),
        ...(body.assigneeId === undefined ? {} : { assigneeId: BigInt(body.assigneeId) }),
        ...(catalogItemId === undefined ? {} : { catalogItemId }),
        // เขียนในทรานแซกชันเดียวกับการสร้างงาน — ล้มเมื่อไร ตั๋วก็ไม่เกิด
        fieldValues,
      });
      /*
        **ค่าฟิลด์ถูกเขียนไปแล้วในทรานแซกชันของ `createWorkItem`**

        เดิมเขียนที่นี่ด้วย `saveFieldValues` ซึ่งเปิดทรานแซกชันของตัวเอง
        พร้อมคอมเมนต์ว่าทำแบบนั้นเพื่อไม่ถือล็อกบน `work_item` นาน และว่า
        ถ้าล้มก็กู้ได้ด้วย `rebuildSnapshot` — **ทั้งสองข้ออ้างไม่ถูก** ·
        `rebuildSnapshot` สร้าง snapshot ใหม่จาก EAV ได้ แต่ค่าที่ไม่เคย
        ถูกเขียนลง EAV เลย ไม่มีอะไรให้สร้างใหม่จาก

        ผลจริงที่วัดได้ (`loadtest:write 5 6`): 10 จาก 30 คำขอตอบ 500
        แต่การเก็บกวาดลบตั๋วไป 30 ใบ — ส่วนต่างคือตั๋วที่ค้างอยู่โดยขาด
        ฟิลด์บังคับ เดินนาฬิกา SLA อยู่ในคิว และผู้แจ้งเชื่อว่าแจ้งไม่สำเร็จ
      */
      /*
        ปลุกกฎ **หลังเขียนฟิลด์เสร็จ** ไม่ใช่ทันทีที่สร้างงาน — กฎที่ดูป้าย
        หรือฟิลด์กำหนดเอง จะอ่านได้ค่าว่างถ้าปลุกก่อน แล้วมันจะ "ไม่ทำงาน
        บางครั้ง" โดยไม่มีอะไรฟ้อง
      */
      await fireAutomation(ctx, created.itemKey, 'item.created');
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
        resolution: { select: { name: true } },
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
      /**
       * ฟิลด์เพิ่มเติมพร้อมชื่อที่คนอ่านได้
       *
       * `fieldSnapshot` ดิบใช้คีย์ระบบ (`impact`, `urgency`) ซึ่งไม่มีความหมาย
       * กับผู้ใช้ · แปลงเป็นชื่อฟิลด์ตามลำดับที่ผู้ดูแลตั้งไว้
       */
      fields: await displayFieldsFor(ctx, item.projectId, item.issueTypeId, item.fieldSnapshot),
      sla: sla.get(item.id.toString()) ?? null,
      /*
        ความพอใจ · `canRate` บอกหน้าจอว่าจะโชว์แบบฟอร์มหรือแค่ผลลัพธ์
        เงื่อนไขเดียวกับที่ service ใช้ปฏิเสธ — หน้าจอไม่ได้คิดกฎเอง
      */
      satisfaction: await satisfactionFor(ctx, item.itemKey),
      canRate: item.reporterId === ctx.actorId && item.resolvedAt !== null,
      // ให้หน้าจอซ่อนปุ่มที่กดไม่ได้ — ไม่ใช่กลไกป้องกัน เซิร์ฟเวอร์ปฏิเสธเองอยู่แล้ว
      permissions: await summaryFor(ctx, item.projectId),
      // ตัวเลือกสำหรับฟอร์มแก้ไข ส่งมาพร้อมหน้าเลย ไม่ต้องยิงอีกคำขอ
      priorities: await listPriorities(ctx),
      /**
       * ผลการแก้ไข — "จบเรื่องนี้ยังไง"
       *
       * ต่างจากสถานะซึ่งบอกว่างานอยู่ตรงไหน · งานที่ปิดเพราะแก้ได้จริง
       * กับงานที่ปิดเพราะซ้ำกับใบอื่น อยู่สถานะเดียวกันแต่คนละเรื่องกันสิ้นเชิง
       * และรายงานทุกตัวที่แยกตามผลลัพธ์อ่านค่านี้
       */
      resolution: item.resolution?.name ?? null,
      resolutions: await listResolutions(ctx),
      /*
        ความสัมพันธ์กับเรื่องอื่น — ส่งมาพร้อมหน้า ไม่ยิงอีกคำขอ
        `linksOf` กรองปลายทางที่ผู้ใช้เปิดดูไม่ได้ออกให้แล้ว
      */
      links: await linksOf(ctx, item.id),
      // บทความที่แนบไว้ — กรองที่ยังไม่เผยแพร่ออกให้แล้วตามสิทธิ์ผู้อ่าน
      articles: await articlesOf(ctx, item.id),
      // ลำดับชั้น — เรื่องหลักและงานย่อยพร้อมความคืบหน้า
      parent: await parentOf(ctx, item.id),
      children: await childrenOf(ctx, item.id),
      // ผู้เฝ้าดู — ให้หน้าจอแสดงปุ่มที่ถูกด้าน และบอกว่ามีใครตามเรื่องนี้อยู่บ้าง
      watching: await isWatching(ctx, item.id),
      watchers: await watchersOf(ctx, item.id),
      linkTypes: LINK_TYPES.map((t) => ({ value: t, label: LINK_TYPE_LABEL[t] })),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      // ปุ่มที่ผู้ใช้คนนี้เห็นได้จริง — ผ่าน CONDITION ชั้นแรกของ workflow engine แล้ว
      transitions: transitions.map((t) => ({
        id: t.id.toString(),
        name: t.name,
        // หน้าจอถามก่อนกด แทนที่จะให้กดแล้วเจอ 422 พร้อมรายชื่อฟิลด์ที่ขาด
        requiredFields: t.requiredFields,
      })),
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
    @Body() body: { body?: string; isInternal?: boolean | string; mentions?: unknown },
  ): Promise<unknown> {
    if (ctx.actorId === null) {
      throw new HttpException({ message: 'ไม่พบผู้ใช้สำหรับเขียนความเห็น' }, HttpStatus.FORBIDDEN);
    }
    try {
      const added = await addComment(ctx, {
        itemKey: key,
        body: body.body ?? '',
        // มาจาก JSON ดิบ — "true" เป็นสตริงได้ ต้องแปลงเอง ไม่ใช่เชื่อชนิดที่ประกาศ
        isInternal: body.isInternal === true || body.isInternal === 'true',
        /*
          รายการคนที่หน้าจอบอกว่าถูกกล่าวถึง — service ไม่เชื่อมันตรง ๆ
          ตรวจสิทธิ์ทุกคน และตรวจว่า `@ชื่อ` อยู่ในข้อความจริงก่อนยอมรับ
        */
        mentions: Array.isArray(body.mentions)
          ? body.mentions.filter((m): m is string => typeof m === 'string')
          : [],
      });
      await fireAutomation(ctx, key, 'comment.added');
      return added;
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
   * แก้ไขความเห็นของตัวเอง
   *
   * `403` เมื่อไม่ใช่ผู้เขียน — **ไม่มีสิทธิ์ไหนเปิดทางให้แก้ข้อความของคนอื่น**
   * ข้อความปฏิเสธจึงบอกทางออกที่ถูก (ลบแล้วเขียนใหม่) ไม่ใช่ให้ไปหาสิทธิ์เพิ่ม
   */
  @Patch(':key/comments/:commentId')
  @HttpCode(HttpStatus.OK)
  async editComment(
    @Ctx() ctx: TenantContext,
    @Param('commentId') commentId: string,
    @Body() body: { body?: unknown },
  ): Promise<{ ok: true }> {
    const id = parseCommentId(commentId);
    try {
      await editComment(ctx, id, typeof body.body === 'string' ? body.body : '');
      return { ok: true };
    } catch (e) {
      throw toCommentHttpError(e);
    }
  }

  /** ลบความเห็น — ผู้เขียนลบของตัวเองได้เสมอ ลบของคนอื่นต้องมี `DELETE_COMMENT` */
  @Delete(':key/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeComment(
    @Ctx() ctx: TenantContext,
    @Param('commentId') commentId: string,
  ): Promise<void> {
    const id = parseCommentId(commentId);
    try {
      await deleteComment(ctx, id);
    } catch (e) {
      throw toCommentHttpError(e);
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
   * ลบไฟล์แนบ
   *
   * ไม่รับ `:key` ของงานในเส้นทาง เพราะ id ของไฟล์ชี้ไปงานอยู่แล้ว — เส้นทางที่
   * รับทั้งคู่เปิดช่องให้ส่งคู่ที่ไม่เข้ากันมา แล้วต้องมีโค้ดตรวจว่าตรงกันไหม
   * ซึ่งเป็นโค้ดที่ลืมเขียนได้ · กติกาเดียวกับ `download` ที่อยู่ข้างบน
   */
  @Delete('attachments/:id')
  @HttpCode(HttpStatus.OK)
  async removeAttachment(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    if (!/^[0-9]+$/.test(id)) {
      throw new HttpException(
        { error: 'invalid_input', message: 'รหัสไฟล์แนบไม่ถูกต้อง' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      await deleteAttachment(ctx, BigInt(id));
      return { ok: true };
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

  /**
   * รายชื่อคนที่เรียกถึงได้ในเรื่องนี้
   *
   * แยกจาก `assignable` เพราะเกณฑ์คนละอย่าง — เรียกถึงได้ถ้าเปิดโปรเจกต์ได้
   * ส่วนรับงานได้ต้องมีสิทธิ์อีกชุด · การใช้รายการเดียวกันจะตัดคนที่รู้คำตอบ
   * แต่รับงานไม่ได้ ออกจากเมนูเรียกถึงเงียบ ๆ
   */
  @Get(':key/mentionable')
  async mentionable(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
  ): Promise<{ rows: Array<{ id: string; displayName: string }> }> {
    const item = await tenantScoped(ctx).workItem.findFirst({
      where: { itemKey: key },
      select: { projectId: true },
    });
    if (item === null) {
      throw new HttpException({ error: 'not_found', message: `ไม่พบงาน ${key}` }, HttpStatus.NOT_FOUND);
    }
    // รายชื่อนี้เปิดเผยว่าใครอยู่ในโปรเจกต์ — ต้องคอมเมนต์ได้ก่อนถึงจะขอดูได้
    await assertCan(ctx, item.projectId, 'ADD_COMMENT');
    return { rows: await mentionableUsers(ctx, item.projectId) };
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
    @Body() body: { resolution?: string | null },
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
      const result = await applyTransition(ctx, item.id, BigInt(transitionId), ctx.actorId, {
        resolutionName: body.resolution ?? null,
      });
      const status = await db.workflowStatus.findFirst({
        where: { id: result.toStatusId },
        select: { name: true, category: true },
      });
      /*
        ปลุกกฎหลังสถานะเปลี่ยนจริงแล้ว — กฎต้องเห็นสถานะใหม่ ไม่ใช่สถานะเดิม

        ส่งชื่อปุ่มไปด้วย เพราะเงื่อนไข "เมื่อกดปุ่มชื่อนี้" ต่างจาก "เมื่อสถานะ
        กลายเป็นนี้" — สองปุ่มพาไปสถานะเดียวกันได้ และผู้ดูแลตั้งกฎแยกกัน
      */
      const pressed = await db.workflowTransition.findUnique({
        where: { id: BigInt(transitionId) },
        select: { name: true },
      });
      await fireAutomation(ctx, key, 'item.transitioned', {
        ...(pressed === null ? {} : { transitionName: pressed.name }),
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
      if (e instanceof UnknownResolutionError) {
        // 422 ไม่ใช่ 500 — หน้าจอส่งชื่อที่ไม่มีในระบบมา ซึ่งเป็นข้อมูลผิด ไม่ใช่ระบบพัง
        throw new HttpException(
          { error: 'unknown_resolution', message: e.message },
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

  /**
   * แก้ไขหลายเรื่องพร้อมกัน
   *
   * **ตอบ 200 แม้บางใบทำไม่สำเร็จ** — ผลรายใบอยู่ใน `items`
   * ชุดที่สำเร็จ 48 จาก 50 ใบไม่ใช่คำขอที่ผิด และการตอบ 4xx จะทำให้หน้าจอ
   * ทิ้งผลทั้งชุดแล้วบอกว่า "ล้มเหลว" ทั้งที่ 48 ใบถูกแก้ไปแล้วจริง
   *
   * 4xx เก็บไว้สำหรับความผิดพลาดที่เป็นของ **คำขอทั้งชุด**:
   * ไม่ได้เลือกอะไร · เกินเพดาน · ค่าที่กรอกไม่มีอยู่จริง · ไม่มีสิทธิ์
   */
  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  async bulk(
    @Ctx() ctx: TenantContext,
    @Body()
    body: { itemKeys?: unknown; assigneeId?: unknown; priorityRank?: unknown },
  ): Promise<BulkEditResult & { max: number }> {
    if (ctx.actorId === null) {
      throw new HttpException({ message: 'ไม่พบผู้ใช้สำหรับแก้ไขงาน' }, HttpStatus.FORBIDDEN);
    }
    const keys = Array.isArray(body.itemKeys)
      ? body.itemKeys.filter((k): k is string => typeof k === 'string')
      : [];

    /*
      แยก "ไม่ส่งฟิลด์" ออกจาก "ส่ง null" ให้ชัดตั้งแต่ขอบ HTTP
      ไม่ส่ง = ไม่แตะ · null = ล้างค่า · JSON แยกสองอย่างนี้ได้ แต่ต้องเขียนให้ตรง
    */
    const changes: { assigneeId?: bigint | null; priorityRank?: number | null } = {};
    if ('assigneeId' in body) {
      const raw = body.assigneeId;
      /*
        แปลงจากชนิดที่รู้แน่เท่านั้น — `String(unknown)` ให้ `[object Object]`
        เมื่อมีคนส่ง object มา แล้ว `BigInt()` จะโยน error ที่อ่านไม่ออกเลย
        (บทเรียนเดียวกับที่ CLAUDE.md บันทึกไว้)
      */
      changes.assigneeId =
        typeof raw === 'string' && raw !== ''
          ? BigInt(raw)
          : typeof raw === 'number'
            ? BigInt(raw)
            : null;
    }
    if ('priorityRank' in body) {
      const raw = body.priorityRank;
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw !== '' ? Number(raw) : null;
      changes.priorityRank = n === null || Number.isNaN(n) ? null : n;
    }

    try {
      return { ...(await bulkEditWorkItems(ctx, keys, changes)), max: BULK_MAX };
    } catch (e) {
      if (e instanceof BulkTooManyItemsError) {
        throw new HttpException(
          { error: 'too_many_items', message: e.message, max: BULK_MAX },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (e instanceof NothingSelectedError) {
        throw new HttpException(
          { error: 'nothing_selected', message: e.message },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (e instanceof InvalidFieldValueError || e instanceof AssigneeNotEligibleError) {
        throw new HttpException(
          { error: 'invalid_value', message: e.message },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw e;
    }
  }

  /**
   * ติด/ถอดป้ายหลายเรื่องพร้อมกัน
   *
   * `add` และ `remove` แยกกันโดยตั้งใจ — ไม่มีทาง "เขียนทับทั้งชุด" จาก
   * ปลายทางนี้ เพราะการเขียนทับเป็นชุดจะลบป้ายเดิมของทุกใบโดยไม่มีใครตั้งใจ
   */
  @Post('bulk/labels')
  @HttpCode(HttpStatus.OK)
  async bulkLabels(
    @Ctx() ctx: TenantContext,
    @Body() body: { itemKeys?: unknown; fieldId?: unknown; add?: unknown; remove?: unknown },
  ): Promise<BulkLabelResult & { max: number }> {
    const keys = Array.isArray(body.itemKeys)
      ? body.itemKeys.filter((k): k is string => typeof k === 'string')
      : [];
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

    // รหัสฟิลด์ที่ไม่ใช่ตัวเลขคือคำขอที่พัง ไม่ใช่ฟิลด์ที่ไม่มีสิทธิ์
    let fieldId: bigint;
    try {
      fieldId = BigInt(typeof body.fieldId === 'string' ? body.fieldId : Number(body.fieldId));
    } catch {
      throw new HttpException(
        { error: 'invalid_field', message: 'ไม่พบฟิลด์ป้ายที่เลือก' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      const res = await bulkEditLabels(ctx, keys, {
        fieldId,
        add: strings(body.add),
        remove: strings(body.remove),
      });
      return { ...res, max: BULK_MAX };
    } catch (e) {
      if (e instanceof NotALabelFieldError) {
        throw new HttpException(
          { error: 'invalid_field', message: e.message },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw toBulkHttpError(e);
    }
  }

  /** ฟิลด์ป้ายที่เลือกแก้เป็นชุดได้ */
  @Get('bulk/label-fields')
  async bulkLabelFields(
    @Ctx() ctx: TenantContext,
  ): Promise<{ rows: Array<{ id: string; name: string }> }> {
    return { rows: await labelFields(ctx) };
  }

  /**
   * ปุ่มที่กดได้กับงานทั้งชุด
   *
   * แยกจาก `POST bulk/transition` เพราะหน้าจอต้องรู้ **ก่อนกด** ว่าปุ่มไหน
   * ขยับได้กี่ใบและขอกรอกอะไร · ปุ่มที่กดแล้วล้มทุกใบคือปุ่มที่ไม่ควรแสดง
   *
   * เป็น POST ทั้งที่อ่านอย่างเดียว เพราะรายการคีย์ยาวถึง 50 ใบ ซึ่งเกิน
   * ความยาว URL ที่ปลอดภัยเมื่อคีย์เป็นภาษาไทยและถูก percent-encode
   */
  @Post('bulk/transitions')
  @HttpCode(HttpStatus.OK)
  async bulkTransitionChoices(
    @Ctx() ctx: TenantContext,
    @Body() body: { itemKeys?: unknown },
  ): Promise<{ options: BulkTransitionOption[]; resolutions: string[]; max: number }> {
    const keys = Array.isArray(body.itemKeys)
      ? body.itemKeys.filter((k): k is string => typeof k === 'string')
      : [];
    try {
      /*
        ส่งรายการผลการแก้ไขมาพร้อมกัน — หน้าจอที่ถามว่า "กดปุ่มไหนได้"
        ต้องได้คำตอบว่า "แล้วต้องกรอกอะไร และค่าที่กรอกได้มีอะไรบ้าง" ในคำตอบเดียว
        มิฉะนั้นรายการตัวเลือกกับค่าที่เซิร์ฟเวอร์ยอมรับจะเป็นคนละชุดได้
      */
      const [options, resolutions] = await Promise.all([
        bulkTransitionOptions(ctx, keys),
        listResolutions(ctx),
      ]);
      return { options, resolutions, max: BULK_MAX };
    } catch (e) {
      throw toBulkHttpError(e);
    }
  }

  /**
   * กดปุ่มเดียวกันกับงานหลายใบ
   *
   * `200` แม้บางใบล้ม — เหตุผลเดียวกับ `POST bulk` ข้างบน · ใบที่ตัวตรวจของ
   * workflow ปฏิเสธไม่ใช่คำขอที่ผิด แต่เป็นผลลัพธ์ที่ผู้ใช้ต้องอ่าน
   */
  @Post('bulk/transition')
  @HttpCode(HttpStatus.OK)
  async bulkTransition(
    @Ctx() ctx: TenantContext,
    @Body() body: { itemKeys?: unknown; transitionName?: unknown; resolutionName?: unknown },
  ): Promise<BulkTransitionResult & { max: number }> {
    const keys = Array.isArray(body.itemKeys)
      ? body.itemKeys.filter((k): k is string => typeof k === 'string')
      : [];
    // แปลงจากชนิดที่รู้แน่เท่านั้น — ค่าอื่นถือว่าไม่ได้ส่งมา
    const transitionName = typeof body.transitionName === 'string' ? body.transitionName : '';
    const resolutionName = typeof body.resolutionName === 'string' ? body.resolutionName : null;
    try {
      const res = await bulkTransitionWorkItems(ctx, keys, { transitionName, resolutionName });
      return { ...res, max: BULK_MAX };
    } catch (e) {
      throw toBulkHttpError(e);
    }
  }

  /**
   * ผูก/ถอดเรื่องหลัก
   *
   * `422` เมื่อชั้นไม่ต่อกัน · ข้ามโปรเจกต์ · วนกลับมาหาตัวเอง — ทั้งหมดเป็น
   * ความผิดของคำขอ ไม่ใช่ของงาน · ข้อความบอกเหตุผลที่ผู้ใช้แก้ได้เอง
   */
  @Post(':key/parent')
  @HttpCode(HttpStatus.OK)
  async setItemParent(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { parentKey?: unknown },
  ): Promise<{ ok: true }> {
    // ไม่ส่งมา หรือส่งค่าที่ไม่ใช่สตริง = ถอดออก
    const parentKey = typeof body.parentKey === 'string' ? body.parentKey : null;
    try {
      await setParent(ctx, key, parentKey === '' ? null : parentKey);
      return { ok: true };
    } catch (e) {
      if (e instanceof HierarchyTargetNotFoundError) {
        throw new HttpException({ message: e.message }, HttpStatus.NOT_FOUND);
      }
      if (
        e instanceof SelfParentError ||
        e instanceof WrongHierarchyLevelError ||
        e instanceof CrossProjectParentError ||
        e instanceof HierarchyCycleError
      ) {
        throw new HttpException(
          { error: 'invalid_parent', message: e.message },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw e;
    }
  }

  /**
   * แนบ/ถอดบทความคลังความรู้กับเรื่องนี้
   *
   * `helpful` ส่งมาเมื่อไรก็บันทึกทันที — เป็นข้อมูลเดียวที่บอกได้ว่าบทความไหน
   * คุ้มค่าที่จะดูแลต่อ และบทความไหนเขียนไว้แล้วไม่มีใครใช้
   */
  @Post(':key/articles')
  @HttpCode(HttpStatus.OK)
  async attachArticleToItem(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { articleId?: unknown; helpful?: unknown },
  ): Promise<{ ok: true }> {
    let articleId: bigint;
    try {
      articleId = BigInt(typeof body.articleId === 'string' ? body.articleId : Number(body.articleId));
    } catch {
      throw new HttpException({ message: 'ไม่พบบทความที่ระบุ' }, HttpStatus.NOT_FOUND);
    }
    try {
      if (typeof body.helpful === 'boolean') {
        await rateArticle(ctx, key, articleId, body.helpful);
      } else {
        await attachArticle(ctx, key, articleId);
      }
      return { ok: true };
    } catch (e) {
      if (e instanceof ArticleNotFoundError) {
        throw new HttpException({ message: e.message }, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }

  @Delete(':key/articles/:articleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async detachArticleFromItem(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Param('articleId') articleId: string,
  ): Promise<void> {
    let id: bigint;
    try {
      id = BigInt(articleId);
    } catch {
      throw new HttpException({ message: 'ไม่พบบทความที่ระบุ' }, HttpStatus.NOT_FOUND);
    }
    try {
      await detachArticle(ctx, key, id);
    } catch (e) {
      if (e instanceof ArticleNotFoundError) {
        throw new HttpException({ message: e.message }, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }

  /**
   * เฝ้าดู / เลิกเฝ้าดู
   *
   * ปุ่มเดียวสองสถานะ — ส่ง `watching` กลับมาเสมอ เพื่อให้หน้าจอไม่ต้องเดา
   * ว่าตอนนี้อยู่ด้านไหน · กดซ้ำไม่ใช่ความผิดพลาด
   */
  @Post(':key/watch')
  @HttpCode(HttpStatus.OK)
  async setWatch(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { watching?: unknown },
  ): Promise<{ watching: boolean }> {
    // ไม่ส่งค่ามา = เฝ้าดู · ค่าที่ไม่ใช่ boolean ถือว่าไม่ได้ส่ง
    const wants = typeof body.watching === 'boolean' ? body.watching : true;
    try {
      return wants ? await watch(ctx, key) : await unwatch(ctx, key);
    } catch (e) {
      if (e instanceof WatchTargetNotFoundError) {
        throw new HttpException({ message: e.message }, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }

  /**
   * เชื่อมเรื่องนี้เข้ากับอีกเรื่อง
   *
   * `422` เมื่อเชื่อมกับตัวเองหรือซ้ำ — เป็นความผิดของคำขอ
   * `404` เมื่อปลายทางไม่มีอยู่จริง **หรือเปิดดูไม่ได้** — service ตั้งใจตอบ
   * เหมือนกันทั้งสองกรณี เพื่อไม่ยืนยันว่าเลขที่เรื่องนั้นมีอยู่
   */
  /**
   * ผลกระทบของปัญหา — เรื่องที่ใบนี้เป็นสาเหตุ
   *
   * แยกจาก payload ของหน้ารายละเอียด เพราะปัญหาใบเดียวเป็นสาเหตุของเรื่อง
   * ได้เป็นร้อยใบ · คนส่วนใหญ่เปิดหน้านี้เพื่ออ่านเรื่อง ไม่ใช่เพื่อดูผลกระทบ
   *
   * งานที่ไม่ได้เป็นสาเหตุของอะไรเลย ตอบ `total: 0` ไม่ใช่ 404 —
   * "ยังไม่มีผลกระทบ" กับ "ไม่มีงานใบนี้" เป็นคนละคำตอบ
   */
  @Get(':key/problem-impact')
  async problemImpact(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
  ): Promise<{
    impact: Awaited<ReturnType<typeof problemImpactOf>>['impact'];
    incidents: Array<{
      itemKey: string;
      summary: string;
      statusCategory: string;
      projectKey: string;
      createdAt: string;
      resolvedAt: string | null;
    }>;
  }> {
    const item = await tenantScoped(ctx).workItem.findFirst({
      where: { itemKey: key },
      select: { id: true, projectId: true },
    });
    if (item === null) {
      throw new HttpException(
        { error: 'not_found', message: `ไม่พบงาน ${key}` },
        HttpStatus.NOT_FOUND,
      );
    }
    await assertCan(ctx, item.projectId, 'BROWSE_PROJECT');

    const r = await problemImpactOf(ctx, item.id);
    return {
      impact: r.impact,
      incidents: r.incidents.map((i) => ({
        itemKey: i.itemKey,
        summary: i.summary,
        statusCategory: i.statusCategory,
        projectKey: i.projectKey,
        createdAt: i.createdAt.toISOString(),
        resolvedAt: i.resolvedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * วิธีแก้จากปัญหาที่เป็นสาเหตุ (Known Error)
   *
   * ทิศตรงข้ามกับ `problem-impact` — ที่นั่นถามจากฝั่งปัญหาว่าทำให้อะไรเกิดบ้าง
   * ที่นี่ถามจากฝั่งเรื่องว่า **"เกิดจากปัญหาอะไร และปัญหานั้นมีวิธีแก้แล้วหรือยัง"**
   *
   * แยกจาก payload ของหน้ารายละเอียดเพราะต้องอ่านบทความของทุกปัญหาต้นทาง ·
   * เรื่องส่วนใหญ่ไม่มีปัญหาต้นทางเลย การใส่ไว้ในเส้นทางหลักจึงเป็นค่าใช้จ่าย
   * ที่ทุกใบต้องจ่ายเพื่อคำตอบว่าง
   *
   * ไม่มีวิธีแก้ ตอบ `[]` ไม่ใช่ 404 — "ยังไม่มีใครเขียนไว้" กับ "ไม่มีงานใบนี้"
   * เป็นคนละคำตอบ
   */
  @Get(':key/workarounds')
  async workarounds(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
  ): Promise<{ rows: Workaround[] }> {
    const item = await tenantScoped(ctx).workItem.findFirst({
      where: { itemKey: key },
      select: { id: true, projectId: true },
    });
    if (item === null) {
      throw new HttpException(
        { error: 'not_found', message: `ไม่พบงาน ${key}` },
        HttpStatus.NOT_FOUND,
      );
    }
    await assertCan(ctx, item.projectId, 'BROWSE_PROJECT');
    return { rows: await workaroundsFor(ctx, item.id) };
  }

  @Post(':key/links')
  @HttpCode(HttpStatus.CREATED)
  async addLink(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { targetKey?: unknown; type?: unknown },
  ): Promise<{ id: string }> {
    const targetKey = typeof body.targetKey === 'string' ? body.targetKey : '';
    const raw = typeof body.type === 'string' ? body.type : '';
    // ชนิดที่ไม่รู้จักคือคำขอที่ผิด ไม่ใช่ค่าที่ควรตกไปเป็นค่าปริยาย
    const type = LINK_TYPES.find((t) => t === raw);
    if (type === undefined) {
      throw new HttpException(
        { error: 'unknown_link_type', message: 'ไม่รู้จักความสัมพันธ์ที่เลือก' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      const r = await linkWorkItems(ctx, key, targetKey, type);
      return { id: r.id.toString() };
    } catch (e) {
      throw toLinkHttpError(e);
    }
  }

  /** ถอดความสัมพันธ์ — ถอดจากฝั่งไหนก็ได้ เพราะเป็นแถวเดียวกัน */
  @Delete(':key/links/:linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeLink(
    @Ctx() ctx: TenantContext,
    @Param('linkId') linkId: string,
  ): Promise<void> {
    /*
      คีย์ที่ไม่ใช่ตัวเลขต้องตอบ 404 เหมือนลิงก์ที่ไม่มีอยู่ ไม่ใช่ระเบิดเป็น 500
      — `BigInt('abc')` โยน SyntaxError ซึ่งไปโผล่เป็น Internal Server Error
    */
    let id: bigint;
    try {
      id = BigInt(linkId);
    } catch {
      throw new HttpException({ message: 'ไม่พบความสัมพันธ์ที่ระบุ' }, HttpStatus.NOT_FOUND);
    }
    try {
      await unlinkWorkItems(ctx, id);
    } catch (e) {
      throw toLinkHttpError(e);
    }
  }

  /**
   * ให้คะแนนความพอใจ
   *
   * `403` ทั้งกรณี "ไม่ใช่ผู้แจ้ง" และ "ไม่พบเรื่อง" — service ตั้งใจตอบเหมือนกัน
   * เพื่อไม่ยืนยันว่าเลขที่เรื่องนั้นมีอยู่จริง
   */
  /**
   * คัดลอกเรื่อง
   *
   * **สำเนาเดินผ่านเส้นทางเดียวกับการแจ้งเรื่องปกติ** — ตรวจฟิลด์บังคับ
   * ออกคีย์ ตั้งนาฬิกา SLA และเขียน audit เหมือนกันทุกประการ ·
   * คำตอบมี `notCopied` ที่บอกว่าอะไรไม่ติดไปด้วยและทำไม เพื่อให้หน้าจอ
   * แสดงตรงกับที่โค้ดทำจริง ไม่ใช่ให้คนเขียนหน้าจอเดาเอง
   */
  @Post(':key/clone')
  @HttpCode(HttpStatus.CREATED)
  async clone(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
  ): Promise<{ id: string; itemKey: string; status: string; notCopied: typeof NOT_COPIED }> {
    try {
      const created = await cloneWorkItem(ctx, key);
      return {
        id: created.id.toString(),
        itemKey: created.itemKey,
        status: created.statusName,
        notCopied: NOT_COPIED,
      };
    } catch (e) {
      if (e instanceof WorkItemNotFoundForCloneError) {
        throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
      }
      if (e instanceof RequiredFieldsMissingError) {
        /*
          เกิดได้จริงเมื่อฟิลด์บังคับถูกเพิ่มหลังจากใบต้นทางถูกสร้าง ·
          บอกว่าขาดอะไร เพื่อให้คนไปเติมที่ใบต้นทางหรือกรอกเองได้
        */
        throw new HttpException(
          { error: 'validation_failed', message: e.message, missingFields: e.fields },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (e instanceof UnknownFieldOptionError) {
        throw new HttpException(
          { error: 'validation_failed', message: e.message },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw e;
    }
  }

  @Post(':key/rating')
  @HttpCode(HttpStatus.OK)
  async rate(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { rating?: unknown; comment?: unknown },
  ): Promise<{ rating: number }> {
    // แปลงจากชนิดที่รู้แน่เท่านั้น — ค่าที่ไม่ใช่ตัวเลขต้องไปตกที่ตัวตรวจช่วง
    const rating =
      typeof body.rating === 'number'
        ? body.rating
        : typeof body.rating === 'string'
          ? Number(body.rating)
          : Number.NaN;
    try {
      await rateWorkItem(ctx, key, {
        rating,
        ...(typeof body.comment === 'string' ? { comment: body.comment } : {}),
      });
      return { rating };
    } catch (e) {
      if (e instanceof NotTheReporterError) {
        throw new HttpException({ error: 'forbidden', message: e.message }, HttpStatus.FORBIDDEN);
      }
      if (e instanceof NotResolvedYetError || e instanceof RatingOutOfRangeError) {
        throw new HttpException(
          { error: 'invalid_input', message: e.message },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw e;
    }
  }

  /*
    เวลาของเรื่องหนึ่ง — สรุปพร้อมรายการบันทึกทั้งหมด

    สิทธิ์ตรวจใน service ทุกครั้ง · ที่นี่แปลง error เป็น HTTP เท่านั้น
  */
  @Get(':key/time')
  async time(@Ctx() ctx: TenantContext, @Param('key') key: string): Promise<TimeSummary> {
    try {
      return await timeOf(ctx, key);
    } catch (e) {
      throw toTimeHttp(e);
    }
  }

  @Post(':key/time')
  @HttpCode(HttpStatus.CREATED)
  async addWorkLog(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { spent?: unknown; startedAt?: unknown; note?: unknown },
  ): Promise<{ id: string; spentMinutes: number; spentText: string }> {
    /*
      แคบชนิดก่อนประกอบ ไม่ใช่เรียกซ้ำแล้ว assert — รอบที่สองคืน
      `string | undefined` เหมือนเดิม TypeScript จึงไม่รู้ว่ามันผ่านการตรวจแล้ว
      และ `as string` ที่ใส่ปิดปากมันคือการกลบ ไม่ใช่การพิสูจน์
    */
    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    const startedAt = str(body.startedAt);
    try {
      return await logWork(ctx, {
        itemKey: key,
        spent: str(body.spent) ?? '',
        ...(startedAt === undefined ? {} : { startedAt }),
        note: str(body.note) ?? null,
      });
    } catch (e) {
      throw toTimeHttp(e);
    }
  }

  /** ตั้งเวลาประมาณและเวลาที่เหลือ — ส่งค่าว่างเพื่อล้าง */
  @Post(':key/estimate')
  @HttpCode(HttpStatus.OK)
  async estimate(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { original?: unknown; remaining?: unknown },
  ): Promise<{ originalMinutes: number | null; remainingMinutes: number | null }> {
    const input: { original?: string | null; remaining?: string | null } = {};
    if (typeof body.original === 'string') input.original = body.original;
    if (typeof body.remaining === 'string') input.remaining = body.remaining;
    try {
      return await setEstimate(ctx, key, input);
    } catch (e) {
      throw toTimeHttp(e);
    }
  }

  @Delete(':key/time/:logId')
  @HttpCode(HttpStatus.OK)
  async removeWorkLog(
    @Ctx() ctx: TenantContext,
    @Param('logId') logId: string,
  ): Promise<{ deleted: string; spentMinutes: number }> {
    try {
      return await deleteWorkLog(ctx, BigInt(logId));
    } catch (e) {
      throw toTimeHttp(e);
    }
  }
}
