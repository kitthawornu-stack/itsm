'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Alert, Button, LinkButton, StatusPill, type StatusCategory } from '@itsm/ui';

export interface LinkRow {
  id: string;
  type: string;
  label: string;
  other: {
    itemKey: string;
    summary: string;
    statusName: string;
    statusCategory: string;
  };
}

/**
 * ความสัมพันธ์ระหว่างเรื่อง
 *
 * จัดกลุ่มตามป้าย ไม่ใช่เรียงตามเวลาที่เชื่อม — คนที่เปิดหน้านี้ถามว่า
 * "เรื่องนี้ติดอะไรอยู่" ไม่ได้ถามว่า "ใครเชื่อมอะไรก่อนหลัง"
 *
 * **ปุ่มถอดขึ้นเฉพาะคนที่มีสิทธิ์ และนั่นคือการซ่อนปุ่มที่กดแล้วได้ 403 เท่านั้น**
 * ไม่ใช่กลไกป้องกัน — เซิร์ฟเวอร์ตรวจซ้ำเองทุกครั้ง (CLAUDE.md §8)
 */
export function LinkPanel({
  apiBase,
  itemKey,
  links,
  types,
  canLink,
}: {
  apiBase: string;
  itemKey: string;
  links: LinkRow[];
  types: Array<{ value: string; label: string }>;
  canLink: boolean;
}): ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(types[0]?.value ?? 'RELATES_TO');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/links`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetKey: target.trim(), type }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        setError(data.message ?? `เชื่อมไม่สำเร็จ (HTTP ${String(res.status)})`);
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

  async function remove(linkId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/links/${linkId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) {
        setError(`ถอดไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  // จัดกลุ่มตามป้าย โดยรักษาลำดับที่เซิร์ฟเวอร์ส่งมา
  const grouped = new Map<string, LinkRow[]>();
  for (const l of links) grouped.set(l.label, [...(grouped.get(l.label) ?? []), l]);

  /*
    ไม่มีความสัมพันธ์และเชื่อมไม่ได้ = ไม่ต้องแสดงหัวข้อเลย
    หัวข้อว่างเปล่าบนหน้ารายละเอียดที่ยาวอยู่แล้ว มีแต่ทำให้หาของจริงยากขึ้น
  */
  if (links.length === 0 && !canLink) return null;

  return (
    <>
      <h2 className="detail-section-title detail-section-gap">เรื่องที่เกี่ยวข้อง</h2>

      {links.length === 0 ? (
        <p className="detail-sla-none">ยังไม่ได้เชื่อมกับเรื่องไหน</p>
      ) : (
        <div className="link-groups">
          {[...grouped].map(([label, rows]) => (
            <div key={label} className="link-group">
              <span className="link-label">{label}</span>
              <ul className="link-list">
                {rows.map((l) => (
                  <li key={l.id}>
                    <a href={`/browse/${l.other.itemKey}`} className="link-item">
                      <code>{l.other.itemKey}</code>
                      <span className="link-summary">{l.other.summary}</span>
                      <StatusPill
                        label={l.other.statusName}
                        category={l.other.statusCategory as StatusCategory}
                      />
                    </a>
                    {canLink ? (
                      <LinkButton
                        disabled={busy}
                        onClick={() => void remove(l.id)}
                        ariaLabel={`ถอดความสัมพันธ์กับ ${l.other.itemKey}`}
                      >
                        ถอด
                      </LinkButton>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {!canLink ? null : open ? (
        <div className="link-form">
          <label className="bulk-field">
            ความสัมพันธ์
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
              }}
            >
              {types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="bulk-field">
            เลขที่เรื่อง
            <input
              value={target}
              placeholder="เช่น SD-123"
              onChange={(e) => {
                setTarget(e.target.value);
              }}
            />
          </label>
          <Button variant="primary" disabled={busy || target.trim() === ''} onClick={() => void add()}>
            {busy ? 'กำลังเชื่อม…' : 'เชื่อม'}
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
          + เชื่อมกับเรื่องอื่น
        </LinkButton>
      )}
    </>
  );
}
