import type { ReactNode } from 'react';

import { AutomationAdmin } from '@/components/automation-admin';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function AutomationPage(): ReactNode {
  return (
    <section className="page">
      <h1 className="page-title">กฎอัตโนมัติ</h1>
      <p className="page-sub">
        ให้ระบบทำงานซ้ำ ๆ แทนคน — เช่น เรื่องด่วนที่เพิ่งแจ้งเข้ามาให้เขียนความเห็นตอบรับทันที
        หรือเรื่องที่ติดป้ายไว้ให้มอบหมายให้ทีมที่ดูแลเรื่องนั้นเอง ·
        ทุกครั้งที่กฎทำอะไร ระบบบันทึกไว้ว่ากฎข้อไหนสั่ง จึงตอบได้เสมอว่าใครเป็นคนทำ
      </p>
      <AutomationAdmin apiBase={API_BASE} />
    </section>
  );
}
