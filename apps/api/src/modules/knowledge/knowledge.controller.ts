/**
 * คลังความรู้ — v1
 *
 * ไม่ใช่ endpoint ของผู้ดูแล tenant · ทีมงานที่เห็นบันทึกภายในได้ เขียนบทความได้
 * — service ตรวจเองทุกครั้ง ที่นี่แค่แปลง error เป็น HTTP
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
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import {
  ArticleNotFoundError,
  EmptyArticleError,
  NotAnAuthorError,
  createArticle,
  deleteArticle,
  readArticle,
  searchArticles,
  updateArticle,
  type ArticleHit,
  type ArticleView,
} from './knowledge.service';

/**
 * id ของบทความจาก URL
 *
 * ค่าที่ไม่ใช่ตัวเลขต้องตอบ 404 เหมือนบทความที่ไม่มีอยู่ ไม่ใช่ระเบิดเป็น 500
 */
function parseId(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new HttpException({ message: 'ไม่พบบทความที่ระบุ' }, HttpStatus.NOT_FOUND);
  }
}

function toHttp(e: unknown): unknown {
  if (e instanceof ArticleNotFoundError) {
    return new HttpException({ message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof NotAnAuthorError) {
    // ข้อความไม่บอกว่าขาดสิทธิ์อะไร — การไล่บอกทีละสิทธิ์คือการวาดแผนที่
    return new HttpException({ error: 'not_author', message: e.message }, HttpStatus.FORBIDDEN);
  }
  if (e instanceof EmptyArticleError) {
    return new HttpException(
      { error: 'validation_failed', message: e.message, missingFields: [e.what] },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return e;
}

@Controller('knowledge')
export class KnowledgeController {
  /** ค้นบทความ — คำค้นว่างคืนรายการว่าง ไม่ใช่ทั้งคลัง */
  @Get()
  async search(
    @Ctx() ctx: TenantContext,
    @Query('q') q?: string,
  ): Promise<{ rows: ArticleHit[] }> {
    return { rows: await searchArticles(ctx, q ?? '') };
  }

  @Get(':id')
  async read(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<ArticleView> {
    try {
      return await readArticle(ctx, parseId(id));
    } catch (e) {
      throw toHttp(e);
    }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Ctx() ctx: TenantContext,
    @Body() body: { title?: unknown; body?: unknown; isPublished?: unknown },
  ): Promise<{ id: string }> {
    try {
      const r = await createArticle(ctx, {
        title: typeof body.title === 'string' ? body.title : '',
        body: typeof body.body === 'string' ? body.body : '',
        // มาจาก JSON ดิบ — "true" เป็นสตริงได้ ต้องแปลงเอง
        isPublished: body.isPublished === true || body.isPublished === 'true',
      });
      return { id: r.id.toString() };
    } catch (e) {
      throw toHttp(e);
    }
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { title?: unknown; body?: unknown; isPublished?: unknown },
  ): Promise<{ ok: true }> {
    /*
      ไม่ส่งฟิลด์ = ไม่แตะ · ต่างจากส่งค่าว่างซึ่งถูกปฏิเสธ
      ถ้าไม่แยกสองอย่างนี้ การกดเผยแพร่จะล้างเนื้อหาทิ้งไปด้วย
    */
    const input: { title?: string; body?: string; isPublished?: boolean } = {};
    if (typeof body.title === 'string') input.title = body.title;
    if (typeof body.body === 'string') input.body = body.body;
    if (body.isPublished !== undefined) {
      input.isPublished = body.isPublished === true || body.isPublished === 'true';
    }
    try {
      await updateArticle(ctx, parseId(id), input);
      return { ok: true };
    } catch (e) {
      throw toHttp(e);
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<void> {
    try {
      await deleteArticle(ctx, parseId(id));
    } catch (e) {
      throw toHttp(e);
    }
  }
}
