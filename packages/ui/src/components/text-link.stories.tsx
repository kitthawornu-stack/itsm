/**
 * Story ของ TextLink และ SubmitButton
 *
 * สองตัวนี้เกิดขึ้นเพราะหน้าจอที่ตั้งใจให้ **ทำงานได้โดยไม่ต้องมี JavaScript**
 * (หน้าคลังความรู้ใช้ `<form method="get">` จริง) ไม่มีคอมโพเนนต์ให้ใช้ ·
 * คนจึงเขียน `<a className="ui-linkbtn">` กับ `<button className="ui-btn">`
 * เอง — ยืมชื่อคลาสภายในของ design system มาแปะ ซึ่งแย่กว่าเขียนคลาสใหม่
 * เพราะมันดูเหมือนถูกต้องแล้วจนไม่มีใครสงสัย
 *
 * `TextLink` เป็น `<a>` ส่วน `LinkButton` เป็น `<button>` — **ต่างกันโดยตั้งใจ**
 * ไม่ใช่ตัวเลือกด้านหน้าตา · ของที่พาไปหน้าอื่นต้องเปิดแท็บใหม่และคัดลอกที่อยู่ได้
 *
 * แต่ละสถานะที่คอมโพเนนต์มีจริง ต้องมี story ของตัวเอง
 * สถานะที่ไม่มี story คือสถานะที่ไม่มีใครเคยดูในธีมมืด
 */
import type { Meta, StoryObj } from '@storybook/react';

import { FormInput, LinkButton, SubmitButton, TextLink } from '../index';

const meta = {
  title: 'System/TextLink',
  component: TextLink,
  args: { children: '', href: '#' },
} satisfies Meta<typeof TextLink>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: 'TextLink · ปกติ',
  render: () => <TextLink href="/knowledge/new">+ เขียนบทความใหม่</TextLink>,
};

export const Danger: Story = {
  name: 'TextLink · งานที่ทำลายของ',
  render: () => <TextLink href="#" tone="danger">ยกเลิกการสมัคร</TextLink>,
};

export const Named: Story = {
  name: 'TextLink · ลิงก์ที่ข้อความซ้ำกันทุกแถว',
  render: () => (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
      {['วิธีรีเซ็ตรหัสผ่าน', 'ตั้งค่าเครื่องพิมพ์ชั้น 3', 'ขอสิทธิ์เข้าระบบบัญชี'].map((t) => (
        <li key={t} style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline' }}>
          <span style={{ flex: 1 }}>{t}</span>
          {/*
            ทุกแถวมีลิงก์ข้อความเดียวกัน — ต้องมี `ariaLabel` แยก มิฉะนั้น
            คนที่ไล่ด้วยคีย์บอร์ดได้ยิน "แก้ไข แก้ไข แก้ไข" โดยไม่รู้ว่าอันไหน
            ของอะไร · และต้องเป็น prop ชื่อนี้ ไม่ใช่ `aria-label` ซึ่ง
            TypeScript ไม่ตรวจให้
          */}
          <TextLink href="#" ariaLabel={`แก้ไขบทความ ${t}`}>
            แก้ไข
          </TextLink>
        </li>
      ))}
    </ul>
  ),
};

export const BesideLinkButton: Story = {
  name: 'TextLink · วางข้าง LinkButton แล้วต้องกลมกลืน',
  render: () => (
    <p style={{ display: 'flex', gap: '1rem', alignItems: 'baseline', margin: 0 }}>
      <TextLink href="/knowledge">กลับไปค้นหา</TextLink>
      <LinkButton onClick={() => undefined}>บันทึกเป็นตัวกรอง</LinkButton>
      <LinkButton tone="danger" onClick={() => undefined}>
        ลบทิ้ง
      </LinkButton>
    </p>
  ),
};

export const Submit: Story = {
  name: 'SubmitButton · ฟอร์มที่ทำงานได้โดยไม่ต้องมี JavaScript',
  render: () => (
    <form
      method="get"
      action="#"
      style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <label style={{ display: 'grid', gap: '0.25rem' }}>
        ค้นหา
        <FormInput name="q" type="search" placeholder="เช่น รีเซ็ตรหัสผ่าน" />
      </label>
      <SubmitButton>ค้น</SubmitButton>
      <TextLink href="#">+ เขียนบทความใหม่</TextLink>
    </form>
  ),
};

export const FormInputDate: Story = {
  name: 'FormInput · ช่วงวันที่ในฟอร์ม GET',
  render: () => (
    <form
      method="get"
      action="#"
      style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <label style={{ display: 'grid', gap: '0.25rem' }}>
        ตั้งแต่
        <FormInput name="from" type="date" defaultValue="2026-09-01" />
      </label>
      <label style={{ display: 'grid', gap: '0.25rem' }}>
        ถึง
        <FormInput name="to" type="date" defaultValue="2026-09-30" />
      </label>
      <SubmitButton variant="secondary">ดูช่วงนี้</SubmitButton>
    </form>
  ),
};

export const FormInputNamed: Story = {
  name: 'FormInput · ช่องที่ป้ายมองไม่เห็น ต้องมีชื่อให้ screen reader',
  render: () => (
    <form
      method="get"
      action="#"
      style={{ display: 'flex', gap: '0.5rem' }}
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      {/*
        แถบค้นหาที่ไม่มีป้ายเห็นได้ ต้องมี `ariaLabel` — และต้องเป็น prop
        ชื่อนี้ ไม่ใช่ `aria-label` ซึ่ง TypeScript ไม่ตรวจให้บนคอมโพเนนต์ของเรา
      */}
      <FormInput name="q" type="search" ariaLabel="ค้นหาบทความ" placeholder="ค้นหา" />
      <SubmitButton>ค้น</SubmitButton>
    </form>
  ),
};

export const SubmitSecondary: Story = {
  name: 'SubmitButton · รอง',
  render: () => <SubmitButton variant="secondary">ล้างเงื่อนไข</SubmitButton>,
};
