import type { ReactNode } from 'react';

import { Alert, EmptyState, PageHeader, Table } from '@itsm/ui';

import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface TimeDailyPoint {
  day: string;
  minutes: number;
}

interface TimeBucket {
  name: string;
  minutes: number;
  text: string;
}

interface TimeReport {
  window: { from: string; to: string; label: string };
  projects: string[];
  totalMinutes: number;
  totalText: string;
  contributors: number;
  daily: TimeDailyPoint[];
  byUser: TimeBucket[];
  byProject: TimeBucket[];
  topItems: Array<TimeBucket & { itemKey: string }>;
  itemsNotShown: number;
  ranges: Array<{ key: string; label: string }>;
}

const nf = (n: number): string => n.toLocaleString('th-TH');

const SHORT_MONTH = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

/** `2026-09-10` → `10 ก.ย.` — แกนนอนที่เขียนปีทุกแท่งอ่านไม่ออก */
function shortDay(key: string): string {
  const [, m, d] = key.split('-');
  return `${String(Number(d))} ${SHORT_MONTH[Number(m) - 1] ?? ''}`;
}

/** ชั่วโมงที่อ่านง่ายสำหรับคำบรรยายแท่ง — ตัวเลขนาทีดิบเทียบกันด้วยตายาก */
function hoursText(minutes: number): string {
  const h = minutes / 60;
  return `${h.toLocaleString('th-TH', { maximumFractionDigits: 1 })} ชม.`;
}

/**
 * แผนภูมิแท่งรายวัน — ชุดข้อมูลเดียว
 *
 * ชุดเดียวไม่ต้องมี legend เพราะหัวเรื่องบอกอยู่แล้วว่าคืออะไร · การใส่ legend
 * ให้ชุดเดียวเป็นการเพิ่มสิ่งที่ต้องอ่านโดยไม่บอกอะไรเพิ่ม
 *
 * **สีมาจาก semantic token เท่านั้น** (INVARIANT 4) · ใช้ `--accent-delivery`
 * ตัวเดียวกับกราฟ "ปิดได้" ในหน้ารายงานหลัก เพื่อให้สองหน้าอ่านเป็นภาษาเดียวกัน
 *
 * ตารางตัวเลขข้างล่างเป็นทางที่สอง — ไม่ให้พึ่งการอ่านกราฟอย่างเดียว
 */
