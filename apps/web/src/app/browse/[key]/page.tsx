import type { ReactNode } from 'react';

import {
  Avatar,
  PriorityIndicator,
  SlaBar,
  StatusPill,
  type PriorityRank,
  type StatusCategory,
} from '@itsm/ui';

import { CommentThread } from '@/components/comment-thread';
import { toSlaBar, type SlaSnapshotView } from '@/lib/sla-label';

import { TransitionButtons } from '@/components/transition-buttons';

interface HistoryRow {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  actor: string;
  createdAt: string;
}

interface Detail {
  itemKey: string;
  summary: string;
  projectKey: string;
  issueType: string;
  status: { name: string; category: string };
  sla: (SlaSnapshotView & { goalName: string }) | null;
  priority: { rank: number; name: string } | null;
  assignee: string | null;
  reporter: string;
  createdAt: string;
  updatedAt: string;
  transitions: Array<{ id: string; name: string }>;
  history: HistoryRow[];
}

const API = process.env['API_BASE_URL'] ?? 'http://localhost:4000';

const FIELD_LABEL: Record<string, string> = {
  status: 'สถานะ',
  __transition__: 'การดำเนินการ',
  assignee: 'ผู้รับผิดชอบ',
  resolvedAt: 'เวลาที่แก้เสร็จ',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  });
}

/**
 * หน้ารายละเอียดงาน — สามชั้นของการเปิดเผยข้อมูล (master-plan 7.1)
 *
 *   หัว    ข้อมูลที่ใช้ตัดสินใจใน 3 วินาที + ปุ่มดำเนินการ
 *   ลำตัว  บริบทและไทม์ไลน์
 *   ข้าง   metadata ที่ดูเมื่อจำเป็น
 *
 * ปุ่มดำเนินการอยู่มุมบนขวาเสมอ ตำแหน่งเดียวกันทุกประเภทงาน
 */
export default async function WorkItemDetail({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<ReactNode> {
  const { key } = await params;

  let detail: Detail | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(`${API}/api/v1/work-items/${key}`, { cache: 'no-store' });
    if (res.ok) detail = (await res.json()) as Detail;
    else error = `API ตอบกลับ ${res.status}`;
  } catch {
    error = `เชื่อมต่อ API ที่ ${API} ไม่ได้`;
  }

  if (detail === null || 'error' in detail) {
    return (
      <>
        <h1 className="page-title">{key}</h1>
        <div className="error-box">ไม่พบงาน {key} · {error ?? 'งานนี้อาจถูกลบหรือคุณไม่มีสิทธิ์เข้าถึง'}</div>
      </>
    );
  }

  return (
    <>
      <nav className="detail-crumb">
        <a href="/">คิวงาน</a>
        <span>/</span>
        <span>{detail.projectKey}</span>
        <span>/</span>
        <span>{detail.issueType}</span>
        <span>/</span>
        <b>{detail.itemKey}</b>
      </nav>

      <div className="detail-head">
        <div className="detail-head-main">
          <div className="detail-head-meta">
            {detail.priority === null ? null : (
              <PriorityIndicator
                rank={detail.priority.rank as PriorityRank}
                label={detail.priority.name}
              />
            )}
            <StatusPill
              label={detail.status.name}
              category={detail.status.category as StatusCategory}
            />
          </div>
          <h1 className="detail-title">{detail.summary}</h1>
          {detail.sla === null ? (
            // งานที่ไม่มีนาฬิกาต้องบอกให้รู้ ไม่ใช่ไม่แสดงอะไรเลย
            // ช่องว่างตรงนี้ทำให้ดูเหมือน "ยังไม่หลุด" ทั้งที่แปลว่า "ไม่มีใครจับเวลาอยู่"
            <p className="detail-sla-none">ยังไม่มีข้อตกลงบริการผูกกับงานใบนี้</p>
          ) : (
            <div className="detail-sla">
              <span className="detail-sla-goal">{detail.sla.goalName}</span>
              <SlaBar {...toSlaBar(detail.sla)} />
            </div>
          )}
        </div>
        <TransitionButtons
          itemKey={detail.itemKey}
          transitions={detail.transitions}
          apiBase={API}
        />
      </div>

      <div className="detail-body">
        <section>
          <h2 className="detail-section-title">บทสนทนา</h2>
          <CommentThread apiBase={API} itemKey={detail.itemKey} />

          <h2 className="detail-section-title detail-section-gap">ไทม์ไลน์</h2>
          {detail.history.length === 0 ? (
            <p className="detail-no-action">
              ยังไม่มีการเปลี่ยนแปลง — ประวัติจะถูกบันทึกอัตโนมัติทุกครั้งที่สถานะหรือฟิลด์เปลี่ยน
            </p>
          ) : (
            <ol className="timeline">
              {detail.history.map((h) => (
                <li key={h.id} className="timeline-item">
                  <Avatar name={h.actor} tone={h.actor === 'ระบบ' ? 'neutral' : 'service'} />
                  <div>
                    <div className="timeline-line">
                      <b>{h.actor}</b>
                      <span className="timeline-time">{formatTime(h.createdAt)}</span>
                    </div>
                    <div className="timeline-detail">
                      {h.field === '__transition__' ? (
                        <>
                          ดำเนินการ <b>{h.newValue}</b>
                        </>
                      ) : (
                        <>
                          เปลี่ยน {FIELD_LABEL[h.field] ?? h.field}
                          {h.oldValue === null ? null : (
                            <>
                              {' '}
                              จาก <b>{h.oldValue}</b>
                            </>
                          )}{' '}
                          เป็น <b>{h.newValue ?? 'ว่าง'}</b>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="detail-side">
          <h2 className="detail-section-title">รายละเอียด</h2>
          <dl className="detail-fields">
            <dt>สถานะ</dt>
            <dd>
              <StatusPill
                label={detail.status.name}
                category={detail.status.category as StatusCategory}
              />
            </dd>
            <dt>ผู้รับผิดชอบ</dt>
            <dd>{detail.assignee ?? <span className="detail-empty">ยังไม่มี</span>}</dd>
            <dt>ผู้แจ้ง</dt>
            <dd>{detail.reporter}</dd>
            <dt>ประเภทงาน</dt>
            <dd>{detail.issueType}</dd>
            <dt>ความสำคัญ</dt>
            <dd>{detail.priority?.name ?? <span className="detail-empty">ไม่ระบุ</span>}</dd>
            <dt>สร้างเมื่อ</dt>
            <dd>{formatTime(detail.createdAt)}</dd>
            <dt>อัปเดตล่าสุด</dt>
            <dd>{formatTime(detail.updatedAt)}</dd>
          </dl>
        </aside>
      </div>
    </>
  );
}
