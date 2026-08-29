/**
 * หน้าต่างเวลาดำเนินการเปลี่ยนแปลง REST API — v1
 *
 * แยกจาก `workitem.controller.ts` เพราะไฟล์นั้นยาว 1,800 บรรทัดแล้ว —
 * ไฟล์ที่ไม่มีใครอ่านจบ คือไฟล์ที่รีวิวไม่ได้จริง (กติกาเดียวกับขนาด PR)
 *
 * **การชนกับงานอื่นไม่ใช่ error** — ตอบ 200 พร้อมรายการที่ชน · การตอบ 422
 * จะทำให้หน้าจอต้องแยกแยะ "ผิดพลาด" กับ "ตั้งได้แต่ควรรู้" จาก status code
 * ซึ่งเป็นที่ที่ผิดสำหรับข้อมูลชนิดนี้
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
  Put,
  Query,
} from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import {
  BackwardWindowError,
  InFreezeWindowError,
  WindowTooLongError,
  WorkItemNotFoundForWindowError,
  changeCalendar,
  clearWindow,
  setWindow,
  windowOf,
  type CalendarEntry,
  type WindowView,
} from './change-window.service';

function toHttp(e: unknown): never {
  if (e instanceof WorkItemNotFoundForWindowError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (
    e instanceof BackwardWindowError ||
    e instanceof WindowTooLongError ||
    e instanceof InFreezeWindowError
  ) {
    // 422 ไม่ใช่ 500 — ข้อมูลที่ส่งมาใช้ไม่ได้ ไม่ใช่ระบบพัง
    throw new HttpException(
      { error: 'invalid_state', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw e;
}

@Controller('work-items/:key/change-window')
export class ChangeWindowController {
  @Get()
  async get(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
  ): Promise<{ window: WindowView | null }> {
    try {
      return { window: await windowOf(ctx, key) };
    } catch (e) {
      return toHttp(e);
    }
  }

  /**
   * ตั้งหรือแก้ — `PUT` เพราะหนึ่งงานมีหน้าต่างได้บานเดียว
   *
   * กดซ้ำด้วยค่าเดิมต้องได้ผลเดิม ไม่ใช่สร้างเพิ่ม
   */
  @Put()
  async set(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { plannedStart?: unknown; plannedEnd?: unknown; freezeOverrideReason?: unknown },
  ): Promise<{ window: WindowView }> {
    const start = typeof body.plannedStart === 'string' ? body.plannedStart : '';
    const end = typeof body.plannedEnd === 'string' ? body.plannedEnd : '';
    if (start === '' || end === '') {
      throw new HttpException(
        { error: 'invalid_input', message: 'ต้องระบุทั้งเวลาเริ่มและเวลาสิ้นสุด' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      return {
        window: await setWindow(ctx, key, {
          plannedStart: start,
          plannedEnd: end,
          ...(typeof body.freezeOverrideReason === 'string'
            ? { freezeOverrideReason: body.freezeOverrideReason }
            : {}),
        }),
      };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async clear(@Ctx() ctx: TenantContext, @Param('key') key: string): Promise<{ ok: true }> {
    try {
      await clearWindow(ctx, key);
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }
}

/** ปฏิทินการเปลี่ยนแปลง — แยก path เพราะไม่ผูกกับงานใบเดียว */
@Controller('change-calendar')
export class ChangeCalendarController {
  @Get()
  async list(
    @Ctx() ctx: TenantContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{ entries: CalendarEntry[]; freezes: WindowView['freezes'] }> {
    /*
      ไม่มีช่วงเวลามาให้ = ปฏิเสธ ไม่ใช่คืนทั้งหมด · การคืนทุกแถวเมื่อผู้เรียก
      ลืมใส่พารามิเตอร์ ทำให้คิวรีที่พังกลายเป็นคิวรีที่ช้าแทนที่จะเป็นคิวรีที่ error
    */
    if (from === undefined || to === undefined) {
      throw new HttpException(
        { error: 'invalid_input', message: 'ต้องระบุช่วงเวลา (from และ to)' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      throw new HttpException(
        { error: 'invalid_input', message: 'รูปแบบเวลาไม่ถูกต้อง' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return changeCalendar(ctx, from, to);
  }
}
