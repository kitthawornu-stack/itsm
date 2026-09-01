'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Field, Input, LinkButton, Select, Table, TextLink } from '@itsm/ui';

interface BacklogRow {
  itemKey: string;
  summary: string;
  statusName: string;
  statusCategory: string;
  priorityName: string | null;
  storyPoints: number | null;
}

interface SprintRow {
  id: string;
  name: string;
  goal: string | null;
  state: string;
  startedAt: string | null;
  completedAt: string | null;
  itemCount: number;
  points: number;
  unestimated: number;
  committedPoints: number | null;
  completedPoints: number | null;
  addedAfterStart: number | null;
}

interface Velocity {
  average: number | null;
  usedSprints: number;
}

const nf = (n: number): string => n.toLocaleString('th-TH');

const STATE_TH: Record<string, string> = {
  planned: 'ยังไม่เริ่ม',
  active: 'กำลังทำอยู่',
  completed: 'ปิดแล้ว',
};

function whenThai(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  });
}

/**
 * Backlog และรอบการทำงาน
 *
 * ## ตัวเลขที่บอกความจริงทั้งหมด ไม่ใช่ครึ่งเดียว
 *
 * แถวของสปรินต์ที่ปิดแล้วแสดง **รับปาก → ทำได้ → เพิ่มระหว่างทาง** ครบสามค่า
 * · "ทำเสร็จ 40 แต้ม" ที่ซ่อนไว้ว่า 15 แต้มเพิ่งใส่เข้ามากลางทาง ทำให้ทีม
 * วางแผนรอบถัดไปด้วยความเร็วที่ไม่มีอยู่จริง
 *
 * และ **งานที่ยังไม่ประเมินถูกนับแยก** — สปรินต์ที่มีงาน 20 ใบซึ่งยังไม่
 * ประเมินสักใบ แล้วแสดง "0 แต้ม" คือการโกหกด้วยการละเว้น
 *
 * ## ปิดรอบต้องเลือกว่างานค้างไปไหน
 *
 * หน้าจอถามเสมอ ไม่เดาให้ · การเลือกให้เองเงียบ ๆ คือสิ่งที่ทำให้งานหายไป
 * ทางที่คนกดไม่ได้ตั้งใจ แล้วเขาจะไม่รู้จนกว่าจะมีคนถามหางานใบนั้น
 */
