import type { ReactNode } from 'react';

import { BacklogBoard } from '@/components/backlog-board';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function BacklogPage({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<ReactNode> {
  const { key } = await params;
  return (
    <section className="page">
      <h1 className="page-title">Backlog · {key}</h1>
      <p className="page-sub">
        วางแผนรอบการทำงาน ประเมินแต้ม และใส่งานเข้ารอบ ·
        ตัวเลขของรอบที่ปิดแล้วบอกทั้ง <strong>สิ่งที่รับปาก</strong> และ
        <strong>สิ่งที่ทำได้จริง</strong> พร้อมจำนวนงานที่เพิ่มเข้ามาระหว่างทาง
      </p>
      <BacklogBoard apiBase={API_BASE} projectKey={key} />
    </section>
  );
}
