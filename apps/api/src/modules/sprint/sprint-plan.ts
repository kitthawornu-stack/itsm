/**
 * Sprint — กติกาของรอบการทำงาน
 *
 * ฟังก์ชันบริสุทธิ์ทั้งไฟล์ · **"ตอนนี้" ส่งเข้ามา ไม่อ่านนาฬิกาเอง**
 * กติกาเดียวกับ SLA Engine — เคส "ปิดสปรินต์ที่เริ่มไปแล้วสองสัปดาห์"
 * ทดสอบได้ก็ต่อเมื่อไม่ต้องรอเวลาจริง
 *
 * ## สองอย่างที่แยกให้ขาด
 *
 * **กำหนดการ ≠ เวลาที่เกิดขึ้นจริง** — สปรินต์ที่วางไว้ว่าเริ่ม 1 ก.ย.
 * แต่กดเริ่มจริงวันที่ 3 คือคนละเรื่อง · ไฟล์นี้สนใจเฉพาะเวลาที่เกิดขึ้นจริง
 * (`startedAt` · `completedAt`) ส่วนกำหนดการเป็นเรื่องของชั้นเก็บข้อมูล ·
 * บทเรียนเดียวกับ `breachAt` กับ `breachedAt` ที่เคยทำให้ตอบไม่ได้ว่า
 * "หลุดตอนไหน"
 *
 * **คำรับปากตอนเริ่ม ≠ สิ่งที่อยู่ในสปรินต์ตอนจบ** — ถ้าไม่เก็บภาพตอนเริ่มไว้
 * คำถาม "ทำได้ตามที่รับปากไหม" จะตอบไม่ได้ตลอดกาล และตัวเลข "ทำเสร็จ 40 แต้ม"
 * จะซ่อนไว้ว่า 15 แต้มเพิ่งใส่เข้ามากลางทาง
 */
import type { UtcDate } from '@itsm/types';

export type SprintState = 'planned' | 'active' | 'completed';

export interface SprintSnapshot {
  id: string;
  state: SprintState;
  /** เวลาที่กดเริ่มจริง — `null` เมื่อยังไม่เริ่ม */
  startedAt: UtcDate | null;
  /** เวลาที่กดปิดจริง — `null` เมื่อยังไม่ปิด */
  completedAt: UtcDate | null;
  /** รายการที่อยู่ในสปรินต์ **ตอนกดเริ่ม** — คำรับปาก */
  committedItemIds: readonly string[];
  committedPoints: number;
}

export interface SprintItem {
  id: string;
  /** `null` = ยังไม่ประเมิน ซึ่งต่างจากประเมินแล้วได้ศูนย์ */
  points: number | null;
  done: boolean;
}

export class AlreadyStartedError extends Error {
  constructor(readonly sprintId: string) {
    super(`สปรินต์นี้เริ่มไปแล้ว — เริ่มซ้ำไม่ได้`);
    this.name = 'AlreadyStartedError';
  }
}

export class NotStartedError extends Error {
  constructor(readonly sprintId: string) {
    super('สปรินต์นี้ยังไม่เริ่ม — ปิดไม่ได้');
    this.name = 'NotStartedError';
  }
}

export class SprintClosedError extends Error {
  constructor(readonly sprintId: string) {
    super(
      'สปรินต์นี้ปิดไปแล้ว — แก้ไม่ได้อีก ' +
        'เพราะตัวเลขในรายงานของรอบที่ผ่านมาจะเปลี่ยนย้อนหลัง',
    );
    this.name = 'SprintClosedError';
  }
}

export class OneActiveSprintError extends Error {
  constructor(readonly activeId: string) {
    super('มีสปรินต์ที่กำลังทำอยู่แล้ว — ปิดอันเดิมก่อนจึงจะเริ่มอันใหม่ได้');
    this.name = 'OneActiveSprintError';
  }
}

