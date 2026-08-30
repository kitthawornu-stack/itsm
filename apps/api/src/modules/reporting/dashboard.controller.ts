/**
 * แดชบอร์ด REST API — v1
 *
 * `id` ของหน้ารับค่าพิเศษ `default` แปลว่า "หน้าเริ่มต้นที่ยังไม่ได้บันทึก" ·
 * ทำให้หน้าจอเรียกเส้นทางเดียวได้ทั้งกรณีที่ยังไม่มีใครสร้างอะไรเลย
 * และกรณีที่เปิดหน้าที่บันทึกไว้ — ไม่ต้องมีสองทางแยกในฝั่งเว็บ
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
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { systemClock, type TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { KNOWN_GADGET_KINDS } from './dashboard-layout';
import {
  DashboardNameRequiredError,
  DashboardNotFoundError,
  DuplicateDashboardNameError,
  GADGET_LABEL,
  NotDashboardOwnerError,
  TooManyDashboardsError,
  TooManyGadgetsError,
  UnknownGadgetKindError,
  addGadget,
  createDashboard,
  deleteDashboard,
  listDashboards,
  moveGadgetOn,
  openDashboard,
  removeGadget,
  updateDashboard,
  type DashboardRow,
  type DashboardView,
} from './dashboard.service';
import { RANGE_LABEL, type RangeKey } from './report-window';
import { NoReportAccessError } from './report.service';

const RANGES = Object.keys(RANGE_LABEL) as RangeKey[];

function toHttp(e: unknown): never {
  if (e instanceof DashboardNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof NotDashboardOwnerError) {
    throw new HttpException({ error: 'forbidden', message: e.message }, HttpStatus.FORBIDDEN);
  }
  if (e instanceof NoReportAccessError) {
    // ข้อความไม่บอกว่าขาดสิทธิ์อะไร — การไล่บอกทีละสิทธิ์คือการวาดแผนที่
    throw new HttpException({ error: 'forbidden', message: e.message }, HttpStatus.FORBIDDEN);
  }
  if (
    e instanceof DashboardNameRequiredError ||
    e instanceof DuplicateDashboardNameError ||
    e instanceof TooManyDashboardsError ||
    e instanceof TooManyGadgetsError ||
    e instanceof UnknownGadgetKindError
  ) {
    // 422 ไม่ใช่ 500 — ข้อมูลที่ส่งมาใช้ไม่ได้ ไม่ใช่ระบบพัง
    throw new HttpException(
      { error: 'invalid_state', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw e;
}

/** รหัสที่แปลงไม่ได้ต้องเป็น 422 ไม่ใช่ 500 จาก `BigInt()` ที่โยนเอง */
function idOf(raw: string): bigint {
  if (!/^[0-9]+$/.test(raw)) {
    throw new HttpException(
      { error: 'invalid_input', message: 'รหัสไม่ถูกต้อง' },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return BigInt(raw);
}

/**
 * ช่วงที่ไม่รู้จักตกกลับเป็น "เดือนนี้" ไม่ใช่ปฏิเสธทั้งคำขอ
 *
 * กติกาเดียวกับหน้ารายงาน — ค่าที่พังบน query string มักมาจากลิงก์เก่า
 * ที่ใครสักคนบุ๊กมาร์กไว้ ไม่ใช่การโจมตี
 */
function rangeOf(raw?: string): RangeKey {
  return RANGES.find((r) => r === raw) ?? 'this-month';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

@Controller('dashboards')
export class DashboardController {
  @Get()
  async list(@Ctx() ctx: TenantContext): Promise<{
    rows: DashboardRow[];
    kinds: Array<{ value: string; label: string }>;
    ranges: Array<{ key: string; label: string }>;
  }> {
    /*
      ส่งตัวเลือกมาพร้อมรายการ — หน้าจอจะได้ไม่ต้องพิมพ์ชนิดการ์ดซ้ำเอง
      รายการที่พิมพ์ซ้ำในหน้าจอคือรายการที่จะไม่ตรงกับเซิร์ฟเวอร์ในวันที่มีคนเพิ่มชนิด
    */
    return {
      rows: await listDashboards(ctx),
      kinds: KNOWN_GADGET_KINDS.map((k) => ({ value: k, label: GADGET_LABEL[k] })),
      ranges: RANGES.map((r) => ({ key: r, label: RANGE_LABEL[r] })),
    };
  }

  /** `id` = `default` แปลว่าหน้าเริ่มต้นที่ยังไม่ได้บันทึก */
  @Get(':id')
  async open(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Query('range') range?: string,
  ): Promise<DashboardView> {
    try {
      return await openDashboard(
        ctx,
        id === 'default' ? null : idOf(id),
        rangeOf(range),
        systemClock.nowUtc(),
      );
    } catch (e) {
      return toHttp(e);
    }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Ctx() ctx: TenantContext,
    @Body() body: { name?: unknown },
  ): Promise<{ id: string }> {
    try {
      const d = await createDashboard(ctx, str(body.name));
      return { id: d.id.toString() };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Put(':id')
  async update(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { name?: unknown; columns?: unknown; isShared?: unknown },
  ): Promise<{ ok: true }> {
    const changes: { name?: string; columns?: number; isShared?: boolean } = {};
    if (typeof body.name === 'string') changes.name = body.name;
    if (typeof body.columns === 'number') changes.columns = body.columns;
    if (typeof body.isShared === 'boolean') changes.isShared = body.isShared;
    try {
      await updateDashboard(ctx, idOf(id), changes);
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    try {
      await deleteDashboard(ctx, idOf(id));
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Post(':id/gadgets')
  @HttpCode(HttpStatus.CREATED)
  async add(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { kind?: unknown; column?: unknown; projectId?: unknown; title?: unknown },
  ): Promise<{ ok: true }> {
    const project = str(body.projectId);
    try {
      await addGadget(ctx, idOf(id), {
        kind: str(body.kind),
        column: typeof body.column === 'number' ? body.column : 0,
        projectId: project === '' ? null : idOf(project),
        title: str(body.title) === '' ? null : str(body.title),
      });
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Delete(':id/gadgets/:gadgetId')
  @HttpCode(HttpStatus.OK)
  async drop(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('gadgetId') gadgetId: string,
  ): Promise<{ ok: true }> {
    try {
      await removeGadget(ctx, idOf(id), idOf(gadgetId));
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }

  /**
   * ย้ายการ์ด — ทิศทางที่ไม่รู้จักถูกปฏิเสธ ไม่ใช่ตกไปเป็น `up`
   *
   * การเดาแทนผู้ใช้ทำให้ปุ่มที่ต่อสายผิดยังทำงาน "ได้" ซึ่งจะไม่มีใครเจอ
   * จนกว่าจะมีคนสงสัยว่าทำไมกดขวาแล้วมันขึ้น
   */
  @Post(':id/gadgets/:gadgetId/move')
  @HttpCode(HttpStatus.OK)
  async move(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('gadgetId') gadgetId: string,
    @Body() body: { direction?: unknown },
  ): Promise<{ ok: true }> {
    const dir = str(body.direction);
    if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') {
      throw new HttpException(
        { error: 'invalid_input', message: 'ทิศทางไม่ถูกต้อง' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      await moveGadgetOn(ctx, idOf(id), gadgetId, dir);
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }
}
