'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Field, Input, LinkButton, TextLink, Timestamp } from '@itsm/ui';

interface VersionRow {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  releaseDate: string | null;
  releasedAt: string | null;
  archived: boolean;
  state: string;
  stateLabel: string;
  total: number;
  done: number;
}

interface ReleaseNote {
  name: string;
  releasedAt: string | null;
  groups: Array<{ issueType: string; items: Array<{ itemKey: string; summary: string }> }>;
  finished: number;
  unfinished: number;
}

/**
 * รุ่นของโปรเจกต์ (Version / Release)
 *
 * ## ตัวเลข "เสร็จ / ทั้งหมด" อยู่ติดกับปุ่มปล่อยเสมอ
 *
 * คำถามเดียวที่คนกดปุ่มปล่อยต้องตอบคือ "ยังมีงานค้างไหม" · ถ้าตัวเลขอยู่คนละ
 * ที่กับปุ่ม คนจะกดก่อนแล้วค่อยอ่าน error — ซึ่งใช้ได้ แต่ทำให้ทุกครั้งที่กด
 * เป็นการลองผิด
 *
 * ## บันทึกการปล่อยเปิดดูได้ก่อนปล่อย
 *
 * เป็นตัวอย่างว่าจะได้อะไร · **บอกจำนวนที่ยังไม่เสร็จเสมอ** แม้จะไม่ลงรายการ
 * — บันทึกที่ตัดงานค้างทิ้งเงียบ ๆ อ่านเหมือน "นี่คือทั้งหมดที่อยู่ในรุ่นนี้"
 *
 * ## ปุ่มที่กดแล้ว 403 ก็ยังต้องขึ้น
 *
 * ตรงข้ามกับหน้าตั้งค่าอื่นที่ซ่อนฟอร์มจากคนที่ไม่มีสิทธิ์ · ที่นี่ทุกคนใน
 * โปรเจกต์เห็นรุ่นได้ และเซิร์ฟเวอร์เป็นคนบอกว่าใครปล่อยได้ · ข้อความปฏิเสธ
 * มาจากเซิร์ฟเวอร์ ไม่ใช่หน้าจอเดาเอง
 */
