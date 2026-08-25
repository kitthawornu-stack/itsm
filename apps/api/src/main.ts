import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { initSlaDispatcher } from './infrastructure/queue/sla-dispatcher';

async function bootstrap(): Promise<void> {
  // ต่อคิวแจ้งเตือน SLA ก่อนรับคำขอ — ถ้า Redis ล่ม dispatcher จะจับ error เอง
  initSlaDispatcher();

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
