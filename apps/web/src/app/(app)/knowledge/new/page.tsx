import type { ReactNode } from 'react';

import { PageHeader } from '@itsm/ui';

import { ArticleEditor } from '@/components/article-editor';
import { API_BASE } from '@/lib/api';

export default function NewArticlePage(): ReactNode {
  return (
    <section className="page">
      <PageHeader
        title="เขียนบทความใหม่"
        lead="บันทึกไว้ก่อนได้ — ผู้แจ้งจะเห็นก็ต่อเมื่อกดเผยแพร่"
      />
      <ArticleEditor apiBase={API_BASE} />
    </section>
  );
}
