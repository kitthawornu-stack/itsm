/**
 * อ่าน audit log — v1
 *
 * **ผู้ดูแล tenant เท่านั้น** · audit คือร่องรอยของทุกคนในองค์กร รวมถึงบันทึก
 * ภายในและการเปลี่ยนสิทธิ์ · การเปิดให้ทุกคนอ่านคือการเปิดเผยว่าใครทำอะไร
 * กับใครบ้าง ซึ่งเป็นข้อมูลคนละชั้นกับเนื้อหาของงาน
 */
import { Controller, Get, Query } from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { assertTenantAdmin } from '../permission';
import {
  AUDIT_PAGE_MAX,
  readAuditLog,
  sinceFromRange,
  type AuditPage,
} from './audit-read.service';

@Controller('admin/audit')
export class AuditController {
  @Get()
  async list(
    @Ctx() ctx: TenantContext,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('range') range?: string,
    @Query('offset') offset?: string,
  ): Promise<AuditPage & { max: number }> {
    await assertTenantAdmin(ctx);
    const r = range === 'today' || range === '7d' || range === '30d' ? range : 'all';
    const page = await readAuditLog(ctx, {
      ...(action === undefined ? {} : { action }),
      ...(entityType === undefined ? {} : { entityType }),
      ...(sinceFromRange(r) === undefined ? {} : { since: sinceFromRange(r) }),
      // ค่าที่พังตกกลับเป็นหน้าแรก — ลิงก์เก่าไม่ควรทำให้หน้าจอพัง
      offset: Math.max(0, Math.floor(Number(offset ?? 0)) || 0),
    });
    return { ...page, max: AUDIT_PAGE_MAX };
  }
}
