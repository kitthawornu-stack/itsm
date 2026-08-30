'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  DailyChart,
  Field,
  Input,
  LinkButton,
  Select,
  Stat,
  Table,
} from '@itsm/ui';

interface DailyPoint {
  day: string;
  opened: number;
  resolved: number;
}

interface Summary {
  window: { from: string; to: string; label: string };
  projects: string[];
  opened: number;
  resolved: number;
  openNow: number;
  avgResolveHours: number | null;
  breached: number;
  daily: DailyPoint[];
  byPriority: Array<{ name: string; opened: number }>;
  byAssignee: Array<{ name: string; resolved: number }>;
}

interface Gadget {
  id: string;
  kind: string;
  column: number;
  row: number;
  title: string | null;
  projectId: string | null;
  data: Summary | null;
}

interface Dropped {
  id: string;
  reason: 'unknown-kind' | 'no-access' | 'over-capacity';
  title: string | null;
}

interface View {
  id: string | null;
  name: string;
  columns: number;
  isShared: boolean;
  isMine: boolean;
  gadgets: Gadget[];
  dropped: Dropped[];
  range: string;
}

interface BoardRow {
  id: string;
  name: string;
  isShared: boolean;
  owner: string;
  isMine: boolean;
  gadgetCount: number;
}

interface Options {
  kinds: Array<{ value: string; label: string }>;
  ranges: Array<{ key: string; label: string }>;
}

const nf = (n: number): string => n.toLocaleString('th-TH');

/**
 * เหตุผลที่การ์ดไม่ได้แสดง — เป็นภาษาคน ไม่ใช่รหัสของระบบ
 *
 * `unknown-kind` ไม่ใช่ความผิดของเจ้าของ · บอกว่าเกิดอะไรขึ้นและต้องทำอะไรต่อ
 * ไม่ใช่บอกชื่อสถานะภายในแล้วปล่อยให้เดา
 */
const DROP_REASON: Record<Dropped['reason'], string> = {
  'unknown-kind': 'การ์ดชนิดนี้ถูกถอดออกจากระบบแล้ว — ถอดออกจากหน้าได้เลย',
  'no-access': 'ไม่มีสิทธิ์ดูรายงานของโปรเจกต์ที่การ์ดนี้ผูกไว้',
  'over-capacity': 'เกินจำนวนการ์ดสูงสุดต่อหน้า',
};

/** ป้ายของการ์ดเมื่อเจ้าของไม่ได้ตั้งชื่อเอง */
function fallbackTitle(kind: string, kinds: Options['kinds']): string {
  return kinds.find((k) => k.value === kind)?.label ?? kind;
}

function GadgetBody({ kind, data }: { kind: string; data: Summary | null }): ReactNode {
  if (data === null) {
    return <p className="dash-quiet">ดึงตัวเลขของการ์ดนี้ไม่ได้ — ลองโหลดหน้าใหม่อีกครั้ง</p>;
  }
  switch (kind) {
    case 'summary':
      return (
        <div className="ui-stat-row">
          <Stat label="แจ้งเข้ามา" value={nf(data.opened)} hint={data.window.label} />
          <Stat label="ปิดได้" value={nf(data.resolved)} hint={data.window.label} />
          <Stat label="ค้างอยู่" value={nf(data.openNow)} hint="ณ ตอนนี้" />
          <Stat
            label="เวลาปิดเฉลี่ย"
            value={data.avgResolveHours === null ? '—' : `${nf(Math.round(data.avgResolveHours))} ชม.`}
            hint={data.avgResolveHours === null ? 'ยังไม่มีใบไหนปิดในช่วงนี้' : data.window.label}
          />
        </div>
      );
    case 'daily':
      return <DailyChart daily={data.daily} />;
    case 'breached':
      return (
        <div className="ui-stat-row">
          <Stat
            label="หลุดกำหนด"
            value={nf(data.breached)}
            tone="critical"
            hint={`${data.window.label} · นับจากเวลาที่หลุดจริง`}
          />
        </div>
      );
    case 'by-priority':
      return (
        <Table
          columns={['ความสำคัญ', { label: 'แจ้งเข้ามา', align: 'end', width: '110px' }]}
          rowCount={data.byPriority.length}
          empty="ไม่มีเรื่องแจ้งเข้ามาในช่วงนี้"
          label="แยกตามความสำคัญ"
        >
          {data.byPriority.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td className="num">{nf(r.opened)}</td>
            </tr>
          ))}
        </Table>
      );
    case 'by-assignee':
      return (
        <Table
          columns={['ผู้รับผิดชอบ', { label: 'ปิดได้', align: 'end', width: '110px' }]}
          rowCount={data.byAssignee.length}
          empty="ยังไม่มีใครปิดเรื่องในช่วงนี้"
          label="แยกตามผู้รับผิดชอบ"
        >
          {data.byAssignee.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td className="num">{nf(r.resolved)}</td>
            </tr>
          ))}
        </Table>
      );
    default:
      /*
        ชนิดที่เซิร์ฟเวอร์ยอมรับแต่หน้าจอยังวาดไม่เป็น — เกิดได้ตอนที่ API
        ใหม่กว่าเว็บ · บอกตรง ๆ ดีกว่าเรนเดอร์กล่องเปล่าที่ดูเหมือนไม่มีข้อมูล
      */
      return <p className="dash-quiet">หน้าจอรุ่นนี้ยังแสดงการ์ดชนิดนี้ไม่ได้</p>;
  }
}

