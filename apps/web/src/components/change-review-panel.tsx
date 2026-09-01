'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Field, LinkButton, Select, Textarea, Timestamp } from '@itsm/ui';

type Outcome = 'SUCCESS' | 'PARTIAL' | 'FAILED';

interface ReviewView {
  outcome: Outcome;
  outcomeLabel: string;
  rolledBack: boolean;
  notes: string | null;
  reviewedBy: string;
  reviewedAt: string;
  updatedAt: string;
}

interface ReviewState {
  review: ReviewView | null;
  reviewableFrom: string | null;
}

const OUTCOMES: Array<{ value: Outcome; label: string }> = [
  { value: 'SUCCESS', label: 'สำเร็จตามแผน' },
  { value: 'PARTIAL', label: 'สำเร็จบางส่วน' },
  { value: 'FAILED', label: 'ไม่สำเร็จ' },
];

/**
 * การทบทวนหลังทำ (Post-Implementation Review)
 *
 * ## แผงขึ้นเฉพาะเมื่อมีช่วงเวลาดำเนินการ
 *
 * ไม่มีช่วงเวลา = ยังไม่ใช่การเปลี่ยนแปลงที่นัดไว้ · การขึ้นแบบฟอร์มทบทวน
 * บนใบแจ้งปัญหาทุกใบคือเสียงรบกวน กติกาเดียวกับแผงความเสี่ยง
 *
 * ## ยังไม่ถึงเวลา → บอกว่าเมื่อไร ไม่ใช่ซ่อนปุ่มเฉย ๆ
 *
 * `reviewableFrom` มาจากเซิร์ฟเวอร์ ซึ่งเป็นเงื่อนไขเดียวกับที่เอนจินใช้
 * ตัดสิน · ถ้าหน้าจอคำนวณเอง สองที่จะเพี้ยนจากกันในวันที่กติกาเปลี่ยน
 * แล้วฟอร์มจะเปิดให้กรอกทั้งที่เซิร์ฟเวอร์จะปฏิเสธ
 *
 * ## "ย้อนกลับแล้วหรือยัง" ไม่มีค่าเริ่มต้น
 *
 * ช่องนี้เริ่มจาก **ยังไม่ตอบ** · ถ้าตั้งค่าเริ่มต้นเป็น "ยังไม่ได้ย้อน"
 * ฟอร์มจะตอบแทนคนกรอก แล้วรายงานจะอ่านค่าที่ระบบแต่งขึ้นเองเหมือนเป็น
 * คำตอบของคน — เซิร์ฟเวอร์ปฏิเสธถ้าไม่ตอบและผลไม่ใช่ "สำเร็จ"
 *
 * ## ฟอร์มไม่ถูกล้างเมื่อเซิร์ฟเวอร์ปฏิเสธ
 *
 * `send()` คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void` · การปิดฟอร์มผูกกับ
 * "เซิร์ฟเวอร์รับแล้ว" ไม่ใช่ "เรียกฟังก์ชันเสร็จแล้ว" ซึ่งเป็นคนละเรื่อง
 * (บทเรียนใน CLAUDE.md)
 */
