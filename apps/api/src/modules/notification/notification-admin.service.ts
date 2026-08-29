/**
 * ตั้งค่าการแจ้งเตือนจากหน้าจอ
 *
 * สองฝั่งที่ต่างกันโดยสิ้นเชิง:
 *
 *   - **ฝั่งผู้ดูแล** ปิดชนิดหนึ่งได้ทั้งองค์กรหรือเฉพาะโปรเจกต์ · ต้องเป็น
 *     ผู้ดูแลระบบ และทุกครั้งมี audit เพราะมันกระทบทุกคน
 *   - **ฝั่งผู้ใช้** ปิดของตัวเองได้ทีละช่องทาง · ไม่ต้องขอสิทธิ์ใคร และ
 *     **ไม่เขียน audit** — การที่ใครสักคนไม่อยากได้อีเมล ไม่ใช่เรื่องที่
 *     ผู้ตรวจสอบต้องรู้ และการเก็บไว้คือการเฝ้าดูพฤติกรรมโดยไม่มีเหตุผล
 *
 * เก็บเฉพาะแถวที่ **ต่างจากค่าปริยาย** — กลับไปใช้ค่าปริยาย = ลบแถวทิ้ง
 * ไม่ใช่เขียน `true` ไว้ · แถวที่เขียน `true` ไว้จะกลายเป็นการยืนยันว่า
 * "คนนี้เลือกจะรับ" ซึ่งไม่จริง เขาแค่ไม่เคยแตะมัน
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertTenantAdmin } from '../permission';
import {
  ALWAYS_ON,
  CHANNELS,
  NOTIFICATION_KINDS,
  type Channel,
  type NotificationKind,
} from './notification-policy';

export class UnknownKindError extends Error {
  constructor(readonly given: string) {
    super(`ไม่รู้จักการแจ้งเตือนชนิด "${given}"`);
    this.name = 'UnknownKindError';
  }
}

export class UnknownChannelError extends Error {
  constructor(readonly given: string) {
    super(`ไม่รู้จักช่องทาง "${given}"`);
    this.name = 'UnknownChannelError';
  }
}

export class CannotMuteError extends Error {
  constructor(readonly kind: string) {
    super(
      `ปิด "${kind}" ไม่ได้ — ปิดแล้วกระบวนการของคนอื่นหยุดโดยไม่มีใครรู้ว่ามีเรื่องรออยู่`,
    );
    this.name = 'CannotMuteError';
  }
}

export class ProjectNotFoundForRuleError extends Error {
  constructor(readonly key: string) {
    super(`ไม่พบโปรเจกต์ "${key}"`);
    this.name = 'ProjectNotFoundForRuleError';
  }
}

function assertKind(kind: string): NotificationKind {
  if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) throw new UnknownKindError(kind);
  return kind as NotificationKind;
}

function assertChannel(channel: string): Channel {
  if (!(CHANNELS as readonly string[]).includes(channel)) throw new UnknownChannelError(channel);
  return channel as Channel;
}

/**
 * ชนิดที่ปิดไม่ได้ ต้องถูกปฏิเสธ **ตอนบันทึก** ไม่ใช่แค่ตอนตัดสินใจส่ง
 *
 * ตรรกะกันไว้อยู่แล้ว แต่ถ้ายอมให้บันทึก ผู้ดูแลจะเห็นสวิตช์ปิดอยู่บนหน้าจอ
 * แล้วเชื่อว่าปิดได้ · หน้าจอที่โกหกแย่กว่าหน้าจอที่ปฏิเสธ
 */
function assertMutable(kind: string): void {
  if ((ALWAYS_ON as readonly string[]).includes(kind)) throw new CannotMuteError(kind);
}

export interface KindRow {
  kind: string;
  /** ปิดไม่ได้ — หน้าจอต้องไม่แสดงสวิตช์ให้กด */
  alwaysOn: boolean;
  /** สวิตช์รวมทั้งองค์กร — `null` = ไม่เคยตั้ง (เท่ากับเปิด) */
  tenantEnabled: boolean | null;
  /** สวิตช์รายโปรเจกต์ที่ตั้งไว้ */
  perProject: { projectKey: string; isEnabled: boolean }[];
}

export async function listAdminSwitches(ctx: TenantContext): Promise<KindRow[]> {
  await assertTenantAdmin(ctx);
  const rows = await tenantScoped(ctx).notificationRule.findMany({
    select: { kind: true, isEnabled: true, project: { select: { key: true } } },
  });

  return NOTIFICATION_KINDS.map((kind) => {
    const mine = rows.filter((r) => r.kind === kind);
    const global = mine.find((r) => r.project === null);
    return {
      kind,
      alwaysOn: (ALWAYS_ON as readonly string[]).includes(kind),
      tenantEnabled: global?.isEnabled ?? null,
      perProject: mine
        .filter((r) => r.project !== null)
        .map((r) => ({ projectKey: r.project?.key ?? '', isEnabled: r.isEnabled }))
        .sort((a, b) => a.projectKey.localeCompare(b.projectKey)),
    };
  });
}

