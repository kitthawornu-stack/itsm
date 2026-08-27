import type { ReactNode } from 'react';

import { CalendarAdmin } from '@/components/calendar-admin';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function CalendarsPage(): ReactNode {
  return (
    <section className="page">
      <h1 className="page-title">ปฏิทินวันหยุด</h1>
      <p className="page-sub">
        SLA นับเฉพาะเวลาทำการ วันหยุดที่ขาดไปหนึ่งวันจึงทำให้ทุกเรื่องที่คร่อมวันนั้นถูกนับว่าเกินเวลา
        ทั้งที่ทีมไม่ได้มาทำงาน — วันสำคัญทางพุทธศาสนาเดินตามจันทรคติและ ครม. ประกาศวันหยุดเพิ่มได้ทุกเมื่อ
        จึงไม่มีสูตรคำนวณ ต้องอ่านประกาศจริงทุกปี
      </p>
      <CalendarAdmin apiBase={API_BASE} />
    </section>
  );
}
