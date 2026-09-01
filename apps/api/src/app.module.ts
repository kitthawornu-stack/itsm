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
import { AutomationController } from './modules/automation/automation.controller';
import { NotificationSettingsController } from './modules/notification/notification-settings.controller';
import { AutomationScheduler } from './modules/automation/automation.scheduler';
import { IndexWatchScheduler } from './modules/search-index/index-watch.scheduler';
import { EmailIntakeScheduler } from './modules/integration/intake.scheduler';
import { WorkflowAdminController } from './modules/workflow/workflow-admin.controller';
import { SavedFilterController } from './modules/search-index/saved-filter.controller';
import {
  CatalogAdminController,
  CatalogController,
} from './modules/catalog/catalog.controller';
import { ApprovalController } from './modules/approval/approval.controller';
import {
  ChangeCalendarController,
  ChangeFreezeController,
  ChangeReviewController,
  ChangeRiskController,
  ChangeWindowController,
} from './modules/workitem/change-window.controller';
import { CmdbController, WorkItemCiController } from './modules/cmdb/cmdb.controller';
import { AuditController } from './modules/audit/audit.controller';
import { DashboardController } from './modules/reporting/dashboard.controller';
import {
  BacklogController,
  ProjectSprintController,
  SprintController,
  StoryPointController,
} from './modules/sprint/sprint.controller';
import {
  ItemVersionController,
  ProjectVersionController,
  RoadmapController,
  VersionController,
} from './modules/version/version.controller';
import { OpenApiController } from './infrastructure/openapi/openapi.controller';
import { WebhookController } from './modules/integration/webhook.controller';
import { WebhookScheduler } from './modules/integration/webhook.scheduler';
import { ReportController } from './modules/reporting/report.controller';
import { KnowledgeController } from './modules/knowledge/knowledge.controller';
import { BoardController } from './modules/board/board.controller';
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
    AutomationController,
    NotificationSettingsController,
    WorkflowAdminController,
    WorkItemController,
    SavedFilterController,
    CatalogController,
    CatalogAdminController,
    ApprovalController,
    ChangeReviewController,
  ChangeRiskController,
  ChangeWindowController,
    ChangeCalendarController,
    ChangeFreezeController,
    CmdbController,
    WorkItemCiController,
    AuditController,
    ReportController,
    DashboardController,
    WebhookController,
    OpenApiController,
    ProjectSprintController,
    BacklogController,
    SprintController,
    StoryPointController,
    ProjectVersionController,
    VersionController,
    ItemVersionController,
    RoadmapController,
    KnowledgeController,
    BoardController,
    NotificationController,
  ],
  /**
   * ปิดทุก endpoint โดยปริยาย — endpoint สาธารณะต้องติด `@Public()` เอง
   * ทิศทางนี้ทำให้ endpoint ที่ลืมตั้งค่าพังทันที แทนที่จะเปิดโล่งเงียบ ๆ
   */
  providers: [
    /*
      งานเบื้องหลังของกฎอัตโนมัติ · อยู่ในโปรเซสของ api เพราะ worker เรียกโค้ด
      ของ api ไม่ได้ และการกวาดต้องใช้เอนจินกับ service ที่ลงมือทำจริง
      — ดูเหตุผลเต็มที่หัวไฟล์ automation.scheduler.ts
    */
    AutomationScheduler,
    /*
      เฝ้าระวังดัชนีค้นหา · `/health` ตอบถูกก็ต่อเมื่อมีคนถาม และชุดที่ส่งมอบ
      ไม่มีระบบเฝ้าระวังภายนอกที่คอยถาม — ดูเหตุผลเต็มที่หัวไฟล์
    */
    IndexWatchScheduler,
    /*
      อ่านกล่องเมลตามรอบ · ปิดเป็นค่าปริยาย และเขียน log เสมอว่าเปิดหรือปิด
      เพราะอีเมลขาเข้าที่ปิดเงียบ ๆ แปลว่าคำขอของคนหายไปทุกฉบับ
    */
    EmailIntakeScheduler,
    WebhookScheduler,
    { provide: APP_GUARD, useClass: SessionGuard },
    // 403 ที่เดียวสำหรับทั้งแอป — handler ใหม่ไม่ต้องจำที่จะดักเอง
    { provide: APP_FILTER, useClass: PermissionDeniedFilter },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS ใช้ class เปล่าเป็น module descriptor
export class AppModule {}
