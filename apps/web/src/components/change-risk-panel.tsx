'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

/** เหตุการณ์ที่ทำให้ต้องคำนวณระดับใหม่ — ดู doc ของคอมโพเนนต์ */
export const RISK_CHANGED_EVENT = 'itsm:change-risk-stale';

interface Reason {
  code: string;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  detail: string;
}

interface Assessment {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  label: string;
  reasons: Reason[];
}

/**
 * ระดับความเสี่ยงของการเปลี่ยนแปลง
 *
 * ## แผงขึ้นเมื่อมีคนเริ่มวางแผนแล้วเท่านั้น
 *
 * เรื่องส่วนใหญ่ในระบบไม่ใช่การเปลี่ยนแปลง · การขึ้นคำว่า "เสี่ยงปานกลาง"
 * บนใบแจ้งปัญหาทุกใบ จะฝึกให้ทุกคนเลิกอ่านมันภายในสองสัปดาห์ — แล้ววันที่
 * มีใบที่เสี่ยงสูงจริง ก็จะไม่มีใครเห็น
 *
 * เงื่อนไข: **ซ่อนเมื่อยังไม่มีทั้ง CI และช่วงเวลา** ซึ่งอ่านได้จากคำตอบเอง
 * (มีทั้ง `no-ci` และ `no-window`) ไม่ต้องยิงเพิ่ม · พอมีอย่างใดอย่างหนึ่ง
 * แปลว่ามีคนเริ่มวางแผนแล้ว แผงจึงขึ้นและบอกว่ายังขาดอะไร
 *
 * ## ต้องคำนวณใหม่เมื่อของรอบตัวเปลี่ยน
 *
 * ระดับมาจาก CI ที่ผูกไว้ (แผงอื่น) และช่วงเวลา (แผงอื่นอีกใบ) · ถ้าไม่ฟัง
 * การเปลี่ยนของทั้งสอง แผงนี้จะแสดงระดับเก่าค้างไว้หลังคนกดผูก CI เพิ่ม
 * ซึ่งเป็นตัวเลขที่ผิดโดยไม่มีอะไรฟ้อง · แผงที่แก้ข้อมูลจึงส่ง
 * `RISK_CHANGED_EVENT` ออกมาให้แผงนี้โหลดใหม่
 *
 * ## ระดับไม่กั้นอะไร — และหน้าจอต้องไม่ทำให้ดูเหมือนกั้น
 *
 * ยังไม่มี validator ตัวไหนใช้ระดับนี้ห้าม transition · ข้อความจึงเขียนว่า
 * "ควรให้ CAB ดู" ไม่ใช่ "ต้องผ่าน CAB" — คำหลังเป็นคำสัญญาที่ระบบทำตามไม่ได้
 */
export function ChangeRiskPanel({
  apiBase,
  itemKey,
}: {
  apiBase: string;
  itemKey: string;
}): ReactNode {
  const [data, setData] = useState<Assessment | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/change-risk`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setData(null);
        return;
      }
      setData((await res.json()) as Assessment);
    } catch {
      // เงียบโดยตั้งใจ — แผงนี้เป็นข้อมูลเสริม ไม่ควรขึ้น error บนหน้าที่อ่านเรื่อง
      setData(null);
    }
  }, [apiBase, itemKey]);

  useEffect(() => {
    void load();
    const onStale = (): void => {
      void load();
    };
    window.addEventListener(RISK_CHANGED_EVENT, onStale);
    return () => {
      window.removeEventListener(RISK_CHANGED_EVENT, onStale);
    };
  }, [load]);

  if (data === null) return null;

  const codes = new Set(data.reasons.map((r) => r.code));
  if (codes.has('no-ci') && codes.has('no-window')) return null;

  return (
    <section className="crk" data-level={data.level} aria-label="ระดับความเสี่ยงของการเปลี่ยนแปลง">
      <div className="crk-head">
        <h2 className="detail-section-title">ความเสี่ยง</h2>
        <span className="crk-level">{data.label}</span>
      </div>

      {data.reasons.length === 0 ? (
        <p className="crk-quiet">ไม่พบปัจจัยที่ต้องระวังจากสิ่งที่กรอกไว้</p>
      ) : (
        <ul className="crk-list">
          {data.reasons.map((r) => (
            <li key={r.code} data-level={r.level}>
              {r.detail}
            </li>
          ))}
        </ul>
      )}

      <p className="crk-quiet">
        {/*
          บอกตรง ๆ ว่ายังไม่กั้น · ระดับที่ดูเหมือนกั้นแต่ไม่กั้น อันตรายกว่า
          ไม่มีระดับเลย เพราะทุกคนจะเชื่อว่ามีด่านอยู่แล้ว
        */}
        คำนวณใหม่ทุกครั้งที่เปิด — ระดับนี้ใช้ประกอบการพิจารณา
        {data.level === 'HIGH' ? ' ควรให้ CAB ดูก่อนอนุมัติ' : ''} ยังไม่ได้กั้นการกดปุ่มใด ๆ
      </p>
    </section>
  );
}
