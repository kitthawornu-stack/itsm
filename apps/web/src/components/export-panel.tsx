'use client';

import { useState, type ReactNode } from 'react';
import { Alert, Button } from '@itsm/ui';

import { filenameFrom } from '@/lib/content-disposition';

/**
 * ส่งออกงานทั้งโปรเจกต์เป็นไฟล์ CSV
 *
 * ## ทำไมไม่ใช้ลิงก์ดาวน์โหลดตรง ๆ
 *
 * `<a href download>` ง่ายกว่า แต่เมื่อเซิร์ฟเวอร์ปฏิเสธ (ไม่มีสิทธิ์ ·
 * งานเยอะเกิน) เบราว์เซอร์จะพาไปหน้า JSON ดิบ · คนที่กดปุ่มในหน้าตั้งค่า
 * แล้วเจอ `{"error":"invalid_state"}` เต็มจอ ไม่รู้ว่าต้องทำอะไรต่อ
 *
 * ดึงด้วย `fetch` แล้วสร้างไฟล์ในเบราว์เซอร์แทน ทำให้ข้อความปฏิเสธเป็น
 * ภาษาคนและอยู่ในหน้าเดิม
 */
export function ExportPanel({
  apiBase,
  projectKey,
}: {
  apiBase: string;
  projectKey: string;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ filename: string; rows: number } | null>(null);

  /**
   * คืนว่าสำเร็จหรือไม่ **ไม่ใช่ `void`**
   *
   * ฟังก์ชันที่กลืน error เพื่อไม่ให้หน้าจอพัง ต้องบอกผู้เรียกได้ว่าเกิดอะไรขึ้น
   * — เคยมีบั๊กที่ฟอร์มถูกล้างทั้งตอนสำเร็จและตอนถูกปฏิเสธ เพราะตัวช่วย
   * คืน `void` แล้ว promise มันสำเร็จเสมอ (CLAUDE.md)
   */
  async function download(): Promise<boolean> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(
        `${apiBase}/api/v1/projects/${encodeURIComponent(projectKey)}/export/work-items.csv`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        setError(
          (data as { message?: string } | null)?.message ??
            `ส่งออกไม่สำเร็จ (HTTP ${String(res.status)})`,
        );
        return false;
      }

      const blob = await res.blob();
      const name = filenameFrom(res.headers.get('content-disposition')) ?? `${projectKey}.csv`;
      /*
        สร้าง `<a>` ชั่วคราวแล้วกดมันเอง — เป็นวิธีเดียวที่สั่งให้เบราว์เซอร์
        บันทึกไฟล์จากข้อมูลที่อยู่ในหน่วยความจำได้ · คืน object URL ทันที
        มิฉะนั้นไฟล์ทั้งก้อนค้างในหน่วยความจำจนกว่าจะปิดแท็บ
      */
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setDone({ filename: name, rows: Number(res.headers.get('x-export-rows') ?? '0') });
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="exp">
      <div className="admin-btn-row">
        <Button
          disabled={busy}
          onClick={() => {
            void download();
          }}
        >
          {busy ? 'กำลังเตรียมไฟล์…' : 'ดาวน์โหลดงานทั้งหมดเป็น CSV'}
        </Button>
      </div>

      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}

      {done === null ? null : (
        <Alert tone="success" inline>
          ดาวน์โหลด {done.filename} แล้ว · {done.rows.toLocaleString('th-TH')} เรื่อง
        </Alert>
      )}
    </div>
  );
}
