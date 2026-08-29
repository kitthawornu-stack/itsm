/**
 * จุดเดียวที่การแจ้งเตือนถูกสร้าง
 *
 * ที่ผ่านมาแต่ละ service เรียก `tx.notification.createMany()` เอง · ตราบใดที่
 * ยังเป็นอย่างนั้น **สวิตช์ของผู้ดูแลจะไม่มีผลกับที่ที่ลืมต่อสาย** และไม่มี
 * อะไรบอกว่าลืมที่ไหน — กับดักเดิมของโครงการนี้ในรูปแบบใหม่
 *
 * ทุกที่จึงต้องเรียกผ่าน `createNotifications()` และมีเทสต์ที่สแกนซอร์สจริง
 * ว่าไม่มีใครเรียก `notification.createMany` ตรง ๆ นอกไฟล์นี้
 *
 * ## ทำไมรับ `tx` เข้ามา
 *
 * INVARIANT 2 บังคับให้ mutation กับ audit อยู่ในทรานแซกชันเดียวกัน · การแจ้งเตือน
 * ที่ถูกเขียนนอกทรานแซกชันจะรอดมาแม้ตอนที่การเปลี่ยนแปลงถูกย้อนกลับ แล้วคน
 * จะได้รับข้อความเรื่องสิ่งที่ไม่เคยเกิดขึ้น
 */
import type { TenantContext } from '@itsm/types';

import type { TxClient } from '../../infrastructure/audit/audited-transaction';
import {
  decideNotification,
  type AdminSwitch,
  type Channel,
  type UserPreference,
} from './notification-policy';

export interface NotificationDraft {
  /**
   * ผู้รับ — `null` = การแจ้งเตือนระดับทีมที่ยังไม่ระบุตัวบุคคล
   *
   * งานที่ยังไม่มีผู้รับผิดชอบต้องมีใครสักคนเห็น · แถวแบบนี้ไม่มีเจ้าของ
   * จึงไม่มีค่าที่ผู้ใช้ตั้งไว้ให้อ่าน — **สวิตช์ของผู้ดูแลยังใช้อยู่**
   */
  userId: bigint | null;
  workItemId: bigint | null;
  kind: string;
  title: string;
  body?: string | null;
  dedupeKey: string;
}

export interface CreateResult {
  /** จำนวนแถวที่เขียนจริง */
  created: number;
  /** จำนวนที่ถูกปิดโดยผู้ดูแล — แยกจากที่ผู้ใช้ปิดเอง เพราะแก้กันคนละที่ */
  mutedByAdmin: number;
  /** จำนวนที่ผู้ใช้ปิดกระดิ่งเอง */
  mutedByUser: number;
  /**
   * จำนวนแถวที่เขียนไว้แล้วแต่ **ปิดอีเมลไว้**
   *
   * เคยคืนเป็นรายชื่อผู้ใช้ให้ผู้เรียกเอาไปทำต่อ · **ไม่มีใครเอาไปทำอะไรเลย**
   * และคนที่ปิดอีเมลไว้ก็ยังได้รับอีเมลอยู่ · คำตอบย้ายไปอยู่บนแถวเอง
   * (`notification.emailSuppressed`) เพราะ worker เรียกโค้ดของ api ไม่ได้
   * ตัวเลขนี้เหลือไว้เพื่อให้ผู้เรียกรายงานได้ ไม่ใช่เพื่อให้ไปทำอะไรต่อ
   */
  emailSuppressed: number;
}

/**
 * สร้างการแจ้งเตือนตามนโยบาย
 *
 * อ่านสวิตช์ทั้งของผู้ดูแลและของผู้ใช้ครั้งเดียวต่อการเรียกหนึ่งครั้ง ไม่ใช่
 * ต่อคนหนึ่งคน — รายชื่อผู้รับของความเห็นหนึ่งฉบับมีได้หลายสิบคน การถามทีละคน
 * คือคิวรีหลายสิบครั้งในทรานแซกชันที่ถือล็อกอยู่
 */
export async function createNotifications(
  ctx: TenantContext,
  tx: TxClient,
  projectId: bigint,
  drafts: readonly NotificationDraft[],
): Promise<CreateResult> {
  if (drafts.length === 0) {
    return { created: 0, mutedByAdmin: 0, mutedByUser: 0, emailSuppressed: 0 };
  }

  const kinds = [...new Set(drafts.map((d) => d.kind))];
  const userIds = [...new Set(drafts.map((d) => d.userId))].filter(
    (id): id is bigint => id !== null,
  );

  const [ruleRows, prefRows] = await Promise.all([
    tx.notificationRule.findMany({
      where: {
        tenantId: ctx.tenantId,
        kind: { in: kinds },
        OR: [{ projectId: null }, { projectId }],
      },
      select: { kind: true, projectId: true, isEnabled: true },
    }),
    tx.notificationPreference.findMany({
      where: { tenantId: ctx.tenantId, userId: { in: userIds }, kind: { in: kinds } },
      select: { userId: true, kind: true, channel: true, isEnabled: true },
    }),
  ]);

  const admin: AdminSwitch[] = ruleRows.map((r) => ({
    kind: r.kind,
    projectId: r.projectId,
    isEnabled: r.isEnabled,
  }));

  const prefsByUser = new Map<string, UserPreference[]>();
  for (const p of prefRows) {
    const key = p.userId.toString();
    const list = prefsByUser.get(key) ?? [];
    list.push({ kind: p.kind, channel: p.channel as Channel, isEnabled: p.isEnabled });
    prefsByUser.set(key, list);
  }

  const keep: (NotificationDraft & { emailSuppressed: boolean })[] = [];
  let mutedByAdmin = 0;
  let mutedByUser = 0;

  for (const d of drafts) {
    const decision = decideNotification({
      kind: d.kind,
      projectId,
      admin,
      // แถวระดับทีมไม่มีเจ้าของ จึงไม่มีค่าที่ตั้งไว้ให้อ่าน
      user: d.userId === null ? [] : (prefsByUser.get(d.userId.toString()) ?? []),
    });
    if (!decision.inApp) {
      if (decision.mutedBy === 'admin') mutedByAdmin += 1;
      else mutedByUser += 1;
      /*
        ผู้ดูแลปิด = ไม่มีอีเมลด้วย · แต่ **ไม่ต้องใส่ใน `emailMutedUserIds`**
        เพราะไม่มีแถวให้ชั้นอีเมลไปเจอตั้งแต่แรก · การใส่เข้าไปจะทำให้ตัวเลข
        อ่านเหมือนมีคนที่ถูกกันอีเมลไว้ ทั้งที่เขาไม่ได้อยู่ในรายการเลย
      */
      continue;
    }
    keep.push({ ...d, emailSuppressed: !decision.email });
  }

  const created =
    keep.length === 0
      ? { count: 0 }
      : await tx.notification.createMany({
          data: keep.map((d) => ({
            tenantId: ctx.tenantId,
            userId: d.userId,
            workItemId: d.workItemId,
            kind: d.kind,
            title: d.title,
            body: d.body ?? null,
            dedupeKey: d.dedupeKey,
            // คำตอบเดินทางไปกับแถว — worker อ่านได้โดยไม่ต้องรู้จักนโยบาย
            emailSuppressed: d.emailSuppressed,
          })),
          // unique index บน (tenantId, dedupeKey) เป็นด่านสุดท้าย
          skipDuplicates: true,
        });

  return {
    created: created.count,
    mutedByAdmin,
    mutedByUser,
    emailSuppressed: keep.filter((k) => k.emailSuppressed).length,
  };
}