export function VersionBoard({
  apiBase,
  projectKey,
}: {
  apiBase: string;
  projectKey: string;
}): ReactNode {
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState<ReleaseNote | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/projects/${projectKey}/versions`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setRows([]);
        return;
      }
      setRows(((await res.json()) as { rows: VersionRow[] }).rows);
    } catch {
      setRows([]);
    }
  }, [apiBase, projectKey]);

  useEffect(() => {
    void load();
  }, [load]);

  /** คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void` — ผู้เรียกต้องแยกสองอย่างนี้ได้ */
  async function send(path: string, method: 'POST', body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}${path}`, {
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

  async function openNote(id: string): Promise<void> {
    setError(null);
    setNoteFor(id);
    setNote(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/versions/${id}/release-note`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setError(`อ่านบันทึกการปล่อยไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setNote((await res.json()) as ReleaseNote);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    }
  }

  if (rows === null) return <p className="page-sub">กำลังโหลด…</p>;

  return (
    <div className="ver">
      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}

      <div className="admin-btn-row">
        {adding ? null : (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setAdding(true);
            }}
          >
            + สร้างรุ่นใหม่
          </Button>
        )}
      </div>

      {!adding ? null : (
        <div className="ver-form">
          <Field label="ชื่อรุ่น" htmlFor="ver-name" required hint="เช่น 1.0 หรือ ไตรมาส 2/2569">
            <Input id="ver-name" value={name} onChange={setName} />
          </Field>
          <Field label="คำอธิบาย" htmlFor="ver-desc">
            <Input id="ver-desc" value={description} onChange={setDescription} />
          </Field>
          <Field
            label="วันที่ตั้งใจจะปล่อย"
            htmlFor="ver-date"
            hint="เว้นว่างได้ — รุ่นที่ไม่มีวันนัด จะไม่ถูกนับว่าเลยกำหนด"
          >
            <Input id="ver-date" type="date" value={releaseDate} onChange={setReleaseDate} />
          </Field>
          <div className="admin-btn-row">
            <Button
              variant="primary"
              disabled={busy || name.trim() === ''}
              onClick={() => {
                void send(`/api/v1/projects/${projectKey}/versions`, 'POST', {
                  name,
                  description,
                  // ช่อง `date` ให้วันล้วน — เติมเวลาให้เป็น UTC เที่ยงคืนของวันนั้น
                  releaseDate: releaseDate === '' ? '' : `${releaseDate}T00:00:00.000Z`,
                }).then((ok) => {
                  /*
                    ล้างฟอร์มเมื่อ **เซิร์ฟเวอร์รับแล้ว** เท่านั้น ไม่ใช่เมื่อเรียกเสร็จ
                    — ชื่อซ้ำหรือชื่อว่างถูกปฏิเสธ แล้วสิ่งที่พิมพ์ต้องยังอยู่
                  */
                  if (!ok) return;
                  setAdding(false);
                  setName('');
                  setDescription('');
                  setReleaseDate('');
                });
              }}
            >
              สร้างรุ่น
            </Button>
            <LinkButton
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
            >
              ยกเลิก
            </LinkButton>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="page-sub">ยังไม่มีรุ่นในโปรเจกต์นี้ — สร้างรุ่นแรกเพื่อเริ่มวางแผนการปล่อย</p>
      ) : (
        <ul className="ver-list">
          {rows.map((v) => (
            <li key={v.id} data-state={v.state}>
              <div className="ver-head">
                <b className="ver-name">{v.name}</b>
                <span className="ver-state">{v.stateLabel}</span>
                {/*
                  ตัวเลข "เสร็จ / ทั้งหมด" อยู่ติดกับปุ่มปล่อยเสมอ — เป็นคำถาม
                  เดียวที่คนกดปุ่มต้องตอบ
                */}
                <span className="ver-count">
                  เสร็จ {v.done} จาก {v.total} ใบ
                </span>
              </div>

              {v.description === null ? null : <p className="ver-desc">{v.description}</p>}

              <p className="ver-when">
                {v.releaseDate === null ? (
                  'ยังไม่ได้ตั้งวันปล่อย'
                ) : (
                  <>
                    นัดปล่อย <Timestamp utc={v.releaseDate} precision="date" />
                  </>
                )}
                {v.releasedAt === null ? null : (
                  <>
                    {' · '}ปล่อยจริง <Timestamp utc={v.releasedAt} />
                  </>
                )}
              </p>

              <div className="admin-btn-row">
                {v.releasedAt === null ? (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      void send(`/api/v1/versions/${v.id}/release`, 'POST');
                    }}
                  >
                    ปล่อยรุ่นนี้
                  </Button>
                ) : (
                  <LinkButton
                    disabled={busy}
                    onClick={() => {
                      void send(`/api/v1/versions/${v.id}/reopen`, 'POST');
                    }}
                  >
                    เปิดรุ่นนี้ใหม่
                  </LinkButton>
                )}
                <LinkButton
                  disabled={busy}
                  onClick={() => {
                    void openNote(v.id);
                  }}
                >
                  {v.releasedAt === null ? 'ดูตัวอย่างบันทึกการปล่อย' : 'ดูบันทึกการปล่อย'}
                </LinkButton>
              </div>

              {noteFor !== v.id || note === null ? null : (
                <div className="ver-note">
                  <h3 className="ver-note-title">บันทึกการปล่อย · {note.name}</h3>
                  {note.groups.length === 0 ? (
                    <p className="ver-quiet">ยังไม่มีงานที่เสร็จในรุ่นนี้</p>
                  ) : (
                    note.groups.map((g) => (
                      <div key={g.issueType}>
                        <h4 className="ver-note-group">{g.issueType}</h4>
                        <ul className="ver-note-items">
                          {g.items.map((i) => (
                            <li key={i.itemKey}>
                              <TextLink
                                href={`/browse/${i.itemKey}`}
                                ariaLabel={`เปิด ${i.itemKey} ${i.summary}`}
                              >
                                {i.itemKey}
                              </TextLink>{' '}
                              {i.summary}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                  {/*
                    **บอกจำนวนที่ยังไม่เสร็จเสมอ** แม้จะเป็นศูนย์ · บันทึกที่ตัด
                    งานค้างทิ้งเงียบ ๆ อ่านเหมือน "นี่คือทั้งหมดที่อยู่ในรุ่นนี้"
                  */}
                  <p className="ver-quiet">
                    เสร็จแล้ว {note.finished} ใบ
                    {note.unfinished === 0
                      ? ' · ไม่มีงานค้างในรุ่นนี้'
                      : ` · ยังไม่เสร็จอีก ${note.unfinished} ใบ ซึ่งไม่อยู่ในบันทึกนี้`}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
