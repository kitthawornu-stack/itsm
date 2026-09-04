import type { ReactNode } from 'react';

import { Alert, DailyChart, PageHeader, Stat, Table, TextLink } from '@itsm/ui';

import { ScheduleManager, type ScheduleRow } from '@/components/schedule-manager';

import { API_BASE, apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface DailyPoint {
  day: string;
  opened: number;
  resolved: number;
}

interface Summary {
  window: { from: string; to: string; label: string };
  projects: string[];
  opened: number;
  resolved: number;
  openNow: number;
  avgResolveHours: number | null;
  breached: number;
  daily: DailyPoint[];
  byPriority: Array<{ name: string; opened: number }>;
  byAssignee: Array<{ name: string; resolved: number }>;
  ranges: Array<{ key: string; label: string }>;
}

const nf = (n: number): string => n.toLocaleString('th-TH');

/** `2026-08-28` → `28 ส.ค.` — แกนนอนที่เขียนปีทุกแท่งอ่านไม่ออก */

/**
 * รายงาน
 *
 * ทุกตัวเลขบอกช่วงเวลาและโปรเจกต์ที่มันนับจาก — ตัวเลขที่ตรวจไม่ได้
 * จะถูกเชื่อไปเรื่อย ๆ จนถึงวันที่มันผิด
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const range = sp.range ?? 'this-month';

  let data: Summary | null = null;
  let error: string | null = null;
  try {
    const res = await apiFetch(`/api/v1/reports/summary?range=${encodeURIComponent(range)}`);
    if (res.ok) data = (await res.json()) as Summary;
    else if (res.status === 403) {
      const body = (await res.json()) as { message?: string };
      error = body.message ?? 'คุณยังดูรายงานไม่ได้';
    } else error = `โหลดไม่สำเร็จ (HTTP ${String(res.status)})`;
  } catch {
    error = 'เชื่อมต่อระบบไม่ได้';
  }

  if (data === null) {
    return (
      <section className="page">
        <PageHeader title="รายงาน" />
        <Alert tone="error">{error ?? 'เชื่อมต่อระบบไม่ได้'}</Alert>
      </section>
    );
  }

  /*
    ตารางเวลาโหลดแยกจากรายงาน · ล้มแล้วไม่ทำให้ทั้งหน้าหาย — ส่วนเสริม
    ที่พาสิ่งสำคัญไปด้วย คือการทำให้สิ่งสำคัญขึ้นกับสิ่งที่ไม่สำคัญ
  */
  let schedules: ScheduleRow[] = [];
  try {
    const r = await apiFetch('/api/v1/reports/schedules');
    if (r.ok) schedules = ((await r.json()) as { rows: ScheduleRow[] }).rows;
  } catch {
    schedules = [];
  }

  const report = data;

  return (
    <section className="page">
      <PageHeader
        title="รายงาน"
        lead={
          <>
            {report.window.label} · นับจากโปรเจกต์ {report.projects.join(' · ')}
          </>
        }
      />

      <nav className="queue-tabs" aria-label="ช่วงเวลา">
        {report.ranges.map((r) => (
          <a
            key={r.key}
            href={r.key === 'this-month' ? '/reports' : `/reports?range=${r.key}`}
            aria-current={r.key === range ? 'page' : undefined}
          >
            {r.label}
          </a>
        ))}
      </nav>

      <div className="ui-stat-row">
        <Stat label="แจ้งเข้ามา" value={nf(report.opened)} hint={report.window.label} />
        <Stat label="ปิดได้" value={nf(report.resolved)} hint={report.window.label} />
        {/* ค่าของ "ตอนนี้" ไม่ใช่ของช่วง — ป้ายต้องบอกให้ชัด ไม่งั้นอ่านปนกัน */}
        <Stat label="ค้างอยู่" value={nf(report.openNow)} hint="ณ ตอนนี้" />
        <Stat
          label="เวลาปิดเฉลี่ย"
          /*
            ศูนย์ใบ = ไม่มีค่าเฉลี่ย ไม่ใช่เฉลี่ยศูนย์ชั่วโมง
            "0 ชั่วโมง" อ่านว่าปิดทันที ซึ่งกลับความหมาย
          */
          value={report.avgResolveHours === null ? '—' : `${nf(report.avgResolveHours)} ชม.`}
          hint={report.avgResolveHours === null ? 'ยังไม่มีใบไหนปิด' : report.window.label}
        />
        <Stat
          label="หลุดกำหนด"
          value={nf(report.breached)}
          hint={report.window.label}
          {...(report.breached > 0 ? { tone: 'critical' as const } : {})}
        />
      </div>

      <h2 className="detail-section-title detail-section-gap">รายวัน</h2>
      <DailyChart daily={report.daily} />

      <h2 className="detail-section-title detail-section-gap">แจ้งเข้ามา แยกตามความสำคัญ</h2>
      {/* ตารางเวลาส่งรายงาน — ค่าของแต่ละคน ส่งให้เจ้าของคนเดียว */}
      <h2 className="cfg-title detail-section-gap">ส่งรายงานอัตโนมัติ</h2>
      <p className="page-sub">
        รายงานจะถูกส่งเป็นไฟล์ CSV ไปที่อีเมลของคุณตามรอบที่ตั้งไว้ ·
        เวลาที่ตั้งเป็นเวลาไทย
      </p>
      <ScheduleManager apiBase={API_BASE} rows={schedules} projects={report.projects} />

      {/* ทางไปตารางไขว้ — คำถามที่สองมิติตอบได้ แต่หน้านี้ตอบไม่ได้ */}
      <p className="pivot-back">
        <TextLink href={`/reports/pivot?range=${encodeURIComponent(range)}`}>
          ดูตารางไขว้ (แยกสองมิติพร้อมกัน)
        </TextLink>
      </p>

      <Table columns={['ความสำคัญ', 'จำนวน']} rowCount={report.byPriority.length}>
        {report.byPriority.map((p) => (
          <tr key={p.name}>
            <td>{p.name}</td>
            <td className="num">{nf(p.opened)}</td>
          </tr>
        ))}
      </Table>

      <h2 className="detail-section-title detail-section-gap">ปิดได้ แยกตามผู้รับผิดชอบ</h2>
      <Table columns={['ผู้รับผิดชอบ', 'จำนวน']} rowCount={report.byAssignee.length}>
        {report.byAssignee.map((a) => (
          <tr key={a.name}>
            <td>{a.name}</td>
            <td className="num">{nf(a.resolved)}</td>
          </tr>
        ))}
      </Table>
    </section>
  );
}
