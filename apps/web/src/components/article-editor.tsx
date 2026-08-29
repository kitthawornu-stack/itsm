'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Alert, Button, LinkButton, Textarea } from '@itsm/ui';

const TITLE_MAX = 500;
const BODY_MAX = 20_000;

/**
 * เขียนและแก้บทความ
 *
 * **ปุ่มเผยแพร่แยกจากปุ่มบันทึก** — คนที่กดบันทึกระหว่างเขียนไม่ได้ตั้งใจ
 * ให้ลูกค้าเห็นฉบับที่ยังไม่เสร็จ · ช่องติ๊กที่ต้องกดพร้อมบันทึกทำให้
 * การเผยแพร่เกิดขึ้นโดยไม่ได้ตั้งใจ อย่างน้อยหนึ่งครั้งต่อคน
 */
export function ArticleEditor({
  apiBase,
  article,
}: {
  apiBase: string;
  article?: { id: string; title: string; body: string; isPublished: boolean };
}): ReactNode {
  const router = useRouter();
  const [title, setTitle] = useState(article?.title ?? '');
  const [body, setBody] = useState(article?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNew = article === undefined;

  async function save(publish?: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { title, body };
      if (publish !== undefined) payload['isPublished'] = publish;

      const res = await fetch(
        isNew ? `${apiBase}/api/v1/knowledge` : `${apiBase}/api/v1/knowledge/${article.id}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        setError(d.message ?? `บันทึกไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      if (isNew) {
        const d = (await res.json()) as { id: string };
        router.push(`/knowledge/${d.id}`);
      } else {
        router.refresh();
      }
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/knowledge/${article?.id ?? ''}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) {
        setError(`ลบไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      router.push('/knowledge');
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  const empty = title.trim() === '' || body.trim() === '';

  return (
    <div className="art-editor">
      <label className="bulk-field art-title">
        ชื่อบทความ
        <input
          value={title}
          maxLength={TITLE_MAX}
          placeholder="เช่น วิธีรีเซ็ตรหัสผ่านอีเมล"
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
      </label>

      {/*
        `Textarea` ไม่รับ `label` — ใส่ป้ายเองด้วย `<label htmlFor>` แทน
        การเพิ่ม prop เข้า packages/ui เพื่อใช้ที่เดียว ทำให้คอมโพเนนต์กลาง
        โตขึ้นโดยไม่มีที่สองที่ต้องการมัน
      */}
      <label className="art-body-label" htmlFor="art-body">
        เนื้อหา
      </label>
      <Textarea
        id="art-body"
        value={body}
        onChange={setBody}
        rows={16}
        maxLength={BODY_MAX}
        placeholder="เขียนขั้นตอนที่ทำตามได้จริง — คนอ่านคือคนที่กำลังติดปัญหาอยู่"
      />

      {error === null ? null : <Alert tone="error">{error}</Alert>}

      <div className="thread-actions">
        <Button variant="primary" disabled={busy || empty} onClick={() => void save()}>
          {busy ? 'กำลังบันทึก…' : 'บันทึก'}
        </Button>

        {/*
          เผยแพร่/ถอนเผยแพร่เป็นปุ่มของตัวเอง ไม่ใช่ช่องติ๊กที่กดพร้อมบันทึก —
          การเผยแพร่คือการบอกว่า "ฉบับนี้ให้ลูกค้าอ่านได้แล้ว" ซึ่งเป็นการ
          ตัดสินใจคนละอย่างกับการบันทึกงานที่ทำค้างไว้
        */}
        {isNew ? (
          <Button disabled={busy || empty} onClick={() => void save(true)}>
            บันทึกและเผยแพร่
          </Button>
        ) : article.isPublished ? (
          <Button disabled={busy} onClick={() => void save(false)}>
            ถอนออกจากการเผยแพร่
          </Button>
        ) : (
          <Button disabled={busy || empty} onClick={() => void save(true)}>
            เผยแพร่
          </Button>
        )}

        {isNew ? null : (
          <LinkButton tone="danger" disabled={busy} onClick={() => void remove()}>
            ลบบทความ
          </LinkButton>
        )}
      </div>

      {isNew || article.isPublished ? null : (
        <p className="cmd-empty">
          ยังไม่เผยแพร่ — ตอนนี้เห็นเฉพาะทีม ผู้แจ้งค้นไม่เจอและเปิดไม่ได้
        </p>
      )}
    </div>
  );
}
