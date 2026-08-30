'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Field, LinkButton, Select, TextLink, Timestamp } from '@itsm/ui';

interface Incident {
  itemKey: string;
  summary: string;
  statusCategory: string;
  projectKey: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface TransitionOption {
  name: string;
  eligible: number;
  requiredFields: string[];
}

interface TransitionResult {
  requested: number;
  changed: number;
  failed: number;
  items: Array<{ itemKey: string; outcome: string; reason?: string }>;
}

interface Impact {
  total: number;
  open: number;
  resolved: number;
  projects: Array<{ key: string; count: number }>;
  firstSeen: string | null;
  lastSeen: string | null;
  stillRecurring: boolean;
  spanMs: number;
}

/**
 * จำนวนใบที่แสดงก่อนพับ
 *
 * ปัญหาใบเดียวเป็นสาเหตุของเรื่องได้เป็นร้อยใบ · รายการยาวเป็นร้อยบรรทัด
 * ดันทุกอย่างที่อยู่ใต้มันตกจอ · **แต่ต้องบอกว่าซ่อนไว้กี่ใบ** — การตัดเงียบ ๆ
 * อ่านเหมือน "มีเท่านี้" ซึ่งเป็นคนละเรื่องกับ "แสดงเท่านี้"
 */
const PREVIEW = 8;

function readableSpan(ms: number): string {
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return 'วันเดียว';
  if (days < 60) return `${String(days)} วัน`;
  return `${String(Math.round(days / 30))} เดือน`;
}

/**
 * ผลกระทบของปัญหา
 *
 * ## แผงนี้ไม่ขึ้นเลยเมื่อไม่มีเรื่องที่เกิดจากใบนี้
 *
 * ต่างจากแผงอนุมัติหรือหน้าต่างเวลา ซึ่งเป็นสิ่งที่คน **ทำ** กับเรื่องใดก็ได้ ·
 * ผลกระทบเป็นสิ่งที่ **มี** เฉพาะใบที่ถูกทำเครื่องหมายว่าเป็นสาเหตุ ·
 * หัวข้อว่างเปล่าบนทุกเรื่องคือเสียงรบกวนที่ทำให้หน้ารายละเอียดอ่านยากขึ้น
 *
 * ## "ยังเกิดซ้ำ" เตือน · "หยุดแล้ว" ไม่เตือน
 *
 * ปัญหาที่ไม่มีเรื่องใหม่มาเป็นเดือนไม่ใช่ปัญหาที่ยังกวนอยู่ · การใช้สีเตือน
 * กับทั้งสองสถานะทำให้คนเลิกแยกแยะ แล้วเมินทั้งคู่
 */
export function ProblemImpactPanel({
  apiBase,
  itemKey,
}: {
  apiBase: string;
  itemKey: string;
}): ReactNode {
  const router = useRouter();
  const [data, setData] = useState<{ impact: Impact; incidents: Incident[] } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const [options, setOptions] = useState<TransitionOption[]>([]);
  const [resolutions, setResolutions] = useState<string[]>([]);
  const [transition, setTransition] = useState('');
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransitionResult | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/${itemKey}/problem-impact`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) return;
      setData((await res.json()) as { impact: Impact; incidents: Incident[] });
    } catch {
      // เงียบโดยตั้งใจ — แผงนี้เป็นข้อมูลเสริม ไม่ควรขึ้น error บนหน้าที่อ่านเรื่อง
    }
  }, [apiBase, itemKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const openKeys = (data?.incidents ?? [])
    .filter((i) => i.statusCategory !== 'DONE')
    .map((i) => i.itemKey);

  /**
   * ถามว่าปุ่มไหนกดได้กับชุดนี้บ้าง
   *
   * ใช้ endpoint เดียวกับหน้าคิว — **ปุ่มที่กดแล้วล้มทุกใบคือปุ่มที่ไม่ควรอยู่
   * บนหน้าจอ** และเซิร์ฟเวอร์เป็นคนตอบว่ากดได้กี่ใบ ไม่ใช่หน้าจอเดาเอง
   */
  async function openCloser(): Promise<void> {
    setClosing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/bulk/transitions`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemKeys: openKeys }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(d?.message ?? `อ่านปุ่มที่กดได้ไม่สำเร็จ (HTTP ${String(res.status)})`);
        setOptions([]);
        return;
      }
      const d = (await res.json()) as { options: TransitionOption[]; resolutions: string[] };
      setOptions(d.options);
      setResolutions(d.resolutions);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      setOptions([]);
    }
  }

  const chosen = options.find((o) => o.name === transition);
  const needsResolution = chosen?.requiredFields.includes('resolution') ?? false;

  async function closeAll(): Promise<void> {
    if (chosen === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items/bulk/transition`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemKeys: openKeys,
          transitionName: transition,
          ...(needsResolution && resolution !== '' ? { resolutionName: resolution } : {}),
        }),
      });
      const d = (await res.json()) as TransitionResult & { message?: string };
      if (!res.ok) {
        setError(d.message ?? `เปลี่ยนสถานะไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setResult(d);
      setTransition('');
      setResolution('');
      await load();
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  if (data === null || data.impact.total === 0) return null;

  const { impact, incidents } = data;
  const shown = expanded ? incidents : incidents.slice(0, PREVIEW);
  const hidden = incidents.length - shown.length;

  return (
    <section className="pim" aria-label="ผลกระทบของปัญหานี้">
      <h2 className="detail-section-title">ผลกระทบ</h2>

      {/*
        ตัวเลขอยู่บนสุดเพราะเป็นคำตอบ · รายการอยู่ล่างเพราะเป็นหลักฐาน ·
        คนที่เปิดมาดูต้องได้คำตอบก่อนโดยไม่ต้องนับเอง
      */}
      <dl className="pim-stats">
        <div>
          <dt>ทำให้เกิดเรื่อง</dt>
          <dd>{impact.total} เรื่อง</dd>
        </div>
        <div>
          <dt>ยังค้างอยู่</dt>
          <dd data-open={impact.open > 0 ? 'true' : undefined}>{impact.open} เรื่อง</dd>
        </div>
        <div>
          <dt>แก้ไปแล้ว</dt>
          <dd>{impact.resolved} เรื่อง</dd>
        </div>
        {impact.spanMs === 0 ? null : (
          <div>
            <dt>กวนมาแล้ว</dt>
            <dd>{readableSpan(impact.spanMs)}</dd>
          </div>
        )}
      </dl>

      <p className="pim-when">
        {impact.firstSeen === null ? null : (
          <>
            เรื่องแรก <Timestamp utc={impact.firstSeen} />
          </>
        )}
        {impact.lastSeen === null ? null : (
          <>
            {' · '}ล่าสุด <Timestamp utc={impact.lastSeen} />
          </>
        )}
        {impact.projects.length <= 1 ? null : (
          <>
            {' · '}กระทบ {impact.projects.map((p) => `${p.key} (${String(p.count)})`).join(' · ')}
          </>
        )}
      </p>

      {impact.stillRecurring ? (
        <Alert tone="warning" inline>
          ยังเกิดซ้ำอยู่ — มีเรื่องใหม่เข้ามาภายในสามสิบวันที่ผ่านมา
        </Alert>
      ) : (
        /*
          ไม่ใช้ `Alert` กับสถานะนี้ — มันคือข้อมูล ไม่ใช่คำเตือน ·
          กล่องสีบนทุกสถานะทำให้กล่องสีไม่มีความหมาย
        */
        <p className="pim-quiet">ไม่มีเรื่องใหม่มาสามสิบวันแล้ว — อาจแก้ที่ต้นเหตุไปแล้ว</p>
      )}

      {error === null ? null : (
        <Alert tone="error" inline>
          {error}
        </Alert>
      )}

      {result === null ? null : (
        <Alert tone={result.failed === 0 ? 'success' : 'warning'} inline>
          เปลี่ยนสถานะได้ {result.changed} จาก {result.requested} เรื่อง
          {result.failed === 0 ? null : (
            <>
              {' · '}ทำไม่ได้ {result.failed} เรื่อง:{' '}
              {result.items
                .filter((i) => i.outcome !== 'changed')
                .map((i) => `${i.itemKey} (${i.reason ?? 'ไม่ทราบสาเหตุ'})`)
                .join(' · ')}
            </>
          )}
        </Alert>
      )}

      {/*
        **ไม่ปิดอัตโนมัติตอนปิดปัญหา** — ต้องเป็นการกระทำที่คนตั้งใจกด ·
        การปิดตามอัตโนมัติจะปิดเรื่องของคนที่ไม่เคยได้รับคำตอบสักคำ
        แล้วเขาจะรู้ตัวก็ต่อเมื่อเปิดดูเองว่าเรื่องปิดไปแล้ว
      */}
      {impact.open === 0 ? null : closing ? (
        <div className="pim-closer">
          <p className="pim-closer-lead">
            เปลี่ยนสถานะเรื่องที่ยังค้างอยู่ {openKeys.length} เรื่องพร้อมกัน — เสนอเฉพาะปุ่ม
            ที่มีใบกดได้จริง และเซิร์ฟเวอร์ตรวจกฎของแต่ละใบเองอีกครั้ง
            ใบที่ติดกฎจะถูกรายงานกลับมาทีละใบ
          </p>
          {options.length === 0 ? (
            <p className="pim-quiet">
              ไม่มีปุ่มที่กดได้กับชุดนี้ — อาจไม่มีสิทธิ์ หรือทุกใบติดกฎของ workflow
            </p>
          ) : (
            <>
              <Field label="ปุ่มที่จะกด" htmlFor="pim-transition" required>
                <Select
                  id="pim-transition"
                  value={transition}
                  onChange={setTransition}
                  placeholder="เลือกปุ่ม"
                  options={options.map((o) => ({
                    value: o.name,
                    // บอกจำนวนใบที่กดได้จริงตรงตัวเลือก ไม่ใช่รู้ตอนอ่านผล
                    label: `${o.name} (กดได้ ${String(o.eligible)} จาก ${String(openKeys.length)})`,
                  }))}
                />
              </Field>
              {needsResolution ? (
                <Field label="ผลการแก้ไข" htmlFor="pim-resolution" required>
                  <Select
                    id="pim-resolution"
                    value={resolution}
                    onChange={setResolution}
                    placeholder="เลือกผลการแก้ไข"
                    options={resolutions.map((r) => ({ value: r, label: r }))}
                  />
                </Field>
              ) : null}
            </>
          )}
          <div className="admin-btn-row">
            <Button
              variant="primary"
              disabled={
                busy || chosen === undefined || (needsResolution && resolution === '')
              }
              onClick={() => {
                void closeAll();
              }}
            >
              {/*
                ป้ายบนปุ่มบอกสิ่งที่จะเกิดขึ้นจริง ไม่ใช่คำว่า "ปิด" ลอย ๆ ·
                workflow ของแต่ละองค์กรอาจต้องผ่านหลายขั้นกว่าจะปิดได้
                การเขียนว่า "ปิด" จึงเป็นคำสัญญาที่ระบบทำตามไม่ได้ทุกครั้ง
              */}
              {chosen === undefined ? 'เลือกปุ่มก่อน' : `กด "${chosen.name}" กับ ${String(chosen.eligible)} เรื่อง`}
            </Button>
            <LinkButton
              disabled={busy}
              onClick={() => {
                setClosing(false);
                setTransition('');
                setResolution('');
              }}
            >
              ยกเลิก
            </LinkButton>
          </div>
        </div>
      ) : (
        <LinkButton
          onClick={() => {
            void openCloser();
          }}
        >
          จัดการเรื่องที่ค้าง {impact.open} เรื่องพร้อมกัน
        </LinkButton>
      )}

      <ul className="pim-list">
        {shown.map((i) => (
          <li key={i.itemKey} data-done={i.statusCategory === 'DONE' ? 'true' : undefined}>
            <TextLink href={`/browse/${i.itemKey}`} ariaLabel={`เปิด ${i.itemKey} ${i.summary}`}>
              {i.itemKey}
            </TextLink>
            <span className="pim-summary">{i.summary}</span>
            <span className="pim-meta">
              <Timestamp utc={i.createdAt} />
              {i.statusCategory === 'DONE' ? ' · แก้แล้ว' : ' · ยังค้าง'}
            </span>
          </li>
        ))}
      </ul>

      {hidden === 0 ? null : (
        /*
          บอกจำนวนที่ซ่อน ไม่ใช่ตัดเงียบ ๆ — "มีเท่านี้" กับ "แสดงเท่านี้"
          เป็นคนละคำตอบ และคนอ่านแยกไม่ออกถ้าไม่บอก
        */
        <LinkButton
          onClick={() => {
            setExpanded(true);
          }}
        >
          ดูอีก {hidden} เรื่อง
        </LinkButton>
      )}
    </section>
  );
}
