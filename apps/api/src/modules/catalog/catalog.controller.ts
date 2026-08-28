/**
 * Service Catalog REST API — v1
 *
 * แยกสองเส้นทางชัดเจน:
 *   `GET /catalog`        ผู้แจ้งทุกคนเรียกได้ — เห็นเฉพาะบริการของโปรเจกต์ที่ตัวเองเปิดดูได้
 *   `GET /admin/catalog`  ผู้ดูแล tenant เท่านั้น — เห็นของที่ปิดอยู่ด้วย
 *
 * ที่ต้องแยกเพราะสองหน้าจอนี้ตอบคนละคำถาม: "ฉันแจ้งอะไรได้บ้าง" กับ
 * "องค์กรตั้งค่าอะไรไว้บ้าง" · ถ้าใช้ endpoint เดียวกันแล้วสลับด้วยพารามิเตอร์
 * จะมีวันที่ลืมตรวจสิทธิ์แล้วบริการที่ปิดอยู่หลุดไปให้ผู้แจ้งเห็น
 */
import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertTenantAdmin, browsableProjectIds } from '../permission';
import {
  CatalogItemNotFoundError,
  CategoryInUseError,
  CategoryNameRequiredError,
  DuplicateCatalogNameError,
  IncompatibleTargetError,
  UnknownCatalogTargetError,
  browseCatalog,
  catalogItemForReport,
  createCatalogCategory,
  createCatalogItem,
  deleteCatalogCategory,
  listCatalogAdmin,
  setCatalogItemActive,
  type CatalogGroup,
} from './catalog.service';

