/**
 * กติกาไฟล์แนบ — เทสต์เป็นข้อกำหนด
 *
 * เขียนจากมุมของคนที่พยายามแนบไฟล์อันตราย ไม่ใช่มุมของคนที่แนบภาพหน้าจอ
 * ทุกเคสที่นี่คือช่องโหว่จริงที่เคยทำให้ระบบอื่นถูกเจาะมาแล้ว
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_SIZE_BYTES,
  contentDisposition,
  decodeMultipartFilename,
  safeDisplayName,
  storageKey,
  validateUpload,
} from './attachment-policy';

const file = (over: Partial<Parameters<typeof validateUpload>[0]> = {}) => ({
  filename: 'หน้าจอที่ error.png',
  mimeType: 'image/png',
  sizeBytes: 120_000,
  ...over,
});

describe('validateUpload', () => {
  it('ภาพหน้าจอปกติผ่าน', () => {
    expect(validateUpload(file())).toEqual({ ok: true });
  });

  it('ไฟล์ว่างถูกปฏิเสธ — ไม่ใช่เก็บ object ขนาดศูนย์', () => {
    expect(validateUpload(file({ sizeBytes: 0 }))).toMatchObject({ ok: false, code: 'empty' });
  });

  it('ใหญ่เกินเพดานถูกปฏิเสธ และบอกทางออก ไม่ใช่แค่ว่าใหญ่ไป', () => {
    const r = validateUpload(file({ sizeBytes: MAX_SIZE_BYTES + 1 }));
    expect(r).toMatchObject({ ok: false, code: 'too_large' });
    if (!r.ok) expect(r.message).toContain('บีบอัด');
  });

  it('ขนาดเท่าเพดานพอดียังผ่าน (ขอบเขตแบบ <=)', () => {
    expect(validateUpload(file({ sizeBytes: MAX_SIZE_BYTES }))).toEqual({ ok: true });
  });

  it('**SVG ถูกปฏิเสธแม้เป็นรูปภาพ** — มันรัน JavaScript ได้', () => {
    // คนหนึ่งแนบ SVG อีกคนกดเปิด = รันสคริปต์ของคนแรกในเซสชันของคนที่สอง
    expect(validateUpload(file({ mimeType: 'image/svg+xml', filename: 'a.svg' }))).toMatchObject({
      ok: false,
      code: 'type_not_allowed',
    });
  });

  it('HTML ถูกปฏิเสธด้วยเหตุผลเดียวกัน', () => {
    expect(validateUpload(file({ mimeType: 'text/html', filename: 'a.html' }))).toMatchObject({
      ok: false,
      code: 'type_not_allowed',
    });
  });

  it.each([
    'application/x-msdownload',
    'application/x-sh',
    'application/zip',
    'application/octet-stream',
    'application/javascript',
  ])('ชนิดที่ไม่อยู่ในบัญชีอนุญาตถูกปฏิเสธ: %s', (mimeType) => {
    expect(validateUpload(file({ mimeType }))).toMatchObject({ ok: false, code: 'type_not_allowed' });
  });

  it('ไม่ระบุชนิดถูกปฏิเสธ — ไม่ใช่เดาให้', () => {
    expect(validateUpload(file({ mimeType: '' }))).toMatchObject({
      ok: false,
      code: 'type_not_allowed',
    });
  });

  it('พารามิเตอร์ท้าย MIME ไม่ทำให้ชนิดที่ถูกต้องถูกปฏิเสธ', () => {
    expect(validateUpload(file({ mimeType: 'text/plain; charset=utf-8' }))).toEqual({ ok: true });
  });

  it('ตัวพิมพ์ใหญ่ใน MIME ไม่ทำให้หลุดบัญชีอนุญาต', () => {
    expect(validateUpload(file({ mimeType: 'IMAGE/PNG' }))).toEqual({ ok: true });
    expect(validateUpload(file({ mimeType: 'Image/SVG+XML' }))).toMatchObject({ ok: false });
  });

  it('ชื่อไฟล์ที่เหลือแต่ path ถูกปฏิเสธ', () => {
    expect(validateUpload(file({ filename: '../../' }))).toMatchObject({
      ok: false,
      code: 'bad_filename',
    });
  });
});

describe('safeDisplayName', () => {
  it('ตัด path แบบยูนิกซ์ออก', () => {
    expect(safeDisplayName('../../etc/passwd')).toBe('passwd');
  });

  it('ตัด path แบบวินโดวส์ออก', () => {
    expect(safeDisplayName('C:\\Windows\\System32\\cmd.exe')).toBe('cmd.exe');
  });

  it('ตัดจุดนำหน้าออก — ไฟล์ซ่อนไม่ควรเกิดจากชื่อที่ผู้ใช้ตั้ง', () => {
    expect(safeDisplayName('.bashrc')).toBe('bashrc');
  });

  it('**ตัดอัญประกาศและขึ้นบรรทัดใหม่** — ไม่งั้นแทรก header ปลอมได้', () => {
    const evil = 'a".png\r\nX-Injected: yes';
    const safe = safeDisplayName(evil);
    expect(safe).not.toContain('"');
    expect(safe).not.toContain('\r');
    expect(safe).not.toContain('\n');
  });

  it('ชื่อไทยไม่ถูกทำลาย', () => {
    expect(safeDisplayName('หน้าจอที่ error.png')).toBe('หน้าจอที่ error.png');
  });

  it('ชื่อยาวมากถูกตัด ไม่ใช่ให้ฐานข้อมูลปฏิเสธ', () => {
    expect(safeDisplayName(`${'ก'.repeat(900)}.png`).length).toBeLessThanOrEqual(200);
  });

  it('ชื่อที่เหลือแต่ path หรือจุด ได้สตริงว่าง', () => {
    for (const raw of ['../../', '/', '\\', '...', '   ']) {
      expect(safeDisplayName(raw)).toBe('');
    }
  });
});

describe('storageKey', () => {
  const base = { tenantId: 3n, workItemId: 42n, attachmentId: 7n };

  it('**ไม่มีส่วนไหนมาจากชื่อที่ผู้ใช้ตั้ง นอกจากนามสกุล**', () => {
    const k = storageKey({ ...base, filename: '../../../etc/passwd' });
    expect(k).toBe('t3/w42/7');
    expect(k).not.toContain('passwd');
    expect(k).not.toContain('..');
  });

  it('แยกตาม tenant เป็นชั้นแรก — ตั้ง policy ผิดก็ยังจำกัดความเสียหายได้', () => {
    expect(storageKey({ ...base, filename: 'a.png' }).startsWith('t3/')).toBe(true);
  });

  it('เก็บนามสกุลไว้เมื่อปลอดภัย', () => {
    expect(storageKey({ ...base, filename: 'หน้าจอ.PNG' })).toBe('t3/w42/7.png');
  });

  it('นามสกุลแปลก ๆ ถูกทิ้ง ไม่ใช่ใส่ลงไปตรง ๆ', () => {
    for (const name of ['a.p n g', 'a.', 'a.verylongextension', 'a.php\u0000.png']) {
      expect(storageKey({ ...base, filename: name })).not.toContain(' ');
    }
    expect(storageKey({ ...base, filename: 'a.' })).toBe('t3/w42/7');
  });

  it('ไฟล์คนละใบได้ key คนละอัน แม้ชื่อเดียวกัน', () => {
    const a = storageKey({ ...base, attachmentId: 1n, filename: 'x.png' });
    const b = storageKey({ ...base, attachmentId: 2n, filename: 'x.png' });
    expect(a).not.toBe(b);
  });
});

describe('contentDisposition', () => {
  it('**บังคับ attachment เสมอ ไม่มี inline**', () => {
    // ไฟล์ที่เบราว์เซอร์เปิดเองได้ จะรันในโดเมนของเรา
    expect(contentDisposition('a.png').startsWith('attachment;')).toBe(true);
  });

  it('ชื่อไทยส่งเป็น UTF-8 ตาม RFC 6266 พร้อมตัวสำรอง ASCII', () => {
    const v = contentDisposition('หน้าจอ.png');
    expect(v).toContain("filename*=UTF-8''");
    expect(v).toContain(encodeURIComponent('หน้าจอ.png'));
    // ตัวสำรองต้องเป็น ASCII ล้วน ไม่งั้น header พังกับ client เก่า
    const fallback = /filename="([^"]*)"/.exec(v)?.[1] ?? '';
    expect(/^[\x20-\x7e]*$/.test(fallback)).toBe(true);
  });

  it('ชื่อที่พยายามแทรก header ไม่ทำให้ header แตก', () => {
    const v = contentDisposition('a".png\r\nX-Injected: yes');
    expect(v).not.toContain('\r');
    expect(v).not.toContain('\n');
    expect((v.match(/"/g) ?? []).length).toBe(2);
  });

  it('ชื่อที่เหลือแต่อักขระนอก ASCII ยังมีตัวสำรองที่ใช้ได้', () => {
    expect(contentDisposition('ภาพ')).toContain('filename="___"');
  });
});

describe('decodeMultipartFilename', () => {
  /**
   * busboy ถอดชื่อไฟล์ของ multipart เป็น latin-1 โดยปริยาย ชื่อไทยจึงเพี้ยน
   * วัดจริงในฐานข้อมูล: ได้ไบต์ C3A0C2B8C2AB แทนที่จะเป็น E0B8AB
   */
  const mangled = (thai: string): string =>
    Buffer.from(thai, 'utf8').toString('latin1');

  it('ชื่อไทยที่ถูกถอดเป็น latin-1 กลับมาถูกต้อง', () => {
    expect(decodeMultipartFilename(mangled('หน้าจอที่ error.png'))).toBe('หน้าจอที่ error.png');
  });

  it('ชื่อ ASCII ล้วนไม่ถูกแตะ', () => {
    expect(decodeMultipartFilename('screenshot.png')).toBe('screenshot.png');
  });

  it('ชื่อที่ถูกต้องอยู่แล้วไม่ถูกทำให้เพี้ยน — ย้อนแล้วต้องไม่ทำลายของดี', () => {
    // ผ่านฟังก์ชันซ้ำสองครั้งต้องไม่เปลี่ยนผลลัพธ์อีก
    const once = decodeMultipartFilename(mangled('รายงาน.pdf'));
    expect(decodeMultipartFilename(once)).toBe(once);
  });

  it('ไบต์ที่ไม่ใช่ UTF-8 ที่ถูกต้อง คืนค่าเดิม ไม่ใช่ทำเป็นเครื่องหมายคำถาม', () => {
    // é เดี่ยว ๆ เป็น latin-1 จริง ย้อนแล้วไม่เป็น UTF-8 ที่ถูกต้อง
    const raw = 'caf\u00e9.png';
    expect(decodeMultipartFilename(raw)).toBe(raw);
  });

  it('ผลลัพธ์ผ่าน safeDisplayName ได้โดยไม่เหลือขยะ', () => {
    const out = safeDisplayName(decodeMultipartFilename(mangled('ใบเสร็จ 2569.pdf')));
    expect(out).toBe('ใบเสร็จ 2569.pdf');
  });
});
