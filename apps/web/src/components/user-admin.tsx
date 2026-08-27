'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Field, Input, Select, Table, Timestamp } from '@itsm/ui';

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  hasPassword: boolean;
  groups: string[];
  lastLoginAt: string | null;
}

interface GroupRow {
  id: string;
  name: string;
  memberCount: number;
}

const PASSWORD_MIN = 12;

/**
 * หน้าจัดการผู้ใช้
 *
 * ปุ่มที่นี่เป็นการกระทำที่ย้อนกลับยาก (ตั้งรหัสผ่านให้คนอื่น · ปิดบัญชี)
 * จึงถามยืนยันก่อนทุกครั้ง และบอกผลที่ตามมาให้ครบ — โดยเฉพาะจำนวนเซสชัน
 * ที่จะถูกตัด ซึ่งแปลว่าคนนั้นจะหลุดออกจากระบบทันที
 */
export function UserAdmin({ apiBase }: { apiBase: string }): ReactNode {
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [groupId, setGroupId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [u, g] = await Promise.all([
        fetch(`${apiBase}/api/v1/admin/users`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${apiBase}/api/v1/admin/users/groups`, {
          credentials: 'include',
          cache: 'no-store',
        }),
      ]);
      if (!u.ok) {
        setError(
          u.status === 403
            ? 'หน้านี้สำหรับผู้ดูแลระบบเท่านั้น'
            : `โหลดรายชื่อผู้ใช้ไม่ได้ (HTTP ${String(u.status)})`,
        );
        setRows([]);
        return;
      }
      setRows(((await u.json()) as { rows: UserRow[] }).rows);
      if (g.ok) setGroups(((await g.json()) as { rows: GroupRow[] }).rows);
      setError(null);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      setRows([]);
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(path: string, body: unknown): Promise<{ ok: boolean; data: unknown }> {
    const res = await fetch(`${apiBase}/api/v1/admin/users${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  }

  async function addUser(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { ok, data } = await post('', {
        email,
        displayName,
        password,
        groupIds: groupId === '' ? [] : [groupId],
      });
      if (!ok) {
        setError((data as { message?: string }).message ?? 'เพิ่มผู้ใช้ไม่สำเร็จ');
        return;
      }
      setNotice(`เพิ่ม ${email} แล้ว — แจ้งรหัสผ่านให้เจ้าตัวและให้เปลี่ยนเมื่อเข้าใช้ครั้งแรก`);
      setEmail('');
      setDisplayName('');
      setPassword('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(u: UserRow): Promise<void> {
    const verb = u.isActive ? 'ปิดบัญชี' : 'เปิดบัญชี';
    const warn = u.isActive ? '\n\nเจ้าตัวจะหลุดออกจากระบบทันที' : '';
    if (!window.confirm(`${verb} ${u.email} ?${warn}`)) return;
    const { ok, data } = await post(`/${u.id}/active`, { isActive: !u.isActive });
    if (!ok) {
      setError((data as { message?: string }).message ?? `${verb}ไม่สำเร็จ`);
      return;
    }
    const revoked = (data as { revokedSessions?: number }).revokedSessions ?? 0;
    setNotice(`${verb} ${u.email} แล้ว${revoked > 0 ? ` · ตัด ${String(revoked)} เซสชัน` : ''}`);
    await load();
  }

  async function resetPassword(u: UserRow): Promise<void> {
    const pw = window.prompt(
      `ตั้งรหัสผ่านใหม่ให้ ${u.email}\n\nอย่างน้อย ${String(PASSWORD_MIN)} ตัวอักษร` +
        '\nเจ้าตัวจะหลุดออกจากระบบทุกเครื่องทันที',
    );
    if (pw === null || pw === '') return;
    const { ok, data } = await post(`/${u.id}/password`, { password: pw });
    if (!ok) {
      setError((data as { message?: string }).message ?? 'ตั้งรหัสผ่านไม่สำเร็จ');
      return;
    }
    const revoked = (data as { revokedSessions?: number }).revokedSessions ?? 0;
    setNotice(`ตั้งรหัสผ่านใหม่ให้ ${u.email} แล้ว · ตัด ${String(revoked)} เซสชัน`);
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

      {rows.length === 0 && error !== null ? null : (
        <>
          <section className="admin-add">
            <h2 className="detail-section-title">เพิ่มผู้ใช้</h2>
            <form
              className="admin-add-form"
              onSubmit={(e) => {
                e.preventDefault();
                void addUser();
              }}
            >
              <Field label="อีเมล" htmlFor="ad-email" required>
                <Input
                  id="ad-email"
                  value={email}
                  onChange={setEmail}
                  placeholder="ชื่อ@บริษัท.co.th"
                />
              </Field>
              <Field label="ชื่อที่แสดง" htmlFor="ad-name">
                <Input id="ad-name" value={displayName} onChange={setDisplayName} />
              </Field>
              <Field
                label="รหัสผ่านตั้งต้น"
                htmlFor="ad-pw"
                required
                hint={`อย่างน้อย ${String(PASSWORD_MIN)} ตัวอักษร`}
              >
                <Input id="ad-pw" value={password} onChange={setPassword} />
              </Field>
              <Field label="กลุ่ม" htmlFor="ad-group" hint="กำหนดสิทธิ์ที่ได้">
                <Select
                  id="ad-group"
                  value={groupId}
                  onChange={setGroupId}
                  options={groups.map((g) => ({
                    value: g.id,
                    label: `${g.name} (${String(g.memberCount)})`,
                  }))}
                  placeholder="ยังไม่ระบุ"
                />
              </Field>
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? 'กำลังเพิ่ม…' : 'เพิ่มผู้ใช้'}
              </Button>
            </form>
          </section>

          <h2 className="detail-section-title detail-section-gap">
            ผู้ใช้ทั้งหมด {rows.length} คน
          </h2>
          <Table
            columns={['อีเมล', 'ชื่อ', 'กลุ่ม', 'เข้าใช้ล่าสุด', 'สถานะ', 'จัดการ']}
            rowCount={rows.length}
          >
            {rows.map((u) => (
              <tr key={u.id} data-inactive={u.isActive ? 'false' : 'true'}>
                <td>{u.email}</td>
                <td>{u.displayName}</td>
                <td>{u.groups.length === 0 ? '—' : u.groups.join(', ')}</td>
                <td className="admin-when">
                  {u.lastLoginAt === null ? (
                    'ยังไม่เคย'
                  ) : (
                    <Timestamp utc={u.lastLoginAt} precision="date" />
                  )}
                </td>
                <td>{u.isActive ? 'ใช้งานอยู่' : 'ปิดแล้ว'}</td>
                <td className="admin-actions">
                  <button type="button" onClick={() => void resetPassword(u)}>
                    ตั้งรหัสผ่าน
                  </button>
                  <button type="button" onClick={() => void toggleActive(u)}>
                    {u.isActive ? 'ปิดบัญชี' : 'เปิดบัญชี'}
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}
