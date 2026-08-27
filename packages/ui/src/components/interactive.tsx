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
      // ไม่แปลง children เป็นสตริง — children เป็น ReactNode ซึ่งอาจเป็น object
      // และจะกลายเป็น [object Object] ใน tooltip
      title={shortcut === undefined ? undefined : `คีย์ลัด ${shortcut}`}
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
  /**
   * เพดานความยาว — กันไว้ที่หน้าจอ ไม่ใช่ให้เซิร์ฟเวอร์ตัดทีหลัง
   * ข้อความที่ถูกตัดเงียบ ๆ ผู้ใช้จะรู้ตอนเปิดกลับมาอ่านแล้วเท่านั้น
   */
  maxLength?: number;
  id?: string;
}

export function Input({
  value,
  onChange,
  placeholder,
  invalid = false,
  errorMessage,
  maxLength,
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
        maxLength={maxLength}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      {maxLength === undefined || value.length <= maxLength * 0.9 ? null : (
        <span className="ui-textarea-count" data-near="true">
          {value.length} / {maxLength}
        </span>
      )}
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

// ============================================================

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /**
   * ตัวเลือกแรกที่ยังไม่ได้เลือก — ใส่เมื่อ "ยังไม่เลือก" เป็นสถานะที่ถูกต้อง
   * ถ้าไม่ใส่ ค่าแรกจะถูกเลือกให้เลย ซึ่งทำให้ผู้ใช้ส่งค่าที่ไม่ได้ตั้งใจ
   */
  placeholder?: string;
  invalid?: boolean;
  errorMessage?: string;
  disabled?: boolean;
  id?: string;
}

/**
 * ใช้ `<select>` ของเบราว์เซอร์โดยตั้งใจ ไม่ทำ dropdown เอง
 *
 * ของเบราว์เซอร์ได้คีย์บอร์ด การพิมพ์เพื่อกระโดด และตัวเลือกแบบเนทีฟบนมือถือ
 * มาฟรีทั้งหมด ซึ่ง dropdown ที่เขียนเองต้องทำใหม่ทุกอย่างและมักทำได้ไม่ครบ
 * เมื่อต้องการค้นหาในตัวเลือกหรือเลือกหลายค่า ค่อยเพิ่มคอมโพเนนต์แยกต่างหาก
 */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  invalid = false,
  errorMessage,
  disabled = false,
  id,
}: SelectProps): ReactNode {
  const errorId = id === undefined ? undefined : `${id}-error`;
  return (
    <>
      <select
        className="ui-select"
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        {placeholder === undefined ? null : (
          <option value="">{placeholder}</option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {invalid && errorMessage !== undefined ? (
        <span id={errorId} role="alert" className="ui-sla-label" data-state="critical">
          {errorMessage}
        </span>
      ) : null}
    </>
  );
}

// ============================================================

export interface TextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  invalid?: boolean;
  errorMessage?: string;
  /** แสดงตัวนับเมื่อมีเพดาน — ผู้ใช้ต้องรู้ก่อนถูกตัด ไม่ใช่หลังจากส่งไปแล้ว */
  maxLength?: number;
  id?: string;
}

export function Textarea({
  value,
  onChange,
  placeholder,
  rows = 4,
  invalid = false,
  errorMessage,
  maxLength,
  id,
}: TextareaProps): ReactNode {
  const errorId = id === undefined ? undefined : `${id}-error`;
  // เตือนเมื่อเหลือน้อยกว่า 10% ของเพดาน ไม่ใช่ตอนเต็มแล้ว
  const near = maxLength !== undefined && value.length > maxLength * 0.9;
  return (
    <>
      <textarea
        className="ui-textarea"
        id={id}
        value={value}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      {maxLength === undefined ? null : (
        <span className="ui-textarea-count" data-near={near ? 'true' : 'false'}>
          {value.length} / {maxLength}
        </span>
      )}
      {invalid && errorMessage !== undefined ? (
        <span id={errorId} role="alert" className="ui-sla-label" data-state="critical">
          {errorMessage}
        </span>
      ) : null}
    </>
  );
}

// ============================================================

export interface FieldProps {
  label: string;
  htmlFor: string;
  /** ป้ายบอกว่าต้องกรอก — ไม่ใช่ดอกจันลอย ๆ ที่ screen reader อ่านว่า "ดาว" */
  required?: boolean;
  /** คำอธิบายใต้ป้าย สำหรับสิ่งที่ป้ายอย่างเดียวบอกไม่หมด */
  hint?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, required = false, hint, children }: FieldProps): ReactNode {
  return (
    <div className="ui-field">
      <label className="ui-field-label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="ui-field-required"> จำเป็น</span> : null}
      </label>
      {hint === undefined ? null : <span className="ui-field-hint">{hint}</span>}
      {children}
    </div>
  );
}