function DailyHoursChart({ daily }: { daily: TimeDailyPoint[] }): ReactNode {
  const H = 120;
  const STEP = 18;
  const BAR = 11;
  const W = Math.max(daily.length * STEP, STEP) + 16;
  const peak = Math.max(1, ...daily.map((d) => d.minutes));

  /*
    ศูนย์ต้องไม่มีแท่ง และค่าที่มากกว่าศูนย์ต้องมองเห็น — `rx` ทำให้แท่งที่
    สูงไม่ถึงพิกเซลกลายเป็นก้อนกลมลอยบนเส้นฐาน แล้ววันที่ไม่มีใครบันทึกเลย
    ดูเหมือนมีงาน (บทเรียนจากกราฟหน้ารายงานหลัก)
  */
  const h = (v: number): number => (v === 0 ? 0 : Math.max(2, (v / peak) * H));
  const labelEvery = Math.max(1, Math.ceil(daily.length / 6));

  return (
    <figure className="chart">
      <figcaption className="chart-legend">
        <span className="chart-peak">สูงสุด {hoursText(peak)} ต่อวัน</span>
      </figcaption>

      <div className="chart-box">
        <svg
          viewBox={`0 0 ${String(W)} ${String(H + 22)}`}
          className="chart-svg"
          role="img"
          aria-label={`เวลาที่ทีมบันทึกไว้รายวัน ${String(daily.length)} วัน`}
        >
          <line x1="0" y1={H} x2={W} y2={H} className="chart-axis" />
          {daily.map((d, i) => {
            const x = i * STEP;
            return (
              <g key={d.day}>
                {d.minutes === 0 ? null : (
                  <rect
                    x={x + 1}
                    y={H - h(d.minutes)}
                    width={BAR}
                    height={h(d.minutes)}
                    rx={h(d.minutes) >= 6 ? 2 : 0}
                    className="chart-bar"
                    data-series="resolved"
                  >
                    {/* `<title>` อ่านได้ทั้งด้วยเมาส์และด้วย screen reader */}
                    <title>{`${shortDay(d.day)} · ${hoursText(d.minutes)}`}</title>
                  </rect>
                )}
                {i % labelEvery === 0 ? (
                  <text x={x + BAR / 2 + 1} y={H + 16} className="chart-tick">
                    {shortDay(d.day)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): ReactNode {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      {hint === undefined ? null : <span className="stat-hint">{hint}</span>}
    </div>
  );
}

/**
 * รายงานเวลาของทีม
 *
 * ตอบคำถามเดียว: **เดือนนี้ทีมใช้เวลาไปกับอะไร** · ถ้าตอบไม่ได้ คนจะเลิก
 * บันทึกเวลาภายในสองสัปดาห์ แล้วข้อมูลที่มีอยู่ก็ไร้ค่าไปด้วย
 */
export default async function TimeReportPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const range = sp.range ?? 'this-month';

  let data: TimeReport | null = null;
  let error: string | null = null;
  try {
    const res = await apiFetch(`/api/v1/reports/time?range=${encodeURIComponent(range)}`);
    if (res.ok) data = (await res.json()) as TimeReport;
    else if (res.status === 403) error = 'ยังไม่มีโปรเจกต์ไหนที่คุณดูรายงานได้';
    else error = `โหลดรายงานไม่สำเร็จ (HTTP ${String(res.status)})`;
  } catch {
    error = 'เชื่อมต่อระบบไม่ได้';
  }

  if (data === null) {
    return (
      <section className="page">
        <PageHeader title="เวลาที่ทีมใช้ไป" />
        <Alert tone="error">{error ?? 'เชื่อมต่อระบบไม่ได้'}</Alert>
      </section>
    );
  }

  return (
    <section className="page">
      <PageHeader
        title="เวลาที่ทีมใช้ไป"
        lead={
          <>
            {data.window.label} · นับจาก<strong>เวลาที่ลงมือทำ</strong> ไม่ใช่เวลาที่กดบันทึก ·
            {/* ตัวเลขที่ไม่บอกว่านับจากอะไร ตรวจไม่ได้ */}
            {data.projects.length === 0
              ? ' ไม่มีโปรเจกต์'
              : ` โปรเจกต์ ${data.projects.join(' · ')}`}
          </>
        }
      />

      <nav className="queue-tabs" aria-label="ช่วงเวลา">
        {data.ranges.map((r) => (
          <a
            key={r.key}
            href={`/reports/time?range=${r.key}`}
            aria-current={r.key === range ? 'page' : undefined}
          >
            {r.label}
          </a>
        ))}
      </nav>

      <div className="stat-row">
        <Stat label="รวมทั้งช่วง" value={data.totalText} hint={`${nf(data.totalMinutes)} นาที`} />
        <Stat
          label="คนที่บันทึก"
          value={nf(data.contributors)}
          /* 0 คนกับ 0 นาที เป็นคนละเรื่อง — ตัวเลขนี้จึงแยกออกมา */
          hint="คนที่ลงเวลาอย่างน้อยหนึ่งครั้ง"
        />
        <Stat label="เรื่องที่มีการลงเวลา" value={nf(data.topItems.length + data.itemsNotShown)} />
      </div>

      {data.totalMinutes === 0 ? (
        <EmptyState
          title="ยังไม่มีใครบันทึกเวลาในช่วงนี้"
          body="บันทึกเวลาได้จากแผง “เวลาทำงาน” ที่หน้ารายละเอียดของแต่ละเรื่อง"
        />
      ) : (
        <>
          <h2 className="section-title">รายวัน</h2>
          <DailyHoursChart daily={data.daily} />

          <h2 className="section-title">แยกตามคน</h2>
          <Table
            label="เวลาที่ใช้ไป แยกตามคน"
            columns={['ชื่อ', { label: 'เวลา', align: 'end' }, { label: 'สัดส่วน', align: 'end' }]}
            rowCount={data.byUser.length}
          >
            {data.byUser.map((b) => (
              <tr key={b.name}>
                <td>{b.name}</td>
                <td className="num">{b.text}</td>
                <td className="num">
                  {Math.round((b.minutes / Math.max(1, data.totalMinutes)) * 100)}%
                </td>
              </tr>
            ))}
          </Table>

          <h2 className="section-title">เรื่องที่กินเวลามากที่สุด</h2>
          <Table
            label="เรื่องที่กินเวลามากที่สุด"
            columns={['คีย์', 'เรื่อง', { label: 'เวลา', align: 'end' }]}
            rowCount={data.topItems.length}
          >
            {data.topItems.map((i) => (
              <tr key={i.itemKey}>
                <td>
                  <a href={`/browse/${i.itemKey}`}>{i.itemKey}</a>
                </td>
                <td>{i.name}</td>
                <td className="num">{i.text}</td>
              </tr>
            ))}
          </Table>
          {data.itemsNotShown === 0 ? null : (
            /* ตัดเงียบ ๆ อ่านเหมือนครอบทั้งหมด — บอกจำนวนที่ตัดไปเสมอ */
            <p className="muted">
              ยังมีอีก {nf(data.itemsNotShown)} เรื่องที่ไม่ได้แสดงในตารางนี้
            </p>
          )}
        </>
      )}
    </section>
  );
}
