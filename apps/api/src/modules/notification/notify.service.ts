/**
 * แจ้งเตือนคนทั้งกลุ่ม
 *
 * โมดูลนี้ `export {}` เปล่ามาตลอด — การแจ้งเตือนที่มีอยู่ถูกเขียนแทรกอยู่ใน
 * service ของแต่ละเรื่อง (มอบหมาย · ความเห็น · workflow · อนุมัติ) ซึ่งใช้ได้
 * เพราะทุกที่แจ้ง **คนเดียว** ที่รู้ตัวอยู่แล้วว่าเป็นใคร
 *
 * "แจ้งกลุ่ม" ต่างออกไป: ต้องกระจายเป็นรายคน และทุกคนที่ได้รับต้องเปิดเรื่องนั้น
 * ได้จริง · ตรรกะนั้นไม่ควรอยู่ในโมดูล automation เพราะมันไม่ใช่เรื่องของกฎ
 *
 * ## สามข้อที่ตัดสินใจไว้ตรงนี้
 *
 * 1. **กลุ่มที่ไม่มีอยู่ หรือไม่มีสมาชิก ต้องเป็นความล้มเหลวที่มองเห็น**
 *    ไม่ใช่คืน "ส่งแล้ว 0 คน" ซึ่งอ่านเหมือนสำเร็จ · ผู้ดูแลที่พิมพ์ชื่อกลุ่มผิด
 *    จะเชื่อว่ากฎทำงานอยู่ตลอดไป
 *
 * 2. **คนที่เปิดเรื่องนั้นไม่ได้ ต้องไม่ได้รับ** — การแจ้งเตือนที่กดแล้วเจอ 403
 *    แย่กว่าไม่แจ้ง เพราะมันบอกว่ามีเรื่องอยู่ พร้อมกับหัวข้อของมัน ให้คนที่
 *    ไม่ควรรู้ · นี่คือการรั่วของข้อมูล ไม่ใช่แค่ประสบการณ์ที่ไม่ดี
 *
 * 3. **`dedupeKey` ห้ามมีเวลาอยู่ในคีย์** — กติกาเดียวกับ `jobId` ของคิว
 *    (CLAUDE.md §4) · คีย์ที่มีเวลาจะสร้างแถวใหม่ทุกครั้งที่ลองใหม่ แล้ว
 *    unique index ที่มีไว้กันส่งซ้ำก็ไม่กันอะไรเลย
 */
import type { TenantContext } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { can } from '../permission';
import { createNotifications } from './notification.service';

export class GroupNotFoundError extends Error {
  constructor(readonly given: string) {
    super(`ไม่พบกลุ่ม "${given}"`);
    this.name = 'GroupNotFoundError';
  }
}

export class NobodyToNotifyError extends Error {
  constructor(
    readonly groupName: string,
    readonly reason: string,
  ) {
    super(`ไม่มีใครในกลุ่ม "${groupName}" ที่จะแจ้งได้ — ${reason}`);
    this.name = 'NobodyToNotifyError';
  }
}

export interface GroupNotice {
  /** ชื่อกลุ่มตามที่ผู้ดูแลพิมพ์ — ไม่ใช่ id เพราะหน้าจอเห็นแต่ชื่อ */
  groupName: string;
  workItemId: bigint;
  projectId: bigint;
  kind: string;
  title: string;
  body?: string;
  /**
   * ส่วนที่ทำให้เหตุการณ์นี้ต่างจากเหตุการณ์อื่น
   *
   * ต้องประกอบจากสิ่งที่**ไม่เปลี่ยนเมื่อลองใหม่** เท่านั้น — เช่นรหัสกฎกับ
   * รหัสเรื่อง · ห้ามใส่เวลา
   */
  dedupeSeed: string;
  /** คนที่ทำให้เหตุการณ์นี้เกิด — ไม่ต้องบอกเขาถึงสิ่งที่เขาเพิ่งทำเอง */
  excludeUserId?: bigint | null;
}

export interface NotifyResult {
  /** จำนวนคนที่ได้รับจริงในครั้งนี้ */
  notified: number;
  /** คนที่ข้ามเพราะเปิดเรื่องนั้นไม่ได้ — นับไว้ให้ผู้ดูแลเห็นว่ากลุ่มตั้งผิด */
  skippedNoAccess: number;
}

/**
 * แจ้งทุกคนในกลุ่มที่เปิดเรื่องนั้นได้
 *
 * โยนเมื่อไม่มีใครได้รับเลย — ผู้เรียกต้องบันทึกเหตุผลนั้นให้ผู้ดูแลเห็น
 * ไม่ใช่กลืนแล้วรายงานว่าสำเร็จ
 */
