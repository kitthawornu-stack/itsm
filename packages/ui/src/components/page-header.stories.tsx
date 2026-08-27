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

import { Button, PageHeader } from '../index';

const meta = {
  title: 'System/PageHeader',
  component: PageHeader,
  args: { title: '' },
} satisfies Meta<typeof PageHeader>;
export default meta;

type Story = StoryObj<typeof meta>;

export const HeaderTitleOnly: Story = {
  name: 'PageHeader · หัวเรื่องอย่างเดียว',
  render: () => <PageHeader title="ตั้งค่าผลการแก้ไข" />,
};

export const HeaderWithLead: Story = {
  name: 'PageHeader · มีคำอธิบาย',
  render: () => (
    <PageHeader
      title="คิวงาน · IT Service Desk"
      lead="งานที่เปิดอยู่ทั้งหมด 2,630 รายการ · แสดง 50 รายการแรก เรียงตามการอัปเดตล่าสุด"
    />
  ),
};

export const HeaderWithActions: Story = {
  name: 'PageHeader · มีปุ่มมุมขวา',
  render: () => (
    <PageHeader
      title="คิวงาน · IT Service Desk"
      lead="งานที่เปิดอยู่ทั้งหมด 2,630 รายการ"
      actions={<Button variant="primary">แจ้งปัญหา</Button>}
    />
  ),
};

export const HeaderLongThai: Story = {
  name: 'PageHeader · หัวเรื่องไทยยาวในที่แคบ',
  render: () => (
    <div style={{ maxWidth: 300 }}>
      <PageHeader
        title="ตั้งค่าปฏิทินวันหยุดและการยืนยันรายปีของข้อตกลงระดับบริการ"
        lead="ยังไม่มีใครยืนยันปี 2570"
        actions={<Button>เพิ่มวันหยุด</Button>}
      />
    </div>
  ),
};