// ============================================================

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** ข้อความข้างช่อง — ไม่ใส่ต้องส่ง `label` แทนเพื่อให้สกรีนรีดเดอร์อ่านออก */
  children?: ReactNode;
  /** ชื่อสำหรับสกรีนรีดเดอร์เมื่อไม่มีข้อความข้างช่อง (เช่น ช่องติ๊กในตาราง) */
  label?: string;
  disabled?: boolean;
  /**
   * เลือกไว้บางส่วน — ไม่ใช่ทั้งหมดและไม่ใช่ไม่เลือกเลย
   *
   * ช่องที่ติ๊กเต็มทั้งที่เลือกไว้ 3 จาก 50 คือคำโกหก และ HTML ตั้งค่านี้
   * ผ่าน attribute ไม่ได้ ต้องเซ็ตผ่าน DOM property เท่านั้น จึงพลาดกันบ่อย
   */
  indeterminate?: boolean;
}

export function Checkbox({
  checked,
  onChange,
  children,
  label,
  disabled = false,
  indeterminate = false,
}: CheckboxProps): ReactNode {
  const input = (
    <input
      type="checkbox"
      className="ui-checkbox-input"
      checked={checked}
      disabled={disabled}
      aria-label={children === undefined ? label : undefined}
      ref={(el) => {
        if (el !== null) el.indeterminate = indeterminate;
      }}
      onChange={(e) => {
        onChange(e.target.checked);
      }}
    />
  );
  // ไม่มีข้อความข้างช่อง = ไม่ห่อ <label> เพราะ label เปล่าทำให้พื้นที่กดขยาย
  // ไปคลุมเซลล์ข้าง ๆ ในตาราง แล้วคนกดลิงก์แล้วได้ติ๊กแทน
  if (children === undefined) return input;
  return (
    <label className="ui-checkbox" data-disabled={disabled ? 'true' : 'false'}>
      {input}
      <span>{children}</span>
    </label>
  );
}

// ============================================================

export interface LinkButtonProps {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** งานที่ทำลายของ — แสดงเป็นสีวิกฤต */
  tone?: 'default' | 'danger';
}

/**
 * ปุ่มที่หน้าตาเป็นลิงก์
 *
 * **เป็น `<button>` เสมอ ไม่ใช่ `<a>`** — ของที่กดแล้วเปลี่ยนข้อมูลต้องเป็นปุ่ม
 * ไม่งั้นเบราว์เซอร์กับสกรีนรีดเดอร์จะสัญญากับผู้ใช้ว่ามันคือการไปที่อื่น
 * (เปิดแท็บใหม่ได้ · คัดลอกลิงก์ได้) ซึ่งไม่จริงสักข้อ
 *
 * ใช้กับงานรอง เช่น "ล้าง" หรือ "ยกเลิกการเลือก" — งานหลักใช้ `Button`
 */
export function LinkButton({
  children,
  onClick,
  disabled = false,
  tone = 'default',
}: LinkButtonProps): ReactNode {
  return (
    <button
      type="button"
      className="ui-linkbtn"
      data-tone={tone}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
