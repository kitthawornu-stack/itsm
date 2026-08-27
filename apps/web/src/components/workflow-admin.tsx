'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Field, Input, Select } from '@itsm/ui';

interface WorkflowRow {
  id: string;
  name: string;
  statusCount: number;
  transitionCount: number;
  usedBy: string[];
}

interface Status {
  id: string;
  name: string;
  category: string;
  isInitial: boolean;
  pausesSla: boolean;
  itemCount: number;
}

interface Transition {
  id: string;
  name: string;
  from: string | null;
  to: string;
  ruleCount: number;
}

type Detail = WorkflowRow & { statuses: Status[]; transitions: Transition[] };

const CATEGORIES = [
  { value: 'TODO', label: 'ยังไม่เริ่ม' },
  { value: 'IN_PROGRESS', label: 'กำลังทำ' },
  { value: 'DONE', label: 'จบแล้ว' },
];
const CATEGORY_LABEL: Record<string, string> = {
  TODO: 'ยังไม่เริ่ม',
  IN_PROGRESS: 'กำลังทำ',
  DONE: 'จบแล้ว',
};

/**
 * แก้ workflow
 *
 * ⚠️ **ยังตั้งกฎของปุ่มไม่ได้** (ใครเห็นปุ่ม · ต้องกรอกอะไร · ทำอะไรต่อ)
 * หน้าจอจึงบอกจำนวนกฎที่มีอยู่ ไม่ใช่ซ่อนไว้ — การลบปุ่มลบกฎไปด้วย
 * และผู้ดูแลต้องรู้ว่ากำลังลบอะไรไปพร้อมกัน
 */
