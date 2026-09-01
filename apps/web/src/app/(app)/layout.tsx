import type { ReactNode } from 'react';

import { CommandPalette } from '@/components/command-palette';
import { NotificationTray } from '@/components/notification-tray';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { API_BASE } from '@/lib/api';

/**
 * เปลือกของหน้าที่ต้องล็อกอิน
 *
 * แยกจาก root layout เพราะหน้าล็อกอิน **ต้องไม่มีกระดิ่งและเมนูผู้ใช้**
 * ตอนที่ยังอยู่ใน layout เดียวกัน การเปิดหน้าล็อกอินหนึ่งครั้งยิงคำขอที่ได้ 401
 * ออกไปหลายอัน — เปลืองเปล่า และทำให้ console เต็มไปด้วย error ที่ไม่ใช่ปัญหาจริง
 * จนกลบ error ที่เป็นปัญหาจริง
 */
// ที่อยู่ฝั่งเบราว์เซอร์ — ต่างจากที่ server component ใช้ ดู lib/api.ts
const API = API_BASE;

export default function AppLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
        {/* Ctrl+K ได้ทุกหน้าที่ล็อกอินแล้ว — ไม่ใช่เฉพาะหน้าคิว */}
        <CommandPalette apiBase={API} />
        <header className="app-header">
          <span className="app-logo" aria-hidden="true" />
          <b className="app-title">Helix</b>
          <nav className="app-nav">
            <a href="/">คิวงาน</a>
            <a href="/board/SD">กระดาน</a>
            <a href="/backlog/PLAT">Backlog</a>
            <a href="/catalog">แจ้งเรื่อง</a>
            <a href="/new">แจ้งปัญหา</a>
            <a href="/admin/projects">โปรเจกต์</a>
            <a href="/admin/workflows">workflow</a>
            <a href="/admin/issue-types">ประเภทงาน</a>
            <a href="/admin/catalog">บริการ</a>
            <a href="/admin/fields">ฟิลด์</a>
            <a href="/knowledge">คลังความรู้</a>
            <a href="/change-calendar">ปฏิทินเปลี่ยนแปลง</a>
            <a href="/dashboard">แดชบอร์ด</a>
            <a href="/reports">รายงาน</a>
            <a href="/reports/time">เวลาที่ใช้</a>
            <a href="/admin/audit">ร่องรอย</a>
            <a href="/admin/users">ผู้ใช้</a>
            <a href="/admin/resolutions">ผลการแก้ไข</a>
            <a href="/admin/calendars">วันหยุด</a>
            <a href="/admin/change-freezes">ช่วงห้ามเปลี่ยนแปลง</a>
            <a href="/admin/config-items">สิ่งที่ทีมดูแล</a>
            <a href="/admin/automation">กฎอัตโนมัติ</a>
            <a href="/admin/webhooks">ส่งเหตุการณ์ออก</a>
            <a href="/settings/notifications">การแจ้งเตือน</a>
            <a href="/components">คลังคอมโพเนนต์</a>
          </nav>
          <NotificationTray apiBase={API} />
          <ThemeToggle />
          <UserMenu apiBase={API} />
        </header>
      <main className="app-main">{children}</main>
    </>
  );
}
