'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from '@itsm/ui';

interface Hit {
  itemKey: string;
  summary: string;
  status: { name: string };
}

/** ที่ที่ไปได้ — ชื่อเป็นภาษาคน ไม่ใช่ชื่อ route */
const PLACES: Array<{ label: string; href: string; hint: string }> = [
  { label: 'คิวงาน', href: '/', hint: 'งานที่ต้องดูวันนี้' },
  { label: 'แจ้งปัญหา', href: '/new', hint: 'เปิดเรื่องใหม่' },
  { label: 'รายการบริการ', href: '/catalog', hint: 'เลือกบริการที่ขอได้' },
  { label: 'รายงาน', href: '/reports', hint: 'ยอดแจ้งเข้า ปิดได้ SLA' },
  { label: 'ร่องรอยการใช้งาน', href: '/admin/audit', hint: 'ใครเปลี่ยนอะไรเมื่อไร' },
];

/**
 * แผงคำสั่ง — Ctrl+K
 *
 * CLAUDE.md §6 บอกว่า "ทุก action ที่ทำวันละเกิน 20 ครั้งต้องมีคีย์ลัด" ·
 * ผู้ดูแลเปิดเรื่อง ค้นหา และย้ายหน้าหลายสิบครั้งต่อวัน แต่ก่อนหน้านี้มีคีย์ลัด
 * แค่ `/` บนหน้าคิวเท่านั้น
 *
 * **ผลการค้นหามาจากเซิร์ฟเวอร์ตามสิทธิ์เสมอ** ไม่ใช่รายการที่หน้าจอเก็บไว้เอง
 * — แผงที่ค้นจากแคชในเบราว์เซอร์จะโชว์เรื่องที่ผู้ใช้เปิดดูไม่ได้แล้ว
 */
export function CommandPalette({ apiBase }: { apiBase: string }): ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  /**
   * ค้นไม่สำเร็จ — ต่างจาก "ค้นแล้วไม่เจอ" คนละเรื่อง
   *
   * รอบแรกไม่มีสถานะนี้ · ตอน OpenSearch ล่ม แผงขึ้นว่า "ไม่พบเรื่องที่ตรงกับ…"
   * ซึ่งอ่านว่าเรื่องนั้นไม่มีอยู่จริง · ผู้ใช้จะเปิดเรื่องซ้ำ หรือสรุปว่าของหาย
   * ทั้งที่มันอยู่ครบ แค่ตัวค้นหาไม่ทำงาน (ADR-005 ไม่มี fallback ไป MySQL
   * โดยตั้งใจ — จึงยิ่งต้องบอกให้ตรง)
   */
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      /*
        Ctrl+K / Cmd+K ทำงานได้แม้กำลังพิมพ์อยู่ในช่องข้อความ — ต่างจาก `/`
        ซึ่งต้องกันไว้ เพราะเป็นอักขระที่คนพิมพ์ลงในหัวข้อจริง ๆ
        (ถ้าไม่กัน เครื่องหมาย `/` จะเด้งออกไปที่ช่องค้นหา ซึ่งอ่านเหมือนคีย์บอร์ดพัง)
      */
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // ล้างคำค้นทุกครั้งที่เปิดใหม่ — แผงที่จำคำค้นเดิมไว้ทำให้กดเปิดแล้วเห็นผลเก่า
  useEffect(() => {
    if (open) {
      setQ('');
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term === '') {
      setHits([]);
      return;
    }
    /*
      หน่วงก่อนยิง และยกเลิกคำขอเก่าจริง ๆ

      ผู้ใช้พิมพ์ทีละตัว · ถ้าปล่อยให้คำขอเก่าตอบทีหลัง รายการจะเป็นผลของคำค้น
      เมื่อกี้ ไม่ใช่ของที่พิมพ์อยู่ — และคนจะเห็นผลกระพริบสลับไปมา
    */
    const ac = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      setFailed(false);
      void (async () => {
        try {
          const res = await fetch(
            `${apiBase}/api/v1/work-items?q=${encodeURIComponent(term)}&limit=8`,
            { credentials: 'include', cache: 'no-store', signal: ac.signal },
          );
          if (res.ok) {
            setHits(((await res.json()) as { rows: Hit[] }).rows);
          } else {
            // ล้มเหลว ≠ ไม่เจอ · เก็บสองสถานะแยกกัน
            setHits([]);
            setFailed(true);
          }
        } catch {
          if (!ac.signal.aborted) {
            setHits([]);
            setFailed(true);
          }
        } finally {
          if (!ac.signal.aborted) setSearching(false);
        }
      })();
    }, 250);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [apiBase, q]);

  function go(href: string): void {
    setOpen(false);
    router.push(href);
  }

  const term = q.trim();
  const places = term === '' ? PLACES : PLACES.filter((p) => p.label.includes(term));

  return (
    <Modal
      open={open}
      onClose={() => {
        setOpen(false);
      }}
      title="ไปที่ไหนดี"
      lead="พิมพ์เลขที่เรื่อง คำในหัวข้อ หรือชื่อหน้า · Esc เพื่อปิด"
    >
      <input
        ref={inputRef}
        className="cmd-input"
        value={q}
        placeholder="เช่น SD-1234 หรือ ปริ้นเตอร์"
        aria-label="ค้นหาเรื่องหรือหน้า"
        onChange={(e) => {
          setQ(e.target.value);
        }}
      />

      {places.length === 0 ? null : (
        <>
          <p className="cmd-group">หน้า</p>
          <ul className="cmd-list">
            {places.map((p) => (
              <li key={p.href}>
                <button
                  type="button"
                  className="cmd-item"
                  onClick={() => {
                    go(p.href);
                  }}
                >
                  <span className="cmd-label">{p.label}</span>
                  <span className="cmd-hint">{p.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {term === '' ? null : (
        <>
          <p className="cmd-group">เรื่อง</p>
          {searching ? (
            <p className="cmd-empty">กำลังค้น…</p>
          ) : failed ? (
            /*
              **ค้นไม่ได้ ต้องไม่อ่านว่าไม่มี** — เจอตอน QA จริง: OpenSearch ล่ม
              แล้วแผงขึ้นว่า "ไม่พบเรื่องที่ตรงกับ SD-1" ทั้งที่เรื่องนั้นอยู่ครบ
              ผู้ใช้ที่เชื่อข้อความนั้นจะเปิดเรื่องซ้ำ หรือสรุปว่าของหาย
            */
            <p className="cmd-empty" role="alert">
              ค้นหาไม่ได้ตอนนี้ — ลองใหม่อีกครั้ง หรือเปิดจากหน้าคิว
            </p>
          ) : hits.length === 0 ? (
            /*
              "ไม่พบ" ต้องต่างจาก "ยังไม่ได้พิมพ์" — ข้อความเดียวกันทำให้ผู้ใช้
              ไม่รู้ว่าระบบค้นแล้วหรือยังไม่ได้เริ่ม แล้วก็นั่งรอต่อไป
            */
            <p className="cmd-empty">ไม่พบเรื่องที่ตรงกับ “{term}”</p>
          ) : (
            <ul className="cmd-list">
              {hits.map((h) => (
                <li key={h.itemKey}>
                  <button
                    type="button"
                    className="cmd-item"
                    onClick={() => {
                      go(`/browse/${h.itemKey}`);
                    }}
                  >
                    <span className="cmd-key">{h.itemKey}</span>
                    <span className="cmd-label">{h.summary}</span>
                    <span className="cmd-hint">{h.status.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}
