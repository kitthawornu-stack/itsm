'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Field, Input, Select } from '@itsm/ui';

interface FieldRow {
  id: string;
  key: string;
  name: string;
  type: string;
  isSystem: boolean;
  options: string[];
  valueCount: number;
  configCount: number;
}

interface ProjectRow {
  id: string;
  key: string;
  name: string;
}

interface TypeRow {
  id: string;
  name: string;
  usedBy: string[];
}

interface ConfigRow {
  key: string;
  name: string;
  isRequired: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  TEXT: 'ข้อความสั้น',
  TEXTAREA: 'ข้อความยาว',
  RICH_TEXT: 'ข้อความมีรูปแบบ',
  NUMBER: 'จำนวนเต็ม',
  DECIMAL: 'ทศนิยม',
  DATE: 'วันที่',
  DATETIME: 'วันที่และเวลา',
  CHECKBOX: 'ใช่/ไม่ใช่',
  SELECT: 'เลือกหนึ่งอย่าง',
  MULTI_SELECT: 'เลือกได้หลายอย่าง',
  USER: 'ผู้ใช้หนึ่งคน',
  MULTI_USER: 'ผู้ใช้หลายคน',
  LABELS: 'ป้ายกำกับ',
  URL: 'ลิงก์',
};
const NEEDS_OPTIONS = new Set(['SELECT', 'MULTI_SELECT']);

/**
 * ฟิลด์เพิ่มเติม
 *
 * **คีย์แก้ทีหลังไม่ได้** — เป็นคีย์ใน `field_snapshot` ของงานทุกใบที่เคยกรอก
 * ฟิลด์นั้น · หน้าจอจึงบอกไว้ที่ช่องกรอก ไม่ใช่ปล่อยให้รู้ตอนที่อยากเปลี่ยนแล้ว
 */
