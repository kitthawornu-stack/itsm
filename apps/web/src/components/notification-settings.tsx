'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Checkbox, EmptyState, Table } from '@itsm/ui';

interface MyPreference {
  kind: string;
  alwaysOn: boolean;
  inApp: boolean;
  email: boolean;
}

interface RoleRow {
  role: string;
  label: string;
  /** ปิดไม่ได้ — ไม่แสดงสวิตช์ให้กด */
  alwaysReached: boolean;
  /** `null` = ไม่เคยตั้ง (เท่ากับได้รับ) */
  tenantEnabled: boolean | null;
  perProject: { projectKey: string; isEnabled: boolean }[];
}

interface KindAudienceRow {
  kind: string;
  roles: RoleRow[];
}

interface KindRow {
  kind: string;
  alwaysOn: boolean;
  tenantEnabled: boolean | null;
  perProject: { projectKey: string; isEnabled: boolean }[];
}

/*
  คำไทยของแต่ละชนิด — **รายการมาจากเซิร์ฟเวอร์ ที่นี่แปลอย่างเดียว**

  ชนิดที่ยังไม่มีคำแปลแสดงค่าดิบ ไม่ใช่หายไปจากรายการ · คำอังกฤษบนหน้าจอไทย
  เป็นสัญญาณที่คนเห็น ส่วนแถวที่หายไปเงียบ ๆ ไม่มีใครเห็น
*/
const KIND_TH: Record<string, string> = {
  'workitem.assigned': 'มีคนมอบหมายงานให้ฉัน',
  'workitem.rate': 'ขอให้ให้คะแนนหลังงานเสร็จ',
  'comment.added': 'มีความเห็นใหม่ในเรื่องที่ฉันเกี่ยวข้อง',
  'comment.mention': 'มีคนเรียกชื่อฉันในความเห็น',
  'comment.internal': 'มีบันทึกภายในใหม่',
  'approval.requested': 'มีเรื่องรอฉันอนุมัติ',
  'approval.decided': 'เรื่องที่ฉันขออนุมัติมีผลแล้ว',
  'sla.threshold': 'ใกล้เลยกำหนด SLA หรือเลยแล้ว',
  'automation.notice': 'กฎอัตโนมัติแจ้งมา',
};

function th(kind: string): string {
  return KIND_TH[kind] ?? kind;
}

/**
 * ตั้งค่าการแจ้งเตือน
 *
 * ## สองฝั่งอยู่หน้าเดียวกัน แต่แยกกันชัด
 *
 * ฝั่งบนเป็นของผู้ใช้เอง ใครก็ตั้งได้ · ฝั่งล่างเป็นสวิตช์ระดับองค์กรที่เห็น
 * เฉพาะผู้ดูแล — ถ้าเซิร์ฟเวอร์ตอบ 403 ส่วนนั้นหายไปทั้งก้อน ไม่ใช่แสดง
 * สวิตช์ที่กดแล้วได้ error
 *
 * ## ชนิดที่ปิดไม่ได้ ไม่แสดงช่องติ๊ก
 *
 * แสดงช่องที่กดแล้วถูกปฏิเสธเสมอ คือหน้าจอที่โกหก · บอกเหตุผลไว้แทน
 */
