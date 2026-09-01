'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Checkbox, Field, Input, LinkButton, Table } from '@itsm/ui';

interface Row {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastSentAt: string | null;
  pending: number;
  failed: number;
}

interface EventOption {
  value: string;
  label: string;
}

const nf = (n: number): string => n.toLocaleString('th-TH');

function whenThai(iso: string | null): string {
  if (iso === null) return 'ยังไม่เคยส่งสำเร็จ';
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}

/**
 * ทะเบียนปลายทางที่รับเหตุการณ์ออกไป
 *
 * ## ความลับแสดงครั้งเดียว และบอกให้ชัดว่าครั้งเดียว
 *
 * เซิร์ฟเวอร์ไม่มีทางส่งค่าเดิมกลับมาอีก · ถ้าหน้าจอไม่บอกตรงนี้ ผู้ดูแล
 * จะปิดกล่องไปแล้วค่อยกลับมาหา แล้วสรุปว่าระบบทำหาย · การตั้งใหม่ทำได้เสมอ
 * แต่ต้องไปแก้ที่ปลายทางด้วย ซึ่งเป็นงานที่ควรรู้ก่อนกด ไม่ใช่หลังกด
 *
 * ## บอกว่าปลายทางยังทำงานอยู่ไหม
 *
 * ทะเบียนที่ไม่บอกว่าส่งสำเร็จครั้งสุดท้ายเมื่อไร ทำให้ปลายทางที่ตายไปแล้ว
 * ดูเหมือนปลายทางที่ยังดีอยู่ · คอลัมน์ "ค้าง" กับ "เลิกลอง" คือสัญญาณแรก
 * ที่ผู้ดูแลจะเห็นก่อนที่ใครจะมาบ่นว่าระบบปลายทางไม่ขยับ
 */
