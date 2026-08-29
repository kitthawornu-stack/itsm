'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Field, Input, LinkButton, Table, Timestamp } from '@itsm/ui';

interface FreezeRow {
  id: string;
  name: string;
  reason: string;
  startsAt: string;
  endsAt: string;
  affectedCount: number;
}

/** ค่าของ `<input type="datetime-local">` คือเวลาบนนาฬิกาของผู้ใช้ ไม่ใช่ UTC */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

const EMPTY = { name: '', reason: '', start: '', end: '' };

/**
 * ช่วงห้ามเปลี่ยนแปลง — หน้าจอของผู้ดูแล
 *
 * ตารางนี้มีมาก่อนหน้าจอ และเอนจินใช้จริง **แต่ไม่มีทางเข้าอื่นนอกจากเขียน SQL**
 * — กลไกที่ไม่มีอะไรเรียกใช้ ป้องกันอะไรไม่ได้เลย
 *
 * ## จำนวนที่กระทบแสดงในตาราง ไม่ใช่ตอนกดลบ
 *
 * หน้าต่างเวลาที่บันทึกไว้ตอนช่วงห้ามยังอยู่ **ไม่ถูกย้อนกลับ** เมื่อช่วงห้าม
 * หายไป — สิ่งที่หายคือคำเตือน · ผู้ดูแลต้องเห็นตัวเลขก่อนตัดสินใจ ไม่ใช่
 * เห็นตอนที่คำเตือนหายไปแล้ว
 */
