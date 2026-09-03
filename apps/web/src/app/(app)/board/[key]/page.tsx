import type { ReactNode } from 'react';

import { Alert, PageHeader, TextLink } from '@itsm/ui';

import { BoardView, type BoardColumn, type CardFieldKey } from '@/components/board-view';
import { CardFieldPicker } from '@/components/card-field-picker';
import { splitLanes, type LaneMode } from '@/lib/swimlanes';
import { API_BASE, apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** ตรงกับ `ScrumScope` ฝั่ง API */
type Scope =
  | { kind: 'sprint'; sprintId: string; name: string; goal: string | null }
  | { kind: 'no-active'; planned: number; completed: number }
  | { kind: 'not-scrum' }
  | { kind: 'ambiguous'; names: string[] };

interface QuickFilter {
  id: string;
  name: string;
  hql: string;
  position: number;
}

interface Board {
  projectKey: string;
  mode: 'kanban' | 'scrum';
  scope: Scope;
  columns: BoardColumn[];
  canManage: boolean;
  cardFields: CardFieldKey[];
  cardFieldsIsDefault: boolean;
}

/**
 * ข้อความที่อธิบายว่ากระดานกำลังแสดงอะไร
 *
 * **ทุกกรณีมีข้อความของตัวเอง** — กระดานเปล่าที่ไม่บอกว่าทำไม ทำให้คนเชื่อว่า
 * งานหายไป · และ "ไม่มีรอบที่กำลังทำ" ต่างจาก "โปรเจกต์นี้ไม่ได้ทำงานเป็นรอบ"
 * ซึ่งเป็นคนละสถานการณ์และคนต้องทำคนละอย่าง
 */
function scopeNote(scope: Scope): { tone: 'info' | 'warning'; text: string } | null {
  switch (scope.kind) {
    case 'sprint':
      return null;
    case 'no-active':
      return {
        tone: 'info',
        text:
          scope.planned > 0
            ? `ยังไม่ได้เริ่มรอบไหน — มีรอบที่วางไว้ ${String(scope.planned)} รอบ · เริ่มรอบที่หน้าวางแผนก่อน แล้วกระดานนี้จะมีงาน`
            : `ยังไม่มีรอบที่กำลังทำอยู่ — จบไปแล้ว ${String(scope.completed)} รอบ · วางรอบใหม่ที่หน้าวางแผนก่อน`,
      };
    case 'not-scrum':
      return {
        tone: 'info',
        text: 'โปรเจกต์นี้ยังไม่ได้ทำงานเป็นรอบ — กระดานแบบรอบจึงยังไม่มีอะไรแสดง · ใช้มุมมองทั้งโปรเจกต์แทน',
      };
    case 'ambiguous':
      /*
        สภาพนี้ไม่ควรเกิด — แต่ถ้าเกิด การเลือกมาแสดงอันเดียวเงียบ ๆ
        ทำให้งานของอีกครึ่งทีมหายไปโดยไม่มีอะไรบอก
      */
      return {
        tone: 'warning',
        text: `มีรอบที่กำลังทำอยู่พร้อมกัน ${String(scope.names.length)} รอบ (${scope.names.join(' · ')}) — กระดานแบบรอบเลือกไม่ได้ว่าจะแสดงรอบไหน · ปิดรอบที่ไม่ได้ทำแล้วก่อน`,
      };
  }
}

/**
 * ลิงก์ที่คงโหมดกระดานและเลนไว้ · เปลี่ยนเฉพาะตัวกรอง
 *
 * ตัวกรองที่กดแล้วรีเซ็ตมุมมองอื่นไปด้วย ทำให้คนต้องตั้งใหม่ทุกครั้ง
 * แล้วเลิกใช้ตัวกรองไปเลย
 */
function filterHref(
  projectKey: string,
  scrum: boolean,
  laneMode: LaneMode,
  filterId: string | null,
): string {
  const qs = new URLSearchParams();
  if (scrum) qs.set('mode', 'scrum');
  if (laneMode !== 'none') qs.set('lane', laneMode);
  if (filterId !== null) qs.set('filter', filterId);
  const q = qs.toString();
  return `/board/${encodeURIComponent(projectKey)}${q === '' ? '' : `?${q}`}`;
}

/**
 * กระดานของโปรเจกต์หนึ่ง
 *
 * คอลัมน์มาจาก workflow ที่โปรเจกต์นี้ใช้ ไม่ใช่รายการสถานะทั้งระบบ —
 * กระดานที่แสดงคอลัมน์ซึ่งงานไปถึงไม่ได้ ทำให้คนย้ายแล้วเด้งกลับโดยไม่เข้าใจ
 *
 * **สองมุมมอง**: ทั้งโปรเจกต์ (Kanban) กับเฉพาะรอบที่กำลังทำ (Scrum) ·
 * ค่าปริยายคือทั้งโปรเจกต์ เพราะเป็นสิ่งที่กระดานนี้เป็นมาตลอด
 */
export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ mode?: string; lane?: string; filter?: string }>;
}): Promise<ReactNode> {
  const { key } = await params;
  const { mode, lane, filter } = await searchParams;
  /*
    **ส่งค่าที่ผู้ใช้ให้มาต่อไปตามเดิม ไม่ตัดทิ้งเอง**

    รอบแรกที่นี่กรองเฉพาะรหัสที่เป็นตัวเลข · ผลคือ `?filter=abc` ถูกทิ้งเงียบ ๆ
    แล้วกระดานแสดงครบทุกใบเหมือนไม่ได้กรอง ขณะที่ `?filter=999` ขึ้น error —
    **คำขอที่ใช้ไม่ได้เหมือนกัน แต่ล้มคนละแบบ** · คนที่เห็นกระดานเต็ม
    จะเชื่อว่าตัวกรองทำงานแล้วไม่เจออะไรผิดปกติ · ให้เซิร์ฟเวอร์ตัดสินที่เดียว
  */
  const filterId = typeof filter === 'string' && filter !== '' ? filter : null;
  const scrum = mode === 'scrum';
  /*
    ค่าที่พิมพ์ผิดตกไปเป็น "ไม่แบ่งเลน" — เหมือนกับโหมดกระดาน · การแบ่งเลน
    โดยไม่ตั้งใจทำให้กระดานหน้าตาเปลี่ยนไปโดยไม่มีใครสั่ง
  */
  const laneMode: LaneMode = lane === 'assignee' || lane === 'priority' ? lane : 'none';

  let data: Board | null = null;
  let error: string | null = null;
  try {
    const qs = new URLSearchParams();
    if (scrum) qs.set('mode', 'scrum');
    if (filterId !== null) qs.set('filter', filterId);
    const query = qs.toString();
    const res = await apiFetch(
      `/api/v1/boards/${encodeURIComponent(key)}${query === '' ? '' : `?${query}`}`,
    );
    if (res.ok) data = (await res.json()) as Board;
    else {
      /*
        **ใช้ข้อความของเซิร์ฟเวอร์ก่อนเสมอ** · 404 เดียวกันเกิดได้จากทั้ง
        โปรเจกต์ที่ไม่มีและตัวกรองที่ไม่มี · ข้อความตายตัวว่า "ไม่พบโปรเจกต์นี้"
        ส่งคนไปตรวจสิทธิ์ของโปรเจกต์ ทั้งที่ต้นเหตุคือรหัสตัวกรองใน URL
        — **ข้อความที่มั่นใจแต่ผิด แย่กว่าข้อความกว้าง ๆ**
      */
      const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
      const said = typeof body?.message === 'string' ? body.message : null;
      error =
        said ??
        (res.status === 404
          ? 'ไม่พบโปรเจกต์นี้ หรือคุณยังเปิดดูไม่ได้'
          : `โหลดไม่สำเร็จ (HTTP ${String(res.status)})`);
    }
  } catch {
    error = 'เชื่อมต่อระบบไม่ได้';
  }

  if (data === null) {
    return (
      <section className="page">
        <PageHeader title="กระดาน" />
        <Alert tone="error">{error ?? 'เชื่อมต่อระบบไม่ได้'}</Alert>
      </section>
    );
  }

  /*
    รายการตัวกรองโหลดแยกจากกระดาน · ล้มแล้วไม่ทำให้กระดานหาย — แถบตัวกรอง
    ที่โหลดไม่ได้ ควรหายไปเฉย ๆ ไม่ใช่พาทั้งหน้าไปด้วย
  */
  let filters: QuickFilter[] = [];
  try {
    const r = await apiFetch(`/api/v1/boards/${encodeURIComponent(key)}/quick-filters`);
    if (r.ok) filters = ((await r.json()) as { rows: QuickFilter[] }).rows;
  } catch {
    filters = [];
  }

  const total = data.columns.reduce((n, c) => n + c.cards.length, 0);
  const note = scrum ? scopeNote(data.scope) : null;
  const sprintName = data.scope.kind === 'sprint' ? data.scope.name : null;
  const lanes = splitLanes(data.columns, laneMode);
  const goal = data.scope.kind === 'sprint' ? data.scope.goal : null;

  return (
    <section className="page">
      <PageHeader
        title={scrum ? `กระดานรอบ ${data.projectKey}` : `กระดาน ${data.projectKey}`}
        lead={
          scrum && sprintName !== null
            ? `${sprintName} · ${total.toLocaleString('th-TH')} เรื่องในรอบนี้`
            : `${total.toLocaleString('th-TH')} เรื่องบนกระดาน · แสดงคอลัมน์ละไม่เกิน 100 เรื่อง`
        }
      />

      {/*
        ลิงก์สลับมุมมอง ไม่ใช่ปุ่มที่ต้องมี JavaScript — หน้านี้เป็น server
        component และมุมมองอยู่ใน URL จึงแชร์ลิงก์และกดปุ่มย้อนกลับได้ตามปกติ
      */}
      <p className="board-modes">
        {scrum ? (
          <TextLink href={`/board/${encodeURIComponent(data.projectKey)}`}>
            ดูทั้งโปรเจกต์
          </TextLink>
        ) : (
          <TextLink href={`/board/${encodeURIComponent(data.projectKey)}?mode=scrum`}>
            ดูเฉพาะรอบที่กำลังทำ
          </TextLink>
        )}
      </p>

      {goal === null || goal === '' ? null : (
        <p className="board-goal">
          <strong>เป้าหมายของรอบ:</strong> {goal}
        </p>
      )}

      {note === null ? null : <Alert tone={note.tone}>{note.text}</Alert>}

      {/*
        แถบตัวกรองด่วน · อยู่ใน URL เหมือนโหมดกระดานและเลน จึงแชร์ลิงก์
        และกดย้อนกลับได้ · **ตัวที่กดอยู่ยังแสดงเป็นปุ่ม ไม่ใช่หายไป**
        มิฉะนั้นคนจะไม่รู้ว่ากำลังกรองด้วยอะไรอยู่ ซึ่งอ่านเหมือนงานหายไป
      */}
      <CardFieldPicker
        apiBase={API_BASE}
        projectKey={data.projectKey}
        current={data.cardFields}
        isDefault={data.cardFieldsIsDefault}
      />

      {filters.length === 0 ? null : (
        <p className="board-filters">
          <span className="board-filters-label">ตัวกรองด่วน</span>
          <TextLink href={filterHref(data.projectKey, scrum, laneMode, null)}>
            {filterId === null ? 'ทั้งหมด (กำลังใช้)' : 'ทั้งหมด'}
          </TextLink>
          {filters.map((f) => (
            <TextLink
              key={f.id}
              href={filterHref(data.projectKey, scrum, laneMode, f.id)}
            >
              {f.id === filterId ? `${f.name} (กำลังใช้)` : f.name}
            </TextLink>
          ))}
        </p>
      )}

      {/*
        แถบเลือกเลน · อยู่ใน URL เหมือนโหมดกระดาน จึงแชร์ลิงก์และกดย้อนกลับได้
      */}
      <p className="board-modes">
        {(
          [
            ['none', 'ไม่แบ่งเลน'],
            ['assignee', 'แบ่งตามผู้รับผิดชอบ'],
            ['priority', 'แบ่งตามความสำคัญ'],
          ] as const
        )
          .filter(([v]) => v !== laneMode)
          .map(([v, label]) => (
            <span key={v} className="board-lane-link">
              <TextLink
                href={`/board/${encodeURIComponent(data.projectKey)}?${new URLSearchParams({
                  ...(scrum ? { mode: 'scrum' } : {}),
                  ...(v === 'none' ? {} : { lane: v }),
                }).toString()}`}
              >
                {label}
              </TextLink>
            </span>
          ))}
      </p>

      {laneMode === 'none' ? (
        <BoardView
          apiBase={API_BASE}
          projectKey={data.projectKey}
          columns={data.columns}
          canManage={data.canManage}
          cardFields={data.cardFields}
        />
      ) : (
        lanes.map((l, i) => (
          <section key={l.key} className="board-lane">
            {/*
              จำนวนการ์ดต่อเลนแสดงเสมอ — เลนที่ว่างเปล่ายังต้องมีหัวเลน
              มิฉะนั้นคนจะไม่รู้ว่าคนคนนั้นไม่มีงานอยู่ ต่างจากไม่มีคนคนนั้น
            */}
            <h2 className="board-lane-title">
              {l.label}{' '}
              <span className="board-lane-count">
                {l.columns.reduce((n, c) => n + c.cards.length, 0).toLocaleString('th-TH')} เรื่อง
              </span>
            </h2>
            {/*
              คำอธิบายปุ่มลัดแสดงครั้งเดียว · ซ้ำทุกเลนเป็นเสียงรบกวน
              และดันการ์ดของเลนถัดไปให้ต่ำลงโดยไม่ได้ให้ข้อมูลอะไรเพิ่ม
            */}
            <BoardView
              apiBase={API_BASE}
              projectKey={data.projectKey}
              columns={l.columns}
              showHelp={i === 0}
              showWip={false}
              cardFields={data.cardFields}
              laneLabel={l.label}
            />
          </section>
        ))
      )}
    </section>
  );
}
