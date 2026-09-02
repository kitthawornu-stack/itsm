import type { ReactNode } from 'react';

import { RetentionBoard } from '@/components/retention-board';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function RetentionPage(): ReactNode {
  return (
    <section className="page">
      <h1 className="page-title">ระยะเวลาเก็บข้อมูล</h1>
      <p className="page-sub">
        PDPA กำหนดว่าข้อมูลส่วนบุคคลต้องไม่ถูกเก็บนานเกินความจำเป็น ·{' '}
        <strong>ยังไม่ได้ตั้ง แปลว่าเก็บตลอดไป</strong> — ไม่มีอะไรถูกลบจนกว่าจะตั้งเอง ·
        แต่ละชนิดมีจำนวนวันขั้นต่ำที่ต่างกัน และเหตุผลของขั้นต่ำนั้นเขียนอยู่ในตาราง
        เพราะบางอย่างเป็นสิ่งเดียวที่ใช้กู้ข้อมูลคืนได้เมื่อเกิดความผิดพลาด
      </p>
      <RetentionBoard apiBase={API_BASE} />
    </section>
  );
}
