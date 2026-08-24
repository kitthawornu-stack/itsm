import type { ReactNode } from 'react';

import {
  EmptyState,
  StatusPill,
  WorkItemRow,
  type PriorityRank,
  type StatusCategory,
} from '@itsm/ui';

interface ApiRow {
  id: string;
  itemKey: string;
  summary: string;
  status: { name: string; category: string; pausesSla: boolean };
  priority: { rank: number; name: string } | null;
  assignee: { name: string } | null;
  updatedAt: string;
}

const API = process.env['API_BASE_URL'] ?? 'http://localhost:4000';

/**
 * หน้า Agent Queue — หน้าจอที่ Agent เปิดค้างไว้ทั้งวัน
 *
 * Server Component: ดึงข้อมูลฝั่งเซิร์ฟเวอร์ ไม่มี loading spinner ตอนโหลดครั้งแรก
 * ยังไม่มี virtualization — จำเป็นเมื่อคิวเกิน ~200 แถว (ตอนนี้จำกัดที่ 50)
 */
async function fetchQueue(): Promise<{ rows: ApiRow[]; total: number } | { error: string }> {
  try {
    const res = await fetch(`${API}/api/v1/work-items?project=SD&open=true&limit=50`, {
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

/**
 * ⚠️ **SLA จำลอง — ยังไม่ใช่ของจริง**
 *
 * SLA Engine ตัวจริงยังไม่ได้สร้าง (อยู่ใน Phase 1) ฟังก์ชันนี้กระจายสถานะ
 * แบบกำหนดค่าได้จากคีย์งาน เพื่อให้เห็นคอมโพเนนต์ SlaBar ครบทุกสถานะ
 *
 * ความพยายามแรกใช้ `updatedAt` ตรง ๆ แต่ seed data กระจายตลอดปี
 * ผลคือ 40 จาก 50 แถวขึ้น "เหลือ 0 นาที" สีแดงหมด — หน้าจอที่ทุกอย่างวิกฤต
 * คือหน้าจอที่ไม่บอกอะไรเลย ซึ่งขัดกับหลักการ "สถานะต้องอ่านได้ใน 1 วินาที"
 */
function placeholderSla(
  itemKey: string,
  rank: number,
): { elapsedRatio: number; state: 'ok' | 'warning' | 'critical' | 'paused'; label: string } {
  let h = 0;
  for (let i = 0; i < itemKey.length; i += 1) h = (h * 31 + itemKey.charCodeAt(i)) % 100_000;

  const budgetHours = rank <= 1 ? 2 : rank === 2 ? 8 : 24;
  // งานสำคัญมีโอกาสใกล้หลุดสูงกว่า ซึ่งสะท้อนความเป็นจริง
  const ratio = ((h % 100) / 100) * (rank <= 2 ? 1 : 0.8);
  const remainingH = budgetHours * (1 - ratio);

  const fmt = (hours: number): string =>
    hours < 1 ? `เหลือ ${Math.max(1, Math.round(hours * 60))} นาที` : `เหลือ ${hours.toFixed(1)} ชม.`;

  if (ratio >= 0.9) return { elapsedRatio: ratio, state: 'critical', label: fmt(remainingH) };
  if (ratio >= 0.7) return { elapsedRatio: ratio, state: 'warning', label: fmt(remainingH) };
  return { elapsedRatio: ratio, state: 'ok', label: fmt(remainingH) };
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
          คีย์ · หัวข้อ · สถานะ · ความสำคัญ · ผู้รับผิดชอบ มาจาก MySQL จริงผ่าน REST API ·{' '}
          <b style={{ color: 'var(--status-warning)' }}>คอลัมน์ SLA เป็นค่าจำลอง</b>{' '}
          เพราะ SLA Engine อยู่ใน Phase 1
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
              sla={
                r.status.pausesSla
                  ? { elapsedRatio: 0.4, state: 'paused', label: '⏸ หยุดนาฬิกา' }
                  : placeholderSla(r.itemKey, r.priority?.rank ?? 5)
              }
            />
            </a>
          ))}
        </div>
      )}
    </>
  );
}
