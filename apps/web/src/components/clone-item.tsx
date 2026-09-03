'use client';

import { useState, type ReactNode } from 'react';
import { Alert, Button, Modal, TextLink } from '@itsm/ui';

interface NotCopied {
  what: string;
  why: string;
}

/**
 * คัดลอกเรื่อง
 *
 * ## ถามก่อนเสมอ และบอกว่าอะไรไม่ติดไปด้วย
 *
 * ปุ่มที่สร้างตั๋วใบใหม่ทันทีที่กด ทำให้คนที่กดพลาดมีตั๋วส่วนเกินในคิว
 * ที่ต้องไปตามปิดเอง · และ **สิ่งที่ไม่ติดไปด้วยคือสิ่งที่คนคาดผิดบ่อยที่สุด**
 * — คนคาดว่าผู้รับผิดชอบและวันครบกำหนดจะติดมา
 *
 * รายการนั้นมาจากเซิร์ฟเวอร์ (`notCopied`) ไม่ใช่พิมพ์ไว้ในหน้าจอ · รายการที่
 * พิมพ์ไว้สองที่จะเพี้ยนจากพฤติกรรมจริงในวันที่มีคนแก้โค้ด
 */
export function CloneItem({ apiBase, itemKey }: { apiBase: string; itemKey: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ itemKey: string } | null>(null);
  const [notCopied, setNotCopied] = useState<NotCopied[]>([]);

  /** คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void` — ผู้เรียกต้องแยกสองอย่างนี้ได้ */
  async function submit(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/v1/work-items/${encodeURIComponent(itemKey)}/clone`,
        { method: 'POST', credentials: 'include' },
      );
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          (data as { message?: string } | null)?.message ??
            `คัดลอกไม่สำเร็จ (HTTP ${String(res.status)})`,
        );
        return false;
      }
      const d = data as { itemKey: string; notCopied?: NotCopied[] };
      setMade({ itemKey: d.itemKey });
      setNotCopied(d.notCopied ?? []);
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setMade(null);
          setError(null);
          setOpen(true);
        }}
      >
        คัดลอก
      </Button>

      <Modal
        open={open}
        title={made === null ? `คัดลอก ${itemKey}` : 'คัดลอกแล้ว'}
        onClose={() => {
          setOpen(false);
        }}
      >
        {made === null ? (
          <div className="clone-body">
            <p>
              จะสร้างเรื่องใหม่ที่มีหัวข้อ รายละเอียด ชนิดงาน ระดับความสำคัญ
              และค่าฟิลด์กำหนดเองเหมือนใบนี้
            </p>
            <p className="clone-note">
              <strong>สิ่งที่ไม่ติดไปด้วย</strong> — สำเนาเริ่มต้นใหม่ทั้งหมด:
            </p>
            <ul className="clone-list">
              {/*
                รายการมาจากเซิร์ฟเวอร์หลังกดแล้วเท่านั้น · ก่อนกดจึงบอกแบบย่อ
                ไม่ใช่พิมพ์รายการเต็มไว้ที่นี่ ซึ่งจะเพี้ยนจากของจริง
              */}
              <li>สถานะ ผลการแก้ไข และผู้รับผิดชอบ</li>
              <li>วันครบกำหนด</li>
              <li>ความเห็น ไฟล์แนบ และประวัติ</li>
            </ul>
            {error === null ? null : (
              <Alert tone="error" inline>
                {error}
              </Alert>
            )}
            <div className="admin-btn-row">
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  void submit();
                }}
              >
                {busy ? 'กำลังคัดลอก…' : 'คัดลอกเลย'}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                }}
              >
                ยกเลิก
              </Button>
            </div>
          </div>
        ) : (
          <div className="clone-body">
            <Alert tone="success" inline>
              สร้าง {made.itemKey} แล้ว
            </Alert>
            <p>
              <TextLink href={`/browse/${encodeURIComponent(made.itemKey)}`}>
                เปิด {made.itemKey}
              </TextLink>
            </p>
            {notCopied.length === 0 ? null : (
              <>
                <p className="clone-note">
                  <strong>สิ่งที่ไม่ได้ติดไปด้วย</strong> — ต้องกรอกเองถ้าต้องการ:
                </p>
                <ul className="clone-list">
                  {notCopied.map((n) => (
                    <li key={n.what}>
                      <strong>{n.what}</strong> — {n.why}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
