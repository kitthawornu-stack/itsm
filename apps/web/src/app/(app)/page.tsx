import type { ReactNode } from 'react';

import {
  EmptyState,
  StatusPill,
  WorkItemRow,
  type PriorityRank,
  type StatusCategory,
} from '@itsm/ui';

import { HqlBar } from '@/components/hql-bar';
import { toSlaBar } from '@/lib/sla-label';
import { API_BASE, apiFetch } from '@/lib/api';

interface ApiRow {
  id: string;
  itemKey: string;
  summary: string;
  status: { name: string; category: string; pausesSla: boolean };
  priority: { rank: number; name: string } | null;
  assignee: { name: string } | null;
  updatedAt: string;
  sla: {
    goalName: string;
    state: 'not-started' | 'running' | 'paused' | 'met' | 'breached';
    elapsedMs: number;
    targetMs: number;
    remainingMs: number;
    breachAt: string | null;
    breachedAt: string | null;
    ratio: number;
    isBreached: boolean;
    trusted: boolean;
  } | null;
}

// ที่อยู่ฝั่งเบราว์เซอร์ — ต่างจากที่ server component ใช้ ดู lib/api.ts
const API = API_BASE;

/**
 * หน้า Agent Queue — หน้าจอที่ Agent เปิดค้างไว้ทั้งวัน
 *
 * Server Component: ดึงข้อมูลฝั่งเซิร์ฟเวอร์ ไม่มี loading spinner ตอนโหลดครั้งแรก
 * ยังไม่มี virtualization — จำเป็นเมื่อคิวเกิน ~200 แถว (ตอนนี้จำกัดที่ 50)
 */
/**
 * มุมมองของคิว
 *
 * `assigned` กับ `reported` เป็นคนละคำถาม: "งานที่ฉันต้องทำ" กับ
 * "เรื่องที่ฉันแจ้งไว้" · คนคนเดียวกันอยากเห็นทั้งสองอย่างในเวลาต่างกัน
 */
const VIEWS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'assigned', label: 'งานของฉัน' },
  { key: 'reported', label: 'เรื่องที่ฉันแจ้ง' },
] as const;

type ViewKey = (typeof VIEWS)[number]['key'];

/**
 * **เมื่อผู้ใช้เขียนคิวรีเอง ตัวกรองปริยายที่มองไม่เห็นต้องหลุดออกไป**
 *
 * ปกติคิวนี้บังคับ `project=SD` และ `open=true` ไว้เงียบ ๆ · ถ้ายังบังคับต่อ
 * ตอนมี HQL คิวรีอย่าง `status = เสร็จแล้ว` หรือ `project = PLAT` จะคืนศูนย์แถว
 * เสมอ ทั้งที่เขียนถูกทุกตัวอักษร — ผู้ใช้จะสรุปว่า "ไม่มีข้อมูล" หรือ
 * "ภาษานี้พัง" ซึ่งผิดทั้งคู่ และไม่มีอะไรบนหน้าจอบอกว่ามีตัวกรองซ้อนอยู่
 *
 * มุมมอง (`mine`) ยังบังคับต่อ เพราะแท็บที่ถูกเลือกอยู่บนหน้าจอ — ผู้ใช้เห็นว่ามันทำงานอยู่
 */
