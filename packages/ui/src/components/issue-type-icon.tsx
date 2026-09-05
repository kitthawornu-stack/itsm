/**
 * ไอคอนประเภทงาน
 *
 * `icon_key` เดินทางจากฐานข้อมูลผ่าน API ไปถึง prop ของคอมโพเนนต์มาหลายเดือน
 * แล้วหยุดอยู่ตรงนั้น — **ไม่มีอะไรเรนเดอร์** จึงไม่มีใครเห็นว่าค่าที่แต่ละ
 * ทางเข้าเขียนไว้ขัดกันเอง · คำศัพท์อยู่ที่ `@itsm/types` และ API แปลให้แล้ว
 * ก่อนส่งมา ที่นี่จึงรับเฉพาะค่าที่วาดได้
 *
 * **วาดด้วย `currentColor` ล้วน** ไม่มีสีของตัวเอง — สองเหตุผล:
 *   1. INVARIANT 4 ห้ามค่าสีดิบ และการเพิ่ม token สีอีกสิบตัวเพื่อไอคอน
 *      แปลว่าต้องเพิ่มครบสามที่ต่อหนึ่งตัว และตรวจ contrast ทั้งสองธีม
 *   2. สีของสถานะ (`--status-critical` ฯลฯ) **ถูกจองไว้** ห้ามเอามาใช้แทน
 *      ความหมายอื่น มิฉะนั้นไอคอนสีแดงจะอ่านว่า "วิกฤต" ทั้งที่แปลว่า "เหตุขัดข้อง"
 *
 * ไอคอนจึงรับสีจากข้อความที่มันอยู่ข้าง ๆ และถูกต้องทั้งสามสถานะของธีมโดยอัตโนมัติ
 */
import type { ReactNode } from 'react';

/**
 * ต้องตรงกับ `ISSUE_TYPE_ICONS` ใน `@itsm/types` เป๊ะ
 *
 * `packages/ui` ไม่ได้พึ่ง `@itsm/types` (ไม่มี dependency ระหว่างสองแพ็กเกจนี้)
 * รายการจึงถูกเขียนสองที่ · `issue-type-icon-parity.spec.ts` ใน `apps/api`
 * สแกนทั้งสองไฟล์มาเทียบ ถ้าไม่ตรง CI แดง — มิฉะนั้นคีย์ใหม่จะเงียบ ๆ
 * ตกไปเป็นไอคอนทั่วไปโดยไม่มีอะไรฟ้อง
 */
export type IssueTypeIconName =
  | 'incident'
  | 'request'
  | 'problem'
  | 'change'
  | 'epic'
  | 'story'
  | 'task'
  | 'bug'
  | 'subtask'
  | 'generic';

export interface IssueTypeIconProps {
  name: IssueTypeIconName;
  /**
   * ชื่อสำหรับ screen reader · **ไม่ใส่ = ไอคอนเป็นของประดับ** (`aria-hidden`)
   * ซึ่งถูกต้องเมื่อชื่อประเภทงานเป็นข้อความอยู่ข้าง ๆ อยู่แล้ว — ใส่ชื่อซ้ำ
   * ทำให้คนที่ฟังได้ยินสองรอบ
   *
   * ชื่อ prop ไม่มีขีดกลางโดยตั้งใจ · `aria-label` บนคอมโพเนนต์ของเราเอง
   * ผ่าน typecheck แล้วหายไปตอนเรนเดอร์ (CLAUDE.md §8)
   */
  ariaLabel?: string;
  size?: 'sm' | 'md';
}

/** เส้นของแต่ละไอคอน — viewBox 24×24 เหมือนกันหมด จึงวางเรียงกันแล้วไม่กระโดด */
const PATHS: Readonly<Record<IssueTypeIconName, ReactNode>> = {
  incident: (
    <>
      <path d="M10.3 3.9 1.8 18.4A2 2 0 0 0 3.5 21.4h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  request: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z" />
    </>
  ),
  problem: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  change: (
    <>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  epic: (
    <>
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </>
  ),
  story: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />,
  task: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  bug: (
    <>
      <path d="M8 6a4 4 0 0 1 8 0v1H8Z" />
      <rect width="10" height="10" x="7" y="7" rx="5" />
      <path d="M3 11h4M17 11h4M4 17l3-2M20 17l-3-2M12 17v4" />
    </>
  ),
  subtask: <path d="M4 4v7a3 3 0 0 0 3 3h11m-4-4 4 4-4 4" />,
  generic: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

export function IssueTypeIcon({ name, ariaLabel, size = 'md' }: IssueTypeIconProps): ReactNode {
  const px = size === 'sm' ? 14 : 16;
  const decorative = ariaLabel === undefined;
  return (
    <svg
      className="ui-issue-icon"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      /* ของประดับต้องหายไปจาก accessibility tree ทั้งก้อน ไม่ใช่แค่ไม่มีชื่อ */
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : ariaLabel}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
