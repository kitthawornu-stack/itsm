/**
 * แผนงานบนเส้นเวลา (Roadmap / Timeline)
 *
 * ฟังก์ชันบริสุทธิ์ · ไม่อ่านนาฬิกา ไม่อ่านฐานข้อมูล — กรอบเวลาที่จะดู
 * ส่งเข้ามาเสมอ
 *
 * ## สิ่งที่ยังไม่มีกำหนด ต้องไม่ถูกวางบนเส้นเวลา
 *
 * Gantt ที่เดาตำแหน่งให้ อ่านเหมือนแผนที่ตกลงกันแล้ว · **แย่กว่าไม่มีแผนภาพเลย
 * เพราะคนจะเอาไปวางแผนต่อ** · สิ่งที่วางไม่ได้อยู่ในรายการแยกพร้อมเหตุผล
 * ไม่ใช่หายไปเงียบ ๆ และไม่ใช่ถูกวางมั่ว ๆ
 *
 * ## หมุด ไม่ใช่แท่ง
 *
 * รุ่นที่ตั้งไว้แต่วันปล่อย ไม่มีช่วงเวลา — มันคือจุดเดียวบนเส้นเวลา ·
 * การลากแท่งจากขอบจอมาถึงวันนั้น เป็นการอ้างว่างานเริ่มตั้งแต่ต้นกรอบ
 * ซึ่งไม่มีใครบอกไว้
 *
 * ## ขอบเขตของไฟล์นี้
 *
 * วางได้เฉพาะสิ่งที่ **มีวันที่จริงในฐานข้อมูล** — รุ่นและรอบการทำงาน ·
 * งานทั่วไปยังไม่มีใครกรอก `dueDate` เลยสักใบ การวางมันบนเส้นเวลาจึงเป็น
 * การแต่งข้อมูลขึ้นมาทั้งหมด
 */
import type { UtcDate } from '@itsm/types';

export type TimelineKind = 'version' | 'sprint';

export interface TimelineEntry {
  key: string;
  label: string;
  kind: TimelineKind;
  /** `null` = ไม่มีวันเริ่ม · มีแต่วันจบแปลว่าเป็นหมุด */
  start: UtcDate | null;
  end: UtcDate | null;
  done: boolean;
}

export type UnplacedReason = 'no-dates' | 'backwards' | 'outside-window';

export const UNPLACED_LABEL: Record<UnplacedReason, string> = {
  'no-dates': 'ยังไม่ได้กำหนดวันที่',
  backwards: 'วันจบมาก่อนวันเริ่ม — ข้อมูลผิด',
  'outside-window': 'อยู่นอกช่วงเวลาที่กำลังดู',
};

export interface TimelineBar {
  key: string;
  label: string;
  kind: TimelineKind;
  done: boolean;
  /** สัดส่วนจากซ้ายของกรอบ · 0 ถึง 1 เสมอ */
  startRatio: number;
  endRatio: number;
  /** จุดเดียว ไม่ใช่ช่วง — มีแต่วันจบ */
  milestone: boolean;
}

export interface UnplacedEntry {
  key: string;
  label: string;
  kind: TimelineKind;
  reason: UnplacedReason;
}

export interface TimelineWindow {
  from: UtcDate;
  to: UtcDate;
}

export interface TimelineResult {
  bars: TimelineBar[];
  /** **ต้องแสดงเสมอ** — สิ่งที่วางไม่ได้ต้องเห็น ไม่ใช่หายไปเงียบ ๆ */
  unplaced: UnplacedEntry[];
}

