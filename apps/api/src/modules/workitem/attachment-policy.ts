/**
 * กติกาว่าไฟล์แบบไหนรับได้ และเก็บด้วยชื่ออะไร
 *
 * แยกเป็นฟังก์ชันบริสุทธิ์ทั้งหมด เพราะทุกข้อที่นี่คือช่องโหว่ถ้าพลาด
 * และการทดสอบมันไม่ควรต้องมี MinIO
 *
 * สามอย่างที่กันไว้ และเหตุผล:
 *
 *   1. **ชื่อไฟล์จากผู้ใช้ไม่ถูกใช้เป็น path** — `../../etc/passwd` หรือ
 *      `C:\Windows\..` เขียนทับไฟล์นอกที่ที่ตั้งใจได้ · ชื่อจริงเก็บไว้ในฐานข้อมูล
 *      เพื่อแสดงและตอนดาวน์โหลด ส่วน key ใน object storage สร้างเองทั้งหมด
 *
 *   2. **ชนิดไฟล์ใช้บัญชีอนุญาต ไม่ใช่บัญชีห้าม** — บัญชีห้ามต้องเดาให้ครบทุกอย่าง
 *      ที่อันตราย ซึ่งเป็นไปไม่ได้ · บัญชีอนุญาตผิดพลาดไปทางปฏิเสธ ซึ่งผู้ใช้บ่นได้
 *      แต่ไม่ทำให้ระบบพัง
 *
 *   3. **SVG ไม่อยู่ในบัญชีอนุญาต** แม้จะเป็นรูปภาพ — มันคือ XML ที่รัน
 *      JavaScript ได้เมื่อเปิดตรง ๆ ในเบราว์เซอร์ ผู้ใช้ที่แนบ SVG มาแล้วอีกคน
 *      กดเปิด เท่ากับรันสคริปต์ของคนแรกในเซสชันของคนที่สอง
 */

/** 25 MB — ใหญ่พอสำหรับภาพหน้าจอและ log แต่ไม่ให้ใครอัปวิดีโอทั้งไฟล์ */
export const MAX_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * ชนิดที่รับ — บัญชีอนุญาต ไม่ใช่บัญชีห้าม
 *
 * ตั้งใจไม่มี: `image/svg+xml` (รันสคริปต์ได้) · `text/html` (เหมือนกัน)
 * · ไฟล์บีบอัดและไฟล์รันทุกชนิด
 */
export const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

export type Rejection =
  | { ok: false; code: 'empty'; message: string }
  | { ok: false; code: 'too_large'; message: string }
  | { ok: false; code: 'type_not_allowed'; message: string }
  | { ok: false; code: 'bad_filename'; message: string };

export type Validation = { ok: true } | Rejection;

export function validateUpload(file: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Validation {
  if (file.sizeBytes <= 0) {
    return { ok: false, code: 'empty', message: 'ไฟล์ว่างเปล่า' };
  }
  if (file.sizeBytes > MAX_SIZE_BYTES) {
    const mb = Math.round(MAX_SIZE_BYTES / 1024 / 1024);
    return {
      ok: false,
      code: 'too_large',
      message: `ไฟล์ใหญ่เกิน ${String(mb)} MB — ลองบีบอัดหรือแนบเฉพาะส่วนที่เกี่ยวข้อง`,
    };
  }
  // ตัดพารามิเตอร์อย่าง "; charset=utf-8" ออกก่อนเทียบ และเทียบแบบตัวพิมพ์เล็ก
  const mime = file.mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!ALLOWED_MIME.has(mime)) {
    return {
      ok: false,
      code: 'type_not_allowed',
      message: `ยังไม่รองรับไฟล์ชนิด ${mime === '' ? 'ที่ไม่ระบุชนิด' : mime}`,
    };
  }
  if (safeDisplayName(file.filename) === '') {
    return { ok: false, code: 'bad_filename', message: 'ชื่อไฟล์ไม่ถูกต้อง' };
  }
  return { ok: true };
}

