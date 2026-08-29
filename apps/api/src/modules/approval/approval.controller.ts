/**
 * การอนุมัติ REST API — v1
 *
 * `403` ทั้งกรณี "ไม่อยู่ในกลุ่ม" และ "กลุ่มไม่มีอยู่จริง" — service ตั้งใจ
 * ตอบเหมือนกัน เพื่อไม่บอกว่ากลุ่มไหนอนุมัติเรื่องนี้ได้
 */
import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import {
  AlreadyDecidedInChainError,
  AlreadyPendingError,
  DuplicateGroupInChainError,
  EmptyChainError,
  NotYourTurnError,
  NoPendingApprovalError,
  NotAnApproverError,
  RejectionNeedsReasonError,
  SelfApprovalError,
  WorkItemNotFoundForApprovalError,
  approvalsFor,
  approverGroups,
  decideApproval,
  requestApproval,
  type ApprovalView,
} from './approval.service';

function toHttp(e: unknown): never {
  if (e instanceof WorkItemNotFoundForApprovalError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof NotAnApproverError || e instanceof SelfApprovalError) {
    throw new HttpException({ error: 'forbidden', message: e.message }, HttpStatus.FORBIDDEN);
  }
  if (
    e instanceof AlreadyPendingError ||
    e instanceof NoPendingApprovalError ||
    e instanceof RejectionNeedsReasonError ||
    e instanceof EmptyChainError ||
    e instanceof DuplicateGroupInChainError ||
    e instanceof NotYourTurnError ||
    e instanceof AlreadyDecidedInChainError
  ) {
    // 422 ไม่ใช่ 500 — สถานะของเรื่องไม่ตรงกับสิ่งที่ขอ ไม่ใช่ระบบพัง
    throw new HttpException(
      { error: 'invalid_state', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw e;
}

@Controller('work-items/:key/approvals')
export class ApprovalController {
  @Get()
  async list(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
  ): Promise<{ rows: ApprovalView[]; groups: Array<{ id: string; name: string }> }> {
    return {
      rows: await approvalsFor(ctx, key),
      // กลุ่มที่เลือกได้ ส่งมาพร้อมกันเลย ไม่ต้องยิงอีกคำขอ
      groups: await approverGroups(ctx),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async request(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { approverGroupId?: unknown; approverGroupIds?: unknown; reason?: unknown },
  ): Promise<{ id: string; steps: number }> {
    /*
      รับได้ทั้ง `approverGroupIds` (สาย) และ `approverGroupId` (ขั้นเดียว) ·
      รูปแบบเดิมยังใช้ได้เพื่อไม่ให้ผู้เรียกที่มีอยู่พังเงียบ ๆ — สายขั้นเดียว
      คือสายที่มีขั้นเดียว ไม่ใช่กรณีพิเศษ
    */
    const raw = Array.isArray(body.approverGroupIds)
      ? body.approverGroupIds
      : typeof body.approverGroupId === 'string'
        ? [body.approverGroupId]
        : [];
    const ids: bigint[] = [];
    for (const v of raw) {
      // ตัวเลขที่แปลงไม่ได้ต้องเป็น 422 ไม่ใช่ 500 จาก BigInt() ที่โยนเอง
      if (typeof v !== 'string' || !/^[0-9]+$/.test(v)) {
        throw new HttpException(
          { error: 'invalid_input', message: 'รหัสกลุ่มผู้อนุมัติไม่ถูกต้อง' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      ids.push(BigInt(v));
    }
    if (ids.length === 0) {
      throw new HttpException(
        { error: 'invalid_input', message: 'ต้องเลือกกลุ่มผู้อนุมัติ' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      const r = await requestApproval(
        ctx,
        key,
        ids,
        typeof body.reason === 'string' ? body.reason : undefined,
      );
      return { id: r.id.toString(), steps: r.steps };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Post('decision')
  @HttpCode(HttpStatus.OK)
  async decide(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { approve?: unknown; note?: unknown },
  ): Promise<{ approved: boolean }> {
    const approve = body.approve === true || body.approve === 'true';
    try {
      await decideApproval(ctx, key, {
        approve,
        ...(typeof body.note === 'string' ? { note: body.note } : {}),
      });
      return { approved: approve };
    } catch (e) {
      return toHttp(e);
    }
  }
}
