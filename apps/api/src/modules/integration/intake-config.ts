/**
 * อ่านการตั้งค่าของอีเมลขาเข้า
 *
 * ## ทำไมเป็นฟังก์ชันบริสุทธิ์
 *
 * การตั้งค่าที่ไม่ครบ ต้องทำให้ระบบ **บอกว่าขาดอะไร** ไม่ใช่เงียบไปเฉย ๆ ·
 * อีเมลขาเข้าที่ปิดอยู่โดยไม่มีใครรู้ แปลว่าคำขอของคนหายไปทุกฉบับ และคนที่
 * ส่งมาจะสรุปว่าไม่มีใครสนใจ
 *
 * ตรรกะ "ตั้งค่าครบหรือยัง" จึงต้องทดสอบได้โดยไม่ต้องยกทั้งแอป — ไม่งั้น
 * เคสที่สำคัญที่สุด (ตั้งค่าไม่ครบแล้วเกิดอะไรขึ้น) จะไม่มีใครทดสอบ
 *
 * ## ปิดเป็นค่าปริยาย
 *
 * ต่างจากการแจ้งเตือนที่ "ไม่ตั้งค่า = ส่ง" · อีเมลขาเข้า **สร้างข้อมูลจริง**
 * จากสิ่งที่ระบบไม่ได้ควบคุม · การเปิดเองโดยไม่มีใครสั่ง แปลว่าใครก็ตามที่รู้
 * ที่อยู่กล่อง สร้างตั๋วในระบบได้ตั้งแต่วินาทีที่ติดตั้งเสร็จ
 */

export interface IntakeConfig {
  sourceKind: 'mailpit';
  baseUrl: string;
  systemAddress: string;
  projectKey: string;
  issueTypeName: string;
  intervalMs: number;
}

export type ConfigResult =
  | { ready: true; config: IntakeConfig }
  | { ready: false; reason: string };

/** ค่าปริยายของรอบอ่าน — เท่ากับตัวตั้งเวลาอื่นในระบบ */
export const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** ตัดชื่อออกจาก `ชื่อ <ที่อยู่>` — `SMTP_FROM` เขียนแบบมีชื่อเป็นปกติ */
export function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m?.[1] ?? from).trim().toLowerCase();
}

/**
 * อ่านการตั้งค่าจาก env
 *
 * **คืนเหตุผลที่อ่านรู้เรื่อง ไม่ใช่ `null`** — ผู้เรียกเอาไปเขียน log ได้ตรง ๆ
 * และผู้ดูแลอ่านแล้วรู้ว่าต้องตั้งอะไรเพิ่ม
 */
export function readIntakeConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
  if ((env['MAIL_INTAKE'] ?? 'off') !== 'on') {
    return { ready: false, reason: 'ปิดอยู่ — ตั้ง MAIL_INTAKE=on เพื่อเปิดรับอีเมลขาเข้า' };
  }

  const kind = env['MAIL_INTAKE_SOURCE'] ?? 'mailpit';
  if (kind !== 'mailpit') {
    /*
      ชนิดที่ยังไม่ได้เขียน ต้องถูกปฏิเสธพร้อมบอกว่ามีอะไรให้เลือก · การเงียบ
      แล้วไม่ทำอะไร ทำให้คนที่ตั้ง `imap` เชื่อว่าระบบกำลังอ่านกล่องอยู่
    */
    return {
      ready: false,
      reason: `ยังไม่รองรับ MAIL_INTAKE_SOURCE=${kind} — ตอนนี้มีแต่ mailpit (ดู IMAP_TODO)`,
    };
  }

  const missing: string[] = [];
  const projectKey = (env['MAIL_INTAKE_PROJECT'] ?? '').trim();
  const issueTypeName = (env['MAIL_INTAKE_ISSUE_TYPE'] ?? '').trim();
  const from = (env['SMTP_FROM'] ?? '').trim();
  if (projectKey === '') missing.push('MAIL_INTAKE_PROJECT (โปรเจกต์ที่ตั๋วจากอีเมลจะไปอยู่)');
  if (issueTypeName === '') missing.push('MAIL_INTAKE_ISSUE_TYPE (ประเภทงานของตั๋วจากอีเมล)');
  /*
    ไม่มีที่อยู่ของระบบ = ด่านกันวนไม่จบใช้ไม่ได้ · ปล่อยให้ทำงานต่อแปลว่า
    จดหมายแจ้งเตือนของเราเองจะกลายเป็นตั๋ว แล้ววนไม่จบทันที
  */
  if (from === '') missing.push('SMTP_FROM (ที่อยู่ของระบบ — ใช้กันจดหมายวนกลับ)');

  if (missing.length > 0) {
    return { ready: false, reason: `ตั้งค่าไม่ครบ: ${missing.join(' · ')}` };
  }

  const raw = Number(env['MAIL_INTAKE_INTERVAL_MS'] ?? '');
  /*
    รอบที่สั้นเกินไปทำให้ระบบถล่มกล่องเมลตัวเอง · ต่ำกว่า 30 วินาทีถือว่าพิมพ์ผิด
    และใช้ค่าปริยายแทน ดีกว่าเชื่อค่าที่ตั้งมาผิด
  */
  const intervalMs = Number.isFinite(raw) && raw >= 30_000 ? raw : DEFAULT_INTERVAL_MS;

  return {
    ready: true,
    config: {
      sourceKind: 'mailpit',
      baseUrl: (env['MAIL_INTAKE_URL'] ?? 'http://localhost:4825').trim(),
      systemAddress: addressOf(from),
      projectKey,
      issueTypeName,
      intervalMs,
    },
  };
}
