import type { ReactNode } from 'react';

import { Alert, EmptyState, FormInput, PageHeader, SubmitButton, TextLink } from '@itsm/ui';

import { apiFetch } from '@/lib/api';
import { daysCovered, shiftDay, thaiClock, thaiDayKey, thaiDayLabel, thaiMidnight } from '@/lib/thai-day';

export const dynamic = 'force-dynamic';

interface CalendarEntry {
  itemKey: string;
  summary: string;
  start: string;
  end: string;
  overridden: boolean;
}

interface FreezeBand {
  name: string;
  reason: string;
  start: string;
  end: string;
}

/**
 * ช่วงเวลาที่เลือกได้จากลิงก์
 *
 * **ค่าปริยายคือข้างหน้า ไม่ใช่ข้างหลัง** — ปฏิทินการเปลี่ยนแปลงมีไว้ดูว่า
 * "จะมีอะไรเกิดขึ้น" · รายงานย้อนหลังเป็นคนละคำถามและมีที่ของมันอยู่แล้ว
 */
const RANGES = [
  { key: '7', label: '7 วันข้างหน้า', days: 7 },
  { key: '30', label: '30 วันข้างหน้า', days: 30 },
  { key: '90', label: '90 วันข้างหน้า', days: 90 },
] as const;

const DEFAULT_RANGE = '30';

/** งานสองใบที่ชนกัน — `[start, end)` ปลายชนต้นพอดีไม่ถือว่าชน */
function overlaps(a: CalendarEntry, b: CalendarEntry): boolean {
  return Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
}

