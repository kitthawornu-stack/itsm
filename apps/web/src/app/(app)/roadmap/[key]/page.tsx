import type { ReactNode } from 'react';

import { RoadmapBoard } from '@/components/roadmap-board';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function RoadmapPage({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<ReactNode> {
  const { key } = await params;
  return (
    <section className="page">
      <h1 className="page-title">แผนงาน · {key}</h1>
      <p className="page-sub">
        รุ่นและรอบการทำงานบนเส้นเวลาเดียวกัน · <strong>วางเฉพาะสิ่งที่มีวันที่จริง</strong> —
        สิ่งที่ยังไม่มีกำหนดอยู่ในรายการแยกพร้อมเหตุผล ไม่ใช่ถูกเดาตำแหน่งให้ ·
        และบอก<strong>ลำดับที่เป็นไปไม่ได้</strong> เมื่องานในรุ่นที่ปล่อยทีหลัง
        ขวางงานในรุ่นที่ปล่อยก่อน
      </p>
      <RoadmapBoard apiBase={API_BASE} projectKey={key} />
    </section>
  );
}
