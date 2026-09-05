'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Button,
  Field,
  Input,
  IssueTypeIcon,
  LinkButton,
  Select,
  Table,
  type IssueTypeIconName,
} from '@itsm/ui';

interface TypeRow {
  id: string;
  name: string;
  icon: IssueTypeIconName;
  isSubtask: boolean;
  itemCount: number;
  usedBy: string[];
}

/**
 * ตัวเลือกไอคอน **มาจาก API** ไม่ใช่รายการที่พิมพ์ไว้ที่นี่
 *
 * คำศัพท์อยู่ที่ `@itsm/types` ซึ่ง `apps/web` ไม่ได้พึ่ง · เขียนรายการเองที่นี่
 * จะกลายเป็นที่ที่สามที่ต้องแก้ตามทุกครั้ง และที่ที่ลืมแก้จะเงียบ
 */
interface IconOption {
  key: IssueTypeIconName;
  label: string;
}

interface ProjectRow {
  id: string;
  key: string;
  name: string;
}

interface WorkflowRow {
  id: string;
  name: string;
  statusCount: number;
}

/**
 * ประเภทงาน และการผูกเข้ากับโปรเจกต์
 *
 * ประเภทงานที่ไม่ได้ผูกกับโปรเจกต์ไหนเลยไม่มีความหมาย — สร้างแล้วไม่มีใครเลือกได้
 * หน้าจอจึงให้ผูกได้จากที่เดียวกับที่สร้าง
 *
 * ⚠️ ไม่ถาม `iconKey` และ `hierarchyLevel` — สองอย่างนี้มีในสคีมาแต่ยังไม่มี
 * อะไรเรนเดอร์หรืออ่านเลย · ถามค่าที่ตั้งแล้วไม่มีผล คือการสร้างความเชื่อผิด
 */