export default async function ChangeCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const today = thaiDayKey(new Date());

  /*
    ช่วงเวลาที่ระบุเองชนะค่าปริยาย · ค่าที่อ่านไม่ออกไม่ทำให้หน้าพัง —
    มันกลับไปใช้ค่าปริยาย เพราะหน้าที่พังเพราะพารามิเตอร์ใน URL
    คือหน้าที่แชร์ลิงก์ให้กันไม่ได้
  */
  const custom =
    sp.from !== undefined && sp.to !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)
      && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) && sp.from <= sp.to;
  const range = RANGES.find((r) => r.key === sp.range)?.key ?? DEFAULT_RANGE;
  const days = RANGES.find((r) => r.key === range)?.days ?? 30;

  const fromKey = custom ? (sp.from as string) : today;
  // ปลายเป็น exclusive — บวกหนึ่งวันเพื่อให้วันสุดท้ายที่คนเลือกรวมอยู่ด้วย
  const toKey = custom ? shiftDay(sp.to as string, 1) : shiftDay(today, days);

  let entries: CalendarEntry[] = [];
  let freezes: FreezeBand[] = [];
  let error: string | null = null;
  try {
    const res = await apiFetch(
      `/api/v1/change-calendar?from=${encodeURIComponent(thaiMidnight(fromKey).toISOString())}` +
        `&to=${encodeURIComponent(thaiMidnight(toKey).toISOString())}`,
    );
    if (res.ok) {
      const d = (await res.json()) as { entries: CalendarEntry[]; freezes: FreezeBand[] };
      entries = d.entries;
      freezes = d.freezes;
    } else {
      error = `อ่านปฏิทินไม่สำเร็จ (HTTP ${String(res.status)})`;
    }
  } catch {
    error = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้';
  }

  /*
    จัดกลุ่มตามวันของไทย · งานที่ลากข้ามคืนปรากฏในทั้งสองวัน — ไม่ใช่แค่วันที่
    เริ่ม · ปฏิทินที่แสดงงานเฉพาะวันที่เริ่ม ทำให้คนที่ดูวันอาทิตย์ไม่เห็นงาน
    ที่เริ่มคืนวันเสาร์แล้วยังทำอยู่
  */
  const byDay = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    for (const day of daysCovered(e.start, e.end)) {
      if (day < fromKey || day >= toKey) continue;
      const list = byDay.get(day) ?? [];
      list.push(e);
      byDay.set(day, list);
    }
  }

  const freezeByDay = new Map<string, FreezeBand[]>();
  for (const f of freezes) {
    for (const day of daysCovered(f.start, f.end)) {
      if (day < fromKey || day >= toKey) continue;
      const list = freezeByDay.get(day) ?? [];
      list.push(f);
      freezeByDay.set(day, list);
    }
  }

  const dayKeys = [...new Set([...byDay.keys(), ...freezeByDay.keys()])].sort();
  const clashing = new Set<string>();
  for (const a of entries) {
    for (const b of entries) {
      if (a.itemKey !== b.itemKey && overlaps(a, b)) clashing.add(a.itemKey);
    }
  }

  return (
    <section className="page">
      <PageHeader
        title="ปฏิทินการเปลี่ยนแปลง"
        lead="ช่วงเวลาที่ทีมนัดไว้ว่าจะแตะระบบ — เห็นพร้อมกันทั้งหมดจึงรู้ว่าคืนไหนแน่นเกินไป"
      />

      {error === null ? null : <Alert tone="error">{error}</Alert>}

      <div className="cal-controls">
        <nav className="cal-ranges" aria-label="ช่วงเวลา">
          {RANGES.map((r) => (
            <TextLink
              key={r.key}
              href={`/change-calendar?range=${r.key}`}
              ariaLabel={`ดู${r.label}`}
            >
              {custom || r.key !== range ? r.label : `▸ ${r.label}`}
            </TextLink>
          ))}
        </nav>

        {/*
          ฟอร์ม GET จริง — หน้านี้ทำงานได้โดยไม่ต้องมี JavaScript และลิงก์ที่ได้
          แชร์ให้กันได้ · ปฏิทินคือสิ่งที่คนส่งต่อกันในที่ประชุม
        */}
        <form className="cal-custom" method="get" action="/change-calendar">
          <label htmlFor="cal-from">
            ตั้งแต่
            <FormInput id="cal-from" type="date" name="from" defaultValue={fromKey} />
          </label>
          <label htmlFor="cal-to">
            ถึง
            <FormInput id="cal-to" type="date" name="to" defaultValue={shiftDay(toKey, -1)} />
          </label>
          <SubmitButton variant="secondary">ดูช่วงนี้</SubmitButton>
        </form>
      </div>

      <p className="cal-summary">
        {thaiDayLabel(fromKey)} ถึง {thaiDayLabel(shiftDay(toKey, -1))} · การเปลี่ยนแปลง{' '}
        {entries.length} เรื่อง
        {clashing.size === 0 ? null : <> · ชนกันอยู่ {clashing.size} เรื่อง</>}
        {freezes.length === 0 ? null : <> · ช่วงห้าม {freezes.length} ช่วง</>}
      </p>

      {dayKeys.length === 0 ? (
        <EmptyState
          title="ไม่มีการเปลี่ยนแปลงที่นัดไว้ในช่วงนี้"
          body="กำหนดช่วงเวลาดำเนินการได้จากหน้ารายละเอียดของแต่ละเรื่อง"
        />
      ) : (
        <ol className="cal-days">
          {dayKeys.map((day) => (
            <li key={day}>
              <h2 className="cal-day-title">{thaiDayLabel(day)}</h2>

              {(freezeByDay.get(day) ?? []).map((f) => (
                <p key={f.name} className="cal-freeze">
                  ห้ามเปลี่ยนแปลง — {f.name} · {f.reason}
                </p>
              ))}

              {(byDay.get(day) ?? []).length === 0 ? (
                <p className="cal-none">ไม่มีการเปลี่ยนแปลงที่นัดไว้</p>
              ) : (
                <ul className="cal-entries">
                  {(byDay.get(day) ?? []).map((e) => (
                    <li key={e.itemKey} data-clash={clashing.has(e.itemKey) ? 'true' : undefined}>
                      <span className="cal-time">
                        {thaiClock(e.start)}–{thaiClock(e.end)}
                      </span>
                      <TextLink
                        href={`/browse/${e.itemKey}`}
                        ariaLabel={`เปิด ${e.itemKey} ${e.summary}`}
                      >
                        {e.itemKey}
                      </TextLink>
                      <span className="cal-summary-text">{e.summary}</span>
                      {/*
                        ป้ายบอกสถานะเป็นข้อความ ไม่ใช่สีอย่างเดียว — คนที่แยกสี
                        ไม่ออกต้องอ่านออกเหมือนกัน (และภาพพิมพ์ขาวดำก็ยังอ่านได้)
                      */}
                      {clashing.has(e.itemKey) ? <span className="cal-tag">ชนกัน</span> : null}
                      {e.overridden ? <span className="cal-tag">ข้ามช่วงห้าม</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
