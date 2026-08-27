import type { ReactNode } from 'react';

import { FieldAdmin } from '@/components/field-admin';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function FieldsPage(): ReactNode {
  return (
    <section className="page">
      <h1 className="page-title">ฟิลด์เพิ่มเติม</h1>
      <p className="page-sub">
        ทุกเรื่องอยู่ในตารางเดียวกัน (ADR-001) ข้อมูลที่ต่างกันตามประเภทงานเก็บเป็นฟิลด์เพิ่มเติม
        — ตั้งที่นี่ว่าโปรเจกต์ไหน ประเภทงานไหน ต้องถามอะไร และอะไรบังคับกรอก
      </p>
      <FieldAdmin apiBase={API_BASE} />
    </section>
  );
}
