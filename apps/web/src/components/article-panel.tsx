'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Alert, Button, LinkButton } from '@itsm/ui';

export interface AttachedArticle {
  id: string;
  title: string;
  helpful: boolean | null;
  addedBy: string;
}

interface Hit {
  id: string;
  title: string;
  excerpt: string;
  isPublished: boolean;
}

/**
 * บทความคลังความรู้บนหน้าเรื่อง
 *
 * ค้นแล้วแนบได้ในที่เดียว — ถ้าต้องเปิดอีกหน้าไปหาแล้วคัดลอกเลขกลับมา
 * จะไม่มีใครใช้ และคลังความรู้จะกลายเป็นที่เก็บที่ไม่มีใครเปิด
 *
 * **ปุ่มบอกว่าช่วยได้ไหมอยู่ตรงนี้ ไม่ใช่ในหน้าบทความ** — คนที่รู้คำตอบคือ
 * คนที่เพิ่งใช้มันแก้เรื่องนี้ ไม่ใช่คนที่เปิดอ่านผ่าน ๆ
 */
export function ArticlePanel({
  apiBase,
  itemKey,
  articles,
  canEdit,
}: {
  apiBase: string;
  itemKey: string;
  articles: AttachedArticle[];
  canEdit: boolean;
}): ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(): Promise<void> {
    const term = q.trim();
    if (term === '') return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/knowledge?q=${encodeURIComponent(term)}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        // ค้นไม่ได้ ≠ ไม่เจอ — ข้อความต้องแยกสองอย่างนี้
        setError(`ค้นหาไม่ได้ตอนนี้ (HTTP ${String(res.status)})`);
        setHits(null);
        return;
      }
      setHits(((await res.json()) as { rows: Hit[] }).rows);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      setHits(null);
    } finally {
      setBusy(false);
    }
  }

  async function send(method: string, path: string, body?: unknown): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/${path}`, {
        method,
        credentials: 'include',
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (!res.ok && res.status !== 204) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        setError(d.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setOpen(false);
      setQ('');
      setHits(null);
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  // ไม่มีบทความและแนบไม่ได้ = ไม่ต้องมีหัวข้อ
  if (articles.length === 0 && !canEdit) return null;

  return (
    <>
      <h2 className="detail-section-title detail-section-gap">บทความที่เกี่ยวข้อง</h2>

      {articles.length === 0 ? (
        <p className="detail-sla-none">ยังไม่ได้แนบบทความไหน</p>
      ) : (
        <ul className="link-list">
          {articles.map((a) => (
            <li key={a.id}>
              <a href={`/knowledge/${a.id}`} className="link-item">
                <span className="link-summary">{a.title}</span>
                <span className="hier-who">แนบโดย {a.addedBy}</span>
              </a>
              {/*
                คำถาม "ช่วยได้ไหม" ถามคนที่เพิ่งใช้มันแก้เรื่องนี้ ไม่ใช่คนที่
                เปิดอ่านผ่าน ๆ · คำตอบนี้เป็นข้อมูลเดียวที่บอกได้ว่าบทความไหน
                คุ้มค่าที่จะดูแลต่อ
              */}
              <span className="art-vote">
                <LinkButton
                  disabled={busy || a.helpful === true}
                  ariaLabel={`บทความ ${a.title} ช่วยได้`}
                  onClick={() => void send('POST', 'articles', { articleId: a.id, helpful: true })}
                >
                  {a.helpful === true ? '✓ ช่วยได้' : 'ช่วยได้'}
                </LinkButton>
                <LinkButton
                  disabled={busy || a.helpful === false}
                  ariaLabel={`บทความ ${a.title} ไม่ช่วย`}
                  onClick={() => void send('POST', 'articles', { articleId: a.id, helpful: false })}
                >
                  {a.helpful === false ? '✓ ไม่ช่วย' : 'ไม่ช่วย'}
                </LinkButton>
                {canEdit ? (
                  <LinkButton
                    tone="danger"
                    disabled={busy}
                    ariaLabel={`ถอดบทความ ${a.title}`}
                    onClick={() => void send('DELETE', `articles/${a.id}`)}
                  >
                    ถอด
                  </LinkButton>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {!canEdit ? null : open ? (
        <div className="art-search">
          <div className="link-form">
            <label className="bulk-field">
              ค้นบทความ
              <input
                value={q}
                placeholder="เช่น รีเซ็ตรหัสผ่าน"
                onChange={(e) => {
                  setQ(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void search();
                }}
              />
            </label>
            <Button variant="primary" disabled={busy || q.trim() === ''} onClick={() => void search()}>
              {busy ? 'กำลังค้น…' : 'ค้น'}
            </Button>
            <LinkButton
              onClick={() => {
                setOpen(false);
                setHits(null);
                setError(null);
              }}
            >
              ยกเลิก
            </LinkButton>
          </div>

          {hits === null ? null : hits.length === 0 ? (
            /* "ไม่เจอ" ต้องต่างจาก "ยังไม่ได้ค้น" — ไม่งั้นคนจะนั่งรอต่อไป */
            <p className="cmd-empty">ไม่พบบทความที่ตรงกับ “{q.trim()}”</p>
          ) : (
            <ul className="cmd-list">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className="cmd-item"
                    disabled={busy}
                    onClick={() => void send('POST', 'articles', { articleId: h.id })}
                  >
                    <span className="cmd-label">{h.title}</span>
                    {/* บอกว่ายังไม่เผยแพร่ — แนบได้ แต่ผู้แจ้งจะยังไม่เห็น */}
                    {h.isPublished ? null : <span className="cmd-hint">ยังไม่เผยแพร่</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <LinkButton
          onClick={() => {
            setOpen(true);
          }}
        >
          + ค้นและแนบบทความ
        </LinkButton>
      )}
    </>
  );
}