export function WebhookAdmin({ apiBase }: { apiBase: string }): ReactNode {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [options, setOptions] = useState<EventOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch(`${apiBase}/api/v1/webhooks`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!r.ok) {
        // 403 = ไม่ใช่ผู้ดูแล · ซ่อนทั้งส่วน ไม่ใช่แสดงตารางที่กดอะไรไม่ได้
        setRows(null);
        return;
      }
      const d = (await r.json()) as { rows: Row[]; events: EventOption[] };
      setRows(d.rows);
      setOptions(d.events);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      setRows([]);
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  /** คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void` — ผู้เรียกต้องแยกสองอย่างนี้ได้ */
  async function send(
    path: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body?: unknown,
    onFail: (m: string) => void = setError,
  ): Promise<{ secret?: string } | null> {
    setBusy(true);
    onFail('');
    try {
      const res = await fetch(`${apiBase}/api/v1/webhooks${path}`, {
        method,
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = (await res.json().catch(() => null)) as {
        message?: string;
        secret?: string;
      } | null;
      if (!res.ok) {
        onFail(data?.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return null;
      }
      await load();
      return data ?? {};
    } catch {
      onFail('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (rows === null) return null;

  return (
    <section className="whk">
      {error === null || error === '' ? null : <Alert tone="error">{error}</Alert>}

      {secret === null ? null : (
        <Alert tone="warning" title={`ความลับของ "${secret.name}" — แสดงครั้งเดียวเท่านั้น`}>
          <p className="whk-secret">{secret.value}</p>
          <p>
            คัดลอกไปตั้งที่ปลายทางเดี๋ยวนี้ · ระบบไม่มีทางแสดงค่านี้อีก
            ถ้าทำหายให้กด “ตั้งความลับใหม่” แล้วไปแก้ที่ปลายทางด้วย
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setSecret(null);
            }}
          >
            เก็บแล้ว ปิดข้อความนี้
          </Button>
        </Alert>
      )}

      <Table
        label="ปลายทางที่รับเหตุการณ์"
        columns={[
          'ชื่อ',
          'ที่อยู่',
          'เหตุการณ์',
          { label: 'ส่งสำเร็จล่าสุด', width: '170px' },
          { label: 'ค้าง', align: 'end', width: '70px' },
          { label: 'เลิกลอง', align: 'end', width: '80px' },
          { label: 'การกระทำ', srOnly: true },
        ]}
        rowCount={rows.length}
        empty="ยังไม่มีปลายทาง — เพิ่มได้ที่ฟอร์มข้างล่าง"
      >
        {rows.map((r) => (
          <tr key={r.id} data-off={r.isActive ? undefined : 'true'}>
            <td>{r.name}</td>
            <td className="whk-url">{r.url}</td>
            <td>
              {r.events.length === 0 ? (
                /* ว่าง = ไม่รับอะไรเลย · ต้องอ่านออกจากหน้าจอ ไม่ใช่เดาเอง */
                <span className="muted">ยังไม่ได้เลือก — จะไม่ได้รับอะไรเลย</span>
              ) : (
                r.events.map((e) => options.find((o) => o.value === e)?.label ?? e).join(' · ')
              )}
            </td>
            <td>{whenThai(r.lastSentAt)}</td>
            <td className="num">{nf(r.pending)}</td>
            <td className="num">{nf(r.failed)}</td>
            <td className="whk-actions">
              {/* ทุกแถวมีปุ่มข้อความเดียวกัน — ต้องมีชื่อแยกให้ screen reader */}
              <Checkbox
                checked={r.isActive}
                disabled={busy}
                label={`เปิดใช้ ${r.name}`}
                onChange={(next) => {
                  void send(`/${r.id}`, 'PUT', { isActive: next });
                }}
              />
              <LinkButton
                ariaLabel={`ตั้งความลับใหม่ของ ${r.name}`}
                disabled={busy}
                onClick={() => {
                  void send(`/${r.id}/rotate`, 'POST').then((d) => {
                    if (d !== null) {
                      setSecret({ name: r.name, value: d.secret ?? '' });
                    }
                  });
                }}
              >
                ตั้งความลับใหม่
              </LinkButton>
              <LinkButton
                ariaLabel={`ลบปลายทาง ${r.name}`}
                tone="danger"
                disabled={busy}
                onClick={() => {
                  void send(`/${r.id}`, 'DELETE');
                }}
              >
                ลบ
              </LinkButton>
            </td>
          </tr>
        ))}
      </Table>

      <form
        className="whk-add"
        onSubmit={(e) => {
          e.preventDefault();
          void send('', 'POST', { name, url, events: picked }, setAddError).then((d) => {
            // ล้างฟอร์มเมื่อเซิร์ฟเวอร์รับแล้วเท่านั้น
            if (d !== null) {
              setSecret({ name, value: d.secret ?? '' });
              setName('');
              setUrl('');
              setPicked([]);
            }
          });
        }}
      >
        <h2 className="whk-add-title">เพิ่มปลายทาง</h2>

        <Field label="ชื่อ" htmlFor="whk-name" required>
          <Input id="whk-name" value={name} onChange={setName} maxLength={128} required />
        </Field>

        <Field
          label="ที่อยู่ที่จะส่งไป"
          htmlFor="whk-url"
          required
          hint="ขึ้นต้นด้วย http:// หรือ https:// · ที่อยู่ในวงแลนใช้ได้"
        >
          <Input
            id="whk-url"
            value={url}
            onChange={setUrl}
            placeholder="https://relay.local/helix"
            maxLength={1000}
            required
          />
        </Field>

        <fieldset className="whk-events">
          <legend>เหตุการณ์ที่จะส่ง</legend>
          {options.map((o) => (
            <Checkbox
              key={o.value}
              checked={picked.includes(o.value)}
              disabled={busy}
              label={o.label}
              onChange={(next) => {
                setPicked((cur) =>
                  next ? [...cur, o.value] : cur.filter((v) => v !== o.value),
                );
              }}
            />
          ))}
        </fieldset>

        <Button variant="primary" type="submit" disabled={busy || name === '' || url === ''}>
          เพิ่มปลายทาง
        </Button>

        {/* ข้อความต้องอยู่ใกล้ปุ่มที่กด ไม่ใช่บนสุดของหน้า */}
        {addError === null || addError === '' ? null : (
          <Alert tone="error" inline>
            {addError}
          </Alert>
        )}
      </form>
    </section>
  );
}
