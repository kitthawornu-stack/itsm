'use client';

import { Table } from '@itsm/ui';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

interface Row {
  permission: string;
  groups: string[];
  impliedBy: string | null;
  impliedGroups: string[];
  enforced: boolean;
}

interface Group {
  id: string;
  name: string;
  memberCount: number;
}

/**
 * ตารางสิทธิ์ที่แก้ได้
 *
 * ⚠️ **แตะระบบสิทธิ์ — ต้องให้ Tech Lead อนุมัติก่อน merge (CLAUDE.md §4)**
 *
 * ช่องติ๊กต่อ (สิทธิ์ × กลุ่ม) ไม่ใช่ฟอร์มแยกหน้า เพราะคำถามที่ผู้ดูแลถือมา
 * คือ "ทำไมคนนี้กดปุ่มนี้ไม่ได้" ซึ่งตอบได้จากการมองตารางทั้งใบพร้อมกัน
 * ไม่ใช่จากการเปิดทีละหน้า
 */
export function PermissionGrid({
  apiBase,
  projectKey,
  rows,
  groups,
  labels,
  editable,
  sharedWith,
}: {
  apiBase: string;
  projectKey: string;
  rows: Row[];
  groups: Group[];
  labels: Record<string, string>;
  editable: boolean;
  sharedWith: string[];
}): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * ค่าที่ผู้ใช้เพิ่งกด ก่อนเซิร์ฟเวอร์ตอบ
   *
   * ช่องติ๊กที่ไม่ขยับจนกว่าจะครบรอบ ทำให้ผู้ใช้กดซ้ำเพราะคิดว่าไม่ติด
   * แต่การแสดงค่าใหม่ค้างไว้ทั้งที่บันทึกไม่สำเร็จ แย่กว่านั้นมาก —
   * สิทธิ์ที่หน้าจอบอกว่าให้แล้วแต่จริง ๆ ไม่ได้ให้ คือกับดักที่ไม่มีใครสังเกต
   *
   * จึงเก็บไว้ชั่วคราวแล้ว **ล้างทิ้งทั้งตอนสำเร็จและตอนล้มเหลว** — สำเร็จก็ให้
   * ค่าจากเซิร์ฟเวอร์เข้ามาแทน ล้มเหลวก็เด้งกลับเป็นค่าจริงพร้อมข้อความบอกเหตุผล
   */
  const [pending, setPending] = useState<Record<string, boolean>>({});

  async function toggle(permission: string, group: Group, granted: boolean): Promise<void> {
    const cell = `${permission}:${group.id}`;
    setBusy(cell);
    setError(null);
    setPending((p) => ({ ...p, [cell]: granted }));
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/projects/${projectKey}/permissions`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ permission, groupId: group.id, granted }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setError(d.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      // โหลดใหม่จากเซิร์ฟเวอร์ — ค่าที่แสดงต้องมาจากฐานข้อมูลเสมอ
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(null);
      // ล้างทั้งสองทาง: สำเร็จ = ค่าจริงตามมาแทน · ล้มเหลว = เด้งกลับค่าเดิม
      setPending((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== cell)));
    }
  }

  return (
    <>
      {error === null ? null : (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {sharedWith.length > 1 ? (
        <p className="admin-error" role="alert">
          {/*
            ชุดสิทธิ์ใบเดียวใช้ร่วมกันหลายโปรเจกต์ได้ · การติ๊กที่นี่เปลี่ยน
            อีกโปรเจกต์ไปด้วย ซึ่งต้องรู้ก่อนกด ไม่ใช่รู้ตอนมีคนมาบ่น
          */}
          ชุดสิทธิ์นี้ใช้ร่วมกับ {sharedWith.filter((k) => k !== projectKey).join(' · ')} —
          การแก้ที่นี่จะเปลี่ยนสิทธิ์ในโปรเจกต์เหล่านั้นด้วย
        </p>
      ) : null}

      {/*
        หัวคอลัมน์ของตารางนี้เป็นไดนามิก (กลุ่มผู้ใช้) จึงส่งเป็น ReactNode
        ไม่ใช่สตริง — `Table` รับได้ทั้งสองแบบด้วยเหตุนี้
      */}
      <Table
        label="ตารางสิทธิ์ตามกลุ่ม"
        columns={[
          'ทำอะไรได้',
          ...groups.map((g) => ({
            label: (
              <>
                {g.name}
                <span className="cfg-implied"> ({g.memberCount})</span>
              </>
            ),
          })),
        ]}
        rowCount={rows.length}
        empty="ยังไม่มีสิทธิ์ในชุดนี้"
      >
        {rows.map((r) => (
          <tr key={r.permission} data-inactive={r.enforced ? undefined : 'true'}>
            <th scope="row" className="grid-perm">
              {labels[r.permission] ?? r.permission}
              {r.enforced ? null : <span className="cfg-implied"> · ยังไม่มีผลบังคับ</span>}
            </th>
            {groups.map((g) => {
              const cell = `${r.permission}:${g.id}`;
              const has = pending[cell] ?? r.groups.includes(g.name);
              const implied = r.impliedGroups.includes(g.name);
              return (
                <td key={g.id} className="grid-cell">
                  <label className="grid-check">
                    <input
                      type="checkbox"
                      checked={has}
                      disabled={!editable || busy !== null}
                      /* ชื่อสำหรับ screen reader ที่ไม่เห็นหัวแถวกับหัวคอลัมน์พร้อมกัน */
                      aria-label={`${labels[r.permission] ?? r.permission} — ${g.name}`}
                      onChange={() => {
                        void toggle(r.permission, g, !has);
                      }}
                    />
                    {/*
                          สิทธิ์ที่ได้มาโดยปริยายต้องต่างจากสิทธิ์ที่ให้ตรง ๆ ด้วยตา
                          ไม่งั้นผู้ดูแลจะถอดช่องที่ไม่ได้ติ๊กแล้วงงว่าทำไมยังทำได้อยู่
                        */}
                    {!has && implied ? (
                      <span
                        className="grid-implied"
                        title={`ได้จาก${labels[r.impliedBy ?? ''] ?? ''}`}
                      >
                        ●
                      </span>
                    ) : null}
                    {busy === cell ? <span className="cfg-implied">…</span> : null}
                  </label>
                </td>
              );
            })}
          </tr>
        ))}
      </Table>
    </>
  );
}
