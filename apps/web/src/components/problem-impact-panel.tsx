'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, LinkButton, TextLink, Timestamp } from '@itsm/ui';

interface Incident {
  itemKey: string;
  summary: string;
  statusCategory: string;
  projectKey: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface Impact {
  total: number;
  open: number;
  resolved: number;
  projects: Array<{ key: string; count: number }>;
  firstSeen: string | null;
  lastSeen: string | null;
  stillRecurring: boolean;
  spanMs: number;
}

/**
 * จำนวนใบที่แสดงก่อนพับ
 *
 * ปัญหาใบเดียวเป็นสาเหตุของเรื่องได้เป็นร้อยใบ · รายการยาวเป็นร้อยบรรทัด
 * ดันทุกอย่างที่อยู่ใต้มันตกจอ · **แต่ต้องบอกว่าซ่อนไว้กี่ใบ** — การตัดเงียบ ๆ
 * อ่านเหมือน "มีเท่านี้" ซึ่งเป็นคนละเรื่องกับ "แสดงเท่านี้"
 */
const PREVIEW = 8;

function readableSpan(ms: number): string {
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return 'วันเดียว';
  if (days < 60) return `${String(days)} วัน`;
  return `${String(Math.round(days / 30))} เดือน`;
}

/**
 * ผลกระทบของปัญหา
 *
 * ## แผงนี้ไม่ขึ้นเลยเมื่อไม่มีเรื่องที่เกิดจากใบนี้
 *
 * ต่างจากแผงอนุมัติหรือหน้าต่างเวลา ซึ่งเป็นสิ่งที่คน **ทำ** กับเรื่องใดก็ได้ ·
 * ผลกระทบเป็นสิ่งที่ **มี** เฉพาะใบที่ถูกทำเครื่องหมายว่าเป็นสาเหตุ ·
 * หัวข้อว่างเปล่าบนทุกเรื่องคือเสียงรบกวนที่ทำให้หน้ารายละเอียดอ่านยากขึ้น
 *
 * ## "ยังเกิดซ้ำ" เตือน · "หยุดแล้ว" ไม่เตือน
 *
 * ปัญหาที่ไม่มีเรื่องใหม่มาเป็นเดือนไม่ใช่ปัญหาที่ยังกวนอยู่ · การใช้สีเตือน
 * กับทั้งสองสถานะทำให้คนเลิกแยกแยะ แล้วเมินทั้งคู่
 */
export function ProblemImpactPanel({
  apiBase,
  itemKey,
}: {
  apiBase: string;
  itemKey: string;
}): ReactNode {
  const [data, setData] = useState<{ impact: Impact; incidents: Incident[] } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/problem-impact`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) return;
      setData((await res.json()) as { impact: Impact; incidents: Incident[] });
    } catch {
      // เงียบโดยตั้งใจ — แผงนี้เป็นข้อมูลเสริม ไม่ควรขึ้น error บนหน้าที่อ่านเรื่อง
    }
  }, [apiBase, itemKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (data === null || data.impact.total === 0) return null;

  const { impact, incidents } = data;
  const shown = expanded ? incidents : incidents.slice(0, PREVIEW);
  const hidden = incidents.length - shown.length;

  return (
    <section className="pim" aria-label="ผลกระทบของปัญหานี้">
      <h2 className="detail-section-title">ผลกระทบ</h2>

      {/*
        ตัวเลขอยู่บนสุดเพราะเป็นคำตอบ · รายการอยู่ล่างเพราะเป็นหลักฐาน ·
        คนที่เปิดมาดูต้องได้คำตอบก่อนโดยไม่ต้องนับเอง
      */}
      <dl className="pim-stats">
        <div>
          <dt>ทำให้เกิดเรื่อง</dt>
          <dd>{impact.total} เรื่อง</dd>
        </div>
        <div>
          <dt>ยังค้างอยู่</dt>
          <dd data-open={impact.open > 0 ? 'true' : undefined}>{impact.open} เรื่อง</dd>
        </div>
        <div>
          <dt>แก้ไปแล้ว</dt>
          <dd>{impact.resolved} เรื่อง</dd>
        </div>
        {impact.spanMs === 0 ? null : (
          <div>
            <dt>กวนมาแล้ว</dt>
            <dd>{readableSpan(impact.spanMs)}</dd>
          </div>
        )}
      </dl>

      <p className="pim-when">
        {impact.firstSeen === null ? null : (
          <>
            เรื่องแรก <Timestamp utc={impact.firstSeen} />
          </>
        )}
        {impact.lastSeen === null ? null : (
          <>
            {' · '}ล่าสุด <Timestamp utc={impact.lastSeen} />
          </>
        )}
        {impact.projects.length <= 1 ? null : (
          <>
            {' · '}กระทบ {impact.projects.map((p) => `${p.key} (${String(p.count)})`).join(' · ')}
          </>
        )}
      </p>

      {impact.stillRecurring ? (
        <Alert tone="warning" inline>
          ยังเกิดซ้ำอยู่ — มีเรื่องใหม่เข้ามาภายในสามสิบวันที่ผ่านมา
        </Alert>
      ) : (
        /*
          ไม่ใช้ `Alert` กับสถานะนี้ — มันคือข้อมูล ไม่ใช่คำเตือน ·
          กล่องสีบนทุกสถานะทำให้กล่องสีไม่มีความหมาย
        */
        <p className="pim-quiet">ไม่มีเรื่องใหม่มาสามสิบวันแล้ว — อาจแก้ที่ต้นเหตุไปแล้ว</p>
      )}

      <ul className="pim-list">
        {shown.map((i) => (
          <li key={i.itemKey} data-done={i.statusCategory === 'DONE' ? 'true' : undefined}>
            <TextLink href={`/browse/${i.itemKey}`} ariaLabel={`เปิด ${i.itemKey} ${i.summary}`}>
              {i.itemKey}
            </TextLink>
            <span className="pim-summary">{i.summary}</span>
            <span className="pim-meta">
              <Timestamp utc={i.createdAt} />
              {i.statusCategory === 'DONE' ? ' · แก้แล้ว' : ' · ยังค้าง'}
            </span>
          </li>
        ))}
      </ul>

      {hidden === 0 ? null : (
        /*
          บอกจำนวนที่ซ่อน ไม่ใช่ตัดเงียบ ๆ — "มีเท่านี้" กับ "แสดงเท่านี้"
          เป็นคนละคำตอบ และคนอ่านแยกไม่ออกถ้าไม่บอก
        */
        <LinkButton
          onClick={() => {
            setExpanded(true);
          }}
        >
          ดูอีก {hidden} เรื่อง
        </LinkButton>
      )}
    </section>
  );
}
