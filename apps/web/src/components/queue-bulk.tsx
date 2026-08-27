'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  LinkButton,
  WorkItemRow,
  type PriorityRank,
  type StatusCategory,
} from '@itsm/ui';

import { toSlaBar, type SlaSnapshotView } from '@/lib/sla-label';

export interface QueueRow {
  id: string;
  itemKey: string;
  projectKey: string;
  summary: string;
  status: { name: string; category: string; pausesSla: boolean };
  priority: { rank: number; name: string } | null;
  assignee: { name: string } | null;
  sla: SlaSnapshotView | null;
}

interface BulkItemResult {
  itemKey: string;
  outcome: 'changed' | 'unchanged' | 'not-found' | 'failed';
  changed: string[];
  reason?: string;
}

interface BulkResponse {
  requested: number;
  changed: number;
  unchanged: number;
  failed: number;
  items: BulkItemResult[];
  max: number;
}

const OUTCOME_LABEL: Record<BulkItemResult['outcome'], string> = {
  changed: 'แก้แล้ว',
  unchanged: 'ไม่มีอะไรเปลี่ยน',
  'not-found': 'ไม่พบเรื่องนี้',
  failed: 'ทำไม่สำเร็จ',
};

/**
 * คิวงานที่ติ๊กเลือกหลายใบแล้วแก้พร้อมกันได้
 *
 * **ช่องติ๊กขึ้นเฉพาะแถวที่ผู้ใช้มีสิทธิ์ `BULK_EDIT` ในโปรเจกต์นั้น**
 * และนี่คือการซ่อนปุ่มที่กดแล้วได้ 403 เท่านั้น ไม่ใช่กลไกป้องกัน —
 * เซิร์ฟเวอร์ตรวจซ้ำเองทุกครั้ง (CLAUDE.md §8 · `bulkEditWorkItems`)
 *
 * ผลลัพธ์แสดง **รายใบ** ไม่ใช่ "สำเร็จ/ล้มเหลว" ใบเดียวของทั้งชุด เพราะ API
 * ตั้งใจให้ล้มทีละใบได้ · ชุดที่สำเร็จ 48 จาก 50 ใบต้องอ่านออกว่าอีก 2 ใบคือใบไหน
 */
