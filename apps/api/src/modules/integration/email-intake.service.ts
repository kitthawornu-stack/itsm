/**
 * ลงมือทำตามที่ `email-intake` ตัดสิน
 *
 * ## กล่องเมลถูกฉีดเข้ามา
 *
 * `MailSource` เป็นอินเทอร์เฟซ ไม่ใช่การต่อ IMAP ตรง ๆ · เหตุผลไม่ใช่ความ
 * สวยงามของโครงสร้าง แต่เป็นเพราะ **เคสที่สำคัญที่สุดคือเคสที่ไม่สร้างตั๋ว**
 * (จดหมายวนกลับ · การตอบอัตโนมัติ · ผู้ส่งที่ไม่รู้จัก) และการทดสอบเคสเหล่านั้น
 * ต้องไม่ต้องมีเซิร์ฟเวอร์เมล — กติกาเดียวกับที่ CLAUDE.md บังคับไว้กับ SMTP
 *
 * ## กันอ่านซ้ำที่ฐานข้อมูล ไม่ใช่ที่ตัวอ่าน
 *
 * ตัวอ่านที่จำว่าอ่านถึงไหนในหน่วยความจำ จะเริ่มนับใหม่ทุกครั้งที่รีสตาร์ต
 * แล้วสร้างตั๋วซ้ำทั้งกล่อง · unique index บน `(tenantId, mailboxId)` เป็นด่านจริง
 *
 * ## จองก่อนทำ
 *
 * แถว `inbound_mail` ถูกเขียน **ก่อน** สร้างตั๋ว (กติกาเดียวกับ
 * `notification_delivery`) · เครื่องที่ดับระหว่างสร้างตั๋วต้องไม่กลับมาอ่าน
 * จดหมายฉบับเดิมซ้ำ
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { addComment, createWorkItem } from '../workitem';
import { decideIntake, type IncomingMail } from './email-intake';

/** ที่มาของจดหมาย — IMAP ในการใช้งานจริง, ตัวปลอมในเทสต์ */
export interface MailSource {
  /** จดหมายที่ยังไม่เคยอ่าน · ผู้เรียกกรองซ้ำอีกชั้นด้วย `mailboxId` */
  fetch(limit: number): Promise<IncomingMail[]>;
}

export interface IntakeSettings {
  /** ที่อยู่ที่ระบบใช้ส่งออก — จดหมายจากที่นี่คือเสียงสะท้อนของตัวเอง */
  systemAddress: string;
  /** โปรเจกต์ที่ตั๋วจากอีเมลจะไปอยู่ */
  projectKey: string;
  /** ประเภทงานของตั๋วที่สร้างจากอีเมล */
  issueTypeName: string;
}

export interface IntakeResult {
  created: number;
  commented: number;
  rejected: number;
  /** จดหมายที่เคยอ่านไปแล้ว — ไม่ใช่ความผิดพลาด แต่ต้องนับให้เห็น */
  skipped: number;
}

/**
 * อ่านกล่องหนึ่งรอบ
 *
 * **ไม่โยนออกไปหาผู้เรียก** — จดหมายฉบับหนึ่งที่พังต้องไม่ทำให้อีกยี่สิบฉบับ
 * ไม่ถูกอ่าน · ความล้มเหลวรายฉบับถูกบันทึกเป็นแถว `rejected` พร้อมเหตุผล
 */
