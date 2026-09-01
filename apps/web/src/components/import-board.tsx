'use client';

import { useState, type ReactNode } from 'react';
import { Alert, Button, Field, LinkButton, Table, Textarea } from '@itsm/ui';

interface Problem {
  line: number;
  column: string | null;
  message: string;
}

interface Preview {
  problems: Problem[];
  totalRows: number;
  toCreate: number;
  alreadyImported: number;
}

interface Result {
  created: number;
  skipped: number;
  problems: Problem[];
}

const TEMPLATE = [
  'externalKey,summary,status,priority,reporterEmail',
  'OLD-001,เครื่องพิมพ์ชั้น 3 ไม่ยอมพิมพ์,ใหม่,สูง,somchai@company.co.th',
  'OLD-002,"ขอสิทธิ์เข้าโฟลเดอร์ฝ่ายบัญชี, เร่งด่วน",ปิดแล้ว,,malee@company.co.th',
].join('\n');

/**
 * นำเข้าข้อมูลจาก Excel
 *
 * ## ดูตัวอย่างก่อนเสมอ — ปุ่มนำเข้าจริงไม่กดได้จนกว่าจะดูแล้ว
 *
 * ปุ่มเดียวที่ทำทั้งสองอย่างจะทำให้ไฟล์ที่มีปัญหาเข้าไปครึ่งหนึ่งก่อนที่ใคร
 * จะรู้ตัว · **การดูตัวอย่างไม่เขียนอะไรเลย** จึงกดกี่ครั้งก็ได้
 *
 * ## ปัญหาแสดงเป็นตาราง พร้อมเลขบรรทัดและชื่อคอลัมน์
 *
 * "นำเข้าไม่สำเร็จ" บรรทัดเดียวใช้ไม่ได้กับไฟล์สองพันแถว · คนต้องเปิด Excel
 * แล้วกระโดดไปบรรทัดนั้นได้ทันที
 *
 * ## ไม่มีที่อัปโหลดไฟล์ — วางข้อความแทน
 *
 * ตั้งใจ · การอ่านไฟล์ในเบราว์เซอร์ต้องเดารหัสอักขระอีกชั้น ซึ่งเป็นจุดที่
 * ภาษาไทยพังบ่อยที่สุด · การให้คนเปิดไฟล์แล้ววางข้อความ ทำให้เบราว์เซอร์
 * ถอดรหัสให้แล้วหนึ่งครั้ง และเซิร์ฟเวอร์ตรวจอักขระเสียได้ตรง ๆ
 */
export function ImportBoard({
  apiBase,
  projectKey,
}: {
  apiBase: string;
  projectKey: string;
}): ReactNode {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** คืนว่าสำเร็จหรือไม่ ไม่ใช่ `void` — ผู้เรียกต้องแยกสองอย่างนี้ได้ */
  async function post(path: string): Promise<unknown> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/projects/${projectKey}/import${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          (data as { message?: string } | null)?.message ??
            `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`,
        );
        return null;
      }
      return data;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const problems = result?.problems ?? preview?.problems ?? [];
  const canRun = preview !== null && preview.problems.length === 0 && preview.toCreate > 0;

  return (
    <div className="imp">
      <Field
        label="เนื้อหาไฟล์ CSV"
        htmlFor="imp-csv"
        required
        hint="เปิดไฟล์ที่ Excel บันทึกเป็น “CSV UTF-8” แล้วคัดลอกมาวางทั้งไฟล์ รวมบรรทัดหัวตาราง"
      >
        <Textarea
          id="imp-csv"
          value={csv}
          onChange={(v) => {
            setCsv(v);
            // ไฟล์เปลี่ยน = ตัวอย่างเดิมใช้ไม่ได้แล้ว · ต้องกดดูใหม่ก่อนนำเข้า
            setPreview(null);
            setResult(null);
          }}
          rows={10}
        />
      </Field>

      <div className="admin-btn-row">
        <Button
          disabled={busy || csv.trim() === ''}
          onClick={() => {
            void post('/preview').then((d) => {
              if (d !== null) setPreview(d as Preview);
            });
          }}
        >
          ตรวจไฟล์ก่อน
        </Button>
        <Button
          variant="primary"
          disabled={busy || !canRun}
          onClick={() => {
            void post('').then((d) => {
              if (d !== null) setResult(d as Result);
            });
          }}
        >
          นำเข้าจริง
        </Button>
        <LinkButton
          disabled={busy}
          onClick={() => {
            setCsv(TEMPLATE);
            setPreview(null);
            setResult(null);
          }}
        >
          ใส่ตัวอย่างหัวตาราง
        </LinkButton>
      </div>

      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}

      {result !== null && result.problems.length === 0 ? (
        <Alert tone="success" inline>
          นำเข้าแล้ว {result.created} แถว
          {result.skipped > 0 ? ` · ข้าม ${result.skipped} แถวที่เคยนำเข้าไปแล้ว` : ''}
        </Alert>
      ) : null}

      {preview === null || result !== null ? null : preview.problems.length === 0 ? (
        <Alert tone="success" inline>
          ตรวจแล้วไม่พบปัญหา — จะสร้างใหม่ {preview.toCreate} แถว
          {preview.alreadyImported > 0
            ? ` · ข้าม ${preview.alreadyImported} แถวที่เคยนำเข้าไปแล้ว`
            : ''}
          {preview.toCreate === 0 ? ' · ไม่มีอะไรใหม่ให้นำเข้า' : ''}
        </Alert>
      ) : (
        <Alert tone="warning" inline>
          {/*
            บอกทั้งจำนวนปัญหาและจำนวนแถวทั้งไฟล์ — "มี 3 ปัญหา" เฉย ๆ
            ไม่ช่วยให้คนประเมินว่าต้องแก้เยอะแค่ไหน
          */}
          พบ {preview.problems.length} ปัญหาในไฟล์ {preview.totalRows} แถว —
          <strong> ยังไม่มีอะไรถูกนำเข้า</strong> แก้ไฟล์แล้วตรวจใหม่
        </Alert>
      )}

      {problems.length === 0 ? null : (
        <Table columns={['บรรทัด', 'คอลัมน์', 'ปัญหา']} rowCount={problems.length}>
          {problems.map((p) => (
            <tr key={`${String(p.line)}-${p.column ?? ''}-${p.message}`}>
              <td className="imp-line">{p.line}</td>
              <td>{p.column ?? '—'}</td>
              <td className="imp-msg">{p.message}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
