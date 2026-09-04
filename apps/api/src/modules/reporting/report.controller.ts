/**
 * รายงาน — v1
 *
 * ไม่ใช่ endpoint ของผู้ดูแล tenant — หัวหน้าทีมที่ดูแลโปรเจกต์เดียวต้องดู
 * รายงานของโปรเจกต์ตัวเองได้ · สิทธิ์จึงเป็น `VIEW_REPORT` รายโปรเจกต์
 * ซึ่ง service ตรวจเองทุกครั้ง
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
} from '@nestjs/common';
import { scheduleFromRow, systemClock, type TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { PermissionDeniedError } from '../permission';
import { NoReportAccessError, reportSummary, type ReportSummary } from './report.service';
import { NoTimeReportAccessError, timeReport, type TimeReport } from './time-report.service';
import { RANGE_LABEL, windowFor, type RangeKey } from './report-window';
import {
  PIVOT_DIMENSIONS,
  PIVOT_DIMENSION_LABEL,
  SameDimensionError,
  UnknownPivotDimensionError,
  assertDimension,
  pivotReport,
  type PivotResult,
} from './pivot.service';
import {
  InvalidScheduleError,
  NotSignedInError,
  ScheduleNotFoundError,
  ScheduleProjectNotFoundError,
  TooManySchedulesError,
  createSchedule,
  deleteSchedule,
  mySchedules,
  setScheduleEnabled,
  type ScheduleRow,
} from './schedule.service';

/** แปลง error ของตารางเวลาเป็น HTTP */
function scheduleHttp(e: unknown): HttpException {
  if (e instanceof ScheduleProjectNotFoundError || e instanceof ScheduleNotFoundError) {
    return new HttpException({ message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof NotSignedInError) {
    return new HttpException({ message: e.message }, HttpStatus.UNAUTHORIZED);
  }
  if (e instanceof InvalidScheduleError || e instanceof TooManySchedulesError) {
    /*
      422 — คำขอถูกรูปแบบ แต่ค่าใช้ไม่ได้ · ข้อความมาจากตัวตรวจตรง ๆ
      เพราะมันรู้ว่าผิดตรงไหน ส่วนเราไม่รู้
    */
    return new HttpException({ message: e.message }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  if (e instanceof PermissionDeniedError) {
    return new HttpException({ message: e.message }, HttpStatus.FORBIDDEN);
  }
  return e instanceof HttpException
    ? e
    : new HttpException({ message: 'ทำรายการไม่สำเร็จ' }, HttpStatus.INTERNAL_SERVER_ERROR);
}

const RANGES = Object.keys(RANGE_LABEL) as RangeKey[];

@Controller('reports')
export class ReportController {
  @Get('summary')
  async summary(
    @Ctx() ctx: TenantContext,
    @Query('range') range?: string,
    @Query('project') projectId?: string,
  ): Promise<ReportSummary & { ranges: Array<{ key: string; label: string }> }> {
    /*
      ช่วงที่ไม่รู้จักตกกลับเป็น "เดือนนี้" ไม่ใช่ปฏิเสธทั้งคำขอ — ค่าที่พังบน
      query string มักมาจากลิงก์เก่าที่ใครสักคนบุ๊กมาร์กไว้ ไม่ใช่การโจมตี
    */
    const key: RangeKey = RANGES.find((r) => r === range) ?? 'this-month';
    const win = windowFor(key, systemClock.nowUtc());

    /*
      รหัสโปรเจกต์ที่ไม่ใช่ตัวเลขต้องตอบ 403 เหมือนโปรเจกต์ที่ไม่มีสิทธิ์
      ไม่ใช่ระเบิดเป็น 500 — `BigInt('abc')` โยน SyntaxError
    */
    let pid: bigint | undefined;
    if (projectId !== undefined && projectId !== '') {
      try {
        pid = BigInt(projectId);
      } catch {
        throw new HttpException({ message: 'ไม่พบโปรเจกต์ที่ระบุ' }, HttpStatus.FORBIDDEN);
      }
    }

    try {
      const data = await reportSummary(ctx, win, pid);
      return { ...data, ranges: RANGES.map((r) => ({ key: r, label: RANGE_LABEL[r] })) };
    } catch (e) {
      if (e instanceof NoReportAccessError || e instanceof PermissionDeniedError) {
        // ข้อความไม่บอกว่าขาดสิทธิ์อะไร — การไล่บอกทีละสิทธิ์คือการวาดแผนที่
        throw new HttpException({ message: e.message }, HttpStatus.FORBIDDEN);
      }
      throw e;
    }
  }

  /**
   * เวลาที่ทีมใช้ไปในช่วงหนึ่ง
   *
   * แยก endpoint จาก `summary` เพราะคนละคำถามและคนละต้นทุน — หน้าที่ถามแต่
   * ยอดแจ้งเข้า/ปิดได้ ไม่ควรต้องอ่านตาราง `work_log` ทั้งเดือนไปด้วย
   */
  @Get('time')
  async time(
    @Ctx() ctx: TenantContext,
    @Query('range') range?: string,
    @Query('project') projectId?: string,
  ): Promise<TimeReport & { ranges: Array<{ key: string; label: string }> }> {
    const key: RangeKey = RANGES.find((r) => r === range) ?? 'this-month';
    const win = windowFor(key, systemClock.nowUtc());

    let pid: bigint | undefined;
    if (projectId !== undefined && projectId !== '') {
      try {
        pid = BigInt(projectId);
      } catch {
        throw new HttpException({ message: 'ไม่พบโปรเจกต์ที่ระบุ' }, HttpStatus.FORBIDDEN);
      }
    }

    try {
      const data = await timeReport(ctx, win, pid === undefined ? {} : { projectId: pid });
      return { ...data, ranges: RANGES.map((r) => ({ key: r, label: RANGE_LABEL[r] })) };
    } catch (e) {
      if (e instanceof NoTimeReportAccessError || e instanceof PermissionDeniedError) {
        throw new HttpException({ message: e.message }, HttpStatus.FORBIDDEN);
      }
      throw e;
    }
  }

  /**
   * ตารางไขว้ — จัดกลุ่มสองมิติพร้อมกัน
   *
   * แยก endpoint จาก `summary` เพราะคนละคำถามและคนละต้นทุน
   *
   * **มิติที่ไม่รู้จักถูกปฏิเสธ ไม่ใช่ตกกลับเป็นค่าปริยาย** — ต่างจาก `range`
   * ที่ค่าพังมักมาจากลิงก์เก่า · มิติเป็นสิ่งที่ผู้ใช้เพิ่งเลือกจากเมนู
   * ค่าที่ไม่รู้จักจึงแปลว่ามีอะไรผิด และการตกกลับเงียบ ๆ จะให้ตารางที่
   * ตอบคนละคำถามกับที่กด โดยหน้าตายังดูปกติ
   */
  @Get('pivot')
  async pivot(
    @Ctx() ctx: TenantContext,
    @Query('range') range?: string,
    @Query('project') projectId?: string,
    @Query('rows') rows?: string,
    @Query('cols') cols?: string,
  ): Promise<PivotResult & { dimensions: Array<{ key: string; label: string }> }> {
    const key: RangeKey = RANGES.find((r) => r === range) ?? 'this-month';
    const win = windowFor(key, systemClock.nowUtc());

    let pid: bigint | undefined;
    if (projectId !== undefined && projectId !== '') {
      try {
        pid = BigInt(projectId);
      } catch {
        throw new HttpException({ message: 'ไม่พบโปรเจกต์ที่ระบุ' }, HttpStatus.FORBIDDEN);
      }
    }

    try {
      const data = await pivotReport(
        ctx,
        win,
        assertDimension(rows ?? 'assignee'),
        assertDimension(cols ?? 'status'),
        pid,
      );
      return {
        ...data,
        dimensions: PIVOT_DIMENSIONS.map((d) => ({ key: d, label: PIVOT_DIMENSION_LABEL[d] })),
      };
    } catch (e) {
      if (e instanceof UnknownPivotDimensionError || e instanceof SameDimensionError) {
        throw new HttpException({ message: e.message }, HttpStatus.UNPROCESSABLE_ENTITY);
      }
      if (e instanceof NoReportAccessError || e instanceof PermissionDeniedError) {
        throw new HttpException({ message: e.message }, HttpStatus.FORBIDDEN);
      }
      throw e;
    }
  }

  /** ตารางเวลาส่งรายงานของ **ผู้เรียกเอง** — ไม่มีใครเห็นของคนอื่น */
  @Get('schedules')
  async schedules(@Ctx() ctx: TenantContext): Promise<{ rows: ScheduleRow[] }> {
    try {
      return { rows: await mySchedules(ctx, systemClock.nowUtc()) };
    } catch (e) {
      throw scheduleHttp(e);
    }
  }

  /**
   * ตั้งตารางเวลาใหม่
   *
   * **เวลาที่ส่งมาเป็นเวลาไทย** ไม่ใช่ UTC — ผู้ใช้ตั้งเวลาที่เขามองเห็น
   * บนนาฬิกาของตัวเอง · ค่าที่ไม่ครบถูกปฏิเสธ ไม่ใช่เดาให้
   */
  @Post('schedules')
  @HttpCode(HttpStatus.CREATED)
  async addSchedule(
    @Ctx() ctx: TenantContext,
    @Body()
    body: {
      projectKey?: unknown;
      name?: unknown;
      kind?: unknown;
      hour?: unknown;
      minute?: unknown;
      weekday?: unknown;
      day?: unknown;
    },
  ): Promise<ScheduleRow> {
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    const num = (v: unknown): number | null =>
      typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : null;
    try {
      const schedule = scheduleFromRow({
        kind: str(body.kind),
        hour: num(body.hour) ?? -1,
        minute: num(body.minute) ?? -1,
        weekday: num(body.weekday),
        day: num(body.day),
      });
      return await createSchedule(
        ctx,
        str(body.projectKey),
        { name: str(body.name), schedule },
        systemClock.nowUtc(),
      );
    } catch (e) {
      throw scheduleHttp(e);
    }
  }

  /** เปิดหรือปิดตารางของตัวเอง — ปิดไว้ต่างจากลบทิ้ง */
  @Post('schedules/:id/enabled')
  @HttpCode(HttpStatus.OK)
  async toggleSchedule(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { enabled?: unknown },
  ): Promise<ScheduleRow> {
    try {
      return await setScheduleEnabled(ctx, id, body.enabled === true, systemClock.nowUtc());
    } catch (e) {
      throw scheduleHttp(e);
    }
  }

  /** ลบตารางของตัวเอง */
  @Post('schedules/:id/delete')
  @HttpCode(HttpStatus.OK)
  async removeSchedule(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    try {
      await deleteSchedule(ctx, id);
      return { ok: true };
    } catch (e) {
      throw scheduleHttp(e);
    }
  }
}
