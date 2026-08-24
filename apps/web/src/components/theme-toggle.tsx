'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * สลับธีม — **สามสถานะ ไม่ใช่สองสถานะ** (master-plan 7.3)
 *
 *   system  ค่าเริ่มต้น · ไม่ตั้ง attribute · ปล่อยให้ prefers-color-scheme ตัดสิน
 *   light   ตั้ง data-theme="light" · ต้องชนะแม้ระบบตั้งเป็นมืด
 *   dark    ตั้ง data-theme="dark"  · ต้องชนะแม้ระบบตั้งเป็นสว่าง
 *
 * เก็บใน cookie ไม่ใช่ localStorage เพราะสคริปต์กันจอกระพริบใน layout
 * ต้องอ่านได้ก่อน React ทำงาน และเซิร์ฟเวอร์อ่านได้ด้วย
 *
 * ค่าจริงต้องเก็บที่ user preference บนเซิร์ฟเวอร์ด้วย เพื่อให้ Agent
 * ที่สลับเครื่องได้ธีมเดิม — cookie เป็นแค่แคชกันกระพริบ (ยังไม่ทำ รอโมดูล identity)
 */
type Theme = 'system' | 'light' | 'dark';

const OPTIONS: Array<{ value: Theme; label: string; icon: string }> = [
  { value: 'light', label: 'สว่าง', icon: '☀' },
  { value: 'system', label: 'ตามระบบ', icon: '◐' },
  { value: 'dark', label: 'มืด', icon: '☾' },
];

function readCookie(name: string): string | null {
  const m = new RegExp(`(?:^|; )${name}=([^;]+)`).exec(document.cookie);
  return m?.[1] === undefined ? null : decodeURIComponent(m[1]);
}

export function ThemeToggle(): ReactNode {
  const [theme, setTheme] = useState<Theme>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = readCookie('itsm_theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') setTheme(stored);
    setMounted(true);
  }, []);

  function apply(next: Theme): void {
    setTheme(next);
    document.cookie = `itsm_theme=${next}; path=/; max-age=31536000; samesite=lax`;
    if (next === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
  }

  return (
    <div className="theme-toggle" role="group" aria-label="เลือกธีม">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          className="theme-toggle-btn"
          // ก่อน mount ยังไม่รู้ค่าจริง — ไม่ทำเครื่องหมายอันไหนเลย เพื่อกัน hydration mismatch
          data-active={mounted && theme === o.value ? 'true' : 'false'}
          aria-pressed={mounted ? theme === o.value : false}
          title={o.label}
          onClick={() => {
            apply(o.value);
          }}
        >
          <span aria-hidden="true">{o.icon}</span>
          <span className="theme-toggle-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
