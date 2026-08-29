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

interface TransitionOption {
  name: string;
  eligible: number;
  requiredFields: string[];
}

interface TransitionResponse {
  requested: number;
  changed: number;
  failed: number;
  items: Array<{ itemKey: string; outcome: string; from?: string; to?: string; reason?: string }>;
  max: number;
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
  const [options, setOptions] = useState<TransitionOption[]>([]);
  const [resolutions, setResolutions] = useState<string[]>([]);
  const [transition, setTransition] = useState('');
  const [resolution, setResolution] = useState('');
  const [moved, setMoved] = useState<TransitionResponse | null>(null);
  /** ฟิลด์ป้ายที่เลือกแก้ได้ — ว่างแปลว่าระบบยังไม่มีฟิลด์ชนิดป้ายเลย */
  const [labelFields, setLabelFields] = useState<Array<{ id: string; name: string }>>([]);
  const [labelField, setLabelField] = useState('');
  const [labelAdd, setLabelAdd] = useState('');
  const [labelRemove, setLabelRemove] = useState('');

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

  /*
    ถามเซิร์ฟเวอร์ทุกครั้งที่การเลือกเปลี่ยน ว่าชุดนี้กดปุ่มไหนได้บ้าง

    ไม่คำนวณเองจากสถานะของแถวบนหน้าจอ — เงื่อนไขของ transition มีทั้ง
    "ต้องเป็นผู้รับผิดชอบ" และ "ต้องอยู่ในกลุ่มไหน" ซึ่งหน้าจอไม่รู้
    การเดาจะทำให้เสนอปุ่มที่กดแล้วล้มทุกใบ
  */
  const pickedKey = [...picked].sort().join(',');
  useEffect(() => {
    if (pickedKey === '') {
      setOptions([]);
      setTransition('');
      return;
    }
    /*
      ยกเลิกคำขอเก่าจริง ๆ ไม่ใช่แค่เมินคำตอบที่กลับมาช้า

      ผู้ใช้ติ๊กเลือกทีละใบ ทุกครั้งคือหนึ่งคำขอ · ถ้าปล่อยให้คำขอเก่าตอบทีหลัง
      รายการปุ่มจะเป็นของชุดที่เลือกไว้เมื่อกี้ ไม่ใช่ชุดปัจจุบัน
    */
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/work-items/bulk/transitions`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ itemKeys: pickedKey.split(',') }),
          signal: ac.signal,
        });
        if (!res.ok) {
          setOptions([]);
          return;
        }
        const data = (await res.json()) as { options: TransitionOption[]; resolutions: string[] };
        setOptions(data.options);
        setResolutions(data.resolutions);
        // ปุ่มที่เลือกไว้อาจไม่มีอยู่ในชุดใหม่ — ล้างทิ้ง ไม่ใช่ปล่อยค้าง
        setTransition((cur) => (data.options.some((o) => o.name === cur) ? cur : ''));
      } catch {
        // คำขอที่ถูกยกเลิกก็มาที่นี่ — ไม่ใช่ความผิดพลาดที่ต้องบอกผู้ใช้
        if (!ac.signal.aborted) setOptions([]);
      }
    })();
    return () => {
      ac.abort();
    };
  }, [apiBase, pickedKey]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/work-items/bulk/label-fields`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) return;
        const d = (await res.json()) as { rows: typeof labelFields };
        setLabelFields(d.rows);
        setLabelField((cur) => (cur === '' ? (d.rows[0]?.id ?? '') : cur));
      } catch {
        // ไม่มีฟิลด์ป้ายให้เลือก ไม่ควรทำให้แถบแก้เป็นชุดใช้ไม่ได้
      }
    })();
  }, [apiBase]);

  const toggle = useCallback((key: string): void => {
    setResult(null);
    setMoved(null);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  function toggleAll(): void {
    setResult(null);
    setMoved(null);
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

  /**
   * ติด/ถอดป้าย
   *
   * **ส่ง `add` กับ `remove` แยกกัน ไม่ส่งรายการป้ายทั้งชุด** — การเขียนทับ
   * จะลบป้ายเดิมของทุกใบที่เลือกไว้ และคนกดจะไม่รู้จนกว่าจะมีคนมาถามหาป้ายเก่า
   */
  async function applyLabels(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    setMoved(null);
    try {
      const split = (v: string): string[] =>
        v
          .split(',')
          .map((x) => x.trim())
          .filter((x) => x !== '');
      const res = await fetch(`${apiBase}/api/v1/work-items/bulk/labels`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemKeys: [...picked],
          fieldId: labelField,
          add: split(labelAdd),
          remove: split(labelRemove),
        }),
      });
      const data = (await res.json()) as BulkResponse & { message?: string };
      if (!res.ok) {
        setError(data.message ?? `ติดป้ายไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setResult(data);
      setPicked(new Set());
      setLabelAdd('');
      setLabelRemove('');
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  const chosenOption = options.find((o) => o.name === transition);
  const needsResolution = chosenOption?.requiredFields.includes('resolution') ?? false;

  async function move(): Promise<void> {
    if (chosenOption === undefined) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setMoved(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/bulk/transition`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemKeys: [...picked],
          transitionName: transition,
          ...(needsResolution && resolution !== '' ? { resolutionName: resolution } : {}),
        }),
      });
      const data = (await res.json()) as TransitionResponse & { message?: string };
      if (!res.ok) {
        setError(data.message ?? `เปลี่ยนสถานะไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setMoved(data);
      setPicked(new Set());
      setTransition('');
      setResolution('');
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

          {/*
            ป้ายมีสองช่องแยกกัน — เพิ่ม กับ เอาออก

            ไม่มีช่อง "ตั้งป้ายเป็น" เพราะการเขียนทับเป็นชุดจะลบป้ายเดิมของ
            ทุกใบที่เลือกไว้ ซึ่งไม่มีใครตั้งใจ และไม่มีทางกู้กลับจากหน้าจอ
          */}
          {labelFields.length === 0 ? null : (
            <>
              {labelFields.length === 1 ? null : (
                <label className="bulk-field">
                  ฟิลด์ป้าย
                  <select
                    value={labelField}
                    onChange={(e) => {
                      setLabelField(e.target.value);
                    }}
                  >
                    {labelFields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="bulk-field">
                ติดป้าย
                <input
                  value={labelAdd}
                  placeholder="คั่นด้วยจุลภาค"
                  onChange={(e) => {
                    setLabelAdd(e.target.value);
                  }}
                />
              </label>
              <label className="bulk-field">
                ถอดป้าย
                <input
                  value={labelRemove}
                  placeholder="คั่นด้วยจุลภาค"
                  onChange={(e) => {
                    setLabelRemove(e.target.value);
                  }}
                />
              </label>
              <Button
                variant="primary"
                disabled={busy || (labelAdd.trim() === '' && labelRemove.trim() === '')}
                onClick={() => void applyLabels()}
              >
                {busy ? 'กำลังติดป้าย…' : 'ปรับป้าย'}
              </Button>
            </>
          )}

          {/*
            เปลี่ยนสถานะแยกจากการแก้ค่า เพราะมันเดินผ่าน workflow จริง —
            มีเงื่อนไข ตัวตรวจ และ post function · การรวมปุ่มเดียวจะทำให้
            ผู้ใช้เชื่อว่าทั้งสองอย่างทำงานเหมือนกัน ซึ่งไม่จริง

            รายการนี้มาจากเซิร์ฟเวอร์ และมีแต่ปุ่มที่มีใบกดได้จริง —
            ปุ่มที่กดแล้วล้มทุกใบคือปุ่มที่ไม่ควรอยู่ตรงนี้
          */}
          {options.length === 0 ? null : (
            <>
              <label className="bulk-field">
                เปลี่ยนสถานะ
                <select
                  value={transition}
                  onChange={(e) => {
                    setTransition(e.target.value);
                    setResolution('');
                  }}
                >
                  <option value="">— เลือกปุ่ม —</option>
                  {options.map((o) => (
                    <option key={o.name} value={o.name}>
                      {/* บอกจำนวนใบที่กดได้ตรงนี้ ไม่ใช่ให้รู้ตอนอ่านผล */}
                      {o.name}
                      {o.eligible === picked.size
                        ? ''
                        : ` (ได้ ${o.eligible.toLocaleString('th-TH')} จาก ${picked.size.toLocaleString('th-TH')})`}
                    </option>
                  ))}
                </select>
              </label>

              {/* ถามฟิลด์ที่ปุ่มนี้ขอ **ก่อนกด** แทนที่จะให้กดแล้วล้มทุกใบ */}
              {!needsResolution ? null : (
                <label className="bulk-field">
                  ผลการแก้ไข
                  <select
                    value={resolution}
                    onChange={(e) => {
                      setResolution(e.target.value);
                    }}
                  >
                    <option value="">— เลือก —</option>
                    {resolutions.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <Button
                variant="primary"
                disabled={busy || transition === '' || (needsResolution && resolution === '')}
                onClick={() => void move()}
              >
                {busy ? 'กำลังเปลี่ยน…' : 'เปลี่ยนสถานะ'}
              </Button>
            </>
          )}
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

      {moved === null ? null : (
        <div className="bulk-result" role="status">
          <b>
            เปลี่ยนสถานะแล้ว {moved.changed.toLocaleString('th-TH')} เรื่อง
            {moved.failed === 0 ? null : ` · ทำไม่ได้ ${moved.failed.toLocaleString('th-TH')} เรื่อง`}
          </b>
          {/*
            ใบที่ทำไม่ได้ต้องบอกเหตุผลรายใบ · เลือก 20 แล้วขยับ 17
            ต้องรู้ว่าอีก 3 ใบไหนและเพราะอะไร ไม่ใช่ให้ไปไล่หาเอง
          */}
          {moved.failed === 0 ? null : (
            /*
              รวมใบที่ล้มด้วยเหตุผลเดียวกันไว้บรรทัดเดียว

              รอบแรกแสดงทีละใบ · เลือก 50 ใบแล้วล้ม 28 ใบได้กำแพง 28 บรรทัด
              ที่ต่างกันแค่คีย์ ซึ่งไม่มีใครอ่าน — ผลคือข้อมูลที่ระบบตอบได้
              กลายเป็นสิ่งที่ผู้ใช้มองข้าม เท่ากับไม่ได้บอก
            */
            <ul className="bulk-failed">
              {[
                ...moved.items
                  .filter((i) => i.outcome !== 'changed')
                  .reduce((acc, i) => {
                    const why = i.reason ?? 'ไม่พบเรื่องนี้';
                    acc.set(why, [...(acc.get(why) ?? []), i.itemKey]);
                    return acc;
                  }, new Map<string, string[]>()),
              ].map(([why, itemKeys]) => (
                <li key={why}>
                  <b>{itemKeys.length.toLocaleString('th-TH')} เรื่อง</b> — {why}
                  <div className="bulk-keys">
                    {itemKeys.map((k) => (
                      <a key={k} href={`/browse/${k}`}>
                        {k}
                      </a>
                    ))}
                  </div>
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
