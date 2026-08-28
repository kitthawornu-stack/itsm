'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Alert, Button, Input, LinkButton, Select } from '@itsm/ui';

export interface SchemeRow {
  id: string;
  name: string;
  grantCount: number;
  projects: string[];
  canBrowse: boolean;
}

/**
 * สร้างและสลับชุดสิทธิ์
 *
 * **อันตรายอยู่ที่การสลับ ไม่ใช่การสร้าง** — โปรเจกต์ที่ถูกสลับไปใช้ชุดที่ไม่มี
 * `BROWSE_PROJECT` จะหายไปจากสายตาทุกคนทันที รวมทั้งคนที่กดเอง และกู้ได้ทาง
 * SQL ทางเดียว · เซิร์ฟเวอร์ปฏิเสธเองอยู่แล้ว หน้าจอทำหน้าที่บอกให้เห็นก่อนกด
 */
export function SchemeAdmin({
  apiBase,
  projectKey,
  currentSchemeId,
  schemes,
}: {
  apiBase: string;
  projectKey: string;
  currentSchemeId: string | null;
  schemes: SchemeRow[];
}): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [copyFrom, setCopyFrom] = useState(currentSchemeId ?? '');

  async function post(path: string, body: unknown, ok: string): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/projects${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as {
        message?: string;
        copiedGrants?: number;
      } | null;
      if (!res.ok) {
        setError(data?.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setNotice(
        data?.copiedGrants === undefined
          ? ok
          : `${ok} · คัดลอกสิทธิ์มา ${data.copiedGrants.toLocaleString('th-TH')} ข้อ`,
      );
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  const target = schemes.find((s) => s.id === pick);

  return (
    <div className="scheme-admin">
      {error === null ? null : <Alert tone="error" inline>{error}</Alert>}
      {notice === null ? null : <Alert tone="success" inline>{notice}</Alert>}

      <div className="admin-add-form">
        <label htmlFor="sch-pick">
          เปลี่ยนไปใช้ชุดสิทธิ์
          <Select
            id="sch-pick"
            value={pick}
            onChange={setPick}
            placeholder="เลือกชุดสิทธิ์"
            options={schemes.map((s) => ({
              value: s.id,
              /*
                บอกไว้ในชื่อเลยว่าชุดไหนใช้ไม่ได้ และชุดไหนใช้ร่วมกับโปรเจกต์อื่น
                — สองอย่างนี้คือสิ่งที่ต้องรู้ก่อนกด ไม่ใช่หลังกด
              */
              label: s.canBrowse
                ? `${s.name}${s.projects.length > 1 ? ` (ใช้ร่วม ${String(s.projects.length)} โปรเจกต์)` : ''}`
                : `${s.name} — ไม่มีใครเปิดดูโปรเจกต์ได้`,
            }))}
          />
        </label>
        {target === undefined || target.canBrowse ? null : (
          <Alert tone="warning" inline>
            ชุดนี้ไม่มีกลุ่มไหนได้สิทธิ์เปิดดูโปรเจกต์ — เลือกแล้วจะสลับไม่ได้
          </Alert>
        )}
        <Button
          variant="primary"
          disabled={busy || pick === '' || pick === currentSchemeId}
          onClick={() => {
            void post(`/${projectKey}/scheme`, { schemeId: pick }, 'สลับชุดสิทธิ์แล้ว');
          }}
        >
          สลับ
        </Button>
      </div>

      {creating ? (
        <form
          className="admin-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            void post('/schemes', { name, copyFromId: copyFrom }, `สร้างชุด "${name}" แล้ว`);
            setName('');
            setCreating(false);
          }}
        >
          <label htmlFor="sch-name">
            ชื่อชุดใหม่
            <Input id="sch-name" value={name} onChange={setName} maxLength={255} />
          </label>
          <label htmlFor="sch-copy">
            คัดลอกสิทธิ์จาก
            <Select
              id="sch-copy"
              value={copyFrom}
              onChange={setCopyFrom}
              placeholder="ไม่คัดลอก (ชุดเปล่า)"
              options={schemes.map((s) => ({ value: s.id, label: s.name }))}
            />
          </label>
          {/* ชุดเปล่าใช้กับโปรเจกต์ไม่ได้จริง — บอกไว้ก่อนกด ไม่ใช่หลังกด */}
          <p className="cfg-implied">
            ชุดเปล่าจะยังผูกเข้าโปรเจกต์ไม่ได้ จนกว่าจะให้สิทธิ์เปิดดูโปรเจกต์กับกลุ่มใดกลุ่มหนึ่ง
          </p>
          <Button variant="primary" type="submit" disabled={busy || name.trim() === ''}>
            สร้าง
          </Button>
        </form>
      ) : (
        <LinkButton
          disabled={busy}
          onClick={() => {
            setCreating(true);
          }}
        >
          + สร้างชุดสิทธิ์ใบใหม่
        </LinkButton>
      )}
    </div>
  );
}
