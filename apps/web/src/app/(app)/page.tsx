import type { ReactNode } from 'react';

import {
  EmptyState,
  StatusPill,
  WorkItemRow,
  type PriorityRank,
  type StatusCategory,
} from '@itsm/ui';

import { toSlaBar } from '@/lib/sla-label';
import { apiFetch } from '@/lib/api';

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
  } | null;
}

const API = process.env['API_BASE_URL'] ?? 'http://localhost:4400';

/**
 * หน้า Agent Queue — หน้าจอที่ Agent เปิดค้างไว้ทั้งวัน
 *
 * Server Component: ดึงข้อมูลฝั่งเซิร์ฟเวอร์ ไม่มี loading spinner ตอนโหลดครั้งแรก
 * ยังไม่มี virtualization — จำเป็นเมื่อคิวเกิน ~200 แถว (ตอนนี้จำกัดที่ 50)
 */
async function fetchQueue(): Promise<{ rows: ApiRow[]; total: number } | { error: string }> {
  try {
    const res = await apiFetch('/api/v1/work-items?project=SD&open=true&limit=50', {
      cache: 'no-store',
    });
    if (!res.ok) {
      return { error: `API ตอบกลับ ${res.status} — ตรวจว่า apps/api รันอยู่ที่ ${API} หรือไม่` };
    }
    return (await res.json()) as { rows: ApiRow[]; total: number };
  } catch {
    return { error: `เชื่อมต่อ API ที่ ${API} ไม่ได้ — รัน \`pnpm --filter @itsm/api dev\` ก่อน` };
  }
}

export default async function QueuePage(): Promise<ReactNode> {
  const data = await fetchQueue();

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
        งานที่เปิดอยู่ทั้งหมด {data.total.toLocaleString('th-TH')} รายการ · แสดง {data.rows.length}{' '}
        รายการแรก เรียงตามการอัปเดตล่าสุด
      </p>

      <div className="toolbar">
        <StatusPill label="ยังไม่เสร็จ" category="TODO" />
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          ทุกคอลัมน์มาจากฐานข้อมูลจริง — รวมถึง <b>SLA ที่คำนวณจากปฏิทินเวลาทำการ</b>{' '}
          และหยุดนาฬิกาเมื่อรอลูกค้าตอบ
        </span>
      </div>

      {data.rows.length === 0 ? (
        <EmptyState
          title="ยังไม่มีงานในคิวนี้"
          body="เมื่อมีผู้แจ้งปัญหาเข้ามา งานจะปรากฏที่นี่โดยอัตโนมัติ"
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
