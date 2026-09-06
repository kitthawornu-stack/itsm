'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { Alert, Button, Field, Input, LinkButton } from '@itsm/ui';

export interface QuickFilterItem {
  id: string;
  name: string;
  hql: string;
}

/**
 * สร้างและลบตัวกรองด่วนของกระดาน
 *
 * ตาราง service และ endpoint ครบมานาน **แต่ไม่มีปุ่มไหนในเว็บเรียกมันเลย** —
 * ตั้งได้ทาง API เท่านั้น · เป็นรูปแบบเดียวกับไฟล์แนบที่ API ครบทั้งแนบ
 * รายการ ดาวน์โหลด แต่คนแจ้งปัญหาส่งภาพหน้าจอไม่ได้จริง ๆ อยู่หลายเดือน
 *
 * **อยู่ที่เดียวกับที่ใช้งาน** ไม่ใช่ในหน้าตั้งค่าแยก — คนที่รู้ว่าอยากกรอง
 * อะไร คือคนที่กำลังมองกระดานอยู่ตอนนั้น
 *
 * แสดงเฉพาะคนที่มีสิทธิ์จัดการโปรเจกต์ · เซิร์ฟเวอร์ปฏิเสธเองอยู่แล้ว
 * แต่ปุ่มที่กดแล้วได้ 403 คือหน้าจอที่หลอกคน
 */
export function QuickFilterAdmin({
  apiBase,
  projectKey,
  filters,
}: {
  apiBase: string;
  projectKey: string;
  filters: readonly QuickFilterItem[];
}): ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [hql, setHql] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `${apiBase}/api/v1/boards/${encodeURIComponent(projectKey)}/quick-filters`;

  /**
   * **คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void`**
   *
   * ตัวช่วยที่กลืน error ไว้เองทำให้ promise สำเร็จเสมอ แล้วผู้เรียกจะล้าง
   * ฟอร์มทั้งตอนที่ถูกปฏิเสธ · ตัวกรองที่พิมพ์ผิดหนึ่งตัวอักษรแล้วเสีย HQL
   * ที่พิมพ์มาทั้งบรรทัด คือสิ่งที่บทเรียนใน CLAUDE.md เตือนไว้ตรง ๆ
   */
  async function send(path: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(d?.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="qf-admin">
      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}

      {!open ? (
        <LinkButton
          onClick={() => {
            setOpen(true);
          }}
        >
          จัดการตัวกรองด่วน
        </LinkButton>
      ) : (
        <div className="qf-admin-body">
          <ul className="qf-admin-list">
            {filters.length === 0 ? (
              <li className="admin-empty">ยังไม่มีตัวกรองด่วนในโปรเจกต์นี้</li>
            ) : (
              filters.map((f) => (
                <li key={f.id}>
                  <span className="qf-admin-name">{f.name}</span>
                  <code className="qf-admin-hql">{f.hql}</code>
                  <LinkButton
                    ariaLabel={`ลบตัวกรอง ${f.name}`}
                    tone="danger"
                    disabled={busy}
                    onClick={() => {
                      void send(`/${f.id}/delete`);
                    }}
                  >
                    ลบ
                  </LinkButton>
                </li>
              ))
            )}
          </ul>

          <Field label="ชื่อตัวกรอง" htmlFor="qf-name" required hint="เช่น ของฉัน · ด่วนมาก">
            <Input id="qf-name" value={name} onChange={setName} maxLength={40} />
          </Field>
          {/*
            ตัวอย่างในคำใบ้ต้อง **ใช้ได้จริง** · รอบแรกเขียนว่า
            `priority = "P1 Critical"` (priority รับอันดับเป็นตัวเลข) รอบสองเขียน
            `priority <= 2` (ภาษานี้มีแค่ `=` `!=` `~` `IN` `IS EMPTY`) — ทั้งสองรอบ
            ถูกปฏิเสธตอนบันทึก · คำใบ้ที่พาไปสู่ error แย่กว่าไม่มีคำใบ้
            · ตัวอย่างในนี้ถูกกดจริงในเบราว์เซอร์แล้วทุกอัน
          */}
          <Field
            label="เงื่อนไข HQL"
            htmlFor="qf-hql"
            required
            hint='เช่น resolved IS EMPTY · priority = 1 · assignee IS EMPTY'
          >
            <Input id="qf-hql" value={hql} onChange={setHql} maxLength={500} />
          </Field>
          <div className="admin-btn-row">
            <Button
              variant="primary"
              disabled={busy || name.trim() === '' || hql.trim() === ''}
              onClick={() => {
                /* ล้างฟอร์มเฉพาะตอนเซิร์ฟเวอร์รับแล้ว ไม่ใช่ตอนเรียกฟังก์ชันเสร็จ */
                void send('', { name, hql }).then((ok) => {
                  if (ok) {
                    setName('');
                    setHql('');
                  }
                });
              }}
            >
              เพิ่มตัวกรอง
            </Button>
            <LinkButton
              disabled={busy}
              onClick={() => {
                setOpen(false);
              }}
            >
              ปิด
            </LinkButton>
          </div>
        </div>
      )}
    </div>
  );
}
