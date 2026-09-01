/**
 * รุ่นของโปรเจกต์ REST API — v1
 *
 * แยกสามเส้นทางตามสิ่งที่คนถาม (รูปแบบเดียวกับ Sprint):
 *
 * - `/projects/:key/versions` — รุ่นทั้งหมดของโปรเจกต์ และการสร้าง
 * - `/versions/:id/...` — การกระทำกับรุ่นหนึ่งรุ่น และบันทึกการปล่อย
 * - `/work-items/:key/versions` — รุ่นที่งานใบนี้อยู่ · ใส่/เอาออก
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
import { AlreadyReleasedError, NotReleasedYetError, UnfinishedItemsError } from './release-plan';
import { roadmapOf, type RoadmapView } from './roadmap.service';
import {
  DuplicateVersionNameError,
  ItemFromOtherProjectError,
  ItemNotFoundForVersionError,
  ProjectNotFoundForVersionError,
  VersionNameRequiredError,
  VersionNotFoundError,
  createVersion,
  listVersions,
  releaseNote,
  releaseVersion,
  reopenVersion,
  setItemVersion,
  versionsOfItem,
  type ReleaseNoteView,
  type VersionView,
} from './version.service';

function toHttp(e: unknown): never {
  if (
    e instanceof VersionNotFoundError ||
    e instanceof ProjectNotFoundForVersionError ||
    e instanceof ItemNotFoundForVersionError
  ) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (
    e instanceof VersionNameRequiredError ||
    e instanceof DuplicateVersionNameError ||
    e instanceof ItemFromOtherProjectError ||
    e instanceof AlreadyReleasedError ||
    e instanceof NotReleasedYetError ||
    e instanceof UnfinishedItemsError
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

@Controller('projects/:key/versions')
export class ProjectVersionController {
  @Get()
  async list(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
  ): Promise<{ rows: VersionView[] }> {
    try {
      return { rows: await listVersions(ctx, key) };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { name?: unknown; description?: unknown; startDate?: unknown; releaseDate?: unknown },
  ): Promise<{ id: string }> {
    try {
      const v = await createVersion(ctx, key, {
        name: str(body.name),
        description: str(body.description),
        startDate: str(body.startDate),
        releaseDate: str(body.releaseDate),
      });
      return { id: v.id.toString() };
    } catch (e) {
      return toHttp(e);
    }
  }
}

/**
 * แผนงานบนเส้นเวลา
 *
 * **แยกจาก `/projects/:key/versions` โดยตั้งใจ** — รายการรุ่นตอบว่า
 * "มีรุ่นอะไรบ้าง" ส่วนแผนงานตอบว่า "ลำดับเวลาเป็นยังไง และมีอะไรขัดกันไหม"
 * ซึ่งต้องอ่านทั้งรอบการทำงานและลิงก์การขวางเพิ่ม
 *
 * ไม่ระบุกรอบเวลา = ครึ่งปีย้อนหลังถึงครึ่งปีข้างหน้า · **ไม่ใช่ทั้งหมด**
 * เพราะแผนที่ยาวสิบปีอ่านไม่ออก และคิวรีที่คืนทุกแถวคือคิวรีที่ช้าโดยเงียบ
 */
@Controller('projects/:key/roadmap')
export class RoadmapController {
  @Get()
  async get(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<RoadmapView> {
    try {
      return await roadmapOf(ctx, key, { from, to });
    } catch (e) {
      return toHttp(e);
    }
  }
}

@Controller('versions')
export class VersionController {
  /**
   * ปล่อยรุ่น
   *
   * ตอบ 422 พร้อมข้อความที่บอกจำนวนงานค้าง เมื่อยังปล่อยไม่ได้ —
   * **ไม่ปล่อยแล้วค่อยเตือน** เพราะงานที่ยังไม่เสร็จในรุ่นที่ปล่อยไปแล้ว
   * จะกลายเป็น "ของที่ปล่อยแล้ว" ในสายตาทุกคนทันที
   */
  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  async release(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    try {
      await releaseVersion(ctx, idOf(id));
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  async reopen(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    try {
      await reopenVersion(ctx, idOf(id));
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }

  /** อ่านได้แม้ยังไม่ปล่อย — เป็นตัวอย่างว่าปล่อยแล้วจะได้บันทึกหน้าตาแบบไหน */
  @Get(':id/release-note')
  async note(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<ReleaseNoteView> {
    try {
      return await releaseNote(ctx, idOf(id));
    } catch (e) {
      return toHttp(e);
    }
  }
}

@Controller('work-items/:key/versions')
export class ItemVersionController {
  @Get()
  async list(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
  ): Promise<{ inVersions: VersionView[]; available: VersionView[] }> {
    try {
      return await versionsOfItem(ctx, key);
    } catch (e) {
      return toHttp(e);
    }
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async add(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { versionId?: unknown },
  ): Promise<{ ok: true }> {
    try {
      await setItemVersion(ctx, key, idOf(str(body.versionId)), true);
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }

  /** เอางานออกจากรุ่น — ไม่ใช่การลบงาน และไม่ใช่การลบรุ่น */
  @Delete(':versionId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Param('versionId') versionId: string,
  ): Promise<{ ok: true }> {
    try {
      await setItemVersion(ctx, key, idOf(versionId), false);
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }
}
