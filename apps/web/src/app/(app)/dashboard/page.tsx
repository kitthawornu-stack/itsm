import type { ReactNode } from 'react';

import { DashboardBoard } from '@/components/dashboard-board';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function DashboardPage(): ReactNode {
  return (
    <section className="page">
      <h1 className="page-title">แดชบอร์ด</h1>
      <p className="page-sub">
        เลือกเองว่าอยากเห็นอะไรบนหน้าเดียว · หน้าที่แชร์ให้คนอื่น
        แสดงตัวเลขตามสิทธิ์ของคนที่เปิด ไม่ใช่ของคนที่จัดหน้า
      </p>
      <DashboardBoard apiBase={API_BASE} />
    </section>
  );
}
