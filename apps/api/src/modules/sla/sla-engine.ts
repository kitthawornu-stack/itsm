/**
 * SLA Engine — คำนวณเวลาที่ใช้ไป เวลาที่เหลือ และจุดที่จะหลุด
 *
 * ทำงานจาก **รายการเหตุการณ์** ไม่ใช่จากสถานะปัจจุบัน
 * เหตุผล: ตั๋วที่ถูกพัก เปิดใหม่ หรือเปลี่ยนความสำคัญกลางทาง คำนวณย้อนหลังได้
 * เฉพาะเมื่อเก็บลำดับเหตุการณ์ไว้ ถ้าเก็บแค่ยอดสะสมจะแก้ข้อมูลย้อนหลังไม่ได้เลย
 *
 * เป็น pure function ทั้งหมด — ไม่อ่านนาฬิกาเอง เวลา "ตอนนี้" ต้องส่งเข้ามา
 * ซึ่งทำให้ทดสอบเคสข้ามวันหยุดยาวได้โดยไม่ต้องรอจริง
 */
import type { UtcDate } from '@itsm/types';

import {
  addWorkingMs,
  elapsedWorkingMs,
  nextWorkingMoment,
  type BusinessCalendar,
} from './business-calendar';

export type SlaEventKind =
  | 'start'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'reopen'
  | 'target-change';

export interface SlaEvent {
  kind: SlaEventKind;
  at: UtcDate;
  /** ใช้กับ target-change เท่านั้น — เป้าใหม่เป็นมิลลิวินาทีของเวลาทำการ */
  newTargetMs?: number;
}

export type SlaState = 'not-started' | 'running' | 'paused' | 'met' | 'breached';

export interface SlaStatus {
  state: SlaState;
  /** เวลาทำการที่ใช้ไปแล้ว */
  elapsedMs: number;
  /** เป้าหมายปัจจุบัน */
  targetMs: number;
  /** เวลาทำการที่เหลือ — 0 เมื่อหลุดแล้ว */
  remainingMs: number;
  /** จุดที่จะหลุด (เวลาจริง) — null เมื่อหยุดนาฬิกาอยู่ หรือหลุดไปแล้ว */
  breachAt: UtcDate | null;
  /**
   * จุดที่ **หลุดไปแล้ว** (เวลาจริง) — null เมื่อยังไม่หลุด
   *
   * ต่างจาก `breachAt` ซึ่งเป็นกำหนดในอนาคตและกลายเป็น null ทันทีที่หลุด
   * ถ้าไม่เก็บค่านี้ ระบบจะรู้ว่า "หลุดแล้ว" แต่ตอบไม่ได้ว่า "หลุดตอนไหน"
   * ซึ่งทำให้กู้การแจ้งเตือนที่ตกหล่นไม่ได้ และรายงานบอกไม่ได้ว่าช้าไปเท่าไร
   */
  breachedAt: UtcDate | null;
  /** สัดส่วนที่ใช้ไป 0–1 (เกิน 1 ได้เมื่อหลุดแล้ว) */
  ratio: number;
  /** true เมื่อเลยเป้าไปแล้ว ไม่ว่าจะจบหรือยัง */
  isBreached: boolean;
}

export class SlaEventOrderError extends Error {
  constructor(prev: SlaEvent, next: SlaEvent) {
    super(
      `ลำดับเหตุการณ์ SLA ผิด: ${next.kind} ที่ ${next.at.toISOString()} ` +
        `มาก่อน ${prev.kind} ที่ ${prev.at.toISOString()}`,
    );
    this.name = 'SlaEventOrderError';
  }
}

export class MissingTargetError extends Error {
  constructor() {
    super('target-change ต้องระบุ newTargetMs');
    this.name = 'MissingTargetError';
  }
}

/**
 * คำนวณสถานะ SLA ณ เวลา `now`
 *
 * @param initialTargetMs เป้าหมายเริ่มต้นเป็นมิลลิวินาทีของ **เวลาทำการ**
 */
