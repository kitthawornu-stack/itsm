import Link from 'next/link';
import type { ReactNode } from 'react';

import { Table } from '@itsm/ui';

import { PermissionGrid } from '@/components/permission-grid';
import { API_BASE, apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Detail {
  project: {
    key: string;
    name: string;
    type: string;
    notifyGroup: string | null;
    permissionScheme: string | null;
    itemCount: number;
  };
  workflows: Array<{
    issueTypes: string[];
    workflowName: string;
    statuses: Array<{
      name: string;
      category: string;
      isInitial: boolean;
      pausesSla: boolean;
      itemCount: number;
    }>;
    transitions: Array<{
      name: string;
      from: string | null;
      to: string;
      conditions: string[];
      validators: string[];
      postFunctions: string[];
    }>;
  }>;
  groups: Array<{ id: string; name: string; memberCount: number }>;
  permissions: {
    schemeName: string | null;
    schemeId: string | null;
    sharedWith: string[];
    rows: Array<{
      permission: string;
      groups: string[];
      impliedBy: string | null;
      impliedGroups: string[];
      enforced: boolean;
    }>;
  };
  sla: {
    name: string;
    calendar: string;
    calendarYears: Array<{
      year: number;
      required: boolean;
      verified: boolean;
      empty: boolean;
      missingLunar: string[];
    }>;
    goals: Array<{ key: string; name: string; targetMs: number; match: unknown }>;
  } | null;
  /** ความพอใจของผู้แจ้ง — นับเฉพาะเรื่องที่มีคำตอบจริง */
  satisfaction?: {
    responses: number;
    average: number;
    byRating: Record<string, number>;
  };
}

// ที่อยู่ฝั่งเบราว์เซอร์ — ต่างจากที่ server component ใช้ ดู lib/api.ts
const API = API_BASE;

/** ตรงกับคำบนแบบสอบถาม — ตัวเลขเปล่าแปลว่าอะไรก็ได้แล้วแต่คนอ่าน */
const RATING_LABEL: Record<number, string> = {
  1: 'แย่มาก',
  2: 'ไม่ค่อยดี',
  3: 'พอใช้',
  4: 'ดี',
  5: 'ดีมาก',
};

const CATEGORY_LABEL: Record<string, string> = {
  TODO: 'ยังไม่เริ่ม',
  IN_PROGRESS: 'กำลังทำ',
  DONE: 'จบแล้ว',
};

/** ชื่อสิทธิ์เป็นภาษาคน — คีย์ดิบเป็นศัพท์ระบบ ไม่ใช่สิ่งที่ผู้ดูแลคิดเป็น */
const PERMISSION_LABEL: Record<string, string> = {
  BROWSE_PROJECT: 'เปิดดูโปรเจกต์',
  CREATE_ITEM: 'แจ้งเรื่องใหม่',
  EDIT_ITEM: 'แก้ไขเรื่อง',
  DELETE_ITEM: 'ลบเรื่อง',
  ASSIGN_ITEM: 'มอบหมายผู้รับผิดชอบ',
  TRANSITION_ITEM: 'เปลี่ยนสถานะ',
  ADD_COMMENT: 'แสดงความเห็น',
  DELETE_COMMENT: 'ลบความเห็น',
  VIEW_INTERNAL_COMMENT: 'เห็นบันทึกภายในของทีม',
  MANAGE_ATTACHMENT: 'จัดการไฟล์แนบ',
  LINK_ITEM: 'เชื่อมโยงเรื่อง',
  BULK_EDIT: 'แก้ไขหลายเรื่องพร้อมกัน',
  MANAGE_SPRINT: 'จัดการสปรินต์',
  MANAGE_PROJECT: 'ตั้งค่าโปรเจกต์',
  VIEW_REPORT: 'ดูรายงาน',
  ADMINISTER_TENANT: 'ดูแลระบบทั้งองค์กร',
};

function hours(ms: number): string {
  const h = ms / 3_600_000;
  return h >= 1
    ? `${String(Number(h.toFixed(1)))} ชั่วโมงทำการ`
    : `${String(Math.round(ms / 60_000))} นาทีทำการ`;
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<ReactNode> {
  const { key } = await params;
  const res = await apiFetch(`/api/v1/admin/projects/${key}`, { cache: 'no-store' });
  if (!res.ok) {
    return (
      <section className="page">
        <h1 className="page-title">{key}</h1>
        <p className="admin-error" role="alert">
          {res.status === 403
            ? 'ต้องเป็นผู้ดูแลระบบจึงจะดูส่วนนี้ได้'
            : res.status === 404
              ? `ไม่พบโปรเจกต์ ${key}`
              : `โหลดข้อมูลไม่สำเร็จ (HTTP ${String(res.status)})`}
        </p>
      </section>
    );
  }
  const d = (await res.json()) as Detail;

  return (
    <section className="page">
      <p className="page-sub">
        <Link href="/admin/projects">โปรเจกต์ทั้งหมด</Link>
      </p>
      <h1 className="page-title">
        {d.project.key} · {d.project.name}
      </h1>
      <p className="page-sub">
        {d.project.itemCount.toLocaleString('th-TH')} เรื่อง ·{' '}
        {d.project.notifyGroup === null
          ? 'ยังไม่ได้ตั้งกลุ่มรับแจ้งเตือน'
          : `แจ้งเตือนทีมไปที่ ${d.project.notifyGroup}`}
      </p>

      {/* ---------- workflow ---------- */}
      {d.workflows.length === 0 ? (
        <p className="admin-error" role="alert">
          โปรเจกต์นี้ยังไม่ได้ผูก workflow กับประเภทงานใดเลย — แจ้งเรื่องใหม่จะล้มเหลว
        </p>
      ) : (
        d.workflows.map((w) => (
          <div key={w.workflowName} className="cfg-block">
            <h2 className="cfg-title">{w.workflowName}</h2>
            <p className="admin-empty">
              {/* ประเภทงานที่ใช้ workflow เดียวกัน = ทำงานเหมือนกันทุกประการ */}
              ใช้กับ {w.issueTypes.join(' · ')}
            </p>

            <Table
              columns={['สถานะ', 'หมวด', 'เรื่องที่ค้างอยู่', 'หมายเหตุ']}
              rowCount={w.statuses.length}
            >
              {w.statuses.map((st) => (
                <tr key={st.name}>
                  <td>{st.name}</td>
                  <td>{CATEGORY_LABEL[st.category] ?? st.category}</td>
                  <td className="admin-when">{st.itemCount.toLocaleString('th-TH')}</td>
                  <td>
                    {[st.isInitial ? 'สถานะเริ่มต้น' : null, st.pausesSla ? 'พักนาฬิกา SLA' : null]
                      .filter((v) => v !== null)
                      .join(' · ') || '—'}
                  </td>
                </tr>
              ))}
            </Table>

            <Table
              columns={['ปุ่ม', 'จาก → ไป', 'ใครเห็นปุ่ม', 'ต้องกรอกอะไร', 'ทำอะไรต่อ']}
              rowCount={w.transitions.length}
            >
              {w.transitions.map((t) => (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td>
                    {/* null = ทำได้จากทุกสถานะ · ต้องต่างจาก "ไม่รู้ว่ามาจากไหน" */}
                    {t.from ?? 'ทุกสถานะ'} → {t.to}
                  </td>
                  <td>
                    {t.conditions.length === 0 ? 'ทุกคนที่มีสิทธิ์' : t.conditions.join(' · ')}
                  </td>
                  <td>{t.validators.length === 0 ? '—' : t.validators.join(' · ')}</td>
                  <td>{t.postFunctions.length === 0 ? '—' : t.postFunctions.join(' · ')}</td>
                </tr>
              ))}
            </Table>
          </div>
        ))
      )}

      {/* ---------- สิทธิ์ ---------- */}
      <div className="cfg-block">
        <h2 className="cfg-title">
          สิทธิ์ {d.permissions.schemeName === null ? '' : `· ${d.permissions.schemeName}`}
        </h2>
        {d.permissions.schemeName === null ? (
          <p className="admin-error" role="alert">
            โปรเจกต์นี้ยังไม่ได้ผูกชุดสิทธิ์ — ไม่มีใครเข้าถึงได้เลย รวมถึงผู้ดูแล
          </p>
        ) : null}
        <PermissionGrid
          apiBase={API}
          projectKey={d.project.key}
          rows={d.permissions.rows}
          groups={d.groups}
          labels={PERMISSION_LABEL}
          editable={d.permissions.schemeId !== null}
          sharedWith={d.permissions.sharedWith}
        />
        <p className="admin-empty">
          สิทธิ์ให้ผ่านกลุ่มเท่านั้น ไม่ให้รายบุคคล —
          จึงตอบได้เสมอว่าคนคนหนึ่งทำได้เพราะอยู่กลุ่มไหน
        </p>
        {d.permissions.rows.some((r) => !r.enforced && r.groups.length > 0) ? (
          <p className="admin-error" role="alert">
            มีสิทธิ์ที่ให้กลุ่มไปแล้วแต่ยังไม่มีโค้ดตรวจ — การให้สิทธิ์นั้นยังไม่มีผลใด ๆ
            และจะเริ่มมีผลทันทีในวันที่ฟีเจอร์นั้นถูกเขียนขึ้น
          </p>
        ) : null}
      </div>

      {/* ---------- SLA ---------- */}
      <div className="cfg-block">
        <h2 className="cfg-title">ความพอใจของผู้แจ้ง</h2>
        {d.satisfaction === undefined || d.satisfaction.responses === 0 ? (
          <p className="admin-empty">
            {/*
              ยังไม่มีใครตอบ ≠ คะแนน 0 · การขึ้นเลข 0 ตรงนี้จะทำให้คนอ่านสรุปว่า
              บริการแย่ ทั้งที่แปลว่ายังไม่มีข้อมูล
            */}
            ยังไม่มีใครให้คะแนน — ผู้แจ้งจะเห็นแบบสอบถามบนหน้าเรื่องทันทีที่งานปิด
          </p>
        ) : (
          <>
            <p className="admin-empty">
              เฉลี่ย <b>{d.satisfaction.average.toFixed(2)}</b> จาก 5 ·{' '}
              {d.satisfaction.responses.toLocaleString('th-TH')} คำตอบ
              {/* บอกฐานเสมอ — ค่าเฉลี่ยที่ไม่รู้ว่ามาจากกี่คำตอบ ตีความไม่ได้ */}
            </p>
            <Table
              columns={[
                'คะแนน',
                { label: 'จำนวนคำตอบ', align: 'end' },
                { label: 'สัดส่วน', align: 'end' },
              ]}
              rowCount={5}
            >
              {[5, 4, 3, 2, 1].map((n) => {
                const c = d.satisfaction?.byRating[String(n)] ?? 0;
                const total = d.satisfaction?.responses ?? 0;
                return (
                  <tr key={n}>
                    <td>
                      {n} · {RATING_LABEL[n]}
                    </td>
                    <td data-align="end">{c.toLocaleString('th-TH')}</td>
                    <td data-align="end">
                      {total === 0 ? '—' : `${((c / total) * 100).toFixed(0)}%`}
                    </td>
                  </tr>
                );
              })}
            </Table>
          </>
        )}

        <h2 className="cfg-title detail-section-gap">ข้อตกลงบริการ</h2>
        {d.sla === null ? (
          <p className="admin-empty">
            ยังไม่ได้ตั้ง — เรื่องในโปรเจกต์นี้จะไม่มีนาฬิกาจับเวลา และไม่มีการแจ้งเตือนใกล้ครบกำหนด
          </p>
        ) : (
          <>
            <p className="page-sub">
              {d.sla.name} · ปฏิทิน {d.sla.calendar}
            </p>
            {/*
              สถานะรายปี ไม่ใช่สถานะเดียวของปฏิทิน — วันหยุดเปลี่ยนทุกปี
              ปีหน้าคือปีที่พังเงียบที่สุด: ระบบที่ทำงานถูกมาทั้งปีจะเริ่มนับ
              วันสงกรานต์เป็นวันทำการตั้งแต่เที่ยงคืนวันที่ 1 มกราคม
            */}
            {d.sla.calendarYears
              .filter((y) => y.required && !y.verified)
              .map((y) => (
                <p key={y.year} className="admin-error" role="alert">
                  <b>ปี {y.year + 543}</b> ยังไม่ได้ยืนยันกับประกาศวันหยุดจริง
                  {y.empty
                    ? ' — ยังไม่มีวันหยุดสักวันในรายการ ทุกวันจะถูกนับเป็นวันทำการ'
                    : y.missingLunar.length === 0
                      ? ' — มีรายการแล้ว รอคนตรวจและยืนยัน'
                      : ` — ยังไม่พบ ${y.missingLunar.join(' · ')} ในรายการ`}
                </p>
              ))}
            <Table columns={['เป้าหมาย', 'เวลา', 'ใช้กับ']} rowCount={d.sla.goals.length}>
              {d.sla.goals.map((g) => (
                <tr key={g.key}>
                  <td>{g.name}</td>
                  <td className="admin-when">{hours(g.targetMs)}</td>
                  <td>{describeMatch(g.match)}</td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </div>
    </section>
  );
}

/** เงื่อนไขการเข้าคู่ของเป้าหมาย — ไม่มีเงื่อนไข = ใช้กับทุกเรื่อง (catch-all) */
function describeMatch(match: unknown): string {
  if (match === null || typeof match !== 'object') return 'ทุกเรื่อง';
  const m = match as { priorityRanks?: unknown; issueTypeNames?: unknown };
  const parts: string[] = [];
  if (Array.isArray(m.priorityRanks) && m.priorityRanks.length > 0) {
    parts.push(`ความสำคัญ P${m.priorityRanks.join(', P')}`);
  }
  if (Array.isArray(m.issueTypeNames) && m.issueTypeNames.length > 0) {
    parts.push(`ประเภท ${m.issueTypeNames.join(', ')}`);
  }
  return parts.length === 0 ? 'ทุกเรื่อง' : parts.join(' และ ');
}
