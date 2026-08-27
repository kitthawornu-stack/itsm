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
import { type ReactElement } from 'react';

import { Timestamp } from '../index';

const meta = {
  title: 'System/Timestamp',
  component: Timestamp,
  args: { utc: '2026-08-27T02:30:00.000Z' },
} satisfies Meta<typeof Timestamp>;
export default meta;

type Story = StoryObj<typeof meta>;

const Stack = ({ children }: { children: ReactElement }): ReactElement => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>{children}</div>
);

export const TimeDefault: Story = {
  name: 'Timestamp · วันและเวลา',
  render: () => <Timestamp utc="2026-08-27T02:30:00.000Z" />,
};

export const TimeDateOnly: Story = {
  name: 'Timestamp · เฉพาะวันที่',
  render: () => <Timestamp utc="2026-08-27T02:30:00.000Z" precision="date" />,
};

export const TimeCrossesDay: Story = {
  name: 'Timestamp · ข้ามวันเมื่อแปลงเป็นเวลาไทย',
  render: () => (
    <Stack>
      <>
        {/* 20:00 UTC = ตี 3 ของวันถัดไปที่กรุงเทพฯ — ถ้าใช้เขตเวลาของเครื่อง
            เซิร์ฟเวอร์กับเบราว์เซอร์จะเรนเดอร์คนละวัน */}
        <span>
          UTC 2026-08-26T20:00Z → <Timestamp utc="2026-08-26T20:00:00.000Z" />
        </span>
        <span>
          UTC 2026-08-26T16:59Z → <Timestamp utc="2026-08-26T16:59:00.000Z" />
        </span>
      </>
    </Stack>
  ),
};

export const TimeInvalid: Story = {
  name: 'Timestamp · ค่าที่แปลงไม่ได้',
  render: () => (
    <Stack>
      <>
        {/* ต้องได้ — ไม่ใช่ "Invalid Date" ซึ่งอ่านเหมือนข้อมูลเสีย */}
        <Timestamp utc="" />
        <Timestamp utc="เมื่อวาน" />
      </>
    </Stack>
  ),
};
