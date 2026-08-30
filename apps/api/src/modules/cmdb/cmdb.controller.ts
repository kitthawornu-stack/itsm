/**
 * CMDB REST API — v1
 *
 * แยกสองเส้นทางโดยตั้งใจ:
 *
 * - `/config-items` — ทะเบียนและเส้นพึ่งพา · **ผู้ดูแลเท่านั้นที่แก้ได้**
 * - `/work-items/:key/config-items` — ผูกเรื่องกับสิ่งที่ดูแล ·
 *   **ใช้สิทธิ์แก้เรื่องนั้น ไม่ใช่สิทธิ์ผู้ดูแล** เพราะคนที่ทำงานกับตั๋ว
 *   ต้องบอกได้ว่าเรื่องนี้กระทบเครื่องไหน มิฉะนั้นข้อมูลจะไม่มีวันถูกกรอก
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
  AlreadyAttachedError,
  CI_KIND_LABEL,
  CI_STATUS_LABEL,
  CiKeyRequiredError,
  CiNotFoundError,
  DependencyCycleError,
  DuplicateCiKeyError,
  SelfDependencyError,
  WorkItemNotFoundForCiError,
  addDependency,
  attachCi,
  cisOfItem,
  createCi,
  deleteCi,
  detachCi,
  listCis,
  openItemsInImpact,
  removeDependency,
  updateCi,
  type AttachedCi,
  type CiKindKey,
  type CiStatusKey,
  type CiView,
  type CiWorkItem,
  type ImpactView,
} from './cmdb.service';

const KINDS = Object.keys(CI_KIND_LABEL) as CiKindKey[];
const STATUSES = Object.keys(CI_STATUS_LABEL) as CiStatusKey[];

function toHttp(e: unknown): never {
  if (e instanceof CiNotFoundError || e instanceof WorkItemNotFoundForCiError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (
    e instanceof CiKeyRequiredError ||
    e instanceof DuplicateCiKeyError ||
    e instanceof SelfDependencyError ||
    e instanceof DependencyCycleError ||
    e instanceof AlreadyAttachedError
  ) {
    // 422 ไม่ใช่ 500 — ข้อมูลที่ส่งมาใช้ไม่ได้ ไม่ใช่ระบบพัง
    throw new HttpException(
      { error: 'invalid_state', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw e;
}

/** รหัสที่แปลงไม่ได้ต้องเป็น 422 ไม่ใช่ 500 จาก `BigInt()` ที่โยนเอง */
function idOf(raw: string): bigint {
  if (!/^[0-9]+$/.test(raw)) {
    throw new HttpException(
      { error: 'invalid_input', message: 'รหัสไม่ถูกต้อง' },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return BigInt(raw);
}

interface CiBody {
  key?: unknown;
  name?: unknown;
  kind?: unknown;
  status?: unknown;
  ownerGroupId?: unknown;
  notes?: unknown;
}

/**
 * อ่านข้อมูลนำเข้าโดยไม่แปลงชนิดเงียบ ๆ
 *
 * ชนิดที่ไม่รู้จักถูกปฏิเสธ ไม่ใช่ตกไปเป็น `OTHER` — การเดาแทนผู้ใช้ทำให้
 * รายการที่กรอกผิดกลายเป็นรายการที่ดูถูกต้อง แล้วไม่มีใครไปแก้
 */
function readCiBody(body: CiBody): {
  key: string;
  name: string;
  kind: CiKindKey;
  status: CiStatusKey;
  ownerGroupId: string | null;
  notes: string | null;
} {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const kind = str(body.kind);
  if (!KINDS.includes(kind as CiKindKey)) {
    throw new HttpException(
      { error: 'invalid_input', message: `ชนิดไม่ถูกต้อง — เลือกได้: ${KINDS.join(' · ')}` },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  const status = str(body.status);
  if (status !== '' && !STATUSES.includes(status as CiStatusKey)) {
    throw new HttpException(
      { error: 'invalid_input', message: `สถานะไม่ถูกต้อง — เลือกได้: ${STATUSES.join(' · ')}` },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  const owner = str(body.ownerGroupId);
  return {
    key: str(body.key),
    name: str(body.name),
    kind: kind as CiKindKey,
    status: status === '' ? 'ACTIVE' : (status as CiStatusKey),
    ownerGroupId: owner === '' ? null : owner,
    notes: str(body.notes) === '' ? null : str(body.notes),
  };
}

@Controller('config-items')
export class CmdbController {
  @Get()
  async list(@Ctx() ctx: TenantContext): Promise<{
    rows: CiView[];
    kinds: Array<{ value: string; label: string }>;
    statuses: Array<{ value: string; label: string }>;
  }> {
    /*
      ส่งตัวเลือกมาพร้อมรายการ — หน้าจอจะได้ไม่ต้องพิมพ์ชนิดซ้ำเอง ·
      รายการที่พิมพ์ซ้ำในหน้าจอคือรายการที่จะไม่ตรงกับเซิร์ฟเวอร์ในวันที่มีคนเพิ่มชนิด
    */
    return {
      rows: await listCis(ctx),
      kinds: KINDS.map((k) => ({ value: k, label: CI_KIND_LABEL[k] })),
      statuses: STATUSES.map((s) => ({ value: s, label: CI_STATUS_LABEL[s] })),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Ctx() ctx: TenantContext, @Body() body: CiBody): Promise<{ id: string }> {
    try {
      const r = await createCi(ctx, readCiBody(body));
      return { id: r.id.toString() };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Put(':id')
  async update(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: CiBody,
  ): Promise<{ ok: true }> {
    try {
      await updateCi(ctx, idOf(id), readCiBody(body));
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    try {
      await deleteCi(ctx, idOf(id));
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }

  /** ถ้าตัวนี้ล่ม อะไรพังตาม และมีเรื่องค้างอยู่กี่ใบ */
  @Get(':id/impact')
  async impact(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
  ): Promise<{ impact: ImpactView; items: CiWorkItem[] }> {
    try {
      return await openItemsInImpact(ctx, idOf(id));
    } catch (e) {
      return toHttp(e);
    }
  }

  @Post(':id/dependencies')
  @HttpCode(HttpStatus.CREATED)
  async addDep(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { dependsOnId?: unknown },
  ): Promise<{ ok: true }> {
    const target = typeof body.dependsOnId === 'string' ? body.dependsOnId : '';
    if (target === '') {
      throw new HttpException(
        { error: 'invalid_input', message: 'ต้องเลือกสิ่งที่พึ่งพา' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      await addDependency(ctx, idOf(id), idOf(target));
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Delete(':id/dependencies/:dependsOnId')
  @HttpCode(HttpStatus.OK)
  async dropDep(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('dependsOnId') dependsOnId: string,
  ): Promise<{ ok: true }> {
    try {
      await removeDependency(ctx, idOf(id), idOf(dependsOnId));
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }
}

/** ผูกเรื่องกับสิ่งที่ดูแล — ใช้สิทธิ์ของเรื่อง ไม่ใช่สิทธิ์ผู้ดูแล */
@Controller('work-items/:key/config-items')
export class WorkItemCiController {
  @Get()
  async list(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
  ): Promise<{ rows: AttachedCi[] }> {
    try {
      return { rows: await cisOfItem(ctx, key) };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async attach(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { ciId?: unknown },
  ): Promise<{ ok: true }> {
    const ciId = typeof body.ciId === 'string' ? body.ciId : '';
    if (ciId === '') {
      throw new HttpException(
        { error: 'invalid_input', message: 'ต้องเลือกสิ่งที่ดูแล' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      await attachCi(ctx, key, idOf(ciId));
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Delete(':ciId')
  @HttpCode(HttpStatus.OK)
  async detach(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Param('ciId') ciId: string,
  ): Promise<{ ok: true }> {
    try {
      await detachCi(ctx, key, idOf(ciId));
      return { ok: true };
    } catch (e) {
      return toHttp(e);
    }
  }
}