export async function notifyGroup(
  ctx: TenantContext,
  notice: GroupNotice,
): Promise<NotifyResult> {
  /*
    ตัดช่องว่างหัวท้ายแล้วค้นตรง ๆ

    **ไม่มี `if (name === '') throw` โดยตั้งใจ** — เคยเขียนไว้ แล้วรอบพิสูจน์ว่า
    เทสต์แดงได้จับว่าลบทั้งบรรทัดก็ยังเขียวทั้ง 10 เคส เพราะการค้นด้วยชื่อว่าง
    ไม่เจอกลุ่มไหนอยู่แล้ว และได้ `GroupNotFoundError` ทางเดียวกัน · ด่านที่
    ลบแล้วยังเขียวคือด่านที่ไม่ได้กันอะไร และการเก็บไว้ทำให้คนอ่านเชื่อว่ามีชั้น
    ป้องกันเพิ่ม (บทเรียนเดียวกับ `Number.isFinite` ใน automation-engine)
  */
  const name = notice.groupName.trim();
  const db = tenantScoped(ctx);
  const group = await db.userGroup.findFirst({ where: { name }, select: { id: true } });
  if (group === null) throw new GroupNotFoundError(name);

  const members = await db.groupMember.findMany({
    where: { groupId: group.id },
    select: { userId: true, user: { select: { isActive: true, isSystem: true } } },
  });

  /*
    ตัดผู้ใช้ระบบออก — มันไม่มีใครอ่าน และการนับมันเข้าไปทำให้ "แจ้งแล้ว 1 คน"
    เป็นจริงทั้งที่ไม่มีคนได้รับสักคน · ตัดคนที่ปิดบัญชีแล้วด้วยเหตุผลเดียวกัน
  */
  const candidates = members
    .filter((m) => m.user.isActive && !m.user.isSystem)
    .map((m) => m.userId)
    .filter((id) => id !== notice.excludeUserId);

  if (candidates.length === 0) {
    throw new NobodyToNotifyError(name, 'กลุ่มนี้ไม่มีสมาชิกที่ใช้งานอยู่');
  }

  /*
    ตรวจสิทธิ์ **รายคน** ไม่ใช่ตรวจครั้งเดียวแล้วเหมาว่าทั้งกลุ่มเหมือนกัน ·
    คนหนึ่งอาจอยู่หลายกลุ่ม และสิทธิ์มาจากทุกกลุ่มรวมกัน การเหมาจึงผิดได้
    ทั้งสองทาง: แจ้งคนที่ไม่ควรรู้ หรือไม่แจ้งคนที่ควรรู้
  */
  const allowed: bigint[] = [];
  for (const userId of candidates) {
    if (await can({ tenantId: ctx.tenantId, actorId: userId }, notice.projectId, 'BROWSE_PROJECT')) {
      allowed.push(userId);
    }
  }

  if (allowed.length === 0) {
    throw new NobodyToNotifyError(name, 'ไม่มีสมาชิกคนไหนเปิดโปรเจกต์นี้ได้');
  }

  /*
    เขียนผ่านจุดรวมเดียวกับที่อื่น ไม่เรียก `createMany` เอง — สวิตช์ของผู้ดูแล
    ต้องมีผลกับการแจ้งกลุ่มด้วย · ทางลัดตรงนี้คือรูรั่วที่ไม่มีอะไรบอกว่ามีอยู่

    ใช้ `$transaction` เพราะจุดรวมต้องการ `tx` — การแจ้งเตือนที่เขียนนอก
    ทรานแซกชันจะรอดมาแม้ตอนที่การเปลี่ยนแปลงถูกย้อนกลับ
  */
  const result = await db.$transaction(async (tx) =>
    createNotifications(
      ctx,
      tx,
      notice.projectId,
      allowed.map((userId) => ({
        userId,
        workItemId: notice.workItemId,
        kind: notice.kind,
        // แจ้งทั้งกลุ่มตามที่ผู้เรียกระบุ — ปลายทางเป็นกลุ่ม ไม่ใช่บทบาทในตั๋ว
        reason: 'group',
        title: notice.title,
        body: notice.body ?? null,
        // ไม่มีเวลาในคีย์ — ลองใหม่ต้องชนของเดิม ไม่ใช่สร้างแถวใหม่
        dedupeKey: `${notice.dedupeSeed}:${userId.toString()}`,
      })),
    ),
  );

  return {
    notified: result.created,
    skippedNoAccess: candidates.length - allowed.length,
  };
}