export function ChangeReviewPanel({
  apiBase,
  itemKey,
}: {
  apiBase: string;
  itemKey: string;
}): ReactNode {
  const [data, setData] = useState<ReviewState | null>(null);
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [rolledBack, setRolledBack] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/change-review`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setData(null);
        return;
      }
      const d = (await res.json()) as ReviewState;
      setData(d);
      if (d.review !== null) {
        setOutcome(d.review.outcome);
        setRolledBack(d.review.rolledBack ? 'yes' : 'no');
        setNotes(d.review.notes ?? '');
      }
    } catch {
      setData(null);
    }
  }, [apiBase, itemKey]);

  useEffect(() => {
    void load();
  }, [load]);

  /** คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void` — ผู้เรียกต้องแยกสองอย่างนี้ได้ */
  async function send(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/change-review`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          outcome,
          // ไม่ส่งอะไรเลยเมื่อยังไม่ตอบ — `false` เป็นคำตอบ ไม่ใช่การไม่ตอบ
          ...(rolledBack === '' ? {} : { rolledBack: rolledBack === 'yes' }),
          notes,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(d?.message ?? `บันทึกไม่สำเร็จ (HTTP ${String(res.status)})`);
        return false;
      }
      await load();
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (data === null) return null;
  // ไม่มีช่วงเวลาดำเนินการ = ยังไม่ใช่การเปลี่ยนแปลงที่นัดไว้
  if (data.reviewableFrom === null) return null;

  const started = Date.parse(data.reviewableFrom) <= Date.now();
  const review = data.review;
  const showForm = started && (editing || review === null);

  return (
    <section className="pir" aria-label="การทบทวนหลังทำ">
      <div className="pir-head">
        <h2 className="detail-section-title">ทบทวนหลังทำ</h2>
        {review === null || editing || !started ? null : (
          <LinkButton
            disabled={busy}
            onClick={() => {
              setEditing(true);
            }}
          >
            แก้ผลการทบทวน
          </LinkButton>
        )}
      </div>

      {started ? null : (
        <p className="pir-quiet">
          ทบทวนได้หลังเริ่มดำเนินการ — เริ่ม <Timestamp utc={data.reviewableFrom} />
        </p>
      )}

      {review === null ? null : (
        <dl className="pir-summary">
          <div>
            <dt>ผล</dt>
            <dd data-outcome={review.outcome}>{review.outcomeLabel}</dd>
          </div>
          <div>
            <dt>ย้อนกลับ</dt>
            <dd>{review.rolledBack ? 'ย้อนกลับแล้ว' : 'ไม่ได้ย้อนกลับ'}</dd>
          </div>
          <div>
            <dt>ทบทวนโดย</dt>
            <dd>
              {review.reviewedBy} · <Timestamp utc={review.reviewedAt} />
            </dd>
          </div>
        </dl>
      )}

      {review === null || review.notes === null ? null : (
        <p className="pir-notes">{review.notes}</p>
      )}

      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}

      {!showForm ? null : (
        <div className="pir-form">
          <Field label="ผลของการเปลี่ยนแปลง" htmlFor="pir-outcome" required>
            <Select
              id="pir-outcome"
              value={outcome}
              onChange={setOutcome}
              placeholder="เลือกผล"
              options={OUTCOMES.map((o) => ({ value: o.value, label: o.label }))}
            />
          </Field>

          {/*
            ไม่มีค่าเริ่มต้น — ฟอร์มที่ตอบแทนคนกรอกทำให้รายงานอ่านค่าที่ระบบ
            แต่งขึ้นเองเหมือนเป็นคำตอบของคน
          */}
          <Field
            label="ย้อนกลับแล้วหรือยัง"
            htmlFor="pir-rollback"
            required={outcome !== '' && outcome !== 'SUCCESS'}
            hint="จำเป็นเมื่อผลไม่ใช่ “สำเร็จตามแผน” — ถ้าไม่ตอบ จะไม่มีใครรู้ว่าตอนนี้ระบบอยู่ในสภาพไหน"
          >
            <Select
              id="pir-rollback"
              value={rolledBack}
              onChange={setRolledBack}
              placeholder="ยังไม่ตอบ"
              options={[
                { value: 'no', label: 'ไม่ได้ย้อนกลับ — ของใหม่ยังอยู่' },
                { value: 'yes', label: 'ย้อนกลับแล้ว — กลับไปใช้ของเดิม' },
              ]}
            />
          </Field>

          <Field
            label="สิ่งที่ได้เรียนรู้"
            htmlFor="pir-notes"
            required={outcome !== '' && outcome !== 'SUCCESS'}
            hint="ครั้งหน้าต้องทำอะไรต่างไป — บังคับกรอกเมื่อไม่สำเร็จ"
          >
            <Textarea id="pir-notes" value={notes} onChange={setNotes} rows={4} />
          </Field>

          <div className="admin-btn-row">
            <Button
              variant="primary"
              disabled={busy || outcome === ''}
              onClick={() => {
                void send().then((ok) => {
                  // ปิดฟอร์มเมื่อเซิร์ฟเวอร์รับแล้วเท่านั้น ไม่ใช่เมื่อเรียกเสร็จ
                  if (ok) setEditing(false);
                });
              }}
            >
              บันทึกผลการทบทวน
            </Button>
            {review === null ? null : (
              <LinkButton
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setError(null);
                  setOutcome(review.outcome);
                  setRolledBack(review.rolledBack ? 'yes' : 'no');
                  setNotes(review.notes ?? '');
                }}
              >
                ยกเลิก
              </LinkButton>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
