import type { ReactNode } from 'react';

import { NotificationSettings } from '@/components/notification-settings';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function NotificationSettingsPage(): ReactNode {
  return (
    <section className="page">
      <h1 className="page-title">การแจ้งเตือน</h1>
      <p className="page-sub">
        เลือกว่าอยากได้อะไรบ้าง — คนที่ได้รับทุกอย่างจะเลิกอ่านทั้งหมด แล้วพลาดฉบับที่สำคัญจริง ·
        ไม่ตั้งอะไรเลย แปลว่าได้รับครบตามปกติ
      </p>
      <NotificationSettings apiBase={API_BASE} />
    </section>
  );
}