export function ChangeFreezeAdmin({ apiBase }: { apiBase: string }): ReactNode {
  const [rows, setRows] = useState<FreezeRow[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/change-freezes`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (res.status === 403) {
        setDenied(true);
        setRows([]);
        return;
      }
      if (!res.ok) {
        setRows([]);
        return;
      }
      const d = (await res.json()) as { rows: FreezeRow[] };
      setRows(d.rows);
    } catch {
      setRows([]);
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  /** คืนว่าสำเร็จหรือไม่ — ผู้เรียกต้องรู้ว่าจะล้างฟอร์มได้หรือยัง */
  async function send(
    path: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body: unknown,
    done: string,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/change-freezes${path}`, {
        method,
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(d?.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
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

  if (rows === null) return null;

  if (denied) {
    /*
      คนที่ไม่ใช่ผู้ดูแลไม่เห็นฟอร์มเลย ไม่ใช่เห็นแล้วกดไม่ได้ —
      ปุ่มที่กดแล้วได้ 403 ทุกครั้งคือปุ่มที่ไม่ควรมี
    */
    return (
      <Alert tone="info">
        หน้านี้สำหรับผู้ดูแลองค์กรเท่านั้น — ช่วงห้ามเปลี่ยนแปลงมีผลกับทุกโปรเจกต์
      </Alert>
    );
  }

  const body = {
    name: form.name,
    reason: form.reason,
    startsAt: form.start === '' ? '' : new Date(form.start).toISOString(),
    endsAt: form.end === '' ? '' : new Date(form.end).toISOString(),
  };
  const ready = form.name.trim() !== '' && form.reason.trim() !== '' && form.start !== '' && form.end !== '';

  return (
    <>
      {error === null ? null : <Alert tone="error">{error}</Alert>}
      {notice === null ? null : <Alert tone="success">{notice}</Alert>}

      <form
        className="cf-form"
        onSubmit={(e) => {
          e.preventDefault();
          const isEdit = editing !== null;
          void send(
            isEdit ? `/${editing}` : '',
            isEdit ? 'PUT' : 'POST',
            body,
            isEdit ? `แก้ "${form.name}" แล้ว` : `เพิ่มช่วงห้าม "${form.name}" แล้ว`,
          ).then((ok) => {
            // ล้างฟอร์มเมื่อเซิร์ฟเวอร์รับแล้วเท่านั้น — ไม่ใช่เมื่อเรียกฟังก์ชันเสร็จ
            if (ok) {
              setForm(EMPTY);
              setEditing(null);
            }
          });
        }}
      >
        <Field label="ชื่อช่วงห้าม" htmlFor="cf-name" required>
          <Input
            id="cf-name"
            value={form.name}
            required
            maxLength={120}
            placeholder="เช่น ปิดงบสิ้นปี"
            onChange={(v) => {
              setForm((f) => ({ ...f, name: v }));
            }}
          />
        </Field>
        {/*
          เหตุผลบังคับกรอก — คนที่จะขอข้ามต้องอ่านแล้วตัดสินใจได้เองว่าเรื่อง
          ของเขาสำคัญพอไหม · ช่วงห้ามที่เขียนว่า "ห้าม" เฉย ๆ จะถูกข้ามทุกครั้ง
        */}
        <Field
          label="เหตุผลที่ห้าม"
          htmlFor="cf-reason"
          required
          hint="คนที่ขอข้ามจะเห็นข้อความนี้ และใช้ตัดสินใจว่าเรื่องของเขาสำคัญพอไหม"
        >
          <Input
            id="cf-reason"
            value={form.reason}
            required
            maxLength={500}
            placeholder="เช่น ระบบบัญชีปิดงบ ห้ามแตะทุกระบบที่เกี่ยวข้อง"
            onChange={(v) => {
              setForm((f) => ({ ...f, reason: v }));
            }}
          />
        </Field>
        <div className="cf-row">
          <Field label="เริ่ม" htmlFor="cf-start" required>
            <Input
              id="cf-start"
              type="datetime-local"
              value={form.start}
              required
              onChange={(v) => {
                setForm((f) => ({ ...f, start: v }));
              }}
            />
          </Field>
          <Field label="สิ้นสุด" htmlFor="cf-end" required>
            <Input
              id="cf-end"
              type="datetime-local"
              value={form.end}
              required
              onChange={(v) => {
                setForm((f) => ({ ...f, end: v }));
              }}
            />
          </Field>
        </div>
        <div className="admin-btn-row">
          <Button variant="primary" type="submit" disabled={busy || !ready}>
            {editing === null ? 'เพิ่มช่วงห้าม' : 'บันทึกการแก้ไข'}
          </Button>
          {editing === null ? null : (
            <LinkButton
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setForm(EMPTY);
              }}
            >
              ยกเลิกการแก้ไข
            </LinkButton>
          )}
        </div>
      </form>

      <Table
        columns={[
          'ชื่อ',
          'เหตุผล',
          'ช่วงเวลา',
          { label: 'หน้าต่างที่กระทบ', align: 'end' as const },
          { label: 'การกระทำ', srOnly: true },
        ]}
        rowCount={rows.length}
        empty="ยังไม่มีช่วงห้ามเปลี่ยนแปลง — ทุกช่วงเวลาตั้งได้อิสระ"
      >
        {rows.map((f) => (
          <tr key={f.id}>
            <td>{f.name}</td>
            <td>{f.reason}</td>
            <td>
              <Timestamp utc={f.startsAt} /> – <Timestamp utc={f.endsAt} />
            </td>
            <td data-align="end">{f.affectedCount}</td>
            <td className="admin-actions">
              {/*
                ทุกแถวมีปุ่มข้อความเดียวกัน — ต้องมีชื่อแยกให้ screen reader
                และต้องเป็น prop `ariaLabel` ไม่ใช่ `aria-label`
              */}
              <LinkButton
                ariaLabel={`แก้ช่วงห้าม ${f.name}`}
                disabled={busy}
                onClick={() => {
                  setEditing(f.id);
                  setForm({
                    name: f.name,
                    reason: f.reason,
                    start: toLocalInput(f.startsAt),
                    end: toLocalInput(f.endsAt),
                  });
                }}
              >
                แก้
              </LinkButton>
              <LinkButton
                ariaLabel={
                  f.affectedCount === 0
                    ? `ลบช่วงห้าม ${f.name}`
                    : `ลบช่วงห้าม ${f.name} ซึ่งกระทบหน้าต่างเวลา ${String(f.affectedCount)} รายการ`
                }
                tone="danger"
                disabled={busy}
                onClick={() => {
                  void send(
                    `/${f.id}`,
                    'DELETE',
                    undefined,
                    f.affectedCount === 0
                      ? `ลบ "${f.name}" แล้ว`
                      : `ลบ "${f.name}" แล้ว — หน้าต่างเวลา ${String(f.affectedCount)} รายการ` +
                        ` ยังอยู่ที่เดิม แต่ไม่มีคำเตือนแล้ว`,
                  );
                }}
              >
                ลบ
              </LinkButton>
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
