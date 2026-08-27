/**
 * Story ของคอมโพเนนต์ระบบ — Alert · PageHeader · Timestamp · Checkbox · LinkButton
 *
 * ห้าตัวนี้ `apps/web` เขียนเองซ้ำ ๆ มาตลอด (`.admin-error` 18 ที่ · `.admin-empty`
 * 22 ที่ · `.admin-linkish` 15 ที่ · `.grid-check` 5 ที่ · `.admin-when` 10 ที่)
 * ทุกที่มีหน้าตาต่างกันนิดหน่อย และ **ไม่มีที่ไหนเคยถูกดูในธีมมืด**
 *
 * บั๊กที่เกิดจากตรงนี้ในรอบเดียว: คลาสชนกันจนแถบข้างเปลี่ยนหน้าตา ·
 * ปุ่มหลักถูกกดให้แบน · `var(--space-5)` ที่ไม่มีนิยาม · หัวตารางเลื่อนหลุด
 * จากข้อมูล · contrast 3.8:1 ในธีมมืด — ไม่มีอันไหนที่ typecheck หรือ lint จับได้
 *
 * แต่ละสถานะที่คอมโพเนนต์มีจริง ต้องมี story ของตัวเอง
 * สถานะที่ไม่มี story คือสถานะที่ไม่มีใครเคยดูในธีมมืด
 */
import type { Meta, StoryObj } from '@storybook/react';

import { Button, LinkButton } from '../index';

const meta = {
  title: 'System/LinkButton',
  component: LinkButton,
  args: { children: '', onClick: () => undefined },
} satisfies Meta<typeof LinkButton>;
export default meta;

type Story = StoryObj<typeof meta>;

export const LinkDefault: Story = {
  name: 'LinkButton · ปกติ',
  render: () => <LinkButton onClick={() => undefined}>บันทึกเป็นตัวกรอง</LinkButton>,
};

export const LinkDanger: Story = {
  name: 'LinkButton · งานที่ทำลายของ',
  render: () => (
    <LinkButton tone="danger" onClick={() => undefined}>
      ลบตัวกรองนี้
    </LinkButton>
  ),
};

export const LinkDisabled: Story = {
  name: 'LinkButton · กดไม่ได้',
  render: () => (
    <LinkButton disabled onClick={() => undefined}>
      ยกเลิกการเลือก
    </LinkButton>
  ),
};

export const LinkRow: Story = {
  name: 'LinkButton · เรียงต่อกันข้างปุ่มหลัก',
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Button variant="primary">แก้ทั้งหมด</Button>
      <LinkButton onClick={() => undefined}>ยกเลิกการเลือก</LinkButton>
      <LinkButton tone="danger" onClick={() => undefined}>
        ลบ
      </LinkButton>
    </div>
  ),
};
