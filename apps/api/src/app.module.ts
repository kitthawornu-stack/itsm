import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { HealthController } from './modules/health/health.controller';
import { NotificationController } from './modules/notification/notification.controller';
import { WorkItemController } from './modules/workitem/workitem.controller';

/**
 * Modular monolith (ADR-004) — โมดูลทั้ง 20 ตัวถูก register ที่นี่
 * แต่ละโมดูลคุยกันผ่าน Application Service ที่ export จาก index.ts เท่านั้น
 * ESLint import/no-restricted-paths บังคับขอบเขตนี้ให้ CI แดงเมื่อละเมิด
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] })],
  controllers: [HealthController, WorkItemController, NotificationController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS ใช้ class เปล่าเป็น module descriptor
export class AppModule {}
