/**
 * อีเมลขาเข้า → ตั๋ว หรือความเห็น
 *
 * ตรรกะล้วน ไม่แตะฐานข้อมูล ไม่ต่อเน็ต · ตัดสินอย่างเดียวว่า **จดหมายฉบับนี้
 * ควรกลายเป็นอะไร** ส่วนการลงมือทำอยู่ที่ `email-intake.service`
 *
 * ## กับดักที่ใหญ่ที่สุดคือวนไม่จบ
 *
 * ระบบส่งอีเมลแจ้งเตือนออกไป · ปลายทางตั้งตอบกลับอัตโนมัติไว้ · คำตอบนั้นเข้ามา
 * กลายเป็นตั๋วใหม่ · ตั๋วใหม่ทำให้ส่งแจ้งเตือนอีกฉบับ · **วนไม่จบภายในไม่กี่นาที**
 * และแต่ละรอบสร้างตั๋วจริงที่คนต้องมาไล่ปิดทีหลัง
 *
 * กันสามชั้น เพราะชั้นเดียวไม่พอ:
 *
 *   1. จดหมายที่ส่งจากที่อยู่ของระบบเอง — ตัดทิ้งทันที
 *   2. หัวจดหมายที่บอกว่าเป็นการตอบอัตโนมัติ (`Auto-Submitted` · `Precedence`)
 *   3. หัวเรื่องที่ขึ้นต้นด้วยรูปแบบของการตอบอัตโนมัติที่พบบ่อยในไทยและอังกฤษ
 *
 * ## ผู้ส่งที่ไม่รู้จัก
 *
 * รับเฉพาะอีเมลของคนที่มีบัญชีในระบบ · เหตุผลคือกล่องนี้เปิดรับจากอินเทอร์เน็ต
 * ได้ และตั๋วที่สร้างจากใครก็ได้คือช่องทางสแปมที่เปิดตลอดเวลา
 *
 * **แต่ต้องไม่เงียบ** — จดหมายที่ถูกปฏิเสธต้องถูกบันทึกพร้อมเหตุผล ไม่ใช่ทิ้ง
 * ไปเฉย ๆ · คนที่ส่งมาแล้วไม่มีใครตอบ จะไม่มีวันรู้ว่าระบบไม่เคยเห็นจดหมายเขา
 */

/** จดหมายหนึ่งฉบับ ตามที่อ่านมาจากกล่อง */
export interface IncomingMail {
  /** รหัสของจดหมายในกล่อง — ใช้กันอ่านซ้ำ */
  mailboxId: string;
  /** `Message-ID` ของจดหมาย — ใช้ผูกความเห็นกลับเข้าเรื่องเดิม */
  messageId: string | null;
  from: string;
  subject: string;
  /** เนื้อความล้วน ยังไม่ตัดข้อความที่ยกมา */
  text: string;
  /** `In-Reply-To` และ `References` รวมกัน — ยิ่งมากยิ่งหาเรื่องเดิมเจอ */
  inReplyTo: readonly string[];
  /** หัวจดหมายอื่นที่ใช้ตัดสิน ชื่อหัวเป็นตัวพิมพ์เล็กทั้งหมด */
  headers: Readonly<Record<string, string>>;
}

export interface IntakeContext {
  /** ที่อยู่ที่ระบบใช้ส่งออก — จดหมายจากที่อยู่นี้คือเสียงสะท้อนของตัวเอง */
  systemAddress: string;
  /** คีย์เรื่องที่หาเจอจาก `inReplyTo` — ผู้เรียกเป็นคนค้นให้ */
  threadItemKey: string | null;
  /** ผู้ส่งมีบัญชีในระบบไหม */
  senderIsKnown: boolean;
}

export type IntakeDecision =
  | { action: 'create'; summary: string; description: string }
  | { action: 'comment'; itemKey: string; body: string }
  | { action: 'reject'; reason: string };

/** เหตุผลที่ปฏิเสธ — เขียนไว้ที่เดียวเพื่อให้ข้อความในทุกที่ตรงกัน */
export const REJECT = {
  loop: 'จดหมายฉบับนี้ส่งมาจากที่อยู่ของระบบเอง — ตัดทิ้งเพื่อกันวนไม่จบ',
  auto: 'เป็นการตอบกลับอัตโนมัติ ไม่ใช่คำขอของคน',
  unknown: 'ผู้ส่งยังไม่มีบัญชีในระบบ — เพิ่มผู้ใช้ก่อนจึงจะรับอีเมลจากที่อยู่นี้ได้',
  empty: 'ไม่มีทั้งหัวเรื่องและเนื้อความ — ไม่มีอะไรให้บันทึกเป็นเรื่อง',
} as const;

/** หัวจดหมายที่บอกว่าเป็นการตอบอัตโนมัติ */
const AUTO_HEADERS: ReadonlyArray<[string, RegExp]> = [
  ['auto-submitted', /^(?!no\b)/i],
  ['precedence', /^(bulk|auto_reply|list|junk)$/i],
  ['x-autoreply', /.*/],
  ['x-autorespond', /.*/],
];

/**
 * คำขึ้นต้นหัวเรื่องที่แปลว่าตอบอัตโนมัติ
 *
 * `Re:` **ไม่ได้อยู่ในรายการนี้** — คนตอบกลับจดหมายจริงก็ใช้ `Re:` เหมือนกัน
 * การตัดทิ้งจะทำให้ความเห็นของคนหายไปทั้งหมด ซึ่งแย่กว่าการรับสแปมบางฉบับ
 */
const AUTO_SUBJECTS: readonly RegExp[] = [
  /^\s*(out of office|automatic reply|auto[- ]?reply|undeliverable)\b/i,
  /^\s*(ตอบกลับอัตโนมัติ|ไม่อยู่ที่สำนักงาน|ระบบตอบรับอัตโนมัติ)/,
];

