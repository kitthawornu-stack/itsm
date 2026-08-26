/**
 * แปลง `PermissionDeniedError` เป็น 403 — ที่เดียวสำหรับทั้งแอป
 *
 * เดิมดักด้วย `try/catch` ในทุก handler ซึ่งได้ผลตราบใดที่ไม่มีใครลืม
 * แล้วก็ลืมจริง: `assertCan` ของการเปลี่ยนสถานะอยู่ **นอก** try ผู้ใช้ที่ไม่มีสิทธิ์
 * จึงได้ 500 แทน 403 — ซึ่งนอกจากจะผิดแล้ว ยังทำให้ดูเหมือนระบบพัง
 * ทั้งที่มันกำลังทำงานถูกต้อง
 *
 * filter ระดับแอปทำให้ handler ที่เขียนใหม่ในอนาคตได้ 403 ฟรี โดยไม่ต้องจำ
 * — เหตุผลเดียวกับที่ `SessionGuard` ปิดทุก endpoint เป็นค่าปริยาย
 */
import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

import { PermissionDeniedError } from '../../modules/permission';

@Catch(PermissionDeniedError)
export class PermissionDeniedFilter implements ExceptionFilter {
  catch(err: PermissionDeniedError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.FORBIDDEN)
      // ข้อความไม่บอกว่าขาดสิทธิ์อะไร — การไล่บอกทีละสิทธิ์
      // คือการวาดแผนที่ระบบสิทธิ์ให้คนที่กำลังลอง
      .json({ error: 'forbidden', message: err.message });
  }
}
