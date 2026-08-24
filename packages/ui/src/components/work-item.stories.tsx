/**
 * Story ของคอมโพเนนต์ที่แสดงสถานะงาน
 *
 * ทุกสถานะมี story ของตัวเอง เพราะสถานะที่ไม่มี story
 * คือสถานะที่ไม่มีใครเคยดูในธีมมืด
 */
import type { Meta, StoryObj } from '@storybook/react';
import type { ReactElement, ReactNode } from 'react';

import {
  Avatar,
  EmptyState,
  Input,
  LabelChip,
  PriorityIndicator,
  Skeleton,
  SlaBar,
  StatusPill,
  WorkItemCard,
  WorkItemRow,
} from '../index';

const Row = ({ children }: { children: ReactNode }): ReactElement => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
);

const meta = {
  title: 'Work Item/สถานะและความสำคัญ',
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

// ============================================================

export const StatusPills: Story = {
  name: 'StatusPill — ทุกสถานะ',
  render: () => (
    <Row>
      <StatusPill label="ยังไม่เริ่ม" category="TODO" />
      <StatusPill label="กำลังดำเนินการ" category="IN_PROGRESS" />
      <StatusPill label="รอลูกค้าตอบ" category="IN_PROGRESS" pausesSla />
      <StatusPill label="เสร็จแล้ว" category="DONE" />
    </Row>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'ข้อความเป็นภาษาคน ไม่ใช่ศัพท์ระบบ · สถานะที่หยุดนาฬิกา SLA ใช้สีเตือน ' +
          'เพื่อให้แยกออกจากสถานะที่กำลังเดิน ซึ่งเป็นความต่างที่ Agent ต้องเห็นทันที',
      },
    },
  },
};

export const Priorities: Story = {
  name: 'PriorityIndicator — P1 ถึง P5',
  render: () => (
    <Row>
      <PriorityIndicator rank={1} label="P1 Critical" />
      <PriorityIndicator rank={2} label="P2 High" />
      <PriorityIndicator rank={3} label="P3 Medium" />
      <PriorityIndicator rank={4} label="P4 Low" />
      <PriorityIndicator rank={5} label="P5 Trivial" />
    </Row>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'ความสูงของแท่งเข้ารหัสลำดับซ้ำอีกชั้นนอกเหนือจากสี (13/11/9/7/5px) — ' +
          'เรียงได้ถูกแม้พิมพ์ขาวดำหรือมองด้วยตาที่แยกสีแดงเขียวไม่ออก',
      },
    },
  },
};

export const PriorityLabelHidden: Story = {
  name: 'PriorityIndicator — ซ่อนข้อความ (คิวแคบ)',
  render: () => (
    <Row>
      <PriorityIndicator rank={1} label="P1 Critical" labelHidden />
      <PriorityIndicator rank={3} label="P3 Medium" labelHidden />
    </Row>
  ),
  parameters: {
    docs: {
      description: {
        story: 'ข้อความถูกซ่อนจากสายตาแต่ screen reader ยังอ่านได้ผ่าน .ui-sr-only',
      },
    },
  },
};

export const SlaStates: Story = {
  name: 'SlaBar — ทั้งสี่สถานะ',
  render: () => (
    <Row>
      <SlaBar elapsedRatio={0.25} state="ok" label="เหลือ 6 ชม." />
      <SlaBar elapsedRatio={0.74} state="warning" label="เหลือ 48 นาที" />
      <SlaBar elapsedRatio={0.92} state="critical" label="เหลือ 11 นาที" />
      <SlaBar elapsedRatio={0.4} state="paused" label="⏸ หยุดนาฬิกา" />
    </Row>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'สถานะหยุดนาฬิกาใช้แถบสีกลางพร้อมสัญลักษณ์ ⏸ ไม่ใช่ซ่อนแถบไป — ' +
          'Agent ต้องแยก "ไม่มี SLA" ออกจาก "SLA หยุดชั่วคราว" ได้',
      },
    },
  },
};

export const Avatars: Story = {
  name: 'Avatar — ชื่อไทย',
  render: () => (
    <Row>
      <Avatar name="ปวีณา สุขสวัสดิ์" tone="service" />
      <Avatar name="สมชาย กิตติพงศ์" tone="delivery" />
      <Avatar name="ยังไม่มีผู้รับผิดชอบ" tone="neutral" />
      <Avatar name="ณัฐพล ธนกิจ" size="lg" />
    </Row>
  ),
};

export const Chips: Story = {
  name: 'LabelChip — เลือกและไม่เลือก',
  render: () => (
    <Row>
      <LabelChip>เครือข่าย</LabelChip>
      <LabelChip selected>SLA ใกล้หลุด</LabelChip>
      <LabelChip
        onClick={() => {
          /* กดได้ */
        }}
      >
        กดได้ (เป็นปุ่มจริง)
      </LabelChip>
    </Row>
  ),
};

export const Inputs: Story = {
  name: 'Input — ปกติและผิดพลาด',
  render: () => (
    <div style={{ display: 'grid', gap: 16, maxWidth: 360 }}>
      <Input value="ระบบเข้าสู่ระบบล่ม" onChange={() => undefined} id="ok" />
      <Input
        value=""
        onChange={() => undefined}
        placeholder="ระบุหัวข้อของปัญหา"
        id="empty"
      />
      <Input
        value=""
        onChange={() => undefined}
        invalid
        id="bad"
        errorMessage="ต้องระบุหัวข้อก่อนบันทึก"
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'ข้อความผิดพลาดบอกว่าต้องทำอะไรต่อ ไม่ใช่แค่ว่าผิด และผูกกับ input ด้วย aria-describedby',
      },
    },
  },
};