export function FieldAdmin({ apiBase }: { apiBase: string }): ReactNode {
  const [rows, setRows] = useState<FieldRow[] | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [issueTypes, setIssueTypes] = useState<TypeRow[]>([]);
  const [configured, setConfigured] = useState<ConfigRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('TEXT');
  const [options, setOptions] = useState('');

  const [cfgProject, setCfgProject] = useState('');
  const [cfgType, setCfgType] = useState('');
  const [cfgField, setCfgField] = useState('');
  const [cfgRequired, setCfgRequired] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const get = async (p: string): Promise<Response> =>
      fetch(`${apiBase}/api/v1/admin/${p}`, { credentials: 'include', cache: 'no-store' });
    const [f, p, t] = await Promise.all([get('fields'), get('projects'), get('issue-types')]);
    if (!f.ok) {
      setError(
        f.status === 403
          ? 'ต้องเป็นผู้ดูแลระบบจึงจะตั้งค่าส่วนนี้ได้'
          : `โหลดรายการไม่สำเร็จ (HTTP ${String(f.status)})`,
      );
      setRows([]);
      return;
    }
    const body = (await f.json()) as { rows: FieldRow[]; types: string[] };
    setRows(body.rows);
    setTypes(body.types);
    if (p.ok) setProjects(((await p.json()) as { rows: ProjectRow[] }).rows);
    if (t.ok) setIssueTypes(((await t.json()) as { rows: TypeRow[] }).rows);
  }, [apiBase]);

  const loadConfig = useCallback(async (): Promise<void> => {
    if (cfgProject === '' || cfgType === '') {
      setConfigured([]);
      return;
    }
    const res = await fetch(
      `${apiBase}/api/v1/admin/fields/config?projectId=${cfgProject}&issueTypeId=${cfgType}`,
      { credentials: 'include', cache: 'no-store' },
    );
    if (!res.ok) return;
    setConfigured(((await res.json()) as { rows: ConfigRow[] }).rows);
  }, [apiBase, cfgProject, cfgType]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  async function send(path: string, body: unknown, done: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/fields${path}`, {
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
      await Promise.all([load(), loadConfig()]);
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (rows === null) return <p className="admin-empty">กำลังโหลด…</p>;
  const parsedOptions = options
    .split('\n')
    .map((o) => o.trim())
    .filter((o) => o !== '');

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
          void send('', { key, name, type, options: parsedOptions }, `สร้างฟิลด์ "${name}" แล้ว`).then(
            (ok) => {
              if (ok) {
                setKey('');
                setName('');
                setOptions('');
              }
            },
          );
        }}
      >
        <Field
          label="คีย์"
          htmlFor="fd-key"
          hint="a–z, 0–9 และ _ · แก้ทีหลังไม่ได้ เพราะเป็นคีย์ในข้อมูลของงานทุกใบที่กรอกฟิลด์นี้"
          required
        >
          <Input id="fd-key" value={key} onChange={setKey} maxLength={64} />
        </Field>
        <Field label="ชื่อที่ผู้ใช้เห็น" htmlFor="fd-name" required>
          <Input id="fd-name" value={name} onChange={setName} maxLength={255} />
        </Field>
        <Field label="ชนิด" htmlFor="fd-type">
          <Select
            id="fd-type"
            value={type}
            onChange={setType}
            options={types.map((t) => ({ value: t, label: TYPE_LABEL[t] ?? t }))}
          />
        </Field>
        <Button
          variant="primary"
          type="submit"
          disabled={
            busy ||
            key.trim() === '' ||
            name.trim() === '' ||
            (NEEDS_OPTIONS.has(type) && parsedOptions.length < 2)
          }
        >
          สร้าง
        </Button>
      </form>

      {NEEDS_OPTIONS.has(type) ? (
        <Field
          label="ตัวเลือก"
          htmlFor="fd-options"
          hint="บรรทัดละหนึ่งตัวเลือก · ต้องมีอย่างน้อยสองรายการ ไม่งั้นเป็นช่องที่เลือกอะไรไม่ได้"
          required
        >
          <textarea
            id="fd-options"
            className="ui-textarea"
            value={options}
            rows={4}
            onChange={(e) => {
              setOptions(e.target.value);
            }}
          />
        </Field>
      ) : null}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">ชื่อ</th>
              <th scope="col">คีย์</th>
              <th scope="col">ชนิด</th>
              <th scope="col">ตัวเลือก</th>
              <th scope="col">ค่าที่กรอกไว้</th>
              <th scope="col">ใช้อยู่</th>
              <th scope="col">
                <span className="ui-sr-only">การกระทำ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} data-inactive={f.configCount === 0 ? 'true' : undefined}>
                <td>{f.name}</td>
                <td className="admin-when">{f.key}</td>
                <td>{TYPE_LABEL[f.type] ?? f.type}</td>
                <td>{f.options.length === 0 ? '—' : f.options.join(' · ')}</td>
                <td className="admin-when">{f.valueCount.toLocaleString('th-TH')}</td>
                <td className="admin-when">
                  {/* ฟิลด์ที่ไม่ได้ตั้งใช้ที่ไหนเลย ไม่มีใครเห็นและไม่มีใครกรอก */}
                  {f.configCount === 0 ? 'ยังไม่ได้ตั้งใช้' : `${String(f.configCount)} ที่`}
                </td>
                <td className="admin-actions">
                  {f.isSystem ? null : (
                    <button
                      type="button"
                      className="admin-linkish"
                      disabled={busy}
                      onClick={() => {
                        void send(`/${f.id}/remove`, {}, `ลบฟิลด์ "${f.name}" แล้ว`);
                      }}
                    >
                      ลบ
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="cfg-title">ตั้งว่าโปรเจกต์ไหนถามฟิลด์อะไร</h2>
      <div className="admin-add-form">
        <Field label="โปรเจกต์" htmlFor="cf-project">
          <Select
            id="cf-project"
            value={cfgProject}
            onChange={setCfgProject}
            placeholder="เลือกโปรเจกต์"
            options={projects.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))}
          />
        </Field>
        <Field label="ประเภทงาน" htmlFor="cf-type">
          <Select
            id="cf-type"
            value={cfgType}
            onChange={setCfgType}
            placeholder="เลือกประเภทงาน"
            options={issueTypes.map((t) => ({ value: t.id, label: t.name }))}
          />
        </Field>
      </div>

      {cfgProject === '' || cfgType === '' ? (
        <p className="admin-empty">เลือกโปรเจกต์และประเภทงานเพื่อดูว่าฟอร์มถามอะไรอยู่</p>
      ) : (
        <>
          <p className="admin-empty">
            ตอนนี้ถาม:{' '}
            {configured.length === 0
              ? 'ยังไม่ถามฟิลด์เพิ่มเติมเลย'
              : configured.map((c) => `${c.name}${c.isRequired ? ' (จำเป็น)' : ''}`).join(' · ')}
          </p>

          <form
            className="admin-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = rows.find((r) => r.id === cfgField);
              void send(
                `/${cfgField}/config`,
                {
                  projectId: cfgProject,
                  issueTypeId: cfgType,
                  isRequired: cfgRequired,
                  isVisible: true,
                },
                `ตั้งให้ถาม "${f?.name ?? ''}" แล้ว`,
              );
            }}
          >
            <Field label="เพิ่มฟิลด์เข้าฟอร์มนี้" htmlFor="cf-field">
              <Select
                id="cf-field"
                value={cfgField}
                onChange={setCfgField}
                placeholder="เลือกฟิลด์"
                options={rows.map((f) => ({ value: f.id, label: f.name }))}
              />
            </Field>
            <label className="grid-check">
              <input
                type="checkbox"
                checked={cfgRequired}
                onChange={() => {
                  setCfgRequired((v) => !v);
                }}
              />
              บังคับกรอก
            </label>
            <Button variant="primary" type="submit" disabled={busy || cfgField === ''}>
              ตั้งใช้
            </Button>
            <button
              type="button"
              className="admin-linkish"
              disabled={busy || cfgField === ''}
              onClick={() => {
                const f = rows.find((r) => r.id === cfgField);
                void send(
                  `/${cfgField}/config`,
                  { projectId: cfgProject, issueTypeId: cfgType, remove: true },
                  `เลิกถาม "${f?.name ?? ''}" แล้ว`,
                );
              }}
            >
              เลิกถามฟิลด์นี้
            </button>
          </form>

          <p className="admin-empty">
            เลิกถามไม่ลบค่าที่กรอกไว้แล้ว — ค่ายังอยู่ในฐานข้อมูลและจะกลับมาแสดงถ้าตั้งใช้ใหม่
          </p>
        </>
      )}
    </div>
  );
}
