/**
 * แปลง error ของการอัปโหลดให้เป็นข้อความที่ผู้ใช้อ่านรู้เรื่อง
 *
 * multer ปฏิเสธไฟล์ที่ใหญ่เกินเพดาน **ก่อน** ที่ handler จะทำงาน จึงดักใน
 * try/catch ของ controller ไม่ได้ ผู้ใช้จะได้ "File too large" เป็นภาษาอังกฤษ
 * ทั้งที่ข้อความอื่นทุกอันในระบบเป็นภาษาไทย และมันไม่บอกว่าเพดานเท่าไร
 *
 * **สองความพยายามแรกไม่ทำงาน และทั้งคู่เงียบ:**
 *
 *   1. `@Catch(MulterError)` — `@nestjs/platform-express` มีสำเนา multer
 *      ของตัวเองใน pnpm store คลาสที่มันโยนจึงเป็นคนละคลาสกับที่เรานำเข้า
 *      `instanceof` ไม่เคยตรง (บทเรียนเดียวกับคลาส error ชื่อซ้ำข้ามโมดูล)
 *
 *   2. ตรวจ `err.name === 'MulterError'` — ก็ยังไม่ตรง เพราะ Nest แปลง
 *      MulterError เป็น `HttpException` ตั้งแต่ใน `transformException()`
 *      ของตัวมันเอง ก่อนที่ filter ตัวไหนจะได้เห็น
 *
 * ที่ทำงานจริงคือดักจาก **สถานะ** ของ HttpException ที่ออกมาแล้ว
 * ปลอดภัยเพราะ filter นี้ผูกกับ endpoint อัปโหลดเท่านั้น 413 บนเส้นทางนี้
 * มีความหมายเดียวคือไฟล์ใหญ่เกิน
 */
import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

import { MAX_SIZE_BYTES } from '../../modules/workitem/attachment-policy';

@Catch(HttpException)
export class UploadErrorFilter implements ExceptionFilter {
  catch(err: HttpException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    // getStatus() คืน number ไม่ใช่ HttpStatus — เทียบกับ enum ตรง ๆ ทำให้ lint ทัก
    // และมันทักถูก: ถ้าวันหนึ่ง enum เปลี่ยนวิธีแทนค่า การเทียบจะเงียบ ๆ ผิด
    const status: number = err.getStatus();
    const TOO_LARGE: number = HttpStatus.PAYLOAD_TOO_LARGE;
    const BAD_REQUEST: number = HttpStatus.BAD_REQUEST;
    const mb = Math.round(MAX_SIZE_BYTES / 1024 / 1024);

    if (status === TOO_LARGE) {
      res.status(status).json({
        error: 'too_large',
        message: `ไฟล์ใหญ่เกิน ${String(mb)} MB — ลองบีบอัดหรือแนบเฉพาะส่วนที่เกี่ยวข้อง`,
      });
      return;
    }

    /**
     * 400 บนเส้นทางนี้มาจาก multer เท่านั้น (ช่องผิดชื่อ, ฟอร์มพัง)
     * ข้อผิดพลาดของเราเองใช้ 422 ทั้งหมด จึงแยกกันได้จากรหัส
     */
    if (status === BAD_REQUEST) {
      res.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        error: 'bad_upload',
        message: 'รูปแบบการส่งไฟล์ไม่ถูกต้อง — ต้องส่งเป็น multipart ในช่องชื่อ "file"',
      });
      return;
    }

    // ที่เหลือเป็นข้อผิดพลาดของเราเอง ซึ่งมีข้อความไทยอยู่แล้ว — ส่งต่อตามเดิม
    res.status(status).json(err.getResponse());
  }
}
