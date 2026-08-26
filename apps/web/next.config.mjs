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
   * และจะพังเมื่อคัดข้ามเครื่อง
   */
  output: 'standalone',
  // ต้องบอกรากของ workspace ไม่งั้น Next เดาเองแล้วคัดไฟล์ไม่ครบ
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};
export default nextConfig;
