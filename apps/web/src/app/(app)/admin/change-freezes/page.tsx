import type { ReactNode } from 'react';

import { ChangeFreezeAdmin } from '@/components/change-freeze-admin';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default function ChangeFreezesPage(): ReactNode {
  return (
    <section className="page">
      <h1 className="page-title">ช่วงห้ามเปลี่ยนแปลง</h1>
      <p className="page-sub">
        ช่วงเวลาที่องค์กรตกลงกันว่าจะไม่แตะระบบ — ปิดงบสิ้นปี ช่วงเทศกาล ช่วงที่ไม่มีคนอยู่
        ประจำการ · การตั้งหน้าต่างเวลาดำเนินการที่คาบเกี่ยวช่วงเหล่านี้จะถูกกั้นไว้
        จนกว่าผู้ตั้งจะระบุเหตุผล ซึ่งถูกบันทึกไว้ให้ตรวจย้อนหลังได้
      </p>
      <ChangeFreezeAdmin apiBase={API_BASE} />
    </section>
  );
}
