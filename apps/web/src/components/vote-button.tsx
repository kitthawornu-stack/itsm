'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Alert, LinkButton } from '@itsm/ui';

/**
 * ปุ่มโหวตสนับสนุนเรื่อง
 *
 * ป้ายบอก **สิ่งที่จะเกิดขึ้นเมื่อกด** ไม่ใช่สถานะปัจจุบัน — กติกาเดียวกับ
 * ปุ่มเฝ้าดู · จำนวนเสียงข้าง ๆ เป็นตัวบอกสถานะแทน
 *
 * **เรื่องของตัวเองไม่มีปุ่ม แต่ยังเห็นจำนวน** — ปุ่มที่กดแล้วได้ error
 * คือหน้าจอที่หลอกคน ส่วนการซ่อนตัวเลขไปด้วยจะทำให้ผู้แจ้งไม่รู้ว่ามีคนอื่น
 * เจอปัญหาเดียวกันกี่คน ซึ่งเป็นข้อมูลที่เขาอยากรู้ที่สุด
 */
export function VoteButton({
  apiBase,
  itemKey,
  voted,
  count,
  ownItem,
}: {
  apiBase: string;
  itemKey: string;
  voted: boolean;
  count: number;
  ownItem: boolean;
}): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/vote`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(d?.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      /*
        ดึงใหม่จากเซิร์ฟเวอร์ ไม่ใช่บวกลบในหน้าจอเอง — จำนวนเสียงเปลี่ยนตาม
        คนอื่นด้วย และหน้าจอที่เดาผลลัพธ์จะไม่ตรงกับฐานข้อมูล
      */
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="vote">
      {ownItem ? null : (
        <LinkButton disabled={busy} onClick={() => void toggle()}>
          {busy ? 'กำลังบันทึก…' : voted ? 'ถอนเสียงสนับสนุน' : 'สนับสนุนเรื่องนี้'}
        </LinkButton>
      )}
      <span className="vote-count">
        {count === 0 ? 'ยังไม่มีใครสนับสนุน' : `สนับสนุน ${count.toLocaleString('th-TH')} เสียง`}
      </span>
      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}
    </span>
  );
}
