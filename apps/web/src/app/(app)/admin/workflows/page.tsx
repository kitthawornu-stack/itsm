import type { ReactNode } from 'react';

import { WorkflowAdmin } from '@/components/workflow-admin';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function WorkflowsPage(): ReactNode {
  return (
    <section className="page">
      <h1 className="page-title">workflow</h1>
      <p className="page-sub">
        สถานะที่เรื่องหนึ่งผ่านได้ และปุ่มที่พาไปแต่ละสถานะ — พฤติกรรมนี้อยู่ในตารางตั้งค่า
        ไม่ได้อยู่ในโค้ด การแก้ที่นี่จึงเปลี่ยนสิ่งที่ระบบทำทันที รวมถึงกับเรื่องที่เปิดค้างอยู่
      </p>
      <WorkflowAdmin apiBase={API_BASE} />
    </section>
  );
}
