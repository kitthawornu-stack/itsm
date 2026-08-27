import type { ReactNode } from 'react';

import { ResolutionAdmin } from '@/components/resolution-admin';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function ResolutionsPage(): ReactNode {
  return (
    <section className="page">
      <h1 className="page-title">ผลการแก้ไข</h1>
      <p className="page-sub">
        ตัวเลือกที่ทีมเลือกตอนปิดงาน — สถานะบอกว่าเรื่องอยู่ตรงไหน ผลการแก้ไขบอกว่าจบอย่างไร
        และรายงานทุกตัวที่แยกตามผลลัพธ์อ่านค่านี้
      </p>
      <ResolutionAdmin apiBase={API_BASE} />
    </section>
  );
}