export function NotificationSettings({ apiBase }: { apiBase: string }): ReactNode {
  const [mine, setMine] = useState<MyPreference[] | null>(null);
  const [switches, setSwitches] = useState<KindRow[] | null>(null);
  const [audience, setAudience] = useState<KindAudienceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [mineRes, adminRes, audienceRes] = await Promise.all([
        fetch(`${apiBase}/api/v1/notification-settings/me/preferences`, {
          credentials: 'include',
          cache: 'no-store',
        }),
        fetch(`${apiBase}/api/v1/notification-settings/admin/switches`, {
          credentials: 'include',
          cache: 'no-store',
        }),
        fetch(`${apiBase}/api/v1/notification-settings/admin/audience`, {
          credentials: 'include',
          cache: 'no-store',
        }),
      ]);
      if (!mineRes.ok) {
        setError(`โหลดค่าของคุณไม่สำเร็จ (HTTP ${String(mineRes.status)})`);
        setMine([]);
      } else {
        setMine((await mineRes.json()) as MyPreference[]);
        setError(null);
      }
      // 403 = ไม่ใช่ผู้ดูแล · ซ่อนทั้งส่วน ไม่ใช่แสดงสวิตช์ที่กดไม่ได้
      setSwitches(adminRes.ok ? ((await adminRes.json()) as KindRow[]) : null);
      setAudience(audienceRes.ok ? ((await audienceRes.json()) as KindAudienceRow[]) : null);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      setMine([]);
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(path: string, body: unknown, done: string): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/notification-settings${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        setError(data.message ?? `บันทึกไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setNotice(done);
      await load();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  if (mine === null) return <p className="muted">กำลังโหลด…</p>;

  return (
    <>
      {error === null ? null : <Alert tone="error">{error}</Alert>}
      {notice === null ? null : <Alert tone="success">{notice}</Alert>}

      <h2 className="section-title">การแจ้งเตือนของฉัน</h2>
      <p className="muted">
        ปิดสิ่งที่ไม่อยากได้ · ปิดอีเมลอย่างเดียวได้ โดยยังเห็นบนกระดิ่งอยู่
      </p>

      {mine.length === 0 ? (
        <EmptyState title="ยังโหลดรายการไม่ได้" body="ลองรีเฟรชหน้านี้อีกครั้ง" />
      ) : (
        <Table
          label="การแจ้งเตือนของฉัน"
          columns={[
            'เรื่อง',
            { label: 'บนกระดิ่ง', width: '140px' },
            { label: 'อีเมล', width: '140px' },
          ]}
          rowCount={mine.length}
        >
          {mine.map((p) => (
            <tr key={p.kind}>
              <td>
                {th(p.kind)}
                {p.alwaysOn ? (
                  /* บอกเหตุผลแทนช่องที่กดแล้วถูกปฏิเสธเสมอ */
                  <p className="muted">
                    ปิดไม่ได้ — ปิดแล้วกระบวนการของคนอื่นหยุดโดยไม่มีใครรู้ว่ามีเรื่องรออยู่
                  </p>
                ) : null}
              </td>
              {(['in-app', 'email'] as const).map((channel) => (
                <td key={channel}>
                  {p.alwaysOn ? (
                    <span className="muted">เปิดเสมอ</span>
                  ) : (
                    <Checkbox
                      checked={channel === 'in-app' ? p.inApp : p.email}
                      disabled={busy}
                      label={`${channel === 'in-app' ? 'บนกระดิ่ง' : 'อีเมล'} — ${th(p.kind)}`}
                      onChange={(next) => {
                        void send(
                          '/me/preferences',
                          { kind: p.kind, channel, isEnabled: next },
                          next ? `เปิดแล้ว: ${th(p.kind)}` : `ปิดแล้ว: ${th(p.kind)}`,
                        );
                      }}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </Table>
      )}

      {switches === null ? null : (
        <>
          <h2 className="section-title">สวิตช์ระดับองค์กร</h2>
          <p className="muted">
            ปิดที่นี่แล้ว <strong>ไม่มีใครได้รับเลย</strong> ไม่ว่าเขาจะตั้งค่าของตัวเองไว้อย่างไร ·
            ทุกครั้งที่เปลี่ยน ระบบบันทึกไว้ว่าใครเปลี่ยน
          </p>
          <Table
            label="สวิตช์การแจ้งเตือนระดับองค์กร"
            columns={['เรื่อง', { label: 'ทั้งองค์กร', width: '160px' }, 'ข้อยกเว้นรายโปรเจกต์']}
            rowCount={switches.length}
          >
            {switches.map((s) => (
              <tr key={s.kind}>
                <td>{th(s.kind)}</td>
                <td>
                  {s.alwaysOn ? (
                    <span className="muted">ปิดไม่ได้</span>
                  ) : (
                    /*
                      **ไม่ส่ง children ให้ Checkbox** — `Checkbox` ใส่ `aria-label`
                      ให้เฉพาะตอนไม่มีข้อความข้างช่อง · ถ้าส่งข้อความสถานะเข้าไป
                      ทั้งแปดแถวจะอ่านออกเสียงว่า "ตามค่าปริยาย (เปิด)" เหมือนกันหมด
                      แล้วคนที่ไล่ด้วยคีย์บอร์ดจะไม่รู้ว่ากำลังแตะชนิดไหน
                      (เคสเดียวกับปุ่ม "ถอด" ที่ทำให้ LinkButton ต้องมี ariaLabel)

                      ข้อความสถานะจึงอยู่ข้าง ๆ เป็นของตัวเอง
                    */
                    <span className="switch-cell">
                      <Checkbox
                        checked={s.tenantEnabled ?? true}
                        disabled={busy}
                        label={`เปิดทั้งองค์กร — ${th(s.kind)}`}
                        onChange={(next) => {
                          void send(
                            '/admin/switches',
                            { kind: s.kind, isEnabled: next },
                            next ? `เปิดทั้งองค์กร: ${th(s.kind)}` : `ปิดทั้งองค์กร: ${th(s.kind)}`,
                          );
                        }}
                      />
                      {/* "ยังไม่เคยตั้ง" ต่างจาก "ตั้งให้เปิด" — ต้องอ่านออกจากหน้าจอ */}
                      <span>
                        {s.tenantEnabled === null
                          ? 'ตามค่าปริยาย (เปิด)'
                          : s.tenantEnabled
                            ? 'เปิด'
                            : 'ปิด'}
                      </span>
                    </span>
                  )}
                </td>
                <td>
                  {s.perProject.length === 0 ? (
                    <span className="muted">ไม่มี</span>
                  ) : (
                    s.perProject.map((p) => (
                      <p key={p.projectKey} className="muted">
                        {p.projectKey}: {p.isEnabled ? 'เปิด' : 'ปิด'}
                      </p>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {audience === null ? null : (
        <>
          <h2 className="section-title">ใครควรได้รับ</h2>
          <p className="muted">
            คนละเรื่องกับสวิตช์ข้างบน · ที่นี่เลือกว่า <strong>ในบรรดาคนที่เกี่ยวข้อง
            ใครยังควรได้รับ</strong> — เช่นให้ผู้เฝ้าดูหยุดได้รับความเห็นใหม่
            โดยผู้แจ้งกับผู้รับผิดชอบยังได้อยู่ ·{' '}
            <strong>ปิดครบทุกบทบาทไม่ได้</strong> เพราะให้ผลเหมือนปิดทั้งชนิด
            แต่มองไม่เห็นจากหน้าจอ — ถ้าตั้งใจแบบนั้น ให้ปิดที่สวิตช์ข้างบนแทน
          </p>

          {audience
            .filter((k) => k.roles.length > 0)
            .map((k) => (
              <section key={k.kind} className="aud">
                <h3 className="aud-kind">{th(k.kind)}</h3>
                <ul className="aud-roles">
                  {k.roles.map((r) => (
                    <li key={r.role}>
                      {r.alwaysReached ? (
                        <span className="muted">
                          {r.label} — ได้รับเสมอ ปิดไม่ได้
                        </span>
                      ) : (
                        <span className="switch-cell">
                          {/*
                            ชื่อของสวิตช์ต้องบอกทั้งบทบาทและชนิด — ทั้งหน้ามีสวิตช์
                            ชื่อ "ผู้เฝ้าดู" อยู่หลายอัน คนละชนิดกัน
                          */}
                          <Checkbox
                            checked={r.tenantEnabled ?? true}
                            disabled={busy}
                            label={`${r.label} ได้รับ — ${th(k.kind)}`}
                            onChange={(next) => {
                              void send(
                                '/admin/audience',
                                { kind: k.kind, role: r.role, isEnabled: next },
                                next
                                  ? `${r.label} จะได้รับ: ${th(k.kind)}`
                                  : `${r.label} จะไม่ได้รับ: ${th(k.kind)}`,
                              );
                            }}
                          />
                          <span>{r.label}</span>
                          {/* "ยังไม่เคยตั้ง" ต่างจาก "ตั้งให้เปิด" */}
                          <span className="muted">
                            {r.tenantEnabled === null
                              ? 'ตามค่าปริยาย (ได้รับ)'
                              : r.tenantEnabled
                                ? 'ได้รับ'
                                : 'ไม่ได้รับ'}
                          </span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </>
      )}
    </>
  );
}
