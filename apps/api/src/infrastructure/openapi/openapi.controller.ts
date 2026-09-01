/**
 * เสิร์ฟสเปกให้เครื่องมือภายนอกชี้มาได้
 *
 * ประกอบใหม่ทุกครั้งที่เรียก ไม่ได้อ่านไฟล์ที่คอมมิตไว้ — **เซิร์ฟเวอร์ที่
 * กำลังรันคือความจริง** · ไฟล์ในที่เก็บโค้ดมีไว้ให้คนอ่านและให้เทสต์เทียบ
 * ถ้าเสิร์ฟไฟล์นั้น สเปกที่เครื่องมือได้จะเป็นของรุ่นที่คอมมิตไว้ ไม่ใช่ของ
 * รุ่นที่กำลังให้บริการ ซึ่งต่างกันได้ทุกครั้งที่ลืมรันคำสั่งสร้างใหม่
 *
 * อยู่หลังการยืนยันตัวตนเหมือนเส้นทางอื่น — รายการเส้นทางทั้งหมดคือแผนที่
 * ของระบบ ไม่ใช่สิ่งที่ควรเปิดให้คนที่ยังไม่ได้เข้าสู่ระบบอ่าน
 */
import { Controller, Get } from '@nestjs/common';

import { AppModule } from '../../app.module';
import { DOCUMENTED } from './documented';
import { buildSpec, collectEndpoints } from './spec';

@Controller('openapi.json')
export class OpenApiController {
  @Get()
  spec(): Record<string, unknown> {
    const controllers =
      (Reflect.getMetadata('controllers', AppModule) as unknown[] | undefined) ?? [];
    return buildSpec(collectEndpoints(controllers), DOCUMENTED, {
      version: '1.0.0',
      basePath: '/api/v1',
    }).spec;
  }
}
