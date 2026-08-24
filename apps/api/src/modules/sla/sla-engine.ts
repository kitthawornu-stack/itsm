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

export type SlaEventKind = 'start' | 'pause' | 'resume' | 'stop' | 'target-change';

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
  /** จุดที่จะหลุด (เวลาจริง) — null เมื่อหยุดนาฬิกาอยู่ หรือจบแล้ว */
  breachAt: UtcDate | null;
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

  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (e === undefined) continue;
    const prev = events[i - 1];
    if (prev !== undefined && e.at.getTime() < prev.at.getTime()) {
      throw new SlaEventOrderError(prev, e);
    }
    if (stopped) break;

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
          elapsedMs += elapsedWorkingMs(cal, runningSince, e.at);
          runningSince = null;
        }
        break;

      case 'resume':
        // resume ขณะที่เดินอยู่แล้วไม่มีผล
        if (started && runningSince === null) runningSince = e.at;
        break;

      case 'stop':
        if (runningSince !== null) {
          elapsedMs += elapsedWorkingMs(cal, runningSince, e.at);
          runningSince = null;
        }
        stopped = true;
        break;

      case 'target-change': {
        // **เปลี่ยนเป้าไม่ล้างเวลาที่ใช้ไปแล้ว**
        // ตั๋วที่ยกระดับเป็น P1 หลังผ่านไป 3 ชั่วโมง อาจหลุดทันทีที่เปลี่ยน
        // ซึ่งถูกต้อง — ความเร่งด่วนที่สูงขึ้นย้อนหลังไปด้วย
        if (e.newTargetMs === undefined) throw new MissingTargetError();
        targetMs = e.newTargetMs;
        break;
      }
    }
  }

  // นับต่อจากเหตุการณ์สุดท้ายถึงตอนนี้ ถ้านาฬิกายังเดินอยู่
  if (runningSince !== null && now.getTime() > runningSince.getTime()) {
    elapsedMs += elapsedWorkingMs(cal, runningSince, now);
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
