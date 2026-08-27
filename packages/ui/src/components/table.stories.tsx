/**
 * Story ของ Table
 *
 * ตารางเขียนมือกระจายอยู่ 8 หน้าจอ (`.admin-table` 11 ที่ · `.admin-table-wrap` 11 ที่)
 * และไม่มีที่ไหนเคยถูกดูในธีมมืด · สามสถานะที่พลาดซ้ำ ๆ คือ **ไม่มีข้อมูล** ·
 * **ตารางกว้างเกินจอ** · และ **ข้อความไทยยาวที่ไม่มีช่องว่างให้ตัด**
 * ทั้งสามอย่างมี story ของตัวเองที่นี่
 */
import type { Meta, StoryObj } from '@storybook/react';

import { Alert, LinkButton, StatusPill, Table, Timestamp } from '../index';

const meta = {
  title: 'System/Table',
  component: Table,
  args: { columns: [], rowCount: 0, children: null },
} satisfies Meta<typeof Table>;
export default meta;

type Story = StoryObj<typeof meta>;

const USERS = [
  { id: '1', email: 'agent1@example.co.th', name: 'ปวีณา สุขสวัสดิ์', group: 'IT Support', last: '2026-08-27T01:46:00.000Z', items: 128 },
  { id: '2', email: 'agent2@example.co.th', name: 'อนุชา ประเสริฐ', group: 'IT Support', last: '2026-08-25T09:12:00.000Z', items: 94 },
  { id: '3', email: 'user1@example.co.th', name: 'อรพิน ศรีสุข', group: 'พนักงานทั้งหมด', last: '2026-07-02T03:00:00.000Z', items: 7 },
];

const COLUMNS = [
  'อีเมล',
  'ชื่อ',
  'กลุ่ม',
  'เข้าใช้ล่าสุด',
  { label: 'เรื่องที่แจ้ง', align: 'end' as const },
  { label: '', width: '96px' },
];

export const WithRows: Story = {
  name: 'มีข้อมูล',
  render: () => (
    <Table columns={COLUMNS} rowCount={USERS.length} empty="ยังไม่มีผู้ใช้">
      {USERS.map((u) => (
        <tr key={u.id}>
          <td>{u.email}</td>
          <td>{u.name}</td>
          <td>{u.group}</td>
          <td>
            <Timestamp utc={u.last} precision="date" />
          </td>
          <td data-align="end">{u.items.toLocaleString('th-TH')}</td>
          <td>
            <LinkButton onClick={() => undefined}>แก้ไข</LinkButton>
          </td>
        </tr>
      ))}
    </Table>
  ),
};

export const Empty: Story = {
  name: 'ไม่มีข้อมูล',
  render: () => (
    <Table columns={COLUMNS} rowCount={0} empty="ยังไม่มีผู้ใช้ในระบบ">
      {null}
    </Table>
  ),
};

export const EmptyWithoutMessage: Story = {
  name: 'ไม่มีข้อมูลและไม่ได้ตั้งข้อความ',
  render: () => (
    <>
      {/* ไม่ส่ง `empty` = ได้ตารางเปล่า ๆ ซึ่งอ่านเหมือนกำลังโหลดอยู่
          story นี้มีไว้ให้เห็นว่าทำไมจึงควรส่งเสมอ */}
      <Table columns={COLUMNS} rowCount={0}>
        {null}
      </Table>
    </>
  ),
};

export const SingleRow: Story = {
  name: 'แถวเดียว (เส้นล่างต้องไม่ซ้อนกรอบ)',
  render: () => (
    <Table columns={['สถานะ', 'จำนวนงาน']} rowCount={1}>
      <tr>
        <td>
          <StatusPill label="New" category="TODO" />
        </td>
        <td data-align="end">1,204</td>
      </tr>
    </Table>
  ),
};

export const NarrowContainer: Story = {
  name: 'ตารางกว้างในที่แคบ — ต้องเลื่อนในกล่องตัวเอง',
  render: () => (
    <div style={{ maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* หน้าเว็บทั้งหน้าต้องไม่เลื่อนแนวนอน — เฉพาะกล่องตารางเท่านั้นที่เลื่อน */}
      <Alert tone="info" inline>
        เลื่อนตารางด้านล่างไปทางขวาได้ โดยที่หน้าไม่เลื่อนตาม
      </Alert>
      <Table columns={COLUMNS} rowCount={USERS.length}>
        {USERS.map((u) => (
          <tr key={u.id}>
            <td>{u.email}</td>
            <td>{u.name}</td>
            <td>{u.group}</td>
            <td>
              <Timestamp utc={u.last} precision="date" />
            </td>
            <td data-align="end">{u.items}</td>
            <td>
              <LinkButton onClick={() => undefined}>แก้ไข</LinkButton>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  ),
};

export const LongThaiCells: Story = {
  name: 'ข้อความไทยยาวในคอลัมน์แคบ',
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <Table columns={['ฟิลด์', 'คำอธิบาย']} rowCount={2}>
        <tr>
          <td>สาเหตุที่แท้จริง</td>
          {/* ไม่มีช่องว่างสักตัว — ถ้าไม่มี word-break ตารางจะล้นออกนอกกรอบ */}
          <td>ผู้ใช้แจ้งว่าเครื่องพิมพ์ชั้นสามพิมพ์ไม่ออกและได้ลองปิดเปิดเครื่องแล้วแต่ยังไม่หาย</td>
        </tr>
        <tr>
          <td>หมายเหตุ</td>
          <td>รอฝ่ายจัดซื้ออนุมัติตลับหมึกก่อนจึงจะดำเนินการต่อได้</td>
        </tr>
      </Table>
    </div>
  ),
};

export const InactiveRows: Story = {
  name: 'แถวที่ยังไม่มีผล (ปิดบัญชี · เก็บเข้ากรุ)',
  render: () => (
    <Table columns={['อีเมล', 'ชื่อ', 'สถานะ']} rowCount={3}>
      <tr>
        <td>agent1@example.co.th</td>
        <td>ปวีณา สุขสวัสดิ์</td>
        <td>ใช้งานอยู่</td>
      </tr>
      {/* จางลงแต่ต้องยังอ่านออก — ไม่ใช่จางจนกลายเป็นข้อความที่มองไม่เห็น */}
      <tr data-inactive="true">
        <td>old1@example.co.th</td>
        <td>ผู้ใช้ที่ลาออกแล้ว</td>
        <td>ปิดแล้ว</td>
      </tr>
      <tr data-inactive="true">
        <td>old2@example.co.th</td>
        <td>บัญชีชั่วคราว</td>
        <td>ปิดแล้ว</td>
      </tr>
    </Table>
  ),
};
