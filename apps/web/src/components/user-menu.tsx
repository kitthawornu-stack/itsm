'use client';

import { useEffect, useState, type ReactNode } from 'react';

interface Me {
  user: { id: string; email: string; displayName: string };
}

/**
 * ชื่อผู้ใช้ที่ล็อกอินอยู่ พร้อมปุ่มออกจากระบบ
 *
 * ถามฝั่งเซิร์ฟเวอร์ว่าเป็นใคร ไม่อ่านจากคุกกี้ — คุกกี้เป็น httpOnly
 * จึงอ่านจาก JavaScript ไม่ได้โดยตั้งใจ (นั่นคือเหตุผลที่เลือกใช้มัน)
 */
export function UserMenu({ apiBase }: { apiBase: string }): ReactNode {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    // AbortController ไม่ใช่แค่ธงกันเซ็ต state หลัง unmount — มันยกเลิกคำขอจริง
    // ธง `cancelled` ยังปล่อยให้คำขอวิ่งจนจบแล้วค่อยทิ้งผลลัพธ์
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/auth/me`, {
          credentials: 'include',
          cache: 'no-store',
          signal: ac.signal,
        });
        if (!res.ok) return;
        setMe((await res.json()) as Me);
      } catch {
        /* ยกเลิกหรือเชื่อมต่อไม่ได้ = ไม่แสดงชื่อ ไม่ต้องรบกวนผู้ใช้ */
      }
    })();
    return () => {
      ac.abort();
    };
  }, [apiBase]);

  async function signOut(): Promise<void> {
    await fetch(`${apiBase}/api/v1/auth/logout`, { method: 'POST', credentials: 'include' });
    window.location.replace('/login');
  }

  if (me === null) return null;

  return (
    <div className="user-menu">
      <span className="user-menu-name">{me.user.displayName}</span>
      <button type="button" className="user-menu-out" onClick={() => void signOut()}>
        ออกจากระบบ
      </button>
    </div>
  );
}
