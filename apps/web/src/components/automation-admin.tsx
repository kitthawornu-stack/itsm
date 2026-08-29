'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Input,
  LinkButton,
  Select,
  Table,
  Timestamp,
} from '@itsm/ui';

interface Condition {
  field: string;
  op: string;
  value: string;
}
interface Action {
  kind: string;
  value: string;
}
interface Rule {
  id: string;
  name: string;
  trigger: string;
  projectKey: string | null;
  isEnabled: boolean;
  sortOrder: number;
  conditions: Condition[];
  actions: Action[];
  lastRun: { at: string; outcome: string; reason: string | null } | null;
  warnings: string[];
}
interface Vocabulary {
  triggers: string[];
  fields: string[];
  ops: string[];
  actions: string[];
  maxDepth: number;
}
interface Run {
  at: string;
  ruleName: string;
  itemKey: string | null;
  trigger: string;
  actionKind: string;
  actionValue: string;
  outcome: string;
  reason: string | null;
}

/*
  คำไทยของแต่ละค่า — **ตัวเลือกมาจากเซิร์ฟเวอร์ ที่นี่แปลอย่างเดียว**

  ถ้าหน้าจอมีรายการของตัวเอง มันจะไม่ตรงกับเอนจินในวันที่มีคนเพิ่มชนิดใหม่ ·
  ชนิดที่ยังไม่มีคำแปลจึงแสดง **ค่าดิบ** ไม่ใช่หายไปจากรายการ — คำอังกฤษที่
  โผล่มาบนหน้าจอไทยเป็นสัญญาณที่คนเห็น ส่วนตัวเลือกที่หายไปเงียบ ๆ ไม่มีใครเห็น
*/
const TRIGGER_TH: Record<string, string> = {
  'item.created': 'เมื่อมีคนแจ้งเรื่องใหม่',
  'item.transitioned': 'เมื่อสถานะเปลี่ยน',
  'comment.added': 'เมื่อมีความเห็นใหม่',
  'sla.breached': 'เมื่อเลยกำหนด SLA',
};
const FIELD_TH: Record<string, string> = {
  project: 'โปรเจกต์ (คีย์)',
  type: 'ประเภทงาน',
  status: 'สถานะ',
  category: 'หมวดสถานะ',
  priority: 'ความสำคัญ (1–5)',
  label: 'ป้าย',
  transition: 'ชื่อปุ่มที่กด',
  unassigned: 'ยังไม่มีผู้รับผิดชอบ (true/false)',
};
const OP_TH: Record<string, string> = {
  is: 'เท่ากับ',
  'is-not': 'ไม่เท่ากับ',
  has: 'มีอยู่ในรายการ',
};
const ACTION_TH: Record<string, string> = {
  assign: 'มอบหมายให้ (รหัสผู้ใช้)',
  'add-label': 'ติดป้าย',
  comment: 'เขียนความเห็น',
  transition: 'กดปุ่มเปลี่ยนสถานะ',
};
const OUTCOME_TH: Record<string, string> = {
  applied: 'ทำแล้ว',
  failed: 'ทำไม่ได้',
  skipped: 'ข้าม',
  pending: 'ค้างอยู่',
};

