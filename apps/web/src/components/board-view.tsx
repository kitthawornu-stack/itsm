'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { Alert, StatusPill, type PriorityRank, type StatusCategory } from '@itsm/ui';

import { planDrop } from '@/lib/board-drop';
import { thaiDayKey, thaiDayLabel } from '@/lib/thai-day';
import { WipLimitEditor } from './wip-limit-editor';

/**
 * ฟิลด์ที่การ์ดแสดงได้ — **ตรงกับ `ALL_CARD_FIELDS` ใน `@itsm/types`**
 *
 * `apps/web` ไม่ได้พึ่ง `@itsm/types` (ทำตามแบบเดียวกับ `WipState` และ
 * `Scope` ที่คัดชนิดมาไว้ที่นี่) · รายการที่เขียนไว้สองที่จะไม่ตรงกันในวันที่
 * มีคนแก้แค่ที่เดียว จึงมีเทสต์สแกนซอร์สทั้งสองฝั่งมาเทียบ
 * — `card-fields-sync.spec.ts`
 */
export const CARD_FIELDS = ['priority', 'assignee', 'type', 'sprint', 'updated'] as const;
export type CardFieldKey = (typeof CARD_FIELDS)[number];

/** ตรงกับ `DEFAULT_CARD_FIELDS` ใน `@itsm/types` — เทสต์สแกนเทียบให้ */
export const DEFAULT_CARD_FIELDS: readonly CardFieldKey[] = ['priority', 'assignee'] as const;

export interface BoardCard {
  itemKey: string;
  summary: string;
  assignee: string | null;
  priority: { rank: number; name: string } | null;
  rank: string;
  issueType: string;
  sprint: string | null;
  epic: string | null;
  updatedAt: string;
}

/** ผลตัดสินเพดานงานที่ทำพร้อมกัน — ตรงกับ `WipState` ฝั่ง API */
export type WipState =
  | { kind: 'no-limit'; count: number }
  | { kind: 'under'; count: number; max: number; remaining: number }
  | { kind: 'at'; count: number; max: number }
  | { kind: 'over'; count: number; max: number; excess: number }
  | { kind: 'ambiguous'; count: number; values: number[] };

export interface BoardColumn {
  statusId: string;
  name: string;
  category: string;
  cards: BoardCard[];
  /**
   * จำนวนงานจริงในคอลัมน์ · **ไม่ใช่ `cards.length`**
   *
   * `cards` ถูกตัดที่ 100 ใบ · หัวคอลัมน์เคยแสดง `cards.length` ซึ่งทำให้
   * คอลัมน์ที่มีงาน 150 ใบขึ้นว่า "100" — **ตัวเลขที่ผิดแย่กว่าไม่มีตัวเลข**
   * เพราะคนเชื่อมันแล้วเอาไปตัดสินใจ
   */
  count: number;
  wip: WipState;
}

/** เพดานที่ตั้งไว้ตอนนี้ · `null` เมื่อยังไม่ได้ตั้งหรือตั้งไว้ไม่ตรงกัน */
function currentLimit(w: WipState): number | null {
  /*
    กรณี `ambiguous` คืน `null` โดยตั้งใจ — ช่องกรอกที่เติมค่ามาให้อันหนึ่ง
    จากหลายค่าที่ขัดกัน จะทำให้คนกดบันทึกแล้วเชื่อว่ายืนยันของเดิม
    ทั้งที่เพิ่งทับค่าของอีกฝั่งไป
  */
  return w.kind === 'under' || w.kind === 'at' || w.kind === 'over' ? w.max : null;
}

/**
 * ป้ายบอกสถานะเพดานของคอลัมน์
 *
 * **มีข้อความเสมอ ไม่ใช่สีอย่างเดียว** — คนตาบอดสีและคนที่ใช้ screen reader
 * ต้องอ่านออกเท่ากัน · `null` เมื่อยังไม่ได้ตั้งเพดาน เพราะป้ายที่ขึ้นทุกคอลัมน์
 * ตลอดเวลาไม่ได้บอกอะไรใครเลย
 */
