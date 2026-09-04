/**
 * ส่งการแจ้งเตือนออกทางอีเมล
 *
 * การแจ้งเตือนถูกเขียนลงฐานข้อมูลก่อนเสมอ (ดู `notification`) ไฟล์นี้คือชั้นที่
 * พามันออกไปหาคน — ที่ผ่านมามันจบอยู่ในฐานข้อมูลกับกระดิ่งบนหน้าเว็บเท่านั้น
 * ซึ่งแปลว่าคนที่ไม่ได้เปิดเว็บค้างไว้ ไม่มีทางรู้ว่า SLA กำลังจะหลุด
 *
 * **ลำดับที่สำคัญ: จองก่อนส่ง**
 * แถว `notification_delivery` ถูกสร้างด้วยสถานะ `pending` ก่อนติดต่อ SMTP
 * ถ้าสร้างหลังส่งสำเร็จ เครื่องที่ดับระหว่างรอ SMTP ตอบ จะกลับมาส่งซ้ำทั้งชุด
 * โดยไม่มีอะไรจำได้ว่าเคยพยายามแล้ว
 *
 * ทุกฟังก์ชันที่ตัดสินใจอยู่ที่นี่เป็น pure — SMTP ถูกฉีดเข้ามา
 * เพื่อให้ทดสอบ "เมื่อไรจะไม่ส่ง" ได้โดยไม่ต้องมีเซิร์ฟเวอร์เมล
 */

export const EMAIL_CHANNEL = 'email';
/** ล้มเกินจำนวนนี้แล้วหยุด — ไม่ไล่ส่งซ้ำไม่รู้จบให้ปลายทางที่พังถาวร */
export const MAX_ATTEMPTS = 3;

export interface PendingNotification {
  id: bigint;
  tenantId: bigint;
  title: string;
  body: string | null;
  itemKey: string | null;
  /** null = การแจ้งเตือนระดับทีม ยังไม่ระบุตัวบุคคล */
  recipientEmail: string | null;
  recipientName: string | null;
  /**
   * ปลายทางระดับทีม ใช้เมื่อ `recipientEmail` เป็น null
   *
   * มาจากกลุ่มที่ผูกกับโปรเจกต์ของงานใบนั้น (`project.notifyGroupId`)
   * งานที่ยังไม่มีผู้รับผิดชอบแล้ว SLA หลุด คือใบที่พลาดไม่ได้ที่สุด
   * ถ้าไม่มีปลายทางต้องบันทึกว่าข้ามเพราะอะไร ไม่ใช่เงียบไป
   */
  teamEmails?: string[];
  teamName?: string | null;
  /** อ่านแล้วก่อนที่จะส่ง = คนเห็นบนหน้าเว็บไปแล้ว */
  readAt: Date | null;
  /**
   * ผู้รับปิดอีเมลของชนิดนี้ไว้ — ตัดสินไปแล้วตอนสร้างแถว
   *
   * worker คำนวณนโยบายเองไม่ได้ (เรียกโค้ดของ api ไม่ได้) และไม่ควรคำนวณ
   * ด้วย — นโยบายสองชุดที่เขียนคนละที่ จะเริ่มตอบต่างกันวันหนึ่ง
   */
  emailSuppressed: boolean;
}

export type Decision =
  | { send: true; to: string }
  | { send: false; state: 'skipped'; reason: string };

/**
 * ตัดสินว่าจะส่งหรือไม่ส่ง
 *
 * เหตุผลที่ไม่ส่งต้องถูกบันทึกเป็น `skipped` พร้อมข้อความ ไม่ใช่ปล่อยค้างเป็น
 * `pending` ตลอดกาล — แถวที่ค้างโดยไม่มีเหตุผล คือความเงียบที่ไม่มีใครสืบต่อได้
 */
