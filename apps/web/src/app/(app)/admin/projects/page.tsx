import Link from 'next/link';
import type { ReactNode } from 'react';

import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Row {
  key: string;
  name: string;
  type: string;
  isArchived: boolean;
  notifyGroup: string | null;
  permissionScheme: string | null;
  itemCount: number;
}

const TYPE_LABEL: Record<string, string> = {
  SERVICE_DESK: 'ศูนย์บริการ',
  SOFTWARE: 'พัฒนาซอฟต์แวร์',
  BUSINESS: 'งานทั่วไป',
};

export default async function ProjectsPage(): Promise<ReactNode> {
  const res = await apiFetch('/api/v1/admin/projects', { cache: 'no-store' });
  if (!res.ok) {
    return (
      <section className="page">
        <h1 className="page-title">โปรเจกต์</h1>
        <p className="admin-error" role="alert">
          {res.status === 403
            ? 'ต้องเป็นผู้ดูแลระบบจึงจะดูส่วนนี้ได้'
            : `โหลดรายการไม่สำเร็จ (HTTP ${String(res.status)})`}
        </p>
      </section>
    );
  }
  const { rows } = (await res.json()) as { rows: Row[] };

  return (
    <section className="page">
      <h1 className="page-title">โปรเจกต์</h1>
      <p className="page-sub">
        พฤติกรรมของระบบเกือบทั้งหมดมาจากการตั้งค่าของโปรเจกต์ ไม่ได้มาจากโค้ด —
        สถานะ ปุ่ม เงื่อนไข และสิทธิ์ ทั้งหมดอยู่ในนี้
      </p>

      {rows.length === 0 ? (
        <p className="admin-empty">ยังไม่มีโปรเจกต์ — สร้างได้จาก bootstrap ตอนติดตั้งเท่านั้นในตอนนี้</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">คีย์</th>
                <th scope="col">ชื่อ</th>
                <th scope="col">ประเภท</th>
                <th scope="col">เรื่อง</th>
                <th scope="col">ชุดสิทธิ์</th>
                <th scope="col">กลุ่มรับแจ้งเตือน</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.key} data-inactive={p.isArchived ? 'true' : undefined}>
                  <td>
                    <Link href={`/admin/projects/${p.key}`}>{p.key}</Link>
                  </td>
                  <td>{p.name}</td>
                  <td>{TYPE_LABEL[p.type] ?? p.type}</td>
                  <td className="admin-when">{p.itemCount.toLocaleString('th-TH')}</td>
                  {/*
                    โปรเจกต์ที่ไม่มีชุดสิทธิ์ = ไม่มีใครทำอะไรได้เลย ไม่ใช่ทุกคนทำได้
                    ต้องอ่านออกทันทีจากรายการ ไม่ใช่ต้องกดเข้าไปดูถึงจะรู้
                  */}
                  <td>{p.permissionScheme ?? 'ยังไม่ได้ผูก — ไม่มีใครเข้าถึงได้'}</td>
                  <td>{p.notifyGroup ?? 'ยังไม่ได้ตั้ง — แจ้งเตือนระดับทีมจะไปไม่ถึงใคร'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
