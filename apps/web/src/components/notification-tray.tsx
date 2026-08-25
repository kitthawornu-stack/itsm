'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  itemKey: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * กระดิ่งแจ้งเตือน
 *
 * ดึงข้อมูลใหม่ทุก 60 วินาที — ไม่ใช่ realtime โดยเจตนา
 * WebSocket สำหรับเรื่องนี้ยังไม่คุ้ม เพราะการแจ้งเตือน SLA เกิดห่างกันเป็นชั่วโมง
 * และ polling หนึ่งครั้งต่อนาทีถูกกว่าการดูแล connection ที่ต้อง reconnect
 *
 * เมื่อ Socket.IO gateway พร้อม (Phase 4) ให้เปลี่ยนมาใช้ push แทน
 */
export function NotificationTray({ apiBase }: { apiBase: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/notifications?limit=15`, { cache: 'no-store' });
      if (!res.ok) {
        setError(`โหลดการแจ้งเตือนไม่ได้ (HTTP ${res.status})`);
        return;
      }
      const d = (await res.json()) as { rows: NotificationRow[]; unreadCount: number };
      setRows(d.rows);
      setUnread(d.unreadCount);
      setError(null);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => {
      clearInterval(t);
    };
  }, [load]);

  // ปิดเมื่อคลิกนอกกล่อง หรือกด Escape — ทั้งสองทางต้องมี ไม่ใช่แค่คลิก
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current !== null && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function markAllRead(): Promise<void> {
    await fetch(`${apiBase}/api/v1/notifications/read-all`, { method: 'POST' });
    await load();
  }

  async function openItem(n: NotificationRow): Promise<void> {
    await fetch(`${apiBase}/api/v1/notifications/${n.id}/read`, { method: 'POST' });
    if (n.itemKey !== null) window.location.href = `/browse/${n.itemKey}`;
    else await load();
  }

  return (
    <div className="tray" ref={boxRef}>
      <button
        type="button"
        className="tray-bell"
        aria-label={unread > 0 ? `การแจ้งเตือน ${String(unread)} รายการที่ยังไม่ได้อ่าน` : 'การแจ้งเตือน'}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 ? (
          <span className="tray-badge" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="tray-panel" role="dialog" aria-label="การแจ้งเตือน">
          <div className="tray-head">
            <b>การแจ้งเตือน</b>
            {unread > 0 ? (
              <button type="button" className="tray-link" onClick={() => void markAllRead()}>
                ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
              </button>
            ) : null}
          </div>

          {error !== null ? (
            <p className="tray-empty">{error}</p>
          ) : rows.length === 0 ? (
            <p className="tray-empty">
              ยังไม่มีการแจ้งเตือน — เมื่องานใกล้หลุด SLA ระบบจะแจ้งที่นี่
            </p>
          ) : (
            <ul className="tray-list">
              {rows.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="tray-item"
                    data-unread={n.readAt === null ? 'true' : 'false'}
                    onClick={() => void openItem(n)}
                  >
                    <span className="tray-title">{n.title}</span>
                    {n.body === null ? null : <span className="tray-body">{n.body}</span>}
                    <span className="tray-time">
                      {new Date(n.createdAt).toLocaleString('th-TH', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Bangkok',
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
