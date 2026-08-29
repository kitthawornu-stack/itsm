'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Field, Input, LinkButton, TextLink, Timestamp } from '@itsm/ui';

interface Conflict {
  itemKey: string;
  summary: string;
  start: string;
  end: string;
}

interface Freeze {
  name: string;
  reason: string;
  start: string;
  end: string;
}

interface WindowView {
  plannedStart: string;
  plannedEnd: string;
  freezeOverrideReason: string | null;
  createdBy: string;
  conflicts: Conflict[];
  freezes: Freeze[];
  startsInPast: boolean;
  durationMs: number;
}

/**
 * แปลง ISO (UTC) เป็นค่าของ `<input type="datetime-local">` ตามเวลาไทย
 *
 * `datetime-local` **ไม่มีเขตเวลา** — มันคือเวลาที่คนอ่านบนนาฬิกาของตัวเอง ·
 * การส่งสตริง UTC เข้าไปตรง ๆ ทำให้ช่องแสดงเวลาที่เร็วไปเจ็ดชั่วโมง
 * โดยไม่มีอะไรฟ้อง — คนกรอก 02:00 แล้วระบบเก็บ 09:00 ตามเวลาไทย
 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** ทางกลับ — ค่าจากช่องกรอกคือเวลาท้องถิ่น ต้องแปลงเป็น UTC ก่อนส่ง */
function toIso(local: string): string {
  return new Date(local).toISOString();
}

function readableDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${String(minutes)} นาที`;
  if (minutes === 0) return `${String(hours)} ชั่วโมง`;
  return `${String(hours)} ชั่วโมง ${String(minutes)} นาที`;
}

/**
 * หน้าต่างเวลาดำเนินการเปลี่ยนแปลง
 *
 * ## การชนกับงานอื่นแสดงเสมอ แต่ไม่กั้น
 *
 * ห้ามบันทึกเมื่อชนกัน = คนไปนัดกันในไลน์แล้วระบบไม่รู้อะไรเลย ·
 * หน้าที่ของหน้าจอคือทำให้เห็นว่าชนกับอะไร ไม่ใช่ทำให้ทำไม่ได้
 *
 * ## ช่องเหตุผลข้ามช่วงห้ามโผล่ก่อนกด ไม่ใช่หลังโดนปฏิเสธ
 *
 * ถ้าซ่อนไว้จนกดแล้วค่อยขึ้น คนจะกดแล้วเจอ error ทุกครั้งที่ตั้งใจจะข้าม
 * (บทเรียนเดียวกับช่องเหตุผลของการปฏิเสธคำขออนุมัติ)
 */
export function ChangeWindowPanel({
  apiBase,
  itemKey,
}: {
  apiBase: string;
  itemKey: string;
}): ReactNode {
  const [data, setData] = useState<WindowView | null | undefined>(undefined);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/change-window`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setData(null);
        return;
      }
      const d = (await res.json()) as { window: WindowView | null };
      setData(d.window);
      if (d.window !== null) {
        setStart(toLocalInput(d.window.plannedStart));
        setEnd(toLocalInput(d.window.plannedEnd));
        setReason(d.window.freezeOverrideReason ?? '');
      }
    } catch {
      setData(null);
    }
  }, [apiBase, itemKey]);

  useEffect(() => {
    void load();
  }, [load]);

  /** คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void` — ผู้เรียกต้องแยกสองอย่างนี้ได้ */
  async function send(method: 'PUT' | 'DELETE', body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/change-window`, {
        method,
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(d?.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return false;
      }
      await load();
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  // `undefined` = ยังไม่รู้ · `null` = รู้แล้วว่ายังไม่ได้ตั้ง — คนละเรื่องกัน
  if (data === undefined) return null;

  const showForm = editing || data === null;

  return (
    <section className="cw" aria-label="หน้าต่างเวลาดำเนินการ">
      <div className="cw-head">
        <h2 className="detail-section-title">หน้าต่างเวลาดำเนินการ</h2>
        {data === null || editing ? null : (
          <LinkButton
            disabled={busy}
            onClick={() => {
              setEditing(true);
            }}
          >
            แก้เวลา
          </LinkButton>
        )}
      </div>

      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}

      {data === null && !editing ? (
        <p className="admin-empty">
          ยังไม่ได้กำหนดช่วงเวลาดำเนินการ — กำหนดแล้วระบบจะบอกว่าชนกับการเปลี่ยนแปลงใบไหน
        </p>
      ) : null}

      {data === null || editing ? null : (
        <dl className="cw-summary">
          <div>
            <dt>เริ่ม</dt>
            <dd>
              <Timestamp utc={data.plannedStart} />
            </dd>
          </div>
          <div>
            <dt>สิ้นสุด</dt>
            <dd>
              <Timestamp utc={data.plannedEnd} />
            </dd>
          </div>
          <div>
            <dt>ยาว</dt>
            <dd>{readableDuration(data.durationMs)}</dd>
          </div>
          <div>
            <dt>กำหนดโดย</dt>
            <dd>{data.createdBy}</dd>
          </div>
        </dl>
      )}

      {/*
        ธงสามอย่างนี้แสดงตลอด ไม่ใช่เฉพาะตอนแก้ — งานใบอื่นถูกเลื่อนมาชน
        ทีหลังได้ คนที่เปิดดูวันนี้ต้องเห็นสภาพวันนี้ ไม่ใช่สภาพตอนที่บันทึก
      */}
      {data !== null && data.startsInPast ? (
        <Alert tone="warning" inline>
          เวลาเริ่มอยู่ในอดีต — บันทึกย้อนหลังได้ แต่ถ้าไม่ได้ตั้งใจ ให้แก้เวลา
        </Alert>
      ) : null}

      {data !== null && data.freezes.length > 0 ? (
        <Alert tone="warning" inline>
          อยู่ในช่วงห้ามเปลี่ยนแปลง:{' '}
          {data.freezes.map((f) => `${f.name} (${f.reason})`).join(' · ')}
          {data.freezeOverrideReason === null ? null : (
            <> — ข้ามด้วยเหตุผล “{data.freezeOverrideReason}”</>
          )}
        </Alert>
      ) : null}

      {data !== null && data.conflicts.length > 0 ? (
        <div className="cw-conflicts">
          <p className="cw-conflict-title">
            ชนกับการเปลี่ยนแปลงอีก {data.conflicts.length} เรื่องในช่วงเวลาเดียวกัน
          </p>
          <ul>
            {data.conflicts.map((c) => (
              <li key={c.itemKey}>
                {/*
                  `TextLink` ไม่ใช่ `<a>` ดิบ — `<a>` ที่ไม่มีคลาสได้สีลิงก์
                  ของเบราว์เซอร์ ซึ่งไม่ได้มาจาก token และในธีมมืดจะเป็นสีน้ำเงิน
                  เข้มบนพื้นดำ · เห็นจากภาพหน้าจอเท่านั้น
                */}
                <TextLink
                  href={`/browse/${c.itemKey}`}
                  ariaLabel={`เปิด ${c.itemKey} ${c.summary}`}
                >
                  {c.itemKey}
                </TextLink>{' '}
                {c.summary}
                <span className="cw-when">
                  <Timestamp utc={c.start} /> – <Timestamp utc={c.end} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showForm ? (
        <form
          className="cw-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send('PUT', {
              plannedStart: toIso(start),
              plannedEnd: toIso(end),
              ...(reason.trim() === '' ? {} : { freezeOverrideReason: reason }),
            }).then((ok) => {
              // ปิดฟอร์มเฉพาะตอนเซิร์ฟเวอร์รับแล้ว ไม่ใช่ตอนเรียกฟังก์ชันเสร็จ
              if (ok) setEditing(false);
            });
          }}
        >
          <Field label="เริ่ม" htmlFor="cw-start" required>
            <Input id="cw-start" type="datetime-local" value={start} required onChange={setStart} />
          </Field>
          <Field label="สิ้นสุด" htmlFor="cw-end" required>
            <Input id="cw-end" type="datetime-local" value={end} required onChange={setEnd} />
          </Field>
          {/*
            ช่องเหตุผลอยู่ในฟอร์มตั้งแต่แรก ไม่ใช่โผล่หลังโดนปฏิเสธ ·
            คนที่รู้อยู่แล้วว่าจะตั้งในช่วงห้าม จะได้กรอกไปพร้อมกันเลย
          */}
          <Field
            label="เหตุผลที่ต้องทำในช่วงห้ามเปลี่ยนแปลง"
            htmlFor="cw-reason"
            hint="กรอกเฉพาะเมื่อช่วงเวลาที่เลือกอยู่ในช่วงห้าม — เก็บไว้เฉพาะเมื่อข้ามจริง"
          >
            <Input
              id="cw-reason"
              value={reason}
              onChange={setReason}
              placeholder="เช่น ระบบล่ม ต้องกู้คืนทันที"
              maxLength={500}
            />
          </Field>
          <div className="admin-btn-row">
            <Button variant="primary" type="submit" disabled={busy || start === '' || end === ''}>
              บันทึกช่วงเวลา
            </Button>
            {data === null ? null : (
              <>
                <LinkButton
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setStart(toLocalInput(data.plannedStart));
                    setEnd(toLocalInput(data.plannedEnd));
                    setReason(data.freezeOverrideReason ?? '');
                  }}
                >
                  ยกเลิก
                </LinkButton>
                <LinkButton
                  tone="danger"
                  disabled={busy}
                  onClick={() => {
                    void send('DELETE').then((ok) => {
                      if (ok) setEditing(false);
                    });
                  }}
                >
                  ถอนช่วงเวลา
                </LinkButton>
              </>
            )}
          </div>
        </form>
      ) : null}
    </section>
  );
}
