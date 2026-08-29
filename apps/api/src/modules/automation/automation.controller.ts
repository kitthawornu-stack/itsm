/**
 * ตั้งค่ากฎอัตโนมัติ — เฉพาะผู้ดูแล tenant
 *
 * สิทธิ์ตรวจใน service ทุกครั้ง (`assertTenantAdmin`) ที่นี่แปลง error เป็น HTTP
 * เท่านั้น — การซ่อนเมนูบนหน้าจอไม่ใช่การป้องกัน
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
  Query,
} from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { PermissionDeniedError } from '../permission';
import {
  DuplicateRuleNameError,
  InvalidRuleError,
  RuleNotFoundError,
  createRule,
  deleteRule,
  listRules,
  listRuns,
  ruleVocabulary,
  setRuleEnabled,
  updateRule,
  type RuleInput,
  type RuleView,
  type RunView,
} from './automation-admin.service';

function mapError(e: unknown): never {
  if (e instanceof RuleNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof DuplicateRuleNameError) {
    // 409 ไม่ใช่ 422 — ข้อมูลถูกต้องทุกอย่าง แต่ชนกับของที่มีอยู่
    throw new HttpException({ error: 'conflict', message: e.message }, HttpStatus.CONFLICT);
  }
  if (e instanceof InvalidRuleError) {
    throw new HttpException(
      { error: 'validation_failed', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (e instanceof PermissionDeniedError) {
    throw new HttpException({ message: e.message }, HttpStatus.FORBIDDEN);
  }
  throw e;
}

/** อ่าน body ที่มาจาก JSON ดิบ — ไม่เชื่อชนิดที่ประกาศไว้ */
function toInput(body: Record<string, unknown>): RuleInput {
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : [];
  const input: RuleInput = {
    name: typeof body.name === 'string' ? body.name : '',
    trigger: typeof body.trigger === 'string' ? body.trigger : '',
    conditions: list(body.conditions),
    actions: list(body.actions),
  };
  if (typeof body.projectKey === 'string') input.projectKey = body.projectKey;
  if (typeof body.sortOrder === 'number') input.sortOrder = body.sortOrder;
  return input;
}

@Controller('automation')
export class AutomationController {
  /**
   * ตัวเลือกที่หน้าจอเอาไปสร้างฟอร์ม
   *
   * หน้าจอ **ห้ามพิมพ์รายการเอง** — รายการที่พิมพ์ซ้ำจะไม่ตรงกับเอนจินในวันที่
   * มีคนเพิ่มชนิดใหม่ แล้วผู้ดูแลจะเลือกอะไรที่ระบบไม่รู้จักได้จากหน้าจอของเราเอง
   */
  @Get('vocabulary')
  vocabulary(): ReturnType<typeof ruleVocabulary> {
    return ruleVocabulary();
  }

  @Get('rules')
  async rules(@Ctx() ctx: TenantContext): Promise<RuleView[]> {
    try {
      return await listRules(ctx);
    } catch (e) {
      mapError(e);
    }
  }

  @Post('rules')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Ctx() ctx: TenantContext,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    try {
      return await createRule(ctx, toInput(body));
    } catch (e) {
      mapError(e);
    }
  }

  @Post('rules/:id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string; warnings: string[] }> {
    try {
      return await updateRule(ctx, BigInt(id), toInput(body));
    } catch (e) {
      mapError(e);
    }
  }

  /** เปิด/ปิด แยกจากการแก้ เพราะเป็นคำถามคนละข้อและต้องตอบได้ว่าใครเปิด */
  @Post('rules/:id/enabled')
  @HttpCode(HttpStatus.OK)
  async toggle(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { isEnabled?: unknown },
  ): Promise<{ id: string; isEnabled: boolean }> {
    try {
      return await setRuleEnabled(ctx, BigInt(id), body.isEnabled === true || body.isEnabled === 'true');
    } catch (e) {
      mapError(e);
    }
  }

  @Delete('rules/:id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
  ): Promise<{ deleted: string }> {
    try {
      return await deleteRule(ctx, BigInt(id));
    } catch (e) {
      mapError(e);
    }
  }

  /** ประวัติล่าสุด — ตอบคำถาม "ทำไมกฎไม่ทำงาน" ซึ่งถามบ่อยกว่าคำถามตรงข้าม */
  @Get('runs')
  async runs(@Ctx() ctx: TenantContext, @Query('limit') limit?: string): Promise<RunView[]> {
    try {
      const n = Number(limit);
      return await listRuns(ctx, Number.isFinite(n) && n > 0 ? n : 50);
    } catch (e) {
      mapError(e);
    }
  }
}