/**
 * แดชบอร์ดที่จัดวางเอง
 *
 * ## ปุ่มย้ายอยู่ข้างการ์ด และเป็นปุ่มจริง ไม่ใช่การลากอย่างเดียว
 *
 * กติกาเดียวกับ Board — WCAG ไม่ผ่านถ้าย้ายได้ด้วยเมาส์ทางเดียว ·
 * และทุกปุ่มมี `ariaLabel` ของตัวเอง เพราะทุกการ์ดมีปุ่มข้อความเดียวกันหมด
 * คนที่ไล่ด้วยคีย์บอร์ดจะได้ยิน "ขึ้น ขึ้น ขึ้น" ถ้าไม่มีชื่อแยก
 *
 * ## โหมดจัดหน้าแยกจากโหมดดู
 *
 * ปุ่มย้ายและถอดโผล่ตลอดเวลา ทำให้หน้าที่คนเปิดดูทุกเช้ารกไปด้วยปุ่มที่
 * เขาจะกดปีละครั้ง · และเพิ่มโอกาสกดถอดโดยไม่ตั้งใจทุกวัน
 */
export function DashboardBoard({ apiBase }: { apiBase: string }): ReactNode {
  const [boards, setBoards] = useState<BoardRow[]>([]);
  const [options, setOptions] = useState<Options>({ kinds: [], ranges: [] });
  const [pick, setPick] = useState('default');
  const [range, setRange] = useState('this-month');
  const [view, setView] = useState<View | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState('');

  const loadList = useCallback(async (): Promise<void> => {
    const r = await fetch(`${apiBase}/api/v1/dashboards`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!r.ok) return;
    const d = (await r.json()) as { rows: BoardRow[] } & Options;
    setBoards(d.rows);
    setOptions({ kinds: d.kinds, ranges: d.ranges });
  }, [apiBase]);

  const loadView = useCallback(async (): Promise<void> => {
    setError(null);
    const r = await fetch(`${apiBase}/api/v1/dashboards/${pick}?range=${range}`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!r.ok) {
      const d = (await r.json().catch(() => null)) as { message?: string } | null;
      setError(d?.message ?? 'เปิดหน้านี้ไม่ได้');
      setView(null);
      return;
    }
    setView((await r.json()) as View);
  }, [apiBase, pick, range]);

  useEffect(() => {
    void loadList();
  }, [loadList]);
  useEffect(() => {
    void loadView();
  }, [loadView]);

  /** คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void` — ผู้เรียกต้องแยกสองอย่างนี้ได้ */
  async function send(
    path: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body?: unknown,
    onFail: (m: string) => void = setError,
  ): Promise<boolean> {
    setBusy(true);
    onFail('');
    try {
      const res = await fetch(`${apiBase}/api/v1/dashboards${path}`, {
        method,
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        onFail(d?.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return false;
      }
      return true;
    } catch {
      onFail('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const canEdit = view !== null && view.id !== null && view.isMine;
  const cols = Array.from({ length: view?.columns ?? 1 }, (_, i) => i);

  return (
    <section className="dash">
      <div className="dash-bar">
        <Field label="หน้า" htmlFor="dash-pick">
          <Select
            id="dash-pick"
            value={pick}
            onChange={(v) => {
              setPick(v);
              setEditing(false);
            }}
            options={[
              { value: 'default', label: 'ภาพรวม (หน้าเริ่มต้น)' },
              ...boards.map((b) => ({
                value: b.id,
                label: b.isMine ? b.name : `${b.name} — ${b.owner}`,
              })),
            ]}
          />
        </Field>

        <Field label="ช่วงเวลา" htmlFor="dash-range">
          <Select
            id="dash-range"
            value={range}
            onChange={setRange}
            options={options.ranges.map((r) => ({ value: r.key, label: r.label }))}
          />
        </Field>

        {!canEdit ? null : (
          <Button variant="secondary" onClick={() => {
              setEditing((e) => !e);
            }}>
            {editing ? 'เสร็จแล้ว' : 'จัดหน้านี้'}
          </Button>
        )}
      </div>

      {error === null || error === '' ? null : <Alert tone="error">{error}</Alert>}

      {view === null ? null : (
        <>
          {view.dropped.length === 0 ? null : (
            <Alert tone="warning" title={`การ์ด ${nf(view.dropped.length)} ใบไม่ได้แสดง`}>
              {/*
                บอกว่าอะไรหายไปและเพราะอะไร · การ์ดที่หายเงียบ ๆ ทำให้หน้าที่
                ไม่ครบดูเหมือนหน้าที่เจ้าของจัดไว้แบบนั้นเอง
              */}
              <ul className="dash-dropped">
                {view.dropped.map((d) => (
                  <li key={d.id}>
                    {d.title === null ? DROP_REASON[d.reason] : `${d.title} · ${DROP_REASON[d.reason]}`}
                    {!editing || !canEdit ? null : (
                      <LinkButton
                        ariaLabel={`ถอดการ์ดที่ไม่ได้แสดง ${d.title ?? d.id} ออกจากหน้านี้`}
                        tone="danger"
                        disabled={busy}
                        onClick={() => {
                          void send(`/${String(view.id)}/gadgets/${d.id}`, 'DELETE').then(
                            (ok) => (ok ? loadView() : undefined),
                          );
                        }}
                      >
                        ถอดออก
                      </LinkButton>
                    )}
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          <div className="dash-grid" data-cols={view.columns}>
            {cols.map((c) => (
              <div className="dash-col" key={c}>
                {view.gadgets
                  .filter((g) => g.column === c)
                  .map((g) => (
                    <article className="dash-card" key={g.id}>
                      <header className="dash-card-head">
                        <h2>{g.title ?? fallbackTitle(g.kind, options.kinds)}</h2>
                        {!editing ? null : (
                          <span className="dash-tools">
                            {/* ทุกการ์ดมีปุ่มข้อความเดียวกัน — ต้องมีชื่อแยกให้ screen reader */}
                            {(
                              [
                                ['up', '↑', 'ขึ้น'],
                                ['down', '↓', 'ลง'],
                                ['left', '←', 'ไปคอลัมน์ซ้าย'],
                                ['right', '→', 'ไปคอลัมน์ขวา'],
                              ] as const
                            ).map(([dir, glyph, word]) => (
                              <LinkButton
                                key={dir}
                                ariaLabel={`ย้ายการ์ด ${g.title ?? fallbackTitle(g.kind, options.kinds)} ${word}`}
                                disabled={busy}
                                onClick={() => {
                                  void send(
                                    `/${String(view.id)}/gadgets/${g.id}/move`,
                                    'POST',
                                    { direction: dir },
                                  ).then((ok) => (ok ? loadView() : undefined));
                                }}
                              >
                                {glyph}
                              </LinkButton>
                            ))}
                            <LinkButton
                              ariaLabel={`ถอดการ์ด ${g.title ?? fallbackTitle(g.kind, options.kinds)} ออกจากหน้านี้`}
                              tone="danger"
                              disabled={busy}
                              onClick={() => {
                                void send(`/${String(view.id)}/gadgets/${g.id}`, 'DELETE').then(
                                  (ok) => (ok ? loadView() : undefined),
                                );
                              }}
                            >
                              ถอด
                            </LinkButton>
                          </span>
                        )}
                      </header>
                      <GadgetBody kind={g.kind} data={g.data} />
                    </article>
                  ))}
              </div>
            ))}
          </div>

          {view.gadgets.length > 0 ? null : (
            <p className="dash-quiet">
              หน้านี้ยังไม่มีการ์ดที่แสดงได้ — กด “จัดหน้านี้” แล้วเพิ่มการ์ด
            </p>
          )}
        </>
      )}

      {!editing || view === null ? null : (
        <div className="dash-edit">
          <h2 className="dash-edit-title">จัดหน้า “{view.name}”</h2>

          <form
            className="dash-add"
            onSubmit={(e) => {
              e.preventDefault();
              void send(
                `/${String(view.id)}/gadgets`,
                'POST',
                { kind: newKind, column: 0 },
                setAddError,
              ).then((ok) => {
                // ล้างช่องเลือกเมื่อเซิร์ฟเวอร์รับแล้วเท่านั้น
                if (ok) {
                  setNewKind('');
                  void loadView();
                }
              });
            }}
          >
            <Field label="เพิ่มการ์ด" htmlFor="dash-kind">
              <Select
                id="dash-kind"
                value={newKind}
                onChange={setNewKind}
                placeholder="เลือกชนิด"
                options={options.kinds.map((k) => ({ value: k.value, label: k.label }))}
              />
            </Field>
            <Button variant="secondary" type="submit" disabled={busy || newKind === ''}>
              เพิ่มลงหน้านี้
            </Button>
            {/* ข้อความต้องอยู่ใกล้ปุ่มที่กด ไม่ใช่บนสุดของหน้า */}
            {addError === null || addError === '' ? null : (
              <Alert tone="error" inline>
                {addError}
              </Alert>
            )}
          </form>

          <div className="dash-add">
            <Field label="จำนวนคอลัมน์" htmlFor="dash-cols">
              <Select
                id="dash-cols"
                value={String(view.columns)}
                onChange={(v) => {
                  void send(`/${String(view.id)}`, 'PUT', { columns: Number(v) }).then((ok) =>
                    ok ? loadView() : undefined,
                  );
                }}
                options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${String(n)} คอลัมน์` }))}
              />
            </Field>

            <Checkbox
              checked={view.isShared}
              onChange={(v) => {
                void send(`/${String(view.id)}`, 'PUT', { isShared: v }).then((ok) =>
                  ok ? loadView() : undefined,
                );
              }}
              label="ให้ทุกคนในองค์กรเห็นหน้านี้"
            />
          </div>

          <p className="dash-quiet">
            คนอื่นที่เปิดหน้าที่แชร์ จะเห็นตัวเลขตามสิทธิ์ของตัวเอง ไม่ใช่ของคุณ
          </p>

          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              void send(`/${String(view.id)}`, 'DELETE').then((ok) => {
                if (ok) {
                  setPick('default');
                  setEditing(false);
                  void loadList();
                }
              });
            }}
          >
            ลบหน้านี้
          </Button>
        </div>
      )}

      <form
        className="dash-new"
        onSubmit={(e) => {
          e.preventDefault();
          void send('', 'POST', { name: newName }).then((ok) => {
            if (ok) {
              setNewName('');
              void loadList();
            }
          });
        }}
      >
        <Field label="สร้างหน้าใหม่" htmlFor="dash-new-name">
          <Input
            id="dash-new-name"
            value={newName}
            onChange={setNewName}
            placeholder="เช่น ภาพรวมของทีมผม"
            maxLength={128}
          />
        </Field>
        <Button variant="secondary" type="submit" disabled={busy || newName.trim() === ''}>
          สร้าง
        </Button>
      </form>
    </section>
  );
}
