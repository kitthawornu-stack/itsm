'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { Alert, StatusPill, type PriorityRank, type StatusCategory } from '@itsm/ui';

export interface BoardCard {
  itemKey: string;
  summary: string;
  assignee: string | null;
  priority: { rank: number; name: string } | null;
  rank: string;
}

export interface BoardColumn {
  statusId: string;
  name: string;
  category: string;
  cards: BoardCard[];
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
 */
export function BoardView({
  apiBase,
  projectKey,
  columns,
}: {
  apiBase: string;
  projectKey: string;
  columns: BoardColumn[];
}): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
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
      <p className="board-help">
        โฟกัสที่การ์ดแล้วกด <kbd>Alt</kbd> + <kbd>←</kbd> <kbd>→</kbd> เพื่อย้ายคอลัมน์ ·{' '}
        <kbd>Alt</kbd> + <kbd>↑</kbd> <kbd>↓</kbd> เพื่อเลื่อนลำดับ
      </p>

      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {/* ประกาศผลให้ screen reader — ความเงียบอ่านเหมือนปุ่มไม่ทำงาน */}
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>

      <div className="board" ref={boxRef}>
        {columns.map((col, ci) => (
          <section key={col.statusId} className="board-col" aria-label={col.name}>
            <h2 className="board-col-head">
              <StatusPill label={col.name} category={col.category as StatusCategory} />
              <span className="board-count">{col.cards.length.toLocaleString('th-TH')}</span>
            </h2>

            {col.cards.length === 0 ? (
              <p className="board-empty">ไม่มีเรื่องในคอลัมน์นี้</p>
            ) : (
              <ul className="board-cards">
                {col.cards.map((card, ri) => (
                  <li key={card.itemKey}>
                    <button
                      type="button"
                      className="board-card"
                      data-key={card.itemKey}
                      disabled={busy}
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
                      <span className="board-card-foot">
                        <span
                          className="board-card-pri"
                          data-rank={String((card.priority?.rank ?? 5) as PriorityRank)}
                        >
                          {card.priority?.name ?? 'ไม่ระบุ'}
                        </span>
                        <span className="board-card-who">
                          {card.assignee ?? 'ยังไม่มีผู้รับผิดชอบ'}
                        </span>
                      </span>
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
