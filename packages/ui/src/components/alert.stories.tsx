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

import { Alert } from '../index';

const meta = {
  title: 'System/Alert',
  component: Alert,
  args: { tone: 'info', children: '' },
} satisfies Meta<typeof Alert>;
export default meta;

type Story = StoryObj<typeof meta>;

const Stack = ({ children }: { children: ReactElement }): ReactElement => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>{children}</div>
);

export const AlertError: Story = {
  name: 'Alert · ผิดพลาด',
  render: () => (
    <Alert tone="error">
      ไม่พบระดับความสำคัญที่เลือก — ลองเลือกใหม่จากรายการ
    </Alert>
  ),
};

export const AlertWarning: Story = {
  name: 'Alert · เตือน',
  render: () => (
    <Alert tone="warning">
      ปฏิทินวันหยุดปี 2570 ยังไม่มีใครยืนยัน ตัวเลข SLA ที่เห็นจึงเชื่อไม่ได้
    </Alert>
  ),
};

export const AlertSuccess: Story = {
  name: 'Alert · สำเร็จ',
  render: () => <Alert tone="success">บันทึกตัวกรอง &quot;งานด่วนของฉัน&quot; แล้ว</Alert>,
};

export const AlertInfo: Story = {
  name: 'Alert · ข้อมูล',
  render: () => <Alert tone="info">คิวรีแทนตัวกรองปริยายทั้งหมด</Alert>,
};

export const AlertWithTitle: Story = {
  name: 'Alert · มีหัวข้อ',
  render: () => (
    <Alert tone="error" title="เชื่อมต่อระบบไม่ได้">
      API ตอบกลับ 503 — ระบบค้นหายังไม่พร้อมใช้งาน กรุณาแจ้งผู้ดูแลระบบ
    </Alert>
  ),
};

export const AlertInline: Story = {
  name: 'Alert · แบบบรรทัดเดียว (ติดช่องกรอก)',
  render: () => (
    <Stack>
      <>
        <Alert tone="error" inline>
          ไม่รู้จักฟิลด์ &quot;ฟิลด์มั่ว&quot; — ตรวจตัวสะกดอีกครั้ง
        </Alert>
        <Alert tone="success" inline>
          บันทึกแล้ว
        </Alert>
      </>
    </Stack>
  ),
};

export const AlertLongThai: Story = {
  name: 'Alert · ข้อความไทยยาว (ทดสอบการตัดคำ)',
  render: () => (
    <div style={{ maxWidth: 320 }}>
      <Alert tone="warning" title="สิทธิ์ที่ให้แล้วยังไม่มีผล">
        คีย์นี้แสดงบนหน้าตั้งค่าและให้กับกลุ่มได้จริงแต่ยังไม่มีโค้ดเส้นไหนถามถึงมันเลยผู้ดูแลจึงเชื่อว่าตั้งค่าเรียบร้อยแล้ว
      </Alert>
    </div>
  ),
};
