'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, LinkButton, TextLink } from '@itsm/ui';

interface Row {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploader: string;
  createdAt: string;
  canDelete: boolean;
}

/** ขนาดไฟล์เป็นภาษาคน — ไบต์ดิบไม่ได้บอกอะไรกับใครเลย */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} ไบต์`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function whenThai(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}

/**
 * ไฟล์แนบของเรื่อง
 *
 * ## API มีมาตั้งแต่ต้น แต่ไม่เคยมีหน้าจอ
 *
 * `POST` `GET` และ `download` เขียนเสร็จและมีสิทธิ์คุมครบตั้งแต่ Phase 1
 * แต่ **ไม่มีปุ่มไหนในเว็บที่เรียกมันเลยสักปุ่ม** · เอกสารสถานะจึงบอกว่า
 * "ไฟล์แนบ ✔" มาตลอด ทั้งที่คนแจ้งปัญหาส่งภาพหน้าจอไม่ได้จริง ๆ
 * — กลไกที่ไม่มีอะไรเรียกใช้ ป้องกันหรือให้ประโยชน์อะไรไม่ได้เลย
 *
 * ## ปุ่มลบขึ้นตาม `canDelete` ที่เซิร์ฟเวอร์ส่งมา
 *
 * ไม่ได้คำนวณเองในหน้าจอ เพราะกติกา (เจ้าของ หรือมี `MANAGE_ATTACHMENT`)
 * อยู่ฝั่งเซิร์ฟเวอร์ · หน้าจอที่คิดเองจะเพี้ยนจากของจริงในวันที่กติกาเปลี่ยน
 * · และการซ่อนปุ่มไม่ใช่การป้องกัน — เซิร์ฟเวอร์ปฏิเสธเองทุกครั้ง
 */
export function AttachmentPanel({
  apiBase,
  itemKey,
}: {
  apiBase: string;
  itemKey: string;
}): ReactNode {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/attachments`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!r.ok) {
        setRows([]);
        return;
      }
      setRows(((await r.json()) as { rows: Row[] }).rows);
    } catch {
      setRows([]);
    }
  }, [apiBase, itemKey]);

  useEffect(() => {
    void load();
  }, [load]);

  /** คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void` — ผู้เรียกต้องแยกสองอย่างนี้ได้ */
  async function upload(file: File): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/attachments`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(d?.message ?? `แนบไฟล์ไม่สำเร็จ (HTTP ${String(res.status)})`);
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

  async function remove(id: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/attachments/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(d?.message ?? `ลบไฟล์ไม่สำเร็จ (HTTP ${String(res.status)})`);
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

  if (rows === null) return null;

  return (
    <section className="atp" aria-label="ไฟล์แนบ">
      <h2 className="detail-section-title">ไฟล์แนบ</h2>

      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}

      {rows.length === 0 ? (
        <p className="atp-quiet">ยังไม่มีไฟล์แนบ — ภาพหน้าจอช่วยให้อธิบายปัญหาได้เร็วกว่าพิมพ์</p>
      ) : (
        <ul className="atp-list">
          {rows.map((r) => (
            <li key={r.id}>
              <TextLink
                href={`${apiBase}/api/v1/work-items/attachments/${r.id}/download`}
                ariaLabel={`ดาวน์โหลด ${r.filename}`}
              >
                {r.filename}
              </TextLink>
              <span className="atp-meta">
                {humanSize(r.sizeBytes)} · {r.uploader} · {whenThai(r.createdAt)}
              </span>
              {/* ทุกบรรทัดมีปุ่มข้อความเดียวกัน — ต้องมีชื่อแยกให้ screen reader */}
              {!r.canDelete ? null : (
                <LinkButton
                  ariaLabel={`ลบไฟล์ ${r.filename}`}
                  tone="danger"
                  disabled={busy}
                  onClick={() => {
                    void remove(r.id);
                  }}
                >
                  ลบ
                </LinkButton>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="atp-add">
        {/*
          ใช้ `<input type="file">` ของเบราว์เซอร์ตรง ๆ ซ่อนไว้หลังปุ่มของระบบ
          — ปุ่มเลือกไฟล์ที่ประดิษฐ์เองเสียคีย์บอร์ดและตัวเลือกบนมือถือ
        */}
        <input
          ref={fileRef}
          type="file"
          className="atp-file"
          aria-label="เลือกไฟล์ที่จะแนบ"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file === undefined) return;
            void upload(file).then((ok) => {
              // ล้างช่องเมื่อเซิร์ฟเวอร์รับแล้วเท่านั้น — ไฟล์ที่ถูกปฏิเสธ
              // ต้องยังอยู่ในช่อง ไม่ให้คนต้องไปหาใหม่
              if (ok && fileRef.current !== null) fileRef.current.value = '';
            });
          }}
        />
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            fileRef.current?.click();
          }}
        >
          {busy ? 'กำลังแนบ…' : 'แนบไฟล์'}
        </Button>
      </div>
    </section>
  );
}