export async function runEmailIntake(
  ctx: TenantContext,
  source: MailSource,
  settings: IntakeSettings,
  limit = 50,
  now: UtcDate = systemClock.nowUtc(),
): Promise<IntakeResult> {
  const db = tenantScoped(ctx);
  const result: IntakeResult = { created: 0, commented: 0, rejected: 0, skipped: 0 };

  for (const mail of await source.fetch(limit)) {
    const already = await db.inboundMail.findFirst({
      where: { mailboxId: mail.mailboxId },
      select: { id: true },
    });
    if (already !== null) {
      result.skipped += 1;
      continue;
    }

    /*
      หาเรื่องเดิมจาก `In-Reply-To` — จดหมายที่เราเคยอ่านและสร้างเรื่องไว้
      จะมี `messageId` ของมันเก็บอยู่ · การเทียบกับ `Message-ID` ของจดหมาย
      ขาออกที่เราส่งเองก็ได้ผลเหมือนกัน แต่รอบนี้ยังไม่เก็บฝั่งขาออก
    */
    let threadItemKey: string | null = null;
    if (mail.inReplyTo.length > 0) {
      const parent = await db.inboundMail.findFirst({
        where: { messageId: { in: [...mail.inReplyTo] }, workItemId: { not: null } },
        orderBy: { id: 'desc' },
        select: { workItem: { select: { itemKey: true } } },
      });
      threadItemKey = parent?.workItem?.itemKey ?? null;
    }

    const sender = await db.user.findFirst({
      where: { email: senderAddress(mail.from), isActive: true },
      select: { id: true },
    });

    const decision = decideIntake(mail, {
      systemAddress: settings.systemAddress,
      threadItemKey,
      senderIsKnown: sender !== null,
    });

    // จองก่อนทำ — เครื่องที่ดับตอนสร้างตั๋วต้องไม่กลับมาอ่านฉบับเดิมซ้ำ
    const row = await db.inboundMail.create({
      data: {
        tenantId: ctx.tenantId,
        mailboxId: mail.mailboxId,
        messageId: mail.messageId,
        fromAddress: senderAddress(mail.from).slice(0, 320),
        subject: mail.subject.slice(0, 1000),
        outcome: 'rejected',
        reason: decision.action === 'reject' ? decision.reason : 'กำลังดำเนินการ',
        receivedAt: now,
      },
      select: { id: true },
    });

    if (decision.action === 'reject') {
      result.rejected += 1;
      continue;
    }

    /*
      ลงมือด้วยสิทธิ์ของ **ผู้ส่ง** ไม่ใช่ของระบบ — ตั๋วที่มาจากอีเมลของสมชาย
      ต้องอ่านได้ว่าสมชายเป็นคนแจ้ง และเขาต้องมีสิทธิ์แจ้งในโปรเจกต์นั้นจริง
      · การใช้สิทธิ์ของระบบจะสร้างตั๋วให้คนที่ไม่มีสิทธิ์ได้เงียบ ๆ
    */
    const asSender: TenantContext = { tenantId: ctx.tenantId, actorId: sender?.id ?? null };

    try {
      if (decision.action === 'create') {
        const item = await createWorkItem(asSender, {
          projectKey: settings.projectKey,
          issueTypeName: settings.issueTypeName,
          summary: decision.summary,
          description: decision.description,
        });
        await db.inboundMail.update({
          where: { id: row.id },
          data: { outcome: 'created', reason: null, workItemId: item.id },
        });
        result.created += 1;
      } else {
        await addComment(asSender, { itemKey: decision.itemKey, body: decision.body });
        const item = await db.workItem.findFirst({
          where: { itemKey: decision.itemKey },
          select: { id: true },
        });
        await db.inboundMail.update({
          where: { id: row.id },
          data: { outcome: 'commented', reason: null, workItemId: item?.id ?? null },
        });
        result.commented += 1;
      }
    } catch (e) {
      // ล้มทีละฉบับ ไม่ล้มทั้งรอบ · เหตุผลต้องอ่านรู้เรื่อง ไม่ใช่ค้างเป็น "กำลังดำเนินการ"
      await db.inboundMail.update({
        where: { id: row.id },
        data: { outcome: 'rejected', reason: e instanceof Error ? e.message : String(e) },
      });
      result.rejected += 1;
    }
  }

  return result;
}

/** ตัดชื่อออกจาก `ชื่อ <ที่อยู่>` แล้วทำให้เป็นตัวพิมพ์เล็ก */
function senderAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m?.[1] ?? from).trim().toLowerCase();
}
