/**
 * จุดต่อระหว่างระบบกับกฎอัตโนมัติ
 *
 * `runAutomation` เป็นกลไกที่ดีแต่ **ไม่มีค่าอะไรเลยถ้าไม่มีอะไรเรียกมัน**
 * (บทเรียนที่โครงการนี้เจอซ้ำที่สุด — ดู CLAUDE.md §4) · ไฟล์นี้คือสายที่ต่อจริง
 *
 * หน้าที่มีสองอย่าง:
 *
 *   1. **อ่านสภาพของงาน ณ ตอนนี้** แล้วประกอบเป็น `AutomationEvent` —
 *      เอนจินไม่แตะฐานข้อมูล มันจึงต้องได้ค่ามาครบตั้งแต่แรก
 *   2. **สลับผู้กระทำเป็นผู้ใช้ระบบ** — สิ่งที่ระบบทำเองต้องอ่านได้ว่าระบบทำ
 *      ไม่ใช่ว่าคนที่บังเอิญกดปุ่มเป็นคนทำ · ประวัติที่โกหกเรื่องคนทำ
 *      แย่กว่าไม่มีประวัติ เพราะมีคนเชื่อมัน
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { type AutomationEvent, type TriggerKind } from './automation-engine';
import { runAutomation, type AutomationResult } from './automation.service';

export interface FireOptions {
  /** ชื่อปุ่มที่เพิ่งกด — เฉพาะ `item.transitioned` */
  transitionName?: string;
  /** จำนวนวันที่ไม่มีความเคลื่อนไหว — เฉพาะ `item.idle` · ตัวกวาดคำนวณให้ */
  idleDays?: number;
  /**
   * ชั้นของการปลุกต่อกัน
   *
   * ผู้เรียกจากภายนอก (คนกดปุ่ม) เป็น 0 เสมอ · ค่าที่มากกว่านั้นมาจากกฎที่
   * ปลุกกฎอื่นต่อ ซึ่งเอนจินเป็นคนหยุดเมื่อลึกเกินเพดาน
   */
  depth?: number;
}

/**
 * ปลุกกฎอัตโนมัติจากเหตุการณ์ที่เพิ่งเกิดกับงานใบหนึ่ง
 *
 * **ไม่โยน error ออกไปหาผู้เรียก** — คนที่กดปุ่มแจ้งเรื่องต้องไม่เจอหน้าจอแดง
 * เพราะกฎอัตโนมัติของผู้ดูแลเขียนผิด · ความล้มเหลวไปอยู่ในตาราง `automation_run`
 * ซึ่งเป็นที่ที่ผู้ดูแลไปดู ไม่ใช่ที่ที่ผู้แจ้งเรื่องต้องรับผิดชอบ
 *
 * คืน `null` เมื่อหางานไม่เจอหรือไม่มีผู้ใช้ระบบ — ผู้เรียกไม่ต้องทำอะไรต่อ
 */
export async function fireAutomation(
  ctx: TenantContext,
  itemKey: string,
  kind: TriggerKind,
  options: FireOptions = {},
  now: UtcDate = systemClock.nowUtc(),
): Promise<AutomationResult | null> {
  try {
    const db = tenantScoped(ctx);
    const item = await db.workItem.findFirst({
      where: { itemKey },
      select: {
        id: true,
        itemKey: true,
        projectId: true,
        assigneeId: true,
        project: { select: { key: true } },
        issueType: { select: { name: true } },
        status: { select: { name: true, category: true } },
        priority: { select: { rank: true } },
      },
    });
    if (item === null) return null;

    /*
      ป้ายอ่านจาก EAV ไม่ใช่จาก `fieldSnapshot`

      snapshot เป็นสำเนาอ่านอย่างเดียวสำหรับเรนเดอร์ลิสต์ และไม่ออกจาก
      repository layer (ADR-001) · ที่สำคัญกว่านั้น: กฎที่ตัดสินใจจากสำเนา
      จะตัดสินใจจากค่าที่ล้าหลังหนึ่งจังหวะเมื่อ snapshot ยังไม่ถูกเขียนใหม่
      ซึ่งเป็นความผิดที่ไม่มีอะไรฟ้อง — กฎแค่ "ไม่ทำงานบางครั้ง"
    */
    const labelRows = await db.workItemFieldValue.findMany({
      where: { workItemId: item.id, field: { type: 'LABELS' } },
      orderBy: { position: 'asc' },
      select: { valueText: true },
    });

    const event: AutomationEvent = {
      kind,
      item: {
        itemKey: item.itemKey,
        projectKey: item.project.key,
        issueTypeName: item.issueType.name,
        statusName: item.status.name,
        statusCategory: item.status.category,
        priorityRank: item.priority?.rank ?? null,
        assigneeId: item.assigneeId?.toString() ?? null,
        labels: labelRows.map((r) => r.valueText).filter((v): v is string => v !== null),
      },
      ...(options.transitionName === undefined ? {} : { transitionName: options.transitionName }),
      ...(options.idleDays === undefined ? {} : { idleDays: options.idleDays }),
      actorId: ctx.actorId?.toString() ?? null,
      depth: options.depth ?? 0,
    };

    /*
      ผู้ใช้ระบบมีได้หนึ่งคนต่อองค์กร · หาไม่เจอไม่ใช่เหตุให้เงียบ —
      `runAutomation` จะบันทึกเป็น failed พร้อมเหตุผลให้ผู้ดูแลเห็น
    */
    const bot = await db.user.findFirst({
      where: { isSystem: true, isActive: true },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    const botCtx: TenantContext = {
      tenantId: ctx.tenantId,
      actorId: bot?.id ?? null,
      ...(ctx.traceId === undefined ? {} : { traceId: ctx.traceId }),
    };

    return await runAutomation(botCtx, item.projectId, event, now);
  } catch (err) {
    /*
      ไม่ปล่อย error ออกไปหาผู้เรียก — เขาแจ้งเรื่องสำเร็จแล้ว ไม่ควรเจอหน้าจอแดง
      เพราะกฎอัตโนมัติอ่านสภาพงานไม่ได้

      แต่ **ห้ามเงียบ** · การกลืน error เปล่า ๆ คือความล้มเหลวแบบที่โครงการนี้
      ตามหายากที่สุด — กฎจะ "ไม่ทำงานบางครั้ง" โดยไม่มีร่องรอยอะไรเลย
      จึงพยายามทิ้งแถวไว้ให้ผู้ดูแลเห็น และถ้าเขียนไม่ลงจริง ๆ ก็ยอมเงียบได้
      เพราะแปลว่าฐานข้อมูลเองมีปัญหา ซึ่งมีอย่างอื่นดังกว่านี้อยู่แล้ว
    */
    const reason = err instanceof Error ? err.message : String(err);
    try {
      await tenantScoped(ctx).automationRun.create({
        data: {
          // นาฬิกาเดียวกับที่เหลือของรอบ — ดู automation.service.ts
          createdAt: now,
          tenantId: ctx.tenantId,
          ruleName: '—',
          trigger: kind,
          actionKind: '—',
          actionValue: itemKey,
          outcome: 'failed',
          reason: `อ่านสภาพงานเพื่อปลุกกฎไม่สำเร็จ: ${reason}`,
          traceId: `auto-fail-${String(now.getTime())}-${itemKey}`,
          depth: options.depth ?? 0,
        },
      });
    } catch {
      // ฐานข้อมูลเขียนไม่ลง — ไม่มีที่ไหนให้บันทึกแล้ว
    }
    return null;
  }
}