/**
 * ชื่อที่ปลอดภัยพอจะเก็บลงฐานข้อมูลและส่งกลับให้ผู้ใช้เห็น
 *
 * ตัดทุกส่วนของ path ทิ้ง (ทั้ง `/` และ `\`) ตัดอักขระควบคุมและตัวที่ทำให้
 * header `Content-Disposition` แตก — `"` และ newline ทำให้แทรก header ปลอมได้
 */
export function safeDisplayName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? '';
  return base
    .replace(/[\u0000-\u001f\u007f"\\]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
}

/**
 * key ใน object storage — **สร้างเองทั้งหมด ไม่มีส่วนไหนมาจากผู้ใช้**
 *
 * แยกตาม tenant เป็นชั้นแรก เพื่อให้เผลอตั้ง policy ผิดแล้วยังจำกัดความเสียหาย
 * อยู่ใน tenant เดียว และเพื่อให้ลบทั้ง tenant ได้ด้วย prefix เดียว
 */
export function storageKey(params: {
  tenantId: bigint;
  workItemId: bigint;
  attachmentId: bigint;
  filename: string;
}): string {
  const ext = extensionOf(safeDisplayName(params.filename));
  return `t${params.tenantId.toString()}/w${params.workItemId.toString()}/${params.attachmentId.toString()}${ext}`;
}

/** นามสกุลที่ปลอดภัย — ตัวอักษรและตัวเลขเท่านั้น ยาวไม่เกิน 10 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? `.${ext}` : '';
}

/**
 * ค่า `Content-Disposition` ตอนดาวน์โหลด
 *
 * **บังคับ `attachment` เสมอ ไม่ใช่ `inline`** — ไฟล์ที่เบราว์เซอร์เปิดเองได้
 * จะรันในโดเมนของเรา ซึ่งเท่ากับให้คนอัปโหลดรันโค้ดในเซสชันของคนที่เปิด
 * ชื่อไฟล์ส่งสองรูปแบบ: ASCII สำรอง และ UTF-8 สำหรับชื่อไทย (RFC 6266)
 */
/**
 * แก้ชื่อไฟล์ที่ถูกถอดรหัสเป็น latin-1 ตอนแกะ multipart
 *
 * busboy (ที่ multer ใช้อยู่ข้างใน) ถอด `filename` ของ multipart เป็น latin-1
 * โดยปริยาย ผลคือชื่อไทย "หน้าจอ.png" ที่ส่งมาเป็น UTF-8 กลายเป็น "à¸«à¸..."
 * แล้วถูกเก็บลงฐานข้อมูลแบบนั้น — ผู้ใช้เห็นขยะทุกครั้งที่แนบไฟล์ชื่อไทย
 *
 * วัดจริง: ไบต์ที่เก็บได้คือ C3A0 C2B8 C2AB ซึ่งคือ UTF-8 ของ "à¸«"
 * ไม่ใช่ E0B8AB ซึ่งคือ UTF-8 ของ "ห" — เข้ารหัสซ้อนสองชั้นชัดเจน
 *
 * วิธีแก้คือย้อนกลับ: เอาอักขระกลับเป็นไบต์แบบ latin-1 แล้วอ่านใหม่เป็น UTF-8
 * ถ้าย้อนแล้วไม่ใช่ UTF-8 ที่ถูกต้อง แปลว่าชื่อนั้นเป็น latin-1 จริง ๆ
 * (หรือถูกส่งมาถูกต้องอยู่แล้ว) จึงคืนค่าเดิม
 */
export function decodeMultipartFilename(raw: string): string {
  // ไม่มีอักขระในช่วง latin-1 สูง = ไม่ได้ถูกถอดผิด ไม่ต้องแตะ
  if (!/[\u0080-\u00ff]/.test(raw)) return raw;

  const reinterpreted = Buffer.from(raw, 'latin1').toString('utf8');
  // U+FFFD คือสัญญาณว่าไบต์ชุดนั้นไม่ใช่ UTF-8 — อย่าฝืน
  return reinterpreted.includes('\ufffd') ? raw : reinterpreted;
}

export function contentDisposition(filename: string): string {
  const safe = safeDisplayName(filename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_') || 'attachment';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
