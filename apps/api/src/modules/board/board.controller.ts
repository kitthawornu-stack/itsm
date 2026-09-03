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
  Query,
} from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { PermissionDeniedError } from '../permission';
import {
  BoardColumnNotFoundError,
  BoardItemNotFoundError,
  InvalidWipLimitError,
  NoTransitionForColumnError,
  boardOf,
  type BoardView,
  moveCard,
  rebalanceColumn,
  setWipLimit,
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
  if (e instanceof BoardColumnNotFoundError) {
    return new HttpException({ message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof InvalidWipLimitError) {
    /*
      422 ไม่ใช่ 400 — คำขอถูกรูปแบบทุกอย่าง แต่ค่าที่ส่งมาอยู่นอกช่วง
      ที่ยอมรับ · ข้อความบอกช่วงและบอกวิธีถอดเพดาน เพราะคนที่พิมพ์ 0
      มาตั้งใจจะถอดเพดาน ไม่ได้ตั้งใจจะผิด
    */
    return new HttpException({ message: e.message }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  if (e instanceof PermissionDeniedError) {
    return new HttpException({ message: e.message }, HttpStatus.FORBIDDEN);
  }
  return e;
}

@Controller('boards')
export class BoardController {
  /**
   * กระดานของโปรเจกต์
   *
   * `?mode=scrum` จำกัดขอบเขตเหลือเฉพาะรอบที่กำลังทำอยู่ · ค่าปริยายคือ
   * kanban ซึ่งเป็นสิ่งที่กระดานนี้เป็นมาตลอด — **ค่าที่พิมพ์ผิดตกไปเป็น
   * kanban ไม่ใช่ scrum** เพราะการแสดงน้อยกว่าที่คนคาดโดยไม่ตั้งใจ
   * ทำให้คนเชื่อว่างานหายไป
   */
  @Get(':projectKey')
  async board(
    @Ctx() ctx: TenantContext,
    @Param('projectKey') projectKey: string,
    @Query('mode') mode?: string,
  ): Promise<BoardView> {
    try {
      return await boardOf(ctx, projectKey, undefined, mode === 'scrum' ? 'scrum' : 'kanban');
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

  /**
   * ตั้งหรือถอดเพดานงานที่ทำพร้อมกันของคอลัมน์หนึ่ง
   *
   * `maxCards: null` = ถอดเพดาน · **0 ไม่ใช่การถอด** และถูกปฏิเสธ
   * พร้อมข้อความที่บอกวิธีถอดจริง ๆ — คนที่พิมพ์ 0 ตั้งใจจะถอด
   * ถ้ารับไว้เงียบ ๆ เขาจะเชื่อว่าถอดแล้วทั้งที่เก็บเป็นเพดาน 0
   */
  @Post(':projectKey/wip-limit')
  @HttpCode(HttpStatus.OK)
  async wipLimit(
    @Ctx() ctx: TenantContext,
    @Param('projectKey') projectKey: string,
    @Body() body: { column?: unknown; maxCards?: unknown },
  ): Promise<{ column: string; maxCards: number | null; statuses: number }> {
    const column = typeof body.column === 'string' ? body.column : '';
    /*
      แยก "ไม่ส่งมา" ออกจาก "ส่งค่าที่ไม่ใช่ตัวเลข" ไม่ได้ที่ชั้นนี้ —
      ทั้งสองอย่างกลายเป็น `null` ซึ่งแปลว่าถอดเพดาน · จึงรับเฉพาะ
      `null` กับตัวเลขเท่านั้น ค่าอื่นส่งต่อให้ service ปฏิเสธพร้อมช่วงที่ถูก
    */
    const raw = body.maxCards;
    const maxCards = raw === null || raw === undefined ? null : Number(raw);
    try {
      return await setWipLimit(ctx, projectKey, column, maxCards);
    } catch (e) {
      throw toHttp(e);
    }
  }
}
