import type { ReactNode } from 'react';

import { Alert, EmptyState, FormInput, PageHeader, SubmitButton, TextLink } from '@itsm/ui';

import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Hit {
  id: string;
  title: string;
  excerpt: string;
  isPublished: boolean;
}

/**
 * คลังความรู้ — หน้าค้นหา
 *
 * ไม่มีรายการ "บทความทั้งหมด" โดยตั้งใจ · คลังที่เปิดมาแล้วเจอรายการยาว
 * ทำให้คนเลื่อนหาแทนที่จะพิมพ์ และเลื่อนหาได้ผลแย่กว่าเสมอเมื่อบทความเกินหน้าเดียว
 * — คนที่มาที่นี่มีคำถามอยู่ในหัวแล้ว
 */
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const q = sp.q ?? '';

  let rows: Hit[] = [];
  let error: string | null = null;
  if (q.trim() !== '') {
    try {
      const res = await apiFetch(`/api/v1/knowledge?q=${encodeURIComponent(q)}`);
      if (res.ok) rows = ((await res.json()) as { rows: Hit[] }).rows;
      // ค้นไม่ได้ ≠ ไม่เจอ — ข้อความต้องแยกสองอย่างนี้
      else error = `ค้นหาไม่ได้ตอนนี้ (HTTP ${String(res.status)})`;
    } catch {
      error = 'เชื่อมต่อระบบไม่ได้';
    }
  }

  return (
    <section className="page">
      <PageHeader
        title="คลังความรู้"
        lead="คำตอบที่ทีมตอบซ้ำบ่อย ๆ เก็บไว้ที่เดียว แล้วแนบเข้าเรื่องได้"
      />

      <form className="link-form" method="get" action="/knowledge">
        <label className="bulk-field">
          ค้นหา
          <FormInput name="q" type="search" defaultValue={q} placeholder="เช่น รีเซ็ตรหัสผ่าน" />
        </label>
        <SubmitButton>ค้น</SubmitButton>
        <TextLink href="/knowledge/new">+ เขียนบทความใหม่</TextLink>
      </form>

      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {q.trim() === '' ? (
        <EmptyState
          title="พิมพ์คำที่กำลังหา"
          body="เช่น ชื่ออาการที่เจอ หรือชื่อระบบที่มีปัญหา"
        />
      ) : rows.length === 0 ? (
        /* "ไม่เจอ" ต้องต่างจาก "ยังไม่ได้ค้น" — สองอย่างนี้ผู้ใช้ทำต่อคนละแบบ */
        <EmptyState
          title={`ไม่พบบทความที่ตรงกับ “${q}”`}
          body="ลองคำที่สั้นลง หรือเขียนบทความใหม่จากเรื่องที่เพิ่งแก้"
        />
      ) : (
        <ul className="cmd-list">
          {rows.map((r) => (
            <li key={r.id}>
              <a className="cmd-item" href={`/knowledge/${r.id}`}>
                <span className="cmd-label">{r.title}</span>
                {r.isPublished ? null : <span className="cmd-hint">ยังไม่เผยแพร่</span>}
              </a>
              <p className="cmd-empty">{r.excerpt}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