async function fetchQueue(
  mine: ViewKey,
  hql: string,
): Promise<{ rows: ApiRow[]; total: number; hqlError?: string } | { error: string }> {
  try {
    const params = new URLSearchParams({ limit: '50' });
    if (hql === '') {
      params.set('project', 'SD');
      params.set('open', 'true');
    } else {
      params.set('hql', hql);
    }
    if (mine !== '') params.set('mine', mine);

    const res = await apiFetch(`/api/v1/work-items?${params.toString()}`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      /*
        **ระบบค้นหาล่มไม่ใช่ระบบล่ม** — และไม่ใช่ความผิดของสิ่งที่ผู้ใช้เพิ่งพิมพ์

        503 จาก `search_index_not_ready` เคยตกลงมาที่กล่องเดียวกับ "ต่อ API ไม่ได้"
        ผลคือหน้าจอกลืนคิวทั้งหน้าแล้วบอกให้ไปรัน `pnpm --filter @itsm/api dev`
        ทั้งที่ API ตอบอยู่ดี ๆ — คำแนะนำที่ชี้ผิดทางแย่กว่าไม่แนะนำอะไรเลย
        เพราะคนจะไปไล่แก้สิ่งที่ไม่ได้พัง

        คืนเป็น `hqlError` เพื่อให้คิวยังอยู่ และข้อความไปอยู่ข้างช่องกรอก
      */
      const detail = (await res.json().catch(() => null)) as { message?: string } | null;
      if (hql !== '' && typeof detail?.message === 'string') {
        return { rows: [], total: 0, hqlError: detail.message };
      }
      return { error: `API ตอบกลับ ${res.status} — ตรวจว่า apps/api รันอยู่ที่ ${API} หรือไม่` };
    }
    return (await res.json()) as { rows: ApiRow[]; total: number; hqlError?: string };
  } catch {
    return { error: `เชื่อมต่อ API ที่ ${API} ไม่ได้ — รัน \`pnpm --filter @itsm/api dev\` ก่อน` };
  }
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string; hql?: string }>;
}): Promise<ReactNode> {
  const { mine, hql } = await searchParams;
  // ค่าที่ไม่รู้จักตกกลับเป็น "ทั้งหมด" — ตัวกรองที่เดาเองทำให้เห็นรายการผิด
  const view: ViewKey = mine === 'assigned' || mine === 'reported' ? mine : '';
  const query = (hql ?? '').trim();
  const data = await fetchQueue(view, query);

  if ('error' in data) {
    return (
      <>
        <h1 className="page-title">คิวงาน</h1>
        <div className="error-box">
          <b>เชื่อมต่อระบบไม่ได้</b>
          <br />
          {data.error}
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">คิวงาน · IT Service Desk</h1>
      <p className="page-lead">
        {query === '' ? (
          <>
            งานที่เปิดอยู่ทั้งหมด {data.total.toLocaleString('th-TH')} รายการ · แสดง{' '}
            {data.rows.length} รายการแรก เรียงตามการอัปเดตล่าสุด
          </>
        ) : (
          <>
            {/*
              **ไม่บอกยอดรวมตอนค้นด้วยคิวรี** — เพราะเราไม่รู้ยอดรวมจริง
              เส้นทาง HQL คัดจากดัชนีมาไม่เกิน 50 คีย์ก่อน แล้วค่อยนับใน MySQL
              ยอดที่ได้จึงเท่ากับจำนวนที่แสดงเสมอ · เขียนว่า "ทั้งหมด 50 รายการ"
              คือการรายงานเพดานเป็นคำตอบ ซึ่งอ่านเหมือนข้อเท็จจริง
            */}
            แสดง {data.rows.length.toLocaleString('th-TH')} รายการ (สูงสุด 50 ต่อครั้ง) ·{' '}
            <b>คิวรีแทนตัวกรองปริยายทั้งหมด</b> — ไม่ได้จำกัดเฉพาะโปรเจกต์ IT Service Desk
            และไม่ได้ตัดงานที่ปิดแล้วออก
          </>
        )}
      </p>

      {/* ลิงก์ธรรมดา ไม่ใช่ปุ่ม JavaScript — มุมมองคือสถานะของหน้า
          จึงต้องอยู่ใน URL ให้บุ๊กมาร์กและกดย้อนกลับได้
          คิวรีติดไปกับลิงก์ด้วย เพราะการสลับมุมมองไม่ควรลบสิ่งที่พิมพ์ไว้ */}
      <nav className="queue-tabs" aria-label="มุมมองคิวงาน">
        {VIEWS.map((v) => {
          const p = new URLSearchParams();
          if (v.key !== '') p.set('mine', v.key);
          if (query !== '') p.set('hql', query);
          const qs = p.toString();
          return (
            <a
              key={v.key}
              href={qs === '' ? '/' : `/?${qs}`}
              aria-current={v.key === view ? 'page' : undefined}
            >
              {v.label}
            </a>
          );
        })}
      </nav>

      <HqlBar apiBase={API} value={query} {...(data.hqlError === undefined ? {} : { error: data.hqlError })} />

      {/*
        ป้าย "ยังไม่เสร็จ" อธิบายตัวกรองปริยาย ซึ่งไม่ได้ทำงานตอนมีคิวรี
        ปล่อยไว้จะกลายเป็นป้ายที่โกหก: หน้าจอโชว์งานที่ปิดแล้วอยู่ใต้ป้ายที่บอกว่ายังไม่เสร็จ
      */}
      {query === '' ? (
        <div className="toolbar">
          <StatusPill label="ยังไม่เสร็จ" category="TODO" />
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            ทุกคอลัมน์มาจากฐานข้อมูลจริง — รวมถึง <b>SLA ที่คำนวณจากปฏิทินเวลาทำการ</b>{' '}
            และหยุดนาฬิกาเมื่อรอลูกค้าตอบ
          </span>
        </div>
      ) : null}

      {data.rows.length === 0 ? (
        <EmptyState
          title={
            data.hqlError !== undefined
              ? 'คิวรียังใช้ไม่ได้'
              : query !== ''
                ? 'ไม่มีงานที่ตรงกับคิวรีนี้'
                : view === 'assigned'
                  ? 'ยังไม่มีงานที่มอบหมายให้คุณ'
                  : view === 'reported'
                    ? 'คุณยังไม่ได้แจ้งเรื่องไว้'
                    : 'ยังไม่มีงานในคิวนี้'
          }
          body={
            data.hqlError !== undefined
              ? 'แก้คิวรีตามข้อความข้างช่องกรอกแล้วลองใหม่'
              : query !== ''
                ? 'ลองผ่อนเงื่อนไขลง หรือกด "ล้าง" เพื่อกลับไปดูคิวปกติ'
                : view === 'reported'
                  ? 'เมื่อแจ้งปัญหาเข้ามา เรื่องของคุณจะอยู่ที่นี่'
                  : 'เมื่อมีผู้แจ้งปัญหาเข้ามา งานจะปรากฏที่นี่โดยอัตโนมัติ'
          }
        />
      ) : (
        <div className="queue">
          <div className="queue-head">
            <span>คีย์</span>
            <span>หัวข้อ</span>
            <span>ความสำคัญ</span>
            <span>สถานะ</span>
            <span />
            <span>เหลือถึงกำหนด</span>
          </div>
          {data.rows.map((r) => (
            <a key={r.id} href={`/browse/${r.itemKey}`} className="queue-link">
            <WorkItemRow
              itemKey={r.itemKey}
              summary={r.summary}
              priority={{
                rank: (r.priority?.rank ?? 5) as PriorityRank,
                label: r.priority?.name ?? 'ไม่ระบุ',
              }}
              status={{
                label: r.status.name,
                category: r.status.category as StatusCategory,
                pausesSla: r.status.pausesSla,
              }}
              {...(r.assignee === null ? {} : { assignee: r.assignee.name })}
              {...(r.sla === null ? {} : { sla: toSlaBar(r.sla) })}
            />
            </a>
          ))}
        </div>
      )}
    </>
  );
}
