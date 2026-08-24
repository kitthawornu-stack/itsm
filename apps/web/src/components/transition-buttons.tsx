'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { Button } from '@itsm/ui';

export interface TransitionOption {
  id: string;
  name: string;
}

/**
 * ปุ่มเปลี่ยนสถานะ — ทางเข้าเดียวที่ผู้ใช้เปลี่ยนสถานะงานได้
 *
 * ปุ่มที่แสดงคือปุ่มที่ผ่าน CONDITION แล้วเท่านั้น (workflow engine ตัดสิน ไม่ใช่หน้าจอ)
 * แต่ **VALIDATOR ยังไม่ถูกตรวจตอนนี้** — ปุ่มจึงยังกดได้แม้ข้อมูลไม่ครบ
 * และเมื่อกดแล้วไม่ผ่าน หน้าจอมีหน้าที่บอกว่า **ขาดฟิลด์อะไร** ไม่ใช่แค่ว่าล้มเหลว
 *
 * นี่คือเหตุผลที่ engine แยก CONDITION ออกจาก VALIDATOR:
 * ปุ่มที่หายไปเฉย ๆ ไม่บอกผู้ใช้ว่าต้องทำอะไรต่อ
 */
export function TransitionButtons({
  itemKey,
  transitions,
  apiBase,
}: {
  itemKey: string;
  transitions: TransitionOption[];
  apiBase: string;
}): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; missingFields?: string[] } | null>(null);

  async function run(t: TransitionOption): Promise<void> {
    setBusy(t.id);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/transitions/${t.id}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string; missingFields?: string[] };
        setError({
          message: body.message ?? `ทำรายการไม่สำเร็จ (HTTP ${res.status})`,
          ...(body.missingFields === undefined ? {} : { missingFields: body.missingFields }),
        });
        return;
      }
      // โหลดข้อมูลใหม่จากเซิร์ฟเวอร์ — ไม่เดาสถานะใหม่เองที่ฝั่ง client
      router.refresh();
    } catch {
      setError({ message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง' });
    } finally {
      setBusy(null);
    }
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
      <div className="transition-row">
        {transitions.map((t, i) => (
          <Button
            key={t.id}
            variant={i === 0 ? 'primary' : 'secondary'}
            disabled={busy !== null}
            shortcut={String(i + 1)}
            onClick={() => void run(t)}
          >
            {busy === t.id ? 'กำลังดำเนินการ…' : t.name}
          </Button>
        ))}
      </div>

      {error === null ? null : (
        <div className="error-box" role="alert">
          {/*
            เมื่อรู้ว่าขาดฟิลด์อะไร ให้บอกเป็นประโยคเดียวที่อ่านรู้เรื่อง
            ไม่ใช่เอาข้อความจากเซิร์ฟเวอร์มาต่อกับรายการฟิลด์ ซึ่งทำให้บอกชื่อฟิลด์ซ้ำสองรอบ
          */}
          {error.missingFields === undefined || error.missingFields.length === 0 ? (
            <b>{error.message}</b>
          ) : (
            <>
              <b>ยังทำรายการนี้ไม่ได้ — ต้องกรอก {error.missingFields.join(', ')} ก่อน</b>
              <br />
              <span style={{ fontSize: 12.5, opacity: 0.85 }}>
                ฟอร์มกรอกฟิลด์ยังไม่ได้สร้าง อยู่ใน Phase 1
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
