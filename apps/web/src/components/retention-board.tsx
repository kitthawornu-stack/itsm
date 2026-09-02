'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Checkbox, Input, Table } from '@itsm/ui';

interface Row {
  target: string;
  label: string;
  why: string;
  minKeepDays: number;
  keepDays: number | null;
  isEnabled: boolean;
  affected: number | null;
  problem: string | null;
  lastRunAt: string | null;
  lastDeleted: number | null;
}

/**
 * นโยบายระยะเวลาเก็บข้อมูล (PDPA)
 *
 * ## ปุ่มลบอยู่แยก และบอกจำนวนก่อนเสมอ
 *
 * การตั้งค่าไม่ลบอะไร · **การลบต้องกดอีกปุ่มหนึ่ง หลังเห็นจำนวนแล้ว** ·
 * ปุ่มเดียวที่ทำทั้งสองอย่างจะทำให้คนที่แค่อยากลองตั้งค่า ลบข้อมูลจริงไปแล้ว
 *
 * ## ยังไม่มีตัวตั้งเวลาโดยตั้งใจ
 *
 * ตัวลบที่ทำงานเองทุกคืนกับตารางที่กู้ไม่ได้ คือสิ่งที่โปรเจกต์นี้เจ็บมาแล้ว ·
 * หน้าจอนี้จึงบอกตรง ๆ ว่าต้องมีคนกด ไม่ปล่อยให้เข้าใจเอาเองว่ามันทำงานอยู่
 */
