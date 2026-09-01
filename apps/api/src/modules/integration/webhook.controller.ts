/**
 * Webhook REST API — v1
 *
 * **ความลับออกจากเซิร์ฟเวอร์แค่สองที่**: ตอนสร้าง และตอนตั้งใหม่ ·
 * ไม่มีทางอ่านค่าเดิมกลับ · ผู้ดูแลที่ทำหาย ต้องตั้งใหม่แล้วไปแก้ที่ปลายทาง
 * ซึ่งเป็นสิ่งที่ควรทำอยู่แล้วเมื่อสงสัยว่ารั่ว
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
} from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { TRIGGERS } from '../automation';
import {
  DuplicateWebhookNameError,
  InvalidWebhookUrlError,
  UnknownWebhookEventError,
  WebhookNameRequiredError,
  WebhookNotFoundError,
  createWebhook,
  deleteWebhook,
  listWebhooks,
  rotateWebhookSecret,
  updateWebhook,
  type WebhookRow,
} from './webhook.service';

/**
 * ป้ายภาษาคนของเหตุการณ์
 *
 * `Record<..., string>` ผูกกับรายการจริง — เพิ่มเหตุการณ์ใหม่ในเอนจิน
 * แล้วลืมตั้งชื่อ จะเป็น type error ไม่ใช่ตัวเลือกที่ขึ้นหน้าจอเป็นรหัสระบบ
 */
const EVENT_LABEL: Record<(typeof TRIGGERS)[number], string> = {
  'item.created': 'มีเรื่องใหม่',
  'item.transitioned': 'เรื่องเปลี่ยนสถานะ',
  'comment.added': 'มีความเห็นใหม่',
  'sla.breached': 'หลุดกำหนด SLA',
  'item.idle': 'เรื่องเงียบมานาน',
};

function toHttp(e: unknown): never {
  if (e instanceof WebhookNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (
    e instanceof WebhookNameRequiredError ||
    e instanceof DuplicateWebhookNameError ||
    e instanceof InvalidWebhookUrlError ||
    e instanceof UnknownWebhookEventError
  ) {
    // 422 ไม่ใช่ 500 — ข้อมูลที่ส่งมาใช้ไม่ได้ ไม่ใช่ระบบพัง
    throw new HttpException(
      { error: 'invalid_state', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw e;
}

function idOf(raw: string): bigint {
  if (!/^[0-9]+$/.test(raw)) {
    throw new HttpException(
      { error: 'invalid_input', message: 'รหัสไม่ถูกต้อง' },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return BigInt(raw);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const events = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

@Controller('webhooks')
export class WebhookController {
  @Get()
  async list(@Ctx() ctx: TenantContext): Promise<{
    rows: WebhookRow[];
    events: Array<{ value: string; label: string }>;
  }> {
    try {
      return {
        rows: await listWebhooks(ctx),
        // ตัวเลือกมาจากเซิร์ฟเวอร์ — หน้าจอไม่พิมพ์รายการเหตุการณ์ซ้ำเอง
        events: TRIGGERS.map((t) => ({ value: t, label: EVENT_LABEL[t] })),
      };
    } catch (e) {
      return toHttp(e);
    }
  }

  /** ตอบความลับกลับไปครั้งเดียว — ไม่มีทางอ่านซ้ำ */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Ctx() ctx: TenantContext,
    @Body() body: { name?: unknown; url?: unknown; events?: unknown },
  ): Promise<{ id: string; secret: string }> {
    try {
      const r = await createWebhook(
        ctx,
        { name: str(body.name), url: str(body.url), events: events(body.events) },
        TRIGGERS,
      );
      return { id: r.id.toString(), secret: r.secret };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Put(':id')
  async update(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { name?: unknown; url?: unknown; events?: unknown; isActive?: unknown },
  ): Promise<{ ok: true }> {
    const changes: { name?: string; url?: string; events?: string[]; isActive?: boolean } = {};
    if (typeof body.name === 'string') changes.name = body.name;
    if (typeof body.url === 'string') changes.url = body.url;
    if (Array.isArray(body.events)) changes.events = events(body.events);
    if (typeof body.isActive === 'boolean') changes.isActive = body.isActive;
    try {
      await updateWebhook(ctx, idOf(id), changes, TRIGGERS);
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Post(':id/rotate')
  @HttpCode(HttpStatus.OK)
  async rotate(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
  ): Promise<{ secret: string }> {
    try {
      return await rotateWebhookSecret(ctx, idOf(id));
    } catch (e) {
      return toHttp(e);
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    try {
      await deleteWebhook(ctx, idOf(id));
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }
}
