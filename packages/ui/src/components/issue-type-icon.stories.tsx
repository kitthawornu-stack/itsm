/**
 * Story ของไอคอนประเภทงาน
 *
 * **ทุกค่าในคำศัพท์ต้องมี story ของตัวเอง** ไม่ใช่มีแค่ default แล้วให้คนไปกด
 * control เอง — ไอคอนที่ไม่มี story คือไอคอนที่ไม่มีใครเคยดูว่ามันวาดถูกไหม
 * และเส้นที่เพี้ยนไม่ทำให้อะไรพัง มันแค่ดูไม่ออกว่าเป็นอะไร
 */
import type { Meta, StoryObj } from '@storybook/react';

import { IssueTypeIcon, type IssueTypeIconName } from '../index';

const meta = {
  title: 'System/IssueTypeIcon',
  component: IssueTypeIcon,
  args: { name: 'generic' },
} satisfies Meta<typeof IssueTypeIcon>;
export default meta;

type Story = StoryObj<typeof meta>;

const ALL: { key: IssueTypeIconName; label: string }[] = [
  { key: 'incident', label: 'เหตุขัดข้อง' },
  { key: 'request', label: 'คำขอบริการ' },
  { key: 'problem', label: 'ปัญหา' },
  { key: 'change', label: 'การเปลี่ยนแปลง' },
  { key: 'epic', label: 'งานใหญ่' },
  { key: 'story', label: 'เรื่อง' },
  { key: 'task', label: 'งาน' },
  { key: 'bug', label: 'ข้อบกพร่อง' },
  { key: 'subtask', label: 'งานย่อย' },
  { key: 'generic', label: 'ทั่วไป' },
];

export const AllIcons: Story = {
  name: 'ครบทุกค่าในคำศัพท์',
  render: () => (
    <ul style={{ display: 'grid', gap: 'var(--space-2)', listStyle: 'none', padding: 0 }}>
      {ALL.map((i) => (
        <li key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <IssueTypeIcon name={i.key} />
          <span>{i.label}</span>
        </li>
      ))}
    </ul>
  ),
};

export const InlineWithText: Story = {
  name: 'อยู่หน้าข้อความไทย — ต้องไม่ลอยจากบรรทัด',
  render: () => (
    <p style={{ lineHeight: 1.6, maxWidth: '32em' }}>
      <IssueTypeIcon name="incident" /> เหตุขัดข้องที่กระทบผู้ใช้หลายคน
      ต้องยกระดับให้หัวหน้าทีมทราบภายในสามสิบนาที
    </p>
  ),
};

export const Sizes: Story = {
  name: 'สองขนาด — การ์ดใช้เล็ก หน้ารายละเอียดใช้ปกติ',
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
      <IssueTypeIcon name="epic" size="sm" />
      <IssueTypeIcon name="epic" />
    </div>
  ),
};

/**
 * ไอคอนที่ยืนอยู่ลำพัง (ไม่มีข้อความชื่อประเภทข้าง ๆ) ต้องมีชื่อให้ screen reader
 * · เทียบกับ story ข้างบนที่เป็นของประดับ — สองสถานะนี้ต่างกันที่ accessibility
 * tree ซึ่ง **มองด้วยตาไม่เห็นความต่างเลย**
 */
export const Standalone: Story = {
  name: 'ยืนลำพัง — มีชื่อสำหรับ screen reader',
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
      <IssueTypeIcon name="bug" ariaLabel="ข้อบกพร่อง" />
      <IssueTypeIcon name="change" ariaLabel="การเปลี่ยนแปลง" />
    </div>
  ),
};
