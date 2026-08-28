import type { ReactNode } from 'react';

import { Alert, EmptyState, PageHeader, StatusPill } from '@itsm/ui';

import { HqlBar } from '@/components/hql-bar';
import { QueueBulk } from '@/components/queue-bulk';
import { API_BASE, apiFetch } from '@/lib/api';

interface ApiRow {
  id: string;
  itemKey: string;
  projectKey: string;
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
 * เพดานของการแก้ทีละหลายใบ — ต้องตรงกับ `BULK_MAX` ฝั่ง API
 *
 * ประกาศซ้ำที่นี่แทนการ import ข้ามแอป เพราะ web กับ api เป็นคนละ deployment
 * และค่านี้ยังเดินทางมากับผลลัพธ์ทุกครั้ง (`max`) หน้าจอจึงตรวจได้ว่าตรงกันจริง
 */
const BULK_MAX = 50;

/** จำนวนแถวต่อหน้า — ตรงกับเพดานของการแก้ทีละหลายใบ ให้ "เลือกทั้งหน้า" มีความหมายเดียว */
const PAGE_SIZE = 50;

/**
 * เพดานความลึกของการแบ่งหน้าฝั่งค้นหา — ต้องตรงกับ `MAX_RESULT_WINDOW` ของ API
 *
 * ไม่เสนอหน้าที่กดแล้วได้ error · การให้กดแล้วค่อยบอกว่าไม่ได้
 * คือการโยนข้อจำกัดของเราไปให้ผู้ใช้ไปเจอเอง
 */
const MAX_DEPTH = 10_000;

/**
 * ลิงก์ของหน้าหนึ่ง — **พาคิวรีและมุมมองไปด้วยเสมอ**
 *
 * ลืมพาไปเมื่อไร การกดหน้าถัดไปจะทิ้งสิ่งที่ผู้ใช้พิมพ์ไว้เงียบ ๆ
 * แล้วเขาจะเห็นคิวคนละชุดโดยไม่รู้ว่าทำไม
 */
function pageHref(view: ViewKey, query: string, offset: number): string {
  const p = new URLSearchParams();
  if (view !== '') p.set('mine', view);
  if (query !== '') p.set('hql', query);
  if (offset > 0) p.set('offset', String(offset));
  const qs = p.toString();
  return qs === '' ? '/' : `/?${qs}`;
}

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
  offset: number,
): Promise<
  | { rows: ApiRow[]; total: number; hqlError?: string; bulkEditable?: string[]; offset?: number }
  | { error: string }
