'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Input, LinkButton, Select, Timestamp } from '@itsm/ui';

interface Row {
  id: string;
  status: 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  chainSeq: number;
  stepNumber: number;
  stepCount: number;
  approverGroup: string;
  requestedBy: string;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

interface Group {
  id: string;
  name: string;
}

const STATUS_LABEL: Record<Row['status'], string> = {
  WAITING: 'ยังไม่ถึงคิว',
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ถูกปฏิเสธ',
  CANCELLED: 'ยกเลิกแล้ว',
};

/**
 * การอนุมัติหลายขั้น
 *
 * **แสดงทุกขั้นตั้งแต่ตอนขอ ไม่ใช่แค่ขั้นที่กำลังรอ** — ผู้ขอต้องเห็นว่าเหลือ
 * อีกกี่ด่าน · หน้าจอที่แสดงแค่ขั้นปัจจุบันทำให้คนคิดว่าใกล้จบแล้วทุกครั้ง
 *
 * **แสดงประวัติทั้งหมด ไม่ใช่แค่รอบล่าสุด** — คำขอที่ถูกปฏิเสธแล้วขอใหม่
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
  const [groups, setGroups] = useState<Group[]>([]);
  /** เซิร์ฟเวอร์ตอบว่าคนที่ดูอยู่ตัดสินขั้นนี้ได้ไหม — ค่าปริยายคือไม่ได้ */
  const [canDecide, setCanDecide] = useState(false);
  /** สายที่กำลังประกอบ — ลำดับในอาร์เรย์คือลำดับขั้นจริง */
  const [chain, setChain] = useState<Group[]>([]);
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
      const d = (await res.json()) as { rows: Row[]; groups: Group[]; canDecide?: boolean };
      setRows(d.rows);
      setGroups(d.groups);
      // ข้อมูลที่ไม่ครบต้องแปลว่าไม่มีสิทธิ์ ไม่ใช่ได้สิทธิ์พื้นฐาน
      setCanDecide(d.canDecide === true);
    } catch {
      setRows([]);
      setCanDecide(false);
    }
  }, [apiBase, itemKey]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * **คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void`** — ฟังก์ชันที่กลืน error เพื่อไม่ให้
   * หน้าจอพัง ทำให้ผู้เรียกแยกสำเร็จจากล้มเหลวไม่ได้ แล้วล้างฟอร์มทั้งสองทาง
   * (บทเรียนใน CLAUDE.md) · ที่นี่การล้างผูกกับ "เซิร์ฟเวอร์รับแล้ว" เท่านั้น
   */
  async function post(path: string, body: unknown): Promise<boolean> {
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
        return false;
      }
      setAsking(false);
      setChain([]);
      setReason('');
      setNote('');
      await load();
      // สถานะการอนุมัติเปลี่ยนปุ่ม transition ที่กดได้ — ต้องให้เซิร์ฟเวอร์ส่งหน้าใหม่
      router.refresh();
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (rows === null) return null;

  const pending = rows.find((r) => r.status === 'PENDING');
  const latestSeq = rows[0]?.chainSeq ?? 0;
  const latest = rows.filter((r) => r.chainSeq === latestSeq);
  const older = rows.filter((r) => r.chainSeq !== latestSeq);
  /*
    กลุ่มที่อยู่ในสายแล้วต้องไม่ถูกเสนอซ้ำ — เซิร์ฟเวอร์ปฏิเสธกลุ่มซ้ำอยู่แล้ว
    การเสนอตัวเลือกที่กดแล้วได้ error คือการหลอกให้คนลอง
  */
  const available = groups.filter((g) => !chain.some((c) => c.id === g.id));

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
            void post('', { approverGroupIds: chain.map((g) => g.id), reason });
          }}
        >
          <p className="apv-hint">
            เลือกได้มากกว่าหนึ่งกลุ่ม — จะต้องอนุมัติ<b>ตามลำดับที่เลือก</b>
            ทีละขั้น ขั้นถัดไปจะเปิดเมื่อขั้นก่อนหน้าผ่าน
          </p>

          {chain.length === 0 ? null : (
            <ol className="apv-chain">
              {chain.map((g, i) => (
                <li key={g.id}>
                  <span className="apv-step-no">ขั้นที่ {i + 1}</span>
                  <span className="apv-step-name">{g.name}</span>
                  {/*
                    ทุกบรรทัดมีปุ่มข้อความเดียวกัน จึงต้องมีชื่อแยกให้ screen reader
                    และต้องเป็น prop `ariaLabel` ไม่ใช่ `aria-label` — TypeScript
                    ไม่ตรวจแอตทริบิวต์ที่มีขีดกลางบนคอมโพเนนต์ของเรา
                  */}
                  <LinkButton
                    ariaLabel={`ถอด ${g.name} ออกจากขั้นที่ ${String(i + 1)}`}
                    disabled={busy}
                    onClick={() => {
                      setChain((c) => c.filter((x) => x.id !== g.id));
                    }}
                  >
                    ถอด
                  </LinkButton>
                </li>
              ))}
            </ol>
          )}

          <label htmlFor="apv-group">
            {chain.length === 0 ? 'ให้ใครอนุมัติ' : `เพิ่มขั้นที่ ${String(chain.length + 1)}`}
            <Select
              id="apv-group"
              value=""
              onChange={(id) => {
                const g = available.find((x) => x.id === id);
                if (g !== undefined) setChain((c) => [...c, g]);
              }}
              placeholder={
                available.length === 0 ? 'เลือกครบทุกกลุ่มแล้ว' : 'เลือกกลุ่มผู้อนุมัติ'
              }
              options={available.map((g) => ({ value: g.id, label: g.name }))}
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
          <Button variant="primary" type="submit" disabled={busy || chain.length === 0}>
            {chain.length > 1 ? `ส่งคำขอ ${String(chain.length)} ขั้น` : 'ส่งคำขอ'}
          </Button>
        </form>
      ) : null}

      {pending === undefined ? null : canDecide ? (
        <div className="apv-decide">
          <p className="apv-pending">
            รออนุมัติจาก <b>{pending.approverGroup}</b>
            {pending.stepCount > 1 ? (
              <>
                {' '}
                (ขั้นที่ {pending.stepNumber} จาก {pending.stepCount})
              </>
            ) : null}{' '}
            · ขอโดย {pending.requestedBy}
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
          {pending.stepNumber < pending.stepCount ? (
            /*
              ปฏิเสธขั้นเดียวจบทั้งสาย — ต้องรู้ก่อนกด ไม่ใช่รู้ตอนเห็นผล ·
              เงื่อนไขคือ **มีขั้นเหลือจริง** ไม่ใช่ "สายนี้มีหลายขั้น" —
              ตอนดูของจริงในเบราว์เซอร์ ขั้นสุดท้ายขึ้นว่า "เหลืออีก 0 ขั้น
              จะถูกยกเลิก" ซึ่งไม่มีความหมาย · typecheck กับ lint ผ่านทั้งคู่
            */
            <p className="apv-hint">
              ปฏิเสธขั้นนี้จะจบทั้งสาย ขั้นที่เหลืออีก {pending.stepCount - pending.stepNumber}{' '}
              ขั้นจะถูกยกเลิก
            </p>
          ) : null}
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
      ) : (
        /*
          คนที่ตัดสินขั้นนี้ไม่ได้ ยังต้องรู้ว่ากำลังรอใครอยู่ · การไม่แสดงอะไรเลย
          ทำให้ผู้ขอเปิดมาแล้วไม่รู้ว่าเรื่องของตัวเองไปถึงไหน
        */
        <p className="apv-pending apv-waiting">
          รออนุมัติจาก <b>{pending.approverGroup}</b>
          {pending.stepCount > 1 ? (
            <>
              {' '}
              (ขั้นที่ {pending.stepNumber} จาก {pending.stepCount})
            </>
          ) : null}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="admin-empty">ยังไม่เคยขออนุมัติเรื่องนี้</p>
      ) : (
        <>
          <ApprovalSteps rows={latest} />
          {older.length === 0 ? null : (
            <details className="apv-older">
              <summary>รอบก่อนหน้า ({older.length} ขั้น)</summary>
              <ApprovalSteps rows={older} />
            </details>
          )}
        </>
      )}
    </section>
  );
}

/** รายการขั้น — ใช้ทั้งรอบล่าสุดและรอบก่อนหน้า */
function ApprovalSteps({ rows }: { rows: Row[] }): ReactNode {
  return (
    <ol className="apv-list">
      {rows.map((r) => (
        <li key={r.id} data-status={r.status}>
          <span className="apv-status">
            {r.stepCount > 1 ? (
              <span className="apv-step-no">
                ขั้นที่ {r.stepNumber}/{r.stepCount}
              </span>
            ) : null}
            {STATUS_LABEL[r.status]}
          </span>
          <span className="apv-meta">
            {r.approverGroup} · ขอโดย {r.requestedBy} · <Timestamp utc={r.createdAt} />
          </span>
          {r.reason === null ? null : <span className="apv-note">คำขอ: {r.reason}</span>}
          {r.decidedBy === null ? (
            // ขั้นที่ถูกยกเลิกไม่มีผู้ตัดสิน แต่ต้องบอกว่ายกเลิกเพราะอะไร
            r.decisionNote === null ? null : <span className="apv-note">{r.decisionNote}</span>
          ) : (
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
    </ol>
  );
}
