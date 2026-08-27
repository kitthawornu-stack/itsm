import type { ReactNode } from 'react';

import { IssueTypeAdmin } from '@/components/issue-type-admin';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function IssueTypesPage(): ReactNode {
  return (
    <section className="page">
      <h1 className="page-title">ประเภทงาน</h1>
      <p className="page-sub">
        ทุกเรื่องอยู่ในตารางเดียวกัน ความต่างมาจากประเภทงานที่ผูกกับ workflow และชุดฟิลด์ของโปรเจกต์
        — การเพิ่มประเภทงานจึงเป็นการเพิ่มพฤติกรรมแบบใหม่ ไม่ใช่แค่ป้ายชื่อ
      </p>
      <IssueTypeAdmin apiBase={API_BASE} />
    </section>
  );
}