/** บีบให้อยู่ในกรอบ · คร่อมกรอบ = วางเต็มกรอบ ไม่ใช่ตัดทิ้ง */
function ratioOf(at: number, window: { from: number; span: number }): number {
  const raw = (at - window.from) / window.span;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

export function placeOnTimeline(
  entries: readonly TimelineEntry[],
  window: TimelineWindow,
): TimelineResult {
  const from = window.from.getTime();
  const to = window.to.getTime();
  const span = to - from;
  const bars: TimelineBar[] = [];
  const unplaced: UnplacedEntry[] = [];

  for (const e of entries) {
    const base = { key: e.key, label: e.label, kind: e.kind };

    if (e.end === null && e.start === null) {
      unplaced.push({ ...base, reason: 'no-dates' });
      continue;
    }
    /*
      มีแต่วันเริ่ม ไม่มีวันจบ ก็ตอบไม่ได้ว่ากินเวลาถึงไหน — นับเป็นหมุด
      ที่วันเริ่ม · การลากไปถึงขอบขวาเป็นการอ้างว่ายังไม่จบ ซึ่งไม่มีใครบอกไว้
    */
    const endAt = (e.end ?? e.start) as UtcDate;
    const startAt = e.start ?? endAt;

    if (endAt.getTime() < startAt.getTime()) {
      unplaced.push({ ...base, reason: 'backwards' });
      continue;
    }
    // ไม่คาบเกี่ยวกรอบเลย · `[from, to]` ปลายชนขอบยังนับว่าเห็น
    if (endAt.getTime() < from || startAt.getTime() > to) {
      unplaced.push({ ...base, reason: 'outside-window' });
      continue;
    }

    const startRatio = ratioOf(startAt.getTime(), { from, span });
    const endRatio = ratioOf(endAt.getTime(), { from, span });
    bars.push({
      ...base,
      done: e.done,
      startRatio,
      endRatio,
      // หมุด = ไม่มีวันเริ่มของตัวเอง · ไม่ใช่ "แท่งที่บังเอิญสั้น"
      milestone: e.start === null || e.end === null,
    });
  }

  return { bars, unplaced };
}

export interface BlockVersion {
  key: string;
  label: string;
  releaseDate: UtcDate | null;
}

export interface BlockLink {
  blockerKey: string;
  /** `null` = งานที่ขวางไม่ได้อยู่รุ่นไหนเลย */
  blockerVersion: BlockVersion | null;
  blockedKey: string;
  blockedVersion: BlockVersion | null;
}

export interface BlockConflict {
  blockerKey: string;
  blockerVersionLabel: string;
  blockedKey: string;
  blockedVersionLabel: string;
}

export interface BlockUncheckable {
  blockerKey: string;
  blockedKey: string;
}

export interface BlockResult {
  conflicts: BlockConflict[];
  /**
   * คู่ที่ตอบไม่ได้ว่าขัดกันไหม
   *
   * **สิ่งที่ตรวจไม่ได้ ต้องไม่ถูกนับว่าไม่มีปัญหา** — การเงียบทำให้คนอ่าน
   * เชื่อว่าตรวจครบแล้ว ซึ่งเป็นความมั่นใจที่ระบบสร้างขึ้นเอง
   */
  uncheckable: BlockUncheckable[];
}

/**
 * หาการขวางที่เป็นไปไม่ได้ตามลำดับการปล่อย
 *
 * งานในรุ่นที่ปล่อยทีหลัง ขวางงานในรุ่นที่ปล่อยก่อน แปลว่ารุ่นที่ปล่อยก่อน
 * **ปล่อยไม่ได้จริง** · ไม่มีใครไล่เทียบเองทัน และตอนที่รู้คือวันที่ปล่อยไม่ได้
 *
 * ปล่อยวันเดียวกันไม่นับว่าขัด — ออกไปพร้อมกัน
 */
export function crossVersionBlocks(links: readonly BlockLink[]): BlockResult {
  const conflicts: BlockConflict[] = [];
  const uncheckable: BlockUncheckable[] = [];

  for (const l of links) {
    const a = l.blockerVersion;
    const b = l.blockedVersion;
    if (a === null || b === null || a.releaseDate === null || b.releaseDate === null) {
      uncheckable.push({ blockerKey: l.blockerKey, blockedKey: l.blockedKey });
      continue;
    }
    if (a.releaseDate.getTime() > b.releaseDate.getTime()) {
      conflicts.push({
        blockerKey: l.blockerKey,
        blockerVersionLabel: a.label,
        blockedKey: l.blockedKey,
        blockedVersionLabel: b.label,
      });
    }
  }

  return { conflicts, uncheckable };
}
