'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Alert, Button, Input, LinkButton, Select } from '@itsm/ui';

export interface GoalRow {
  id: string;
  isCatchAll: boolean;
}

export interface CalendarRow {
  id: string;
  name: string;
  years: Array<{ year: number; required: boolean; verified: boolean }>;
}

/**
 * ตั้ง SLA Policy และ Goal จากหน้าจอ
 *
 * ก่อนหน้านี้ต้องเขียน SQL เท่านั้น · ส่วนนี้อันตรายกว่าที่อื่นเพราะความผิดพลาด
 * **ไม่ทำให้ระบบพัง แต่ทำให้ระบบตอบผิดอย่างเงียบ ๆ** — ตัวเลขบนหน้าคิว
 * ยังขึ้นเหมือนเดิม แค่ผิด · หน้าจอจึงเตือนก่อนทุกครั้งที่การกระทำมีผลย้อนหลัง
 */
export function SlaPolicyAdmin({
  apiBase,
  projectKey,
  policyId,
  goals,
  calendars,
}: {
  apiBase: string;
  projectKey: string;
  policyId: string | null;
  goals: GoalRow[];
  calendars: CalendarRow[];
}): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [polName, setPolName] = useState('');
  const [calId, setCalId] = useState('');
  const [goalName, setGoalName] = useState('');
  const [goalMinutes, setGoalMinutes] = useState('');
  const [goalRanks, setGoalRanks] = useState('');
  const [adding, setAdding] = useState(false);

  async function post(path: string, body: unknown, ok: string): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/projects/${projectKey}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as {
        message?: string;
        affectedOpenItems?: number;
      } | null;
      if (!res.ok) {
        setError(data?.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      /*
        บอกจำนวนงานที่กระทบทุกครั้งที่แก้เป้าหมายเวลา — เอนจินคำนวณใหม่จาก
        รายการเหตุการณ์ งานที่เคยอยู่ในเกณฑ์อาจกลายเป็นหลุดทันที
      */
      setNotice(
        data?.affectedOpenItems === undefined
          ? ok
          : `${ok} · กระทบงานที่เปิดอยู่ ${data.affectedOpenItems.toLocaleString('th-TH')} ใบ`,
      );
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  if (policyId === null) {
    return (
      <div className="sla-admin">
        {error === null ? null : <Alert tone="error" inline>{error}</Alert>}
        <form
          className="admin-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            void post('/sla', { name: polName, calendarId: calId }, 'สร้างนโยบายแล้ว');
          }}
        >
          <label htmlFor="pol-name">
            ชื่อนโยบาย
            <Input id="pol-name" value={polName} onChange={setPolName} maxLength={255} />
          </label>
          <label htmlFor="pol-cal">
            ปฏิทินเวลาทำการ
            <Select
              id="pol-cal"
              value={calId}
              onChange={setCalId}
              placeholder="เลือกปฏิทิน"
              options={calendars.map((c) => ({
                value: c.id,
                /*
                  บอกสถานะการยืนยันไว้ในชื่อเลย — ผู้ดูแลต้องเห็นก่อนเลือก
                  ว่าปฏิทินนั้นยังไม่มีใครยืนยัน ไม่ใช่เลือกไปแล้วค่อยรู้ว่า
                  ตัวเลข SLA ทุกตัวที่ตามมาเชื่อไม่ได้
                */
                label: c.years.some((y) => y.required && !y.verified)
                  ? `${c.name} — ยังไม่ได้ยืนยันวันหยุด`
                  : c.name,
              }))}
            />
          </label>
          <Button variant="primary" type="submit" disabled={busy || polName.trim() === '' || calId === ''}>
            สร้างนโยบาย
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="sla-admin">
      {error === null ? null : <Alert tone="error" inline>{error}</Alert>}
      {notice === null ? null : <Alert tone="success" inline>{notice}</Alert>}

      {adding ? (
        <form
          className="admin-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            const ranks = goalRanks
              .split(',')
              .map((r) => Number(r.trim()))
              .filter((r) => Number.isInteger(r) && r > 0);
            void post(
              '/sla/goals',
              {
                policyId,
                name: goalName,
                targetMinutes: Number(goalMinutes),
                priorityRanks: ranks,
              },
              'เพิ่มเป้าหมายแล้ว',
            );
            setGoalName('');
            setGoalMinutes('');
            setGoalRanks('');
            setAdding(false);
          }}
        >
          <label htmlFor="g-name">
            ชื่อเป้าหมาย
            <Input id="g-name" value={goalName} onChange={setGoalName} maxLength={255} />
          </label>
          <label htmlFor="g-min">
            เวลา (นาทีทำการ)
            <Input id="g-min" value={goalMinutes} onChange={setGoalMinutes} maxLength={7} />
          </label>
          <label htmlFor="g-ranks">
            ใช้กับความสำคัญ (เว้นว่าง = ทุกเรื่อง)
            <Input
              id="g-ranks"
              value={goalRanks}
              onChange={setGoalRanks}
              placeholder="เช่น 1, 2"
              maxLength={40}
            />
          </label>
          {/* เป้าที่ไม่มีเงื่อนไขจะถูกวางท้ายสุดเสมอ ไม่ว่ากดเพิ่มตอนไหน */}
          <p className="cfg-implied">
            เป้าที่ไม่ระบุความสำคัญ จะถูกวางท้ายสุดเสมอ — เอนจินใช้เป้าแรกที่เข้าเงื่อนไข
          </p>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || goalName.trim() === '' || goalMinutes.trim() === ''}
          >
            เพิ่ม
          </Button>
        </form>
      ) : (
        <LinkButton
          disabled={busy}
          onClick={() => {
            setAdding(true);
          }}
        >
          + เพิ่มเป้าหมาย
        </LinkButton>
      )}

      {goals.length === 0 ? null : (
        <ul className="sla-goal-actions">
          {goals.map((g, i) => (
            <li key={g.id}>
              <span className="cfg-implied">เป้าที่ {i + 1}</span>
              {/* catch-all ขึ้นไม่ได้ — เป้าที่เหลือจะกลายเป็นโค้ดที่ไปไม่ถึง */}
              <LinkButton
                disabled={busy || i === 0 || g.isCatchAll}
                onClick={() => {
                  void post(`/sla/goals/${g.id}/move`, { direction: 'up' }, 'สลับลำดับแล้ว');
                }}
              >
                ↑ ขึ้น
              </LinkButton>
              <LinkButton
                disabled={busy || i === goals.length - 1 || (goals[i + 1]?.isCatchAll ?? false)}
                onClick={() => {
                  void post(`/sla/goals/${g.id}/move`, { direction: 'down' }, 'สลับลำดับแล้ว');
                }}
              >
                ↓ ลง
              </LinkButton>
              <GoalTarget
                busy={busy}
                onSave={(m) => {
                  void post(`/sla/goals/${g.id}/target`, { targetMinutes: m }, 'แก้เป้าหมายเวลาแล้ว');
                }}
              />
              <LinkButton
                tone="danger"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm('ลบเป้าหมายนี้?')) return;
                  void post(`/sla/goals/${g.id}/remove`, {}, 'ลบเป้าหมายแล้ว');
                }}
              >
                ลบ
              </LinkButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * แก้เป้าหมายเวลาของเป้าหนึ่งข้อ
 *
 * แยกเป็นคอมโพเนนต์เพราะมี state ของตัวเอง — ถ้าใช้ร่วมกันทั้งรายการ
 * การพิมพ์ในแถวหนึ่งจะไปโผล่ในอีกแถว
 */
function GoalTarget({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (minutes: number) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const minutes = Number(text);
  const ok = Number.isInteger(minutes) && minutes > 0;

  if (!open) {
    return (
      <LinkButton
        disabled={busy}
        onClick={() => {
          setOpen(true);
        }}
      >
        แก้เวลา
      </LinkButton>
    );
  }
  return (
    <span className="sla-target-edit">
      <Input value={text} onChange={setText} placeholder="นาทีทำการ" maxLength={7} />
      <LinkButton
        disabled={busy || !ok}
        onClick={() => {
          onSave(minutes);
          setOpen(false);
          setText('');
        }}
      >
        บันทึก
      </LinkButton>
    </span>
  );
}
