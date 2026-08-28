'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Alert, Button, Input } from '@itsm/ui';

export interface Satisfaction {
  rating: number;
  comment: string | null;
  respondedAt: string;
  isMine: boolean;
}

/** คำอธิบายของแต่ละคะแนน — ตัวเลขเปล่า ๆ แปลว่าอะไรก็ได้แล้วแต่คนกด */
const LABELS: Record<number, string> = {
  1: 'แย่มาก',
  2: 'ไม่ค่อยดี',
  3: 'พอใช้',
  4: 'ดี',
  5: 'ดีมาก',
};

/**
 * ให้คะแนนความพอใจ
 *
 * **ถามได้ครั้งเดียวคือตอนเพิ่งปิด** — ความรู้สึกต่อเรื่องที่ปิดไปสามเดือนแล้ว
 * ย้อนกลับไปถามไม่ได้ · หน้าจอนี้จึงขึ้นทันทีที่เรื่องปิด ไม่ต้องรออีเมล
 *
 * ปุ่มเป็นตัวเลข **พร้อมคำ** ไม่ใช่ดาวเปล่า ๆ — ดาว 3 ดวงแปลว่าอะไรขึ้นกับคนกด
 * และค่าเฉลี่ยที่ประกอบจากความหมายคนละแบบ อ่านไม่ได้
 */
export function RatingForm({
  apiBase,
  itemKey,
  current,
}: {
  apiBase: string;
  itemKey: string;
  current: Satisfaction | null;
}): ReactNode {
  const router = useRouter();
  const [rating, setRating] = useState(current?.rating ?? 0);
  const [comment, setComment] = useState(current?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(current !== null);
  // ตอบไปแล้วให้แสดงผล จนกว่าจะกด "แก้คำตอบ" — ไม่ใช่โชว์ฟอร์มค้างไว้ให้กดซ้ำ
  const [editing, setEditing] = useState(current === null);

  async function send(value: number): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/rating`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating: value, comment }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(d?.message ?? `ส่งคะแนนไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setRating(value);
      setDone(true);
      setEditing(false);
      // ให้เซิร์ฟเวอร์ส่งหน้าใหม่ ไม่ใช่เดาผลเอง
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ คะแนนยังไม่ถูกบันทึก');
    } finally {
      setBusy(false);
    }
  }

  if (done && !editing) {
    return (
      <section className="csat" aria-label="ความพอใจ">
        <b className="csat-title">ขอบคุณสำหรับคะแนน</b>
        <p className="csat-done">
          คุณให้ <b>{LABELS[rating] ?? rating}</b>
          {comment.trim() === '' ? null : <> · “{comment}”</>}
        </p>
        <button
          type="button"
          className="admin-linkish"
          onClick={() => {
            setEditing(true);
          }}
        >
          แก้คำตอบ
        </button>
      </section>
    );
  }

  return (
    <section className="csat" aria-label="ให้คะแนนความพอใจ">
      <b className="csat-title">เรื่องนี้จบแล้ว — เป็นอย่างไรบ้าง</b>

      <div className="csat-scale" role="group" aria-label="เลือกคะแนน 1 ถึง 5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className="csat-choice"
            data-picked={rating === n ? 'true' : undefined}
            disabled={busy}
            aria-pressed={rating === n}
            onClick={() => {
              void send(n);
            }}
          >
            <span className="csat-num">{n}</span>
            <span className="csat-label">{LABELS[n]}</span>
          </button>
        ))}
      </div>

      {/* ความเห็นไม่บังคับ — บังคับพิมพ์ทำให้คนไม่ให้คะแนนเลย */}
      <label className="csat-comment" htmlFor="csat-note">
        อยากบอกอะไรเพิ่ม (ไม่บังคับ)
        <Input
          id="csat-note"
          value={comment}
          onChange={setComment}
          placeholder="เช่น แก้ได้เร็วดี แต่ติดต่อยากหน่อย"
          maxLength={500}
        />
      </label>

      {rating === 0 ? null : (
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            void send(rating);
          }}
        >
          {busy ? 'กำลังบันทึก…' : 'บันทึกคำตอบ'}
        </Button>
      )}

      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}
    </section>
  );
}