export const Loading: Story = {
  name: 'Skeleton — รูปทรงเหมือนของจริง',
  render: () => (
    <div style={{ display: 'grid', gap: 8, maxWidth: 320 }}>
      <Skeleton height="16px" />
      <Skeleton width="70%" height="12px" />
      <Skeleton width="45%" height="12px" />
    </div>
  ),
};

export const Empty: Story = {
  name: 'EmptyState — กรองแล้วไม่เจอ',
  render: () => (
    <EmptyState
      title="ยังไม่มีงานที่ตรงกับตัวกรองนี้"
      body="ลองล้างตัวกรองเพื่อดูงานทั้งหมด หรือปรับเงื่อนไขให้กว้างขึ้น"
      action={{ label: 'ล้างตัวกรอง', onClick: () => undefined }}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'สถานะ "ยังไม่เคยมีข้อมูล" กับ "กรองแล้วไม่เจอ" ต้องใช้ข้อความคนละแบบ — ' +
          'และทุกสถานะว่างต้องมีทางออกที่กดได้ ไม่ใช่ข้อความอย่างเดียว',
      },
    },
  },
};

export const EmptyFirstRun: Story = {
  name: 'EmptyState — ยังไม่เคยมีข้อมูล',
  render: () => (
    <EmptyState
      title="ยังไม่มีงานในคิวนี้"
      body="เมื่อมีผู้แจ้งปัญหาเข้ามา งานจะปรากฏที่นี่โดยอัตโนมัติ"
    />
  ),
};

export const Cards: Story = {
  name: 'WorkItemCard — บน Board',
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 220px)', gap: 10 }}>
      <WorkItemCard
        itemKey="PLAT-201"
        summary="Post Function เรียก Webhook ภายนอกแล้ว timeout ค้าง"
        rank={1}
        storyPoints={8}
        assignee="ปวีณา สุขสวัสดิ์"
        blocked
      />
      <WorkItemCard
        itemKey="PLAT-197"
        summary="ตัวแก้ไข Workflow แบบลากวางบนผืนผ้าใบ"
        rank={2}
        storyPoints={13}
        assignee="ณัฐพล ธนกิจ"
      />
      <WorkItemCard
        itemKey="PLAT-176"
        summary="โครงสร้างตาราง workflow_status และ transition"
        rank={3}
        storyPoints={5}
        assignee="พรทิพย์ ลีลาวดี"
        done
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'การ์ดที่เสร็จแล้วลดความทึบเพื่อให้สายตาไปเกาะคอลัมน์ที่ยังต้องทำงาน · ' +
          'การ์ดที่ติดขัดสื่อสารสองชั้น: แถบซ้ายสีวิกฤต และชิปข้อความ',
      },
    },
  },
};

export const QueueRows: Story = {
  name: 'WorkItemRow — คิวจริง',
  render: () => (
    <div style={{ border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
      <WorkItemRow
        itemKey="SD-1042"
        summary="ระบบเข้าสู่ระบบ SSO ล่ม พนักงานเข้าใช้งานไม่ได้ทั้งสำนักงาน"
        priority={{ rank: 1, label: 'P1 Critical' }}
        status={{ label: 'Investigating', category: 'IN_PROGRESS' }}
        assignee="ปวีณา สุขสวัสดิ์"
        sla={{ elapsedRatio: 0.92, state: 'critical', label: 'เหลือ 11 นาที' }}
      />
      <WorkItemRow
        itemKey="SD-1031"
        summary="VPN หลุดบ่อยตั้งแต่เช้า ทีมที่ทำงานจากบ้านได้รับผลกระทบ"
        priority={{ rank: 2, label: 'P2 High' }}
        status={{ label: 'Pending Customer', category: 'IN_PROGRESS', pausesSla: true }}
        assignee="อนุชา ประเสริฐ"
        sla={{ elapsedRatio: 0.4, state: 'paused', label: '⏸ หยุดนาฬิกา' }}
      />
      <WorkItemRow
        itemKey="SD-1019"
        summary="ขอติดตั้ง Microsoft Project ให้พนักงานใหม่ 3 ท่าน"
        priority={{ rank: 4, label: 'P4 Low' }}
        status={{ label: 'New', category: 'TODO' }}
        sla={{ elapsedRatio: 0.22, state: 'ok', label: 'เหลือ 1 วัน 4 ชม.' }}
      />
      <WorkItemRow
        itemKey="SD-1004"
        summary="ขอติดตั้งโปรแกรม Adobe Acrobat"
        priority={{ rank: 5, label: 'P5 Trivial' }}
        status={{ label: 'Resolved', category: 'DONE' }}
        assignee="สมชาย กิตติพงศ์"
        selected
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'แถวรองรับคีย์บอร์ด (Tab แล้ว Enter/Space เปิดรายละเอียด) · ' +
          'สลับความหนาแน่นจาก toolbar เพื่อดูโหมด Compact ที่ Agent ใช้จริงบนจอ 1366×768',
      },
    },
  },
};
