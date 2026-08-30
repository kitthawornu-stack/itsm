import type { ReactNode } from 'react';

import { CmdbAdmin } from '@/components/cmdb-admin';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function ConfigItemsPage(): ReactNode {
  return (
    <section className="page">
      <h1 className="page-title">สิ่งที่ทีมดูแล</h1>
      <p className="page-sub">
        ทะเบียนเครื่อง ระบบ และบริการ พร้อมความสัมพันธ์ว่าอะไรพึ่งอะไร —
        เก็บเท่าที่ตอบคำถาม &quot;ถ้าตัวนี้ล่ม อะไรพังตามบ้าง&quot; ได้ ·
        ผูกกับเรื่องที่แจ้งเข้ามาได้จากหน้ารายละเอียดของแต่ละเรื่อง
      </p>
      <CmdbAdmin apiBase={API_BASE} />
    </section>
  );
}