export function computeSla(
  cal: BusinessCalendar,
  initialTargetMs: number,
  events: readonly SlaEvent[],
  now: UtcDate,
): SlaStatus {
  let targetMs = initialTargetMs;
  let elapsedMs = 0;
  let runningSince: UtcDate | null = null;
  let started = false;
  let stopped = false;

  let breachedAt: UtcDate | null = null;

  /**
   * บวกเวลาทำการของช่วงหนึ่ง พร้อมจับ **จุดที่ข้ามเป้าพอดี**
   *
   * ต้องจับตอนบวก ไม่ใช่คำนวณย้อนหลังจากยอดรวม เพราะเป้าอาจเปลี่ยนกลางทาง
   * และเวลาที่ใช้ไปกระจายอยู่หลายช่วงที่คั่นด้วยการพักและวันหยุด
   */
  const accrue = (from: UtcDate, to: UtcDate): void => {
    const segMs = elapsedWorkingMs(cal, from, to);
    if (breachedAt === null && elapsedMs + segMs > targetMs) {
      // เป้าที่แคบกว่าที่ใช้ไปแล้ว = ข้ามเป้าไปตั้งแต่ต้นช่วงนี้
      // ต้องดักไว้ ไม่งั้นจะเรียก addWorkingMs ด้วยระยะเวลาติดลบ
      // ซึ่งคืนค่าที่ดูถูกโดยบังเอิญ แต่ไม่มีใครรับประกันว่าจะถูกต่อไป
      breachedAt =
        targetMs <= elapsedMs ? from : addWorkingMs(cal, from, targetMs - elapsedMs);
    }
    elapsedMs += segMs;
  };

  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (e === undefined) continue;
    const prev = events[i - 1];
    if (prev !== undefined && e.at.getTime() < prev.at.getTime()) {
      throw new SlaEventOrderError(prev, e);
    }
    /**
     * นาฬิกาที่ปิดไปแล้วไม่รับเหตุการณ์อะไรอีก **ยกเว้นการเปิดใหม่**
     *
     * ต้อง `continue` ไม่ใช่ `break` — ถ้าออกจากลูปทันทีที่เจอเหตุการณ์
     * ที่ถูกละเว้น `reopen` ที่อยู่ถัดไปจะไม่มีวันถูกอ่าน และตั๋วที่เปิดใหม่
     * จะค้างอยู่ที่ met/breached ตลอดไปโดยไม่มี error ให้เห็น
     */
    if (stopped && e.kind !== 'reopen') continue;

    switch (e.kind) {
      case 'start':
        // เริ่มซ้ำไม่มีผล — ตั๋วที่ถูก reopen ใช้ resume ไม่ใช่ start
        if (!started) {
          started = true;
          runningSince = e.at;
        }
        break;

      case 'pause':
        if (runningSince !== null) {
          accrue(runningSince, e.at);
          runningSince = null;
        }
        break;

      case 'resume':
        // resume ขณะที่เดินอยู่แล้วไม่มีผล
        if (started && runningSince === null) runningSince = e.at;
        break;

      /**
       * เปิดใหม่ = **นาฬิกาเรือนใหม่** ไม่ใช่เรือนเดิมเดินต่อ (หมวด F)
       *
       * ต่างจาก `resume` ตรงนี้: resume คืนนาฬิกาที่พักไว้ให้เดินต่อจากยอดเดิม
       * ส่วน reopen เริ่มนับใหม่จากศูนย์ เพราะงานรอบใหม่คืองานคนละรอบ
       * และทีมได้เป้าใหม่เต็มจำนวนสำหรับรอบนั้น
       *
       * ถ้าต่อยอดจากรอบก่อนแทน ตั๋วที่เคยเกือบหลุดจะหลุดทันทีที่กดเปิดใหม่
       * ทั้งที่ยังไม่มีใครทำอะไรเลย
       *
       * เป้าไม่ถูกล้าง — ความสำคัญที่ยกระดับไปแล้วไม่ได้ย้อนกลับเองเพราะปิดงาน
       */
      case 'reopen':
        elapsedMs = 0;
        breachedAt = null;
        stopped = false;
        started = true;
        runningSince = e.at;
        break;

      case 'stop':
        if (runningSince !== null) {
          accrue(runningSince, e.at);
          runningSince = null;
        }
        stopped = true;
        break;

      case 'target-change': {
        // **เปลี่ยนเป้าไม่ล้างเวลาที่ใช้ไปแล้ว**
        // ตั๋วที่ยกระดับเป็น P1 หลังผ่านไป 3 ชั่วโมง อาจหลุดทันทีที่เปลี่ยน
        // ซึ่งถูกต้อง — ความเร่งด่วนที่สูงขึ้นย้อนหลังไปด้วย
        if (e.newTargetMs === undefined) throw new MissingTargetError();
        // ปิดยอดของช่วงที่ผ่านมาก่อนเปลี่ยนเป้า
        // แต่ละช่วงต้องถูกวัดกับเป้าที่ใช้อยู่จริงในช่วงนั้น ไม่ใช่เป้าล่าสุด
        // ถ้าไม่ปิดยอด `elapsedMs` ตรงนี้จะยังเป็นยอดของเหตุการณ์ก่อนหน้า
        // แล้วการเทียบข้างล่างจะตัดสินจากตัวเลขที่ล้าสมัย
        if (runningSince !== null) {
          accrue(runningSince, e.at);
          runningSince = e.at;
        }
        targetMs = e.newTargetMs;
        // เป้าที่เปลี่ยนย้อนหลังไปถึงเวลาที่ใช้ไปแล้ว จุดที่หลุดจึงต้องคิดใหม่
        // เป้าที่แคบลงจนต่ำกว่าที่ใช้ไปแล้ว = หลุด ณ วินาทีที่เปลี่ยนนั่นเอง
        // เป้าที่กว้างขึ้นจนเกินที่ใช้ไปแล้ว = กลับมาไม่หลุด ต้องล้างค่าเดิมทิ้ง
        breachedAt = elapsedMs > targetMs ? e.at : null;
        break;
      }
    }
  }

  // นับต่อจากเหตุการณ์สุดท้ายถึงตอนนี้ ถ้านาฬิกายังเดินอยู่
  if (runningSince !== null && now.getTime() > runningSince.getTime()) {
    accrue(runningSince, now);
  }

  const remainingMs = Math.max(0, targetMs - elapsedMs);
  const isBreached = elapsedMs > targetMs;

  let state: SlaState;
  if (stopped) state = isBreached ? 'breached' : 'met';
  else if (!started) state = 'not-started';
  else if (runningSince === null) state = 'paused';
  else state = isBreached ? 'breached' : 'running';

  // breachAt มีความหมายเฉพาะตอนนาฬิกาเดินอยู่และยังไม่หลุด
  const breachAt =
    !stopped && runningSince !== null && !isBreached
      ? addWorkingMs(cal, nextWorkingMoment(cal, now), remainingMs)
      : null;

  return {
    state,
    elapsedMs,
    targetMs,
    remainingMs,
    breachAt,
    breachedAt: isBreached ? breachedAt : null,
    ratio: targetMs === 0 ? 1 : elapsedMs / targetMs,
    isBreached,
  };
}

/**
 * เวลาที่ควรตั้งการแจ้งเตือน ณ สัดส่วนที่กำหนด
 *
 * ใช้กับ BullMQ delayed job — **ต้องยกเลิก job เก่าแล้วตั้งใหม่ทุกครั้งที่มี
 * เหตุการณ์** มิฉะนั้นจะได้เตือนซ้ำซ้อนจากตั๋วที่ถูกพักแล้วกลับมาเดินใหม่
 */
export function notificationTimes(
  cal: BusinessCalendar,
  status: SlaStatus,
  now: UtcDate,
  thresholds: readonly number[] = [0.5, 0.75, 1],
): Array<{ threshold: number; at: UtcDate }> {
  if (status.state !== 'running') return [];

  const out: Array<{ threshold: number; at: UtcDate }> = [];
  for (const t of thresholds) {
    const targetElapsed = status.targetMs * t;
    if (targetElapsed <= status.elapsedMs) continue;
    out.push({
      threshold: t,
      at: addWorkingMs(cal, nextWorkingMoment(cal, now), targetElapsed - status.elapsedMs),
    });
  }
  return out;
}
