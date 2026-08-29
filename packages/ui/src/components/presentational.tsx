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

// ============================================================

export type AlertTone = 'error' | 'warning' | 'success' | 'info';

export interface AlertProps {
  tone: AlertTone;
  children: ReactNode;
  /** หัวข้อสั้น ๆ — ไม่ใส่ก็ได้เมื่อข้อความเดียวพอ */
  title?: string;
  /**
   * แบบบรรทัดเดียวไม่มีกรอบ — ใช้ติดกับช่องกรอกที่มันอธิบาย
   * กล่องมีกรอบข้างช่องกรอกเล็ก ๆ ดูหนักกว่าข้อความที่มันบอกเสียอีก
   */
  inline?: boolean;
}

/**
 * ข้อความบอกผลหรือปัญหา
 *
 * รวมสามแบบที่ `apps/web` เคยเขียนเองแยกกัน (`.admin-error` · `.error-box` ·
 * `.hql-error`) ซึ่งเป็นเรื่องเดียวกันแต่หน้าตาคนละอย่าง ผู้ใช้จึงต้องเรียนรู้
 * ใหม่ทุกหน้าว่าอะไรคือคำเตือน
 *
 * `role` ผูกกับ tone ไม่ใช่ให้ผู้เรียกเลือก — ข้อความผิดพลาดต้องเป็น `alert`
 * (สกรีนรีดเดอร์ขัดจังหวะทันที) ส่วนข้อความบอกผลสำเร็จเป็น `status`
 * (อ่านเมื่อว่าง) · ปล่อยให้เลือกเองแปลว่าจะมีที่ที่เลือกผิด
 */
export function Alert({ tone, children, title, inline = false }: AlertProps): ReactNode {
  return (
    <div
      className="ui-alert"
      data-tone={tone}
      data-inline={inline ? 'true' : 'false'}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {title === undefined ? null : <b className="ui-alert-title">{title}</b>}
      <span className="ui-alert-body">{children}</span>
    </div>
  );
}

// ============================================================

export interface PageHeaderProps {
  title: string;
  /** ประโยคเดียวใต้หัวเรื่อง บอกว่าหน้านี้กำลังแสดงอะไรอยู่ */
  lead?: ReactNode;
  /** ปุ่มมุมขวา เช่น "แจ้งปัญหา" */
  actions?: ReactNode;
}

/**
 * หัวหน้าจอ
 *
 * `title` เป็น `string` ไม่ใช่ `ReactNode` โดยตั้งใจ — หัวเรื่องที่ยัด markup ได้
 * จะกลายเป็นที่ทิ้งของทุกอย่างที่หาที่วางไม่ได้ และ `<h1>` จะมีหลายอันในหน้าเดียว
 */
export function PageHeader({ title, lead, actions }: PageHeaderProps): ReactNode {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header-text">
        <h1 className="ui-page-title">{title}</h1>
        {lead === undefined ? null : <p className="ui-page-lead">{lead}</p>}
      </div>
      {actions === undefined ? null : <div className="ui-page-actions">{actions}</div>}
    </header>
  );
}

// ============================================================

export interface TimestampProps {
  /** เวลาแบบ ISO 8601 UTC ตามที่ API ส่งมา */
  utc: string;
  /** `date` = วันเดือนปี · `time` = วันเดือน + เวลา (ค่าปริยาย) */
  precision?: 'date' | 'time';
}

/**
 * แสดงเวลาตามเขตเวลาไทย
 *
 * **INVARIANT 6: แปลง timezone ที่ชั้นแสดงผลเท่านั้น** — คอมโพเนนต์นี้คือชั้นนั้น
 * ที่อื่นทั้งระบบเก็บและส่งเป็น UTC · การมีที่เดียวที่แปลง แปลว่าเวลาที่ผิด
 * มีที่ให้ไปแก้ที่เดียว ไม่ใช่กระจายอยู่ในทุกหน้าจอที่บังเอิญเรียก `toLocaleString`
 *
 * ระบุ `timeZone` ตายตัวเสมอ ไม่ใช้เขตเวลาของเครื่อง — ไม่งั้นเซิร์ฟเวอร์
 * (UTC) กับเบราว์เซอร์ (Asia/Bangkok) จะเรนเดอร์คนละค่า แล้ว React จะเตือน
 * hydration mismatch ในบางหน้าและไม่เตือนในบางหน้า แล้วแต่ว่าเวลานั้นข้ามวันไหม
 *
 * ค่าที่แปลงไม่ได้คืน `—` ไม่ใช่ `Invalid Date` — หน้าจอที่ขึ้นว่า Invalid Date
 * ทำให้คนเชื่อว่าข้อมูลเสีย ทั้งที่ส่วนใหญ่คือ API ยังไม่ส่งค่านั้นมา
 */
