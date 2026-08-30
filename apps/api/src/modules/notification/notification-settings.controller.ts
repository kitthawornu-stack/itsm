/**
 * ตั้งค่าการแจ้งเตือน
 *
 * สองฝั่งอยู่คนละเส้นทางโดยตั้งใจ — `/admin/…` ต้องเป็นผู้ดูแลระบบ ส่วน
 * `/me/…` เป็นของผู้ใช้เอง · การรวมไว้เส้นทางเดียวแล้วแยกด้วยพารามิเตอร์
 * ทำให้พลาดง่ายว่าอันไหนต้องตรวจสิทธิ์
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
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { PermissionDeniedError } from '../permission';
import { EmptyAudienceError } from './audience-policy';
import {
  CannotMuteError,
  CannotMuteRoleError,
  ProjectNotFoundForRuleError,
  UnknownRoleError,
  UnknownChannelError,
  UnknownKindError,
  listAdminSwitches,
  listAudienceRules,
  myPreferences,
  setAdminSwitch,
  setAudienceRule,
  setMyPreference,
  type KindAudienceRow,
  type KindRow,
  type MyPreference,
} from './notification-admin.service';

function mapError(e: unknown): never {
  if (e instanceof CannotMuteRoleError || e instanceof UnknownRoleError) {
    throw new HttpException(
      { error: 'invalid_state', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (e instanceof EmptyAudienceError) {
    /*
      422 พร้อมข้อความที่บอกทางออก — ผู้ดูแลกำลังทำสิ่งที่ให้ผลเหมือนปิดทั้งชนิด
      แต่มองไม่เห็นจากหน้าจอ · การปฏิเสธเฉย ๆ โดยไม่บอกว่าให้ไปทำอะไรแทน
      จะทำให้เขาคิดว่าระบบพัง
    */
    throw new HttpException(
      { error: 'empty_audience', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (e instanceof CannotMuteError) {
    /*
      422 ไม่ใช่ 403 — ผู้ใช้มีสิทธิ์ตั้งค่า แต่ **ชนิดนี้ปิดไม่ได้เลย**
      สองอย่างนี้ผู้ใช้ต้องทำต่อคนละแบบ
    */
    throw new HttpException({ error: 'always_on', message: e.message }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  if (e instanceof UnknownKindError || e instanceof UnknownChannelError) {
    throw new HttpException(
      { error: 'validation_failed', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (e instanceof ProjectNotFoundForRuleError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof PermissionDeniedError) {
    throw new HttpException({ message: e.message }, HttpStatus.FORBIDDEN);
  }
  throw e;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const bool = (v: unknown): boolean => v === true || v === 'true';

/*
  เส้นทางแยกจาก `notifications` ที่เป็นกล่องแจ้งเตือน · สอง controller บนเส้นทาง
  เดียวกันทำให้ลำดับการจับคู่เส้นทางกลายเป็นเรื่องที่ต้องจำ — `:id/read` กับ
  `admin/switches` ไม่ชนกันวันนี้ แต่จะชนวันที่มีใครเพิ่มเส้นทางที่สั้นลง
*/
@Controller('notification-settings')
export class NotificationSettingsController {
  /** สวิตช์ของผู้ดูแล — ครบทุกชนิดที่ระบบรู้จัก รวมชนิดที่ยังไม่เคยตั้ง */
  @Get('admin/switches')
  async adminSwitches(@Ctx() ctx: TenantContext): Promise<KindRow[]> {
    try {
      return await listAdminSwitches(ctx);
    } catch (e) {
      mapError(e);
    }
  }

  @Post('admin/switches')
  @HttpCode(HttpStatus.OK)
  async setSwitch(
    @Ctx() ctx: TenantContext,
    @Body() body: { kind?: unknown; projectKey?: unknown; isEnabled?: unknown },
  ): Promise<{ kind: string; isEnabled: boolean }> {
    try {
      return await setAdminSwitch(ctx, {
        kind: str(body.kind),
        projectKey: str(body.projectKey),
        isEnabled: bool(body.isEnabled),
      });
    } catch (e) {
      mapError(e);
    }
  }

  /** ใครควรได้รับ — บทบาทผู้รับของแต่ละชนิด */
  @Get('admin/audience')
  async audience(@Ctx() ctx: TenantContext): Promise<KindAudienceRow[]> {
    try {
      return await listAudienceRules(ctx);
    } catch (e) {
      mapError(e);
    }
  }

  @Post('admin/audience')
  @HttpCode(HttpStatus.OK)
  async setAudience(
    @Ctx() ctx: TenantContext,
    @Body() body: { kind?: unknown; role?: unknown; projectKey?: unknown; isEnabled?: unknown },
  ): Promise<{ kind: string; role: string; isEnabled: boolean }> {
    try {
      return await setAudienceRule(ctx, {
        kind: str(body.kind),
        role: str(body.role),
        projectKey: str(body.projectKey),
        isEnabled: bool(body.isEnabled),
      });
    } catch (e) {
      mapError(e);
    }
  }

  /** ค่าของผู้ใช้ที่กำลังเรียก — ไม่ต้องขอสิทธิ์ใคร */
  @Get('me/preferences')
  async mine(@Ctx() ctx: TenantContext): Promise<MyPreference[]> {
    try {
      return await myPreferences(ctx);
    } catch (e) {
      mapError(e);
    }
  }

  @Post('me/preferences')
  @HttpCode(HttpStatus.OK)
  async setMine(
    @Ctx() ctx: TenantContext,
    @Body() body: { kind?: unknown; channel?: unknown; isEnabled?: unknown },
  ): Promise<{ kind: string; channel: string; isEnabled: boolean }> {
    try {
      return await setMyPreference(ctx, {
        kind: str(body.kind),
        channel: str(body.channel),
        isEnabled: bool(body.isEnabled),
      });
    } catch (e) {
      mapError(e);
    }
  }
}
