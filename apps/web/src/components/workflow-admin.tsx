'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Field, Input, LinkButton, Select, Table } from '@itsm/ui';

interface WorkflowRow {
  id: string;
  name: string;
  statusCount: number;
  transitionCount: number;
  usedBy: string[];
}

interface Status {
  id: string;
  name: string;
  category: string;
  isInitial: boolean;
  pausesSla: boolean;
  itemCount: number;
}

interface Rule {
  id: string;
  kind: string;
  ruleType: string;
  label: string;
  config: unknown;
}

interface CatalogEntry {
  kind: 'CONDITION' | 'VALIDATOR' | 'POST_FUNCTION';
  ruleType: string;
  label: string;
  hint: string;
  needsConfig: 'none' | 'fields' | 'groups' | 'goal';
}

interface Transition {
  id: string;
  name: string;
  from: string | null;
  to: string;
  ruleCount: number;
  rules?: Rule[];
}

type Detail = WorkflowRow & {
  statuses: Status[];
  transitions: Transition[];
  /** รายการกฎที่เลือกได้ — มาจากเอนจิน ไม่ใช่รายการที่หน้าจอเขียนเอง */
  ruleCatalog?: CatalogEntry[];
};

/** ชื่อชั้นของกฎเป็นภาษาคน — CONDITION/VALIDATOR ไม่มีความหมายกับผู้ดูแล */
const KIND_LABEL: Record<string, string> = {
  CONDITION: 'ใครเห็นปุ่ม',
  VALIDATOR: 'ต้องผ่านอะไรก่อน',
  POST_FUNCTION: 'กดแล้วทำอะไรต่อ',
};

const CATEGORIES = [
  { value: 'TODO', label: 'ยังไม่เริ่ม' },
  { value: 'IN_PROGRESS', label: 'กำลังทำ' },
  { value: 'DONE', label: 'จบแล้ว' },
];
const CATEGORY_LABEL: Record<string, string> = {
  TODO: 'ยังไม่เริ่ม',
  IN_PROGRESS: 'กำลังทำ',
  DONE: 'จบแล้ว',
};

/**
 * แก้ workflow
 *
 * **ตั้งกฎของปุ่มได้แล้ว** (ใครเห็นปุ่ม · ต้องกรอกอะไร · ทำอะไรต่อ) —
 * หน้าจอแสดงกฎทุกข้อ ไม่ใช่แค่จำนวน เพราะจำนวนบอกว่ามีอะไรอยู่ แต่ไม่บอกว่า
 * มันทำอะไร ซึ่งเป็นสิ่งเดียวที่ผู้ดูแลต้องรู้ก่อนแก้ · การลบปุ่มลบกฎไปด้วย
 */

/**
 * เพิ่มกฎหนึ่งข้อให้เส้นทางหนึ่งเส้น
 *
 * แยกเป็นคอมโพเนนต์ของตัวเองเพราะมี state ของตัวเอง (กฎที่เลือก + ค่าที่กรอก)
 * ถ้าใช้ state ร่วมกันทั้งตาราง การพิมพ์ในแถวหนึ่งจะไปโผล่ในอีกแถว
 *
 * **ช่องกรอก config ขึ้นตามกฎที่เลือก** — กฎที่ต้องมีค่าแต่ไม่มีช่องให้กรอก
 * จะถูกบันทึกเป็นกฎที่ไม่ทำอะไรเลย หรือกันทุกคนออก
 */
