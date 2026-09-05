/**
 * รุ่นและบันทึกการปล่อย (Version / Release)
 *
 * ฟังก์ชันบริสุทธิ์ · ไม่อ่านนาฬิกา — "ตอนนี้" ส่งเข้ามาเสมอ ทำให้ทดสอบ
 * เคสข้ามวันได้โดยไม่ต้องรอจริง (กติกาเดียวกับ SLA Engine)
 *
 * ## ปล่อยรุ่นทั้งที่มีงานค้าง = ทำให้งานที่ยังไม่เสร็จดูเหมือนปล่อยไปแล้ว
 *
 * เหมือนตอนปิดสปรินต์: งานค้างต้องมีคนตัดสินใจว่ามันไปไหน · ระบบเลือกให้
 * เงียบ ๆ คือสิ่งที่ทำให้งานหายไปทางที่คนกดไม่ได้ตั้งใจ
 *
 * ## บันทึกการปล่อยต้องบอกจำนวนที่ยังไม่เสร็จเสมอ
 *
 * บันทึกที่ตัดงานค้างทิ้งเงียบ ๆ อ่านเหมือน "นี่คือทั้งหมดที่อยู่ในรุ่นนี้"
 * ซึ่งเป็นคนละเรื่องกับ "นี่คือทั้งหมดที่เสร็จ" — ต่างกันตรงที่คนอ่านจะไป
 * บอกลูกค้าว่าอะไรได้แล้วบ้าง
 */
import type { UtcDate } from '@itsm/types';

export type VersionState = 'UNRELEASED' | 'OVERDUE' | 'RELEASED' | 'ARCHIVED';

export const VERSION_STATE_LABEL: Record<VersionState, string> = {
  UNRELEASED: 'ยังไม่ปล่อย',
  OVERDUE: 'เลยกำหนดปล่อย',
  RELEASED: 'ปล่อยแล้ว',
  ARCHIVED: 'เก็บเข้าคลังแล้ว',
};

export class UnfinishedItemsError extends Error {
  constructor(readonly count: number) {
    super(
      `ยังมีงานที่ไม่เสร็จอยู่ ${String(count)} ใบในรุ่นนี้ — ` +
        'ต้องย้ายไปรุ่นอื่นหรือเอาออกจากรุ่นก่อน จึงจะปล่อยได้',
    );
    this.name = 'UnfinishedItemsError';
  }
}

export class AlreadyReleasedError extends Error {
  constructor() {
    super('รุ่นนี้ปล่อยไปแล้ว — ปล่อยซ้ำจะทำให้เวลาที่ปล่อยจริงหายไป');
    this.name = 'AlreadyReleasedError';
  }
}

export class AlreadyArchivedError extends Error {
  constructor() {
    super('รุ่นนี้ถูกเก็บเข้าคลังไปแล้ว');
    this.name = 'AlreadyArchivedError';
  }
}

export class NotArchivedError extends Error {
  constructor() {
    super('รุ่นนี้ไม่ได้อยู่ในคลัง');
    this.name = 'NotArchivedError';
  }
}

/**
 * รุ่นที่อยู่ในคลังถูกแตะไม่ได้อีก
 *
 * **ด่านนี้เพิ่งมีความหมายในวันที่มีทางเก็บเข้าคลังจริง** — ก่อนหน้านี้
 * `archived` ตั้งไม่ได้เลยจากที่ไหน โค้ดที่ไม่ได้ตรวจมันจึงดู "ปลอดภัย"
 * มาตลอด · เป็นรูปแบบเดียวกับ `listComments` ที่รับ viewer จาก `?view=`
 * แล้วกลายเป็นช่องโหว่ในวันที่ระบบยืนยันตัวตนทำงาน (CLAUDE.md §9)
 */
export class VersionArchivedError extends Error {
  constructor() {
    super('รุ่นนี้อยู่ในคลังแล้ว — เอาออกจากคลังก่อนจึงจะแก้ได้');
    this.name = 'VersionArchivedError';
  }
}

export class NotReleasedYetError extends Error {
  constructor() {
    super('รุ่นนี้ยังไม่ได้ปล่อย จึงเปิดใหม่ไม่ได้');
    this.name = 'NotReleasedYetError';
  }
}

export interface VersionRow {
  name: string;
  /** วันที่นัดไว้ · `null` = ไม่ได้ตั้ง — ต่างจาก "เลยกำหนด" */
  releaseDate: UtcDate | null;
  /** เวลาที่ปล่อยจริง · `null` = ยังไม่ปล่อย */
  releasedAt: UtcDate | null;
  archived: boolean;
}

export interface ReleaseItem {
  itemKey: string;
  summary: string;
  issueType: string;
  /** อยู่ในหมวด DONE ของ workflow — ไม่ใช่ `resolvedAt !== null` */
  done: boolean;
}

export interface ReleaseNoteGroup {
  issueType: string;
  items: ReleaseItem[];
}

export interface ReleaseNote {
  name: string;
  /** เวลาที่ปล่อยจริง ไม่ใช่วันที่นัดไว้ — บันทึกต้องบอกสิ่งที่เกิดขึ้น */
  releasedAt: UtcDate | null;
  groups: ReleaseNoteGroup[];
  finished: number;
  /** **ต้องแสดงเสมอ** แม้จะเป็นศูนย์ — ดู doc ของไฟล์ */
  unfinished: number;
}

