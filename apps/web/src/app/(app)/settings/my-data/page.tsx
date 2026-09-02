import type { ReactNode } from 'react';

import { MyDataPanel } from '@/components/my-data-panel';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function MyDataPage(): ReactNode {
  return (
    <section className="page">
      <h1 className="page-title">ข้อมูลส่วนบุคคลของฉัน</h1>
      <p className="page-sub">
        PDPA ให้สิทธิ์คุณขอสำเนาข้อมูลของตัวเองได้ทุกเมื่อ{' '}
        <strong>โดยไม่ต้องขอผ่านผู้ดูแล</strong> — สิทธิ์ที่ต้องรอให้คนอื่นว่างมาทำให้
        ไม่ใช่สิทธิ์ · ไฟล์ที่ได้มีข้อมูลบัญชี กลุ่มที่คุณอยู่ เรื่องที่คุณแจ้งและรับผิดชอบ
        ความเห็นที่คุณเขียน เวลาที่คุณบันทึก และเซสชันการเข้าใช้งาน
      </p>
      <p className="page-sub">
        <strong>ทุกครั้งที่มีการดึงสำเนาจะถูกบันทึกไว้</strong> ทั้งตอนที่คุณดึงเอง
        และตอนที่ผู้ดูแลดึงให้ — บันทึกนั้นเก็บแค่ว่าใครดึงของใครเมื่อไร
        ไม่ได้เก็บเนื้อข้อมูลซ้ำอีกชุด
      </p>
      <MyDataPanel apiBase={API_BASE} />
    </section>
  );
}
