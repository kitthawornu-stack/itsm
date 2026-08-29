/**
 * ที่มาของจดหมาย — สองตัวสำหรับสองสถานการณ์
 *
 * ## ทำไมมีสองตัว
 *
 * `MailpitSource` ต่อกับกล่องเมลของชุดพัฒนาได้จริง **วันนี้** — ไม่ต้องรอ
 * ใครเปิดกล่อง IMAP ให้ · แปลว่าเส้นทางทั้งหมดตั้งแต่อ่านจดหมายจนถึงตั๋วที่
 * เกิดขึ้นจริง ถูกลองด้วยของจริงได้ตั้งแต่ตอนนี้ ไม่ใช่ตอนส่งมอบ
 *
 * `ImapSource` **ยังไม่ได้เขียน** โดยตั้งใจ — เขียนไปก็ทดสอบไม่ได้ และโค้ดที่
 * ไม่มีใครเคยรันคือโค้ดที่ยังไม่รู้ว่าทำงานไหม · สิ่งที่ทำได้จริงคือกำหนด
 * สัญญา (`MailSource`) ให้ชัด แล้วปล่อยให้การต่อ IMAP เป็นการเติมช่องเดียว
 *
 * รายการที่ต้องทำตอนมีกล่องจริง เขียนไว้ที่ `IMAP_TODO` ข้างล่าง — ไม่ใช่
 * ในหัวใครสักคน (บทเรียนของ CLAUDE.md: TODO ที่ผูกกับ "เมื่อ X พร้อม"
 * ต้องถูกไล่เก็บในวันที่ X พร้อม จึงต้องเขียนไว้ให้เห็น)
 */
import type { IncomingMail } from './email-intake';
import type { MailSource } from './email-intake.service';

/** สิ่งที่ยังต้องทำเมื่อมีกล่อง IMAP จริง — อ่านคู่กับ ADR ของ Email-to-Ticket */
export const IMAP_TODO: readonly string[] = [
  'ต่อ IMAP ด้วย IDLE หรือ poll ทุก 1 นาที แล้วทำ MailSource ตัวที่สอง',
  'ทำเครื่องหมาย \\Seen หรือย้ายเข้าโฟลเดอร์ที่อ่านแล้ว หลังบันทึกลง inbound_mail สำเร็จ',
  'รองรับไฟล์แนบ — รอบนี้อ่านเฉพาะข้อความล้วน',
  'ถอดรหัสหัวจดหมายแบบ RFC 2047 (=?UTF-8?B?...?=) ซึ่ง Mailpit ถอดให้แล้ว',
];

interface MailpitListItem {
  ID: string;
  MessageID: string;
  From: { Address: string } | null;
  Subject: string;
}

interface MailpitMessage {
  ID: string;
  MessageID: string;
  From: { Address: string } | null;
  Subject: string;
  Text: string;
}

/** หัวจดหมายที่ต้องอ่าน — ตัวอื่นไม่เกี่ยวกับการตัดสิน */
const WANTED_HEADERS = [
  'auto-submitted',
  'precedence',
  'x-autoreply',
  'x-autorespond',
  'in-reply-to',
  'references',
] as const;

/**
 * กล่องเมลของชุดพัฒนา (Mailpit)
 *
 * **ไม่ใช่ของเล่น** — มันคือ SMTP จริงที่ระบบส่งอีเมลออกไปหาอยู่แล้ว จดหมาย
 * ที่อยู่ในนั้นจึงเป็นจดหมายจริงที่ระบบสร้างเอง · ใช้มันทดสอบเส้นทางขาเข้า
 * แปลว่าได้ทดสอบเคส "จดหมายของตัวเองวนกลับมา" ด้วยของจริงไปในตัว
 */
export class MailpitSource implements MailSource {
  constructor(private readonly baseUrl: string) {}

  async fetch(limit: number): Promise<IncomingMail[]> {
    const list = await this.json<{ messages?: MailpitListItem[] }>(
      `/api/v1/messages?limit=${String(limit)}`,
    );
    const out: IncomingMail[] = [];

    for (const item of list.messages ?? []) {
      /*
        ดึงทีละฉบับ เพราะรายการย่อไม่มีเนื้อความและไม่มีหัวจดหมาย · ช้ากว่า
        แต่การเดาเนื้อความจากหัวเรื่องคือการสร้างตั๋วที่ไม่มีรายละเอียด
      */
      const full = await this.json<MailpitMessage>(`/api/v1/message/${item.ID}`);
      const raw = await this.json<Record<string, string[]>>(
        `/api/v1/message/${item.ID}/headers`,
      );

      const headers: Record<string, string> = {};
      for (const [name, values] of Object.entries(raw)) {
        const key = name.toLowerCase();
        if ((WANTED_HEADERS as readonly string[]).includes(key)) {
          headers[key] = values.join(' ');
        }
      }

      out.push({
        mailboxId: item.ID,
        // Mailpit คืน Message-ID โดยไม่มีวงเล็บมุม · ทำให้อยู่ในรูปเดียวกันเสมอ
        messageId: bracket(full.MessageID),
        from: full.From?.Address ?? item.From?.Address ?? '',
        subject: full.Subject,
        text: full.Text,
        inReplyTo: parseReferences(headers['in-reply-to'], headers['references']),
        headers,
      });
    }
    return out;
  }

  private async json<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`อ่านกล่องเมลไม่สำเร็จ: HTTP ${String(res.status)} ${path}`);
    return (await res.json()) as T;
  }
}

/** ทำให้ `Message-ID` อยู่ในรูป `<...>` เสมอ — สองรูปแบบทำให้เทียบกันไม่ตรง */
export function bracket(id: string | null | undefined): string | null {
  const v = (id ?? '').trim();
  if (v === '') return null;
  return v.startsWith('<') ? v : `<${v}>`;
}

/**
 * อ่าน `In-Reply-To` และ `References` เป็นรายการเดียว
 *
 * `References` มีทั้งกระทู้ ตั้งแต่ฉบับแรกถึงฉบับล่าสุด · ใส่ทั้งหมดเพราะ
 * ฉบับที่เราเคยเห็นอาจอยู่ตรงไหนก็ได้ในนั้น — โปรแกรมเมลบางตัวตัด
 * `In-Reply-To` ทิ้งแต่ยังเก็บ `References` ไว้ครบ
 */
export function parseReferences(inReplyTo?: string, references?: string): string[] {
  const all = `${inReplyTo ?? ''} ${references ?? ''}`;
  const ids = all.match(/<[^>\s]+>/g) ?? [];
  return [...new Set(ids)];
}