/**
 * สปรินต์ที่ปิดแล้ว **แตะไม่ได้อีก**
 *
 * แยกออกมาเป็นฟังก์ชันของตัวเอง เพราะเป็นคำถามคนละข้อกับ "เริ่มได้ไหม"
 * และ "ปิดได้ไหม" · การเพิ่มงานเข้าสปรินต์ที่ยัง `planned` ต้องทำได้ —
 * ตอนแรกเขียนโดยเรียก `assertCanComplete` มาใช้ซ้ำ แล้วมันปฏิเสธด้วย
 * `NotStartedError` ซึ่งเป็นคำตอบของคำถามที่ไม่มีใครถาม
 *
 * เหตุผลที่ห้ามแตะ: ตัวเลขในรายงานของรอบที่ผ่านมาจะเปลี่ยนย้อนหลัง
 * และไม่มีใครรู้ว่าตัวเลขที่เคยเห็นในที่ประชุมเป็นตัวไหน
 */
export function assertNotClosed(sprint: SprintSnapshot): void {
  if (sprint.state === 'completed') throw new SprintClosedError(sprint.id);
}

/**
 * เริ่มสปรินต์นี้ได้ไหม
 *
 * **ทีมเดียวทำได้ทีละรอบ** — สองสปรินต์ที่ทำพร้อมกันทำให้คำถาม
 * "รอบนี้เราทำอะไรอยู่" ตอบไม่ได้ และความเร็วของทีมคำนวณไม่ได้
 */
export function assertCanStart(
  sprint: SprintSnapshot,
  othersInSameScope: readonly SprintSnapshot[],
): void {
  assertNotClosed(sprint);
  if (sprint.state === 'active') throw new AlreadyStartedError(sprint.id);

  /*
    ไม่ต้องกรองตัวเองออกจากรายการ — ด่านข้างบนปฏิเสธสปรินต์ที่ `active` ไปแล้ว
    ตัวมันเองจึงไม่มีทางเป็นตัวที่เจอตรงนี้ · เคยเขียน `s.id !== sprint.id`
    ไว้ด้วย แล้วลบทิ้งตอนพิสูจน์ว่าเทสต์แดงได้ **ก็ยังเขียว** เพราะไม่มีทาง
    ไปถึง — ด่านที่ไม่มีวันทำงาน คือด่านที่ไม่มี (บทเรียนใน CLAUDE.md)
  */
  const active = othersInSameScope.find((s) => s.state === 'active');
  if (active !== undefined) throw new OneActiveSprintError(active.id);
}

export function assertCanComplete(sprint: SprintSnapshot): void {
  assertNotClosed(sprint);
  if (sprint.state !== 'active') throw new NotStartedError(sprint.id);
}

export interface Commitment {
  committedItemIds: string[];
  committedPoints: number;
  /** งานที่ยังไม่ประเมิน — นับแยก ไม่กลืนเป็นศูนย์ */
  unestimated: number;
  startedAt: UtcDate;
}

/** แต้มที่นับได้จริง — ค่าที่ใส่ผิดต้องไม่ลดยอดรวม */
function usablePoints(p: number | null): number {
  if (p === null || !Number.isFinite(p) || p < 0) return 0;
  return p;
}

/**
 * ภาพตอนกดเริ่ม — คือคำรับปาก
 *
 * **งานที่ยังไม่ประเมินถูกนับแยก** · สปรินต์ที่มีงาน 20 ใบซึ่งยังไม่ประเมิน
 * สักใบ แล้วรายงานว่า "0 แต้ม" เป็นการโกหกด้วยการละเว้น — ตัวเลขที่อ่านแล้ว
 * เข้าใจผิด แย่กว่าไม่มีตัวเลข
 */
export function commitmentOf(items: readonly SprintItem[], now: UtcDate): Commitment {
  return {
    committedItemIds: items.map((i) => i.id),
    committedPoints: items.reduce((a, i) => a + usablePoints(i.points), 0),
    unestimated: items.filter((i) => i.points === null).length,
    startedAt: now,
  };
}