export function Timestamp({ utc, precision = 'time' }: TimestampProps): ReactNode {
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) {
    return (
      <time className="ui-when" dateTime="">
        —
      </time>
    );
  }
  const text = d.toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(precision === 'time' ? { hour: '2-digit' as const, minute: '2-digit' as const } : {}),
    timeZone: 'Asia/Bangkok',
  });
  return (
    <time className="ui-when" dateTime={utc} title={`${utc} (UTC)`}>
      {text}
    </time>
  );
}

// ============================================================

export interface TableColumn {
  label: ReactNode;
  /** ชิดขวาสำหรับตัวเลข — ตัวเลขที่ชิดซ้ายเทียบขนาดกันด้วยตาไม่ได้ */
  align?: 'start' | 'end';
  /** ความกว้างตายตัว เช่น '84px' — ไม่ใส่คือแบ่งตามเนื้อหา */
  width?: string;
  /**
   * หัวคอลัมน์ที่มีไว้ให้สกรีนรีดเดอร์เท่านั้น (เช่นคอลัมน์ปุ่ม)
   *
   * ต้องมีตัวเลือกนี้ **เพราะถ้าไม่มี คนจะหาทางเอง** — หน้าจอแอดมินห้าที่
   * เคยส่งสตริง `'<span className="ui-sr-only">การกระทำ</span>'` เข้ามา
   * React จึง escape แล้วพิมพ์แท็กออกมาเป็นข้อความบนหัวตารางจริง ๆ
   * typecheck ผ่าน (เป็น string ถูกต้อง) lint ผ่าน เทสต์เขียว —
   * เห็นได้ทางเดียวคือเปิดหน้าจอดู
   */
  srOnly?: boolean;
}

export interface TableProps {
  columns: ReadonlyArray<TableColumn | string>;
  /**
   * จำนวนแถวที่ผู้เรียกกำลังเรนเดอร์
   *
   * ต้องบอกมาตรง ๆ ไม่ใช่ให้เดาจาก `children` — `React.Children.count`
   * นับ fragment และ array ซ้อนผิด แล้วตารางที่มีข้อมูลจะขึ้นว่า "ไม่มีข้อมูล"
   * เป็นครั้งคราวโดยไม่มีใครทำซ้ำได้
   */
  rowCount: number;
  /** ข้อความเมื่อไม่มีแถว — ไม่ใส่จะไม่แสดงอะไรเลย */
  empty?: ReactNode;
  /** `<tr>` ทั้งหมด */
  children: ReactNode;
  /** ชื่อตารางสำหรับสกรีนรีดเดอร์เมื่อไม่มีหัวเรื่องข้างบนที่ผูกไว้ */
  label?: string;
}

/**
 * ตารางข้อมูล
 *
 * รับผิดชอบสามอย่างที่ตารางเขียนมือพลาดซ้ำ ๆ ทั้ง 8 หน้าจอ:
 *
 *   1. **กล่องเลื่อนแนวนอนของตัวเอง** — ตารางกว้างต้องเลื่อนในกล่องมันเอง
 *      ไม่ใช่ดันทั้งหน้าให้เลื่อนข้าง (CLAUDE.md §6)
 *   2. **ตัดคำไทยได้ทุกตำแหน่ง** — ภาษาไทยไม่มีช่องว่างระหว่างคำ
 *      ลืม `word-break` เมื่อไร ข้อความยาวดันตารางล้นทันที
 *   3. **แถว "ไม่มีข้อมูล" ที่ `colSpan` ถูก** — เขียนมือแล้วนับคอลัมน์ผิด
 *      ข้อความจะไปกองในคอลัมน์แรกและตารางเบี้ยวทั้งใบ
 */
