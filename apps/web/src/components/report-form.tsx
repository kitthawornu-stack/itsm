'use client';

import { useState, type ReactNode } from 'react';
import { Button, Field, Input, Select, Textarea } from '@itsm/ui';

interface FormField {
  key: string;
  name: string;
  type: string;
  isRequired: boolean;
  options: string[];
}

interface IssueTypeOption {
  name: string;
  icon: string;
  /** ฟิลด์เพิ่มเติมที่ผู้ดูแลตั้งไว้สำหรับ (โปรเจกต์ × ประเภทงาน) นี้ */
  fields: FormField[];
}

export interface Options {
  projects: Array<{ key: string; name: string }>;
  issueTypes: IssueTypeOption[];
  priorities: Array<{ rank: number; name: string }>;
}

/**
 * ชื่อชนิดงานในระบบ กับคำที่คนพูดจริง ไม่ใช่คำเดียวกัน (CLAUDE.md §5)
 * ชนิดที่ไม่มีในตารางนี้แสดงชื่อระบบไปตรง ๆ ดีกว่าซ่อนไม่ให้เลือก
 */
const HUMAN_TYPE: Record<string, string> = {
  Incident: 'มีบางอย่างใช้งานไม่ได้',
  'Service Request': 'ขอให้ช่วยทำอะไรให้',
  Problem: 'เป็นซ้ำ ๆ อยากให้หาสาเหตุ',
  Change: 'ขอเปลี่ยนแปลงระบบ',
};

const SUMMARY_MAX = 500;

