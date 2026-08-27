'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Checkbox, Input, LinkButton } from '@itsm/ui';

interface FilterRow {
  id: string;
  name: string;
  hql: string;
  isShared: boolean;
  owner: string;
  isMine: boolean;
}

/**
 * ช่องกรอก HQL และตัวกรองที่บันทึกไว้
 *
 * คิวรีอยู่ใน URL ไม่ใช่ใน state ของคอมโพเนนต์ — มุมมองของคิวคือสถานะของหน้า
 * ต้องบุ๊กมาร์กได้ ส่งลิงก์ให้เพื่อนได้ และกดย้อนกลับได้ (แบบเดียวกับแท็บมุมมอง)
 *
 * **ตัวกรองที่แชร์ทำงานด้วยขอบเขตของคนที่กด ไม่ใช่ของเจ้าของ** — ที่นี่ส่งแค่
 * ข้อความคิวรีไปกับ URL ขอบเขตถูกประกอบฝั่งเซิร์ฟเวอร์ทุกครั้งที่รัน
 */
/** คำต่อท้ายบอกเจ้าของใน tooltip — ขึ้นบรรทัดใหม่ให้คิวรียาว ๆ อ่านออก */
const OWNER_SUFFIX = (owner: string): string => `
— ของ ${owner}`;

export function HqlBar({
  apiBase,
  value,
  error,
}: {
  apiBase: string;
  value: string;
  error?: string | undefined;
}): ReactNode {
  const router = useRouter();
  const [text, setText] = useState(value);
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * `/` โฟกัสช่องคิวรี · `Escape` คืนโฟกัสให้หน้าจอ
   *
   * Agent เปิดหน้านี้ค้างทั้งวันและค้นซ้ำหลายสิบครั้ง — การต้องเอื้อมไปหาเมาส์
   * ทุกครั้งคือภาษีที่จ่ายทั้งวัน (CLAUDE.md §6: เกินวันละ 20 ครั้งต้องมีคีย์ลัด)
   *
   * **ต้องไม่ขโมยคีย์ตอนกำลังพิมพ์อยู่ในช่องอื่น** — ไม่งั้นเครื่องหมาย `/`
   * ที่พิมพ์ลงหัวข้อจะเด้งออกมาที่ช่องค้นหาแทน ซึ่งอ่านเหมือนคีย์บอร์ดพัง
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target;
      const inField =
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === '/' && !inField && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        boxRef.current?.querySelector('input')?.focus();
        return;
      }
      if (e.key === 'Escape' && inField && boxRef.current?.contains(el)) {
        el.blur();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/filters`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (res.ok) setFilters(((await res.json()) as { rows: FilterRow[] }).rows);
    } catch {
      // โหลดรายการไม่ได้ไม่ควรทำให้ช่องกรอกใช้ไม่ได้ — คิวรีสด ๆ ยังพิมพ์ได้
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  function run(hql: string): void {
    const url = hql.trim() === '' ? '/' : `/?hql=${encodeURIComponent(hql.trim())}`;
    router.push(url);
  }

  async function save(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/filters`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, hql: text, isShared: shared }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setSaveError(d.message ?? `บันทึกไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setNotice(`บันทึก "${name}" แล้ว`);
      setName('');
      setOpen(false);
      await load();
    } catch {
      setSaveError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setSaving(false);
    }
  }

  /**
   * ลบตัวกรองของตัวเอง
   *
   * สร้างได้จากหน้าจอแต่ลบไม่ได้ คือทางตัน — รายการจะบวมขึ้นเรื่อย ๆ
   * และคนที่พิมพ์ชื่อผิดครั้งเดียวต้องอยู่กับมันตลอดไป
   *
   * ถามยืนยันก่อน เพราะปุ่มลบอยู่ติดกับปุ่มที่ใช้ทุกวัน · เซิร์ฟเวอร์ปฏิเสธเอง
   * อยู่แล้วถ้าไม่ใช่เจ้าของ — ปุ่มนี้แค่ไม่ให้เห็นปุ่มที่กดแล้วได้ 403
   */
  async function remove(f: FilterRow): Promise<void> {
    if (!window.confirm(`ลบตัวกรอง "${f.name}" ?`)) return;
    setSaveError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/filters/${f.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setSaveError(d.message ?? `ลบไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setNotice(`ลบ "${f.name}" แล้ว`);
      await load();
      // ลบตัวที่กำลังเปิดอยู่ หน้าจอต้องไม่ค้างกับคิวรีที่ไม่มีชื่อแล้ว
      if (f.hql === value) run('');
    } catch {
      setSaveError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    }
  }

  return (
    <div className="hql" ref={boxRef}>
      <form
        className="hql-row"
        onSubmit={(e) => {
          e.preventDefault();
          run(text);
        }}
      >
        <Input
          id="hql-input"
          value={text}
          onChange={setText}
          placeholder="เช่น  status = New AND priority IN (1, 2)   ·   กด / เพื่อมาที่นี่"
          maxLength={2000}
        />
        <Button variant="primary" type="submit">
          ค้นหา
        </Button>
        {text.trim() === '' ? null : (
          <LinkButton
            onClick={() => {
              setOpen((v) => !v);
            }}
          >
            บันทึกเป็นตัวกรอง
          </LinkButton>
        )}
        {value === '' ? null : (
          <LinkButton
            onClick={() => {
              setText('');
              run('');
            }}
          >
            ล้าง
          </LinkButton>
        )}
      </form>

      {/*
        ข้อผิดพลาดของภาษาแสดงข้างช่องกรอก ไม่ใช่หน้าจอ error เต็มจอ
        คนกำลังพิมพ์อยู่ การพิมพ์ยังไม่จบไม่ใช่คำขอที่ผิด
      */}
      {error === undefined ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}
      {saveError === null ? null : (
        <Alert tone="error" inline>
          {saveError}
        </Alert>
      )}
      {notice === null ? null : (
        <Alert tone="success" inline>
          {notice}
        </Alert>
      )}

      {open ? (
        <form
          className="hql-save"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input id="hql-name" value={name} onChange={setName} placeholder="ตั้งชื่อตัวกรอง" maxLength={128} />
          <Checkbox checked={shared} onChange={setShared}>
            ให้คนอื่นเห็นด้วย
          </Checkbox>
          <Button variant="primary" type="submit" disabled={saving || name.trim() === ''}>
            บันทึก
          </Button>
        </form>
      ) : null}

      {filters.length === 0 ? null : (
        <nav className="hql-saved" aria-label="ตัวกรองที่บันทึกไว้">
          {filters.map((f) => (
            <span
              key={f.id}
              className="hql-chip-wrap"
              data-active={f.hql === value ? 'true' : undefined}
            >
              <button
                type="button"
                className="hql-chip"
                // เจ้าของอ่านออกจากชื่อ ไม่ต้องเดาว่าตัวกรองนี้ของใคร
                title={f.isMine ? f.hql : f.hql + OWNER_SUFFIX(f.owner)}
                onClick={() => {
                  setText(f.hql);
                  run(f.hql);
                }}
              >
                {f.name}
                {f.isMine ? null : <span className="cfg-implied"> · {f.owner}</span>}
              </button>
              {f.isMine ? (
                <button
                  type="button"
                  className="hql-chip-del"
                  aria-label={`ลบตัวกรอง ${f.name}`}
                  title={`ลบตัวกรอง ${f.name}`}
                  onClick={() => {
                    void remove(f);
                  }}
                >
                  ✕
                </button>
              ) : null}
            </span>
          ))}
        </nav>
      )}
    </div>
  );
}
