import type { ReactNode } from 'react';

import { Alert, PageHeader } from '@itsm/ui';

import { BoardView, type BoardColumn } from '@/components/board-view';
import { API_BASE, apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * กระดานของโปรเจกต์หนึ่ง
 *
 * คอลัมน์มาจาก workflow ที่โปรเจกต์นี้ใช้ ไม่ใช่รายการสถานะทั้งระบบ —
 * กระดานที่แสดงคอลัมน์ซึ่งงานไปถึงไม่ได้ ทำให้คนย้ายแล้วเด้งกลับโดยไม่เข้าใจ
 */
export default async function BoardPage({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<ReactNode> {
  const { key } = await params;

  let data: { projectKey: string; columns: BoardColumn[] } | null = null;
  let error: string | null = null;
  try {
    const res = await apiFetch(`/api/v1/boards/${encodeURIComponent(key)}`);
    if (res.ok) data = (await res.json()) as { projectKey: string; columns: BoardColumn[] };
    else if (res.status === 404) error = 'ไม่พบโปรเจกต์นี้ หรือคุณยังเปิดดูไม่ได้';
    else error = `โหลดไม่สำเร็จ (HTTP ${String(res.status)})`;
  } catch {
    error = 'เชื่อมต่อระบบไม่ได้';
  }

  if (data === null) {
    return (
      <section className="page">
        <PageHeader title="กระดาน" />
        <Alert tone="error">{error ?? 'เชื่อมต่อระบบไม่ได้'}</Alert>
      </section>
    );
  }

  const total = data.columns.reduce((n, c) => n + c.cards.length, 0);

  return (
    <section className="page">
      <PageHeader
        title={`กระดาน ${data.projectKey}`}
        lead={`${total.toLocaleString('th-TH')} เรื่องบนกระดาน · แสดงคอลัมน์ละไม่เกิน 100 เรื่อง`}
      />
      <BoardView apiBase={API_BASE} projectKey={data.projectKey} columns={data.columns} />
    </section>
  );
}
