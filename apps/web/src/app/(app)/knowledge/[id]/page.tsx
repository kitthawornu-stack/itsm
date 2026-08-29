import type { ReactNode } from 'react';

import { Alert, PageHeader, Timestamp } from '@itsm/ui';

import { ArticleEditor } from '@/components/article-editor';
import { API_BASE, apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Article {
  id: string;
  title: string;
  body: string;
  author: string;
  isPublished: boolean;
  updatedAt: string;
}

/**
 * บทความหนึ่งฉบับ
 *
 * `?edit=1` เปลี่ยนเป็นโหมดแก้ · แยกจากการอ่านเพราะคนส่วนใหญ่ที่เปิดมา
 * มาเพื่ออ่าน ไม่ได้มาแก้ · หน้าที่เปิดมาเป็นฟอร์มทันทีทำให้คนกลัวจะกดพลาด
 */
export default async function ArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const sp = await searchParams;

  let article: Article | null = null;
  let error: string | null = null;
  try {
    const res = await apiFetch(`/api/v1/knowledge/${encodeURIComponent(id)}`);
    if (res.ok) article = (await res.json()) as Article;
    else if (res.status === 404) error = 'ไม่พบบทความนี้';
    else error = `โหลดไม่สำเร็จ (HTTP ${String(res.status)})`;
  } catch {
    error = 'เชื่อมต่อระบบไม่ได้';
  }

  if (article === null) {
    return (
      <section className="page">
        <PageHeader title="คลังความรู้" />
        <Alert tone="error">{error ?? 'ไม่พบบทความนี้'}</Alert>
      </section>
    );
  }

  const editing = sp.edit === '1';
  const doc = article;

  return (
    <section className="page">
      <PageHeader
        title={doc.title}
        lead={
          <>
            เขียนโดย {doc.author} · แก้ล่าสุด <Timestamp utc={doc.updatedAt} />
            {doc.isPublished ? null : ' · ยังไม่เผยแพร่ (เห็นเฉพาะทีม)'}
          </>
        }
      />

      {editing ? (
        <ArticleEditor apiBase={API_BASE} article={doc} />
      ) : (
        <>
          <p className="article-body">{doc.body}</p>
          <p className="thread-actions">
            <a className="ui-linkbtn" href={`/knowledge/${doc.id}?edit=1`}>
              แก้ไขบทความนี้
            </a>
            <a className="ui-linkbtn" href="/knowledge">
              กลับไปค้นหา
            </a>
          </p>
        </>
      )}
    </section>
  );
}
