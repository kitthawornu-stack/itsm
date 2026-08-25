'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Textarea } from '@itsm/ui';

interface CommentRow {
  id: string;
  body: string;
  isInternal: boolean;
  author: string;
  createdAt: string;
}

const COMMENT_MAX = 10_000;

/**
 * บทสนทนาบนงาน
 *
 * ความเห็นภายในถูกตัดออกที่ฝั่งเซิร์ฟเวอร์แล้วเมื่อเป็นมุมมองผู้แจ้ง (INVARIANT 3)
 * แถบสีที่นี่จึงเป็นการ **บอกทีมว่าอันไหนภายใน** ไม่ใช่กลไกซ่อนข้อมูล
 * — ถ้าซ่อนด้วย CSS อย่างเดียว ใครเปิด DevTools ก็อ่านได้
 */
export function CommentThread({
  apiBase,
  itemKey,
}: {
  apiBase: string;
  itemKey: string;
}): ReactNode {
  const [rows, setRows] = useState<CommentRow[] | null>(null);
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/comments`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setError(`โหลดความเห็นไม่ได้ (HTTP ${String(res.status)})`);
        return;
      }
      const d = (await res.json()) as { rows: CommentRow[] };
      setRows(d.rows);
      setError(null);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    }
  }, [apiBase, itemKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(): Promise<void> {
    if (draft.trim() === '') return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: draft, isInternal: internal }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setError(d.message ?? `ส่งไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      // ล้างช่องพิมพ์หลังส่งสำเร็จเท่านั้น — ล้างก่อนแล้วส่งพลาด ข้อความที่พิมพ์หายไปเลย
      setDraft('');
      await load();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ข้อความยังไม่ถูกส่ง');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="thread">
      {rows === null ? (
        <p className="thread-empty">กำลังโหลด…</p>
      ) : rows.length === 0 ? (
        <p className="thread-empty">ยังไม่มีใครแสดงความเห็น เริ่มบทสนทนาได้เลย</p>
      ) : (
        <ul className="thread-list">
          {rows.map((c) => (
            <li key={c.id} className="thread-item" data-internal={c.isInternal ? 'true' : 'false'}>
              <div className="thread-meta">
                <b>{c.author}</b>
                <time dateTime={c.createdAt}>
                  {new Date(c.createdAt).toLocaleString('th-TH', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Bangkok',
                  })}
                </time>
                {c.isInternal ? <span className="thread-internal">เห็นเฉพาะทีม</span> : null}
              </div>
              <p className="thread-body">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="thread-compose">
        <Textarea
          id="thread-draft"
          value={draft}
          onChange={setDraft}
          rows={3}
          maxLength={COMMENT_MAX}
          placeholder="พิมพ์ความเห็น หรือถามข้อมูลเพิ่มเติมจากผู้แจ้ง"
        />
        {error === null ? null : (
          <p className="thread-error" role="alert">
            {error}
          </p>
        )}
        <div className="thread-actions">
          <Button variant="primary" type="button" disabled={sending} onClick={() => void send()}>
            {sending ? 'กำลังส่ง…' : 'ส่งความเห็น'}
          </Button>
          <label className="thread-internal-toggle">
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => {
                setInternal(e.target.checked);
              }}
            />
            บันทึกภายใน — ผู้แจ้งจะไม่เห็น
          </label>
        </div>
      </div>
    </div>
  );
}
