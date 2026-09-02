/**
 * นโยบายระยะเวลาเก็บข้อมูล REST API — v1
 *
 * **สามเส้นทางแยกกันชัดเจน: ดู → ตั้ง → กดลบ** · ไม่มีเส้นทางไหนที่ตั้งค่า
 * แล้วลบทันทีในคำขอเดียว เพราะคนต้องได้เห็นจำนวนที่จะหายไปก่อนเสมอ
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { systemClock, type TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';

import { InvalidKeepDaysError, UnknownRetentionTargetError } from './retention';
import {
  retentionSettings,
  runRetention,
  setRetention,
  type RetentionRunResult,
  type RetentionView,
} from './retention.service';

function toHttp(e: unknown): never {
  if (e instanceof UnknownRetentionTargetError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof InvalidKeepDaysError) {
    throw new HttpException(
      { error: 'invalid_input', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw e;
}

@Controller('admin/retention')
export class RetentionController {
  /** สถานะปัจจุบันพร้อมจำนวนที่จะถูกลบถ้ากดตอนนี้ — ไม่ลบอะไรเลย */
  @Get()
  async list(@Ctx() ctx: TenantContext): Promise<RetentionView> {
    try {
      return await retentionSettings(ctx, systemClock.nowUtc());
    } catch (e) {
      return toHttp(e);
    }
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async set(
    @Ctx() ctx: TenantContext,
    @Body() body: { target?: unknown; keepDays?: unknown; isEnabled?: unknown },
  ): Promise<RetentionView> {
    const target = typeof body.target === 'string' ? body.target : '';
    if (target === '') {
      throw new HttpException(
        { error: 'invalid_input', message: 'ต้องระบุว่าเป็นข้อมูลชนิดไหน' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    /*
      **แปลงจากชนิดที่รู้แน่เท่านั้น** — ค่าที่ไม่ใช่ตัวเลขต้องกลายเป็น `NaN`
      แล้วไปตกที่ตัวตรวจ ไม่ใช่กลายเป็น 0 เงียบ ๆ ซึ่งแปลว่า "ลบทุกอย่าง"
    */
    const keepDays =
      typeof body.keepDays === 'number'
        ? body.keepDays
        : typeof body.keepDays === 'string' && body.keepDays.trim() !== ''
          ? Number(body.keepDays)
          : Number.NaN;
    const isEnabled = body.isEnabled === true;

    try {
      await setRetention(ctx, target, keepDays, isEnabled, systemClock.nowUtc());
      // คืนสถานะใหม่ทั้งชุด — หน้าจอจะได้ไม่ต้องเดาว่าจำนวนที่จะลบเปลี่ยนไปเท่าไร
      return await retentionSettings(ctx, systemClock.nowUtc());
    } catch (e) {
      return toHttp(e);
    }
  }

  /**
   * ลบจริง
   *
   * แยกเป็นเส้นทางของตัวเอง และเป็น `POST` ที่ไม่รับพารามิเตอร์อะไรเลย —
   * สิ่งที่จะถูกลบมาจากนโยบายที่บันทึกไว้แล้วเท่านั้น · การรับ `keepDays`
   * ตรงนี้ด้วย จะทำให้ลบได้โดยไม่ต้องผ่านการตรวจตอนบันทึก
   */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  async run(@Ctx() ctx: TenantContext): Promise<RetentionRunResult & { view: RetentionView }> {
    try {
      const now = systemClock.nowUtc();
      const result = await runRetention(ctx, now);
      return { ...result, view: await retentionSettings(ctx, now) };
    } catch (e) {
      return toHttp(e);
    }
  }
}