> {
  try {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (offset > 0) params.set('offset', String(offset));
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
    return (await res.json()) as {
      rows: ApiRow[];
      total: number;
      hqlError?: string;
      bulkEditable?: string[];
      offset?: number;
    };
  } catch {
    return { error: `เชื่อมต่อ API ที่ ${API} ไม่ได้ — รัน \`pnpm --filter @itsm/api dev\` ก่อน` };
  }
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string; hql?: string; offset?: string }>;
}): Promise<ReactNode> {
  const { mine, hql, offset } = await searchParams;
  // ค่าที่ไม่รู้จักตกกลับเป็น "ทั้งหมด" — ตัวกรองที่เดาเองทำให้เห็นรายการผิด
  const view: ViewKey = mine === 'assigned' || mine === 'reported' ? mine : '';
  const query = (hql ?? '').trim();
  // ค่าที่พังตกกลับเป็นหน้าแรก — ลิงก์เก่าไม่ควรทำให้หน้าจอพัง
  const skip = Math.max(0, Math.floor(Number(offset ?? 0)) || 0);
  const data = await fetchQueue(view, query, skip);


  if ('error' in data) {
    return (
      <>
        <PageHeader title="คิวงาน" />
        <Alert tone="error" title="เชื่อมต่อระบบไม่ได้">
          {data.error}
        </Alert>
      </>
    );
  }

  /*
    จำนวนที่ **เข้าถึงได้จริง** — เส้นทางคิวรีติดเพดานความลึกของดัชนี
    ต่างจากยอดรวม ซึ่งบอกความจริงว่ามีทั้งหมดเท่าไร
  */
  const reachable = query === '' ? data.total : Math.min(data.total, MAX_DEPTH);
  const lastPage = Math.max(1, Math.ceil(reachable / PAGE_SIZE));
  /*
    เลยหน้าสุดท้ายไปแล้ว (ลิงก์เก่า หรือพิมพ์ URL เอง) — ต่างจาก "ไม่มีอะไรตรงเงื่อนไข"
    โดยสิ้นเชิง · ข้อความว่า "ไม่พบงานที่ตรงกับคิวรีนี้" ตอนที่มีอยู่ 7,023 รายการ
    คือคำตอบที่ผิด และผู้ใช้จะสรุปว่าคิวรีของตัวเองใช้ไม่ได้
  */
  const pastEnd = data.rows.length === 0 && data.total > 0 && skip >= data.total;

  return (
    <>
      <PageHeader
        title="คิวงาน · IT Service Desk"
        lead={
          <>
            {/*
              ยอดรวมเป็นยอดจริงทั้งสองเส้นทางแล้ว — เส้นทาง HQL เคยรายงานเพดาน
              ของตัวเอง (50) เป็นยอดรวม เพราะนับจากคีย์ที่คัดมาได้
              ตอนนี้ดัชนีคืนยอดจริงมาให้ (`track_total_hits`)
            */}
            {query === '' ? 'งานที่เปิดอยู่ทั้งหมด ' : 'ผลจากคิวรีทั้งหมด '}
            {data.total.toLocaleString('th-TH')} รายการ
            {data.rows.length === 0 ? null : (
              <>
                {' '}
                · แสดงรายการที่ {(skip + 1).toLocaleString('th-TH')}–
                {(skip + data.rows.length).toLocaleString('th-TH')}
              </>
            )}
            {query === '' ? (
              <> เรียงตามการอัปเดตล่าสุด</>
            ) : (
              <>
                {' '}
                · <b>คิวรีแทนตัวกรองปริยายทั้งหมด</b> — ไม่ได้จำกัดเฉพาะโปรเจกต์ IT Service Desk
                และไม่ได้ตัดงานที่ปิดแล้วออก
              </>
            )}
          </>
        }
      />

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
              ? 'แสดงผลชุดนี้ไม่ได้'
              : pastEnd
                ? 'เลยหน้าสุดท้ายไปแล้ว'
                : query !== ''
                  ? 'ไม่มีงานที่ตรงกับคิวรีนี้'
                : view === 'assigned'
                  ? 'ยังไม่มีงานที่มอบหมายให้คุณ'
                  : view === 'reported'
                    ? 'คุณยังไม่ได้แจ้งเรื่องไว้'
                    : 'ยังไม่มีงานในคิวนี้'
          }
          body={
            /*
              ใช้คำของเซิร์ฟเวอร์ ไม่ใช่สมมติว่าเป็นคิวรีผิดเสมอ — เพดานความลึก
              ของการแบ่งหน้าก็มาทางนี้ และคิวรีนั้นถูกทุกตัวอักษร
            */
            data.hqlError !== undefined
              ? data.hqlError
              : pastEnd
                ? `มีทั้งหมด ${data.total.toLocaleString('th-TH')} รายการ — กด "ก่อนหน้า" เพื่อกลับไปดู`
                : query !== ''
                  ? 'ลองผ่อนเงื่อนไขลง หรือกด "ล้าง" เพื่อกลับไปดูคิวปกติ'
                : view === 'reported'
                  ? 'เมื่อแจ้งปัญหาเข้ามา เรื่องของคุณจะอยู่ที่นี่'
                  : 'เมื่อมีผู้แจ้งปัญหาเข้ามา งานจะปรากฏที่นี่โดยอัตโนมัติ'
          }
        />
      ) : (
        /*
          ตารางย้ายไปเป็น client component เพราะการเลือกหลายแถวเป็นสถานะชั่วคราว
          ที่ **ไม่ควรอยู่ใน URL** — ต่างจากคิวรีและมุมมอง ซึ่งเป็นสิ่งที่คนอยากบุ๊กมาร์ก
          ไม่มีใครอยากส่งลิงก์ที่แปลว่า "ฉันติ๊กไว้ 7 ใบ"
        */
        <QueueBulk
          apiBase={API}
          rows={data.rows}
          bulkEditable={data.bulkEditable ?? []}
          max={BULK_MAX}
        />
      )}

      {/*
        แบ่งหน้าเป็นลิงก์ธรรมดา ไม่ใช่ปุ่ม JavaScript — หน้าที่กำลังดูอยู่คือ
        สถานะของหน้า ต้องบุ๊กมาร์กได้และกดย้อนกลับได้ แบบเดียวกับคิวรีและมุมมอง
      */}
      {reachable <= PAGE_SIZE && !pastEnd ? null : (
        <nav className="pager" aria-label="แบ่งหน้า">
          <a
            href={pageHref(
              view,
              query,
              // เลยหน้าสุดท้ายไปแล้วให้กลับมาหน้าสุดท้ายจริง ไม่ใช่ถอยทีละหน้าจากตำแหน่งที่ไม่มีอยู่
              pastEnd ? (lastPage - 1) * PAGE_SIZE : Math.max(0, skip - PAGE_SIZE),
            )}
            aria-disabled={skip === 0 ? 'true' : undefined}
            data-disabled={skip === 0 ? 'true' : undefined}
          >
            ← ก่อนหน้า
          </a>
          <span>
            {/* หน้าที่กำลังดูต้องไม่เกินหน้าสุดท้าย — "หน้า 200 จาก 141" คือคำตอบที่ผิด */}
            หน้า {Math.min(Math.floor(skip / PAGE_SIZE) + 1, lastPage).toLocaleString('th-TH')} จาก{' '}
            {lastPage.toLocaleString('th-TH')}
          </span>
          <a
            href={pageHref(view, query, skip + PAGE_SIZE)}
            aria-disabled={skip + PAGE_SIZE >= reachable ? 'true' : undefined}
            data-disabled={skip + PAGE_SIZE >= reachable ? 'true' : undefined}
          >
            ถัดไป →
          </a>
        </nav>
      )}
    </>
  );
}
