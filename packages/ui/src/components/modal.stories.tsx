import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { Button, LinkButton } from './interactive';
import { Modal } from './modal';
import { Table } from './presentational';

const meta: Meta<typeof Modal> = {
  title: 'Components/Modal',
  component: Modal,
};
export default meta;

type Story = StoryObj<typeof Modal>;

/**
 * เปิดค้างไว้เสมอ เพื่อให้ story เห็นกล่องโดยไม่ต้องกดก่อน
 *
 * `onClose` ไม่ทำอะไร — story ที่ปิดตัวเองแล้วเหลือหน้าจอว่าง ทำให้คนที่มาดู
 * ในธีมมืดต้องกดเปิดใหม่ทุกครั้ง และมักลืมดูสถานะที่เหลือ
 */
function Always({
  children,
  ...rest
}: Omit<React.ComponentProps<typeof Modal>, 'open' | 'onClose'>): React.ReactNode {
  return (
    <Modal open onClose={() => undefined} {...rest}>
      {children}
    </Modal>
  );
}

export const Default: Story = {
  name: 'Modal · ค่าเริ่มต้น',
  render: () => (
    <Always title="ยืนยันการเปลี่ยนแปลง">
      <p style={{ margin: 0, lineHeight: 1.6 }}>
        การเปลี่ยนชุดสิทธิ์มีผลกับทุกโปรเจกต์ที่ใช้ชุดนี้อยู่
      </p>
    </Always>
  ),
};

export const WithLead: Story = {
  name: 'Modal · มีคำอธิบายใต้หัวเรื่อง',
  render: () => (
    <Always
      title="ปิดงานหลายเรื่องพร้อมกัน"
      lead="เลือกไว้ 12 เรื่อง · เรื่องที่กดไม่ได้จะรายงานเหตุผลรายใบ"
    >
      <div style={{ display: 'flex', gap: 12 }}>
        <Button variant="primary">ปิดงาน</Button>
        <LinkButton onClick={() => undefined}>ยกเลิก</LinkButton>
      </div>
    </Always>
  ),
};

export const LongThaiTitle: Story = {
  name: 'Modal · หัวเรื่องไทยยาว',
  render: () => (
    /*
      ป้ายไทยยาวกว่าอังกฤษเฉลี่ย 1.3 เท่า · หัวเรื่องต้องตัดบรรทัดได้
      ไม่ใช่ดันปุ่มปิดหลุดออกนอกกล่อง — สถานะที่ไม่มี story คือสถานะที่ไม่มีใครเคยดู
    */
    <Always
      title="ยืนยันการเปลี่ยนชุดสิทธิ์ของโปรเจกต์ศูนย์บริการเทคโนโลยีสารสนเทศและการสื่อสาร"
      lead="ชุดใหม่ไม่มีกลุ่มไหนได้สิทธิ์เปิดดูโปรเจกต์เลย"
    >
      <p style={{ margin: 0, lineHeight: 1.6 }}>
        ถ้าสลับไปใช้ จะไม่มีใครเห็นโปรเจกต์นี้อีก รวมทั้งคุณเอง
      </p>
    </Always>
  ),
};

export const Wide: Story = {
  name: 'Modal · กว้าง (มีตาราง)',
  render: () => (
    <Always size="wide" title="เรื่องที่เปลี่ยนสถานะไม่ได้" lead="8 เรื่องจาก 50 เรื่อง">
      <Table columns={['เลขที่', 'เหตุผล']} rowCount={3}>
        <tr>
          <td>SD-1531</td>
          <td>ไม่มีปุ่มนี้จากสถานะปัจจุบัน</td>
        </tr>
        <tr>
          <td>SD-1596</td>
          <td>ไม่มีปุ่มนี้จากสถานะปัจจุบัน</td>
        </tr>
        <tr>
          <td>SD-3827</td>
          <td>ต้องเป็นผู้รับผิดชอบก่อนจึงจะปิดได้</td>
        </tr>
      </Table>
    </Always>
  ),
};

export const NoFocusableContent: Story = {
  name: 'Modal · เนื้อในไม่มีอะไรโฟกัสได้',
  render: () => (
    /*
      สถานะจริงที่เกิดได้: กล่องแจ้งข้อความล้วน ๆ · ถ้าไม่มีอะไรให้โฟกัส
      คอมโพเนนต์ต้องโฟกัสตัวกล่องเอง ไม่งั้นคนที่ใช้คีย์บอร์ดยังยืนอยู่หลังฉากดำ
      แล้วกด Tab วิ่งไปในหน้าที่มองไม่เห็น

      (ในกล่องจริงยังมีปุ่มปิดอยู่เสมอ — story นี้จึงพิสูจน์ว่าปุ่มปิด
      ทำหน้าที่เป็นจุดโฟกัสแรกได้จริง)
    */
    <Always title="บันทึกเรียบร้อย">
      <p style={{ margin: 0, lineHeight: 1.6 }}>ระบบบันทึกการเปลี่ยนแปลงของคุณแล้ว</p>
    </Always>
  ),
};

export const Interactive: Story = {
  name: 'Modal · กดเปิด/ปิดจริง',
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button
          variant="primary"
          onClick={() => {
            setOpen(true);
          }}
        >
          เปิดกล่อง
        </Button>
        <Modal
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          title="ลองกด Escape หรือคลิกฉากหลัง"
          lead="ปิดแล้วโฟกัสต้องกลับมาที่ปุ่มเปิด ไม่ใช่เด้งไปต้นหน้า"
        >
          <div style={{ display: 'flex', gap: 12 }}>
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false);
              }}
            >
              ตกลง
            </Button>
            <LinkButton
              onClick={() => {
                setOpen(false);
              }}
            >
              ยกเลิก
            </LinkButton>
          </div>
        </Modal>
      </>
    );
  },
};
