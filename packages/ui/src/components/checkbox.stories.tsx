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
import { useState, type ReactElement } from 'react';

import { Checkbox } from '../index';

const meta = {
  title: 'System/Checkbox',
  component: Checkbox,
  args: { checked: false, onChange: () => undefined },
} satisfies Meta<typeof Checkbox>;
export default meta;

type Story = StoryObj<typeof meta>;

const Stack = ({ children }: { children: ReactElement }): ReactElement => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>{children}</div>
);

const LiveCheck = ({
  children,
}: {
  children: (v: boolean, set: (b: boolean) => void) => ReactElement;
}): ReactElement => {
  const [v, setV] = useState(false);
  return children(v, setV);
};

export const CheckUnchecked: Story = {
  name: 'Checkbox · ยังไม่เลือก',
  render: () => (
    <LiveCheck>{(v, set) => <Checkbox checked={v} onChange={set}>ให้คนอื่นเห็นด้วย</Checkbox>}</LiveCheck>
  ),
};

export const CheckChecked: Story = {
  name: 'Checkbox · เลือกแล้ว',
  render: () => (
    <LiveCheck>
      {(v, set) => (
        <Checkbox checked={!v} onChange={(b) => { set(!b); }}>
          ให้คนอื่นเห็นด้วย
        </Checkbox>
      )}
    </LiveCheck>
  ),
};

export const CheckIndeterminate: Story = {
  name: 'Checkbox · เลือกบางส่วน',
  render: () => (
    <Stack>
      <>
        {/* ช่องที่ติ๊กเต็มทั้งที่เลือกไว้ 3 จาก 50 คือคำโกหก */}
        <Checkbox checked={false} indeterminate onChange={() => undefined}>
          เลือกทั้งหมดในหน้านี้ (เลือกไว้ 3 จาก 50)
        </Checkbox>
      </>
    </Stack>
  ),
};

export const CheckDisabled: Story = {
  name: 'Checkbox · กดไม่ได้',
  render: () => (
    <Stack>
      <>
        <Checkbox checked={false} disabled onChange={() => undefined}>
          แก้ไขหลายเรื่องพร้อมกัน (ไม่มีสิทธิ์)
        </Checkbox>
        <Checkbox checked disabled onChange={() => undefined}>
          เปิดดูโปรเจกต์ (ได้มาจากสิทธิ์อื่น)
        </Checkbox>
      </>
    </Stack>
  ),
};

export const CheckNoLabel: Story = {
  name: 'Checkbox · ไม่มีข้อความข้างช่อง (ในตาราง)',
  render: () => (
    <LiveCheck>{(v, set) => <Checkbox checked={v} onChange={set} label="เลือก SD-1042" />}</LiveCheck>
  ),
};
