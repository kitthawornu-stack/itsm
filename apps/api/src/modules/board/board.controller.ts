/**
 * กระดานงาน — v1
 *
 * สิทธิ์ตรวจใน service ทุกครั้ง · ที่นี่แปลง error เป็น HTTP เท่านั้น
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
} from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { PermissionDeniedError } from '../permission';
import {
  BoardItemNotFoundError,
  NoTransitionForColumnError,
  boardOf,
  moveCard,
  rebalanceColumn,
  type BoardColumn,
} from './board.service';

function toHttp(e: unknown): unknown {
  if (e instanceof BoardItemNotFoundError) {
    return new HttpException({ message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof NoTransitionForColumnError) {
    /*
      422 ไม่ใช่ 403 — ผู้ใช้มีสิทธิ์เปลี่ยนสถานะ แต่ *เส้นทางนี้* ไม่มีอยู่
      จากสถานะปัจจุบัน · สองอย่างนี้ผู้ใช้ต้องทำต่อคนละแบบ
    */
    return new HttpException(
      { error: 'no_transition', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (e instanceof PermissionDeniedError) {
    return new HttpException({ message: e.message }, HttpStatus.FORBIDDEN);
  }
  return e;
}

@Controller('boards')
export class BoardController {
  @Get(':projectKey')
  async board(
    @Ctx() ctx: TenantContext,
    @Param('projectKey') projectKey: string,
  ): Promise<{ projectKey: string; columns: BoardColumn[] }> {
    try {
      return await boardOf(ctx, projectKey);
    } catch (e) {
      throw toHttp(e);
    }
  }

  /**
   * ย้ายการ์ด
   *
   * คำสั่งเดียวทำได้ทั้งเปลี่ยนคอลัมน์และเปลี่ยนลำดับ เพราะการลากหนึ่งครั้ง
   * ของผู้ใช้คือเจตนาเดียว — การแยกเป็นสองคำขอทำให้เกิดสถานะกลางที่ผู้ใช้
   * ไม่เคยตั้งใจ ถ้าคำขอที่สองล้ม
   */
  @Post(':projectKey/move')
  @HttpCode(HttpStatus.OK)
  async move(
    @Ctx() ctx: TenantContext,
    @Body()
    body: {
      itemKey?: unknown;
      toColumn?: unknown;
      afterKey?: unknown;
      beforeKey?: unknown;
      resolutionName?: unknown;
    },
  ): Promise<{ rank: string; statusName: string }> {
    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    const itemKey = str(body.itemKey) ?? '';
    /*
      ประกอบทีละคีย์ **หลังจากแคบชนิดแล้ว** ไม่ใช่เรียก `str()` สองรอบ
      แล้ว assert — รอบที่สองคืน `string | undefined` เหมือนเดิม TypeScript
      จึงไม่รู้ว่ามันผ่านการตรวจไปแล้ว และ `as string` ที่ใส่ปิดปากมันไว้
      คือการกลบ ไม่ใช่การพิสูจน์
    */
    const move: { toColumn?: string; afterKey?: string; beforeKey?: string } = {};
    const toColumn = str(body.toColumn);
    if (toColumn !== undefined) move.toColumn = toColumn;
    const afterKey = str(body.afterKey);
    if (afterKey !== undefined) move.afterKey = afterKey;
    const beforeKey = str(body.beforeKey);
    if (beforeKey !== undefined) move.beforeKey = beforeKey;

    try {
      return await moveCard(ctx, itemKey, {
        ...move,
        resolutionName: str(body.resolutionName) ?? null,
      });
    } catch (e) {
      throw toHttp(e);
    }
  }

  /** จัดลำดับใหม่ทั้งคอลัมน์ — สั่งเอง ไม่ทำอัตโนมัติตอนย้าย */
  @Post(':projectKey/rebalance')
  @HttpCode(HttpStatus.OK)
  async rebalance(
    @Ctx() ctx: TenantContext,
    @Param('projectKey') projectKey: string,
    @Body() body: { column?: unknown },
  ): Promise<{ rebalanced: number }> {
    try {
      return await rebalanceColumn(
        ctx,
        projectKey,
        typeof body.column === 'string' ? body.column : '',
      );
    } catch (e) {
      throw toHttp(e);
    }
  }
}
