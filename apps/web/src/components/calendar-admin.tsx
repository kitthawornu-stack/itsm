'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Field, LinkButton, Select, Textarea } from '@itsm/ui';

interface YearStatus {
  year: number;
  required: boolean;
  verified: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  source: string | null;
  empty: boolean;
  count: number;
  missingLunar: string[];
  holidays: Array<{ date: string; name: string }>;
  suggestion: Array<{ date: string; name: string }> | null;
}

interface CalendarRow {
  id: string;
  name: string;
  timezone: string;
  years: Array<{ year: number; required: boolean; verified: boolean; empty: boolean }>;
}

/** `2569-01-01  วันขึ้นปีใหม่` — ค.ศ. ในข้อมูล แต่แสดง พ.ศ. ให้คนอ่าน */
function toText(rows: Array<{ date: string; name: string }>): string {
  return rows.map((h) => `${h.date}  ${h.name}`).join('\n');
}

/**
 * แปลงข้อความกลับเป็นรายการ
 *
 * รับทั้งช่องว่างและ tab คั่น เพราะคนจะวางมาจาก Excel หรือจากหน้าเว็บประกาศ
 * บรรทัดที่อ่านไม่ออกถูกคืนกลับไปให้เห็น ไม่ใช่ทิ้งเงียบ ๆ —
 * การกลืนบรรทัดที่พิมพ์ผิดทำให้วันหยุดหายไปโดยไม่มีใครรู้จนถึงวันนั้น
 */
function parse(text: string): {
  rows: Array<{ date: string; name: string }>;
  bad: string[];
} {
  const rows: Array<{ date: string; name: string }> = [];
  const bad: string[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    const m = /^(\d{4}-\d{2}-\d{2})[\s\t]+(.+)$/.exec(t);
    if (m === null || m[1] === undefined || m[2] === undefined) {
      bad.push(t);
      continue;
    }
    rows.push({ date: m[1], name: m[2].trim() });
  }
  return { rows, bad };
}

