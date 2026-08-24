'use client';

/**
 * คอมโพเนนต์ที่รับการโต้ตอบ — ต้องเป็น Client Component
 *
 * Next.js ห้ามส่ง event handler ข้ามขอบเขต server -> client
 * ถ้ารวมไว้ไฟล์เดียวกับตัวที่แสดงผลอย่างเดียว ตัวเหล่านั้นจะถูกลากมาเป็น client ไปด้วย
 */
import type { ReactNode } from 'react';

import './primitives.css';
import {
  Avatar,
  PriorityIndicator,
  SlaBar,
  StatusPill,
  type PriorityRank,
  type SlaBarProps,
  type StatusCategory,
} from './presentational';

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
      style={{ gridTemplateColumns: '84px 1fr 92px 132px 28px 100px' }}
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

