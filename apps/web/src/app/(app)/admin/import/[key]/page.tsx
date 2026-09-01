import type { ReactNode } from 'react';

import { ImportBoard } from '@/components/import-board';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function ImportPage({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<ReactNode> {
  const { key } = await params;
  return (
    <section className="page">
      <h1 className="page-title">นำเข้าจาก Excel · {key}</h1>
      <p className="page-sub">
        ย้ายเรื่องเก่าจากไฟล์ Excel เข้ามาในระบบ · <strong>ตรวจไฟล์ก่อนเสมอ</strong> —
        การนำเข้าเป็นแบบทั้งไฟล์หรือไม่เอาเลย มีปัญหาแม้ข้อเดียวก็ไม่เขียนอะไร
        เพราะการนำเข้าครึ่งไฟล์ทำให้ไม่มีใครบอกได้ว่าแถวไหนเข้าไปแล้ว ·
        <strong>นำเข้าไฟล์เดิมซ้ำไม่สร้างซ้ำ</strong> ระบบจำรหัสของเดิมไว้
      </p>
      <ImportBoard apiBase={API_BASE} projectKey={key} />
    </section>
  );
}
