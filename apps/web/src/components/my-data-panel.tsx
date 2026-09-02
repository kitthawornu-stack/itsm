'use client';

import { useState, type ReactNode } from 'react';
import { Alert, Button } from '@itsm/ui';

/**
 * ขอสำเนาข้อมูลส่วนบุคคลของตัวเอง (PDPA · สิทธิขอเข้าถึง)
 *
 * ## ทำไมต้องมีปุ่มนี้ ทั้งที่ผู้ดูแลดึงให้ได้อยู่แล้ว
 *
 * สิทธิ์ที่ต้องรอให้คนอื่นว่างมาทำให้ ไม่ใช่สิทธิ์ · และการต้องเดินไปขอ
 * ทำให้คนไม่ขอ ซึ่งอ่านจากภายนอกเหมือนไม่มีใครต้องการ
 *
 * ## ไฟล์ถูกประกอบในเบราว์เซอร์ ไม่ใช่ลิงก์ตรง
 *
 * ทำให้ข้อความปฏิเสธเป็นภาษาคนและอยู่ในหน้าเดิม แทนที่จะพาไปหน้า JSON ดิบ
 */
export function MyDataPanel({ apiBase }: { apiBase: string }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /** คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void` — ผู้เรียกต้องแยกสองอย่างนี้ได้ */
  async function download(): Promise<boolean> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/me/personal-data`, { credentials: 'include' });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          (data as { message?: string } | null)?.message ??
            `ขอสำเนาไม่สำเร็จ (HTTP ${String(res.status)})`,
        );
        return false;
      }

      /*
        เขียนไฟล์เป็น UTF-8 พร้อม BOM — คนไทยส่วนใหญ่เปิดไฟล์ที่ดาวน์โหลดมา
        ด้วย Notepad หรือ Excel ซึ่งเดารหัสอักขระผิดเมื่อไม่มี BOM
        แล้วชื่อกับข้อความในคอมเมนต์จะกลายเป็นขยะทั้งไฟล์โดยไม่มี error
      */
      const text = `﻿${JSON.stringify(data, null, 2)}`;
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ข้อมูลส่วนบุคคลของฉัน-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const counts = (data as { counts?: Record<string, number> }).counts ?? {};
      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      setDone(`ดาวน์โหลดแล้ว · มีรายการรวม ${total.toLocaleString('th-TH')} รายการ`);
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mydata">
      <div className="admin-btn-row">
        <Button
          disabled={busy}
          onClick={() => {
            void download();
          }}
        >
          {busy ? 'กำลังรวบรวม…' : 'ดาวน์โหลดข้อมูลของฉัน'}
        </Button>
      </div>

      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}
      {done === null ? null : (
        <Alert tone="success" inline>
          {done}
        </Alert>
      )}
    </div>
  );
}
