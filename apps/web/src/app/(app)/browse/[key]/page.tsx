import type { ReactNode } from 'react';

import {
  Avatar,
  PriorityIndicator,
  SlaBar,
  StatusPill,
  Timestamp,
  type PriorityRank,
  type StatusCategory,
} from '@itsm/ui';

import { AssignControl } from '@/components/assign-control';
import { EditItem } from '@/components/edit-item';
import { CommentThread } from '@/components/comment-thread';
import { ApprovalPanel } from '@/components/approval-panel';
import { AttachmentPanel } from '@/components/attachment-panel';
import { ChangeWindowPanel } from '@/components/change-window-panel';
import { RatingForm, type Satisfaction } from '@/components/rating-form';
import { toSlaBar, type SlaSnapshotView } from '@/lib/sla-label';

import { ArticlePanel, type AttachedArticle } from '@/components/article-panel';
import { HierarchyPanel, type ChildRow, type ParentRow } from '@/components/hierarchy-panel';
import { LinkPanel, type LinkRow } from '@/components/link-panel';
import { ItemCiPanel } from '@/components/item-ci-panel';
import { ProblemImpactPanel } from '@/components/problem-impact-panel';
import { TimePanel } from '@/components/time-panel';
import { WatchButton } from '@/components/watch-button';
import { TransitionButtons } from '@/components/transition-buttons';
import { API_BASE, apiFetch } from '@/lib/api';

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
  description: string | null;
  permissions?: { canAssign: boolean; canEdit: boolean; canLink?: boolean };
  priorities?: Array<{ rank: number; name: string }>;
  reporter: string;
  createdAt: string;
  updatedAt: string;
  transitions: Array<{ id: string; name: string; requiredFields: string[] }>;
  resolution: string | null;
  fields?: Array<{ name: string; value: string }>;
  /** คะแนนความพอใจ — null เมื่อยังไม่มีใครตอบ ไม่ใช่ 0 คะแนน */
  satisfaction?: Satisfaction | null;
  /** ผู้ใช้คนนี้ให้คะแนนเรื่องนี้ได้ไหม — เงื่อนไขเดียวกับที่เซิร์ฟเวอร์ใช้ปฏิเสธ */
  canRate?: boolean;
  resolutions?: string[];
  links?: LinkRow[];
  articles?: AttachedArticle[];
  parent?: ParentRow | null;
  children?: { rows: ChildRow[]; done: number };
  /** ผู้ใช้คนนี้เฝ้าดูเรื่องนี้อยู่ไหม */
  watching?: boolean;
  watchers?: Array<{ userId: string; displayName: string }>;
  linkTypes?: Array<{ value: string; label: string }>;
  history: HistoryRow[];
}

// ที่อยู่ฝั่งเบราว์เซอร์ — ต่างจากที่ server component ใช้ ดู lib/api.ts
const API = API_BASE;

