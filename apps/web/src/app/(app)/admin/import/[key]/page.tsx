import type { ReactNode } from 'react';

import { ExportPanel } from '@/components/export-panel';
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
      <h1 className="page-title">นำเข้าและส่งออกข้อมูล · {key}</h1>
      <p className="page-sub">
        ย้ายเรื่องเก่าจากไฟล์ Excel เข้ามาในระบบ · <strong>ตรวจไฟล์ก่อนเสมอ</strong> —
        การนำเข้าเป็นแบบทั้งไฟล์หรือไม่เอาเลย มีปัญหาแม้ข้อเดียวก็ไม่เขียนอะไร
        เพราะการนำเข้าครึ่งไฟล์ทำให้ไม่มีใครบอกได้ว่าแถวไหนเข้าไปแล้ว ·
        <strong>นำเข้าไฟล์เดิมซ้ำไม่สร้างซ้ำ</strong> ระบบจำรหัสของเดิมไว้
      </p>
      <ImportBoard apiBase={API_BASE} projectKey={key} />

      <h2 className="section-title">ส่งออกข้อมูล</h2>
      <p className="page-sub">
        ดาวน์โหลดงานทั้งโปรเจกต์เป็นไฟล์ CSV ที่เปิดด้วย Excel ได้ทันที ·{' '}
        <strong>ไฟล์ที่ได้ นำเข้ากลับด้วยช่องข้างบนได้เลย</strong> —
        คอลัมน์ตรงกันทุกช่อง จึงใช้ย้ายข้อมูลระหว่างโปรเจกต์หรือเก็บสำรองไว้เองได้ ·
        การส่งออกถูกบันทึกไว้ว่าใครดึงเมื่อไร
      </p>
      <ExportPanel apiBase={API_BASE} projectKey={key} />
    </section>
  );
}