function wipBadge(w: WipState): { text: string; tone: 'over' | 'at' | 'under' } | null {
  switch (w.kind) {
    case 'no-limit':
      return null;
    case 'under':
      return { text: `เพดาน ${String(w.max)} · รับได้อีก ${String(w.remaining)}`, tone: 'under' };
    case 'at':
      // "เต็มพอดี" ไม่ใช่การละเมิด — ข้อความจึงไม่ใช่คำเตือน
      return { text: `เต็มเพดาน ${String(w.max)} แล้ว`, tone: 'at' };
    case 'over':
      return { text: `เกินเพดาน ${String(w.max)} อยู่ ${String(w.excess)} เรื่อง`, tone: 'over' };
    case 'ambiguous':
      /*
        ตั้งไม่ตรงกันระหว่างสถานะที่ยุบเป็นคอลัมน์เดียว · บอกตรง ๆ ว่า
        ตอบไม่ได้ ดีกว่าเลือกมาแสดงอันหนึ่งแล้วให้ครึ่งทีมอ่านค่าที่ไม่ได้ใช้
      */
      return { text: `เพดานตั้งไว้ไม่ตรงกัน (${w.values.join(' · ')})`, tone: 'over' };
  }
}

/** ป้ายเพดานของคอลัมน์หนึ่ง — `null` เมื่อยังไม่ได้ตั้งเพดาน */
function wipNote(col: BoardColumn): ReactNode {
  const badge = wipBadge(col.wip);
  if (badge === null) return null;
  return (
    <p className="board-wip" data-tone={badge.tone}>
      {badge.text}
    </p>
  );
}

/**
 * กระดานงาน
 *
 * ## คีย์บอร์ดก่อน ไม่ใช่ลากอย่างเดียว
 *
 * CLAUDE.md §6: "Board ต้องย้ายการ์ดด้วยคีย์บอร์ดได้ (WCAG — drag-and-drop
 * อย่างเดียวไม่ผ่าน)" · รอบนี้จึงทำคีย์บอร์ดให้ครบก่อน **ยังไม่มีการลาก**
 * ซึ่งเป็นการเลือกลำดับ ไม่ใช่การลืม — ทางที่ผ่านเกณฑ์ต้องมาก่อนทางที่สะดวก
 *
 * ปุ่มลัดผูกกับการ์ดที่โฟกัสอยู่:
 *   `Alt + ←/→`  ย้ายข้ามคอลัมน์ (เปลี่ยนสถานะ ผ่าน workflow จริง)
 *   `Alt + ↑/↓`  เลื่อนลำดับในคอลัมน์เดิม
 *
 * ใช้ `Alt` เพราะลูกศรเปล่าต้องเหลือไว้ให้เลื่อนอ่าน · ปุ่มลัดที่ยึดลูกศร
 * ทำให้คนที่ใช้คีย์บอร์ดอ่านกระดานไม่ได้เลย ซึ่งแย่กว่าการย้ายไม่ได้
 *
 * ผลของทุกการย้ายประกาศผ่าน `aria-live` — คนที่ไม่เห็นหน้าจอต้องรู้ว่า
 * การกดนั้นได้ผลหรือถูกปฏิเสธ ไม่ใช่เดาจากความเงียบ
 *
 * ## การลากด้วยเมาส์มาทีหลัง และเรียกทางเดียวกัน
 *
 * การลากเรียก `move()` ตัวเดียวกับคีย์บอร์ด ไม่มีเส้นทางของตัวเอง —
 * สองเส้นทางที่ทำเรื่องเดียวกันคนละแบบ จะเริ่มต่างกันวันหนึ่งโดยไม่มีใครรู้
 * (เช่น ทางหนึ่งลืมประกาศผ่าน `aria-live` หรือลืมโฟกัสกลับ)
 *
 * ใช้ HTML5 drag-and-drop ของเบราว์เซอร์ ไม่เขียนเอง · **บนมือถือใช้ไม่ได้**
 * ซึ่งยอมรับได้เพราะคีย์บอร์ดกับการกดเข้าไปดูรายละเอียดยังทำงาน — และเป็น
 * เหตุผลที่การลากต้องไม่ใช่ทางเดียวที่ย้ายการ์ดได้ตั้งแต่แรก
 */
