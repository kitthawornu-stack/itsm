import type { ReactNode } from 'react';

import { PageHeader } from '@itsm/ui';

import { CatalogAdmin } from '@/components/catalog-admin';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function CatalogAdminPage(): ReactNode {
  return (
    <section className="page">
      <PageHeader
        title="รายการบริการ"
        lead="ตั้งว่าผู้ใช้เลือกแจ้งอะไรได้บ้าง และเรื่องนั้นจะไปลงที่โปรเจกต์และประเภทงานไหน"
      />
      <CatalogAdmin apiBase={API_BASE} />
    </section>
  );
}