export function decide(n: PendingNotification): Decision {
  /*
    ตรวจก่อนทุกอย่าง · ผู้รับที่ปิดอีเมลไว้ ไม่ต้องรู้ด้วยซ้ำว่าอีเมลของเขา
    ถูกรูปแบบไหม หรือปลายทางของทีมมีหรือเปล่า — เหตุผลที่บันทึกต้องเป็น
    "เขาปิดไว้" ซึ่งเป็นคำตอบที่ผู้ดูแลเอาไปทำอะไรได้ ไม่ใช่คำตอบรอง
  */
  if (n.emailSuppressed) {
    return { send: false, state: 'skipped', reason: 'ผู้รับปิดอีเมลของการแจ้งเตือนชนิดนี้ไว้' };
  }
  if (n.recipientEmail === null || n.recipientEmail.trim() === '') {
    /**
     * ไม่มีตัวบุคคล → ลองปลายทางของทีม
     *
     * ตรวจ `readAt` **ก่อน** เพราะการแจ้งเตือนระดับทีมที่ถูกอ่านแล้ว
     * แปลว่ามีคนในทีมเห็นและรับไปแล้ว การส่งอีเมลตามหลังจึงกวนเปล่า ๆ
     */
    if (n.readAt !== null) {
      return { send: false, state: 'skipped', reason: 'มีคนในทีมอ่านบนหน้าเว็บไปแล้วก่อนส่ง' };
    }
    const valid = (n.teamEmails ?? []).map((e) => e.trim()).filter((e) => e.includes('@'));
    if (valid.length === 0) {
      return {
        send: false,
        state: 'skipped',
        reason:
          'ไม่มีผู้รับที่ระบุตัวได้ และโปรเจกต์ยังไม่ได้ตั้งกลุ่มรับแจ้งเตือน (project.notifyGroupId)',
      };
    }
    // ส่งฉบับเดียวถึงทุกคนในทีม ไม่ใช่คนละฉบับ — การตอบกลับจะได้อยู่ที่เดียวกัน
    return { send: true, to: valid.join(', ') };
  }
  if (!n.recipientEmail.includes('@')) {
    return { send: false, state: 'skipped', reason: `อีเมลผู้รับไม่ถูกรูปแบบ: ${n.recipientEmail}` };
  }
  if (n.readAt !== null) {
    // อ่านบนหน้าเว็บไปแล้วก่อนถึงคิวส่ง — อีเมลซ้ำสิ่งที่เห็นแล้วมีแต่กวน
    return { send: false, state: 'skipped', reason: 'ผู้รับอ่านบนหน้าเว็บไปแล้วก่อนส่ง' };
  }
  return { send: true, to: n.recipientEmail };
}

export interface RenderedEmail {
  subject: string;
  text: string;
}

/**
 * ข้อความอีเมล — ภาษาคน ไม่ใช่ศัพท์ระบบ (CLAUDE.md §5)
 *
 * ไม่มี HTML โดยตั้งใจ: อีเมลแจ้งเตือนที่ดีอ่านจบได้จากหน้า preview บนมือถือ
 * และข้อความล้วนผ่านตัวกรองสแปมง่ายกว่า เมื่อมีเทมเพลตของแบรนด์ค่อยเพิ่ม HTML
 */
