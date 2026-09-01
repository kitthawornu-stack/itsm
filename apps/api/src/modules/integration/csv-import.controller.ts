/**
 * นำเข้าข้อมูลจาก Excel/CSV REST API — v1
 *
 * **สองเส้นทาง: ดูตัวอย่าง กับ นำเข้าจริง** — คนต้องได้เห็นปัญหาทั้งหมดก่อน
 * กดจริง · ปุ่มเดียวที่ทำทั้งสองอย่างจะทำให้ไฟล์ที่มีปัญหาเข้าไปครึ่งหนึ่ง
 * ก่อนที่ใครจะรู้ตัว
 *
 * รับ CSV เป็น **ข้อความใน JSON** ไม่ใช่ multipart — ไฟล์ที่นำเข้ามีเพดาน
 * 2,000 แถวอยู่แล้ว และการรับเป็นข้อความทำให้ปัญหาเรื่องรหัสอักขระถูกตรวจ
 * ที่ชั้นเดียว ไม่ใช่กระจายอยู่ในตัวแยกไฟล์ด้วย
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import {
  FileTooLargeError,
  ProjectNotFoundForImportError,
  previewImport,
  runImport,
  type ImportPreview,
  type ImportResult,
} from './csv-import.service';

function toHttp(e: unknown): never {
  if (e instanceof ProjectNotFoundForImportError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof FileTooLargeError) {
    throw new HttpException(
      { error: 'invalid_state', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw e;
}

const csvOf = (v: unknown): string => {
  if (typeof v === 'string' && v.trim() !== '') return v;
  throw new HttpException(
    { error: 'invalid_input', message: 'ต้องส่งเนื้อหาไฟล์ CSV มาด้วย' },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
};

@Controller('projects/:key/import')
export class CsvImportController {
  /** ตรวจอย่างเดียว ไม่เขียนอะไรเลย */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  async preview(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { csv?: unknown },
  ): Promise<ImportPreview> {
    try {
      return await previewImport(ctx, key, csvOf(body.csv));
    } catch (e) {
      return toHttp(e);
    }
  }

  /**
   * นำเข้าจริง
   *
   * ตอบ 200 พร้อม `problems` เมื่อไฟล์มีปัญหา — **ไม่ใช่ 422** เพราะคำขอ
   * ถูกต้องทุกอย่าง สิ่งที่ผิดคือเนื้อหาไฟล์ซึ่งเป็นข้อมูลที่หน้าจอต้องแสดง
   * เป็นตาราง ไม่ใช่ข้อความ error บรรทัดเดียว
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async run(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { csv?: unknown },
  ): Promise<ImportResult> {
    try {
      return await runImport(ctx, key, csvOf(body.csv));
    } catch (e) {
      return toHttp(e);
    }
  }
}