function RuleAdder({
  catalog,
  busy,
  onAdd,
  transitionName,
}: {
  catalog: CatalogEntry[];
  busy: boolean;
  onAdd: (body: Record<string, unknown>) => void;
  /** ชื่อปุ่มที่กฎนี้จะไปอยู่ — ใช้ตั้งชื่อให้ screen reader แยกแถวออกจากกัน */
  transitionName: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState('');
  const [text, setText] = useState('');

  const entry = catalog.find((e) => `${e.kind}/${e.ruleType}` === pick);
  const needs = entry?.needsConfig ?? 'none';
  const ready =
    entry !== undefined && (needs === 'none' || needs === 'goal' || text.trim() !== '');

  if (!open) {
    return (
      <span className="rule-add">
        <LinkButton
          ariaLabel={`เพิ่มกฎให้ปุ่ม ${transitionName}`}
          disabled={busy || catalog.length === 0}
          onClick={() => {
            setOpen(true);
          }}
        >
          + เพิ่มกฎ
        </LinkButton>
      </span>
    );
  }

  return (
    <div className="rule-form">
      <Select
        value={pick}
        onChange={(v) => {
          setPick(v);
          setText('');
        }}
        placeholder="เลือกกฎ"
        options={catalog.map((e) => ({
          value: `${e.kind}/${e.ruleType}`,
          label: `${KIND_LABEL[e.kind] ?? e.kind} · ${e.label}`,
        }))}
      />
      {entry === undefined ? null : <p className="cfg-implied">{entry.hint}</p>}

      {needs === 'fields' ? (
        <Input
          value={text}
          onChange={setText}
          placeholder="คีย์ฟิลด์ คั่นด้วยจุลภาค เช่น resolution, impact"
          maxLength={200}
        />
      ) : null}
      {needs === 'groups' ? (
        <Input
          value={text}
          onChange={setText}
          placeholder="รหัสกลุ่ม คั่นด้วยจุลภาค"
          maxLength={200}
        />
      ) : null}
      {needs === 'goal' ? (
        <Input value={text} onChange={setText} placeholder="ชื่อเป้า SLA (ไม่บังคับ)" maxLength={64} />
      ) : null}

      <div className="admin-btn-row">
        <Button
          variant="primary"
          disabled={busy || !ready}
          onClick={() => {
            if (entry === undefined) return;
            const parts = text
              .split(',')
              .map((x) => x.trim())
              .filter((x) => x !== '');
            onAdd({
              kind: entry.kind,
              ruleType: entry.ruleType,
              ...(needs === 'fields' ? { fields: parts } : {}),
              ...(needs === 'groups' ? { groupIds: parts } : {}),
              ...(needs === 'goal' && text.trim() !== '' ? { goal: text.trim() } : {}),
            });
            setOpen(false);
            setPick('');
            setText('');
          }}
        >
          เพิ่ม
        </Button>
        <LinkButton
          ariaLabel={`ยกเลิกการเพิ่มกฎให้ปุ่ม ${transitionName}`}
          onClick={() => {
            setOpen(false);
          }}
        >
          ยกเลิก
        </LinkButton>
      </div>
    </div>
  );
}

export function WorkflowAdmin({ apiBase }: { apiBase: string }): ReactNode {
  const [rows, setRows] = useState<WorkflowRow[] | null>(null);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [wfName, setWfName] = useState('');
  const [wfInitial, setWfInitial] = useState('');
  const [stName, setStName] = useState('');
  const [stCategory, setStCategory] = useState('TODO');
  const [stPauses, setStPauses] = useState(false);
  const [trName, setTrName] = useState('');
  const [trFrom, setTrFrom] = useState('');
  const [trTo, setTrTo] = useState('');

  const loadList = useCallback(async (): Promise<void> => {
    const res = await fetch(`${apiBase}/api/v1/admin/workflows`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) {
      setError(
        res.status === 403
          ? 'ต้องเป็นผู้ดูแลระบบจึงจะตั้งค่าส่วนนี้ได้'
          : `โหลดรายการไม่สำเร็จ (HTTP ${String(res.status)})`,
      );
      setRows([]);
      return;
    }
    const body = (await res.json()) as { rows: WorkflowRow[] };
    setRows(body.rows);
    if (selected === '' && body.rows[0] !== undefined) setSelected(body.rows[0].id);
  }, [apiBase, selected]);

  const loadDetail = useCallback(async (): Promise<void> => {
    if (selected === '') return;
    const res = await fetch(`${apiBase}/api/v1/admin/workflows/${selected}`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return;
    setDetail((await res.json()) as Detail);
  }, [apiBase, selected]);

  useEffect(() => {
    void loadList();
  }, [loadList]);
  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  async function send(path: string, body: unknown, done: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/workflows${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setError(d.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return false;
      }
      setNotice(done);
      await Promise.all([loadList(), loadDetail()]);
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (rows === null) return <p className="admin-empty">กำลังโหลด…</p>;

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

      <form
        className="admin-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send('', { name: wfName, initialStatus: wfInitial }, `สร้าง "${wfName}" แล้ว`).then(
            (ok) => {
              if (ok) {
                setWfName('');
                setWfInitial('');
              }
            },
          );
        }}
      >
        <Field label="สร้าง workflow ใหม่" htmlFor="wf-name">
          <Input id="wf-name" value={wfName} onChange={setWfName} maxLength={64} />
        </Field>
        <Field
          label="สถานะเริ่มต้น"
          htmlFor="wf-initial"
          hint="สร้างเปล่าไม่ได้ — workflow ที่ไม่มีสถานะเริ่มต้นแจ้งเรื่องใหม่ไม่ได้"
        >
          <Input id="wf-initial" value={wfInitial} onChange={setWfInitial} maxLength={64} />
        </Field>
        <Button
          variant="primary"
          type="submit"
          disabled={busy || wfName.trim() === '' || wfInitial.trim() === ''}
        >
          สร้าง
        </Button>
      </form>

      <Field label="workflow ที่จะแก้" htmlFor="wf-pick">
        <Select
          id="wf-pick"
          value={selected}
          onChange={setSelected}
          options={rows.map((w) => ({
            value: w.id,
            label: `${w.name} — ${String(w.statusCount)} สถานะ · ${String(w.transitionCount)} ปุ่ม`,
          }))}
        />
      </Field>

      {detail === null ? null : (
        <>
          {detail.usedBy.length > 0 ? (
            <p className="admin-error" role="alert">
              {/* แก้ workflow ที่ใช้อยู่ กระทบตั๋วที่เปิดอยู่ทันที ไม่ใช่เฉพาะตั๋วใหม่ */}
              ใช้อยู่ในโปรเจกต์ {detail.usedBy.join(' · ')} —
              การแก้ที่นี่กระทบเรื่องที่เปิดอยู่ทันที
            </p>
          ) : (
            <p className="admin-empty">ยังไม่มีโปรเจกต์ไหนใช้ workflow นี้</p>
          )}

          <h2 className="cfg-title">สถานะ</h2>
          <Table
            columns={[
              'ชื่อ',
              'หมวด',
              'เรื่องที่ค้างอยู่',
              'หมายเหตุ',
              { label: 'การกระทำ', srOnly: true },
            ]}
            rowCount={detail.statuses.length}
          >
            {detail.statuses.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{CATEGORY_LABEL[s.category] ?? s.category}</td>
                <td className="admin-when">{s.itemCount.toLocaleString('th-TH')}</td>
                <td>
                  {[s.isInitial ? 'สถานะเริ่มต้น' : null, s.pausesSla ? 'พักนาฬิกา SLA' : null]
                    .filter((v) => v !== null)
                    .join(' · ') || '—'}
                </td>
                <td className="admin-actions">
                  {s.isInitial ? null : (
                    <>
                      {/*
                        ทุกบรรทัดมีปุ่มข้อความเดียวกัน — ต้องมีชื่อแยกให้ screen reader
                        มิฉะนั้นคนที่ไล่ด้วยคีย์บอร์ดได้ยิน "ลบ ลบ ลบ" โดยไม่รู้ว่าอันไหน
                        ของอะไร · และต้องเป็น prop `ariaLabel` ไม่ใช่ `aria-label`
                        เพราะ TypeScript ไม่ตรวจแอตทริบิวต์ที่มีขีดกลาง
                      */}
                      <LinkButton
                        ariaLabel={`ตั้ง ${s.name} เป็นสถานะเริ่มต้น`}
                        disabled={busy}
                        onClick={() => {
                          void send(
                            `/${detail.id}/statuses/${s.id}/initial`,
                            {},
                            `ตั้ง "${s.name}" เป็นสถานะเริ่มต้นแล้ว`,
                          );
                        }}
                      >
                        ตั้งเป็นสถานะเริ่มต้น
                      </LinkButton>
                      <LinkButton
                        ariaLabel={`ลบสถานะ ${s.name}`}
                        tone="danger"
                        disabled={busy}
                        onClick={() => {
                          void send(
                            `/${detail.id}/statuses/${s.id}/remove`,
                            {},
                            `ลบ "${s.name}" แล้ว`,
                          );
                        }}
                      >
                        ลบ
                      </LinkButton>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>

          <form
            className="admin-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(
                `/${detail.id}/statuses`,
                { name: stName, category: stCategory, pausesSla: stPauses },
                `เพิ่มสถานะ "${stName}" แล้ว`,
              ).then((ok) => {
                if (ok) setStName('');
              });
            }}
          >
            <Field label="เพิ่มสถานะ" htmlFor="st-name">
              <Input id="st-name" value={stName} onChange={setStName} maxLength={64} />
            </Field>
            <Field label="หมวด" htmlFor="st-cat" hint="หมวด DONE ทำให้ระบบถือว่าเรื่องจบแล้ว">
              <Select
                id="st-cat"
                value={stCategory}
                onChange={setStCategory}
                options={CATEGORIES}
              />
            </Field>
            <label className="grid-check">
              <input
                type="checkbox"
                checked={stPauses}
                onChange={() => {
                  setStPauses((v) => !v);
                }}
              />
              พักนาฬิกา SLA
            </label>
            <Button variant="primary" type="submit" disabled={busy || stName.trim() === ''}>
              เพิ่ม
            </Button>
          </form>

          <h2 className="cfg-title">ปุ่มเปลี่ยนสถานะ</h2>
          <Table
            columns={['ปุ่ม', 'จาก → ไป', 'กฎ', { label: 'การกระทำ', srOnly: true }]}
            rowCount={detail.transitions.length}
          >
            {detail.transitions.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>
                  {t.from ?? 'ทุกสถานะ'} → {t.to}
                </td>
                <td>
                  {/*
            การลบปุ่มลบกฎไปด้วย (onDelete: Cascade)
            ต้องเห็นจำนวนก่อนกดลบ ไม่ใช่รู้ตอนที่เงื่อนไขหายไปแล้ว

            แสดงกฎทุกข้อตรงนี้ ไม่ใช่แค่จำนวน — จำนวนบอกว่ามีอะไรอยู่
            แต่ไม่บอกว่ามันทำอะไร ซึ่งเป็นสิ่งเดียวที่ผู้ดูแลต้องรู้ก่อนแก้
          */}
                  {t.rules === undefined || t.rules.length === 0 ? (
                    '—'
                  ) : (
                    <ul className="rule-list">
                      {t.rules.map((r) => (
                        <li key={r.id}>
                          <span className="cfg-implied">{KIND_LABEL[r.kind] ?? r.kind}: </span>
                          {r.label}
                          <span className="rule-del">
                            <LinkButton
                              ariaLabel={`ลบกฎ ${r.label} ของปุ่ม ${t.name}`}
                              tone="danger"
                              disabled={busy}
                              onClick={() => {
                                void send(
                                  `/${detail.id}/transitions/${t.id}/rules/${r.id}/remove`,
                                  {},
                                  `ลบกฎ "${r.label}" แล้ว`,
                                );
                              }}
                            >
                              ลบกฎ
                            </LinkButton>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/*
            เพิ่มกฎได้จากที่นี่ — ก่อนหน้านี้ต้องเขียน SQL เท่านั้น
            ซึ่งแปลว่ากฎอย่าง "ต้องได้รับอนุมัติก่อน" ไม่มีใครเปิดใช้ได้เลย
          */}
                  <RuleAdder
                    catalog={detail.ruleCatalog ?? []}
                    busy={busy}
                    transitionName={t.name}
                    onAdd={(body) => {
                      void send(
                        `/${detail.id}/transitions/${t.id}/rules`,
                        body,
                        'เพิ่มกฎแล้ว',
                      );
                    }}
                  />
                </td>
                <td className="admin-actions">
                  <LinkButton
                    ariaLabel={
                      t.ruleCount === 0
                        ? `ลบปุ่ม ${t.name}`
                        : `ลบปุ่ม ${t.name} พร้อมกฎ ${String(t.ruleCount)} ข้อ`
                    }
                    tone="danger"
                    disabled={busy}
                    onClick={() => {
                      void send(
                        `/${detail.id}/transitions/${t.id}/remove`,
                        {},
                        t.ruleCount === 0
                          ? `ลบปุ่ม "${t.name}" แล้ว`
                          : `ลบปุ่ม "${t.name}" พร้อมกฎ ${String(t.ruleCount)} ข้อแล้ว`,
                      );
                    }}
                  >
                    ลบ
                  </LinkButton>
                </td>
              </tr>
            ))}
          </Table>

          <form
            className="admin-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(
                `/${detail.id}/transitions`,
                {
                  name: trName,
                  fromStatusId: trFrom === '' ? null : trFrom,
                  toStatusId: trTo,
                },
                `เพิ่มปุ่ม "${trName}" แล้ว`,
              ).then((ok) => {
                if (ok) setTrName('');
              });
            }}
          >
            <Field label="เพิ่มปุ่ม" htmlFor="tr-name" hint="ข้อความบนปุ่มที่ผู้ใช้เห็น">
              <Input id="tr-name" value={trName} onChange={setTrName} maxLength={64} />
            </Field>
            <Field label="จากสถานะ" htmlFor="tr-from" hint="ไม่เลือก = ทำได้จากทุกสถานะ">
              <Select
                id="tr-from"
                value={trFrom}
                onChange={setTrFrom}
                placeholder="ทุกสถานะ"
                options={detail.statuses.map((s) => ({ value: s.id, label: s.name }))}
              />
            </Field>
            <Field label="ไปสถานะ" htmlFor="tr-to" required>
              <Select
                id="tr-to"
                value={trTo}
                onChange={setTrTo}
                placeholder="เลือกปลายทาง"
                options={detail.statuses.map((s) => ({ value: s.id, label: s.name }))}
              />
            </Field>
            <Button
              variant="primary"
              type="submit"
              disabled={busy || trName.trim() === '' || trTo === ''}
            >
              เพิ่ม
            </Button>
          </form>

          {/*
            ข้อความนี้เคยเขียนว่า "ยังตั้งกฎจากหน้าจอไม่ได้ ต้องตั้งในฐานข้อมูล"
            ค้างอยู่ต่อไปอีกหลายรอบ **หลังจากที่ปุ่ม "+ เพิ่มกฎ" อยู่เหนือมันแล้ว**
            — หน้าจอบอกผู้ใช้ว่าทำไม่ได้ ทั้งที่ปุ่มทำอยู่ตรงนั้น
          */}
          <p className="admin-empty">
            กฎของแต่ละปุ่มตั้งได้ที่คอลัมน์ &quot;กฎ&quot; ในตารางด้านบน — ใครเห็นปุ่ม
            ต้องกรอกอะไรก่อนกด และให้ทำอะไรต่อหลังกด
          </p>
        </>
      )}
    </div>
  );
}
