'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Field, Input, Select } from '@itsm/ui';

interface Options {
  schemes: Array<{ id: string; name: string; usedBy: string[] }>;
  workflows: Array<{ id: string; name: string; statusCount: number; hasInitial: boolean }>;
  issueTypes: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
}

const TYPES = [
  { value: 'SERVICE_DESK', label: 'ศูนย์บริการ' },
  { value: 'SOFTWARE', label: 'พัฒนาซอฟต์แวร์' },
  { value: 'BUSINESS', label: 'งานทั่วไป' },
];

/**
 * สร้างโปรเจกต์
 *
 * ทุกช่องเป็นการ **เลือกของที่มีอยู่** ไม่ใช่สร้างของใหม่ — ยังไม่มีตัวสร้าง
 * workflow หรือชุดสิทธิ์จากหน้าจอ · การซ่อนข้อจำกัดนี้ไว้แล้วให้คนค้นพบเอง
 * ตอนหาปุ่มไม่เจอ แย่กว่าการบอกตรง ๆ
 */
export function ProjectCreate({ apiBase }: { apiBase: string }): ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [opt, setOpt] = useState<Options | null>(null);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('SERVICE_DESK');
  const [schemeId, setSchemeId] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [issueTypeIds, setIssueTypeIds] = useState<string[]>([]);
  const [notifyGroupId, setNotifyGroupId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const res = await fetch(`${apiBase}/api/v1/admin/projects/new/options`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) {
      setError(`โหลดตัวเลือกไม่สำเร็จ (HTTP ${String(res.status)})`);
      return;
    }
    setOpt((await res.json()) as Options);
  }, [apiBase]);

  useEffect(() => {
    if (open && opt === null) void load();
  }, [open, opt, load]);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/projects`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key,
          name,
          type,
          permissionSchemeId: schemeId,
          workflowId,
          issueTypeIds,
          notifyGroupId: notifyGroupId === '' ? null : notifyGroupId,
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setError(d.message ?? `สร้างไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="primary"
        onClick={() => {
          setOpen(true);
        }}
      >
        สร้างโปรเจกต์
      </Button>
    );
  }

  const chosenWorkflow = opt?.workflows.find((w) => w.id === workflowId);
  const chosenScheme = opt?.schemes.find((s) => s.id === schemeId);
  const ready =
    key.trim() !== '' && name.trim() !== '' && schemeId !== '' && workflowId !== '' && issueTypeIds.length > 0;

  return (
    <form
      className="admin"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error === null ? null : (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}

      <div className="admin-add-form">
        <Field
          label="คีย์"
          htmlFor="np-key"
          hint="A–Z และ 0–9 · ขึ้นต้นด้วยตัวอักษร · แก้ทีหลังไม่ได้ เพราะฝังอยู่ในเลขที่เรื่องทุกใบ"
          required
        >
          <Input id="np-key" value={key} onChange={setKey} maxLength={10} />
        </Field>
        <Field label="ชื่อโปรเจกต์" htmlFor="np-name" required>
          <Input id="np-name" value={name} onChange={setName} maxLength={255} />
        </Field>
        <Field label="ประเภท" htmlFor="np-type">
          <Select id="np-type" value={type} onChange={setType} options={TYPES} />
        </Field>
      </div>

      {opt === null ? (
        <p className="admin-empty">กำลังโหลดตัวเลือก…</p>
      ) : (
        <>
          <div className="admin-add-form">
            <Field
              label="ชุดสิทธิ์"
              htmlFor="np-scheme"
              hint="ยังสร้างชุดใหม่จากหน้าจอไม่ได้ — เลือกจากที่มีอยู่"
              required
            >
              <Select
                id="np-scheme"
                value={schemeId}
                onChange={setSchemeId}
                placeholder="เลือกชุดสิทธิ์"
                options={opt.schemes.map((s) => ({ value: s.id, label: s.name }))}
              />
            </Field>
            <Field
              label="workflow"
              htmlFor="np-workflow"
              hint="ยังสร้าง workflow ใหม่จากหน้าจอไม่ได้ — เลือกจากที่มีอยู่"
              required
            >
              <Select
                id="np-workflow"
                value={workflowId}
                onChange={setWorkflowId}
                placeholder="เลือก workflow"
                options={opt.workflows.map((w) => ({
                  value: w.id,
                  label: `${w.name} (${String(w.statusCount)} สถานะ)`,
                }))}
              />
            </Field>
            <Field label="กลุ่มรับแจ้งเตือน" htmlFor="np-notify" hint="ไม่เลือก = แจ้งเตือนระดับทีมจะไปไม่ถึงใคร">
              <Select
                id="np-notify"
                value={notifyGroupId}
                onChange={setNotifyGroupId}
                placeholder="ยังไม่ตั้ง"
                options={opt.groups.map((g) => ({ value: g.id, label: g.name }))}
              />
            </Field>
          </div>

          {/*
            บอกผลของตัวเลือกทันทีที่เลือก ไม่ใช่หลังกดสร้าง
            — ทั้งสองข้อนี้ทำให้โปรเจกต์ใช้งานไม่ได้จริง
          */}
          {chosenWorkflow !== undefined && !chosenWorkflow.hasInitial ? (
            <p className="admin-error" role="alert">
              workflow นี้ไม่มีสถานะเริ่มต้น — แจ้งเรื่องใหม่ในโปรเจกต์นี้จะล้มเหลว
            </p>
          ) : null}
          {chosenScheme !== undefined && chosenScheme.usedBy.length > 0 ? (
            <p className="admin-empty">
              ชุดสิทธิ์นี้ใช้อยู่ใน {chosenScheme.usedBy.join(' · ')} แล้ว —
              การแก้สิทธิ์ทีหลังจะกระทบทั้งหมดพร้อมกัน
            </p>
          ) : null}

          <fieldset className="np-types">
            <legend>ประเภทงานที่ใช้ในโปรเจกต์นี้</legend>
            {opt.issueTypes.map((t) => (
              <label key={t.id} className="grid-check">
                <input
                  type="checkbox"
                  checked={issueTypeIds.includes(t.id)}
                  onChange={() => {
                    setIssueTypeIds((prev) =>
                      prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                    );
                  }}
                />
                {t.name}
              </label>
            ))}
          </fieldset>

          <div className="admin-btn-row">
            <Button variant="primary" type="submit" disabled={busy || !ready}>
              {busy ? 'กำลังสร้าง…' : 'สร้างโปรเจกต์'}
            </Button>
            <button
              type="button"
              className="admin-linkish"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              ยกเลิก
            </button>
          </div>
        </>
      )}
    </form>
  );
}
