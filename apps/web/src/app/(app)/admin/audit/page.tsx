import type { ReactNode } from 'react';

import { Alert, EmptyState, PageHeader, Table, Timestamp } from '@itsm/ui';

import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: string | null;
  actorRemoved: boolean;
  payload: unknown;
  createdAt: string;
}

interface Page {
  rows: Row[];
  total: number;
  offset: number;
  actions: string[];
  max: number;
}

const RANGES = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'today', label: 'วันนี้' },
  { key: '7d', label: '7 วัน' },
  { key: '30d', label: '30 วัน' },
] as const;

/** ลิงก์ที่พาตัวกรองไปด้วยเสมอ — ลืมพาไป การกดหน้าถัดไปจะล้างเงื่อนไขเงียบ ๆ */
function href(action: string, range: string, offset: number): string {
  const p = new URLSearchParams();
  if (action !== '') p.set('action', action);
  if (range !== 'all') p.set('range', range);
  if (offset > 0) p.set('offset', String(offset));
  const qs = p.toString();
  return qs === '' ? '/admin/audit' : `/admin/audit?${qs}`;
}

/** ย่อ payload ให้อ่านได้ในหนึ่งบรรทัด — รายละเอียดเต็มอยู่ใน title */
function summarize(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return '—';
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length === 0) return '—';
  /*
    แปลงจากชนิดที่รู้แน่เท่านั้น — `String(unknown)` ให้ `[object Object]`
    เมื่อค่าเป็น object ซึ่งอ่านแล้วไม่ได้อะไรเลย (บทเรียนที่ CLAUDE.md บันทึกไว้
    และ lint จับได้จริงตอนเขียนบรรทัดนี้)
  */
  const asText = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v === null || v === undefined) return '—';
    return JSON.stringify(v);
  };
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${asText(v)}`)
    .join(' · ');
}

/**
 * หน้าอ่าน audit log
 *
 * INVARIANT 2 บังคับให้ทุก mutation เขียน audit มาตลอด แต่ไม่มีใครอ่านได้
 * จากหน้าจอ — ระบบ ITSM ที่ตอบไม่ได้ว่า "ใครเปลี่ยนอะไรเมื่อไร" โดยไม่ต้อง
 * เปิดฐานข้อมูล ไม่ต่างจากระบบที่ไม่ได้เก็บ เพราะไม่มีใครไปหา
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; range?: string; offset?: string }>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const action = sp.action ?? '';
  const range = sp.range ?? 'all';
  const offset = Math.max(0, Math.floor(Number(sp.offset ?? 0)) || 0);

  let data: Page | null = null;
  let error: string | null = null;
  try {
    const q = new URLSearchParams();
    if (action !== '') q.set('action', action);
    if (range !== 'all') q.set('range', range);
    if (offset > 0) q.set('offset', String(offset));
    const res = await apiFetch(`/api/v1/admin/audit?${q.toString()}`);
    if (res.ok) data = (await res.json()) as Page;
    else if (res.status === 403) error = 'ต้องเป็นผู้ดูแลระบบจึงจะดูร่องรอยการใช้งานได้';
    else error = `โหลดไม่สำเร็จ (HTTP ${String(res.status)})`;
  } catch {
    error = 'เชื่อมต่อระบบไม่ได้';
  }

  if (data === null) {
    return (
      <section className="page">
        <PageHeader title="ร่องรอยการใช้งาน" />
        <Alert tone="error">{error ?? 'เชื่อมต่อระบบไม่ได้'}</Alert>
      </section>
    );
  }

  const last = Math.max(1, Math.ceil(data.total / data.max));
  const page = Math.min(Math.floor(offset / data.max) + 1, last);

  return (
    <section className="page">
      <PageHeader
        title="ร่องรอยการใช้งาน"
        lead={
          <>
            ทุกการเปลี่ยนแปลงในระบบถูกบันทึกไว้ ทั้งหมด{' '}
            {data.total.toLocaleString('th-TH')} รายการ
            {data.rows.length === 0 ? null : (
              <>
                {' '}
                · แสดงรายการที่ {(offset + 1).toLocaleString('th-TH')}–
                {(offset + data.rows.length).toLocaleString('th-TH')}
              </>
            )}
          </>
        }
      />

      <nav className="queue-tabs" aria-label="ช่วงเวลา">
        {RANGES.map((r) => (
          <a
            key={r.key}
            href={href(action, r.key, 0)}
            aria-current={r.key === range ? 'page' : undefined}
          >
            {r.label}
          </a>
        ))}
      </nav>

      {/* ตัวกรองสร้างจากชนิดที่มีอยู่จริง ไม่ใช่รายการที่หน้าจอเขียนเอง */}
      <nav className="audit-actions" aria-label="ชนิดของการกระทำ">
        <a href={href('', range, 0)} aria-current={action === '' ? 'page' : undefined}>
          ทุกชนิด
        </a>
        {data.actions.map((a) => (
          <a key={a} href={href(a, range, 0)} aria-current={a === action ? 'page' : undefined}>
            {a}
          </a>
        ))}
      </nav>

      {data.rows.length === 0 ? (
        <EmptyState
          title={action === '' && range === 'all' ? 'ยังไม่มีร่องรอย' : 'ไม่มีรายการที่ตรงเงื่อนไข'}
          body={
            /*
              แยก "กรองแคบเกินไป" ออกจาก "ไม่เคยมีใครทำอะไร" — ข้อความเดียวกัน
              ทำให้ผู้ตรวจสอบสรุปผิดว่าระบบไม่มีกิจกรรม
            */
            action === '' && range === 'all'
              ? 'เมื่อมีการเปลี่ยนแปลงในระบบ รายการจะปรากฏที่นี่โดยอัตโนมัติ'
              : `ระบบมีกิจกรรม ${data.actions.length.toLocaleString('th-TH')} ชนิด — ลองผ่อนเงื่อนไขลง`
          }
        />
      ) : (
        <Table
          columns={['เวลา', 'ใครทำ', 'ทำอะไร', 'กับอะไร', 'รายละเอียด']}
          rowCount={data.rows.length}
        >
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Timestamp utc={r.createdAt} />
              </td>
              <td>
                {r.actor ?? 'ระบบ'}
                {/* บัญชีถูกลบแล้ว แต่ร่องรอยยังตอบได้ว่าใครทำ — ต่างจากระบบทำเอง */}
                {r.actorRemoved ? <span className="cfg-implied"> · ลบบัญชีแล้ว</span> : null}
              </td>
              <td>{r.action}</td>
              <td>
                {r.entityType} #{r.entityId}
              </td>
              <td title={JSON.stringify(r.payload)}>{summarize(r.payload)}</td>
            </tr>
          ))}
        </Table>
      )}

      {data.total <= data.max ? null : (
        <nav className="pager" aria-label="แบ่งหน้า">
          <a
            href={href(action, range, Math.max(0, offset - data.max))}
            data-disabled={offset === 0 ? 'true' : undefined}
            aria-disabled={offset === 0 ? 'true' : undefined}
          >
            ← ก่อนหน้า
          </a>
          <span>
            หน้า {page.toLocaleString('th-TH')} จาก {last.toLocaleString('th-TH')}
          </span>
          <a
            href={href(action, range, offset + data.max)}
            data-disabled={offset + data.max >= data.total ? 'true' : undefined}
            aria-disabled={offset + data.max >= data.total ? 'true' : undefined}
          >
            ถัดไป →
          </a>
        </nav>
      )}
    </section>
  );
}
