'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Alert, Button, LinkButton, StatusPill, type StatusCategory } from '@itsm/ui';

export interface ParentRow {
  itemKey: string;
  summary: string;
  statusName: string;
  statusCategory: string;
}

export interface ChildRow extends ParentRow {
  assignee: string | null;
}

/**
 * เรื่องหลักและงานย่อย
 *
 * **ความคืบหน้าบอกเป็นจำนวน ไม่ใช่เปอร์เซ็นต์** — "เสร็จ 3 จาก 5" ตรวจได้
 * ด้วยการนับบรรทัดข้างล่าง ส่วน "60%" ต้องเชื่ออย่างเดียว · และเมื่อมีงานย่อย
 * ที่ผู้อ่านมองไม่เห็น (คนละโปรเจกต์) เปอร์เซ็นต์จะบอกจำนวนของสิ่งที่เขา
 * ไม่ควรรู้ว่ามีอยู่ ส่วนจำนวนที่นับจากบรรทัดที่เห็นจริง จะสอดคล้องกันเสมอ
 */
export function HierarchyPanel({
  apiBase,
  itemKey,
  parent,
  children,
  done,
  canEdit,
}: {
  apiBase: string;
  itemKey: string;
  parent: ParentRow | null;
  children: ChildRow[];
  done: number;
  canEdit: boolean;
}): ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(parentKey: string | null): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/parent`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentKey: parentKey ?? '' }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setError(d.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setTarget('');
      setOpen(false);
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  // ไม่มีอะไรให้แสดงและแก้ไม่ได้ = ไม่ต้องมีหัวข้อ
  if (parent === null && children.length === 0 && !canEdit) return null;

  return (
    <>
      <h2 className="detail-section-title detail-section-gap">โครงของงาน</h2>

      {parent === null ? null : (
        <div className="hier-parent">
          <span className="link-label">อยู่ภายใต้</span>
          <div className="hier-row">
            <a href={`/browse/${parent.itemKey}`} className="link-item">
              <code>{parent.itemKey}</code>
              <span className="link-summary">{parent.summary}</span>
              <StatusPill
                label={parent.statusName}
                category={parent.statusCategory as StatusCategory}
              />
            </a>
            {canEdit ? (
              <LinkButton
                disabled={busy}
                ariaLabel={`ถอดออกจาก ${parent.itemKey}`}
                onClick={() => void save(null)}
              >
                ถอด
              </LinkButton>
            ) : null}
          </div>
        </div>
      )}

      {children.length === 0 ? null : (
        <div className="hier-children">
          <span className="link-label">
            งานย่อย · เสร็จแล้ว {done.toLocaleString('th-TH')} จาก{' '}
            {children.length.toLocaleString('th-TH')}
          </span>
          <ul className="link-list">
            {children.map((c) => (
              <li key={c.itemKey}>
                <a href={`/browse/${c.itemKey}`} className="link-item">
                  <code>{c.itemKey}</code>
                  <span className="link-summary">{c.summary}</span>
                  {/* ผู้รับผิดชอบอยู่ตรงนี้ เพราะคำถามถัดไปคือ "ใครทำอยู่" */}
                  <span className="hier-who">{c.assignee ?? 'ยังไม่มีผู้รับผิดชอบ'}</span>
                  <StatusPill label={c.statusName} category={c.statusCategory as StatusCategory} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {!canEdit || parent !== null ? null : open ? (
        <div className="link-form">
          <label className="bulk-field">
            เรื่องหลัก
            <input
              value={target}
              placeholder="เช่น SD-100"
              onChange={(e) => {
                setTarget(e.target.value);
              }}
            />
          </label>
          <Button
            variant="primary"
            disabled={busy || target.trim() === ''}
            onClick={() => void save(target.trim())}
          >
            {busy ? 'กำลังผูก…' : 'ผูก'}
          </Button>
          <LinkButton
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
          >
            ยกเลิก
          </LinkButton>
        </div>
      ) : (
        <LinkButton
          onClick={() => {
            setOpen(true);
          }}
        >
          + ผูกไว้ใต้เรื่องอื่น
        </LinkButton>
      )}
    </>
  );
}