export function CalendarAdmin({ apiBase }: { apiBase: string }): ReactNode {
  const [cals, setCals] = useState<CalendarRow[] | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [calId, setCalId] = useState('');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState<YearStatus | null>(null);
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadList = useCallback(async (): Promise<void> => {
    const res = await fetch(`${apiBase}/api/v1/admin/calendars`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) {
      setError(
        res.status === 403
          ? 'ต้องเป็นผู้ดูแลระบบจึงจะตั้งค่าส่วนนี้ได้'
          : `โหลดรายการไม่สำเร็จ (HTTP ${String(res.status)})`,
      );
      setCals([]);
      return;
    }
    const body = (await res.json()) as { rows: CalendarRow[]; years: number[] };
    setCals(body.rows);
    setYears(body.years);
    if (body.rows[0] !== undefined && calId === '') setCalId(body.rows[0].id);
    if (body.years[0] !== undefined && year === '') setYear(String(body.years[0]));
  }, [apiBase, calId, year]);

  const loadYear = useCallback(async (): Promise<void> => {
    if (calId === '' || year === '') return;
    const res = await fetch(`${apiBase}/api/v1/admin/calendars/${calId}/years/${year}?suggest=1`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return;
    const s = (await res.json()) as YearStatus;
    setStatus(s);
    setText(toText(s.holidays));
    setSource(s.source ?? '');
  }, [apiBase, calId, year]);

  useEffect(() => {
    void loadList();
  }, [loadList]);
  useEffect(() => {
    void loadYear();
  }, [loadYear]);

  async function send(path: string, body: unknown, done: string): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/calendars/${calId}/years/${year}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setError(d.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setNotice(done);
      await Promise.all([loadYear(), loadList()]);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  if (cals === null) return <p className="admin-empty">กำลังโหลด…</p>;
  const parsed = parse(text);

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

      <div className="admin-add-form">
        <Field label="ปฏิทิน" htmlFor="cal-pick">
          <Select
            id="cal-pick"
            value={calId}
            onChange={setCalId}
            options={cals.map((c) => ({ value: c.id, label: `${c.name} · ${c.timezone}` }))}
          />
        </Field>
        <Field label="ปี" htmlFor="cal-year">
          <Select
            id="cal-year"
            value={year}
            onChange={setYear}
            // แสดง พ.ศ. ให้คนอ่าน แต่ส่ง ค.ศ. ไปหลังบ้าน
            options={years.map((y) => ({ value: String(y), label: String(y + 543) }))}
          />
        </Field>
      </div>

      {status === null ? null : !status.required ? (
        <p className="admin-empty">
          ปฏิทินนี้ทำงานตลอด 24 ชั่วโมงทุกวัน จึงไม่มีวันหยุดให้ตรวจ
        </p>
      ) : (
        <>
          <p className={status.verified ? 'admin-notice' : 'admin-error'} role="status">
            {status.verified ? (
              <>
                ยืนยันแล้วโดย <b>{status.verifiedBy ?? 'ไม่ทราบชื่อ'}</b> เทียบกับ{' '}
                <b>{status.source}</b>
              </>
            ) : status.empty ? (
              <>ยังไม่มีวันหยุดสักวันในปีนี้ — ทุกวันจะถูกนับเป็นวันทำการ</>
            ) : (
              <>
                ยังไม่ได้ยืนยัน · มี {status.count} วัน
                {status.missingLunar.length === 0
                  ? ''
                  : ` · ยังไม่พบ ${status.missingLunar.join(' · ')}`}
              </>
            )}
          </p>

          <Field
            label="รายการวันหยุด"
            htmlFor="cal-text"
            hint="บรรทัดละหนึ่งวัน · รูปแบบ 2026-01-01 ตามด้วยชื่อวัน — ชื่อต้องตรงประกาศ เพราะระบบตรวจความครบจากชื่อ"
          >
            <Textarea id="cal-text" value={text} onChange={setText} rows={14} maxLength={8000} />
          </Field>

          {parsed.bad.length === 0 ? null : (
            <p className="admin-error" role="alert">
              {/* บรรทัดที่อ่านไม่ออกต้องเห็น ไม่ใช่หายเงียบ ๆ ไปพร้อมวันหยุดของมัน */}
              อ่านไม่ออก {parsed.bad.length} บรรทัด และจะไม่ถูกบันทึก:{' '}
              {parsed.bad.slice(0, 3).join(' | ')}
            </p>
          )}

          <div className="admin-btn-row">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void send('', { holidays: parsed.rows }, `บันทึก ${parsed.rows.length} วันแล้ว — ต้องยืนยันใหม่`);
              }}
            >
              บันทึกรายการ
            </Button>
            {status.suggestion === null ? null : (
              <LinkButton
                onClick={() => {
                  setText(toText(status.suggestion ?? []));
                  setNotice(
                    'เติมร่างจากวันหยุดตายตัวแล้ว — ยังขาดวันสำคัญทางพุทธศาสนาทั้งหมด ต้องเทียบกับประกาศจริงเอง',
                  );
                }}
              >
                เติมร่างจากวันหยุดตายตัว
              </LinkButton>
            )}
          </div>

          <div className="admin-add-form">
            <Field
              label="ยืนยันว่าตรงกับประกาศ"
              htmlFor="cal-source"
              hint="ระบุประกาศที่ใช้ตรวจ เช่น มติ ครม. 4 พ.ย. 2568"
            >
              <Textarea id="cal-source" value={source} onChange={setSource} rows={2} maxLength={255} />
            </Field>
            <Button
              variant="primary"
              disabled={busy || source.trim() === ''}
              onClick={() => {
                void send('/verify', { source }, 'ยืนยันแล้ว');
              }}
            >
              ยืนยันปี {Number(year) + 543}
            </Button>
          </div>

          <p className="admin-empty">
            การบันทึกรายการใหม่จะล้างคำยืนยันของปีนั้นเสมอ — คนที่เซ็นชื่อไว้ตรวจรายการเดิม
            ไม่ได้ตรวจรายการที่เพิ่งแก้
          </p>
        </>
      )}
    </div>
  );
}
