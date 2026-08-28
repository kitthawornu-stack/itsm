'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Checkbox, LinkButton, Textarea, Timestamp } from '@itsm/ui';

interface CommentRow {
  id: string;
  body: string;
  isInternal: boolean;
  author: string;
  createdAt: string;
  /** null = ยังไม่เคยแก้ · บทสนทนาที่แก้เงียบ ๆ ใช้เป็นหลักฐานไม่ได้ */
  editedAt?: string | null;
  canEdit?: boolean;
  canDelete?: boolean;
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
  /** ความเห็นที่กำลังแก้อยู่ — null คือไม่ได้แก้อะไร */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** คนที่เรียกถึงได้ในเรื่องนี้ — มาจากเซิร์ฟเวอร์ ไม่ใช่รายชื่อผู้ใช้ทั้งระบบ */
  const [people, setPeople] = useState<Array<{ id: string; displayName: string }>>([]);
  /** คนที่ถูกเลือกไว้ในร่างนี้ — ส่งไปพร้อมข้อความ */
  const [picked, setPicked] = useState<Array<{ id: string; displayName: string }>>([]);
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/comments`, { credentials: 'include',
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

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/mentionable`, {
          credentials: 'include',
          cache: 'no-store',
        });
        // เรียกถึงใครไม่ได้ ไม่ควรทำให้บทสนทนาใช้ไม่ได้ — แค่ไม่มีเมนู
        if (res.ok) setPeople(((await res.json()) as { rows: typeof people }).rows);
      } catch {
        // เงียบไว้ด้วยเหตุผลเดียวกัน
      }
    })();
  }, [apiBase, itemKey]);

  /**
   * แทรก `@ชื่อ` เข้าไปในข้อความ
   *
   * เซิร์ฟเวอร์ตรวจว่าชื่อ **อยู่ในข้อความจริง** ก่อนยอมรับ · การเลือกจากเมนู
   * โดยไม่แตะข้อความ จะถูกทิ้งที่ฝั่งเซิร์ฟเวอร์ ไม่ใช่ส่งถึงเงียบ ๆ
   */
  function mention(p: { id: string; displayName: string }): void {
    setDraft((d) => (d === '' ? `@${p.displayName} ` : `${d.trimEnd()} @${p.displayName} `));
    setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur : [...cur, p]));
  }

  async function saveEdit(): Promise<void> {
    if (editing === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/comments/${editing.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: editing.text }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setError(d.message ?? `แก้ไขไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setEditing(null);
      await load();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  /**
   * ลบความเห็น
   *
   * ไม่ถามยืนยันซ้ำ เพราะ **การลบไม่ได้ทำลายหลักฐาน** — `deletedAt` ยังบอกได้ว่า
   * เคยมีความเห็นตรงนี้ และ audit บันทึกว่าใครลบเมื่อไร · กล่องยืนยันที่ขึ้น
   * ทุกครั้งจะถูกกดผ่านโดยไม่อ่านภายในสัปดาห์แรก แล้วก็ไม่ได้กันอะไรเลย
   */
  async function remove(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/comments/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        setError(d.message ?? `ลบไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      await load();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  async function send(): Promise<void> {
    if (draft.trim() === '') return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/comments`, { credentials: 'include',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        /*
          ส่ง id ของคนที่เลือกไว้ · เซิร์ฟเวอร์ตรวจว่าชื่อยังอยู่ในข้อความจริง
          — คนที่เลือกแล้วลบชื่อออกจากข้อความ จะไม่ถูกเรียกถึง
        */
        body: JSON.stringify({
          body: draft,
          isInternal: internal,
          mentions: picked.map((p) => p.id),
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setError(d.message ?? `ส่งไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      // ล้างช่องพิมพ์หลังส่งสำเร็จเท่านั้น — ล้างก่อนแล้วส่งพลาด ข้อความที่พิมพ์หายไปเลย
      setDraft('');
      setPicked([]);
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
                <Timestamp utc={c.createdAt} />
                {c.isInternal ? <span className="thread-internal">เห็นเฉพาะทีม</span> : null}
                {/*
                  ป้าย "แก้ไขแล้ว" ต้องเห็นได้เสมอ ไม่ใช่ซ่อนไว้ใน tooltip —
                  ผู้แจ้งที่กลับมาอ่านแล้วเจอข้อความไม่เหมือนที่จำได้
                  ต้องรู้ว่ามันถูกแก้ ไม่ใช่คิดว่าตัวเองจำผิด
                */}
                {c.editedAt === null || c.editedAt === undefined ? null : (
                  <span className="thread-edited">แก้ไขแล้ว</span>
                )}
                <span className="thread-tools">
                  {c.canEdit === true && editing === null ? (
                    <LinkButton
                      ariaLabel={`แก้ไขความเห็นของ ${c.author}`}
                      onClick={() => {
                        setEditing({ id: c.id, text: c.body });
                      }}
                    >
                      แก้ไข
                    </LinkButton>
                  ) : null}
                  {c.canDelete === true && editing === null ? (
                    <LinkButton
                      tone="danger"
                      disabled={busy}
                      ariaLabel={`ลบความเห็นของ ${c.author}`}
                      onClick={() => void remove(c.id)}
                    >
                      ลบ
                    </LinkButton>
                  ) : null}
                </span>
              </div>
              {editing !== null && editing.id === c.id ? (
                <div className="thread-edit">
                  <Textarea
                    id={`thread-edit-${c.id}`}
                    value={editing.text}
                    onChange={(v) => {
                      setEditing({ id: c.id, text: v });
                    }}
                    rows={3}
                    maxLength={COMMENT_MAX}
                  />
                  <div className="thread-actions">
                    <Button
                      variant="primary"
                      type="button"
                      disabled={busy || editing.text.trim() === ''}
                      onClick={() => void saveEdit()}
                    >
                      {busy ? 'กำลังบันทึก…' : 'บันทึก'}
                    </Button>
                    <LinkButton
                      onClick={() => {
                        setEditing(null);
                      }}
                    >
                      ยกเลิก
                    </LinkButton>
                  </div>
                </div>
              ) : (
                <p className="thread-body">{c.body}</p>
              )}
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
        {people.length === 0 ? null : (
          <div className="thread-mention" role="group" aria-label="เรียกถึง">
            <span className="thread-mention-label">เรียกถึง</span>
            {people.map((p) => (
              <LinkButton
                key={p.id}
                ariaLabel={`เรียกถึง ${p.displayName}`}
                onClick={() => {
                  mention(p);
                }}
              >
                {p.displayName}
              </LinkButton>
            ))}
          </div>
        )}
        {error === null ? null : (
          <p className="thread-error" role="alert">
            {error}
          </p>
        )}
        <div className="thread-actions">
          <Button variant="primary" type="button" disabled={sending} onClick={() => void send()}>
            {sending ? 'กำลังส่ง…' : 'ส่งความเห็น'}
          </Button>
          <Checkbox checked={internal} onChange={setInternal}>
            บันทึกภายใน — ผู้แจ้งจะไม่เห็น
          </Checkbox>
        </div>
      </div>
    </div>
  );
}
