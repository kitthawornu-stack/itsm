'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Field, LinkButton, Select, TextLink } from '@itsm/ui';

import { RISK_CHANGED_EVENT } from './change-risk-panel';

interface AttachedCi {
  id: string;
  key: string;
  name: string;
  kindLabel: string;
  statusLabel: string;
}

interface CiOption {
  id: string;
  key: string;
  name: string;
}

/**
 * สิ่งที่ดูแลที่เรื่องนี้กระทบ
 *
 * ## แผงนี้ขึ้นเสมอ ต่างจากแผงผลกระทบของปัญหา
 *
 * การผูกเป็นสิ่งที่คน **ทำ** กับเรื่องใดก็ได้ · ถ้าซ่อนไว้จนกว่าจะมีข้อมูล
 * จะไม่มีวันมีข้อมูล เพราะไม่มีใครเห็นว่าผูกได้ · แต่ **ไม่ขึ้นเลยถ้าทะเบียน
 * ยังว่างเปล่า** — ช่องที่เลือกอะไรไม่ได้คือช่องที่ทำให้คนสับสน
 *
 * ## ผูกด้วยสิทธิ์แก้เรื่อง ไม่ใช่สิทธิ์ผู้ดูแล
 *
 * คนที่ทำงานกับตั๋วต้องบอกได้ว่าเรื่องนี้กระทบเครื่องไหน มิฉะนั้นข้อมูล
 * จะไม่มีวันถูกกรอก แล้ว CMDB จะกลายเป็นทะเบียนที่ไม่ผูกกับอะไรเลย
 */
export function ItemCiPanel({
  apiBase,
  itemKey,
}: {
  apiBase: string;
  itemKey: string;
}): ReactNode {
  const [rows, setRows] = useState<AttachedCi[] | null>(null);
  const [options, setOptions] = useState<CiOption[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [mine, all] = await Promise.all([
        fetch(`${apiBase}/api/v1/work-items/${itemKey}/config-items`, {
          credentials: 'include',
          cache: 'no-store',
        }),
        fetch(`${apiBase}/api/v1/config-items`, { credentials: 'include', cache: 'no-store' }),
      ]);
      if (!mine.ok) {
        setRows([]);
        return;
      }
      setRows(((await mine.json()) as { rows: AttachedCi[] }).rows);
      if (all.ok) {
        setOptions(((await all.json()) as { rows: CiOption[] }).rows);
      }
    } catch {
      setRows([]);
    }
  }, [apiBase, itemKey]);

  useEffect(() => {
    void load();
  }, [load]);

  /** คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void` — ผู้เรียกต้องแยกสองอย่างนี้ได้ */
  async function send(path: string, method: 'POST' | 'DELETE', body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/v1/work-items/${itemKey}/config-items${path}`,
        {
          method,
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(d?.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return false;
      }
      await load();
      /*
        บอกแผงความเสี่ยงว่าต้องคำนวณใหม่ — ระดับมาจาก CI ที่ผูกไว้ ·
        ถ้าไม่บอก มันจะแสดงระดับเก่าค้างไว้ ซึ่งเป็นตัวเลขที่ผิดโดยไม่มีอะไรฟ้อง
      */
      window.dispatchEvent(new CustomEvent(RISK_CHANGED_EVENT));
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (rows === null) return null;
  /*
    ทะเบียนว่างและยังไม่ได้ผูกอะไร = ไม่ต้องแสดงอะไรเลย · ช่องที่เลือกอะไรไม่ได้
    ทำให้คนคิดว่าระบบพัง ไม่ใช่คิดว่ายังไม่มีข้อมูล
  */
  if (options.length === 0 && rows.length === 0) return null;

  const available = options.filter((o) => !rows.some((r) => r.id === o.id));

  return (
    <section className="ici" aria-label="สิ่งที่ดูแลที่เรื่องนี้กระทบ">
      <h2 className="detail-section-title">สิ่งที่เรื่องนี้กระทบ</h2>

      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}

      {rows.length === 0 ? (
        <p className="pim-quiet">
          ยังไม่ได้ระบุ — ผูกกับเครื่องหรือระบบที่เกี่ยวข้อง แล้วเรื่องนี้จะถูกนับ
          ในผลกระทบตอนที่ระบบนั้นล่ม
        </p>
      ) : (
        <ul className="pim-list">
          {rows.map((r) => (
            <li key={r.id}>
              <TextLink href="/admin/config-items" ariaLabel={`เปิดทะเบียนของ ${r.key}`}>
                {r.key}
              </TextLink>
              <span className="pim-summary">{r.name}</span>
              <span className="pim-meta">
                {r.kindLabel} · {r.statusLabel}
              </span>
              {/* ทุกบรรทัดมีปุ่มข้อความเดียวกัน — ต้องมีชื่อแยกให้ screen reader */}
              <LinkButton
                ariaLabel={`ถอด ${r.key} ${r.name} ออกจากเรื่องนี้`}
                tone="danger"
                disabled={busy}
                onClick={() => {
                  void send(`/${r.id}`, 'DELETE');
                }}
              >
                ถอด
              </LinkButton>
            </li>
          ))}
        </ul>
      )}

      {available.length === 0 ? null : (
        <form
          className="ci-dep-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send('', 'POST', { ciId: pick }).then((ok) => {
              // ล้างช่องเลือกเมื่อเซิร์ฟเวอร์รับแล้วเท่านั้น
              if (ok) setPick('');
            });
          }}
        >
          <Field label="เพิ่มสิ่งที่กระทบ" htmlFor="ici-pick">
            <Select
              id="ici-pick"
              value={pick}
              onChange={setPick}
              placeholder="เลือกจากทะเบียน"
              options={available.map((o) => ({ value: o.id, label: `${o.key} — ${o.name}` }))}
            />
          </Field>
          <Button variant="secondary" type="submit" disabled={busy || pick === ''}>
            ผูกเข้ากับเรื่องนี้
          </Button>
        </form>
      )}
    </section>
  );
}
