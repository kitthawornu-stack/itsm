'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { Button, Checkbox } from '@itsm/ui';

import { CARD_FIELDS, type CardFieldKey } from './board-view';

/** ป้ายภาษาไทย — ตรงกับ `CARD_FIELD_LABEL` ใน `@itsm/types` */
const LABEL: Record<CardFieldKey, string> = {
  priority: 'ระดับความสำคัญ',
  assignee: 'ผู้รับผิดชอบ',
  type: 'ประเภทงาน',
  sprint: 'รอบที่อยู่',
  updated: 'แก้ไขล่าสุด',
};

/**
 * เลือกว่าการ์ดบนกระดานจะแสดงอะไร
 *
 * **เป็นค่าของแต่ละคน** — คนที่ดูงานของตัวเองกับคนที่จัดคิวให้ทั้งทีม
 * อยากเห็นคนละอย่างบนกระดานเดียวกัน · จึงไม่ต้องมีสิทธิ์จัดการโปรเจกต์
 * และไม่มีใครแก้ของคนอื่นได้
 *
 * **ปิดทุกช่องได้จริง** และไม่ถูกตีกลับเป็นค่าปริยาย — ถ้าตีกลับ ผู้ใช้
 * ที่ตั้งใจปิดทุกอย่างจะเห็นของเดิมกลับมา แล้วเชื่อว่าปุ่มบันทึกพัง
 */
export function CardFieldPicker({
  apiBase,
  projectKey,
  current,
  isDefault,
}: {
  apiBase: string;
  projectKey: string;
  current: readonly CardFieldKey[];
  /** ยังไม่เคยตั้งค่าเอง — ใช้ตัดสินว่าจะแสดงปุ่มกลับไปใช้ค่าปริยายไหม */
  isDefault: boolean;
}): ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<CardFieldKey[]>([...current]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  /**
   * บันทึก · **คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void`**
   *
   * ตัวช่วยที่กลืน error ไว้เองทำให้ promise สำเร็จเสมอ แล้วผู้เรียก
   * จะปิดฟอร์มทั้งตอนที่ถูกปฏิเสธ (บทเรียนใน CLAUDE.md)
   */
  /**
   * ส่งค่าไปเซิร์ฟเวอร์ · `null` = กลับไปเป็น "ยังไม่เคยตั้ง"
   *
   * **คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void`** — ตัวช่วยที่กลืน error ไว้เอง
   * ทำให้ promise สำเร็จเสมอ แล้วผู้เรียกจะปิดฟอร์มทั้งตอนที่ถูกปฏิเสธ
   */
  async function send(fields: CardFieldKey[] | null): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/v1/boards/${encodeURIComponent(projectKey)}/card-fields`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fields }),
        },
      );
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        const msg = data.message ?? `บันทึกไม่สำเร็จ (HTTP ${String(res.status)})`;
        setError(msg);
        setStatus(msg);
        return false;
      }
      setStatus(
        fields === null
          ? 'กลับไปใช้ค่าปริยายแล้ว'
          : fields.length === 0
            ? 'การ์ดจะไม่แสดงข้อมูลเพิ่มแล้ว'
            : `แสดง ${String(fields.length)} อย่าง`,
      );
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      setStatus('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <p className="card-pref">
        <Button
          variant="ghost"
          onClick={() => {
            setPicked([...current]);
            setOpen(true);
          }}
        >
          เลือกข้อมูลบนการ์ด
        </Button>
      </p>
    );
  }

  return (
    <div className="card-pref card-pref-open">
      <fieldset className="card-pref-set">
        <legend className="card-pref-legend">ข้อมูลที่จะแสดงบนการ์ด</legend>
        {CARD_FIELDS.map((f) => (
          <Checkbox
            key={f}
            checked={picked.includes(f)}
            onChange={(on) => {
              /*
                คงลำดับตาม `CARD_FIELDS` เสมอ ไม่ใช่ลำดับที่กด —
                การ์ดที่เรียงข้อมูลไม่เหมือนกันในแต่ละครั้งที่ตั้งค่า
                ทำให้กวาดตาหาของเดิมไม่เจอ
              */
              setPicked(
                on
                  ? CARD_FIELDS.filter((x) => x === f || picked.includes(x))
                  : picked.filter((x) => x !== f),
              );
            }}
          >
            {LABEL[f]}
          </Checkbox>
        ))}
      </fieldset>

      <p className="card-pref-actions">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            void send(picked).then((ok) => {
              // ปิดเมื่อเซิร์ฟเวอร์รับแล้วเท่านั้น
              if (!ok) return;
              setOpen(false);
              router.refresh();
            });
          }}
        >
          บันทึก
        </Button>
        {isDefault ? null : (
          /*
            แสดงเฉพาะตอนที่ตั้งค่าเองไว้แล้ว — ปุ่มที่กดแล้วไม่เกิดอะไร
            ทำให้คนสงสัยว่ากดถูกหรือเปล่า
          */
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              void send(null).then((ok) => {
                if (!ok) return;
                setOpen(false);
                router.refresh();
              });
            }}
          >
            กลับไปใช้ค่าปริยาย
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          ยกเลิก
        </Button>
      </p>

      {error === null ? null : (
        <p className="card-pref-error" role="alert">
          {error}
        </p>
      )}
      {/* ประกาศผลให้ screen reader — ความเงียบอ่านเหมือนปุ่มไม่ทำงาน */}
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
