import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';

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
  // โทเคนเซสชันอยู่ในคุกกี้ httpOnly (ADR-003) จึงต้องแกะคุกกี้ก่อนถึง controller
  app.use(cookieParser());
  /**
   * ต้นทางที่เรียก API ข้ามพอร์ตได้
   *
   * เดิมเปิด CORS เฉพาะตอนไม่ใช่ production โดยคิดว่า production จะอยู่หลัง
   * reverse proxy เดียวกันเสมอ · แต่ชุดที่ส่งมอบ (docker-compose.prod.yml)
   * เปิด web ที่ 4300 และ api ที่ 4400 โดยไม่มี proxy — เบราว์เซอร์จึงบล็อก
   * การล็อกอินทันทีที่ยกสแตกขึ้น **ระบบที่ build ผ่านทุกอย่างแต่ใช้ไม่ได้เลย**
   *
   * ตั้งค่าได้ด้วย `CORS_ORIGINS` (คั่นด้วยจุลภาค) ถ้าไม่ตั้งจะเดาจาก WEB_PORT
   * ไม่ใช้ `*` เพราะคำขอที่พาคุกกี้ไปด้วยต้องระบุต้นทางให้ชัด
   * (เบราว์เซอร์ปฏิเสธ `*` คู่กับ credentials อยู่แล้ว)
   */
  const configured = process.env['CORS_ORIGINS'];
  const origins =
    configured === undefined || configured.trim() === ''
      ? [`http://localhost:${process.env['WEB_PORT'] ?? 4300}`]
      : configured.split(',').map((o) => o.trim()).filter((o) => o !== '');

  app.enableCors({
    origin: origins,
    // ต้องเปิด ไม่งั้นเบราว์เซอร์ไม่ส่งคุกกี้เซสชันข้ามพอร์ตมาให้
    credentials: true,
  });
  console.log(`CORS อนุญาต: ${origins.join(', ')}`);

  const port = Number(process.env['API_PORT'] ?? 4000);
  await app.listen(port);
  console.log(`Helix API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
