'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Field, Input, LinkButton, Select, Table, TextLink } from '@itsm/ui';

interface CiRow {
  id: string;
  key: string;
  name: string;
  kind: string;
  kindLabel: string;
  status: string;
  statusLabel: string;
  ownerGroup: string | null;
  notes: string | null;
  dependsOnCount: number;
  usedByCount: number;
}

interface Option {
  value: string;
  label: string;
}

interface Impact {
  root: { id: string; key: string; name: string };
  affected: Array<{ id: string; key: string; name: string; kindLabel: string; distance: number }>;
  truncated: number;
  hasCycle: boolean;
}

interface ImpactItem {
  itemKey: string;
  summary: string;
  statusCategory: string;
  viaCiKey: string;
  distance: number;
}

const EMPTY = { key: '', name: '', kind: '', status: '', notes: '' };

/**
 * ทะเบียนสิ่งที่ดูแล และผลกระทบเมื่อมันล่ม
 *
 * ## ตัวเลือกชนิดและสถานะมาจากเซิร์ฟเวอร์
 *
 * ไม่พิมพ์ซ้ำในหน้าจอ — รายการที่พิมพ์ซ้ำคือรายการที่จะไม่ตรงกับเซิร์ฟเวอร์
 * ในวันที่มีคนเพิ่มชนิด (บทเรียนเดียวกับตัวเลือกกฎของ workflow)
 *
 * ## ผลกระทบเปิดดูทีละตัว ไม่ใช่แสดงทั้งกราฟ
 *
 * กราฟทั้งองค์กรอ่านไม่ออกและตอบคำถามที่ไม่มีใครถาม · คำถามจริงคือ
 * **"ถ้าตัวนี้ล่ม อะไรพังตาม"** ซึ่งเป็นคำถามเกี่ยวกับตัวเดียวเสมอ
 */