export function WorkflowAdmin({ apiBase }: { apiBase: string }): ReactNode {
  const [rows, setRows] = useState<WorkflowRow[] | null>(null);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [wfName, setWfName] = useState('');
  const [wfInitial, setWfInitial] = useState('');
  const [stName, setStName] = useState('');
  const [stCategory, setStCategory] = useState('TODO');
  const [stPauses, setStPauses] = useState(false);
  const [trName, setTrName] = useState('');
  const [trFrom, setTrFrom] = useState('');
  const [trTo, setTrTo] = useState('');

  const loadList = useCallback(async (): Promise<void> => {
    const res = await fetch(`${apiBase}/api/v1/admin/workflows`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) {
      setError(
        res.status === 403
          ? 'ต้องเป็นผู้ดูแลระบบจึงจะตั้งค่าส่วนนี้ได้'
          : `โหลดรายการไม่สำเร็จ (HTTP ${String(res.status)})`,
      );
      setRows([]);
      return;
    }
    const body = (await res.json()) as { rows: WorkflowRow[] };
    setRows(body.rows);
    if (selected === '' && body.rows[0] !== undefined) setSelected(body.rows[0].id);
  }, [apiBase, selected]);

  const loadDetail = useCallback(async (): Promise<void> => {
    if (selected === '') return;
    const res = await fetch(`${apiBase}/api/v1/admin/workflows/${selected}`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return;
    setDetail((await res.json()) as Detail);
  }, [apiBase, selected]);

  useEffect(() => {
    void loadList();
  }, [loadList]);
  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  async function send(path: string, body: unknown, done: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/workflows${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setError(d.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return false;
      }
      setNotice(done);
      await Promise.all([loadList(), loadDetail()]);
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (rows === null) return <p className="admin-empty">กำลังโหลด…</p>;

  return (
    <div className="admin">
      {error === null ? null : (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {notice === null ? null : (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      )}

      <form
        className="admin-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send('', { name: wfName, initialStatus: wfInitial }, `สร้าง "${wfName}" แล้ว`).then(
            (ok) => {
              if (ok) {
                setWfName('');
                setWfInitial('');
              }
            },
          );
        }}
      >
        <Field label="สร้าง workflow ใหม่" htmlFor="wf-name">
          <Input id="wf-name" value={wfName} onChange={setWfName} maxLength={64} />
        </Field>
        <Field
          label="สถานะเริ่มต้น"
          htmlFor="wf-initial"
          hint="สร้างเปล่าไม่ได้ — workflow ที่ไม่มีสถานะเริ่มต้นแจ้งเรื่องใหม่ไม่ได้"
        >
          <Input id="wf-initial" value={wfInitial} onChange={setWfInitial} maxLength={64} />
        </Field>
        <Button
          variant="primary"
          type="submit"
          disabled={busy || wfName.trim() === '' || wfInitial.trim() === ''}
        >
          สร้าง
        </Button>
      </form>

      <Field label="workflow ที่จะแก้" htmlFor="wf-pick">
        <Select
          id="wf-pick"
          value={selected}
          onChange={setSelected}
          options={rows.map((w) => ({
            value: w.id,
            label: `${w.name} — ${String(w.statusCount)} สถานะ · ${String(w.transitionCount)} ปุ่ม`,
          }))}
        />
      </Field>

      {detail === null ? null : (
        <>
          {detail.usedBy.length > 0 ? (
            <p className="admin-error" role="alert">
              {/* แก้ workflow ที่ใช้อยู่ กระทบตั๋วที่เปิดอยู่ทันที ไม่ใช่เฉพาะตั๋วใหม่ */}
              ใช้อยู่ในโปรเจกต์ {detail.usedBy.join(' · ')} — การแก้ที่นี่กระทบเรื่องที่เปิดอยู่ทันที
            </p>
          ) : (
            <p className="admin-empty">ยังไม่มีโปรเจกต์ไหนใช้ workflow นี้</p>
          )}

          <h2 className="cfg-title">สถานะ</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">ชื่อ</th>
                  <th scope="col">หมวด</th>
                  <th scope="col">เรื่องที่ค้างอยู่</th>
                  <th scope="col">หมายเหตุ</th>
                  <th scope="col">
                    <span className="ui-sr-only">การกระทำ</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.statuses.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{CATEGORY_LABEL[s.category] ?? s.category}</td>
                    <td className="admin-when">{s.itemCount.toLocaleString('th-TH')}</td>
                    <td>
                      {[s.isInitial ? 'สถานะเริ่มต้น' : null, s.pausesSla ? 'พักนาฬิกา SLA' : null]
                        .filter((v) => v !== null)
                        .join(' · ') || '—'}
                    </td>
                    <td className="admin-actions">
                      {s.isInitial ? null : (
                        <>
                          <button
                            type="button"
                            className="admin-linkish"
                            disabled={busy}
                            onClick={() => {
                              void send(
                                `/${detail.id}/statuses/${s.id}/initial`,
                                {},
                                `ตั้ง "${s.name}" เป็นสถานะเริ่มต้นแล้ว`,
                              );
                            }}
                          >
                            ตั้งเป็นสถานะเริ่มต้น
                          </button>
                          <button
                            type="button"
                            className="admin-linkish"
                            disabled={busy}
                            onClick={() => {
                              void send(
                                `/${detail.id}/statuses/${s.id}/remove`,
                                {},
                                `ลบ "${s.name}" แล้ว`,
                              );
                            }}
                          >
                            ลบ
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form
            className="admin-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(
                `/${detail.id}/statuses`,
                { name: stName, category: stCategory, pausesSla: stPauses },
                `เพิ่มสถานะ "${stName}" แล้ว`,
              ).then((ok) => {
                if (ok) setStName('');
              });
            }}
          >
            <Field label="เพิ่มสถานะ" htmlFor="st-name">
              <Input id="st-name" value={stName} onChange={setStName} maxLength={64} />
            </Field>
            <Field label="หมวด" htmlFor="st-cat" hint="หมวด DONE ทำให้ระบบถือว่าเรื่องจบแล้ว">
              <Select id="st-cat" value={stCategory} onChange={setStCategory} options={CATEGORIES} />
            </Field>
            <label className="grid-check">
              <input
                type="checkbox"
                checked={stPauses}
                onChange={() => {
                  setStPauses((v) => !v);
                }}
              />
              พักนาฬิกา SLA
            </label>
            <Button variant="primary" type="submit" disabled={busy || stName.trim() === ''}>
              เพิ่ม
            </Button>
          </form>

          <h2 className="cfg-title">ปุ่มเปลี่ยนสถานะ</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">ปุ่ม</th>
                  <th scope="col">จาก → ไป</th>
                  <th scope="col">กฎ</th>
                  <th scope="col">
                    <span className="ui-sr-only">การกระทำ</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.transitions.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>
                      {t.from ?? 'ทุกสถานะ'} → {t.to}
                    </td>
                    <td>
                      {/*
                        การลบปุ่มลบกฎไปด้วย (onDelete: Cascade)
                        ต้องเห็นจำนวนก่อนกดลบ ไม่ใช่รู้ตอนที่เงื่อนไขหายไปแล้ว
                      */}
                      {t.ruleCount === 0 ? '—' : `${String(t.ruleCount)} ข้อ`}
                    </td>
                    <td className="admin-actions">
                      <button
                        type="button"
                        className="admin-linkish"
                        disabled={busy}
                        onClick={() => {
                          void send(
                            `/${detail.id}/transitions/${t.id}/remove`,
                            {},
                            t.ruleCount === 0
                              ? `ลบปุ่ม "${t.name}" แล้ว`
                              : `ลบปุ่ม "${t.name}" พร้อมกฎ ${String(t.ruleCount)} ข้อแล้ว`,
                          );
                        }}
                      >
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form
            className="admin-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(
                `/${detail.id}/transitions`,
                {
                  name: trName,
                  fromStatusId: trFrom === '' ? null : trFrom,
                  toStatusId: trTo,
                },
                `เพิ่มปุ่ม "${trName}" แล้ว`,
              ).then((ok) => {
                if (ok) setTrName('');
              });
            }}
          >
            <Field label="เพิ่มปุ่ม" htmlFor="tr-name" hint="ข้อความบนปุ่มที่ผู้ใช้เห็น">
              <Input id="tr-name" value={trName} onChange={setTrName} maxLength={64} />
            </Field>
            <Field label="จากสถานะ" htmlFor="tr-from" hint="ไม่เลือก = ทำได้จากทุกสถานะ">
              <Select
                id="tr-from"
                value={trFrom}
                onChange={setTrFrom}
                placeholder="ทุกสถานะ"
                options={detail.statuses.map((s) => ({ value: s.id, label: s.name }))}
              />
            </Field>
            <Field label="ไปสถานะ" htmlFor="tr-to" required>
              <Select
                id="tr-to"
                value={trTo}
                onChange={setTrTo}
                placeholder="เลือกปลายทาง"
                options={detail.statuses.map((s) => ({ value: s.id, label: s.name }))}
              />
            </Field>
            <Button
              variant="primary"
              type="submit"
              disabled={busy || trName.trim() === '' || trTo === ''}
            >
              เพิ่ม
            </Button>
          </form>

          <p className="admin-empty">
            ยังตั้งกฎของปุ่มจากหน้าจอไม่ได้ — ใครเห็นปุ่ม ต้องกรอกอะไรก่อนกด และให้ทำอะไรต่อ
            ยังต้องตั้งในฐานข้อมูล
          </p>
        </>
      )}
    </div>
  );
}
