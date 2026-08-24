/**
 * Story ของคอมโพเนนต์แกน
 *
 * หลักการเขียน story ที่นี่: **แต่ละสถานะที่คอมโพเนนต์มีจริง ต้องมี story ของตัวเอง**
 * ไม่ใช่มีแค่ default แล้วให้คนไปกด control เอง เพราะสถานะที่ไม่มี story
 * คือสถานะที่ไม่มีใครเคยดู และเป็นที่ที่บั๊กธีมมืดกับ a11y ซ่อนอยู่
 *
 * สลับธีมและความหนาแน่นได้จาก toolbar ด้านบน — ทั้งสามสถานะธีม
 */
import type { Meta, StoryObj } from '@storybook/react';

import type { ReactElement, ReactNode } from 'react';

import { Button } from '../index';

const Row = ({ children }: { children: ReactNode }): ReactElement => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
);

// ============================================================
const buttonMeta = {
  title: 'Foundation/Button',
  component: Button,
  args: { children: 'บันทึก', variant: 'primary', size: 'md', disabled: false },
} satisfies Meta<typeof Button>;
export default buttonMeta;

type ButtonStory = StoryObj<typeof buttonMeta>;

export const Primary: ButtonStory = {};
export const Secondary: ButtonStory = { args: { variant: 'secondary', children: 'ยกเลิก' } };
export const Ghost: ButtonStory = { args: { variant: 'ghost', children: 'ดูเพิ่มเติม' } };
export const Delivery: ButtonStory = { args: { variant: 'delivery', children: 'สร้างงานใหม่' } };
export const Danger: ButtonStory = { args: { variant: 'danger', children: 'ลบถาวร' } };
export const Disabled: ButtonStory = { args: { disabled: true, children: 'ปิดใช้งาน' } };
export const Small: ButtonStory = { args: { size: 'sm', children: 'ขนาดเล็ก' } };

export const ThaiLabelLength: ButtonStory = {
  name: 'ป้ายกำกับไทยที่ยาว',
  render: () => (
    <Row>
      <Button variant="primary">บันทึก</Button>
      <Button variant="secondary">ยกเลิกการดำเนินการทั้งหมด</Button>
      <Button variant="delivery">ส่งคำขออนุมัติไปยังหัวหน้าแผนก</Button>
    </Row>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'ป้ายกำกับภาษาไทยยาวกว่าอังกฤษเฉลี่ย 1.3 เท่า — ปุ่มต้องไม่ตัดบรรทัดและระยะในต้องยังพอ',
      },
    },
  },
};
