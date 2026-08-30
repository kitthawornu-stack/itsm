/**
 * Story ของตัวเลขและแผนภูมิ
 *
 * ทุกสถานะมี story ของตัวเอง เพราะสถานะที่ไม่มี story
 * คือสถานะที่ไม่มีใครเคยดูในธีมมืด
 *
 * แผนภูมิมีสถานะที่พังเงียบอยู่หลายแบบ และทุกแบบดูเหมือนแผนภูมิที่ถูกต้อง:
 * ช่วงยาวจนป้ายทับกัน · วันที่ไม่มีงานเลยที่ต้องไม่มีแท่ง · ค่าหนึ่งใบ
 * ที่ต้องยังมองเห็นข้างค่าพันใบ · และช่วงที่ว่างทั้งช่วง
 */
import type { Meta, StoryObj } from '@storybook/react';
import type { ReactElement, ReactNode } from 'react';

import { DailyChart, Stat, type DailyPointView } from '../index';

const Row = ({ children }: { children: ReactNode }): ReactElement => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: 8,
    }}
  >
    {children}
  </div>
);

const meta = {
  title: 'ข้อมูล/ตัวเลขและแผนภูมิ',
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** ชุดวันแบบกำหนดค่าตายตัว — story ต้องเหมือนกันทุกครั้งที่เปิด */
function days(values: Array<[number, number]>, from = 1): DailyPointView[] {
  return values.map(([opened, resolved], i) => ({
    day: `2026-08-${String(from + i).padStart(2, '0')}`,
    opened,
    resolved,
  }));
}

export const ตัวเลข: Story = {
  render: () => (
    <Row>
      <Stat label="แจ้งเข้ามา" value="1,284" />
      <Stat label="ปิดได้" value="1,190" hint="ในช่วงเดียวกัน" />
      <Stat label="ค้างอยู่ตอนนี้" value="312" hint="ไม่ใช่ค่าของช่วง" />
      <Stat label="หลุด SLA" value="27" tone="critical" hint="นับจากเวลาที่หลุดจริง" />
    </Row>
  ),
};

/** ตัวเลขที่ยังไม่มีค่า — ขีดกลาง ไม่ใช่เลขศูนย์ ซึ่งเป็นคนละความหมาย */
export const ตัวเลขที่ยังไม่มีค่า: Story = {
  render: () => (
    <Row>
      <Stat label="เวลาปิดเฉลี่ย" value="—" hint="ยังไม่มีใบไหนปิดในช่วงนี้" />
    </Row>
  ),
};

export const แผนภูมิรายวัน: Story = {
  render: () => (
    <DailyChart
      daily={days([
        [12, 9],
        [18, 14],
        [7, 11],
        [22, 19],
        [15, 16],
        [9, 13],
        [3, 5],
      ])}
    />
  ),
};

/**
 * วันที่ไม่มีงานเลยต้องไม่มีแท่ง
 *
 * เคยวาด `rect` ทุกค่ารวมทั้งศูนย์ · `rx` ทำให้แท่งสูงไม่ถึงพิกเซลกลายเป็น
 * ก้อนกลม ๆ ลอยบนเส้นฐาน แล้ววันว่างดูเหมือนวันที่มีงานหนึ่งใบ
 */
export const มีวันที่ไม่มีงานเลย: Story = {
  render: () => (
    <DailyChart
      daily={days([
        [14, 10],
        [0, 0],
        [0, 2],
        [1, 0],
        [19, 17],
      ])}
    />
  ),
};

/** ค่าหนึ่งใบข้างค่าพันใบ — ต้องยังมองเห็น ไม่ใช่หายไปกับเส้นฐาน */
export const ค่าน้อยมากข้างค่ามาก: Story = {
  render: () => (
    <DailyChart
      daily={days([
        [1, 0],
        [1240, 1100],
        [2, 1],
        [3, 4],
      ])}
    />
  ),
};

/** ช่วง 30 วัน — ป้ายแกนนอนต้องไม่ทับกัน และกราฟต้องเลื่อนในกล่องของตัวเอง */
export const ช่วงสามสิบวัน: Story = {
  render: () => (
    <DailyChart
      daily={days(
        Array.from({ length: 30 }, (_, i): [number, number] => [
          6 + ((i * 7) % 19),
          4 + ((i * 5) % 15),
        ]),
      )}
    />
  ),
};

/** ช่วงที่ไม่มีงานเลยทั้งช่วง — ต้องได้เส้นฐานเปล่า ไม่ใช่หน้าพัง */
export const ว่างทั้งช่วง: Story = {
  render: () => (
    <DailyChart
      daily={days([
        [0, 0],
        [0, 0],
        [0, 0],
      ])}
    />
  ),
};

/** วันเดียว — จุดที่การหารด้วยจำนวนวันพังได้ง่ายที่สุด */
export const วันเดียว: Story = {
  render: () => <DailyChart daily={days([[8, 5]])} />,
};
