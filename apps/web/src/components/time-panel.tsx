'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Field, Input, LinkButton, Table, Timestamp } from '@itsm/ui';

interface WorkLogView {
  id: string;
  spentMinutes: number;
  spentText: string;
  startedAt: string;
  note: string | null;
  author: { id: string; displayName: string };
  canEdit: boolean;
}

interface TimeSummary {
  originalEstimateMinutes: number | null;
  remainingMinutes: number | null;
  spentMinutes: number;
  originalText: string | null;
  remainingText: string | null;
  spentText: string;
  logs: WorkLogView[];
}

/**
 * เวลาทำงานของเรื่องหนึ่ง
 *
 * ## "ยังไม่ได้ประมาณ" ต่างจาก "ประมาณแล้วเหลือศูนย์"
 *
 * ช่องว่างกับ `0m` เป็นคนละคำตอบ · หน้าจอที่แสดงเหมือนกันทำให้คนสรุปว่างาน
 * ทุกใบประมาณเวลาไว้หมดแล้ว ทั้งที่ส่วนใหญ่ไม่เคยมีใครแตะ
 *
 * ## ใช้เกินที่ประมาณไว้ ต้องเห็น
 *
 * ตัวเลขที่เกินเป็นสัญญาณว่าประมาณผิดหรืองานบานปลาย — ซ่อนไว้แล้วไม่มีใคร
 * เรียนรู้อะไรจากรอบนี้เลย · แต่ไม่แสดงเป็นค่าติดลบ เพราะติดลบไม่ใช่คำตอบ
 */
export function TimePanel({ apiBase, itemKey }: { apiBase: string; itemKey: string }): ReactNode {
  const [data, setData] = useState<TimeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [spent, setSpent] = useState('');
  const [note, setNote] = useState('');
  const [original, setOriginal] = useState('');

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/time`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'คุณไม่มีสิทธิ์ดูเวลาทำงานของเรื่องนี้'
            : `โหลดเวลาทำงานไม่สำเร็จ (HTTP ${String(res.status)})`,
        );
        return;
      }
      setData((await res.json()) as TimeSummary);
      setError(null);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    }
  }, [apiBase, itemKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(path: string, init: RequestInit, done: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}${path}`, {
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...init,
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok) {
        // ข้อความจากเซิร์ฟเวอร์บอกว่าผิดตรงไหน — ไม่ทับด้วยข้อความรวม ๆ
        setError(body.message ?? `บันทึกไม่สำเร็จ (HTTP ${String(res.status)})`);
        return false;
      }
      setNotice(done);
      await load();
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (data === null) {
    return error === null ? <p className="muted">กำลังโหลด…</p> : <Alert tone="error">{error}</Alert>;
  }

  const over =
    data.originalEstimateMinutes !== null && data.spentMinutes > data.originalEstimateMinutes
      ? data.spentMinutes - data.originalEstimateMinutes
      : 0;

  return (
    <section className="time-panel">
      <h2 className="section-title">เวลาทำงาน</h2>
      {error === null ? null : <Alert tone="error">{error}</Alert>}
      {notice === null ? null : <Alert tone="success">{notice}</Alert>}

      <dl className="time-figures">
        <div>
          <dt>ประมาณไว้</dt>
          {/* ช่องว่างกับ 0m เป็นคนละคำตอบ — เขียนคำว่า "ยังไม่ได้ประมาณ" ให้ชัด */}
          <dd>{data.originalText ?? <span className="muted">ยังไม่ได้ประมาณ</span>}</dd>
        </div>
        <div>
          <dt>ใช้ไปแล้ว</dt>
          <dd>{data.spentText}</dd>
        </div>
        <div>
          <dt>เหลือ</dt>
          <dd>{data.remainingText ?? <span className="muted">—</span>}</dd>
        </div>
      </dl>

      {over === 0 ? null : (
        /* เกินที่ประมาณไว้ต้องเห็น แต่ไม่แสดงเป็นค่าติดลบ */
        <Alert tone="warning">ใช้เวลาเกินที่ประมาณไว้ — ควรทบทวนว่าประมาณผิดหรืองานบานปลาย</Alert>
      )}

      <div className="time-form">
        <Field label="บันทึกเวลาที่ใช้" htmlFor="wl-spent" hint="เช่น 2h 30m หรือใส่จำนวนนาที">
          <Input
            id="wl-spent"
            value={spent}
            onChange={setSpent}
            placeholder="2h 30m"
            maxLength={32}
          />
        </Field>
        <Field label="ทำอะไรไป" htmlFor="wl-note">
          <Input id="wl-note" value={note} onChange={setNote} maxLength={500} />
        </Field>
        <Button
          disabled={busy || spent.trim() === ''}
          onClick={() => {
            void send(
              '/time',
              { method: 'POST', body: JSON.stringify({ spent, note }) },
              'บันทึกเวลาแล้ว',
            ).then((ok) => {
              // ล้างฟอร์มเฉพาะเมื่อเซิร์ฟเวอร์รับจริง (CLAUDE.md)
              if (ok) {
                setSpent('');
                setNote('');
              }
            }, undefined);
          }}
        >
          บันทึก
        </Button>
      </div>

      <div className="time-form">
        <Field label="เวลาที่ประมาณไว้" htmlFor="wl-est" hint="เว้นว่างแล้วกดบันทึกเพื่อล้างค่า">
          <Input id="wl-est" value={original} onChange={setOriginal} maxLength={32} />
        </Field>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            void send(
              '/estimate',
              { method: 'POST', body: JSON.stringify({ original }) },
              'บันทึกเวลาที่ประมาณไว้แล้ว',
            );
          }}
        >
          ตั้งเวลาประมาณ
        </Button>
      </div>

      {data.logs.length === 0 ? (
        <p className="muted">ยังไม่มีใครบันทึกเวลากับเรื่องนี้</p>
      ) : (
        <Table
          label="บันทึกเวลาของเรื่องนี้"
          columns={['เมื่อไร', 'ใคร', { label: 'ใช้ไป', width: '96px' }, 'ทำอะไร', { label: '', width: '72px' }]}
          rowCount={data.logs.length}
        >
          {data.logs.map((l) => (
            <tr key={l.id}>
              <td>
                <Timestamp utc={l.startedAt} />
              </td>
              <td>{l.author.displayName}</td>
              <td>{l.spentText}</td>
              <td>{l.note ?? <span className="muted">—</span>}</td>
              <td>
                {l.canEdit ? (
                  <LinkButton
                    tone="danger"
                    disabled={busy}
                    /* ทุกบรรทัดมีปุ่ม "ลบ" เหมือนกัน — ชื่อต้องแยกแยะได้ (§8) */
                    ariaLabel={`ลบบันทึก ${l.spentText} ของ ${l.author.displayName}`}
                    onClick={() => {
                      void send(`/time/${l.id}`, { method: 'DELETE' }, 'ลบบันทึกเวลาแล้ว');
                    }}
                  >
                    ลบ
                  </LinkButton>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}
