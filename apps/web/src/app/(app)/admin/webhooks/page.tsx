import type { ReactNode } from 'react';

import { WebhookAdmin } from '@/components/webhook-admin';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function WebhooksPage(): ReactNode {
  return (
    <section className="page">
      <h1 className="page-title">ส่งเหตุการณ์ออก</h1>
      <p className="page-sub">
        ให้ระบบอื่นรู้ทันทีที่มีเรื่องใหม่ เปลี่ยนสถานะ หรือหลุดกำหนด —
        เช่นตัวกลางที่ส่งต่อเข้า LINE · ทุกคำขอมีลายเซ็นผูกกับเวลา
        ปลายทางจึงตรวจได้ว่ามาจากเราจริงและไม่ใช่ของเก่าที่ถูกส่งซ้ำ
      </p>
      <WebhookAdmin apiBase={API_BASE} />
    </section>
  );
}
