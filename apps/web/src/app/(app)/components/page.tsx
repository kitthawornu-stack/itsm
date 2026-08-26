'use client';

// หน้านี้เป็น Client Component เพราะสาธิตคอมโพเนนต์ที่รับการโต้ตอบ
// (ส่ง onClick ให้ EmptyState) — หน้าคิวจริงยังเป็น Server Component

import type { ReactNode } from 'react';

import {
  Avatar,
  Button,
  EmptyState,
  LabelChip,
  PriorityIndicator,
  Skeleton,
  SlaBar,
  StatusPill,
  WorkItemCard,
} from '@itsm/ui';

/**
 * คลังคอมโพเนนต์ — ที่สำหรับดูทุกตัวในทุกสถานะพร้อมกัน
 *
 * ⚠️ นี่ **ไม่ใช่** Storybook ซึ่ง CLAUDE.md §6 กำหนดไว้ว่าต้องมี
 * หน้านี้ทำหน้าที่หลักได้อย่างหนึ่งคือ ให้เห็นคอมโพเนนต์ทุกตัวเรนเดอร์จริงในเบราว์เซอร์
 * และตรวจธีมสว่าง/มืดได้ทันทีด้วยปุ่มสลับด้านบน
 *
 * สิ่งที่ยังขาดเทียบกับ Storybook: การแยก story ต่อสถานะ, controls ปรับ props สด,
 * visual regression, และ a11y addon — ยังต้องติดตั้งจริงก่อนจบ Phase 0
 */
export default function ComponentGallery(): ReactNode {
  return (
    <>
      <h1 className="page-title">คลังคอมโพเนนต์</h1>
      <p className="page-lead">
        12 คอมโพเนนต์แกนจาก 48 ตัวในแผน · ทุกตัวอ้าง semantic token เท่านั้น
        สลับธีมด้านบนขวาเพื่อตรวจทั้งสองธีม
      </p>

      <section className="gallery-section">
        <h2>Button</h2>
        <div className="gallery-row">
          <Button variant="primary">บันทึก</Button>
          <Button variant="secondary">ยกเลิก</Button>
          <Button variant="ghost">ดูเพิ่มเติม</Button>
          <Button variant="delivery">สร้างงานใหม่</Button>
          <Button variant="danger">ลบถาวร</Button>
          <Button variant="primary" disabled>
            ปิดใช้งาน
          </Button>
          <Button variant="secondary" size="sm">
            ขนาดเล็ก
          </Button>
        </div>
        <p className="gallery-note">
          ป้ายกำกับภาษาไทยยาวกว่าอังกฤษเฉลี่ย 1.3 เท่า ปุ่มจึงเผื่อระยะในแนวนอนไว้แล้ว
        </p>
      </section>

      <section className="gallery-section">
        <h2>StatusPill</h2>
        <div className="gallery-row">
          <StatusPill label="ยังไม่เริ่ม" category="TODO" />
          <StatusPill label="กำลังดำเนินการ" category="IN_PROGRESS" />
          <StatusPill label="รอลูกค้าตอบ" category="IN_PROGRESS" pausesSla />
          <StatusPill label="เสร็จแล้ว" category="DONE" />
        </div>
        <p className="gallery-note">
          ข้อความเป็นภาษาคน ไม่ใช่ศัพท์ระบบ — &ldquo;กำลังดำเนินการ&rdquo; ไม่ใช่ &ldquo;In
          Progress&rdquo; · สถานะที่หยุดนาฬิกา SLA ใช้สีเตือนเพื่อให้แยกออกจากสถานะที่กำลังเดิน
        </p>
      </section>

      <section className="gallery-section">
        <h2>PriorityIndicator</h2>
        <div className="gallery-row">
          <PriorityIndicator rank={1} label="P1 Critical" />
          <PriorityIndicator rank={2} label="P2 High" />
          <PriorityIndicator rank={3} label="P3 Medium" />
          <PriorityIndicator rank={4} label="P4 Low" />
          <PriorityIndicator rank={5} label="P5 Trivial" />
        </div>
        <p className="gallery-note">
          ความสูงของแท่งเข้ารหัสลำดับซ้ำอีกชั้นนอกเหนือจากสี — เรียงได้ถูกแม้พิมพ์ขาวดำ
          หรือมองด้วยตาที่แยกสีแดงเขียวไม่ออก
        </p>
      </section>

      <section className="gallery-section">
        <h2>SlaBar</h2>
        <div className="gallery-row">
          <SlaBar elapsedRatio={0.25} state="ok" label="เหลือ 6 ชม." />
          <SlaBar elapsedRatio={0.74} state="warning" label="เหลือ 48 นาที" />
          <SlaBar elapsedRatio={0.92} state="critical" label="เหลือ 11 นาที" />
          <SlaBar elapsedRatio={0.4} state="paused" label="⏸ หยุดนาฬิกา" />
        </div>
        <p className="gallery-note">
          แถวที่หยุดนาฬิกาใช้แถบสีกลางพร้อมสัญลักษณ์ ⏸ ไม่ใช่ซ่อนแถบไปเฉย ๆ
          เพราะ Agent ต้องแยก &ldquo;ไม่มี SLA&rdquo; ออกจาก &ldquo;SLA หยุดชั่วคราว&rdquo;
        </p>
      </section>

      <section className="gallery-section">
        <h2>Avatar · LabelChip · Skeleton</h2>
        <div className="gallery-row">
          <Avatar name="ปวีณา สุขสวัสดิ์" tone="service" />
          <Avatar name="สมชาย กิตติพงศ์" tone="delivery" />
          <Avatar name="ยังไม่มีผู้รับผิดชอบ" tone="neutral" />
          <Avatar name="ณัฐพล ธนกิจ" size="lg" />
          <LabelChip>เครือข่าย</LabelChip>
          <LabelChip selected>SLA ใกล้หลุด</LabelChip>
        </div>
        <div className="gallery-row" style={{ width: 320, flexDirection: 'column', alignItems: 'stretch' }}>
          <Skeleton height="16px" />
          <Skeleton width="70%" height="12px" />
          <Skeleton width="45%" height="12px" />
        </div>
        <p className="gallery-note">
          Skeleton มีรูปทรงเหมือนเนื้อหาจริง ไม่ใช่วงกลมหมุน — ผู้ใช้จึงเดาได้ว่ากำลังจะเห็นอะไร
        </p>
      </section>

      <section className="gallery-section">
        <h2>WorkItemCard</h2>
        <div className="board-demo">
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
        <p className="gallery-note">
          การ์ดที่เสร็จแล้วลดความทึบลง เพื่อให้สายตาไปเกาะคอลัมน์ที่ยังต้องทำงาน ·
          การ์ดที่ติดขัดสื่อสารสองชั้น: แถบซ้ายสีวิกฤต และชิปข้อความ
        </p>
      </section>

      <section className="gallery-section">
        <h2>EmptyState</h2>
        <EmptyState
          title="ยังไม่มีงานที่ตรงกับตัวกรองนี้"
          body="ลองล้างตัวกรองเพื่อดูงานทั้งหมด หรือปรับเงื่อนไขให้กว้างขึ้น"
          action={{ label: 'ล้างตัวกรอง', onClick: () => undefined }}
        />
        <p className="gallery-note">
          ทุกสถานะว่างมีทางออกที่กดได้ ไม่ใช่ข้อความอย่างเดียว ·
          สถานะ &ldquo;ยังไม่เคยมีข้อมูล&rdquo; กับ &ldquo;กรองแล้วไม่เจอ&rdquo; ต้องใช้ข้อความคนละแบบ
        </p>
      </section>
    </>
  );
}
