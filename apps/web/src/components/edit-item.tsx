'use client';

import { useState, type ReactNode } from 'react';
import { Button, Field, Input, Select, Textarea } from '@itsm/ui';

interface Priority {
  rank: number;
  name: string;
}

const SUMMARY_MAX = 500;

/**
 * แก้ไขงานที่แจ้งไปแล้ว
 *
 * เปิดเป็นฟอร์มทับของเดิม ไม่ใช่หน้าใหม่ — คนที่แก้คำผิดหนึ่งตัวไม่ควรเสีย
 * บริบทของหน้าที่กำลังดูอยู่
 *
 * ส่งเฉพาะฟิลด์ที่ผู้ใช้เปลี่ยนจริง เพราะฝั่งเซิร์ฟเวอร์แยก "ไม่ส่ง" (ไม่แตะ)
 * ออกจาก "ส่ง null" (ล้างค่า) · ถ้าส่งทุกฟิลด์เสมอ การกดบันทึกจะกลายเป็น
 * การเขียนทับทั้งใบทุกครั้ง
 */
export function EditItem({
  apiBase,
  itemKey,
  initial,
  priorities,
}: {
  apiBase: string;
  itemKey: string;
  initial: { summary: string; description: string; priorityRank: number | null };
  priorities: Priority[];
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(initial.summary);
  const [description, setDescription] = useState(initial.description);
  const [priority, setPriority] = useState(
    initial.priorityRank === null ? '' : String(initial.priorityRank),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (summary !== initial.summary) body['summary'] = summary;
      if (description !== initial.description) {
        body['description'] = description.trim() === '' ? null : description;
      }
      const nextRank = priority === '' ? null : Number(priority);
      if (nextRank !== initial.priorityRank) body['priorityRank'] = nextRank;

      if (Object.keys(body).length === 0) {
        setOpen(false);
        return;
      }

      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/edit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setError(d.message ?? `บันทึกไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      // โหลดใหม่เพื่อให้ไทม์ไลน์และแถบข้างตรงกับที่เพิ่งบันทึก
      window.location.reload();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="edit-open"
        onClick={() => {
          setOpen(true);
        }}
      >
        แก้ไข
      </button>
    );
  }

  return (
    <form
      className="edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="หัวข้อ" htmlFor="ed-summary" required>
        <Input id="ed-summary" value={summary} onChange={setSummary} maxLength={SUMMARY_MAX} />
      </Field>

      <Field label="รายละเอียด" htmlFor="ed-desc" hint="ปล่อยว่างเพื่อลบคำอธิบาย">
        <Textarea id="ed-desc" value={description} onChange={setDescription} rows={4} maxLength={4000} />
      </Field>

      <Field label="ความสำคัญ" htmlFor="ed-priority">
        <Select
          id="ed-priority"
          value={priority}
          onChange={setPriority}
          options={priorities.map((p) => ({ value: String(p.rank), label: p.name }))}
          placeholder="ยังไม่ระบุ"
        />
      </Field>

      {error === null ? null : (
        <p className="edit-error" role="alert">
          {error}
        </p>
      )}

      <div className="edit-actions">
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? 'กำลังบันทึก…' : 'บันทึก'}
        </Button>
        <button
          type="button"
          className="edit-cancel"
          onClick={() => {
            // คืนค่าที่พิมพ์ค้างไว้กลับเป็นของเดิม ไม่งั้นเปิดใหม่แล้วเจอร่างเก่า
            // ที่ผู้ใช้ตั้งใจทิ้งไปแล้ว
            setSummary(initial.summary);
            setDescription(initial.description);
            setPriority(initial.priorityRank === null ? '' : String(initial.priorityRank));
            setError(null);
            setOpen(false);
          }}
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