/** แปลถ้ามีคำแปล ไม่มีก็คืนค่าดิบ — ค่าที่หายไปเงียบ ๆ แย่กว่าคำอังกฤษที่โผล่มา */
function th(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

const EMPTY_DRAFT = {
  name: '',
  trigger: '',
  projectKey: '',
  conditions: [] as Condition[],
  actions: [] as Action[],
};

/**
 * ตั้งค่ากฎอัตโนมัติ
 *
 * ## ทำไมกฎที่สร้างใหม่ถึงปิดอยู่เสมอ
 *
 * เซิร์ฟเวอร์บังคับไว้ และหน้าจอบอกเหตุผลให้เห็น — กฎที่เพิ่งพิมพ์เสร็จยังไม่มี
 * ใครอ่านทวน · การเปิดพร้อมสร้างแปลว่ากฎที่พิมพ์ผิดเริ่มแตะตั๋วจริงในวินาที
 * เดียวกับที่พิมพ์ผิด
 *
 * ## ทำไมต้องแสดงกฎที่ทำไม่สำเร็จด้วย
 *
 * "ทำไมกฎไม่ทำงาน" เป็นคำถามที่ผู้ดูแลถามบ่อยกว่าคำถามตรงข้าม · หน้าจอที่
 * แสดงแต่ครั้งที่สำเร็จ ทำให้กฎที่พังดูเหมือนกฎที่ยังไม่เคยถูกปลุก
 */
export function AutomationAdmin({ apiBase }: { apiBase: string }): ReactNode {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [rulesRes, vocabRes, runsRes] = await Promise.all([
        fetch(`${apiBase}/api/v1/automation/rules`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${apiBase}/api/v1/automation/vocabulary`, { credentials: 'include' }),
        fetch(`${apiBase}/api/v1/automation/runs?limit=25`, {
          credentials: 'include',
          cache: 'no-store',
        }),
      ]);
      if (!rulesRes.ok) {
        setError(
          rulesRes.status === 403
            ? 'ต้องเป็นผู้ดูแลระบบจึงจะตั้งกฎอัตโนมัติได้'
            : `โหลดรายการไม่สำเร็จ (HTTP ${String(rulesRes.status)})`,
        );
        setRules([]);
        return;
      }
      setRules((await rulesRes.json()) as Rule[]);
      if (vocabRes.ok) setVocab((await vocabRes.json()) as Vocabulary);
      if (runsRes.ok) setRuns((await runsRes.json()) as Run[]);
      setError(null);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      setRules([]);
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * ส่งคำสั่งแล้วบอกว่าสำเร็จไหม
   *
   * **ต้องคืนค่า ไม่ใช่ void** — ผู้เรียกที่ล้างฟอร์มหลังเรียกต้องรู้ว่า
   * เซิร์ฟเวอร์รับหรือปฏิเสธ · `send()` จับ error ไว้เองทั้งหมด promise จึงสำเร็จ
   * เสมอ และการล้างฟอร์มใน `.then()` จะล้างทิ้งแม้ตอนที่ถูกปฏิเสธ
   * (เจอจริงตอนตรวจในเบราว์เซอร์: กฎที่ถูกปฏิเสธทำให้ผู้ใช้เสียทุกอย่างที่พิมพ์)
   */
  async function send(path: string, init: RequestInit, done: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/automation${path}`, {
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...init,
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok) {
        // ข้อความจากเซิร์ฟเวอร์บอกว่าผิดข้อไหน — ไม่ทับด้วยข้อความรวม ๆ ของตัวเอง
        setError(body.message ?? `ทำไม่สำเร็จ (HTTP ${String(res.status)})`);
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

  function setCondition(i: number, patch: Partial<Condition>): void {
    setDraft((d) => ({
      ...d,
      conditions: d.conditions.map((c, j) => (i === j ? { ...c, ...patch } : c)),
    }));
  }
  function setAction(i: number, patch: Partial<Action>): void {
    setDraft((d) => ({
      ...d,
      actions: d.actions.map((a, j) => (i === j ? { ...a, ...patch } : a)),
    }));
  }

  if (rules === null) return <p className="muted">กำลังโหลด…</p>;

  const triggers = vocab?.triggers ?? [];
  const fields = vocab?.fields ?? [];
  const ops = vocab?.ops ?? [];
  const actionKinds = vocab?.actions ?? [];

  return (
    <>
      {error === null ? null : <Alert tone="error">{error}</Alert>}
      {notice === null ? null : <Alert tone="success">{notice}</Alert>}

      <h2 className="section-title">กฎที่มีอยู่</h2>
      {rules.length === 0 ? (
        <EmptyState
          title="ยังไม่มีกฎอัตโนมัติ"
          body="สร้างกฎข้อแรกด้านล่าง — กฎใหม่จะปิดอยู่จนกว่าจะกดเปิดเอง"
        />
      ) : (
        <Table
          label="กฎอัตโนมัติทั้งหมด"
          columns={['ชื่อกฎ', 'ทำงานเมื่อ', 'แล้วทำอะไร', 'ครั้งล่าสุด', { label: 'สถานะ', width: '180px' }]}
          rowCount={rules.length}
        >
          {rules.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.name}</strong>
                <span className="muted"> · {r.projectKey ?? 'ทุกโปรเจกต์'}</span>
                {r.warnings.map((w) => (
                  <p key={w} className="auto-warn">
                    {w}
                  </p>
                ))}
              </td>
              <td>
                {th(TRIGGER_TH, r.trigger)}
                {r.conditions.map((c, i) => (
                  <p key={`${c.field}-${String(i)}`} className="muted">
                    {th(FIELD_TH, c.field)} {th(OP_TH, c.op)} “{c.value}”
                  </p>
                ))}
              </td>
              <td>
                {r.actions.map((a, i) => (
                  <p key={`${a.kind}-${String(i)}`}>
                    {th(ACTION_TH, a.kind)}: {a.value}
                  </p>
                ))}
              </td>
              <td>
                {/* "ยังไม่เคยทำงาน" ต่างจาก "ทำงานแล้วไม่สำเร็จ" อย่างสิ้นเชิง */}
                {r.lastRun === null ? (
                  <span className="muted">ยังไม่เคยทำงาน</span>
                ) : (
                  <>
                    {th(OUTCOME_TH, r.lastRun.outcome)}
                    {r.lastRun.reason === null ? null : <p className="muted">{r.lastRun.reason}</p>}
                  </>
                )}
              </td>
              <td>
                {/* ช่องติ๊กกับปุ่มลบต้องมีระยะห่าง — ชนกันจนอ่านเป็น "ปิดอยู่ลบ" */}
                <div className="auto-cell-actions">
                <Checkbox
                  checked={r.isEnabled}
                  disabled={busy}
                  label={`${r.isEnabled ? 'ปิด' : 'เปิด'}กฎ ${r.name}`}
                  onChange={(next) => {
                    void send(
                      `/rules/${r.id}/enabled`,
                      { method: 'POST', body: JSON.stringify({ isEnabled: next }) },
                      next ? `เปิดกฎ “${r.name}” แล้ว` : `ปิดกฎ “${r.name}” แล้ว`,
                    );
                  }}
                >
                  {r.isEnabled ? 'เปิดอยู่' : 'ปิดอยู่'}
                </Checkbox>
                <LinkButton
                  tone="danger"
                  disabled={busy}
                  ariaLabel={`ลบกฎ ${r.name}`}
                  onClick={() => {
                    void send(
                      `/rules/${r.id}`,
                      { method: 'DELETE' },
                      `ลบกฎ “${r.name}” แล้ว — ประวัติที่มันเคยทำยังอยู่`,
                    );
                  }}
                >
                  ลบ
                </LinkButton>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="section-title">สร้างกฎใหม่</h2>
      <p className="muted">
        กฎที่สร้างใหม่จะ<strong>ปิดอยู่เสมอ</strong> — อ่านทวนแล้วค่อยกดเปิดเอง ·
        กฎที่ปลุกกันต่อลึกเกิน {vocab?.maxDepth ?? 3} ชั้นจะถูกหยุดเพื่อกันวนไม่จบ
      </p>

      <div className="auto-form">
        <Field label="ชื่อกฎ" htmlFor="rule-name">
          <Input
            id="rule-name"
            value={draft.name}
            maxLength={128}
            onChange={(v) => {
              setDraft((d) => ({ ...d, name: v }));
            }}
          />
        </Field>

        <Field label="ทำงานเมื่อ" htmlFor="rule-trigger">
          <Select
            id="rule-trigger"
            value={draft.trigger}
            options={[
              { value: '', label: 'เลือกเหตุการณ์' },
              ...triggers.map((t) => ({ value: t, label: th(TRIGGER_TH, t) })),
            ]}
            onChange={(v) => {
              setDraft((d) => ({ ...d, trigger: v }));
            }}
          />
        </Field>

        <Field
          label="เฉพาะโปรเจกต์ (คีย์)"
          htmlFor="rule-project"
          hint="เว้นว่าง = ทุกโปรเจกต์ในองค์กร"
        >
          <Input
            id="rule-project"
            value={draft.projectKey}
            onChange={(v) => {
              setDraft((d) => ({ ...d, projectKey: v }));
            }}
          />
        </Field>
      </div>

      <h3 className="section-title">เงื่อนไข</h3>
      {draft.conditions.length === 0 ? (
        <p className="muted">ไม่มีเงื่อนไข — กฎนี้จะทำงานกับทุกเรื่องที่เกิดเหตุการณ์นั้น</p>
      ) : null}
      {draft.conditions.map((c, i) => (
        <div key={`cond-${String(i)}`} className="auto-row">
          <Select
            value={c.field}
            ariaLabel={`ฟิลด์ของเงื่อนไขข้อที่ ${String(i + 1)}`}
            options={fields.map((f) => ({ value: f, label: th(FIELD_TH, f) }))}
            onChange={(v) => {
              setCondition(i, { field: v });
            }}
          />
          <Select
            value={c.op}
            ariaLabel={`การเปรียบเทียบของเงื่อนไขข้อที่ ${String(i + 1)}`}
            options={ops.map((o) => ({ value: o, label: th(OP_TH, o) }))}
            onChange={(v) => {
              setCondition(i, { op: v });
            }}
          />
          <Input
            value={c.value}
            ariaLabel={`ค่าที่เทียบของเงื่อนไขข้อที่ ${String(i + 1)}`}
            onChange={(v) => {
              setCondition(i, { value: v });
            }}
          />
          <LinkButton
            ariaLabel={`เอาเงื่อนไขข้อที่ ${String(i + 1)} ออก`}
            onClick={() => {
              setDraft((d) => ({ ...d, conditions: d.conditions.filter((_, j) => j !== i) }));
            }}
          >
            เอาออก
          </LinkButton>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setDraft((d) => ({
            ...d,
            conditions: [
              ...d.conditions,
              { field: fields[0] ?? '', op: ops[0] ?? '', value: '' },
            ],
          }));
        }}
      >
        เพิ่มเงื่อนไข
      </Button>

      <h3 className="section-title">แล้วทำอะไร</h3>
      {draft.actions.map((a, i) => (
        <div key={`act-${String(i)}`} className="auto-row">
          <Select
            value={a.kind}
            ariaLabel={`ชนิดของการกระทำข้อที่ ${String(i + 1)}`}
            options={actionKinds.map((k) => ({ value: k, label: th(ACTION_TH, k) }))}
            onChange={(v) => {
              setAction(i, { kind: v });
            }}
          />
          <Input
            value={a.value}
            ariaLabel={`ค่าของการกระทำข้อที่ ${String(i + 1)}`}
            onChange={(v) => {
              setAction(i, { value: v });
            }}
          />
          <LinkButton
            ariaLabel={`เอาการกระทำข้อที่ ${String(i + 1)} ออก`}
            onClick={() => {
              setDraft((d) => ({ ...d, actions: d.actions.filter((_, j) => j !== i) }));
            }}
          >
            เอาออก
          </LinkButton>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setDraft((d) => ({
            ...d,
            actions: [...d.actions, { kind: actionKinds[0] ?? '', value: '' }],
          }));
        }}
      >
        เพิ่มการกระทำ
      </Button>

      <div className="auto-submit">
        <Button
          disabled={busy}
          onClick={() => {
            void send(
              '/rules',
              {
                method: 'POST',
                body: JSON.stringify({
                  name: draft.name,
                  trigger: draft.trigger,
                  projectKey: draft.projectKey,
                  conditions: draft.conditions,
                  actions: draft.actions,
                }),
              },
              `สร้างกฎ “${draft.name}” แล้ว — ยังปิดอยู่ กดเปิดเมื่อพร้อม`,
            ).then((ok) => {
              // ล้างฟอร์มเฉพาะเมื่อเซิร์ฟเวอร์รับจริง — ถูกปฏิเสธแล้วยังต้องแก้ต่อได้
              if (ok) setDraft(EMPTY_DRAFT);
            }, undefined);
          }}
        >
          สร้างกฎ
        </Button>
      </div>

      <h2 className="section-title">ระบบทำอะไรไปบ้าง</h2>
      {runs.length === 0 ? (
        <EmptyState
          title="ยังไม่มีประวัติ"
          body="เมื่อกฎที่เปิดอยู่ถูกปลุก ผลของทุกครั้งจะมาอยู่ที่นี่ ทั้งครั้งที่สำเร็จและไม่สำเร็จ"
        />
      ) : (
        <Table
          label="ประวัติการทำงานของกฎอัตโนมัติ 25 ครั้งล่าสุด"
          columns={['เมื่อไร', 'กฎ', 'เรื่อง', 'ทำอะไร', 'ผล']}
          rowCount={runs.length}
        >
          {runs.map((r, i) => (
            <tr key={`${r.at}-${String(i)}`}>
              <td>
                <Timestamp utc={r.at} />
              </td>
              <td>{r.ruleName}</td>
              <td>{r.itemKey === null ? '—' : <a href={`/browse/${r.itemKey}`}>{r.itemKey}</a>}</td>
              <td>
                {th(ACTION_TH, r.actionKind)}: {r.actionValue}
              </td>
              <td>
                {th(OUTCOME_TH, r.outcome)}
                {r.reason === null ? null : <p className="muted">{r.reason}</p>}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
