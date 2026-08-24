import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@itsm/ui/styles/tokens.css';
import './app.css';

import { ThemeToggle } from '@/components/theme-toggle';

export const metadata: Metadata = {
  title: 'Helix — ศูนย์บริการไอที',
  description: 'ระบบ ITSM และ Project Management',
};

/**
 * สคริปต์กันจอกระพริบ (FOUC)
 *
 * Next.js เรนเดอร์ฝั่งเซิร์ฟเวอร์โดย **ไม่รู้ธีมของผู้ใช้** ถ้าปล่อยให้ React
 * ตั้งธีมหลัง hydrate ผู้ใช้ธีมมืดจะเห็นจอขาววาบหนึ่งเฟรมทุกครั้งที่โหลดหน้า
 *
 * สคริปต์นี้ต้องรัน **ก่อน** CSS ถูก apply จึงต้องเป็น inline ใน <head>
 * และอ่านจาก **cookie** ไม่ใช่ localStorage เพราะเซิร์ฟเวอร์อ่าน cookie ได้ด้วย
 *
 * ไม่ตั้ง data-theme เมื่อผู้ใช้เลือก "ตามระบบ" — ปล่อยให้ prefers-color-scheme ทำงาน
 */
const THEME_SCRIPT = `
try {
  var m = document.cookie.match(/(?:^|; )itsm_theme=([^;]+)/);
  var t = m ? decodeURIComponent(m[1]) : 'system';
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  var d = document.cookie.match(/(?:^|; )itsm_density=([^;]+)/);
  if (d) document.documentElement.setAttribute('data-density', decodeURIComponent(d[1]));
} catch (e) { /* cookie ถูกปิด — ใช้ค่าตามระบบ */ }
`;

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Anuphan:wght@400;500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
        {/* eslint-disable-next-line react/no-danger -- ต้อง inline ก่อน CSS เพื่อกันจอกระพริบ */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <header className="app-header">
          <span className="app-logo" aria-hidden="true" />
          <b className="app-title">Helix</b>
          <nav className="app-nav">
            <a href="/">คิวงาน</a>
            <a href="/components">คลังคอมโพเนนต์</a>
          </nav>
          <ThemeToggle />
        </header>
        <main className="app-main">{children}</main>
      </body>
    </html>
  );
}