export function IssueTypeAdmin({ apiBase }: { apiBase: string }): ReactNode {
  const [rows, setRows] = useState<TypeRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [icons, setIcons] = useState<IconOption[]>([]);
  const [name, setName] = useState('');
  const [newIcon, setNewIcon] = useState<string>('generic');
  const [bindType, setBindType] = useState('');
  const [bindProject, setBindProject] = useState('');
  const [bindWorkflow, setBindWorkflow] = useState('');

  const load = useCallback(async (): Promise<void> => {
    const get = async (path: string): Promise<Response> =>
      fetch(`${apiBase}/api/v1/admin/${path}`, { credentials: 'include', cache: 'no-store' });
    const [t, p, w] = await Promise.all([get('issue-types'), get('projects'), get('workflows')]);
    if (!t.ok) {
      setError(
        t.status === 403
          ? 'ต้องเป็นผู้ดูแลระบบจึงจะตั้งค่าส่วนนี้ได้'
          : `โหลดรายการไม่สำเร็จ (HTTP ${String(t.status)})`,
      );
      setRows([]);
      return;
    }
    const payload = (await t.json()) as { rows: TypeRow[]; icons?: IconOption[] };
    setRows(payload.rows);
    setIcons(payload.icons ?? []);
    if (p.ok) setProjects(((await p.json()) as { rows: ProjectRow[] }).rows);
    if (w.ok) setWorkflows(((await w.json()) as { rows: WorkflowRow[] }).rows);
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(path: string, body: unknown, done: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/issue-types${path}`, {
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
      await load();
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
          void send('', { name, icon: newIcon }, `เพิ่ม "${name}" แล้ว`).then((ok) => {
            if (ok) setName('');
          });
        }}
      >
        <Field
          label="เพิ่มประเภทงาน"
          htmlFor="it-name"
          hint="เช่น คำขอบริการ · แจ้งปัญหา · ขออนุมัติ"
        >
          <Input id="it-name" value={name} onChange={setName} maxLength={64} />
        </Field>
        <Field label="ไอคอน" htmlFor="it-icon">
          <Select
            id="it-icon"
            value={newIcon}
            onChange={setNewIcon}
            options={icons.map((i) => ({ value: i.key, label: i.label }))}
          />
        </Field>
        <Button variant="primary" type="submit" disabled={busy || name.trim() === ''}>
          เพิ่ม
        </Button>
      </form>

      <Table
        columns={[
          'ชื่อ',
          'ไอคอน',
          'งานที่เป็นประเภทนี้',
          'ใช้ในโปรเจกต์',
          { label: 'การกระทำ', srOnly: true },
        ]}
        rowCount={rows.length}
      >
        {rows.map((t) => (
          <tr key={t.id} data-inactive={t.usedBy.length === 0 ? 'true' : undefined}>
            <td>
              <IssueTypeIcon name={t.icon} ariaLabel={`ไอคอนของ ${t.name}`} /> {t.name}
            </td>
            <td>
              {/*
                เปลี่ยนได้ทันทีจากตาราง ไม่ต้องเข้าหน้าย่อย · ประเภทงานที่มีอยู่
                ทั้งหมดถือค่าที่ตั้งไว้ตอน seed หรือ `generic` ถ้าตั้งได้แต่ตอนสร้าง
                ผู้ดูแลจะแก้ของเดิมไม่ได้เลย และลบทิ้งสร้างใหม่ก็ทำไม่ได้ถ้ามีงานผูกอยู่
              */}
              <Select
                id={`it-icon-${t.id}`}
                ariaLabel={`ไอคอนของ ${t.name}`}
                value={t.icon}
                onChange={(v) => {
                  void send(`/${t.id}/icon`, { icon: v }, `เปลี่ยนไอคอนของ "${t.name}" แล้ว`);
                }}
                options={icons.map((i) => ({ value: i.key, label: i.label }))}
              />
            </td>
            <td className="admin-when">{t.itemCount.toLocaleString('th-TH')}</td>
            <td>
              {/*
        ประเภทที่ไม่ได้ผูกกับโปรเจกต์ไหนเลย ไม่มีใครเลือกได้
        ต้องอ่านออกจากตาราง ไม่ใช่ต้องไปลองแล้วหาไม่เจอ
        */}
              {t.usedBy.length === 0 ? 'ยังไม่ได้ผูกกับโปรเจกต์ไหน' : t.usedBy.join(' · ')}
            </td>
            <td className="admin-actions">
              <LinkButton
                ariaLabel={`ลบประเภทงาน ${t.name}`}
                tone="danger"
                disabled={busy}
                onClick={() => {
                  void send(`/${t.id}/remove`, {}, `ลบ "${t.name}" แล้ว`);
                }}
              >
                ลบ
              </LinkButton>
            </td>
          </tr>
        ))}
      </Table>

      <h2 className="cfg-title">ผูกประเภทงานเข้ากับโปรเจกต์</h2>
      <form
        className="admin-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          const t = rows.find((r) => r.id === bindType);
          void send(
            `/${bindType}/bind`,
            { projectId: bindProject, workflowId: bindWorkflow },
            `ผูก "${t?.name ?? ''}" แล้ว`,
          );
        }}
      >
        <Field label="ประเภทงาน" htmlFor="bd-type">
          <Select
            id="bd-type"
            value={bindType}
            onChange={setBindType}
            placeholder="เลือกประเภทงาน"
            options={rows.map((t) => ({ value: t.id, label: t.name }))}
          />
        </Field>
        <Field label="โปรเจกต์" htmlFor="bd-project">
          <Select
            id="bd-project"
            value={bindProject}
            onChange={setBindProject}
            placeholder="เลือกโปรเจกต์"
            options={projects.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))}
          />
        </Field>
        <Field
          label="ใช้ workflow"
          htmlFor="bd-workflow"
          hint="ผูกซ้ำด้วย workflow อื่น = เปลี่ยน workflow ของประเภทนั้นในโปรเจกต์นั้น"
        >
          <Select
            id="bd-workflow"
            value={bindWorkflow}
            onChange={setBindWorkflow}
            placeholder="เลือก workflow"
            options={workflows.map((w) => ({
              value: w.id,
              label: `${w.name} (${String(w.statusCount)} สถานะ)`,
            }))}
          />
        </Field>
        <Button
          variant="primary"
          type="submit"
          disabled={busy || bindType === '' || bindProject === '' || bindWorkflow === ''}
        >
          ผูก
        </Button>
      </form>

      <div className="admin-btn-row">
        <LinkButton
          disabled={busy || bindType === '' || bindProject === ''}
          onClick={() => {
            const t = rows.find((r) => r.id === bindType);
            void send(
              `/${bindType}/bind`,
              { projectId: bindProject, unbind: true },
              `ถอน "${t?.name ?? ''}" ออกแล้ว`,
            );
          }}
        >
          ถอนประเภทงานที่เลือกออกจากโปรเจกต์ที่เลือก
        </LinkButton>
      </div>

      <p className="admin-empty">
        ถอนไม่ได้ถ้ายังมีงานประเภทนั้นอยู่ในโปรเจกต์ — งานเหล่านั้นจะหา workflow ไม่เจอ
        และกดเปลี่ยนสถานะไม่ได้อีกเลย
      </p>
    </div>
  );
}
