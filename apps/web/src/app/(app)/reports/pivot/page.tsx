import type { ReactNode } from 'react';

import { Alert, PageHeader, Table, TextLink } from '@itsm/ui';

import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PivotRow {
  label: string;
  cells: number[];
  total: number;
}

interface Pivot {
  columns: string[];
  rows: PivotRow[];
  columnTotals: number[];
  grandTotal: number;
  truncatedColumns: number;
  rowDimension: string;
  columnDimension: string;
  dimensions: Array<{ key: string; label: string }>;
}

const RANGES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'this-month', label: 'เดือนนี้' },
  { key: 'last-month', label: 'เดือนที่แล้ว' },
  { key: 'last-7-days', label: '7 วันล่าสุด' },
  { key: 'last-30-days', label: '30 วันล่าสุด' },
];

/** ลิงก์ที่เปลี่ยนทีละอย่าง โดยคงตัวเลือกอื่นไว้ */
function href(now: { rows: string; cols: string; range: string }, patch: Partial<typeof now>): string {
  const q = new URLSearchParams({ ...now, ...patch });
  return `/reports/pivot?${q.toString()}`;
}

/**
 * ตารางไขว้
 *
 * **ตัวเลือกอยู่ใน URL** เหมือนหน้ากระดาน — แชร์ลิงก์ให้คนอื่นเห็นตาราง
 * เดียวกันได้ และกดปุ่มย้อนกลับได้ตามปกติ · ไม่ต้องมี JavaScript
 */
export default async function PivotPage({
  searchParams,
}: {
  searchParams: Promise<{ rows?: string; cols?: string; range?: string }>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const now = {
    rows: sp.rows ?? 'assignee',
    cols: sp.cols ?? 'status',
    range: sp.range ?? 'this-month',
  };

  let data: Pivot | null = null;
  let error: string | null = null;
  try {
    const q = new URLSearchParams(now);
    const res = await apiFetch(`/api/v1/reports/pivot?${q.toString()}`);
    if (res.ok) data = (await res.json()) as Pivot;
    else {
      /*
        ใช้ข้อความของเซิร์ฟเวอร์ก่อนเสมอ · 422 เกิดได้ทั้งจากมิติที่ไม่รู้จัก
        และจากแถวกับคอลัมน์ที่ซ้ำกัน ซึ่งผู้ใช้ต้องทำต่อคนละแบบ
      */
      const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
      error =
        typeof body?.message === 'string'
          ? body.message
          : `โหลดไม่สำเร็จ (HTTP ${String(res.status)})`;
    }
  } catch {
    error = 'เชื่อมต่อระบบไม่ได้';
  }

  if (data === null) {
    return (
      <section className="page">
        <PageHeader title="ตารางไขว้" />
        <Alert tone="error">{error ?? 'เชื่อมต่อระบบไม่ได้'}</Alert>
        <p className="pivot-back">
          <TextLink href="/reports">กลับไปหน้ารายงาน</TextLink>
        </p>
      </section>
    );
  }

  const t = data;
  const rowLabel = t.dimensions.find((d) => d.key === t.rowDimension)?.label ?? t.rowDimension;

  return (
    <section className="page">
      <PageHeader
        title="ตารางไขว้"
        lead={`${t.grandTotal.toLocaleString('th-TH')} เรื่องที่แจ้งเข้าในช่วงที่เลือก`}
      />

      {/* เลือกมิติของแถว · มิติที่กำลังใช้ไม่เป็นลิงก์ เพราะกดแล้วไม่ไปไหน */}
      <p className="pivot-pick">
        <span className="pivot-pick-label">แถว</span>
        {t.dimensions.map((d) =>
          d.key === t.rowDimension ? (
            <strong key={d.key}>{d.label}</strong>
          ) : (
            <TextLink key={d.key} href={href(now, { rows: d.key })}>
              {d.label}
            </TextLink>
          ),
        )}
      </p>

      <p className="pivot-pick">
        <span className="pivot-pick-label">คอลัมน์</span>
        {t.dimensions.map((d) =>
          d.key === t.columnDimension ? (
            <strong key={d.key}>{d.label}</strong>
          ) : (
            <TextLink key={d.key} href={href(now, { cols: d.key })}>
              {d.label}
            </TextLink>
          ),
        )}
      </p>

      <p className="pivot-pick">
        <span className="pivot-pick-label">ช่วงเวลา</span>
        {RANGES.map((r) =>
          r.key === now.range ? (
            <strong key={r.key}>{r.label}</strong>
          ) : (
            <TextLink key={r.key} href={href(now, { range: r.key })}>
              {r.label}
            </TextLink>
          ),
        )}
      </p>

      {/*
        **บอกตรง ๆ เมื่อตัดคอลัมน์** · ตารางที่ตัดเงียบ ๆ ทำให้คนเชื่อว่า
        นั่นคือทั้งหมดแล้วสรุปผิด — และยอดรวมยังนับของที่ถูกตัดอยู่
        จึงต้องอธิบายว่าทำไมผลบวกของคอลัมน์ถึงน้อยกว่ายอดรวม
      */}
      {t.truncatedColumns === 0 ? null : (
        <Alert tone="warning">
          คอลัมน์มีมากกว่าที่แสดงได้ — ซ่อนไว้ {t.truncatedColumns.toLocaleString('th-TH')} คอลัมน์
          ที่มีงานน้อยที่สุด · ยอดรวมด้านล่างยังนับรวมของที่ซ่อนไว้ด้วย
        </Alert>
      )}

      {/*
        ตารางกว้างได้มาก จึงเลื่อนในกล่องของตัวเอง ไม่ใช่ดันทั้งหน้าให้เลื่อน
      */}
      <div className="pivot-scroll">
        <Table
          columns={[rowLabel, ...t.columns, 'รวม']}
          rowCount={t.rows.length}
          empty="ไม่มีงานในช่วงเวลาที่เลือก"
        >
          {t.rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="pivot-rowhead">
                {r.label}
              </th>
              {r.cells.map((n, i) => (
                <td key={t.columns[i] ?? String(i)} className="pivot-num">
                  {/*
                    ศูนย์แสดงเป็นขีด ไม่ใช่ "0" · ตารางที่เต็มไปด้วยเลขศูนย์
                    ทำให้ตัวเลขจริงกลืนหายไป · แต่ช่องยังอยู่ครบ
                  */}
                  {n === 0 ? '–' : n.toLocaleString('th-TH')}
                </td>
              ))}
              <td className="pivot-num pivot-total">{r.total.toLocaleString('th-TH')}</td>
            </tr>
          ))}
          <tr className="pivot-footrow">
            <th scope="row">รวม</th>
            {t.columnTotals.map((n, i) => (
              <td key={t.columns[i] ?? String(i)} className="pivot-num pivot-total">
                {n.toLocaleString('th-TH')}
              </td>
            ))}
            <td className="pivot-num pivot-total">{t.grandTotal.toLocaleString('th-TH')}</td>
          </tr>
        </Table>
      </div>

      <p className="pivot-back">
        <TextLink href="/reports">กลับไปหน้ารายงาน</TextLink>
      </p>
    </section>
  );
}