export async function setAdminSwitch(
  ctx: TenantContext,
  input: { kind: string; projectKey?: string | null; isEnabled: boolean },
): Promise<{ kind: string; isEnabled: boolean }> {
  await assertTenantAdmin(ctx);
  const kind = assertKind(input.kind);
  if (!input.isEnabled) assertMutable(kind);

  const db = tenantScoped(ctx);
  let projectId: bigint | null = null;
  const key = input.projectKey?.trim() ?? '';
  if (key !== '') {
    const p = await db.project.findFirst({ where: { key }, select: { id: true } });
    if (p === null) throw new ProjectNotFoundForRuleError(key);
    projectId = p.id;
  }

  return auditedTransaction(ctx, 'notification.switch', async (tx) => {
    /*
      `upsert` ไม่ได้ เพราะ unique index มี `projectId` ที่เป็น null ได้ และ
      MySQL ถือว่า NULL ไม่เท่ากับ NULL — แถวสวิตช์รวมจึงซ้ำกันได้ไม่จำกัด
      ถ้าเชื่อ unique index อย่างเดียว (บทเรียนเดียวกับ Issue Link)
    */
    const existing = await tx.notificationRule.findFirst({
      where: { tenantId: ctx.tenantId, kind, projectId },
      select: { id: true, isEnabled: true },
    });
    if (existing === null) {
      await tx.notificationRule.create({
        data: { tenantId: ctx.tenantId, kind, projectId, isEnabled: input.isEnabled },
      });
    } else {
      await tx.notificationRule.update({
        where: { id: existing.id },
        data: { isEnabled: input.isEnabled },
      });
    }

    return {
      result: { kind, isEnabled: input.isEnabled },
      audit: [
        {
          kind: 'system' as const,
          action: input.isEnabled ? 'notification.enable' : 'notification.disable',
          entityType: 'notification_rule',
          entityId: `${kind}:${key === '' ? 'ทุกโปรเจกต์' : key}`,
          payload: { kind, projectKey: key === '' ? null : key, from: existing?.isEnabled ?? null },
        },
      ],
    };
  });
}

export interface MyPreference {
  kind: string;
  alwaysOn: boolean;
  /** ค่าที่ใช้จริง — ค่าปริยายคือเปิด */
  inApp: boolean;
  email: boolean;
}

/** ค่าของผู้ใช้ที่กำลังเรียก — ไม่ต้องขอสิทธิ์ใคร มันเป็นของเขาเอง */
export async function myPreferences(ctx: TenantContext): Promise<MyPreference[]> {
  if (ctx.actorId === null) return [];
  const rows = await tenantScoped(ctx).notificationPreference.findMany({
    where: { userId: ctx.actorId },
    select: { kind: true, channel: true, isEnabled: true },
  });
  const off = new Set(rows.filter((r) => !r.isEnabled).map((r) => `${r.kind}:${r.channel}`));

  return NOTIFICATION_KINDS.map((kind) => ({
    kind,
    alwaysOn: (ALWAYS_ON as readonly string[]).includes(kind),
    inApp: !off.has(`${kind}:in-app`),
    email: !off.has(`${kind}:email`),
  }));
}

export async function setMyPreference(
  ctx: TenantContext,
  input: { kind: string; channel: string; isEnabled: boolean },
): Promise<{ kind: string; channel: string; isEnabled: boolean }> {
  if (ctx.actorId === null) throw new Error('ต้องเข้าสู่ระบบก่อนตั้งค่าการแจ้งเตือน');
  const kind = assertKind(input.kind);
  const channel = assertChannel(input.channel);
  if (!input.isEnabled) assertMutable(kind);

  const db = tenantScoped(ctx);
  if (input.isEnabled) {
    /*
      กลับไปใช้ค่าปริยาย = **ลบแถวทิ้ง** ไม่ใช่เขียน `true`

      แถวที่เขียน `true` ไว้จะกลายเป็นการยืนยันว่า "คนนี้เลือกจะรับ" ซึ่งไม่จริง
      · และถ้าวันหนึ่งค่าปริยายเปลี่ยน คนที่มีแถวค้างจะไม่ตามค่าปริยายใหม่
      โดยไม่มีใครรู้ว่าทำไม
    */
    await db.notificationPreference.deleteMany({
      where: { userId: ctx.actorId, kind, channel },
    });
  } else {
    const existing = await db.notificationPreference.findFirst({
      where: { userId: ctx.actorId, kind, channel },
      select: { id: true },
    });
    if (existing === null) {
      await db.notificationPreference.create({
        data: { tenantId: ctx.tenantId, userId: ctx.actorId, kind, channel, isEnabled: false },
      });
    } else {
      await db.notificationPreference.update({
        where: { id: existing.id },
        data: { isEnabled: false },
      });
    }
  }

  return { kind, channel, isEnabled: input.isEnabled };
}
