'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  /** ปิดจากภายใน — Escape · คลิกนอกกล่อง · ปุ่มปิด */
  onClose: () => void;
  /** หัวเรื่อง — เป็นชื่อที่ screen reader อ่านให้ฟังตอนเปิด */
  title: string;
  /** ข้อความอธิบายใต้หัวเรื่อง */
  lead?: string;
  children: ReactNode;
  /** กว้างเต็มที่ — `wide` สำหรับตารางหรือรายการยาว */
  size?: 'default' | 'wide';
}

/** อะไรที่โฟกัสได้ในกล่อง — ใช้ทั้งตอนโฟกัสตัวแรกและตอนวน Tab */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * กล่องซ้อนหน้าจอ
 *
 * เขียนเองแทนที่จะใช้ `<dialog>` เพราะ `showModal()` ต้องเรียกแบบ imperative
 * และสถานะของมันอยู่ใน DOM ไม่ใช่ใน React ทำให้ prop `open` กับความจริง
 * หลุดจากกันได้เงียบ ๆ เวลา re-render
 *
 * ## สามข้อที่ทำให้กล่องซ้อนใช้งานได้จริงด้วยคีย์บอร์ด
 *
 *   1. **โฟกัสต้องเข้าไปในกล่องตอนเปิด** — ไม่งั้นคนที่ใช้คีย์บอร์ดยังยืนอยู่
 *      หลังฉากดำ กด Tab แล้ววิ่งไปในหน้าที่มองไม่เห็น
 *   2. **Tab ต้องวนอยู่ในกล่อง** — หลุดออกไปข้างนอกแล้วกลับเข้ามาไม่ได้
 *   3. **ปิดแล้วโฟกัสต้องกลับที่เดิม** — ไม่ใช่เด้งไปต้นหน้า · คนที่กดปุ่มที่
 *      แถวที่ 40 ต้องกลับไปยืนที่นั่น ไม่ใช่ต้องไล่ Tab ลงมาใหม่ทั้งหน้า
 *
 * ข้อ 3 คือข้อที่ถูกลืมบ่อยที่สุด และเป็นข้อที่คนใช้เมาส์ไม่มีวันสังเกตเห็น
 */
export function Modal({
  open,
  onClose,
  title,
  lead,
  children,
  size = 'default',
}: ModalProps): ReactNode {
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** ที่ที่โฟกัสอยู่ก่อนเปิด — ต้องคืนให้ตอนปิด */
  const returnToRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const leadId = useId();

  useEffect(() => {
    if (!open) return;

    returnToRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // โฟกัสตัวแรกที่โฟกัสได้ · ถ้าไม่มีเลยให้โฟกัสตัวกล่องเอง (มี tabIndex -1)
    const first = boxRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? boxRef.current)?.focus();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      /*
        วน Tab ในกล่อง

        อ่านรายการใหม่ทุกครั้ง ไม่เก็บไว้ตอนเปิด — เนื้อในกล่องเปลี่ยนได้
        ระหว่างเปิดอยู่ (รายการผลค้นหาที่โหลดมาทีหลัง) และรายการที่ค้างอยู่
        จะพาโฟกัสไปที่ปุ่มที่ไม่มีอยู่แล้ว
      */
      // `Array.from` ไม่ใช่ spread — `NodeListOf` ไม่มี iterator ในชุด lib ที่โปรเจกต์นี้ตั้งไว้
      const nodes = boxRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      const items: HTMLElement[] = nodes === undefined ? [] : Array.from(nodes);
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (firstItem === undefined || lastItem === undefined) return;

      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // คืนโฟกัสที่เดิม — ข้อที่คนใช้เมาส์ไม่มีวันสังเกตว่าหายไป
      returnToRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ui-modal-backdrop"
      /*
        ปิดเมื่อคลิกฉากหลัง แต่ **ไม่ปิดเมื่อคลิกในกล่อง** — ต้องเทียบ target
        กับ currentTarget ไม่ใช่ใช้ `stopPropagation` ที่กล่อง ซึ่งจะกลืน
        เหตุการณ์ที่โค้ดอื่นรออยู่ด้วย
      */
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        className="ui-modal"
        data-size={size}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(lead === undefined ? {} : { 'aria-describedby': leadId })}
        tabIndex={-1}
      >
        <div className="ui-modal-head">
          <h2 id={titleId} className="ui-modal-title">
            {title}
          </h2>
          <button type="button" className="ui-modal-x" onClick={onClose} aria-label="ปิด">
            ✕
          </button>
        </div>
        {lead === undefined ? null : (
          <p id={leadId} className="ui-modal-lead">
            {lead}
          </p>
        )}
        <div className="ui-modal-body">{children}</div>
      </div>
    </div>
  );
}
