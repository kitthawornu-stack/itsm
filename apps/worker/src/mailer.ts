/**
 * ตัวส่งอีเมลจริงผ่าน SMTP
 *
 * แยกจาก `email-notifier.ts` เพื่อให้ตรรกะ "ส่งหรือไม่ส่ง" ทดสอบได้โดยไม่ต้องมี
 * เซิร์ฟเวอร์เมล ไฟล์นี้จึงมีแต่การต่อสาย ไม่มีการตัดสินใจใด ๆ
 *
 * dev ใช้ Mailpit ที่ localhost:4025 ซึ่งรับทุกอย่างและไม่ส่งออกจริง —
 * ทดสอบครบวงได้โดยไม่มีความเสี่ยงที่อีเมลทดสอบจะไปถึงคนจริง
 */
import { createTransport, type Transporter } from 'nodemailer';

import type { MailSender } from './email-notifier';

export function createMailer(): MailSender & { close: () => void } {
  const transporter: Transporter = createTransport({
    host: process.env['SMTP_HOST'] ?? 'localhost',
    /*
      **ค่า fallback ต้องตรงกับ `.env` เสมอ** (CLAUDE.md §9) · ของเดิมเป็น
      1025 ซึ่งเป็นพอร์ตมาตรฐานเดิมของ Mailpit ไม่ใช่พอร์ตที่โปรเจกต์นี้ใช้
      · fallback ที่ชี้ไปพอร์ตเก่าทำให้ worker ต่อไปผิดที่**เงียบ ๆ** เมื่อ
      env หายไป แทนที่จะล้มให้เห็น — อีเมลจะไม่ถูกส่งโดยไม่มีใครรู้
    */
    port: Number(process.env['SMTP_PORT'] ?? 4025),
    // Mailpit ไม่ใช้ TLS และไม่ต้องยืนยันตัวตน
    // ตอนต่อกับผู้ให้บริการจริงต้องตั้งค่าเหล่านี้จาก env ไม่ใช่แก้โค้ด
    secure: process.env['SMTP_SECURE'] === 'true',
    ...(process.env['SMTP_USER'] === undefined
      ? {}
      : {
          auth: {
            user: process.env['SMTP_USER'],
            pass: process.env['SMTP_PASS'] ?? '',
          },
        }),
  });

  const from = process.env['SMTP_FROM'] ?? 'Helix Service Desk <no-reply@itsm.local>';

  return {
    async send(msg) {
      await transporter.sendMail({
        from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        ...(msg.attachments === undefined ? {} : { attachments: msg.attachments }),
      });
    },
    close() {
      transporter.close();
    },
  };
}
