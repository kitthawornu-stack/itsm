/**
 * ส่งออกข้อมูลเป็น CSV REST API — v1
 *
 * **ตอบเป็นไฟล์ ไม่ใช่ JSON ที่มีข้อความไฟล์อยู่ข้างใน** — คนกดแล้วต้องได้
 * ไฟล์ทันที · การให้หน้าจอรับ JSON แล้วประกอบไฟล์เองในเบราว์เซอร์ เพิ่มชั้นที่
 * รหัสอักขระพังได้อีกชั้น ซึ่งเป็นจุดที่ภาษาไทยพังบ่อยที่สุด
 */
import {
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { systemClock, type TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import {
  ProjectNotFoundForExportError,
  TooManyToExportError,
  exportProjectCsv,
} from './csv-export.service';

@Controller('projects/:key/export')
export class CsvExportController {
  /**
   * งานทั้งโปรเจกต์เป็นไฟล์ CSV
   *
   * เป็น `GET` เพราะไม่เปลี่ยนข้อมูล และคนต้องกดลิงก์ดาวน์โหลดได้ตรง ๆ ·
   * `Content-Type` เป็น `text/csv; charset=utf-8` และตัวไฟล์ขึ้นต้นด้วย BOM
   * — สองอย่างนี้ต้องมีคู่กัน เบราว์เซอร์ใช้อย่างแรก Excel ใช้อย่างหลัง
   */
  @Get('work-items.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async workItems(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    try {
      const out = await exportProjectCsv(ctx, key, systemClock.nowUtc());
      /*
        ชื่อไฟล์ส่งทั้งแบบ ASCII และแบบ UTF-8 (`filename*`) — คีย์โปรเจกต์
        เป็นอักษรละตินเสมอ (บังคับไว้ที่ `normalizeProjectKey`) แต่กติกา
        ของ header นี้เป็นที่ที่ชื่อไฟล์ภาษาไทยพังบ่อย จึงส่งให้ครบไว้ก่อน
      */
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${out.filename}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
      );
      // ให้หน้าจอบอกจำนวนได้โดยไม่ต้องนับบรรทัดในไฟล์เอง
      res.setHeader('X-Export-Rows', String(out.rows));
      return out.csv;
    } catch (e) {
      if (e instanceof ProjectNotFoundForExportError) {
        throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
      }
      if (e instanceof TooManyToExportError) {
        throw new HttpException(
          { error: 'invalid_state', message: e.message },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw e;
    }
  }
}
