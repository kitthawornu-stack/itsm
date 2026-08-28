import type { ReactNode } from 'react';

import { Alert, EmptyState, PageHeader } from '@itsm/ui';

import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Item {
  id: string;
  name: string;
  description: string | null;
  projectKey: string;
  issueTypeName: string;
}

interface Group {
  id: string;
  name: string;
  items: Item[];
}

/**
 * หน้ารายการบริการ
 *
 * ผู้แจ้งเลือกจากสิ่งที่อ่านแล้วรู้ว่าใช่ แทนการพิมพ์อิสระแล้วให้ทีมมาเดาทีหลัง
 *
 * **ทางพิมพ์อิสระอยู่ท้ายหน้าเสมอ ไม่ใช่ซ่อนไว้** — รายการบริการไม่มีวัน
 * ครอบคลุมทุกเรื่อง ถ้าไม่มีทางออก คนจะเลือกอันที่ใกล้เคียงที่สุดแล้วเขียน
 * อย่างอื่นลงไป ซึ่งแย่กว่าไม่มีหมวดหมู่เลย เพราะข้อมูลจะดูน่าเชื่อทั้งที่ผิด
 */
export default async function CatalogPage(): Promise<ReactNode> {
  let groups: Group[] | null = null;
  try {
    const res = await apiFetch('/api/v1/catalog');
    if (res.ok) groups = ((await res.json()) as { groups: Group[] }).groups;
  } catch {
    groups = null;
  }

  if (groups === null) {
    return (
      <section className="page">
        <PageHeader title="แจ้งเรื่อง" />
        <Alert tone="error" title="เชื่อมต่อระบบไม่ได้">
          ตอนนี้ยังโหลดรายการบริการไม่ได้ — แจ้งแบบพิมพ์เองได้ที่{' '}
          <a href="/new">หน้าแจ้งปัญหา</a>
        </Alert>
      </section>
    );
  }

  return (
    <section className="page">
      <PageHeader
        title="แจ้งเรื่อง"
        lead="เลือกเรื่องที่ตรงกับสิ่งที่ต้องการ ระบบจะส่งให้ทีมที่รับผิดชอบโดยตรง"
      />

      {groups.length === 0 ? (
        <EmptyState
          title="ยังไม่มีรายการบริการ"
          body="ผู้ดูแลระบบยังไม่ได้ตั้งรายการไว้ — ระหว่างนี้แจ้งแบบพิมพ์เองได้เลย"
        />
      ) : (
        groups.map((g) => (
          <section key={g.id} className="cat-group">
            <h2 className="cat-group-title">{g.name}</h2>
            <ul className="cat-list">
              {g.items.map((i) => (
                <li key={i.id}>
                  <a className="cat-card" href={`/new?service=${i.id}`}>
                    <b className="cat-card-name">{i.name}</b>
                    {i.description === null ? null : (
                      <span className="cat-card-desc">{i.description}</span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {/* ทางออกอยู่ท้ายหน้าเสมอ — ไม่ใช่ลิงก์เล็ก ๆ ที่ต้องตามหา */}
      <div className="cat-escape">
        <b>ไม่พบสิ่งที่ต้องการ?</b>
        <p>
          เล่ามาเป็นคำพูดของคุณเองได้เลย ทีมไอทีจะช่วยจัดหมวดให้เอง —{' '}
          <a href="/new">แจ้งแบบพิมพ์เอง</a>
        </p>
      </div>
    </section>
  );
}
