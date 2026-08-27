/**
 * คอมโพเนนต์ที่แสดงผลอย่างเดียว — ไม่มี event handler
 *
 * จงใจไม่ใส่ 'use client' เพื่อให้ยังเป็น Server Component ได้
 * หน้าคิว 50 แถวจึงไม่ต้องส่ง JavaScript ของคอมโพเนนต์เหล่านี้ไปเบราว์เซอร์
 *
 * ตัวที่รับการโต้ตอบอยู่ใน ./interactive.tsx ซึ่งมี 'use client'
 * ถ้าใส่ 'use client' ทั้งไฟล์ ทุกตัวจะกลายเป็น client component
 * และเสียประโยชน์ของ React Server Components ไปทั้งระบบ
 *
 * **สถานะ: 12 จาก 48 ตัวในแผน** (master-plan 7.5)
 * ชุดนี้คือตัวที่ต้นแบบหน้าจอทั้ง 6 หน้าใช้จริง ที่เหลือคือการประกอบชุดนี้ซ้ำ
 *
 * กติกา (CLAUDE.md §6):
 *   - อ้าง semantic token เท่านั้น ห้ามค่าสีดิบ — Stylelint บังคับ
 *   - ทุก action ที่ทำวันละเกิน 20 ครั้งต้องมีคีย์ลัด
 *   - Board ต้องย้ายการ์ดด้วยคีย์บอร์ดได้ (WCAG)
 */
import type { CSSProperties, ReactNode } from 'react';

import './primitives.css';

export type StatusCategory = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type PriorityRank = 1 | 2 | 3 | 4 | 5;
export type SlaState = 'ok' | 'warning' | 'critical' | 'paused';

// ============================================================

export interface StatusPillProps {
  /** ชื่อสถานะที่ผู้ใช้เห็น — ภาษาคน ไม่ใช่ศัพท์ระบบ */
  label: string;
  category: StatusCategory;
  /** สถานะที่หยุดนาฬิกา SLA เช่น "รอลูกค้าตอบ" */
  pausesSla?: boolean;
}

export function StatusPill({ label, category, pausesSla = false }: StatusPillProps): ReactNode {
  return (
    <span className="ui-status" data-category={category} data-paused={pausesSla ? 'true' : 'false'}>
      {label}
    </span>
  );
}

// ============================================================

export interface PriorityIndicatorProps {
  rank: PriorityRank;
  label: string;
  /** ซ่อนข้อความเมื่อพื้นที่จำกัด — แต่ยังคงอ่านได้ด้วย screen reader */
  labelHidden?: boolean;
}

export function PriorityIndicator({
  rank,
  label,
  labelHidden = false,
}: PriorityIndicatorProps): ReactNode {
  return (
    <span className="ui-priority" data-rank={rank} title={label}>
      <i className="ui-priority-bar" aria-hidden="true" />
      {labelHidden ? <span className="ui-sr-only">{label}</span> : label}
    </span>
  );
}

// ============================================================

export interface SlaBarProps {
  /** สัดส่วนเวลาที่ใช้ไป 0–1 */
  elapsedRatio: number;
  state: SlaState;
  /** ข้อความเช่น "เหลือ 11 นาที" หรือ "⏸ หยุดนาฬิกา" */
  label: string;
  /**
   * ตัวเลขนี้มาจากปฏิทินวันหยุดที่มีคนยืนยันแล้วหรือยัง — ไม่ระบุถือว่ายืนยันแล้ว
   *
   * ตัวเลขที่นับจากปฏิทินซึ่งขาดวันหยุดไป หน้าตาเหมือนตัวเลขที่ถูกต้องทุกอย่าง
   * ถ้าไม่ทำให้ต่างกันด้วยตา คนจะตัดสินใจจากมันโดยไม่รู้ว่ากำลังตัดสินใจจากอะไร
   */
  trusted?: boolean;
}

const UNTRUSTED_NOTE = 'ตัวเลขนี้คำนวณจากปฏิทินวันหยุดที่ยังไม่มีใครยืนยัน จึงอาจมากกว่าความเป็นจริง';

export function SlaBar({ elapsedRatio, state, label, trusted = true }: SlaBarProps): ReactNode {
  const pct = Math.max(0, Math.min(1, elapsedRatio)) * 100;
  return (
    <span
      className="ui-sla"
      data-state={state}
      data-trusted={trusted ? undefined : 'false'}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      /* ผู้ใช้ screen reader ไม่เห็นเส้นประ ต้องได้ยินเป็นคำ */
      aria-label={trusted ? label : `${label} — ${UNTRUSTED_NOTE}`}
      title={trusted ? undefined : UNTRUSTED_NOTE}
    >
      <span className="ui-sla-track">
        <i className="ui-sla-fill" style={{ width: `${pct}%` } satisfies CSSProperties} />
      </span>
      <span className="ui-sla-label">
        {/*
          เครื่องหมายบอกความไม่แน่นอน มาก่อนข้อความเสมอ และไม่พึ่งสีอย่างเดียว
          — สีเป็นช่องทางเดียวคือช่องทางที่ผู้ใช้ตาบอดสีไม่ได้รับ
        */}
        {trusted ? null : <span aria-hidden="true">≈ </span>}
        {label}
      </span>
    </span>
  );
}

// ============================================================

export interface AvatarProps {
  name: string;
  tone?: 'service' | 'delivery' | 'neutral';
  size?: 'md' | 'lg';
}

/** ย่อชื่อไทยเป็นสองอักขระแรก — ชื่อไทยไม่มีนามสกุลแยกด้วยช่องว่างเสมอไป */
function initials(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  return trimmed.slice(0, 2);
}

export function Avatar({ name, tone = 'delivery', size = 'md' }: AvatarProps): ReactNode {
  return (
    <span className="ui-avatar" data-tone={tone} data-size={size} title={name} aria-label={name}>
      {initials(name)}
    </span>
  );
}

// ============================================================

export interface SkeletonProps {
  width?: string;
  height?: string;
}

export function Skeleton({ width = '100%', height = '14px' }: SkeletonProps): ReactNode {
  return <span className="ui-skeleton" style={{ width, height }} aria-hidden="true" />;
}

// ============================================================

export interface WorkItemCardProps {
  itemKey: string;
  summary: string;
  rank: PriorityRank;
  done?: boolean;
  storyPoints?: number;
  assignee?: string;
  blocked?: boolean;
}

export function WorkItemCard({
  itemKey,
  summary,
  rank,
  done = false,
  storyPoints,
  assignee,
  blocked = false,
}: WorkItemCardProps): ReactNode {
  return (
    <article className="ui-card" data-rank={rank} data-done={done ? 'true' : 'false'}>
      <p className="ui-card-title">{summary}</p>
      <div className="ui-card-footer">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="ui-row-key">{itemKey}</span>
          {blocked ? <StatusPill label="ติดขัด" category="TODO" pausesSla /> : null}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {storyPoints === undefined ? null : (
            <span className="ui-avatar" data-tone="neutral" aria-label={`${storyPoints} point`}>
              {storyPoints}
            </span>
          )}
          {assignee === undefined ? null : <Avatar name={assignee} />}
        </span>
      </div>
    </article>
  );
}

