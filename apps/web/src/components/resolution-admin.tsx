'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Field, Input, LinkButton, Table } from '@itsm/ui';

interface Row {
  id: number;
  name: string;
  isActive: boolean;
  inUse: number;
}

const NAME_MAX = 64;

/**
 * ตั้งค่าผลการแก้ไข
 *
 * **ไม่มีปุ่มลบ** และไม่ใช่เพราะยังไม่ได้ทำ — งานที่ปิดไปแล้วชี้มาที่แถวนี้
 * การลบจะล้างค่าบนงานเหล่านั้นทุกใบพร้อมกัน · หน้าจอจึงบอกจำนวนงานที่ใช้อยู่
 * ให้เห็นก่อน แล้วให้ "เลิกใช้" เป็นทางเดียวที่มี
 */
export function ResolutionAdmin({ apiBase }: { apiBase: string }): ReactNode {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/resolutions`, {
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
      const body = (await res.json()) as { rows: Row[] };
      setRows(body.rows);
      setError(null);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      setRows([]);
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(path: string, body: unknown, done: string): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/resolutions${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setError(d.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setNotice(done);
      await load();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
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
          void send('', { name }, `เพิ่ม "${name}" แล้ว`).then(() => {
            setName('');
          });
        }}
      >
        <Field label="เพิ่มผลการแก้ไข" htmlFor="res-new" hint="เช่น ส่งต่อผู้ผลิต · รอชิ้นส่วน">
          <Input id="res-new" value={name} onChange={setName} maxLength={NAME_MAX} />
        </Field>
        <Button variant="primary" type="submit" disabled={busy || name.trim() === ''}>
          เพิ่ม
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="admin-empty">
          ยังไม่มีผลการแก้ไข — เพิ่มอย่างน้อยหนึ่งรายการก่อน ไม่งั้นปิดงานไม่ได้
        </p>
      ) : (
        <Table
          columns={['ชื่อ', 'ใช้อยู่', 'สถานะ', { label: 'การกระทำ', srOnly: true }]}
          rowCount={rows.length}
        >
          {rows.map((r) => (
            <tr key={r.id} data-inactive={r.isActive ? undefined : 'true'}>
              <td>
                {editing === r.id ? (
                  <form
                    className="admin-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send(`/${String(r.id)}/rename`, { name: draft }, 'เปลี่ยนชื่อแล้ว').then(
                        () => {
                          setEditing(null);
                        },
                      );
                    }}
                  >
                    <Input
                      id={`res-edit-${String(r.id)}`}
                      value={draft}
                      onChange={setDraft}
                      maxLength={NAME_MAX}
                    />
                    <Button variant="primary" type="submit" disabled={busy}>
                      บันทึก
                    </Button>
                    <LinkButton
                      ariaLabel={`ยกเลิกการเปลี่ยนชื่อ ${r.name}`}
                      onClick={() => {
                        setEditing(null);
                      }}
                    >
                      ยกเลิก
                    </LinkButton>
                  </form>
                ) : (
                  r.name
                )}
              </td>
              <td className="admin-when">
                {/* บอกให้เห็นก่อนกดเลิกใช้ ว่าการเปลี่ยนชื่อจะกระทบงานกี่ใบ */}
                {r.inUse === 0 ? '—' : `${String(r.inUse)} เรื่อง`}
              </td>
              <td>{r.isActive ? 'ใช้งานอยู่' : 'เลิกใช้แล้ว'}</td>
              <td className="admin-actions">
                {editing === r.id ? null : (
                  <>
                    {/*
                      ทุกแถวมีปุ่มข้อความเดียวกัน — คนที่ไล่ด้วยคีย์บอร์ดจะได้ยิน
                      "เปลี่ยนชื่อ เปลี่ยนชื่อ เปลี่ยนชื่อ" โดยไม่รู้ว่าอันไหนของอะไร
                    */}
                    <LinkButton
                      ariaLabel={`เปลี่ยนชื่อ ${r.name}`}
                      onClick={() => {
                        setDraft(r.name);
                        setEditing(r.id);
                      }}
                    >
                      เปลี่ยนชื่อ
                    </LinkButton>
                    <LinkButton
                      ariaLabel={r.isActive ? `เลิกใช้ ${r.name}` : `เปิดใช้ ${r.name} อีกครั้ง`}
                      disabled={busy}
                      onClick={() => {
                        void send(
                          `/${String(r.id)}/active`,
                          { isActive: !r.isActive },
                          r.isActive ? `เลิกใช้ "${r.name}" แล้ว` : `เปิดใช้ "${r.name}" อีกครั้ง`,
                        );
                      }}
                    >
                      {r.isActive ? 'เลิกใช้' : 'เปิดใช้อีกครั้ง'}
                    </LinkButton>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <p className="admin-empty">
        เลิกใช้แล้วจะไม่ปรากฏให้เลือกตอนปิดงาน แต่เรื่องที่ปิดไปแล้วยังแสดงค่าเดิมอยู่ —
        ระบบไม่มีการลบ เพราะการลบจะล้างค่าบนเรื่องเก่าทุกใบพร้อมกัน
      </p>
    </div>
  );
}