/** แปลง error ของโดเมนเป็นรหัส HTTP ที่ตรงความหมาย — ที่เดียวสำหรับทั้ง controller */
function toHttp(e: unknown): never {
  if (e instanceof CatalogItemNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (
    e instanceof CategoryNameRequiredError ||
    e instanceof DuplicateCatalogNameError ||
    e instanceof UnknownCatalogTargetError ||
    e instanceof IncompatibleTargetError ||
    e instanceof CategoryInUseError
  ) {
    // 422 ไม่ใช่ 500 — ข้อมูลที่ส่งมาใช้ไม่ได้ ไม่ใช่ระบบพัง
    throw new HttpException(
      { error: 'invalid_input', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw e;
}

@Controller('catalog')
export class CatalogController {
  /** รายการบริการที่ผู้ใช้คนนี้แจ้งได้ */
  @Get()
  async browse(@Ctx() ctx: TenantContext): Promise<{ groups: CatalogGroup[] }> {
    return { groups: await browseCatalog(ctx, await browsableProjectIds(ctx)) };
  }

  /**
   * ปลายทางของบริการหนึ่งรายการ — ฟอร์มแจ้งเรื่องใช้ตั้งค่าเริ่มต้น
   *
   * ขอบเขตถูกตรวจใน service ทุกครั้ง ไม่ใช่เชื่อว่าหน้าจอส่งมาถูก
   */
  @Get(':id')
  async item(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<unknown> {
    try {
      const t = await catalogItemForReport(ctx, BigInt(id), await browsableProjectIds(ctx));
      return {
        id: t.itemId.toString(),
        name: t.name,
        projectKey: t.projectKey,
        issueTypeName: t.issueTypeName,
        priorityId: t.priorityId,
      };
    } catch (e) {
      return toHttp(e);
    }
  }
}

@Controller('admin/catalog')
export class CatalogAdminController {
  @Get()
  async list(@Ctx() ctx: TenantContext): Promise<{ groups: CatalogGroup[] }> {
    await assertTenantAdmin(ctx);
    return { groups: await listCatalogAdmin(ctx) };
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  async addCategory(
    @Ctx() ctx: TenantContext,
    @Body() body: { name?: unknown; sortOrder?: unknown },
  ): Promise<{ id: string }> {
    await assertTenantAdmin(ctx);
    try {
      const c = await createCatalogCategory(
        ctx,
        typeof body.name === 'string' ? body.name : '',
        typeof body.sortOrder === 'number' ? body.sortOrder : 100,
      );
      return { id: c.id.toString() };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCategory(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<void> {
    await assertTenantAdmin(ctx);
    try {
      await deleteCatalogCategory(ctx, BigInt(id));
    } catch (e) {
      toHttp(e);
    }
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  async addItem(
    @Ctx() ctx: TenantContext,
    @Body()
    body: {
      categoryId?: unknown;
      name?: unknown;
      description?: unknown;
      /** คีย์โปรเจกต์ เช่น "SD" — ไม่ใช่ id ภายใน */
      projectKey?: unknown;
      /** ชื่อประเภทงาน เช่น "Service Request" */
      issueTypeName?: unknown;
      /** อันดับความสำคัญ (rank) ไม่ใช่ id */
      priorityRank?: unknown;
    },
  ): Promise<{ id: string }> {
    await assertTenantAdmin(ctx);

    /*
      **รับคีย์และชื่อ ไม่ใช่ id ภายใน**

      หน้าจอผู้ดูแลรู้จักโปรเจกต์ในชื่อ "SD" และประเภทงานในชื่อ "Service Request"
      เพราะนั่นคือสิ่งที่ `/work-items/options` ส่งให้ · การบังคับให้ส่ง id
      แปลว่าหน้าจอต้องไปหา id จากที่อื่นก่อน ซึ่งเป็นรอบที่ไม่มีเหตุผล
      และเป็นจุดที่พลาดได้ง่าย (รอบแรกฟอร์มส่งคีย์มาในช่องที่ชื่อ `projectId`)
    */
    const db = tenantScoped(ctx);
    const categoryId =
      typeof body.categoryId === 'string' && body.categoryId !== ''
        ? BigInt(body.categoryId)
        : null;
    const projectKey = typeof body.projectKey === 'string' ? body.projectKey : '';
    const issueTypeName = typeof body.issueTypeName === 'string' ? body.issueTypeName : '';
    if (categoryId === null || projectKey === '' || issueTypeName === '') {
      throw new HttpException(
        { error: 'invalid_input', message: 'ต้องเลือกหมวด โปรเจกต์ และประเภทงานให้ครบ' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const [project, issueType] = await Promise.all([
      db.project.findFirst({ where: { key: projectKey }, select: { id: true } }),
      db.issueType.findFirst({ where: { name: issueTypeName }, select: { id: true } }),
    ]);
    if (project === null || issueType === null) {
      throw new HttpException(
        { error: 'invalid_input', message: 'ไม่พบโปรเจกต์หรือประเภทงานที่เลือก' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    let priorityId: number | undefined;
    if (typeof body.priorityRank === 'number' || typeof body.priorityRank === 'string') {
      const rank = Number(body.priorityRank);
      if (!Number.isNaN(rank)) {
        const p = await db.priority.findFirst({ where: { rank }, select: { id: true } });
        if (p === null) {
          throw new HttpException(
            { error: 'invalid_input', message: 'ไม่พบระดับความสำคัญที่เลือก' },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        priorityId = p.id;
      }
    }

    try {
      const i = await createCatalogItem(ctx, {
        categoryId,
        name: typeof body.name === 'string' ? body.name : '',
        description: typeof body.description === 'string' ? body.description : undefined,
        projectId: project.id,
        issueTypeId: issueType.id,
        ...(priorityId === undefined ? {} : { priorityId }),
      });
      return { id: i.id.toString() };
    } catch (e) {
      return toHttp(e);
    }
  }

  @Post('items/:id/active')
  @HttpCode(HttpStatus.OK)
  async setActive(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { isActive?: unknown },
  ): Promise<{ isActive: boolean }> {
    await assertTenantAdmin(ctx);
    const isActive = body.isActive === true || body.isActive === 'true';
    try {
      await setCatalogItemActive(ctx, BigInt(id), isActive);
      return { isActive };
    } catch (e) {
      return toHttp(e);
    }
  }
}
