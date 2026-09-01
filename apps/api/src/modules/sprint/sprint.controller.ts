/**
 * Sprint REST API — v1
 *
 * แยกสามเส้นทางตามสิ่งที่คนถาม:
 *
 * - `/projects/:key/sprints` · `/projects/:key/backlog` — ของโปรเจกต์
 * - `/sprints/:id/...` — การกระทำกับรอบหนึ่งรอบ
 * - `/work-items/:key/points` — แต้มของงาน ซึ่งตั้งได้แม้งานไม่อยู่สปรินต์ไหน
 *   (การประเมินเกิดก่อนการวางแผนเสมอ)
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
import {
  AlreadyStartedError,
  NotStartedError,
  OneActiveSprintError,
  SprintClosedError,
  type Velocity,
} from './sprint-plan';
import {
  DuplicateSprintNameError,
  InvalidStoryPointsError,
  ItemFromOtherProjectError,
  ItemNotFoundForSprintError,
  ProjectNotFoundForSprintError,
  SprintNameRequiredError,
  SprintNotFoundError,
  backlogOf,
  completeSprint,
  createSprint,
  listSprints,
  moveItemToSprint,
  setStoryPoints,
  startSprint,
  velocityFor,
  type BacklogRow,
  type CompleteResult,
  type SprintRow,
} from './sprint.service';

function toHttp(e: unknown): never {
  if (
    e instanceof SprintNotFoundError ||
    e instanceof ProjectNotFoundForSprintError ||
    e instanceof ItemNotFoundForSprintError
  ) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (
    e instanceof SprintNameRequiredError ||
    e instanceof DuplicateSprintNameError ||
    e instanceof InvalidStoryPointsError ||
    e instanceof ItemFromOtherProjectError ||
    e instanceof AlreadyStartedError ||
    e instanceof NotStartedError ||
    e instanceof OneActiveSprintError ||
    e instanceof SprintClosedError
  ) {
    /*
      422 ทั้งหมด — คำขอถูกต้องตามรูปแบบ แต่สภาพตอนนี้ทำไม่ได้ ·
      ข้อความของ error แต่ละตัวบอกเหตุผลเป็นภาษาคนอยู่แล้ว หน้าจอจึงแสดงตรง ๆ ได้
    */
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

@Controller('projects/:key/sprints')
export class ProjectSprintController {
  @Get()
  async list(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
  ): Promise<{ rows: SprintRow[]; velocity: Velocity }> {
    try {
      return { rows: await listSprints(ctx, key), velocity: await velocityFor(ctx, key) };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { name?: unknown; goal?: unknown; plannedStart?: unknown; plannedEnd?: unknown },
  ): Promise<{ id: string }> {
    try {
      const s = await createSprint(ctx, {
        projectKey: key,
        name: str(body.name),
        goal: str(body.goal),
        plannedStart: str(body.plannedStart),
        plannedEnd: str(body.plannedEnd),
      });
      return { id: s.id.toString() };
    } catch (e) {
      return toHttp(e);
    }
  }
}

@Controller('projects/:key/backlog')
export class BacklogController {
  @Get()
  async list(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
  ): Promise<{ rows: BacklogRow[]; total: number }> {
    try {
      return await backlogOf(ctx, key);
    } catch (e) {
      return toHttp(e);
    }
  }
}

@Controller('sprints')
export class SprintController {
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  async start(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    try {
      await startSprint(ctx, idOf(id));
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }

  /**
   * ปิดรอบ — **ต้องระบุว่างานค้างไปไหน**
   *
   * `moveUndoneTo` ที่ไม่ได้ส่งมาเลย ถือว่าส่งกลับ backlog · แต่หน้าจอถามเสมอ
   * เพราะการเลือกให้เองเงียบ ๆ คือสิ่งที่ทำให้งานหายไปทางที่คนกดไม่ได้ตั้งใจ
   */
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  async complete(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { moveUndoneTo?: unknown },
  ): Promise<CompleteResult> {
    const target = str(body.moveUndoneTo);
    try {
      return await completeSprint(ctx, idOf(id), target === '' ? null : idOf(target));
    } catch (e) {
      return toHttp(e);
    }
  }

  @Post(':id/items')
  @HttpCode(HttpStatus.OK)
  async add(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { itemKey?: unknown },
  ): Promise<{ ok: true }> {
    try {
      await moveItemToSprint(ctx, str(body.itemKey), idOf(id));
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }

  /** เอางานออกจากรอบ = ส่งกลับ backlog · ไม่ใช่การลบงาน */
  @Delete(':id/items/:itemKey')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('itemKey') itemKey: string,
  ): Promise<{ ok: true }> {
    try {
      void idOf(id);
      await moveItemToSprint(ctx, itemKey, null);
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }
}

@Controller('work-items/:key/points')
export class StoryPointController {
  /**
   * ตั้งแต้ม — ส่ง `null` เพื่อบอกว่ายังไม่ประเมิน
   *
   * **`null` ต่างจาก 0** · ศูนย์แปลว่า "ทำแล้วไม่มีขนาด" ส่วนไม่มีค่าแปลว่า
   * "ยังไม่มีใครดู" — สองอย่างนี้ตอบคำถามคนละข้อในการวางแผน
   */
  @Put()
  async set(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { points?: unknown },
  ): Promise<{ ok: true }> {
    const raw = body.points;
    let points: number | null;
    if (raw === null || raw === undefined || raw === '') {
      points = null;
    } else if (typeof raw === 'number') {
      points = raw;
    } else if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw))) {
      points = Number(raw);
    } else {
      throw new HttpException(
        { error: 'invalid_input', message: 'แต้มต้องเป็นตัวเลข หรือเว้นว่าง' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      await setStoryPoints(ctx, key, points);
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }
}