export function Table({ columns, rowCount, empty, children, label }: TableProps): ReactNode {
  const cols = columns.map((c) => (typeof c === 'string' ? { label: c } : c));
  return (
    <div className="ui-table-scroll">
      <table className="ui-table" aria-label={label}>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th
                // หัวคอลัมน์ไม่มี id ที่เสถียร และลำดับคือสิ่งที่นิยามมันจริง ๆ
                // การใช้ดัชนีเป็น key จึงถูกต้องที่นี่ ไม่ใช่ทางลัด
                key={i}
                data-align={c.align ?? 'start'}
                style={c.width === undefined ? undefined : { width: c.width }}
                scope="col"
              >
                {c.srOnly === true ? <span className="ui-sr-only">{c.label}</span> : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowCount === 0 && empty !== undefined ? (
            <tr>
              <td className="ui-table-empty" colSpan={cols.length}>
                {empty}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================

export interface TextLinkProps {
  children: ReactNode;
  href: string;
  /** สีตามบทบาท — เหมือน `LinkButton` เพื่อให้สองอย่างนี้อยู่ข้างกันแล้วกลมกลืน */
  tone?: 'default' | 'danger';
  /**
   * ชื่อสำหรับ screen reader เมื่อข้อความที่เห็นไม่พอแยกแยะ
   *
   * **ต้องเป็น prop ชื่อนี้ ไม่ใช่ `aria-label`** — TypeScript ปล่อยแอตทริบิวต์
   * ที่มีขีดกลางผ่านไปโดยไม่ตรวจว่าคอมโพเนนต์รับหรือเปล่า
   */
  ariaLabel?: string;
}

/**
 * ลิงก์ที่หน้าตาเป็นปุ่ม
 *
 * **เป็น `<a>` เสมอ ไม่ใช่ `<button>`** — ตรงข้ามกับ `LinkButton` โดยตั้งใจ ·
 * ของที่พาไปหน้าอื่นต้องเป็นลิงก์ ผู้ใช้จึงเปิดแท็บใหม่และคัดลอกที่อยู่ได้
 * ตามที่เบราว์เซอร์สัญญาไว้ · ของที่กดแล้วเปลี่ยนข้อมูลต้องเป็น `LinkButton`
 *
 * อยู่ในไฟล์นี้เพราะ **ไม่มี event handler** จึงเรนเดอร์ใน Server Component ได้
 * — หน้าที่ทำงานได้โดยไม่ต้องมี JavaScript ใช้ตัวนี้
 */
export function TextLink({
  children,
  href,
  tone = 'default',
  ariaLabel,
}: TextLinkProps): ReactNode {
  return (
    <a
      className="ui-linkbtn"
      data-tone={tone}
      href={href}
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
    >
      {children}
    </a>
  );
}

// ============================================================

export interface SubmitButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}

/**
 * ปุ่มส่งฟอร์มที่ไม่มี event handler
 *
 * มีไว้สำหรับฟอร์ม HTML จริง (`<form method="get">`) ที่ตั้งใจให้ทำงานได้
 * **โดยไม่ต้องมี JavaScript** · `Button` อยู่ในไฟล์ client จึงลาก JS ตามมา
 * ทั้งก้อนเพื่อสิ่งที่เบราว์เซอร์ทำได้อยู่แล้ว
 */
export function SubmitButton({ children, variant = 'primary' }: SubmitButtonProps): ReactNode {
  return (
    <button type="submit" className="ui-btn" data-size="md" data-variant={variant}>
      {children}
    </button>
  );
}

// ============================================================

export interface FormInputProps {
  /** ชื่อฟิลด์ที่จะถูกส่งไปกับฟอร์ม — ฟอร์ม HTML จริงต้องมี */
  name: string;
  type?: 'text' | 'search' | 'date' | 'datetime-local' | 'number';
  defaultValue?: string;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  required?: boolean;
}

/**
 * ช่องกรอกของฟอร์ม HTML จริง — ไม่มี state ไม่มี event handler
 *
 * `Input` เป็น controlled component ที่อยู่ในไฟล์ client · หน้าที่ตั้งใจให้
 * **ทำงานได้โดยไม่ต้องมี JavaScript** (`<form method="get">`) ใช้ไม่ได้
 * เพราะไม่มี state ให้ควบคุม และการลาก client bundle มาทั้งก้อนเพื่อสิ่งที่
 * เบราว์เซอร์ทำได้อยู่แล้วก็ไม่คุ้ม
 *
 * ตัวนี้จึงเป็น uncontrolled — ค่าเริ่มต้นมาจาก `defaultValue` แล้วเบราว์เซอร์
 * ดูแลต่อเอง · ก่อนมีตัวนี้ หน้าคลังความรู้เขียน `<input>` เปล่าที่ไม่มีสไตล์เลย
 * และหน้าปฏิทินเขียน `<input className="ui-input">` ซึ่งยืมชื่อคลาสภายในมาแปะ
 */
export function FormInput({
  name,
  type = 'text',
  defaultValue,
  placeholder,
  id,
  ariaLabel,
  required = false,
}: FormInputProps): ReactNode {
  return (
    <input
      className="ui-input"
      id={id}
      name={name}
      type={type}
      defaultValue={defaultValue}
      placeholder={placeholder}
      required={required}
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
    />
  );
}
