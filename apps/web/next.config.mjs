/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // packages/ui ส่ง TypeScript ดิบ ไม่ได้ build ล่วงหน้า
  transpilePackages: ['@itsm/ui'],
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