/**
 * สถานะที่หน้าจอต้องเห็น
 *
 * `OVERDUE` ไม่ใช่คอลัมน์ในฐานข้อมูล — มันคือ "ยังไม่ปล่อย" ที่เลยวันนัดแล้ว ·
 * เก็บเป็นคอลัมน์แปลว่าต้องมีอะไรสักอย่างคอยอัปเดตทุกเที่ยงคืน และวันที่ลืม
 * รัน ทุกรุ่นจะดูเหมือนยังตรงกำหนด
 */
export function versionStateOf(v: VersionRow, now: UtcDate): VersionState {
  if (v.archived) return 'ARCHIVED';
  if (v.releasedAt !== null) return 'RELEASED';
  // ครบวันนัดพอดี ยังไม่เลย — เลยเมื่อเวลาผ่านไปแล้วเท่านั้น
  if (v.releaseDate !== null && v.releaseDate.getTime() < now.getTime()) return 'OVERDUE';
  return 'UNRELEASED';
}

/**
 * @throws {VersionArchivedError} อยู่ในคลัง
 * @throws {AlreadyReleasedError} ปล่อยไปแล้ว
 * @throws {UnfinishedItemsError} ยังมีงานที่ไม่อยู่ในหมวด DONE
 */
export function assertCanRelease(v: VersionRow, items: readonly ReleaseItem[]): void {
  if (v.archived) throw new VersionArchivedError();
  if (v.releasedAt !== null) throw new AlreadyReleasedError();
  const unfinished = items.filter((i) => !i.done).length;
  if (unfinished > 0) throw new UnfinishedItemsError(unfinished);
}

/** @throws {NotReleasedYetError} ยังไม่ได้ปล่อย · @throws {VersionArchivedError} อยู่ในคลัง */
export function assertCanReopen(v: VersionRow): void {
  if (v.archived) throw new VersionArchivedError();
  if (v.releasedAt === null) throw new NotReleasedYetError();
}

/**
 * เก็บรุ่นเข้าคลัง — **ทำได้แม้ยังมีงานค้าง แต่ต้องบอกจำนวน**
 *
 * ปฏิเสธไม่ได้ เพราะรุ่นที่ถูกยกเลิกกลางทางคือรุ่นที่มีงานค้างเสมอ — นั่นคือ
 * เหตุผลที่ต้องเก็บเข้าคลังตั้งแต่แรก · แต่เก็บเงียบ ๆ ทำให้งานที่ค้างหายไป
 * จากแผนโดยไม่มีใครรู้ · กติกาเดียวกับบันทึกการปล่อยที่บอกจำนวนที่ยังไม่เสร็จเสมอ
 *
 * @throws {AlreadyArchivedError} อยู่ในคลังอยู่แล้ว
 */
export function planArchive(
  v: VersionRow,
  items: readonly ReleaseItem[],
): { unfinished: number } {
  if (v.archived) throw new AlreadyArchivedError();
  return { unfinished: items.filter((i) => !i.done).length };
}

/** @throws {NotArchivedError} ไม่ได้อยู่ในคลัง */
export function assertCanUnarchive(v: VersionRow): void {
  if (!v.archived) throw new NotArchivedError();
}

/**
 * บันทึกการปล่อย — จัดกลุ่มตามประเภทงาน
 *
 * เรียงชื่อกลุ่มด้วย `localeCompare('th')` เพราะหัวข้อเป็นภาษาไทย ·
 * การเรียงด้วยรหัสอักขระจะได้ลำดับที่คนไทยอ่านแล้วรู้สึกว่าสุ่ม
 */
export function releaseNoteOf(v: VersionRow, items: readonly ReleaseItem[]): ReleaseNote {
  const finished = items.filter((i) => i.done);
  const byType = new Map<string, ReleaseItem[]>();
  for (const i of finished) {
    const list = byType.get(i.issueType);
    if (list === undefined) byType.set(i.issueType, [i]);
    else list.push(i);
  }

  const groups = [...byType.entries()]
    .map(([issueType, list]) => ({
      issueType,
      /*
        เรียงตามคีย์ด้วยตัวเลขจริง — `SD-10` ต้องอยู่หลัง `SD-9` ·
        การเรียงเป็นสตริงล้วนจะได้ `SD-10` ก่อน ซึ่งอ่านเหมือนข้อมูลสลับ

        เรียงในที่ได้ ไม่ต้องคัดลอกก่อน — `list` ถูกสร้างขึ้นใหม่ในลูปข้างบน
        ไม่ใช่อาร์เรย์ของผู้เรียก · เคยเขียน `[...list]` ไว้ แต่ตอนลบทิ้ง
        เพื่อพิสูจน์ว่าเทสต์แดงได้ มันยังเขียว ซึ่งแปลว่าเป็นบรรทัดที่ไม่มี
        ใครใช้ · ตัวป้องกันของจริงคือ `finished` ที่กรองมาเป็นอาร์เรย์ใหม่แล้ว
      */
      items: list.sort((a, b) =>
        a.itemKey.localeCompare(b.itemKey, undefined, { numeric: true }),
      ),
    }))
    .sort((a, b) => a.issueType.localeCompare(b.issueType, 'th'));

  return {
    name: v.name,
    releasedAt: v.releasedAt,
    groups,
    finished: finished.length,
    unfinished: items.length - finished.length,
  };
}
