'use client';

import { useState, type ReactNode } from 'react';

import { Button, Input } from '@itsm/ui';

/**
 * ตั้งหรือถอดเพดานงานที่ทำพร้อมกันของคอลัมน์หนึ่ง
 *
 * อยู่ใต้หัวคอลัมน์ เพราะเพดานเป็นข้อตกลงเรื่อง *คอลัมน์นี้* — หน้าตั้งค่า
 * แยกต่างหากทำให้คนต้องจำว่าคอลัมน์ไหนมีงานเท่าไรตอนกรอกตัวเลข
 *
 * **แสดงเฉพาะคนที่มีสิทธิ์จัดการโปรเจกต์** — แต่การซ่อนไม่ใช่การป้องกัน ·
 * `setWipLimit` ฝั่งเซิร์ฟเวอร์ตรวจสิทธิ์เองทุกครั้ง ที่นี่มีไว้ไม่ให้คน
 * เห็นช่องกรอกที่กดแล้วได้ 403 เท่านั้น
 */
export function WipLimitEditor({
  apiBase,
  projectKey,
  column,
  current,
  onSaved,
}: {
  apiBase: string;
  projectKey: string;
  column: string;
  /** เพดานที่ตั้งไว้ตอนนี้ · `null` = ยังไม่ได้ตั้ง */
  current: number | null;
  /** เรียกเมื่อเซิร์ฟเวอร์รับแล้วเท่านั้น — ใช้รีเฟรชกระดาน */
  onSaved: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current === null ? '' : String(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  /**
   * ส่งค่าไปเซิร์ฟเวอร์
   *
   * **คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void`** — ตัวช่วยที่กลืน error ไว้เองทั้งหมด
   * ทำให้ผู้เรียกแยกสำเร็จจากล้มเหลวไม่ได้ แล้วปิดฟอร์มทั้งที่เซิร์ฟเวอร์
   * ปฏิเสธ (บทเรียนใน CLAUDE.md)
   */
  async function send(maxCards: number | null): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/v1/boards/${encodeURIComponent(projectKey)}/wip-limit`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ column, maxCards }),
        },
      );
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        const msg = data.message ?? `บันทึกไม่สำเร็จ (HTTP ${String(res.status)})`;
        setError(msg);
        // ประกาศคำปฏิเสธด้วย — ความเงียบอ่านเหมือนปุ่มไม่ทำงาน
        setStatus(msg);
        return false;
      }
      setStatus(maxCards === null ? `ถอดเพดานของ ${column} แล้ว` : `ตั้งเพดาน ${String(maxCards)}`);
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      setStatus('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <p className="wip-edit">
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(true);
          }}
          ariaLabel={
            current === null
              ? `ตั้งเพดานของคอลัมน์ ${column}`
              : `แก้เพดานของคอลัมน์ ${column} — ตอนนี้ ${String(current)}`
          }
        >
          {current === null ? 'ตั้งเพดาน' : 'แก้เพดาน'}
        </Button>
      </p>
    );
  }

  return (
    <div className="wip-edit">
      <Input
        value={value}
        onChange={setValue}
        type="text"
        id={`wip-${projectKey}-${column}`}
        ariaLabel={`เพดานของคอลัมน์ ${column} — จำนวนเรื่องสูงสุด`}
        placeholder="เช่น 5"
        invalid={error !== null}
      />
      <Button
        variant="primary"
        disabled={busy}
        onClick={() => {
          /*
            ส่งค่าที่พิมพ์ไปให้เซิร์ฟเวอร์ตัดสิน ไม่ตรวจซ้ำที่นี่ —
            **ด่านเดียวต่อเรื่องเดียว** · การตรวจสองที่ทำให้ข้อความ
            ต่างกันได้ และวันที่กติกาเปลี่ยน จะมีที่หนึ่งที่ไม่ได้แก้
          */
          const n = value.trim() === '' ? Number.NaN : Number(value);
          void send(n).then((ok) => {
            /*
              ปิดฟอร์มเมื่อ **เซิร์ฟเวอร์รับแล้ว** เท่านั้น ไม่ใช่เมื่อ
              เรียกฟังก์ชันเสร็จ — คนที่พิมพ์ผิดหนึ่งช่องต้องไม่เสียสิ่งที่พิมพ์
            */
            if (!ok) return;
            setOpen(false);
            onSaved();
          });
        }}
      >
        บันทึก
      </Button>
      {current === null ? null : (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            void send(null).then((ok) => {
              if (!ok) return;
              setValue('');
              setOpen(false);
              onSaved();
            });
          }}
          ariaLabel={`ถอดเพดานของคอลัมน์ ${column}`}
        >
          ถอดเพดาน
        </Button>
      )}
      <Button
        variant="ghost"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        ariaLabel={`ยกเลิกการแก้เพดานของคอลัมน์ ${column}`}
      >
        ยกเลิก
      </Button>

      {error === null ? null : (
        <p className="wip-edit-error" role="alert">
          {error}
        </p>
      )}
      {/* ประกาศผลให้ screen reader — ความเงียบอ่านเหมือนปุ่มไม่ทำงาน */}
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