const FIELD_LABEL: Record<string, string> = {
  status: 'สถานะ',
  __transition__: 'การดำเนินการ',
  assignee: 'ผู้รับผิดชอบ',
  resolvedAt: 'เวลาที่แก้เสร็จ',
  resolution: 'ผลการแก้ไข',
  summary: 'หัวข้อ',
  description: 'รายละเอียด',
  priority: 'ความสำคัญ',
};

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
    const res = await apiFetch(`/api/v1/work-items/${key}`);
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
            {/*
              อยู่ข้างสถานะเพราะตอบคนละคำถามกัน: สถานะบอกว่างานอยู่ตรงไหน
              ผลการแก้ไขบอกว่าจบอย่างไร · "เสร็จแล้ว" เหมือนกันหมดทั้งเรื่องที่แก้ได้
              เรื่องที่ซ้ำกับใบอื่น และเรื่องที่ผู้แจ้งยกเลิกเอง
            */}
            {detail.resolution === null ? null : (
              <span className="detail-resolution">{detail.resolution}</span>
            )}
          </div>
          <div className="detail-title-row">
            <h1 className="detail-title">{detail.summary}</h1>
            {detail.permissions?.canEdit === true ? (
              <EditItem
                apiBase={API}
                itemKey={detail.itemKey}
                initial={{
                  summary: detail.summary,
                  description: detail.description ?? '',
                  priorityRank: detail.priority?.rank ?? null,
                }}
                priorities={detail.priorities ?? []}
              />
            ) : null}
          </div>
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
        <WatchButton
          apiBase={API}
          itemKey={detail.itemKey}
          watching={detail.watching ?? false}
          count={detail.watchers?.length ?? 0}
        />
        <TransitionButtons
          itemKey={detail.itemKey}
          transitions={detail.transitions}
          resolutions={detail.resolutions ?? []}
          apiBase={API}
        />
      </div>

      <div className="detail-body">
        <section>
          {detail.description === null ? null : (
            <>
              <h2 className="detail-section-title">รายละเอียด</h2>
              <p className="detail-description">{detail.description}</p>
            </>
          )}

          <HierarchyPanel
            apiBase={API}
            itemKey={detail.itemKey}
            parent={detail.parent ?? null}
            children={detail.children?.rows ?? []}
            done={detail.children?.done ?? 0}
            canEdit={detail.permissions?.canEdit ?? false}
          />

          <ArticlePanel
            apiBase={API}
            itemKey={detail.itemKey}
            articles={detail.articles ?? []}
            canEdit={detail.permissions?.canEdit ?? false}
          />

          <LinkPanel
            apiBase={API}
            itemKey={detail.itemKey}
            links={detail.links ?? []}
            types={detail.linkTypes ?? []}
            canLink={detail.permissions?.canLink ?? false}
          />

          {/*
            แผงเวลาโหลดข้อมูลของตัวเองจาก /time · ไม่ฝากมากับ payload ของหน้า
            เพราะรายการบันทึกยาวได้เรื่อย ๆ และคนส่วนใหญ่เปิดหน้านี้เพื่ออ่าน
            เรื่อง ไม่ใช่เพื่อดูเวลา
          */}
          {/*
            ผลกระทบอยู่ใต้ความสัมพันธ์ เพราะมันคือการสรุปของความสัมพันธ์ชนิดหนึ่ง ·
            แผงนี้ **ไม่ขึ้นเลย** เมื่อใบนี้ไม่ได้เป็นสาเหตุของอะไร จึงไม่รบกวน
            หน้ารายละเอียดของเรื่องทั่วไป
          */}
          {/*
            สิ่งที่เรื่องนี้กระทบอยู่ติดกับความสัมพันธ์และผลกระทบของปัญหา
            เพราะทั้งสามตอบคำถามเดียวกันจากคนละมุม: เรื่องนี้เกี่ยวกับอะไรอีก
          */}
          <ItemCiPanel apiBase={API} itemKey={detail.itemKey} />

          <ProblemImpactPanel apiBase={API} itemKey={detail.itemKey} />

          <AttachmentPanel apiBase={API} itemKey={detail.itemKey} />

          <TimePanel apiBase={API} itemKey={detail.itemKey} />

          {detail.fields === undefined || detail.fields.length === 0 ? null : (
            <>
              <h2 className="detail-section-title detail-section-gap">ข้อมูลเพิ่มเติม</h2>
              <dl className="detail-extra">
                {detail.fields.map((f) => (
                  <div key={f.name}>
                    <dt>{f.name}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {/*
            แบบสอบถามอยู่ **เหนือบทสนทนา** เมื่อเรื่องเพิ่งปิด — ถ้าอยู่ล่างสุด
            ใต้ไทม์ไลน์ยาว ๆ จะไม่มีใครเลื่อนไปเจอ และเราจะไม่ได้คำตอบเลย
            คนที่ให้คะแนนไม่ได้ (ไม่ใช่ผู้แจ้ง หรือเรื่องยังไม่ปิด) ไม่เห็นอะไรเลย
          */}
          {detail.canRate === true ? (
            <RatingForm
              apiBase={API}
              itemKey={detail.itemKey}
              current={detail.satisfaction ?? null}
            />
          ) : null}

          {/*
            การอนุมัติอยู่เหนือบทสนทนา — เป็นสิ่งที่กั้นไม่ให้งานเดินต่อ
            ถ้าอยู่ล่างสุดจะไม่มีใครเห็นว่ากำลังรออะไรอยู่
          */}
          <ApprovalPanel apiBase={API} itemKey={detail.itemKey} />

          {/*
            หน้าต่างเวลาอยู่ใต้การอนุมัติ เพราะลำดับจริงคืออนุมัติก่อนแล้วค่อย
            นัดเวลา · แผงนี้ขึ้นกับทุกเรื่อง ไม่ใช่เฉพาะประเภท "การเปลี่ยนแปลง"
            — ประเภทงานตั้งได้เองจากหน้าจอ การผูกกับชื่อประเภทจะพังทันทีที่มีคน
            ตั้งชื่ออื่น (เหตุผลเดียวกับที่ Single Work Item Model มีอยู่)
          */}
          <ChangeWindowPanel apiBase={API} itemKey={detail.itemKey} />

          <h2 className="detail-section-title detail-section-gap">บทสนทนา</h2>
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
                      <span className="timeline-time">
                        <Timestamp utc={h.createdAt} />
                      </span>
                    </div>
                    <div className="timeline-detail">
                      {h.field === '__transition__' ? (
                        <>
                          ดำเนินการ <b>{h.newValue}</b>
                        </>
                      ) : h.field === 'resolvedAt' ? (
                        /*
                          ประวัติเก็บค่าเป็นตัวบอกใบ้ว่า "มี" หรือ "ไม่มี" ไม่ใช่เวลาจริง
                          ถ้าเรนเดอร์ตรง ๆ ผู้ใช้จะเห็นคำว่า set ปนอยู่ในประโยคไทย
                          ซึ่งเป็นศัพท์ระบบที่ไม่มีความหมายกับใครนอกจากคนเขียนโค้ด
                        */
                        <>{h.newValue === null ? 'ยกเลิกการปิดงาน' : 'บันทึกเวลาที่แก้เสร็จ'}</>
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
            <dd>
              {detail.assignee ?? <span className="detail-empty">ยังไม่มี</span>}
              {detail.permissions?.canAssign === true ? (
                <AssignControl apiBase={API} itemKey={detail.itemKey} current={detail.assignee} />
              ) : null}
            </dd>
            <dt>ผู้แจ้ง</dt>
            <dd>{detail.reporter}</dd>
            <dt>ประเภทงาน</dt>
            <dd>{detail.issueType}</dd>
            <dt>ความสำคัญ</dt>
            <dd>{detail.priority?.name ?? <span className="detail-empty">ไม่ระบุ</span>}</dd>
            <dt>สร้างเมื่อ</dt>
            <dd>
              <Timestamp utc={detail.createdAt} />
            </dd>
            <dt>อัปเดตล่าสุด</dt>
            <dd>
              <Timestamp utc={detail.updatedAt} />
            </dd>
          </dl>
        </aside>
      </div>
    </>
  );
}