export function BacklogBoard({
  apiBase,
  projectKey,
}: {
  apiBase: string;
  projectKey: string;
}): ReactNode {
  const [backlog, setBacklog] = useState<BacklogRow[] | null>(null);
  const [backlogTotal, setBacklogTotal] = useState(0);
  const [sprints, setSprints] = useState<SprintRow[]>([]);
  const [velocity, setVelocity] = useState<Velocity>({ average: null, usedSprints: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newGoal, setNewGoal] = useState('');
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});

  const load = useCallback(async (): Promise<void> => {
    try {
      const [b, s] = await Promise.all([
        fetch(`${apiBase}/api/v1/projects/${projectKey}/backlog`, {
          credentials: 'include',
          cache: 'no-store',
        }),
        fetch(`${apiBase}/api/v1/projects/${projectKey}/sprints`, {
          credentials: 'include',
          cache: 'no-store',
        }),
      ]);
      if (!b.ok) {
        setError(`เปิด backlog ไม่ได้ (HTTP ${String(b.status)})`);
        setBacklog([]);
        return;
      }
      const bd = (await b.json()) as { rows: BacklogRow[]; total: number };
      setBacklog(bd.rows);
      setBacklogTotal(bd.total);
      if (s.ok) {
        const d = (await s.json()) as { rows: SprintRow[]; velocity: Velocity };
        setSprints(d.rows);
        setVelocity(d.velocity);
      }
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      setBacklog([]);
    }
  }, [apiBase, projectKey]);

  useEffect(() => {
    void load();
  }, [load]);

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
      const res = await fetch(`${apiBase}/api/v1${path}`, {
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
      await load();
      return true;
    } catch {
      onFail('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (backlog === null) return <p className="muted">กำลังโหลด…</p>;

  const open = sprints.filter((s) => s.state !== 'completed');
  const active = sprints.find((s) => s.state === 'active') ?? null;

  return (
    <section className="bkl">
      {error === null || error === '' ? null : <Alert tone="error">{error}</Alert>}

      <h2 className="section-title">
        รอบการทำงาน
        <span className="bkl-velocity">
          {velocity.average === null
            ? 'ยังไม่มีรอบที่ปิด — ยังคำนวณความเร็วไม่ได้'
            : `ความเร็วเฉลี่ย ${nf(velocity.average)} แต้ม จาก ${nf(velocity.usedSprints)} รอบล่าสุด`}
        </span>
      </h2>

      <Table
        label="รอบการทำงาน"
        columns={[
          'ชื่อ',
          { label: 'สถานะ', width: '120px' },
          { label: 'งาน', align: 'end', width: '70px' },
          { label: 'แต้มตอนนี้', align: 'end', width: '110px' },
          { label: 'รับปาก → ทำได้', width: '150px' },
          { label: 'การกระทำ', srOnly: true },
        ]}
        rowCount={sprints.length}
        empty="ยังไม่มีรอบ — สร้างได้ที่ฟอร์มข้างล่าง"
      >
        {sprints.map((s) => (
          <tr key={s.id} data-state={s.state}>
            <td>
              {s.name}
              {s.goal === null || s.goal === '' ? null : (
                <span className="bkl-goal">{s.goal}</span>
              )}
            </td>
            <td>
              {STATE_TH[s.state] ?? s.state}
              {s.startedAt === null ? null : (
                <span className="bkl-meta">เริ่ม {whenThai(s.startedAt)}</span>
              )}
            </td>
            <td className="num">{nf(s.itemCount)}</td>
            <td className="num">
              {nf(s.points)}
              {/* งานที่ยังไม่ประเมินนับแยก — ไม่กลืนเป็นศูนย์ */}
              {s.unestimated === 0 ? null : (
                <span className="bkl-meta">ยังไม่ประเมิน {nf(s.unestimated)}</span>
              )}
            </td>
            <td>
              {s.committedPoints === null ? (
                <span className="muted">ยังไม่เริ่ม</span>
              ) : (
                <>
                  {nf(s.committedPoints)} → {s.completedPoints === null ? '—' : nf(s.completedPoints)}
                  {/* ตัวเลขที่ทำให้ "ทำเสร็จ N แต้ม" อ่านถูก */}
                  {s.addedAfterStart === null || s.addedAfterStart === 0 ? null : (
                    <span className="bkl-meta">เพิ่มระหว่างทาง {nf(s.addedAfterStart)} ใบ</span>
                  )}
                </>
              )}
            </td>
            <td className="bkl-actions">
              {s.state === 'planned' ? (
                <Button
                  variant="secondary"
                  disabled={busy || active !== null}
                  onClick={() => {
                    void send(`/sprints/${s.id}/start`, 'POST');
                  }}
                >
                  {active === null ? 'เริ่มรอบนี้' : 'มีรอบที่กำลังทำอยู่'}
                </Button>
              ) : null}
              {s.state === 'active' ? (
                <span className="bkl-complete">
                  <Field label="งานที่ค้างไปไหน" htmlFor={`bkl-move-${s.id}`}>
                    <Select
                      id={`bkl-move-${s.id}`}
                      value={moveTo[s.id] ?? ''}
                      onChange={(v) => {
                        setMoveTo((m) => ({ ...m, [s.id]: v }));
                      }}
                      options={[
                        { value: '', label: 'กลับไป backlog' },
                        ...sprints
                          .filter((x) => x.state === 'planned')
                          .map((x) => ({ value: x.id, label: `ย้ายไป ${x.name}` })),
                      ]}
                    />
                  </Field>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => {
                      void send(`/sprints/${s.id}/complete`, 'POST', {
                        moveUndoneTo: moveTo[s.id] ?? '',
                      });
                    }}
                  >
                    ปิดรอบนี้
                  </Button>
                </span>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>

      <form
        className="bkl-new"
        onSubmit={(e) => {
          e.preventDefault();
          void send(
            `/projects/${projectKey}/sprints`,
            'POST',
            { name: newName, goal: newGoal },
            setAddError,
          ).then((ok) => {
            // ล้างฟอร์มเมื่อเซิร์ฟเวอร์รับแล้วเท่านั้น
            if (ok) {
              setNewName('');
              setNewGoal('');
            }
          });
        }}
      >
        <Field label="ชื่อรอบใหม่" htmlFor="bkl-name" required>
          <Input id="bkl-name" value={newName} onChange={setNewName} maxLength={128} required />
        </Field>
        <Field
          label="เป้าหมาย"
          htmlFor="bkl-goal"
          hint="ประโยคเดียวที่ตอบว่า “รอบนี้เราจะได้อะไร”"
        >
          <Input id="bkl-goal" value={newGoal} onChange={setNewGoal} maxLength={500} />
        </Field>
        <Button variant="secondary" type="submit" disabled={busy || newName.trim() === ''}>
          สร้างรอบ
        </Button>
        {/* ข้อความต้องอยู่ใกล้ปุ่มที่กด ไม่ใช่บนสุดของหน้า */}
        {addError === null || addError === '' ? null : (
          <Alert tone="error" inline>
            {addError}
          </Alert>
        )}
      </form>

      <h2 className="section-title">Backlog</h2>
      <p className="muted">
        งานที่ยังไม่อยู่ในรอบไหน เรียงตามลำดับความสำคัญที่จัดไว้ ·
        งานที่ปิดแล้วไม่อยู่ที่นี่ เพราะ backlog คือสิ่งที่ยังต้องทำ
        {/*
          บอกเสมอว่าแสดงกี่ใบจากทั้งหมดเท่าไร — ขีดจำกัดที่ตัดเงียบ ๆ ทำให้คน
          เห็น 200 แถวแล้วเชื่อว่านั่นคือทั้งหมด
        */}
        {backlogTotal > backlog.length ? (
          <strong>
            {' '}แสดง {nf(backlog.length)} จาก {nf(backlogTotal)} ใบ — จัดลำดับที่หน้ากระดาน
            เพื่อดันงานที่สำคัญขึ้นมา
          </strong>
        ) : null}
      </p>

      <Table
        label="งานที่ยังไม่อยู่ในรอบไหน"
        columns={[
          { label: 'คีย์', width: '110px' },
          'เรื่อง',
          { label: 'สถานะ', width: '120px' },
          { label: 'แต้ม', align: 'end', width: '110px' },
          { label: 'การกระทำ', srOnly: true },
        ]}
        rowCount={backlog.length}
        empty="ไม่มีงานค้างใน backlog"
      >
        {backlog.map((r) => (
          <tr key={r.itemKey}>
            <td>
              <TextLink href={`/browse/${r.itemKey}`} ariaLabel={`เปิด ${r.itemKey}`}>
                {r.itemKey}
              </TextLink>
            </td>
            <td>{r.summary}</td>
            <td>{r.statusName}</td>
            <td className="num">
              {/*
                ช่องแต้มเป็น input จริง ไม่ใช่ป้าย — การประเมินเกิดตอนอ่าน backlog
                ไม่ใช่ตอนเปิดงานทีละใบ · ว่าง = ยังไม่ประเมิน ซึ่งต่างจาก 0
              */}
              <input
                type="number"
                min="0"
                step="0.5"
                className="bkl-points"
                aria-label={`แต้มของ ${r.itemKey}`}
                defaultValue={r.storyPoints ?? ''}
                disabled={busy}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === String(r.storyPoints ?? '')) return;
                  void send(`/work-items/${r.itemKey}/points`, 'PUT', {
                    points: raw === '' ? null : raw,
                  });
                }}
              />
            </td>
            <td className="bkl-actions">
              {open.length === 0 ? (
                <span className="muted">ยังไม่มีรอบให้ใส่</span>
              ) : (
                open.map((s) => (
                  <LinkButton
                    key={s.id}
                    ariaLabel={`ใส่ ${r.itemKey} เข้ารอบ ${s.name}`}
                    disabled={busy}
                    onClick={() => {
                      void send(`/sprints/${s.id}/items`, 'POST', { itemKey: r.itemKey });
                    }}
                  >
                    ใส่ {s.name}
                  </LinkButton>
                ))
              )}
            </td>
          </tr>
        ))}
      </Table>
    </section>
  );
}