export interface Completion {
  doneIds: string[];
  /**
   * งานที่ยังไม่เสร็จ — **ส่งกลับให้ผู้เรียกจัดการต่อเสมอ**
   *
   * ถ้าเอนจินปิดสปรินต์แล้วเงียบ งานที่ค้างจะไม่อยู่ในสปรินต์ไหนเลยและไม่อยู่
   * ใน backlog ด้วย — หายจากทุกหน้าจอโดยไม่มีใครลบมัน
   */
  undoneIds: string[];
  completedPoints: number;
  /** งานที่เพิ่มเข้ามาหลังกดเริ่ม — ไม่ได้อยู่ในคำรับปาก */
  addedAfterStartIds: string[];
  addedAfterStartPoints: number;
  /** งานที่ถูกเอาออกหลังกดเริ่ม */
  removedAfterStartIds: string[];
  completedAt: UtcDate;
}

/**
 * ผลของการปิดสปรินต์
 *
 * รายงาน **สามกลุ่มแยกกัน**: ทำเสร็จ · ยังไม่เสร็จ · เพิ่มเข้ามาทีหลัง
 * — "ทำเสร็จ 40 แต้ม" ที่ซ่อนไว้ว่า 15 แต้มเพิ่งใส่เข้ามากลางทาง ทำให้ทีม
 * วางแผนรอบถัดไปด้วยความเร็วที่ไม่มีอยู่จริง
 */
export function completionOf(
  sprint: SprintSnapshot,
  itemsNow: readonly SprintItem[],
  now: UtcDate,
): Completion {
  const committed = new Set(sprint.committedItemIds);
  const present = new Set(itemsNow.map((i) => i.id));

  const added = itemsNow.filter((i) => !committed.has(i.id));
  return {
    doneIds: itemsNow.filter((i) => i.done).map((i) => i.id),
    undoneIds: itemsNow.filter((i) => !i.done).map((i) => i.id),
    completedPoints: itemsNow
      .filter((i) => i.done)
      .reduce((a, i) => a + usablePoints(i.points), 0),
    addedAfterStartIds: added.map((i) => i.id),
    addedAfterStartPoints: added.reduce((a, i) => a + usablePoints(i.points), 0),
    removedAfterStartIds: sprint.committedItemIds.filter((id) => !present.has(id)),
    completedAt: now,
  };
}

/** ผลของสปรินต์หนึ่งรอบที่บันทึกไว้ตอนปิด */
export interface SprintResult {
  sprintId: string;
  completedPoints: number;
}

export interface Velocity {
  /** `null` เมื่อยังไม่มีสปรินต์ที่ปิดแล้วเลย — **ไม่ใช่ศูนย์** */
  average: number | null;
  /** คำนวณจากกี่รอบ — ตัวเลขที่ไม่บอกข้อนี้ถูกเชื่อเกินจริง */
  usedSprints: number;
}

/**
 * ความเร็วของทีม
 *
 * **บอกเสมอว่าเฉลี่ยจากกี่รอบ** · ค่าเฉลี่ยจากสปรินต์เดียวคือ "แต้มของ
 * สปรินต์นั้น" ไม่ใช่ความเร็วของทีม · ตัวเลขที่ไม่บอกจำนวนรอบ ถูกเอาไปวางแผน
 * ราวกับเชื่อถือได้เท่ากับที่คำนวณจากสิบรอบ
 *
 * ยังไม่มีรอบไหนปิดเลยคืน `null` ไม่ใช่ศูนย์ — ศูนย์แปลว่า "ทำไม่ได้เลย"
 * ซึ่งเป็นคนละเรื่องกับ "ยังไม่มีข้อมูล"
 */
export function velocityOf(
  sprints: readonly SprintSnapshot[],
  results: readonly SprintResult[],
  lastN: number,
): Velocity {
  const byId = new Map(results.map((r) => [r.sprintId, r.completedPoints]));
  const closed = sprints
    .filter((s) => s.state === 'completed' && byId.has(s.id))
    .slice(-Math.max(1, Math.floor(lastN)));

  if (closed.length === 0) return { average: null, usedSprints: 0 };
  const total = closed.reduce((a, s) => a + (byId.get(s.id) ?? 0), 0);
  return { average: total / closed.length, usedSprints: closed.length };
}
