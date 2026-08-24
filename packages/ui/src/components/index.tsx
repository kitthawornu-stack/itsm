/**
 * คอมโพเนนต์แกน 12 ตัว — ฐานที่คอมโพเนนต์อื่นประกอบขึ้นมา
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

export interface ButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'delivery';
  size?: 'sm' | 'md';
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: () => void;
  /** แสดงในคำแนะนำเครื่องมือและใช้ผูกคีย์ลัด */
  shortcut?: string;
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  disabled = false,
  type = 'button',
  onClick,
  shortcut,
}: ButtonProps): ReactNode {
  return (
    <button
      className="ui-btn"
      type={type}
      data-variant={variant}
      data-size={size}
      disabled={disabled}
      onClick={onClick}
      title={shortcut === undefined ? undefined : `${String(children)} (${shortcut})`}
    >
      {children}
    </button>
  );
}

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
}

export function SlaBar({ elapsedRatio, state, label }: SlaBarProps): ReactNode {
  const pct = Math.max(0, Math.min(1, elapsedRatio)) * 100;
  return (
    <span
      className="ui-sla"
      data-state={state}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span className="ui-sla-track">
        <i className="ui-sla-fill" style={{ width: `${pct}%` } satisfies CSSProperties} />
      </span>
      <span className="ui-sla-label">{label}</span>
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

export interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  /** ข้อความบอกว่าเกิดอะไรและต้องทำอะไรต่อ — ไม่ขอโทษ ไม่คลุมเครือ */
  errorMessage?: string;
  id?: string;
}

export function Input({
  value,
  onChange,
  placeholder,
  invalid = false,
  errorMessage,
  id,
}: InputProps): ReactNode {
  const errorId = id === undefined ? undefined : `${id}-error`;
  return (
    <>
      <input
        className="ui-input"
        id={id}
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      {invalid && errorMessage !== undefined ? (
        <span id={errorId} role="alert" className="ui-sla-label" data-state="critical">
          {errorMessage}
        </span>
      ) : null}
    </>
  );
}

// ============================================================

export interface LabelChipProps {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}

export function LabelChip({ children, selected = false, onClick }: LabelChipProps): ReactNode {
  if (onClick === undefined) {
    return (
      <span className="ui-chip" data-selected={selected ? 'true' : 'false'}>
        {children}
      </span>
    );
  }
  return (
    <button
      className="ui-chip"
      type="button"
      data-selected={selected ? 'true' : 'false'}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ============================================================

export interface EmptyStateProps {
  title: string;
  body: string;
  /** ทุกสถานะว่างต้องมีทางออกที่กดได้ ไม่ใช่ข้อความอย่างเดียว */
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ title, body, action }: EmptyStateProps): ReactNode {
  return (
    <div className="ui-empty">
      <p className="ui-empty-title">{title}</p>
      <p className="ui-empty-body">{body}</p>
      {action === undefined ? null : (
        <Button variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
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

export interface WorkItemRowProps {
  itemKey: string;
  summary: string;
  priority: { rank: PriorityRank; label: string };
  status: { label: string; category: StatusCategory; pausesSla?: boolean };
  assignee?: string;
  sla?: SlaBarProps;
  selected?: boolean;
  onOpen?: () => void;
}

export function WorkItemRow({
  itemKey,
  summary,
  priority,
  status,
  assignee,
  sla,
  selected = false,
  onOpen,
}: WorkItemRowProps): ReactNode {
  return (
    <div
      className="ui-row"
      role="row"
      tabIndex={0}
      data-selected={selected ? 'true' : 'false'}
      style={{ gridTemplateColumns: '84px 1fr 64px 130px 28px 96px' }}
      onClick={onOpen}
      onKeyDown={(e) => {
        // เปิดรายละเอียดด้วยคีย์บอร์ด — Agent อยู่กับคิว 90% ของเวลา
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen?.();
        }
      }}
    >
      <span className="ui-row-key">{itemKey}</span>
      <span className="ui-row-summary">{summary}</span>
      <PriorityIndicator rank={priority.rank} label={priority.label} />
      <StatusPill
        label={status.label}
        category={status.category}
        pausesSla={status.pausesSla ?? false}
      />
      {assignee === undefined ? <span /> : <Avatar name={assignee} tone="service" />}
      {sla === undefined ? <span /> : <SlaBar {...sla} />}
    </div>
  );
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
