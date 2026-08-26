'use client';

import { useEffect, useState, type ReactNode } from 'react';

interface Candidate {
  id: string;
  displayName: string;
  email: string;
}

/**
 * มอบหมายงาน
 *
 * โหลดรายชื่อ **เมื่อกดเปิดเท่านั้น** ไม่ใช่ตอนหน้าโหลด — หน้ารายละเอียดงาน
 * ถูกเปิดบ่อยกว่าการจ่ายงานมาก การดึงรายชื่อทุกครั้งคือคำขอที่เสียเปล่าเกือบทั้งหมด
 *
 * ถ้าผู้ใช้ไม่มีสิทธิ์ ASSIGN_ITEM เซิร์ฟเวอร์ตอบ 403 และคอมโพเนนต์นี้ไม่ถูกแสดง
 * ตั้งแต่แรก (หน้าเรียกดูค่า `permissions.canAssign` จาก API)
 */
export function AssignControl({
  apiBase,
  itemKey,
  current,
}: {
  apiBase: string;
  itemKey: string;
  current: string | null;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || people !== null) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/assignable`, {
          credentials: 'include',
          cache: 'no-store',
          signal: ac.signal,
        });
        if (!res.ok) {
          setError('โหลดรายชื่อไม่ได้');
          setPeople([]);
          return;
        }
        setPeople(((await res.json()) as { rows: Candidate[] }).rows);
      } catch {
        setPeople([]);
      }
    })();
    return () => {
      ac.abort();
    };
  }, [open, people, apiBase, itemKey]);

  async function assign(assigneeId: string | null): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/assign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assigneeId }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setError(d.message ?? 'มอบหมายไม่สำเร็จ');
        return;
      }
      // โหลดหน้าใหม่ เพื่อให้ไทม์ไลน์และแถบด้านข้างตรงกับความจริง
      window.location.reload();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="assign">
      <div className="assign-row">
        <button
          type="button"
          className="assign-toggle"
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => !v);
          }}
          disabled={busy}
        >
          {current === null ? 'มอบหมายงาน' : 'เปลี่ยนผู้รับผิดชอบ'}
        </button>
        <button type="button" className="assign-claim" onClick={() => void assign('me')} disabled={busy}>
          รับงานนี้เอง
        </button>
      </div>

      {error === null ? null : (
        <p className="assign-error" role="alert">
          {error}
        </p>
      )}

      {!open ? null : people === null ? (
        <p className="assign-hint">กำลังโหลดรายชื่อ…</p>
      ) : (
        <ul className="assign-list">
          {current === null ? null : (
            <li>
              <button type="button" onClick={() => void assign(null)} disabled={busy}>
                คืนงานเข้ากอง (ไม่มีผู้รับผิดชอบ)
              </button>
            </li>
          )}
          {people.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => void assign(p.id)} disabled={busy}>
                {p.displayName}
                <span className="assign-email">{p.email}</span>
              </button>
            </li>
          ))}
          {people.length === 0 ? (
            <li className="assign-hint">ไม่มีใครในโปรเจกต์นี้ที่รับงานได้</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