export function renderEmail(n: PendingNotification, webBaseUrl: string): RenderedEmail {
  const lines: string[] = [];
  if (n.recipientName !== null) lines.push(`เรียน ${n.recipientName}`, '');
  else if (n.teamName !== null && n.teamName !== undefined) {
    // ทีมต้องรู้ว่าทำไมถึงได้รับ — งานใบนี้ยังไม่มีใครรับผิดชอบ
    lines.push(`เรียนทีม ${n.teamName}`, '', 'งานใบนี้ยังไม่มีผู้รับผิดชอบ', '');
  }
  lines.push(n.title);
  if (n.body !== null && n.body.trim() !== '') lines.push('', n.body.trim());
  if (n.itemKey !== null) {
    lines.push('', `เปิดดูงาน: ${webBaseUrl}/browse/${n.itemKey}`);
  }
  lines.push('', '— Helix Service Desk', 'อีเมลฉบับนี้ส่งอัตโนมัติ ไม่ต้องตอบกลับ');

  return {
    // หัวเรื่องขึ้นต้นด้วยคีย์งาน เพื่อให้กล่องจดหมายจัดกลุ่มและค้นหาได้
    // แต่ **ไม่เติมซ้ำถ้าหัวข้อขึ้นต้นด้วยคีย์นั้นอยู่แล้ว** — ข้อความ SLA
    // ขึ้นต้นด้วยคีย์งานเป็นปกติ ผลคือ "[SD-5225] SD-5225 หลุด SLA แล้ว"
    // ซึ่งกินที่ในหน้า preview บนมือถือไปฟรี ๆ หนึ่งช่วง
    subject:
      n.itemKey === null || n.title.startsWith(n.itemKey)
        ? n.title
        : `[${n.itemKey}] ${n.title}`,
    text: lines.join('\n'),
  };
}

/** ไฟล์ที่แนบไปกับอีเมล */
export interface MailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface MailSender {
  send(msg: {
    to: string;
    subject: string;
    text: string;
    /** ไม่ใส่ = ไม่มีไฟล์แนบ · การแจ้งเตือนทั่วไปไม่เคยมี */
    attachments?: MailAttachment[];
  }): Promise<void>;
}

export interface DeliveryDeps {
  /** การแจ้งเตือนที่ยังไม่มีแถวส่งของช่องทางนี้ */
  loadUndelivered(limit: number): Promise<PendingNotification[]>;
  /**
   * จองสิทธิ์ส่ง — สร้างแถว `pending`
   *
   * คืน false เมื่อมีแถวอยู่แล้ว (มี worker อีกตัวจองไปก่อน หรือเคยพยายามแล้ว)
   * ซึ่งต้อง **ข้ามไปเลย** ไม่ใช่ส่งทับ — unique index เป็นคนบอก ไม่ใช่การเช็กก่อน
   */
  claim(notificationId: bigint, tenantId: bigint, target: string | null): Promise<boolean>;
  markSent(notificationId: bigint): Promise<void>;
  markFailed(notificationId: bigint, error: string): Promise<void>;
  markSkipped(notificationId: bigint, reason: string): Promise<void>;
  mailer: MailSender;
  webBaseUrl: string;
}

export interface DeliveryReport {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * รอบการส่งหนึ่งรอบ
 *
 * ล้มทีละใบไม่ล้มทั้งรอบ — SMTP ปฏิเสธผู้รับคนหนึ่งไม่ควรทำให้อีกสิบคนไม่ได้รับ
 */
export async function runEmailDelivery(
  deps: DeliveryDeps,
  limit = 50,
): Promise<DeliveryReport> {
  const rows = await deps.loadUndelivered(limit);
  const report: DeliveryReport = { scanned: rows.length, sent: 0, skipped: 0, failed: 0 };

  for (const n of rows) {
    const decision = decide(n);

    // จองก่อนเสมอ ทั้งกรณีที่จะส่งและกรณีที่จะข้าม
    // เพื่อให้รอบถัดไปไม่ต้องมาตัดสินใจเรื่องเดิมซ้ำ
    const claimed = await deps.claim(n.id, n.tenantId, decision.send ? decision.to : null);
    if (!claimed) continue;

    if (!decision.send) {
      await deps.markSkipped(n.id, decision.reason);
      report.skipped += 1;
      continue;
    }

    try {
      const mail = renderEmail(n, deps.webBaseUrl);
      await deps.mailer.send({ to: decision.to, subject: mail.subject, text: mail.text });
      await deps.markSent(n.id);
      report.sent += 1;
    } catch (err) {
      await deps.markFailed(n.id, err instanceof Error ? err.message : String(err));
      report.failed += 1;
    }
  }

  return report;
}