export function BoardView({
  apiBase,
  projectKey,
  columns,
  showHelp = true,
  showWip = true,
  canManage = false,
  cardFields = DEFAULT_CARD_FIELDS,
  laneLabel = null,
}: {
  apiBase: string;
  projectKey: string;
  columns: BoardColumn[];
  /**
   * แสดงคำอธิบายปุ่มลัดหรือไม่
   *
   * เมื่อกระดานถูกแบ่งเป็นเลน จะมี `BoardView` หลายตัวบนหน้าเดียว ·
   * คำอธิบายชุดเดียวกันซ้ำห้ารอบเป็นเสียงรบกวน ไม่ใช่ความช่วยเหลือ
   */
  showHelp?: boolean;
  /**
   * แสดงป้ายเพดานของคอลัมน์หรือไม่
   *
   * ปิดเมื่อกระดานถูกแบ่งเลน — เพดานเป็นข้อเท็จจริงของทั้งคอลัมน์
   * ส่วนเลนเห็นแค่บางส่วนของมัน · ป้ายที่บอกว่า "เกินเพดาน 2 อยู่ 1 เรื่อง"
   * เหนือเลนที่มีการ์ดใบเดียว อ่านแล้วขัดกับสิ่งที่ตาเห็น
   */
  showWip?: boolean;
  /**
   * ผู้ใช้ตั้งเพดานได้หรือไม่ — **ค่าปริยายคือไม่ได้**
   *
   * ค่าปริยายที่เปิดไว้จะทำให้หน้าจอใหม่ที่ลืมส่งค่านี้ แสดงช่องกรอก
   * ให้ทุกคน แล้วคนที่กดจะได้ 403 · การไม่รู้ต้องแปลว่าไม่ได้
   * เหมือนกับกติกาสิทธิ์ทุกข้อในโปรเจกต์นี้
   */
  canManage?: boolean;
  /**
   * ฟิลด์ที่การ์ดจะแสดง · ค่าปริยายตรงกับสิ่งที่การ์ดเคยแสดงมาตลอด
   *
   * ค่าปริยายที่เปลี่ยนหน้าตาให้คนที่ไม่ได้ขออะไร คือการเปลี่ยนแปลง
   * ที่ไม่มีใครสั่ง — หน้าจอที่ลืมส่งค่านี้ต้องได้ของเดิม ไม่ใช่ของว่าง
   */
  cardFields?: readonly CardFieldKey[];
  /**
   * ชื่อเลนที่กระดานนี้อยู่ · ใช้ต่อท้าย `aria-label` ของคอลัมน์
   *
   * เมื่อแบ่งเลน ทุกเลนมีคอลัมน์ชื่อเดียวกันหมด · คนที่ไล่ด้วยคีย์บอร์ด
   * จะได้ยิน "รอตรวจสอบ" ห้าครั้งโดยไม่รู้ว่าอันไหนของใคร — เป็นอาการเดียว
   * กับปุ่ม "ถอด" ที่เหมือนกันทุกบรรทัดใน CLAUDE.md
   */
  laneLabel?: string | null;
}): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  /** การ์ดที่กำลังลากอยู่ — `null` = ไม่ได้ลาก */
  const [dragKey, setDragKey] = useState<string | null>(null);
  /** ตำแหน่งที่จะปล่อย — `key` คือการ์ดที่จะไปแทรกอยู่ข้างบน */
  const [dropAt, setDropAt] = useState<{ col: number; key: string | null } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  async function move(
    itemKey: string,
    payload: { toColumn?: string; afterKey?: string; beforeKey?: string },
    say: string,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/boards/${projectKey}/move`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemKey, ...payload }),
      });
      const data = (await res.json()) as { message?: string; statusName?: string };
      if (!res.ok) {
        setError(data.message ?? `ย้ายไม่สำเร็จ (HTTP ${String(res.status)})`);
        // ประกาศคำปฏิเสธด้วย — ความเงียบอ่านเหมือนปุ่มไม่ทำงาน
        setStatus(data.message ?? 'ย้ายไม่สำเร็จ');
        return;
      }
      setStatus(say);
      /*
        โฟกัสจะหายเมื่อ React วาดใหม่ · จำคีย์ไว้แล้วโฟกัสกลับหลังรีเฟรช
        — คนที่ย้ายการ์ดด้วยคีย์บอร์ดแล้วโฟกัสเด้งไปต้นหน้า ต้องไล่ Tab
        ลงมาใหม่ทุกครั้ง ซึ่งทำให้ฟีเจอร์นี้ใช้จริงไม่ได้
      */
      router.refresh();
      window.setTimeout(() => {
        boxRef.current?.querySelector<HTMLElement>(`[data-key="${itemKey}"]`)?.focus();
      }, 400);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      setStatus('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  /**
   * ปล่อยการ์ดลงตำแหน่งหนึ่ง
   *
   * ตรรกะการหาเพื่อนบ้านอยู่ที่ `planDrop` ซึ่งเป็นฟังก์ชันบริสุทธิ์และมีเทสต์
   * คุ้ม — ที่นี่เหลือแค่การล้างสถานะกับเรียก `move()` ตัวเดียวกับคีย์บอร์ด
   */
  function drop(colIdx: number, beforeKey: string | null): void {
    const key = dragKey;
    setDragKey(null);
    setDropAt(null);
    if (key === null || busy) return;
    const plan = planDrop(columns, key, colIdx, beforeKey);
    // `null` = ปล่อยที่เดิม หรือกระดานถูกวาดใหม่ระหว่างลาก — ไม่ต้องเขียนอะไร
    if (plan === null) return;
    void move(key, plan.move, plan.say);
  }

  function onKey(e: React.KeyboardEvent<HTMLButtonElement>, colIdx: number, rowIdx: number): void {
    if (!e.altKey || busy) return;
    const col = columns[colIdx];
    const card = col?.cards[rowIdx];
    if (col === undefined || card === undefined) return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const target = columns[colIdx + (e.key === 'ArrowLeft' ? -1 : 1)];
      if (target === undefined) return;
      e.preventDefault();
      void move(card.itemKey, { toColumn: target.name }, `ย้าย ${card.itemKey} ไป ${target.name}`);
      return;
    }

    if (e.key === 'ArrowUp') {
      // ขึ้นไปอยู่เหนือใบที่อยู่ข้างบน — ใบบนสุดแล้วไม่ต้องทำอะไร
      const above = col.cards[rowIdx - 1];
      if (above === undefined) return;
      e.preventDefault();
      const twoAbove = col.cards[rowIdx - 2];
      void move(
        card.itemKey,
        { beforeKey: above.itemKey, ...(twoAbove === undefined ? {} : { afterKey: twoAbove.itemKey }) },
        `เลื่อน ${card.itemKey} ขึ้นหนึ่งอันดับ`,
      );
      return;
    }

    if (e.key === 'ArrowDown') {
      const below = col.cards[rowIdx + 1];
      if (below === undefined) return;
      e.preventDefault();
      const twoBelow = col.cards[rowIdx + 2];
      void move(
        card.itemKey,
        { afterKey: below.itemKey, ...(twoBelow === undefined ? {} : { beforeKey: twoBelow.itemKey }) },
        `เลื่อน ${card.itemKey} ลงหนึ่งอันดับ`,
      );
    }
  }

  return (
    <>
      {showHelp ? (
      <p className="board-help">
        ลากการ์ดด้วยเมาส์ได้ · หรือโฟกัสที่การ์ดแล้วกด <kbd>Alt</kbd> + <kbd>←</kbd> <kbd>→</kbd>{' '}
        เพื่อย้ายคอลัมน์ · <kbd>Alt</kbd> + <kbd>↑</kbd> <kbd>↓</kbd> เพื่อเลื่อนลำดับ
      </p>
      ) : null}

      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {/* ประกาศผลให้ screen reader — ความเงียบอ่านเหมือนปุ่มไม่ทำงาน */}
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>

      <div className="board" ref={boxRef}>
        {columns.map((col, ci) => (
          <section
            key={col.statusId}
            className="board-col"
            aria-label={laneLabel === null ? col.name : `${col.name} · ${laneLabel}`}
            data-over={dropAt?.col === ci ? 'true' : undefined}
            onDragOver={(e) => {
              // ไม่เรียก preventDefault = เบราว์เซอร์ไม่ยอมให้ปล่อย และไม่มีอะไรบอกว่าทำไม
              if (dragKey === null) return;
              e.preventDefault();
              setDropAt({ col: ci, key: null });
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(ci, null);
            }}
          >
            <h2 className="board-col-head">
              <StatusPill label={col.name} category={col.category as StatusCategory} />
              {/* จำนวนจริง ไม่ใช่จำนวนที่แสดง — ดู `count` ใน BoardColumn */}
              <span className="board-count">{col.count.toLocaleString('th-TH')}</span>
            </h2>

            {/*
              ป้ายเพดานแสดงเฉพาะตอนไม่แบ่งเลน — เพดานเป็นข้อเท็จจริงของ
              **ทั้งคอลัมน์** ไม่ใช่ของเลน · ขึ้นทุกเลนคือการบอกเรื่องเดียวกัน
              ห้ารอบ และตัวเลขจะไม่ตรงกับจำนวนการ์ดที่เห็นในเลนนั้นด้วย
            */}
            {showWip ? wipNote(col) : null}
            {showWip && canManage ? (
              <WipLimitEditor
                apiBase={apiBase}
                projectKey={projectKey}
                column={col.name}
                current={currentLimit(col.wip)}
                onSaved={() => {
                  router.refresh();
                }}
              />
            ) : null}

            {col.cards.length === 0 ? (
              <p className="board-empty">ไม่มีเรื่องในคอลัมน์นี้</p>
            ) : (
              <ul className="board-cards">
                {col.cards.map((card, ri) => (
                  <li
                    key={card.itemKey}
                    data-drop={dropAt?.col === ci && dropAt.key === card.itemKey ? 'true' : undefined}
                    onDragOver={(e) => {
                      if (dragKey === null) return;
                      e.preventDefault();
                      // หยุดไม่ให้คอลัมน์เคลมการปล่อยนี้ไปเป็น "ต่อท้าย"
                      e.stopPropagation();
                      setDropAt({ col: ci, key: card.itemKey });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      drop(ci, card.itemKey);
                    }}
                  >
                    <button
                      type="button"
                      className="board-card"
                      data-key={card.itemKey}
                      disabled={busy}
                      draggable={!busy}
                      onDragStart={(e) => {
                        setDragKey(card.itemKey);
                        // ต้องใส่ข้อมูลอย่างน้อยหนึ่งอย่าง ไม่งั้น Firefox ไม่เริ่มลาก
                        e.dataTransfer.setData('text/plain', card.itemKey);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        // ลากออกไปนอกกระดานแล้วปล่อย — ต้องล้างสถานะ ไม่ใช่ค้างเป็นเงา
                        setDragKey(null);
                        setDropAt(null);
                      }}
                      /*
                        ชื่อสำหรับ screen reader บอกตำแหน่งด้วย — "การ์ดที่ 2
                        จาก 5 ในคอลัมน์ …" · คนที่ย้ายการ์ดโดยไม่เห็นหน้าจอ
                        ต้องรู้ว่าตัวเองอยู่ตรงไหนก่อนกด
                      */
                      aria-label={`${card.itemKey} ${card.summary} — อันดับ ${String(ri + 1)} จาก ${String(col.cards.length)} ในคอลัมน์ ${col.name}`}
                      onKeyDown={(e) => {
                        onKey(e, ci, ri);
                      }}
                      onClick={() => {
                        router.push(`/browse/${card.itemKey}`);
                      }}
                    >
                      <span className="board-card-key">{card.itemKey}</span>
                      <span className="board-card-summary">{card.summary}</span>
                      {/*
                        แสดงเฉพาะฟิลด์ที่ผู้ใช้เลือก · **ปิดหมดแล้วแถวล่าง
                        หายไปทั้งแถว ไม่ใช่เหลือกล่องเปล่า** ซึ่งจะกินที่
                        โดยไม่บอกอะไร
                      */}
                      {cardFields.length === 0 ? null : (
                        <span className="board-card-foot">
                          {cardFields.includes('priority') ? (
                            <span
                              className="board-card-pri"
                              data-rank={String((card.priority?.rank ?? 5) as PriorityRank)}
                            >
                              {card.priority?.name ?? 'ไม่ระบุ'}
                            </span>
                          ) : null}
                          {cardFields.includes('type') ? (
                            <span className="board-card-meta">{card.issueType}</span>
                          ) : null}
                          {cardFields.includes('sprint') ? (
                            <span className="board-card-meta">
                              {card.sprint ?? 'ไม่อยู่ในรอบไหน'}
                            </span>
                          ) : null}
                          {cardFields.includes('updated') ? (
                            <span className="board-card-meta">{thaiDayLabel(thaiDayKey(new Date(card.updatedAt)))}</span>
                          ) : null}
                          {cardFields.includes('assignee') ? (
                            <span className="board-card-who">
                              {card.assignee ?? 'ยังไม่มีผู้รับผิดชอบ'}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
