'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Input, LinkButton, Select, Timestamp } from '@itsm/ui';

interface Row {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  approverGroup: string;
  requestedBy: string;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<Row['status'], string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ถูกปฏิเสธ',
  CANCELLED: 'ยกเลิกแล้ว',
};

/**
 * การอนุมัติขั้นเดียว
 *
 * **แสดงประวัติทั้งหมด ไม่ใช่แค่ใบล่าสุด** — คำขอที่ถูกปฏิเสธแล้วขอใหม่
 * ต้องอ่านออกว่าเคยถูกปฏิเสธเพราะอะไร ไม่งั้นคนขอใหม่ด้วยเหตุผลเดิม
 *
 * ปุ่มตัดสินขึ้นตามที่เซิร์ฟเวอร์จะยอมจริง — แต่นี่คือการซ่อนปุ่มที่กดแล้วได้ 403
 * ไม่ใช่กลไกป้องกัน เซิร์ฟเวอร์ตรวจซ้ำเองทุกครั้ง
 */
export function ApprovalPanel({
  apiBase,
  itemKey,
}: {
  apiBase: string;
  itemKey: string;
}): ReactNode {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [group, setGroup] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/approvals`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setRows([]);
        return;
      }
      const d = (await res.json()) as { rows: Row[]; groups: Array<{ id: string; name: string }> };
      setRows(d.rows);
      setGroups(d.groups);
    } catch {
      setRows([]);
    }
  }, [apiBase, itemKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(path: string, body: unknown): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/approvals${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(d?.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setAsking(false);
      setReason('');
      setNote('');
      await load();
      // สถานะการอนุมัติเปลี่ยนปุ่ม transition ที่กดได้ — ต้องให้เซิร์ฟเวอร์ส่งหน้าใหม่
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  if (rows === null) return null;

  const pending = rows.find((r) => r.status === 'PENDING');

  return (
    <section className="apv" aria-label="การอนุมัติ">
      <div className="apv-head">
        <h2 className="detail-section-title">การอนุมัติ</h2>
        {pending === undefined ? (
          <LinkButton
            disabled={busy}
            onClick={() => {
              setAsking((v) => !v);
            }}
          >
            {rows.length === 0 ? 'ขออนุมัติ' : 'ขออนุมัติอีกครั้ง'}
          </LinkButton>
        ) : null}
      </div>

      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}

      {asking && pending === undefined ? (
        <form
          className="apv-form"
          onSubmit={(e) => {
            e.preventDefault();
            void post('', { approverGroupId: group, reason });
          }}
        >
          <label htmlFor="apv-group">
            ให้ใครอนุมัติ
            <Select
              id="apv-group"
              value={group}
              onChange={setGroup}
              placeholder="เลือกกลุ่มผู้อนุมัติ"
              options={groups.map((g) => ({ value: g.id, label: g.name }))}
            />
          </label>
          {/* เหตุผลไม่บังคับตอนขอ — แต่ช่วยให้ผู้อนุมัติตัดสินได้โดยไม่ต้องถามกลับ */}
          <label htmlFor="apv-reason">
            เหตุผล (ไม่บังคับ)
            <Input
              id="apv-reason"
              value={reason}
              onChange={setReason}
              placeholder="เช่น จอเดิมเสีย ใช้งานไม่ได้"
              maxLength={500}
            />
          </label>
          <Button variant="primary" type="submit" disabled={busy || group === ''}>
            ส่งคำขอ
          </Button>
        </form>
      ) : null}

      {pending === undefined ? null : (
        <div className="apv-decide">
          <p className="apv-pending">
            รออนุมัติจาก <b>{pending.approverGroup}</b> · ขอโดย {pending.requestedBy}
            {pending.reason === null ? null : <> — “{pending.reason}”</>}
          </p>
          {/*
            ช่องเหตุผลอยู่เหนือปุ่มทั้งสอง เพราะการปฏิเสธ **ต้อง** มีเหตุผล
            ถ้าซ่อนไว้จนกดปฏิเสธแล้วค่อยโผล่ คนจะกดแล้วเจอ error ทุกครั้ง
          */}
          <label htmlFor="apv-note">
            เหตุผล (บังคับเมื่อปฏิเสธ)
            <Input
              id="apv-note"
              value={note}
              onChange={setNote}
              placeholder="เช่น งบปีนี้หมดแล้ว ขอใหม่ปีหน้า"
              maxLength={500}
            />
          </label>
          <div className="admin-btn-row">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void post('/decision', { approve: true, note });
              }}
            >
              อนุมัติ
            </Button>
            <Button
              variant="danger"
              disabled={busy || note.trim() === ''}
              onClick={() => {
                void post('/decision', { approve: false, note });
              }}
            >
              ปฏิเสธ
            </Button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="admin-empty">ยังไม่เคยขออนุมัติเรื่องนี้</p>
      ) : (
        <ul className="apv-list">
          {rows.map((r) => (
            <li key={r.id} data-status={r.status}>
              <span className="apv-status">{STATUS_LABEL[r.status]}</span>
              <span className="apv-meta">
                {r.approverGroup} · ขอโดย {r.requestedBy} · <Timestamp utc={r.createdAt} />
              </span>
              {r.reason === null ? null : <span className="apv-note">คำขอ: {r.reason}</span>}
              {r.decidedBy === null ? null : (
                <span className="apv-note">
                  {r.status === 'APPROVED' ? 'อนุมัติโดย' : 'ปฏิเสธโดย'} {r.decidedBy}
                  {r.decidedAt === null ? null : (
                    <>
                      {' · '}
                      <Timestamp utc={r.decidedAt} />
                    </>
                  )}
                  {r.decisionNote === null ? null : <> — “{r.decisionNote}”</>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
