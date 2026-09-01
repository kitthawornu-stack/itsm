'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, TextLink, Timestamp } from '@itsm/ui';

interface Bar {
  key: string;
  label: string;
  kind: string;
  done: boolean;
  startRatio: number;
  endRatio: number;
  milestone: boolean;
}

interface RoadmapView {
  from: string;
  to: string;
  bars: Bar[];
  unplaced: Array<{ key: string; label: string; kind: string; reason: string; reasonLabel: string }>;
  conflicts: Array<{
    blockerKey: string;
    blockerVersionLabel: string;
    blockedKey: string;
    blockedVersionLabel: string;
  }>;
  uncheckable: Array<{ blockerKey: string; blockedKey: string }>;
}

const KIND_LABEL: Record<string, string> = { version: 'รุ่น', sprint: 'รอบการทำงาน' };

/**
 * แผนงานบนเส้นเวลา
 *
 * ## สิ่งที่วางไม่ได้ อยู่ในรายการแยก ไม่ใช่หายไป
 *
 * แผนภาพที่ตัดสิ่งที่ยังไม่มีกำหนดทิ้งเงียบ ๆ อ่านเหมือน "นี่คือทุกอย่างที่มี" ·
 * รายการข้างล่างบอกทั้งชื่อและเหตุผล เพื่อให้คนไปเติมวันที่ให้มันได้
 *
 * ## แท่งไม่ได้บอกความยาวด้วยสีอย่างเดียว
 *
 * ทุกแท่งมีชื่ออยู่ข้างซ้ายในตารางเดียวกัน · คนที่แยกสีไม่ออกหรืออ่านด้วย
 * screen reader ยังได้ข้อมูลครบจากข้อความ — แผนภาพเป็นตัวช่วยกวาดสายตา
 * ไม่ใช่ที่เดียวที่ข้อมูลอยู่
 *
 * ## "ตรวจไม่ได้" ไม่ใช่ "ไม่มีปัญหา"
 *
 * คู่ที่ฝ่ายใดฝ่ายหนึ่งยังไม่มีวันปล่อย ตอบไม่ได้ว่าขัดกันไหม · การไม่แสดง
 * ทำให้คนอ่านเชื่อว่าตรวจครบแล้ว ซึ่งเป็นความมั่นใจที่ระบบสร้างขึ้นเอง
 */
export function RoadmapBoard({
  apiBase,
  projectKey,
}: {
  apiBase: string;
  projectKey: string;
}): ReactNode {
  const [data, setData] = useState<RoadmapView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/projects/${projectKey}/roadmap`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setData((await res.json()) as RoadmapView);
    } catch {
      setFailed(true);
    }
  }, [apiBase, projectKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <Alert tone="error" inline>
        อ่านแผนงานของโปรเจกต์นี้ไม่ได้ — อาจไม่มีสิทธิ์เปิดดู
      </Alert>
    );
  }
  if (data === null) return <p className="page-sub">กำลังโหลด…</p>;

  const pct = (n: number): string => `${String(Math.round(n * 10000) / 100)}%`;

  return (
    <div className="rmp">
      <p className="rmp-window">
        ช่วงที่กำลังดู <Timestamp utc={data.from} precision="date" /> ถึง{' '}
        <Timestamp utc={data.to} precision="date" />
      </p>

      {data.bars.length === 0 ? (
        <p className="page-sub">ยังไม่มีรุ่นหรือรอบการทำงานที่มีวันที่อยู่ในช่วงนี้</p>
      ) : (
        <ul className="rmp-rows">
          {data.bars.map((b) => (
            <li key={b.key} data-kind={b.kind} data-done={b.done ? 'true' : undefined}>
              <span className="rmp-label">
                <b>{b.label}</b>
                <span className="rmp-kind">{KIND_LABEL[b.kind] ?? b.kind}</span>
              </span>
              <span className="rmp-track">
                {b.milestone ? (
                  <span
                    className="rmp-pin"
                    style={{ left: pct(b.startRatio) }}
                    /* หมุดคือจุดเดียว — ป้ายบอกว่ามันคือหมุด ไม่ใช่แท่งที่สั้นมาก */
                    title="หมุด — มีวันเดียว ไม่ใช่ช่วงเวลา"
                  />
                ) : (
                  <span
                    className="rmp-bar"
                    style={{
                      left: pct(b.startRatio),
                      width: pct(Math.max(b.endRatio - b.startRatio, 0.004)),
                    }}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {data.conflicts.length === 0 ? null : (
        <div className="rmp-block">
          <h2 className="rmp-title">ลำดับที่เป็นไปไม่ได้</h2>
          <Alert tone="warning" inline>
            งานในรุ่นที่ปล่อยทีหลัง กำลังขวางงานในรุ่นที่ปล่อยก่อน — รุ่นที่ปล่อยก่อนจะปล่อยไม่ได้จริง
          </Alert>
          <ul className="rmp-list">
            {data.conflicts.map((c) => (
              <li key={`${c.blockerKey}-${c.blockedKey}`}>
                <TextLink href={`/browse/${c.blockerKey}`} ariaLabel={`เปิด ${c.blockerKey}`}>
                  {c.blockerKey}
                </TextLink>{' '}
                <span className="rmp-quiet">(รุ่น {c.blockerVersionLabel})</span> ขวาง{' '}
                <TextLink href={`/browse/${c.blockedKey}`} ariaLabel={`เปิด ${c.blockedKey}`}>
                  {c.blockedKey}
                </TextLink>{' '}
                <span className="rmp-quiet">(รุ่น {c.blockedVersionLabel} ซึ่งปล่อยก่อน)</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.uncheckable.length === 0 ? null : (
        <div className="rmp-block">
          <h2 className="rmp-title">ตรวจลำดับไม่ได้</h2>
          {/*
            "ตรวจไม่ได้" ไม่ใช่ "ไม่มีปัญหา" — การไม่แสดงทำให้คนเชื่อว่าตรวจครบแล้ว
          */}
          <p className="rmp-quiet">
            คู่เหล่านี้มีการขวางกันอยู่ แต่ยังบอกไม่ได้ว่าลำดับขัดกันไหม
            เพราะฝ่ายใดฝ่ายหนึ่งยังไม่ได้อยู่ในรุ่นที่มีวันปล่อย
          </p>
          <ul className="rmp-list">
            {data.uncheckable.map((u) => (
              <li key={`${u.blockerKey}-${u.blockedKey}`}>
                <TextLink href={`/browse/${u.blockerKey}`} ariaLabel={`เปิด ${u.blockerKey}`}>
                  {u.blockerKey}
                </TextLink>{' '}
                ขวาง{' '}
                <TextLink href={`/browse/${u.blockedKey}`} ariaLabel={`เปิด ${u.blockedKey}`}>
                  {u.blockedKey}
                </TextLink>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.unplaced.length === 0 ? null : (
        <div className="rmp-block">
          <h2 className="rmp-title">ยังวางบนเส้นเวลาไม่ได้</h2>
          {/*
            แผนภาพที่ตัดสิ่งที่ยังไม่มีกำหนดทิ้งเงียบ ๆ อ่านเหมือน
            "นี่คือทุกอย่างที่มี" — บอกชื่อและเหตุผลเพื่อให้ไปเติมวันที่ได้
          */}
          <ul className="rmp-list">
            {data.unplaced.map((u) => (
              <li key={u.key}>
                <b>{u.label}</b> <span className="rmp-kind">{KIND_LABEL[u.kind] ?? u.kind}</span>
                <span className="rmp-quiet"> — {u.reasonLabel}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
