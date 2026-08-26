import type { ReactNode } from 'react';

import { LoginForm } from '@/components/login-form';
import { ThemeToggle } from '@/components/theme-toggle';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

// ที่อยู่ฝั่งเบราว์เซอร์ — ต่างจากที่ server component ใช้ ดู lib/api.ts
const API = API_BASE;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<ReactNode> {
  const { next } = await searchParams;

  /**
   * รับเฉพาะ path ภายในเว็บเรา
   *
   * ถ้าส่งค่าอะไรก็ได้ต่อไปให้ `location.replace` จะกลายเป็น open redirect —
   * ลิงก์ `/login?next=https://ปลอม.example` จะพาผู้ใช้ที่เพิ่งล็อกอินไปเว็บอื่น
   * ทันที ซึ่งเป็นวิธีหลอกเอารหัสผ่านที่ได้ผลมาก เพราะมาจากโดเมนที่เขาเชื่อถือ
   */
  const safeNext = typeof next === 'string' && /^\/(?!\/)/.test(next) ? next : '/';

  return (
    <section className="page login-page">
      {/* ปุ่มสลับธีมอยู่ที่นี่ ไม่ใช่ใน layout — หน้านี้ไม่มีแถบบนของแอป
          แต่คนที่ตั้งธีมมืดไว้ ควรเห็นหน้าล็อกอินเป็นธีมมืดและปรับได้ */}
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <h1 className="page-title">เข้าสู่ระบบ</h1>
      <p className="page-sub">Helix · ศูนย์บริการไอที</p>
      <LoginForm apiBase={API} next={safeNext} />
    </section>
  );
}