export function QueueBulk({
  apiBase,
  rows,
  bulkEditable,
  max,
}: {
  apiBase: string;
  rows: QueueRow[];
  bulkEditable: string[];
  max: number;
}): ReactNode {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Array<{ id: string; displayName: string }>>([]);
  const [priorities, setPriorities] = useState<Array<{ rank: number; name: string }>>([]);

  const selectable = new Set(bulkEditable);
  const eligible = rows.filter((r) => selectable.has(r.projectKey));
  const canSelect = eligible.length > 0;

  const firstKey = eligible[0]?.itemKey;
  useEffect(() => {
    if (firstKey === undefined) return;
    void (async () => {
      try {
        const [a, o] = await Promise.all([
          fetch(`${apiBase}/api/v1/work-items/${firstKey}/assignable`, {
            credentials: 'include',
            cache: 'no-store',
          }),
          fetch(`${apiBase}/api/v1/work-items/options`, {
            credentials: 'include',
            cache: 'no-store',
          }),
        ]);
        if (a.ok) setPeople(((await a.json()) as { rows: typeof people }).rows);
        if (o.ok) setPriorities(((await o.json()) as { priorities: typeof priorities }).priorities);
      } catch {
        // เลือกคนหรือระดับความสำคัญไม่ได้ ไม่ควรทำให้คิวใช้ไม่ได้
      }
    })();
  }, [apiBase, firstKey]);

  const toggle = useCallback((key: string): void => {
    setResult(null);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  function toggleAll(): void {
    setResult(null);
    setPicked((prev) =>
      prev.size === eligible.length ? new Set() : new Set(eligible.slice(0, max).map((r) => r.itemKey)),
    );
  }

  async function apply(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      /*
        ส่งเฉพาะฟิลด์ที่ผู้ใช้ตั้งใจเปลี่ยน — ไม่ส่ง = ไม่แตะ
        ถ้าส่งทุกฟิลด์เสมอ การเปลี่ยนผู้รับผิดชอบจะล้างระดับความสำคัญไปด้วย
        โดยไม่มีอะไรบนหน้าจอบอก
      */
      const body: Record<string, unknown> = { itemKeys: [...picked] };
      if (assignee !== '') body['assigneeId'] = assignee === '__none__' ? null : assignee;
      if (priority !== '') body['priorityRank'] = priority === '__none__' ? null : Number(priority);

      const res = await fetch(`${apiBase}/api/v1/work-items/bulk`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as BulkResponse & { message?: string };
      if (!res.ok) {
        setError(data.message ?? `แก้ไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setResult(data);
      setPicked(new Set());
      setAssignee('');
      setPriority('');
      // ดึงคิวใหม่จากเซิร์ฟเวอร์ ไม่ใช่แก้แถวในหน้าจอเอง — หน้าจอที่เดาผลลัพธ์
      // จะไม่ตรงกับฐานข้อมูลทันทีที่มีใบไหนล้ม
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  const nothingChosen = assignee === '' && priority === '';

  return (
    <>
      {picked.size === 0 ? null : (
        <div className="bulk-bar" role="region" aria-label="แก้ไขหลายเรื่องพร้อมกัน">
          <b>เลือกไว้ {picked.size.toLocaleString('th-TH')} เรื่อง</b>

          <label className="bulk-field">
            มอบหมายให้
            <select
              value={assignee}
              onChange={(e) => {
                setAssignee(e.target.value);
              }}
            >
              <option value="">— ไม่เปลี่ยน —</option>
              <option value="__none__">ไม่มีผู้รับผิดชอบ</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="bulk-field">
            ความสำคัญ
            <select
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
              }}
            >
              <option value="">— ไม่เปลี่ยน —</option>
              <option value="__none__">ไม่ระบุ</option>
              {priorities.map((p) => (
                <option key={p.rank} value={String(p.rank)}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <Button variant="primary" disabled={busy || nothingChosen} onClick={() => void apply()}>
            {busy ? 'กำลังแก้…' : 'แก้ทั้งหมด'}
          </Button>
          <LinkButton
            onClick={() => {
              setPicked(new Set());
            }}
          >
            ยกเลิกการเลือก
          </LinkButton>

          {/* บอกเพดานตรงนี้ ไม่ใช่ปล่อยให้กดแล้วเจอ 422 */}
          {picked.size > max ? (
            <Alert tone="error" inline>
              แก้ได้ครั้งละไม่เกิน {max} เรื่อง
            </Alert>
          ) : null}
        </div>
      )}

      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {result === null ? null : (
        <div className="bulk-result" role="status">
          <b>
            แก้แล้ว {result.changed.toLocaleString('th-TH')} เรื่อง
            {result.unchanged === 0 ? null : ` · ไม่มีอะไรเปลี่ยน ${String(result.unchanged)} เรื่อง`}
            {result.failed === 0 ? null : ` · ทำไม่ได้ ${String(result.failed)} เรื่อง`}
          </b>
          {/* รายใบที่ทำไม่ได้ — ตัวเลขรวมอย่างเดียวตอบไม่ได้ว่าใบไหน */}
          {result.items.filter((i) => i.outcome === 'not-found' || i.outcome === 'failed').length ===
          0 ? null : (
            <ul className="bulk-failed">
              {result.items
                .filter((i) => i.outcome === 'not-found' || i.outcome === 'failed')
                .map((i) => (
                  <li key={i.itemKey}>
                    <code>{i.itemKey}</code> — {i.reason ?? OUTCOME_LABEL[i.outcome]}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      <div className="queue" data-select={canSelect ? 'true' : undefined}>
        <div className="queue-head">
          {canSelect ? (
            <span className="queue-check">
              <Checkbox
                checked={picked.size > 0 && picked.size === eligible.length}
                // บางส่วนไม่ใช่ทั้งหมด — ช่องที่ติ๊กเต็มทั้งที่เลือกไว้ 3 จาก 50 คือคำโกหก
                indeterminate={picked.size > 0 && picked.size < eligible.length}
                onChange={toggleAll}
                label="เลือกทั้งหมดในหน้านี้"
              />
            </span>
          ) : null}
          {/*
            คอลัมน์หัวตารางอยู่ในกริดของตัวเอง ซ้อนโครงเดียวกับ `.ui-row`
            ไม่ใช่กริดใบเดียวที่กินทั้งแถวแล้วเลื่อนด้วย padding — วิธีนั้นทำให้
            `1fr` ของหัวตารางกับของแถวคำนวณจากความกว้างคนละค่า แล้วหัวคอลัมน์
            เลื่อนหลุดจากข้อมูลใต้มันทั้งแถว (เห็นแล้วในเบราว์เซอร์)
          */}
          <div className="queue-head-cols">
            <span>คีย์</span>
            <span>หัวข้อ</span>
            <span>ความสำคัญ</span>
            <span>สถานะ</span>
            <span />
            <span>เหลือถึงกำหนด</span>
          </div>
        </div>

        {rows.map((r) => {
          const mine = selectable.has(r.projectKey);
          return (
            <div className="queue-row" key={r.id}>
              {canSelect ? (
                <span className="queue-check">
                  {mine ? (
                    <Checkbox
                      checked={picked.has(r.itemKey)}
                      onChange={() => {
                        toggle(r.itemKey);
                      }}
                      label={`เลือก ${r.itemKey}`}
                    />
                  ) : null}
                </span>
              ) : null}
              <a href={`/browse/${r.itemKey}`} className="queue-link">
                <WorkItemRow
                  itemKey={r.itemKey}
                  summary={r.summary}
                  selected={picked.has(r.itemKey)}
                  priority={{
                    rank: (r.priority?.rank ?? 5) as PriorityRank,
                    label: r.priority?.name ?? 'ไม่ระบุ',
                  }}
                  status={{
                    label: r.status.name,
                    category: r.status.category as StatusCategory,
                    pausesSla: r.status.pausesSla,
                  }}
                  {...(r.assignee === null ? {} : { assignee: r.assignee.name })}
                  {...(r.sla === null ? {} : { sla: toSlaBar(r.sla) })}
                />
              </a>
            </div>
          );
        })}
      </div>
    </>
  );
}
