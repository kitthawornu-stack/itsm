import type { ReactNode } from 'react';

import { VersionBoard } from '@/components/version-board';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function VersionsPage({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<ReactNode> {
  const { key } = await params;
  return (
    <section className="page">
      <h1 className="page-title">รุ่น · {key}</h1>
      <p className="page-sub">
        วางแผนว่าอะไรจะออกไปพร้อมกัน และปล่อยเมื่อพร้อม ·
        <strong>ปล่อยรุ่นที่ยังมีงานค้างไม่ได้</strong> เพราะงานที่ไม่เสร็จจะกลายเป็น
        “ของที่ปล่อยแล้ว” ในสายตาทุกคน · บันทึกการปล่อยประกอบเองจากงานที่เสร็จ
        และ<strong>บอกจำนวนที่ยังไม่เสร็จเสมอ</strong>
      </p>
      <VersionBoard apiBase={API_BASE} projectKey={key} />
    </section>
  );
}
