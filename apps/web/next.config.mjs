import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // packages/ui ส่ง TypeScript ดิบ ไม่ได้ build ล่วงหน้า
  transpilePackages: ['@itsm/ui'],
  eslint: { ignoreDuringBuilds: true },
  /**
   * standalone — Next คัดเฉพาะไฟล์ที่รันจริงต้องใช้ออกมาให้
   *
   * จำเป็นสำหรับภาพ Docker: ถ้าไม่ตั้ง ต้องคัด node_modules ทั้งก้อนเข้าไป
   * ซึ่งใน pnpm workspace เป็น symlink ที่ชี้ออกนอกโฟลเดอร์ของแอป
   *
   * **เปิดเฉพาะตอนสร้างภาพ** เพราะการคัดไฟล์ของ standalone สร้าง symlink
   * ซึ่งบนวินโดวส์ต้องมีสิทธิ์พิเศษ — `pnpm build` บนเครื่องพัฒนาจะล้มด้วย
   * EPERM ทั้งที่ไม่มีอะไรผิด · ในภาพ (Linux) ไม่มีข้อจำกัดนี้
   */
  ...(process.env['NEXT_STANDALONE'] === '1' ? { output: 'standalone' } : {}),
  /**
   * รากของ workspace — ต้องบอก ไม่งั้น Next เดาเองแล้วคัดไฟล์ไม่ครบ
   *
   * ใช้ `fileURLToPath` ไม่ใช่ `.pathname`
   * บนวินโดวส์ `.pathname` คืน "/D:/Project/itsm/" ซึ่งมีทับนำหน้าอักษรไดรฟ์
   * Next ตีความเป็น path สัมพัทธ์แล้วสร้าง `apps/Project/itsm/...` ซ้อนขึ้นมา
   * ในโปรเจกต์จริง — build ผ่านปกติ ไม่มีคำเตือนอะไรเลย
   */
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
};
export default nextConfig;
