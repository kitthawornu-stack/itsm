'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { TextLink } from '@itsm/ui';

interface Workaround {
  articleId: string;
  title: string;
  problemKey: string;
  problemSummary: string;
  problemResolved: boolean;
}

/**
 * วิธีแก้จากปัญหาที่เป็นสาเหตุ (Known Error)
 *
 * ## ทำไมอยู่บนสุดของหน้า
 *
 * คุณค่าทั้งหมดของ Known Error อยู่ที่ **คนรับเรื่องเห็นวิธีแก้ก่อนลงมือ** ·
 * บทความที่อยู่ท้ายหน้าจะถูกเจอหลังจากไล่แก้เองเสร็จแล้ว ซึ่งเท่ากับไม่มี ·
 * แผงนี้ **ไม่ขึ้นเลย** เมื่อไม่มีปัญหาต้นทางที่มีบทความ จึงไม่รบกวนเรื่องทั่วไป
 * ที่เป็นส่วนใหญ่
 *
 * ## ปัญหาที่ปิดแล้วก็ยังแสดง แต่ติดป้าย
 *
 * **บอก ไม่ใช่ซ่อน** — ปัญหาที่ปิดแล้วมักแปลว่ามีการแก้ถาวรไปแล้ว
 * เรื่องใบนี้ที่ยังค้างอาจแค่ยังไม่ได้รับการแก้นั้น · ถ้าซ่อนทิ้ง คนรับเรื่อง
 * จะไม่รู้ว่ามีคำตอบอยู่เลย ส่วนถ้าแสดงโดยไม่บอก เขาอาจไปทำวิธีแก้ชั่วคราว
 * ทั้งที่มีวิธีแก้ถาวรรออยู่
 */
export function WorkaroundPanel({
  apiBase,
  itemKey,
}: {
  apiBase: string;
  itemKey: string;
}): ReactNode {
  const [rows, setRows] = useState<Workaround[] | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/workarounds`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) return;
      setRows(((await res.json()) as { rows: Workaround[] }).rows);
    } catch {
      // เงียบโดยตั้งใจ — แผงนี้เป็นข้อมูลเสริม ไม่ควรขึ้น error บนหน้าที่อ่านเรื่อง
    }
  }, [apiBase, itemKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows === null || rows.length === 0) return null;

  return (
    <section className="wka" aria-label="วิธีแก้จากปัญหาที่เป็นสาเหตุ">
      <h2 className="detail-section-title">เรื่องนี้เคยมีคนแก้ไว้แล้ว</h2>
      <p className="wka-lead">
        เรื่องนี้ถูกระบุว่าเกิดจากปัญหาที่มีบันทึกวิธีแก้อยู่แล้ว — อ่านก่อนเริ่มลงมือ
      </p>

      <ul className="wka-list">
        {rows.map((w) => (
          <li key={w.articleId}>
            <TextLink
              href={`/knowledge/${w.articleId}`}
              ariaLabel={`เปิดบทความ ${w.title} จากปัญหา ${w.problemKey}`}
            >
              {w.title}
            </TextLink>
            <span className="wka-from">
              {/*
                บอกว่าบทความเป็นของปัญหาใบไหน ไม่ใช่ของเรื่องนี้ · ถ้าไม่บอก
                คนจะแก้บทความด้วยรายละเอียดของเคสตัวเอง แล้วคำตอบที่ใช้ได้
                กับทุกเคสก็หายไป
              */}
              จาก{' '}
              <TextLink
                href={`/browse/${w.problemKey}`}
                ariaLabel={`เปิดปัญหา ${w.problemKey} ${w.problemSummary}`}
              >
                {w.problemKey}
              </TextLink>{' '}
              {w.problemSummary}
            </span>
            {/*
              ป้ายเป็นข้อความ ไม่ใช่คอมโพเนนต์ใหม่ · `packages/ui` ยังไม่มีป้ายกำกับ
              แบบอ่านอย่างเดียว และ `LabelChip` เป็นของที่กดได้ การเอามาใช้เป็นป้าย
              จะให้ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้นกับคนที่ไล่ด้วยคีย์บอร์ด
            */}
            {w.problemResolved ? (
              <span className="wka-resolved">ปัญหาต้นทางแก้ถาวรไปแล้ว</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
