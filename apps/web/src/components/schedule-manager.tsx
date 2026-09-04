'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { Button, Input, Select, Table } from '@itsm/ui';

/** ตรงกับ `Schedule` ฝั่ง API */
type Schedule =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'monthly'; day: number; hour: number; minute: number };

export interface ScheduleRow {
  id: string;
  name: string;
  projectKey: string;
  schedule: Schedule;
  isEnabled: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  nextRunAt: string;
}

const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/** เวลาไทยแบบอ่านง่ายจาก ISO · แปลงที่ชั้นแสดงผลเท่านั้น */
function thaiTime(iso: string): string {
  const d = new Date(Date.parse(iso) + 7 * 60 * 60 * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** คำอธิบายรอบเป็นภาษาคน ไม่ใช่ `daily` `weekly` */
function describe(s: Schedule): string {
  const at = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')} น.`;
  if (s.kind === 'daily') return `ทุกวัน ${at}`;
  if (s.kind === 'weekly') return `ทุกวัน${WEEKDAYS[s.weekday] ?? ''} ${at}`;
  return `ทุกวันที่ ${String(s.day)} ของเดือน ${at}`;
}

/**
 * ตั้งตารางเวลาส่งรายงานของตัวเอง
 *
 * **ตารางเป็นของแต่ละคน และส่งให้เจ้าของคนเดียว** · ไม่มีช่องให้กรอกผู้รับ
 * เพราะ "ส่งให้ทีม" เป็นคำที่ไม่มีใครนิยาม และคำที่ไม่มีใครนิยามจะกลายเป็น
 * "ทุกคน" ในโค้ดเสมอ
 */
export function ScheduleManager({
  apiBase,
  rows,
  projects,
}: {
  apiBase: string;
  rows: ScheduleRow[];
  /** โปรเจกต์ที่ผู้ใช้ดูรายงานได้ · รายการว่าง = ตั้งอะไรไม่ได้ */
  projects: string[];
}): ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [projectKey, setProjectKey] = useState(projects[0] ?? '');
  const [kind, setKind] = useState('daily');
  const [hour, setHour] = useState('8');
  const [minute, setMinute] = useState('0');
  const [weekday, setWeekday] = useState('1');
  const [day, setDay] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  /**
   * ยิงคำสั่งหนึ่งคำสั่ง · **คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void`**
   *
   * ตัวช่วยที่กลืน error ไว้เองทำให้ promise สำเร็จเสมอ แล้วผู้เรียก
   * จะล้างฟอร์มทั้งตอนที่ถูกปฏิเสธ (CLAUDE.md)
   */
  async function send(path: string, body: unknown, say: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/reports/${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        const msg = data.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`;
        setError(msg);
        setStatus(msg);
        return false;
      }
      setStatus(say);
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      setStatus('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sched">
      <Table
        columns={['ชื่อ', 'โปรเจกต์', 'รอบ', 'ครั้งต่อไป', 'สถานะ', '']}
        rowCount={rows.length}
        empty="ยังไม่ได้ตั้งตารางเวลาไว้ — รายงานจะไม่ถูกส่งอัตโนมัติ"
      >
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="sched-name">{r.name}</td>
            <td>{r.projectKey}</td>
            <td>{describe(r.schedule)}</td>
            {/*
              ปิดอยู่ = ไม่มีครั้งต่อไป · แสดงเวลาไว้จะอ่านเหมือนยังทำงาน
              ซึ่งเป็นตัวเลขที่ผิด และตัวเลขที่ผิดแย่กว่าไม่มีตัวเลข
            */}
            <td>{r.isEnabled ? thaiTime(r.nextRunAt) : '—'}</td>
            <td>
              {r.isEnabled ? 'เปิดอยู่' : 'ปิดไว้'}
              {r.lastError === null ? null : (
                <span className="sched-error"> · ครั้งล่าสุดล้ม: {r.lastError}</span>
              )}
            </td>
            <td className="sched-actions">
              <Button
                variant="ghost"
                disabled={busy}
                ariaLabel={`${r.isEnabled ? 'ปิด' : 'เปิด'}ตาราง ${r.name}`}
                onClick={() => {
                  void send(
                    `schedules/${r.id}/enabled`,
                    { enabled: !r.isEnabled },
                    r.isEnabled ? 'ปิดแล้ว' : 'เปิดแล้ว',
                  ).then((ok) => {
                    if (ok) router.refresh();
                  });
                }}
              >
                {r.isEnabled ? 'ปิด' : 'เปิด'}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                ariaLabel={`ลบตาราง ${r.name}`}
                onClick={() => {
                  void send(`schedules/${r.id}/delete`, {}, 'ลบแล้ว').then((ok) => {
                    if (ok) router.refresh();
                  });
                }}
              >
                ลบ
              </Button>
            </td>
          </tr>
        ))}
      </Table>

      {projects.length === 0 ? (
        <p className="sched-none">ยังไม่มีโปรเจกต์ที่คุณดูรายงานได้ จึงตั้งตารางเวลาไม่ได้</p>
      ) : !open ? (
        <p className="sched-add">
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(true);
            }}
          >
            ตั้งตารางเวลาใหม่
          </Button>
        </p>
      ) : (
        <div className="sched-form">
          <Input value={name} onChange={setName} ariaLabel="ชื่อตารางเวลา" placeholder="เช่น สรุปเช้าวันจันทร์" />
          <Select
            value={projectKey}
            onChange={setProjectKey}
            ariaLabel="โปรเจกต์"
            options={projects.map((p) => ({ value: p, label: p }))}
          />
          <Select
            value={kind}
            onChange={setKind}
            ariaLabel="รอบการส่ง"
            options={[
              { value: 'daily', label: 'ทุกวัน' },
              { value: 'weekly', label: 'ทุกสัปดาห์' },
              { value: 'monthly', label: 'ทุกเดือน' },
            ]}
          />
          {kind === 'weekly' ? (
            <Select
              value={weekday}
              onChange={setWeekday}
              ariaLabel="วันในสัปดาห์"
              options={WEEKDAYS.map((w, i) => ({ value: String(i), label: w }))}
            />
          ) : null}
          {kind === 'monthly' ? (
            <Input value={day} onChange={setDay} ariaLabel="วันที่ของเดือน" />
          ) : null}
          {/* เวลาเป็นเวลาไทย — บอกไว้ เพราะผู้ใช้ไม่มีทางเดาได้ว่าเก็บเป็นอะไร */}
          <Input value={hour} onChange={setHour} ariaLabel="ชั่วโมง (เวลาไทย)" />
          <Input value={minute} onChange={setMinute} ariaLabel="นาที" />

          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              void send(
                'schedules',
                {
                  projectKey,
                  name,
                  kind,
                  hour: Number(hour),
                  minute: Number(minute),
                  weekday: kind === 'weekly' ? Number(weekday) : null,
                  day: kind === 'monthly' ? Number(day) : null,
                },
                'ตั้งตารางเวลาแล้ว',
              ).then((ok) => {
                // ปิดฟอร์มเมื่อเซิร์ฟเวอร์รับแล้วเท่านั้น
                if (!ok) return;
                setOpen(false);
                setName('');
                router.refresh();
              });
            }}
          >
            บันทึก
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
          >
            ยกเลิก
          </Button>
        </div>
      )}

      {error === null ? null : (
        <p className="sched-msg" role="alert">
          {error}
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
