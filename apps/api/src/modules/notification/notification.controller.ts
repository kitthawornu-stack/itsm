/**
 * การแจ้งเตือนในแอป
 *
 * ผู้รับคือผู้ใช้ที่ล็อกอินอยู่จริง — มาจากเซสชันผ่าน `@Ctx()` (ADR-003)
 */
import { Controller, Get, HttpException, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { systemClock, type TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  itemKey: string | null;
  readAt: string | null;
  createdAt: string;
}

@Controller('notifications')
export class NotificationController {
  /**
   * รายการแจ้งเตือนของผู้ใช้ปัจจุบัน
   *
   * รวมการแจ้งเตือนระดับทีม (`userId` เป็น null) ด้วย — งานที่ยังไม่มีผู้รับผิดชอบ
   * ก็ต้องมีคนเห็นว่า SLA กำลังจะหลุด ไม่งั้นมันจะเงียบจนหลุดจริง
   */
  @Get()
  async list(
    @Ctx() ctx: TenantContext,
    @Query('unread') unreadOnly?: string,
    @Query('limit') limit?: string,
  ): Promise<{ rows: NotificationRow[]; unreadCount: number }> {
    const db = tenantScoped(ctx);
    const take = Math.min(Number(limit ?? 20) || 20, 100);

    const audience = { OR: [{ userId: ctx.actorId }, { userId: null }] };
    const where = {
      ...audience,
      ...(unreadOnly === 'true' ? { readAt: null } : {}),
    };

    const [rows, unreadCount] = await Promise.all([
      db.notification.findMany({ where, take, orderBy: { id: 'desc' } }),
      db.notification.count({ where: { ...audience, readAt: null } }),
    ]);

    // ดึงคีย์งานแยก เพื่อไม่ให้ตาราง notification ต้องมี FK ไป work_item
    // (การแจ้งเตือนบางชนิดไม่ผูกกับงาน และงานที่ถูกลบไม่ควรลบประวัติการแจ้งเตือน)
    const itemIds = [...new Set(rows.map((r) => r.workItemId).filter((v) => v !== null))];
    const items = await db.workItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, itemKey: true },
    });
    const keyById = new Map(items.map((i) => [i.id.toString(), i.itemKey]));

    return {
      unreadCount,
      rows: rows.map((r) => ({
        id: r.id.toString(),
        kind: r.kind,
        title: r.title,
        body: r.body,
        itemKey: r.workItemId === null ? null : (keyById.get(r.workItemId.toString()) ?? null),
        readAt: r.readAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  @Post(':id/read')
  async markRead(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    const db = tenantScoped(ctx);
    const found = await db.notification.findFirst({ where: { id: BigInt(id) } });
    if (found === null) {
      throw new HttpException({ message: 'ไม่พบการแจ้งเตือนนี้' }, HttpStatus.NOT_FOUND);
    }
    // อ่านซ้ำไม่เปลี่ยนเวลาที่อ่านครั้งแรก
    if (found.readAt === null) {
      await db.notification.update({ where: { id: found.id }, data: { readAt: systemClock.nowUtc() } });
    }
    return { ok: true };
  }

  @Post('read-all')
  async markAllRead(@Ctx() ctx: TenantContext): Promise<{ ok: true; count: number }> {
    const db = tenantScoped(ctx);
    const r = await db.notification.updateMany({
      where: { OR: [{ userId: ctx.actorId }, { userId: null }], readAt: null },
      data: { readAt: systemClock.nowUtc() },
    });
    return { ok: true, count: r.count };
  }
}
