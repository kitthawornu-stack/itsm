'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, LinkButton, Select, TextLink } from '@itsm/ui';

interface VersionRow {
  id: string;
  name: string;
  state: string;
  stateLabel: string;
  releasedAt: string | null;
}

/**
 * รุ่นที่งานใบนี้จะออกไปด้วย (Fix Version)
 *
 * ## แผงขึ้นเสมอเมื่อโปรเจกต์มีรุ่น — ไม่ขึ้นเลยเมื่อยังไม่มี
 *
 * ต่างจากแผงความเสี่ยงหรือการทบทวน ซึ่งเป็นเรื่องของ "การเปลี่ยนแปลง"
 * โดยเฉพาะ · การบอกว่างานจะออกรุ่นไหนเป็นคำถามของงานทุกใบในโปรเจกต์ที่
 * วางแผนการปล่อยอยู่ · แต่โปรเจกต์ที่ยังไม่มีรุ่นเลย ไม่มีอะไรให้เลือก
 * แผงจึงเป็นเสียงรบกวนล้วน
 *
 * ## รุ่นที่ปล่อยไปแล้วไม่อยู่ในตัวเลือก แต่ยังแสดงถ้างานอยู่ในนั้น
 *
 * ใส่งานใหม่เข้ารุ่นที่ปล่อยไปแล้วคือการแก้ประวัติ · แต่งานที่อยู่ในนั้นมาก่อน
 * ต้องยังเห็นได้ ไม่งั้นหน้าจอจะบอกว่างานไม่ได้อยู่รุ่นไหนเลย ทั้งที่บันทึก
 * การปล่อยมีชื่อมันอยู่
 *
 * ปุ่มถอดของทุกบรรทัดเขียนว่า "เอาออก" เหมือนกันหมด จึงต้องมี `ariaLabel`
 * ที่ต่างกัน — คนที่ไล่ด้วยคีย์บอร์ดจะได้ยิน "เอาออก เอาออก เอาออก"
 * โดยไม่รู้ว่าอันไหนของอะไร (บทเรียนใน CLAUDE.md)
 */
export function ItemVersionPanel({
  apiBase,
  itemKey,
  projectKey,
}: {
  apiBase: string;
  itemKey: string;
  projectKey: string;
}): ReactNode {
  const [data, setData] = useState<{ inVersions: VersionRow[]; available: VersionRow[] } | null>(
    null,
  );
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/versions`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setData(null);
        return;
      }
      setData((await res.json()) as { inVersions: VersionRow[]; available: VersionRow[] });
    } catch {
      setData(null);
    }
  }, [apiBase, itemKey]);

  useEffect(() => {
    void load();
  }, [load]);

  /** คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void` — ผู้เรียกต้องแยกสองอย่างนี้ได้ */
  async function send(path: string, method: 'POST' | 'DELETE', body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/versions${path}`, {
        method,
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(d?.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return false;
      }
      await load();
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (data === null) return null;
  // โปรเจกต์ที่ยังไม่มีรุ่นเลย — ไม่มีอะไรให้เลือก แผงจึงเป็นเสียงรบกวนล้วน
  if (data.inVersions.length === 0 && data.available.length === 0) return null;

  return (
    <section className="ivp" aria-label="รุ่นที่งานนี้จะออกไปด้วย">
      <h2 className="detail-section-title">จะออกในรุ่น</h2>

      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}

      {data.inVersions.length === 0 ? (
        <p className="ivp-quiet">ยังไม่ได้กำหนดว่างานนี้จะออกในรุ่นไหน</p>
      ) : (
        <ul className="ivp-list">
          {data.inVersions.map((v) => (
            <li key={v.id}>
              <TextLink href={`/versions/${projectKey}`} ariaLabel={`ดูรุ่น ${v.name} ของโปรเจกต์`}>
                {v.name}
              </TextLink>
              <span className="ivp-state">{v.stateLabel}</span>
              <LinkButton
                disabled={busy}
                ariaLabel={`เอางานนี้ออกจากรุ่น ${v.name}`}
                onClick={() => {
                  void send(`/${v.id}`, 'DELETE');
                }}
              >
                เอาออก
              </LinkButton>
            </li>
          ))}
        </ul>
      )}

      {data.available.length === 0 ? null : (
        <div className="ivp-add">
          <Select
            value={picked}
            onChange={setPicked}
            ariaLabel="เลือกรุ่นที่จะใส่งานนี้เข้าไป"
            placeholder="เลือกรุ่น"
            options={data.available.map((v) => ({ value: v.id, label: v.name }))}
          />
          <Button
            disabled={busy || picked === ''}
            onClick={() => {
              void send('', 'POST', { versionId: picked }).then((ok) => {
                // ล้างตัวเลือกเมื่อเซิร์ฟเวอร์รับแล้วเท่านั้น
                if (ok) setPicked('');
              });
            }}
          >
            ใส่เข้ารุ่น
          </Button>
        </div>
      )}
    </section>
  );
}