export function ReportForm({ apiBase, options }: { apiBase: string; options: Options }): ReactNode {
  const [project, setProject] = useState(options.projects[0]?.key ?? '');
  const [issueTypes, setIssueTypes] = useState(options.issueTypes);
  const [issueType, setIssueType] = useState(options.issueTypes[0]?.name ?? '');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('');
  /**
   * ค่าฟิลด์เพิ่มเติม เก็บตามคีย์ของฟิลด์
   *
   * ไม่ล้างตอนเปลี่ยนประเภทงาน — ฟิลด์ที่ชื่อเดียวกันมักหมายถึงสิ่งเดียวกัน
   * และการล้างสิ่งที่ผู้ใช้พิมพ์ไปแล้วเพราะเขาเปลี่ยนใจเรื่องอื่น เป็นการลงโทษ
   * ค่าที่ไม่ตรงกับฟิลด์ของประเภทใหม่จะไม่ถูกส่งไปอยู่แล้ว
   */
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // แตะแล้วค่อยเตือน — ขึ้นสีแดงตั้งแต่ยังไม่ได้พิมพ์คือการดุคนที่ยังไม่ได้ทำอะไรผิด
  const [touched, setTouched] = useState(false);

  const summaryEmpty = summary.trim().length === 0;
  const activeFields = issueTypes.find((t) => t.name === issueType)?.fields ?? [];

  /**
   * ชนิดงานผูกกับโปรเจกต์ ไม่ใช่รายการกลาง
   *
   * ถ้าไม่โหลดใหม่ตอนเปลี่ยนโปรเจกต์ ฟอร์มจะยอมให้ประกอบคู่ที่ไม่มีอยู่จริง
   * แล้วไปตายที่ 422 ตอนกดส่ง — ซึ่งคือการโยนความผิดพลาดของเราไปให้ผู้ใช้
   */
  async function changeProject(key: string): Promise<void> {
    setProject(key);
    try {
      const res = await fetch(
        `${apiBase}/api/v1/work-items/options?project=${encodeURIComponent(key)}`,
        { credentials: 'include', cache: 'no-store' },
      );
      if (!res.ok) return;
      const d = (await res.json()) as Options;
      setIssueTypes(d.issueTypes);
      // ชนิดเดิมอาจไม่มีในโปรเจกต์ใหม่ — คงไว้ถ้ามี ไม่งั้นถอยไปตัวแรก
      setIssueType((cur) =>
        d.issueTypes.some((t) => t.name === cur) ? cur : (d.issueTypes[0]?.name ?? ''),
      );
    } catch {
      // ปล่อยรายการเดิมไว้ ดีกว่าล้างจนเลือกอะไรไม่ได้เลย
    }
  }

  async function submit(): Promise<void> {
    setTouched(true);
    if (summaryEmpty) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/work-items`, { credentials: 'include',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project,
          issueType,
          summary,
          ...(description.trim() === '' ? {} : { description }),
          ...(priority === '' ? {} : { priorityRank: Number(priority) }),
          // ส่งเฉพาะฟิลด์ของประเภทงานที่เลือกอยู่ — ค่าที่ค้างจากประเภทอื่นไม่เกี่ยว
          fields: Object.fromEntries(
            activeFields
              .map((f) => [f.key, fieldValues[f.key] ?? ''] as const)
              .filter(([, v]) => v !== ''),
          ),
        }),
      });
      const data = (await res.json()) as { itemKey?: string; message?: string };
      if (!res.ok) {
        setError(data.message ?? `ส่งเรื่องไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      // ไปหน้างานที่เพิ่งสร้าง — ผู้ใช้ต้องเห็นเลขที่เรื่องของตัวเองทันที
      window.location.href = `/browse/${String(data.itemKey)}`;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ เรื่องยังไม่ถูกส่ง ลองใหม่อีกครั้ง');
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      className="report-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="หัวข้อ" htmlFor="rf-summary" required hint="บอกสั้น ๆ ว่าอะไรใช้งานไม่ได้">
        <Input
          id="rf-summary"
          value={summary}
          onChange={setSummary}
          maxLength={SUMMARY_MAX}
          placeholder="เช่น เครื่องพิมพ์ชั้น 3 พิมพ์ไม่ออก"
          invalid={touched && summaryEmpty}
          errorMessage="ต้องมีหัวข้อ เพื่อให้ทีมรู้ว่าเรื่องนี้เกี่ยวกับอะไร"
        />
      </Field>

      <Field label="รายละเอียด" htmlFor="rf-desc" hint="เกิดตอนไหน ลองอะไรไปแล้วบ้าง">
        <Textarea
          id="rf-desc"
          value={description}
          onChange={setDescription}
          rows={5}
          maxLength={4000}
          placeholder="ยิ่งเล่าละเอียด ยิ่งแก้ได้เร็ว"
        />
      </Field>

      <div className="report-row">
        <Field label="เรื่องนี้เป็นแบบไหน" htmlFor="rf-type">
          <Select
            id="rf-type"
            value={issueType}
            onChange={setIssueType}
            options={issueTypes.map((t) => ({
              value: t.name,
              label: HUMAN_TYPE[t.name] ?? t.name,
            }))}
          />
        </Field>

        <Field label="ความสำคัญ" htmlFor="rf-priority" hint="ไม่แน่ใจก็ปล่อยว่างได้">
          <Select
            id="rf-priority"
            value={priority}
            onChange={setPriority}
            options={options.priorities.map((p) => ({
              value: String(p.rank),
              label: p.name,
            }))}
            placeholder="ให้ทีมเป็นคนประเมิน"
          />
        </Field>
      </div>

      {/*
        ฟิลด์เพิ่มเติมที่ผู้ดูแลตั้งไว้
        `field_config` มีข้อมูลอยู่ตั้งแต่ Spike B แต่ฟอร์มไม่เคยถามมันเลย
        และสองในสี่ฟิลด์ของ SD ตั้งเป็นบังคับกรอกไว้ด้วย
      */}
      {activeFields.map((f) => (
        <Field
          key={f.key}
          label={f.name}
          htmlFor={`rf-cf-${f.key}`}
          required={f.isRequired}
          {...(f.type === 'LABELS' ? { hint: 'คั่นหลายค่าด้วยเครื่องหมายจุลภาค' } : {})}
        >
          {f.options.length > 0 ? (
            <Select
              id={`rf-cf-${f.key}`}
              value={fieldValues[f.key] ?? ''}
              onChange={(v) => {
                setFieldValues((prev) => ({ ...prev, [f.key]: v }));
              }}
              options={f.options.map((o) => ({ value: o, label: o }))}
              placeholder={f.isRequired ? 'เลือก' : 'ไม่ระบุ'}
            />
          ) : f.type === 'TEXTAREA' || f.type === 'RICH_TEXT' ? (
            <Textarea
              id={`rf-cf-${f.key}`}
              value={fieldValues[f.key] ?? ''}
              onChange={(v) => {
                setFieldValues((prev) => ({ ...prev, [f.key]: v }));
              }}
              rows={3}
              maxLength={2000}
            />
          ) : (
            <Input
              id={`rf-cf-${f.key}`}
              value={fieldValues[f.key] ?? ''}
              onChange={(v) => {
                setFieldValues((prev) => ({ ...prev, [f.key]: v }));
              }}
              maxLength={255}
            />
          )}
        </Field>
      ))}

      {options.projects.length > 1 ? (
        <Field label="ส่งเรื่องไปที่ทีม" htmlFor="rf-project">
          <Select
            id="rf-project"
            value={project}
            onChange={(v) => void changeProject(v)}
            options={options.projects.map((p) => ({ value: p.key, label: p.name }))}
          />
        </Field>
      ) : null}

      {error === null ? null : (
        <p className="report-error" role="alert">
          {error}
        </p>
      )}

      <div className="report-actions">
        <Button variant="primary" type="submit" disabled={sending}>
          {sending ? 'กำลังส่ง…' : 'ส่งเรื่อง'}
        </Button>
        <a className="report-cancel" href="/">
          ยกเลิก
        </a>
      </div>
    </form>
  );
}
