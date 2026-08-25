import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { initSlaDispatcher } from './infrastructure/queue/sla-dispatcher';
import { ensureBucket } from './infrastructure/storage/object-store';

async function bootstrap(): Promise<void> {
  // ต่อคิวแจ้งเตือน SLA ก่อนรับคำขอ — ถ้า Redis ล่ม dispatcher จะจับ error เอง
  initSlaDispatcher();

  /**
   * เตรียม bucket ตอนเปิดเครื่อง ไม่ใช่ตอนอัปโหลดครั้งแรก
   *
   * ถ้าเช็กทุกครั้งที่อัปโหลด จะเสียเวลาไปกับคำขอที่ไม่จำเป็นตลอดอายุระบบ
   * ล้มเหลวที่นี่ไม่หยุด API — ฟีเจอร์อื่นยังทำงานได้ และการอัปโหลดจะล้ม
   * พร้อมข้อความที่บอกสาเหตุ ดีกว่า API ไม่ขึ้นเลยเพราะ MinIO ยังไม่พร้อม
   */
  try {
    await ensureBucket();
  } catch (err) {
    console.error(
      '[storage] เตรียมที่เก็บไฟล์ไม่สำเร็จ — การแนบไฟล์จะใช้ไม่ได้:',
      err instanceof Error ? err.message : String(err),
    );
  }

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api/v1');
  // dev เท่านั้น — production ให้ web กับ api อยู่หลัง reverse proxy เดียวกัน
  if (process.env['NODE_ENV'] !== 'production') {
    app.enableCors({ origin: [`http://localhost:${process.env['WEB_PORT'] ?? 3000}`] });
  }
  const port = Number(process.env['API_PORT'] ?? 4000);
  await app.listen(port);
  console.log(`Helix API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
