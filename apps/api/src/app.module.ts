import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { PermissionDeniedFilter } from './infrastructure/http/permission-denied.filter';
import { SessionGuard } from './infrastructure/http/session.guard';

import { IdentityController } from './modules/identity/identity.controller';
import {
  SelfServiceController,
  UserAdminController,
} from './modules/identity/user-admin.controller';
import { FieldAdminController } from './modules/field/field-admin.controller';
import { IssueTypeController } from './modules/field/issue-type.controller';
import { LookupController } from './modules/field/lookup.controller';
import { CalendarController } from './modules/sla/calendar.controller';
import { HealthController } from './modules/health/health.controller';
import { NotificationController } from './modules/notification/notification.controller';
import { ProjectAdminController } from './modules/tenancy/project-admin.controller';
import { WorkflowAdminController } from './modules/workflow/workflow-admin.controller';
import { SavedFilterController } from './modules/search-index/saved-filter.controller';
import { WorkItemController } from './modules/workitem/workitem.controller';

/**
 * Modular monolith (ADR-004) — โมดูลทั้ง 20 ตัวถูก register ที่นี่
 * แต่ละโมดูลคุยกันผ่าน Application Service ที่ export จาก index.ts เท่านั้น
 * ESLint import/no-restricted-paths บังคับขอบเขตนี้ให้ CI แดงเมื่อละเมิด
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] })],
  controllers: [
    HealthController,
    IdentityController,
    UserAdminController,
    SelfServiceController,
    LookupController,
    IssueTypeController,
    FieldAdminController,
    CalendarController,
    ProjectAdminController,
    WorkflowAdminController,
    WorkItemController,
    SavedFilterController,
    NotificationController,
  ],
  /**
   * ปิดทุก endpoint โดยปริยาย — endpoint สาธารณะต้องติด `@Public()` เอง
   * ทิศทางนี้ทำให้ endpoint ที่ลืมตั้งค่าพังทันที แทนที่จะเปิดโล่งเงียบ ๆ
   */
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    // 403 ที่เดียวสำหรับทั้งแอป — handler ใหม่ไม่ต้องจำที่จะดักเอง
    { provide: APP_FILTER, useClass: PermissionDeniedFilter },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS ใช้ class เปล่าเป็น module descriptor
export class AppModule {}
