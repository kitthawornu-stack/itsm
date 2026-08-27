/**
 * ตั้งค่าปฏิทินวันหยุด — เฉพาะผู้ดูแล tenant
 *
 * นี่คือส่วนที่หายไป: `assertCalendarYearVerified` มีด่านตรวจแล้ว แต่ถ้าไม่มี
 * ทางให้คนยืนยัน ด่านนั้นก็เป็นแค่ประตูที่ล็อกไว้โดยไม่มีกุญแจ
 */
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { systemClock, type TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { assertTenantAdmin } from '../permission';
import {
  CalendarNotFoundError,
  EmptyYearError,
  VerificationSourceRequiredError,
  calendarYearStatus,
  listCalendars,
  setHolidaysForYear,
  verifyCalendarYear,
} from './calendar.service';
import { fixedThaiHolidays, withSubstitutionDays } from './thai-holidays';

function mapError(e: unknown): never {
  if (e instanceof CalendarNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof VerificationSourceRequiredError || e instanceof EmptyYearError) {
    throw new HttpException(
      { error: 'invalid', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw e;
}

/** ปีปัจจุบันตามนาฬิกาที่ฉีดได้ — `new Date()` ตรง ๆ ทดสอบไม่ได้ (INVARIANT 6) */
const currentYear = (): number => systemClock.nowUtc().getUTCFullYear();

function yearOf(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2000 || n > 2999) return fallback;
  return n;
}

@Controller('admin/calendars')
export class CalendarController {
  /** ปฏิทินทั้งหมด พร้อมสถานะของปีนี้และปีหน้า */
  @Get()
  async list(@Ctx() ctx: TenantContext): Promise<{ rows: unknown[]; years: number[] }> {
    await assertTenantAdmin(ctx);
    const thisYear = currentYear();
    const years = [thisYear, thisYear + 1];
    return { rows: await listCalendars(ctx, years), years };
  }

  @Get(':id/years/:year')
  async year(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('year') year: string,
    @Query('suggest') suggest?: string,
  ): Promise<unknown> {
    await assertTenantAdmin(ctx);
    const y = yearOf(year, currentYear());
    try {
      const status = await calendarYearStatus(ctx, BigInt(id), y);
      return {
        ...status,
        /**
         * ร่างตั้งต้นจากวันหยุดตายตัว + วันหยุดชดเชยตามกฎทั่วไป
         *
         * **ไม่ใช่คำตอบ** — ขาดวันสำคัญทางจันทรคติทั้งหมด และ ครม. เปลี่ยน
         * วันหยุดชดเชยได้เสมอ · ส่งมาเพื่อไม่ให้ต้องพิมพ์ 15 บรรทัดแรกเอง
         * แล้วยังต้องนั่งเทียบกับประกาศจริงอยู่ดี
         */
        suggestion:
          suggest === '1'
            ? withSubstitutionDays(fixedThaiHolidays(y)).map((date) => ({
                date,
                name: 'วันหยุดราชการ (ร่าง — แก้ชื่อให้ตรงประกาศ)',
              }))
            : null,
      };
    } catch (e) {
      return mapError(e);
    }
  }

  @Post(':id/years/:year')
  async save(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('year') year: string,
    @Body() body: { holidays?: unknown },
  ): Promise<unknown> {
    await assertTenantAdmin(ctx);
    const y = yearOf(year, currentYear());
    const raw = Array.isArray(body.holidays) ? body.holidays : [];
    const entries = raw.map((r) => {
      const o = (r !== null && typeof r === 'object' ? r : {}) as Record<string, unknown>;
      return {
        date: typeof o['date'] === 'string' ? o['date'] : '',
        name: typeof o['name'] === 'string' ? o['name'] : '',
      };
    });
    try {
      const r = await setHolidaysForYear(ctx, BigInt(id), y, entries);
      // การบันทึกล้างคำยืนยันของปีนั้นเสมอ — บอกให้หน้าจอรู้ ไม่ใช่ให้ไปสังเกตเอง
      return { ...r, verificationCleared: true };
    } catch (e) {
      return mapError(e);
    }
  }

  @Post(':id/years/:year/verify')
  async verify(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('year') year: string,
    @Body() body: { source?: unknown },
  ): Promise<{ ok: true }> {
    await assertTenantAdmin(ctx);
    const y = yearOf(year, currentYear());
    try {
      await verifyCalendarYear(
        ctx,
        BigInt(id),
        y,
        typeof body.source === 'string' ? body.source : '',
      );
      return { ok: true };
    } catch (e) {
      return mapError(e);
    }
  }
}