/** คีย์เรื่องในหัวเรื่อง เช่น `[SD-1042]` — ตัวสำรองเมื่อไม่มีหัวจดหมายให้ตาม */
const SUBJECT_KEY = /\[([A-Z][A-Z0-9]{1,9}-\d+)\]/;

function normalise(address: string): string {
  const m = /<([^>]+)>/.exec(address);
  return (m?.[1] ?? address).trim().toLowerCase();
}

function isAutoReply(mail: IncomingMail): boolean {
  for (const [name, pattern] of AUTO_HEADERS) {
    const value = mail.headers[name];
    if (value !== undefined && pattern.test(value.trim())) return true;
  }
  return AUTO_SUBJECTS.some((re) => re.test(mail.subject));
}

/**
 * ตัดข้อความที่ยกมาจากจดหมายฉบับก่อน
 *
 * ความเห็นที่พกทั้งกระทู้มาด้วยทุกครั้ง จะยาวขึ้นเรื่อย ๆ จนไม่มีใครอ่าน และ
 * ข้อความจริงจะจมอยู่บรรทัดบนสุดของกำแพงข้อความ
 *
 * **ตัดแบบระมัดระวัง** — ตัดเกินไปแปลว่าข้อความของคนหายไป ซึ่งแย่กว่าเหลือ
 * ข้อความเก่าติดมา · จึงตัดเฉพาะรูปแบบที่ชัดเจนจริง ๆ และถ้าตัดแล้วไม่เหลืออะไร
 * ให้คืนข้อความเต็ม เพราะแปลว่าเราเดาผิด
 */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const markers = [
    /^\s*On .+ wrote:\s*$/i,
    /^\s*เมื่อ .+ เขียนว่า:\s*$/,
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
    /^\s*_{5,}\s*$/,
    /^\s*From:\s.+$/i,
    /^\s*จาก:\s.+$/,
  ];
  let cut = lines.length;
  for (const [i, line] of lines.entries()) {
    if (markers.some((re) => re.test(line))) {
      cut = i;
      break;
    }
  }
  const kept = lines.slice(0, cut).join('\n').trim();
  // ตัดแล้วไม่เหลืออะไร = เราเดาผิด · คืนของเดิมดีกว่าคืนค่าว่าง
  return kept === '' ? text.trim() : kept;
}

/** ตัด `Re:` `Fwd:` และคีย์ในวงเล็บออกจากหัวเรื่อง เพื่อใช้เป็นชื่อเรื่อง */
export function cleanSubject(subject: string): string {
  return subject
    .replace(/^\s*((re|fwd|fw|ตอบกลับ|ส่งต่อ)\s*:\s*)+/i, '')
    .replace(SUBJECT_KEY, '')
    .trim();
}

/** คีย์เรื่องที่อยู่ในหัวเรื่อง — `null` เมื่อไม่มี */
export function itemKeyInSubject(subject: string): string | null {
  return SUBJECT_KEY.exec(subject)?.[1] ?? null;
}

/**
 * ตัดสินว่าจดหมายฉบับนี้ควรกลายเป็นอะไร
 *
 * ลำดับการตรวจสำคัญ — เหตุผลที่บันทึกต้องเป็นเหตุผลที่ผู้ดูแลเอาไปทำอะไรได้
 * ไม่ใช่เหตุผลรอง · จดหมายที่วนกลับมาเอง ไม่ต้องรู้ด้วยซ้ำว่าผู้ส่งมีบัญชีไหม
 */
export function decideIntake(mail: IncomingMail, ctx: IntakeContext): IntakeDecision {
  if (normalise(mail.from) === normalise(ctx.systemAddress)) {
    return { action: 'reject', reason: REJECT.loop };
  }
  if (isAutoReply(mail)) return { action: 'reject', reason: REJECT.auto };
  if (!ctx.senderIsKnown) return { action: 'reject', reason: REJECT.unknown };

  const body = stripQuoted(mail.text);
  const subject = cleanSubject(mail.subject);
  if (subject === '' && body === '') return { action: 'reject', reason: REJECT.empty };

  /*
    หาเรื่องเดิมจากหัวจดหมายก่อน แล้วค่อยดูหัวเรื่อง

    `In-Reply-To` เชื่อถือได้กว่า เพราะโปรแกรมเมลไม่แก้มัน · ส่วนหัวเรื่อง
    ถูกแก้ ถูกแปล และถูกตัดได้ตลอด · แต่หัวเรื่องเป็นทางเดียวที่ใช้ได้เมื่อ
    มีคน **ส่งต่อ** จดหมายเข้ามา ซึ่งเป็นวิธีที่คนใช้กันจริง
  */
  const itemKey = ctx.threadItemKey ?? itemKeyInSubject(mail.subject);
  if (itemKey !== null) {
    // ความเห็นที่ไม่มีเนื้อความ ไม่ใช่ความเห็น · หัวเรื่องอย่างเดียวไม่พอ
    if (body === '') return { action: 'reject', reason: REJECT.empty };
    return { action: 'comment', itemKey, body };
  }

  return {
    action: 'create',
    // หัวเรื่องว่างแต่มีเนื้อความ ยังเป็นคำขอที่ใช้ได้ — ตั้งชื่อจากบรรทัดแรกให้
    summary: subject === '' ? firstLine(body) : subject,
    description: body,
  };
}

/** บรรทัดแรกที่มีตัวอักษร ตัดให้พอเป็นชื่อเรื่อง */
function firstLine(body: string): string {
  const line = body.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  return line.trim().slice(0, 120);
}