export function CmdbAdmin({ apiBase }: { apiBase: string }): ReactNode {
  const [rows, setRows] = useState<CiRow[] | null>(null);
  const [kinds, setKinds] = useState<Option[]>([]);
  const [statuses, setStatuses] = useState<Option[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [impact, setImpact] = useState<{ impact: Impact; items: ImpactItem[] } | null>(null);
  const [depTarget, setDepTarget] = useState('');
  /**
   * error ของการเพิ่มเส้นพึ่งพา แยกจาก error ของทะเบียน
   *
   * **ข้อความต้องอยู่ใกล้ปุ่มที่กด** · ตอนแรกใช้ตัวเดียวกัน ซึ่งเรนเดอร์
   * บนสุดของหน้า ส่วนปุ่มอยู่ล่างสุดใต้ตาราง — คนกดแล้วไม่เห็นอะไรเกิดขึ้น
   * แล้วสรุปว่าระบบไม่ทำงาน (เห็นจากภาพหน้าจอเท่านั้น)
   */
  const [depError, setDepError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/config-items`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setRows([]);
        return;
      }
      const d = (await res.json()) as { rows: CiRow[]; kinds: Option[]; statuses: Option[] };
      setRows(d.rows);
      setKinds(d.kinds);
      setStatuses(d.statuses);
    } catch {
      setRows([]);
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  /** คืนว่าสำเร็จหรือไม่ — ผู้เรียกต้องรู้ว่าจะล้างฟอร์มได้หรือยัง */
  async function send(
    path: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body: unknown,
    done: string,
    /** ให้ข้อความล้มเหลวไปโผล่ใกล้ปุ่มที่กด ไม่ใช่บนสุดของหน้าเสมอ */
    onError: (message: string) => void = setError,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setDepError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/config-items${path}`, {
        method,
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        if (res.status === 403) setDenied(true);
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        onError(d?.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
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

  async function openImpact(id: string): Promise<void> {
    setOpenId(id);
    setImpact(null);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/config-items/${id}/impact`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setError(`อ่านผลกระทบไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setImpact((await res.json()) as { impact: Impact; items: ImpactItem[] });
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    }
  }

  if (rows === null) return null;

  const ready = form.key.trim() !== '' && form.name.trim() !== '' && form.kind !== '';
  const current = rows.find((r) => r.id === openId) ?? null;
  // ตัวที่เลือกเป็น "พึ่งพา" ได้ — ไม่รวมตัวเอง เพราะเซิร์ฟเวอร์ปฏิเสธอยู่แล้ว
  const depOptions = rows.filter((r) => r.id !== openId).map((r) => ({
    value: r.id,
    label: `${r.key} — ${r.name}`,
  }));

  return (
    <>
      {error === null ? null : <Alert tone="error">{error}</Alert>}
      {notice === null ? null : <Alert tone="success">{notice}</Alert>}
      {denied ? (
        <Alert tone="info">
          การแก้ทะเบียนสงวนไว้สำหรับผู้ดูแลองค์กร — ดูผลกระทบได้ตามปกติ
        </Alert>
      ) : null}

      <form
        className="cf-form"
        onSubmit={(e) => {
          e.preventDefault();
          const isEdit = editing !== null;
          void send(
            isEdit ? `/${editing}` : '',
            isEdit ? 'PUT' : 'POST',
            {
              key: form.key,
              name: form.name,
              kind: form.kind,
              status: form.status === '' ? undefined : form.status,
              notes: form.notes,
            },
            isEdit ? `แก้ "${form.key}" แล้ว` : `เพิ่ม "${form.key}" แล้ว`,
          ).then((ok) => {
            // ล้างฟอร์มเมื่อเซิร์ฟเวอร์รับแล้วเท่านั้น
            if (ok) {
              setForm(EMPTY);
              setEditing(null);
            }
          });
        }}
      >
        <div className="cf-row">
          <Field label="รหัส" htmlFor="ci-key" required hint="รหัสสั้นที่คนพูดถึงกันได้">
            <Input
              id="ci-key"
              value={form.key}
              required
              maxLength={64}
              placeholder="เช่น DB-PROD-01"
              onChange={(v) => {
                setForm((f) => ({ ...f, key: v }));
              }}
            />
          </Field>
          <Field label="ชื่อ" htmlFor="ci-name" required>
            <Input
              id="ci-name"
              value={form.name}
              required
              maxLength={255}
              placeholder="เช่น ฐานข้อมูลระบบบัญชี"
              onChange={(v) => {
                setForm((f) => ({ ...f, name: v }));
              }}
            />
          </Field>
        </div>
        <div className="cf-row">
          <Field label="ชนิด" htmlFor="ci-kind" required>
            <Select
              id="ci-kind"
              value={form.kind}
              onChange={(v) => {
                setForm((f) => ({ ...f, kind: v }));
              }}
              placeholder="เลือกชนิด"
              options={kinds}
            />
          </Field>
          <Field label="สถานะ" htmlFor="ci-status">
            <Select
              id="ci-status"
              value={form.status}
              onChange={(v) => {
                setForm((f) => ({ ...f, status: v }));
              }}
              placeholder="ใช้งานอยู่"
              options={statuses}
            />
          </Field>
        </div>
        <div className="admin-btn-row">
          <Button variant="primary" type="submit" disabled={busy || !ready}>
            {editing === null ? 'เพิ่มเข้าทะเบียน' : 'บันทึกการแก้ไข'}
          </Button>
          {editing === null ? null : (
            <LinkButton
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setForm(EMPTY);
              }}
            >
              ยกเลิกการแก้ไข
            </LinkButton>
          )}
        </div>
      </form>

      <Table
        columns={[
          'รหัส',
          'ชื่อ',
          'ชนิด',
          'สถานะ',
          { label: 'พึ่งพา', align: 'end' as const },
          { label: 'ถูกพึ่งพา', align: 'end' as const },
          { label: 'การกระทำ', srOnly: true },
        ]}
        rowCount={rows.length}
        empty="ยังไม่มีอะไรในทะเบียน — เพิ่มเครื่องหรือระบบที่ทีมดูแล แล้วผูกกับเรื่องที่แจ้งเข้ามา"
      >
        {rows.map((r) => (
          <tr key={r.id} data-current={r.id === openId ? 'true' : undefined}>
            <td>{r.key}</td>
            <td>{r.name}</td>
            <td>{r.kindLabel}</td>
            <td>{r.statusLabel}</td>
            <td data-align="end">{r.dependsOnCount}</td>
            <td data-align="end">{r.usedByCount}</td>
            <td className="admin-actions">
              {/* ทุกแถวมีปุ่มข้อความเดียวกัน — ต้องมีชื่อแยกให้ screen reader */}
              <LinkButton
                ariaLabel={`ดูผลกระทบถ้า ${r.key} ล่ม`}
                disabled={busy}
                onClick={() => {
                  void openImpact(r.id);
                }}
              >
                ผลกระทบ
              </LinkButton>
              <LinkButton
                ariaLabel={`แก้ ${r.key}`}
                disabled={busy}
                onClick={() => {
                  setEditing(r.id);
                  setForm({
                    key: r.key,
                    name: r.name,
                    kind: r.kind,
                    status: r.status,
                    notes: r.notes ?? '',
                  });
                }}
              >
                แก้
              </LinkButton>
              <LinkButton
                ariaLabel={
                  r.dependsOnCount + r.usedByCount === 0
                    ? `ลบ ${r.key}`
                    : `ลบ ${r.key} พร้อมเส้นพึ่งพา ${String(r.dependsOnCount + r.usedByCount)} เส้น`
                }
                tone="danger"
                disabled={busy}
                onClick={() => {
                  void send(
                    `/${r.id}`,
                    'DELETE',
                    undefined,
                    r.dependsOnCount + r.usedByCount === 0
                      ? `ลบ "${r.key}" แล้ว`
                      : `ลบ "${r.key}" แล้ว พร้อมเส้นพึ่งพา ${String(r.dependsOnCount + r.usedByCount)} เส้น`,
                  ).then((ok) => {
                    if (ok && openId === r.id) {
                      setOpenId(null);
                      setImpact(null);
                    }
                  });
                }}
              >
                ลบ
              </LinkButton>
            </td>
          </tr>
        ))}
      </Table>

      {current === null ? null : (
        <section className="ci-detail" aria-label={`ผลกระทบของ ${current.key}`}>
          <h2 className="detail-section-title">
            ถ้า {current.key} ล่ม — {current.name}
          </h2>

          <form
            className="ci-dep-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(
                `/${current.id}/dependencies`,
                'POST',
                { dependsOnId: depTarget },
                'เพิ่มเส้นพึ่งพาแล้ว',
                setDepError,
              ).then((ok) => {
                if (ok) {
                  setDepTarget('');
                  void openImpact(current.id);
                }
              });
            }}
          >
            <Field
              label={`${current.key} พึ่งพาอะไร`}
              htmlFor="ci-dep"
              hint="ตัวที่เลือกล่มแล้ว ตัวนี้พังตาม"
            >
              <Select
                id="ci-dep"
                value={depTarget}
                onChange={setDepTarget}
                placeholder="เลือกสิ่งที่พึ่งพา"
                options={depOptions}
              />
            </Field>
            <Button variant="secondary" type="submit" disabled={busy || depTarget === ''}>
              เพิ่มเส้นพึ่งพา
            </Button>
          </form>

          {depError === null ? null : (
            <Alert tone="error" inline>
              {depError}
            </Alert>
          )}

          {impact === null ? (
            <p className="admin-empty">กำลังอ่าน…</p>
          ) : (
            <>
              {impact.impact.hasCycle ? (
                <Alert tone="warning" inline>
                  กราฟมีวงจร — มีเส้นที่วนกลับมาหาตัวเอง ผู้ดูแลต้องไล่หาและแก้
                </Alert>
              ) : null}
              {impact.impact.truncated === 0 ? null : (
                <Alert tone="warning" inline>
                  ไล่ได้ไม่หมด — ยังมีอีก {impact.impact.truncated} ตัวที่อยู่ลึกกว่าที่ระบบไล่ให้
                </Alert>
              )}

              {impact.impact.affected.length === 0 ? (
                <p className="pim-quiet">ไม่มีอะไรพึ่งพาตัวนี้ — ล่มแล้วไม่มีระบบอื่นพังตาม</p>
              ) : (
                <ul className="ci-impact">
                  {impact.impact.affected.map((a) => (
                    <li key={a.id}>
                      <span className="cal-time">ชั้นที่ {a.distance}</span>
                      <span className="pim-summary">
                        {a.key} — {a.name}
                      </span>
                      <span className="pim-meta">{a.kindLabel}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/*
                เรื่องที่ค้างอยู่คือเหตุผลที่คนเปิดหน้านี้ตอนเกิดเหตุ —
                ตัวเลขของกราฟตอบว่า "อะไรพังตาม" ส่วนรายการนี้ตอบว่า
                "แล้วตอนนี้มีใครเดือดร้อนอยู่บ้าง"
              */}
              <h3 className="detail-section-title detail-section-gap">
                เรื่องที่ค้างอยู่ในสายนี้ {impact.items.length} เรื่อง
              </h3>
              {impact.items.length === 0 ? (
                <p className="pim-quiet">ไม่มีเรื่องค้างอยู่บนตัวนี้หรือระบบที่พึ่งพามัน</p>
              ) : (
                <ul className="pim-list">
                  {impact.items.map((i) => (
                    <li key={i.itemKey}>
                      <TextLink
                        href={`/browse/${i.itemKey}`}
                        ariaLabel={`เปิด ${i.itemKey} ${i.summary}`}
                      >
                        {i.itemKey}
                      </TextLink>
                      <span className="pim-summary">{i.summary}</span>
                      <span className="pim-meta">
                        {i.distance === 0 ? 'บนตัวนี้เอง' : `ผ่าน ${i.viaCiKey}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
