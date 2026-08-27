'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { Button, Field, Select } from '@itsm/ui';

export interface TransitionOption {
  id: string;
  name: string;
  /** ฟิลด์ที่ต้องกรอกก่อนกดปุ่มนี้ — engine เป็นคนบอก ไม่ใช่หน้าจอเดาเอง */
  requiredFields: string[];
}

/**
 * ปุ่มเปลี่ยนสถานะ — ทางเข้าเดียวที่ผู้ใช้เปลี่ยนสถานะงานได้
 *
 * ปุ่มที่แสดงคือปุ่มที่ผ่าน CONDITION แล้วเท่านั้น (workflow engine ตัดสิน ไม่ใช่หน้าจอ)
 * ส่วน VALIDATOR ยังเป็นหน้าที่ของเซิร์ฟเวอร์เสมอ — หน้าจอถามก่อนเพื่อไม่ให้ผู้ใช้
 * ต้องกดปุ่มเพื่อค้นหาว่าระบบต้องการอะไร แต่ไม่ได้แทนการตรวจ
 *
 * นี่คือเหตุผลที่ engine แยก CONDITION ออกจาก VALIDATOR:
 * ปุ่มที่หายไปเฉย ๆ ไม่บอกผู้ใช้ว่าต้องทำอะไรต่อ
 */
export function TransitionButtons({
  itemKey,
  transitions,
  resolutions,
  apiBase,
}: {
  itemKey: string;
  transitions: TransitionOption[];
  resolutions: string[];
  apiBase: string;
}): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<TransitionOption | null>(null);
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState<{ message: string; missingFields?: string[] } | null>(null);

  async function run(t: TransitionOption, resolution: string | null): Promise<void> {
    setBusy(t.id);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/transitions/${t.id}`, {
        credentials: 'include',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(resolution === null ? {} : { resolution }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string; missingFields?: string[] };
        setError({
          message: body.message ?? `ทำรายการไม่สำเร็จ (HTTP ${res.status})`,
          ...(body.missingFields === undefined ? {} : { missingFields: body.missingFields }),
        });
        return;
      }
      setAsking(null);
      setChosen('');
      // โหลดข้อมูลใหม่จากเซิร์ฟเวอร์ — ไม่เดาสถานะใหม่เองที่ฝั่ง client
      router.refresh();
    } catch {
      setError({ message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง' });
    } finally {
      setBusy(null);
    }
  }

  /**
   * ปุ่มที่ต้องกรอกอะไรก่อน จะเปิดช่องให้เลือกแทนการยิงทันที
   *
   * ตัวเลือกที่หายไปทั้งหมด (ตาราง resolution ว่าง) ต้องไม่ทำให้ปุ่มกดไม่ได้เงียบ ๆ
   * — ปล่อยให้กดแล้วให้เซิร์ฟเวอร์ตอบว่าขาดอะไร ดีกว่าปุ่มที่ไม่ตอบสนอง
   */
  function press(t: TransitionOption): void {
    if (t.requiredFields.includes('resolution') && resolutions.length > 0) {
      setError(null);
      setChosen(resolutions[0] ?? '');
      setAsking(t);
      return;
    }
    void run(t, null);
  }

  if (transitions.length === 0) {
    return (
      <p className="detail-no-action">
        คุณไม่มีสิทธิ์เปลี่ยนสถานะงานนี้ในขั้นตอนปัจจุบัน — ติดต่อผู้รับผิดชอบหรือหัวหน้าทีม
      </p>
    );
  }

  return (
    <div className="transition-area">
      {asking === null ? (
        <div className="transition-row">
          {transitions.map((t, i) => (
            <Button
              key={t.id}
              variant={i === 0 ? 'primary' : 'secondary'}
              disabled={busy !== null}
              shortcut={String(i + 1)}
              onClick={() => {
                press(t);
              }}
            >
              {busy === t.id ? 'กำลังดำเนินการ…' : t.name}
            </Button>
          ))}
        </div>
      ) : (
        <form
          className="transition-ask"
          onSubmit={(e) => {
            e.preventDefault();
            void run(asking, chosen);
          }}
        >
          <Field
            label="เรื่องนี้จบอย่างไร"
            htmlFor="tr-resolution"
            hint="บันทึกไว้ตอนนี้เท่านั้น — ย้อนกลับมาเติมทีหลังไม่ได้"
            required
          >
            <Select
              id="tr-resolution"
              value={chosen}
              onChange={setChosen}
              options={resolutions.map((r) => ({ value: r, label: r }))}
            />
          </Field>
          <div className="transition-ask-actions">
            <Button variant="primary" type="submit" disabled={busy !== null}>
              {busy === null ? asking.name : 'กำลังดำเนินการ…'}
            </Button>
            <button
              type="button"
              className="edit-cancel"
              onClick={() => {
                setAsking(null);
                setChosen('');
              }}
            >
              ยกเลิก
            </button>
          </div>
        </form>
      )}

      {error === null ? null : (
        <div className="error-box" role="alert">
          {/*
            เมื่อรู้ว่าขาดฟิลด์อะไร ให้บอกเป็นประโยคเดียวที่อ่านรู้เรื่อง
            ไม่ใช่เอาข้อความจากเซิร์ฟเวอร์มาต่อกับรายการฟิลด์ ซึ่งทำให้บอกชื่อฟิลด์ซ้ำสองรอบ
          */}
          {error.missingFields === undefined || error.missingFields.length === 0 ? (
            <b>{error.message}</b>
          ) : (
            <b>ยังทำรายการนี้ไม่ได้ — ต้องกรอก {error.missingFields.join(', ')} ก่อน</b>
          )}
        </div>
      )}
    </div>
  );
}
