'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Alert, LinkButton } from '@itsm/ui';

/**
 * ปุ่มเฝ้าดูเรื่อง
 *
 * ในกลุ่ม LINE ทุกคนเห็นทุกเรื่องโดยปริยาย · ระบบตั๋วที่แจ้งเฉพาะผู้แจ้งกับ
 * ผู้รับผิดชอบ ทำให้คนที่เคยเห็นทุกอย่าง **หยุดเห็น** ซึ่งเป็นเหตุผลอันดับหนึ่ง
 * ที่ทีมเลิกใช้แล้วกลับไปคุยกันในแชท · ปุ่มนี้คือทางกลับของคนเหล่านั้น
 *
 * ป้ายบอก **สิ่งที่จะเกิดขึ้นเมื่อกด** ไม่ใช่สถานะปัจจุบัน — ปุ่มที่เขียนว่า
 * "กำลังเฝ้าดู" ทำให้คนกดเพื่อ *เริ่ม* เฝ้าดู แล้วกลายเป็นเลิกเฝ้าดูแทน
 * จำนวนผู้เฝ้าดูข้าง ๆ เป็นตัวบอกสถานะแทน
 */
export function WatchButton({
  apiBase,
  itemKey,
  watching,
  count,
}: {
  apiBase: string;
  itemKey: string;
  watching: boolean;
  count: number;
}): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/watch`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ watching: !watching }),
      });
      if (!res.ok) {
        setError(`ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      // ดึงใหม่จากเซิร์ฟเวอร์ ไม่ใช่สลับสถานะในหน้าจอเอง — จำนวนผู้เฝ้าดู
      // เปลี่ยนตามคนอื่นด้วย และหน้าจอที่เดาผลลัพธ์จะไม่ตรงกับฐานข้อมูล
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="watch">
      <LinkButton disabled={busy} onClick={() => void toggle()}>
        {busy ? 'กำลังบันทึก…' : watching ? 'เลิกเฝ้าดู' : 'เฝ้าดูเรื่องนี้'}
      </LinkButton>
      {count === 0 ? null : (
        <span className="watch-count">มีคนเฝ้าดู {count.toLocaleString('th-TH')} คน</span>
      )}
      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}
    </span>
  );
}
