import type { ReactNode } from 'react';

import { Alert, PageHeader, Table } from '@itsm/ui';

import { apiFetch } from '@/lib/api';

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
function shortDay(key: string): string {
  const [, m, d] = key.split('-');
  return `${String(Number(d))} ${SHORT_MONTH[Number(m) - 1] ?? ''}`;
}

/**
 * แผนภูมิแท่งรายวัน — เปิด กับ ปิด
 *
 * เป็น SVG ในเซิร์ฟเวอร์คอมโพเนนต์ ไม่มี JavaScript ฝั่งเบราว์เซอร์เลย ·
 * คำอธิบายรายแท่งใช้ `<title>` ซึ่งเบราว์เซอร์และ screen reader อ่านได้ทั้งคู่
 * โดยไม่ต้องเขียน tooltip เอง
 *
 * **สีมาจาก semantic token เท่านั้น** (INVARIANT 4) — `--accent-service`
 * กับ `--accent-delivery` เป็นคู่เย็น/อุ่นของระบบ วัดแล้วแยกออกจากกันได้
 * ทั้งสายตาปกติและตาบอดสี ทั้งธีมสว่างและมืด · และมี legend ถาวรกับตาราง
 * ตัวเลขข้างล่างเป็นทางที่สอง ไม่ให้พึ่งสีอย่างเดียว
 */
function DailyChart({ daily }: { daily: DailyPoint[] }): ReactNode {
  const H = 120;
  const STEP = 22;
  const BAR = 9;
  // เผื่อที่ขวาให้ป้ายวันสุดท้าย — text-anchor เป็น middle จึงล้นออกไปครึ่งป้าย
  const W = Math.max(daily.length * STEP, STEP) + 16;
  const peak = Math.max(1, ...daily.map((d) => Math.max(d.opened, d.resolved)));

  /*
    ศูนย์ต้องไม่มีแท่ง และค่าที่มากกว่าศูนย์ต้องมองเห็น

    รอบแรกวาด `rect` ทุกค่ารวมทั้งศูนย์ · `rx` ทำให้แท่งสูงไม่ถึงพิกเซล
    กลายเป็นก้อนกลม ๆ ลอยอยู่บนเส้นฐาน — วันที่ไม่มีงานเลยจึงดูเหมือนมีงาน
    และแยกจากวันที่มีจริงหนึ่งใบไม่ออก
  */
  const h = (v: number): number => (v === 0 ? 0 : Math.max(2, (v / peak) * H));

  /*
    ป้ายแกนนอนทุกแท่งจะทับกันเมื่อช่วงยาว 30 วัน — เว้นระยะให้เหลือราว 6 ป้าย
    การหมุนป้ายเป็นแนวตั้งอ่านยากกว่าสำหรับภาษาไทย เพราะสระอยู่คนละชั้น
  */
  const labelEvery = Math.max(1, Math.ceil(daily.length / 6));

  return (
    <figure className="chart">
      <figcaption className="chart-legend">
        <span>
          <span className="chart-key" data-series="opened" aria-hidden="true" />
          แจ้งเข้ามา
        </span>
        <span>
          <span className="chart-key" data-series="resolved" aria-hidden="true" />
          ปิดได้
        </span>
        <span className="chart-peak">สูงสุด {nf(peak)} เรื่องต่อวัน</span>
      </figcaption>

      <div className="chart-box">
        <svg
          viewBox={`0 0 ${String(W)} ${String(H + 22)}`}
          className="chart-svg"
          role="img"
          aria-label={`จำนวนเรื่องที่แจ้งเข้ามาและปิดได้ รายวัน ${String(daily.length)} วัน`}
        >
          {/* เส้นฐาน — จาง ๆ ไม่แย่งสายตาไปจากแท่ง */}
          <line x1="0" y1={H} x2={W} y2={H} className="chart-axis" />
          {daily.map((d, i) => {
            const x = i * STEP;
            return (
              <g key={d.day}>
                {d.opened === 0 ? null : (
                  <rect
                    x={x + 1}
                    y={H - h(d.opened)}
                    width={BAR}
                    height={h(d.opened)}
                    // มุมมนเฉพาะแท่งที่สูงพอ — แท่งเตี้ยกว่ารัศมีจะกลายเป็นก้อนกลม
                    rx={h(d.opened) >= 6 ? 2 : 0}
                    className="chart-bar"
                    data-series="opened"
                  >
                    <title>{`${shortDay(d.day)} · แจ้งเข้ามา ${nf(d.opened)}`}</title>
                  </rect>
                )}
                {/* ช่องว่าง 2px ระหว่างสองแท่ง — ขอบที่ชนกันทำให้อ่านเป็นแท่งเดียว */}
                {d.resolved === 0 ? null : (
                  <rect
                    x={x + BAR + 3}
                    y={H - h(d.resolved)}
                    width={BAR}
                    height={h(d.resolved)}
                    rx={h(d.resolved) >= 6 ? 2 : 0}
                    className="chart-bar"
                    data-series="resolved"
                  >
                    <title>{`${shortDay(d.day)} · ปิดได้ ${nf(d.resolved)}`}</title>
                  </rect>
                )}
                {i % labelEvery === 0 ? (
                  <text x={x + BAR + 1} y={H + 16} className="chart-tick">
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

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'critical';
}): ReactNode {
  return (
    <div className="stat" {...(tone === undefined ? {} : { 'data-tone': tone })}>
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      {hint === undefined ? null : <span className="stat-hint">{hint}</span>}
    </div>
  );
}

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

      <div className="stat-row">
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