export function RetentionBoard({ apiBase }: { apiBase: string }): ReactNode {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState<string | null>(null);

  /** คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void` — ผู้เรียกต้องแยกสองอย่างนี้ได้ */
  async function post(path: string, body: unknown): Promise<Row[] | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/retention${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          (data as { message?: string } | null)?.message ??
            `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`,
        );
        return null;
      }
      const view = (data as { rows?: Row[]; view?: { rows: Row[] } }).view ?? (data as { rows: Row[] });
      return view.rows;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return null;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/admin/retention`, { credentials: 'include' });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          setError(
            (data as { message?: string } | null)?.message ??
              `เปิดหน้านี้ไม่ได้ (HTTP ${String(res.status)})`,
          );
          // ว่างเปล่า ไม่ใช่ null — สถานะ "โหลดไม่ได้" ต่างจาก "กำลังโหลด"
          setRows([]);
          return;
        }
        setRows((data as { rows: Row[] }).rows);
      } catch {
        setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
        setRows([]);
      }
    })();
  }, [apiBase]);

  // สถานะกำลังโหลด ต่างจากไม่มีข้อมูล — ถ้าปนกัน หน้าจอจะบอกว่า "ไม่มีอะไร" ตอนที่ยังไม่รู้
  if (rows === null) return <p className="page-sub">กำลังโหลด…</p>;

  const totalAffected = rows.reduce((sum, r) => sum + (r.affected ?? 0), 0);
  const anyEnabled = rows.some((r) => r.isEnabled && r.problem === null);

  return (
    <div className="ret">
      {/*
        คำอธิบายว่าทำไมต้องกดเอง มีความหมายเฉพาะกับคนที่กดได้ · คนที่ถูกปฏิเสธ
        เห็นแล้วสับสน เพราะมันอ่านเหมือนบอกวิธีทำสิ่งที่เขาทำไม่ได้ ·
        เจอตอนล็อกอินเป็นผู้ใช้ทั่วไปแล้วเปิดหน้านี้จริง
      */}
      {rows.length === 0 ? null : (
        <Alert tone="info" inline>
          <strong>การลบต้องกดเอง</strong> — ยังไม่มีตัวตั้งเวลาที่ลบให้อัตโนมัติ ·
          ตั้งใจให้เป็นแบบนี้ก่อน เพราะตัวลบที่ทำงานเองกับข้อมูลที่กู้คืนไม่ได้
          ต้องมีคนเห็นตัวเลขจริงอย่างน้อยหนึ่งครั้งก่อน
        </Alert>
      )}

      <Table
        columns={['ข้อมูล', 'เก็บกี่วัน', 'เปิดใช้', 'จะลบตอนนี้', 'ลบล่าสุด']}
        rowCount={rows.length}
      >
        {rows.map((r) => (
          <tr key={r.target}>
            <td>
              <div className="ret-label">{r.label}</div>
              <div className="ret-why">{r.why}</div>
              {r.problem === null ? null : <div className="ret-problem">{r.problem}</div>}
            </td>
            <td>
              <Input
                id={`ret-${r.target}`}
                ariaLabel={`จำนวนวันที่เก็บ ${r.label}`}
                value={draft[r.target] ?? (r.keepDays === null ? '' : String(r.keepDays))}
                onChange={(v) => {
                  setDraft({ ...draft, [r.target]: v });
                }}
                placeholder={`ต่ำสุด ${String(r.minKeepDays)}`}
              />
            </td>
            <td>
              <Checkbox
                checked={r.isEnabled}
                label={`เปิดใช้นโยบายของ ${r.label}`}
                onChange={(checked) => {
                  const raw = draft[r.target] ?? (r.keepDays === null ? '' : String(r.keepDays));
                  void post('', {
                    target: r.target,
                    keepDays: raw === '' ? r.minKeepDays : Number(raw),
                    isEnabled: checked,
                  }).then((next) => {
                    // อัปเดตเฉพาะตอนเซิร์ฟเวอร์รับแล้ว ไม่ใช่ตอนเรียกฟังก์ชันเสร็จ
                    if (next !== null) setRows(next);
                  });
                }}
              />
            </td>
            <td className="ret-num">
              {/* `null` = ยังไม่รู้ · ต่างจาก 0 ซึ่งแปลว่าไม่มีอะไรจะลบจริง ๆ */}
              {r.affected === null ? '—' : r.affected.toLocaleString('th-TH')}
            </td>
            <td className="ret-num">
              {r.lastRunAt === null
                ? 'ยังไม่เคย'
                : `${(r.lastDeleted ?? 0).toLocaleString('th-TH')} แถว`}
            </td>
          </tr>
        ))}
      </Table>

      <div className="admin-btn-row">
        <Button
          disabled={busy}
          onClick={() => {
            const changes = rows
              .filter((r) => draft[r.target] !== undefined && draft[r.target] !== '')
              .map((r) => ({
                target: r.target,
                keepDays: Number(draft[r.target]),
                isEnabled: r.isEnabled,
              }));
            if (changes.length === 0) {
              setError('ยังไม่ได้แก้จำนวนวันของอันไหนเลย');
              return;
            }
            void (async () => {
              let latest: Row[] | null = null;
              for (const c of changes) {
                latest = await post('', c);
                // หยุดที่อันแรกที่ถูกปฏิเสธ — ข้อความ error จะได้ตรงกับอันที่ผิด
                if (latest === null) return;
              }
              if (latest !== null) {
                setRows(latest);
                setDraft({});
              }
            })();
          }}
        >
          บันทึกจำนวนวัน
        </Button>

        <Button
          variant="danger"
          disabled={busy || !anyEnabled || totalAffected === 0}
          onClick={() => {
            void post('/run', {}).then((next) => {
              if (next !== null) {
                setRows(next);
                setRan(`ลบแล้ว ${totalAffected.toLocaleString('th-TH')} แถว`);
              }
            });
          }}
        >
          {totalAffected === 0
            ? 'ไม่มีอะไรให้ลบตอนนี้'
            : `ลบ ${totalAffected.toLocaleString('th-TH')} แถวตอนนี้`}
        </Button>
      </div>

      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}
      {ran === null ? null : (
        <Alert tone="success" inline>
          {ran}
        </Alert>
      )}
    </div>
  );
}
