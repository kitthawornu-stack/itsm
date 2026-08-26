import type { ReactNode } from 'react';

import { UserAdmin } from '@/components/user-admin';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function UsersPage(): ReactNode {
  return (
    <section className="page">
      <h1 className="page-title">ผู้ใช้และสิทธิ์</h1>
      <p className="page-sub">
        เพิ่มคนเข้าระบบ ตั้งรหัสผ่านให้ใหม่ และปิดบัญชีที่ไม่ใช้แล้ว — สิทธิ์มาจากกลุ่มที่สังกัด
      </p>
      <UserAdmin apiBase={API_BASE} />
    </section>
  );
}
