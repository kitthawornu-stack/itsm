/**
 * กระดานแบบ Scrum แสดงงานของรอบไหน
 *
 * กระดานแบบ Kanban แสดงงานทั้งโปรเจกต์ · แบบ Scrum แสดง **เฉพาะงานในรอบ
 * ที่กำลังทำอยู่** — นั่นคือความต่างทั้งหมด
 *
 * ฟังก์ชันบริสุทธิ์ · ไม่แตะฐานข้อมูล ไม่อ่านนาฬิกา · "รอบไหนกำลังทำอยู่"
 * อ่านจาก `state` ที่บันทึกไว้ ไม่ใช่เดาจากวันที่ — สปรินต์ที่เลยกำหนดแล้ว
 * แต่ยังไม่ถูกปิด ยังเป็นรอบที่ทีมทำอยู่จริง
 */

/** ตรงกับ `SprintState` ใน `sprint-plan.ts` — ค่าอื่นถือว่าไม่ได้กำลังทำ */
const ACTIVE = 'active';
const PLANNED = 'planned';
const COMPLETED = 'completed';

export interface SprintRef {
  /**
   * เป็น `string` ไม่ใช่ `bigint` โดยตั้งใจ
   *
   * ค่านี้เดินทางออกไปทาง JSON · `JSON.stringify` **โยน TypeError กับ BigInt**
   * ซึ่งกลายเป็น HTTP 500 ที่ไม่มีข้อความอะไรเลย · เทสต์ที่เรียก service
   * ตรง ๆ ไม่เจอ เพราะไม่เคยผ่านชั้น serialise — ทุก id ในโปรเจกต์นี้จึงเป็น
   * `string` ตอนออกจากชั้น service (`statusId` ของคอลัมน์ก็เป็นแบบเดียวกัน)
   */
  id: string;
  name: string;
  goal: string | null;
  state: string;
}

/**
 * ขอบเขตของกระดาน
 *
 * สี่สถานะที่ต่างกันจริง — ไม่ยุบรวมเป็น "มี/ไม่มี" เพราะข้อความที่ควรบอกคน
 * ต่างกันทุกกรณี และการยุบรวมทำให้หน้าจอต้องเดาเอง
 */
export type ScrumScope =
  | { kind: 'sprint'; sprintId: string; name: string; goal: string | null }
  /** ทำงานเป็นรอบ แต่ยังไม่มีรอบไหนกำลังทำอยู่ */
  | { kind: 'no-active'; planned: number; completed: number }
  /** โปรเจกต์นี้ไม่ได้ทำงานเป็นรอบเลย เช่นศูนย์บริการ */
  | { kind: 'not-scrum' }
  /** ไม่ควรเกิด — แต่ถ้าเกิดต้องดังกว่าการเดา */
  | { kind: 'ambiguous'; names: string[] };

export function scrumScopeOf(sprints: readonly SprintRef[]): ScrumScope {
  if (sprints.length === 0) return { kind: 'not-scrum' };

  const active = sprints.filter((s) => s.state === ACTIVE);

  /*
    **สองรอบที่กำลังทำพร้อมกัน ต้องรายงาน ไม่ใช่เลือกมาอันเดียว**

    การเลือกเงียบ ๆ ทำให้งานของอีกครึ่งทีมหายไปจากกระดาน โดยที่กระดาน
    ยังดูปกติทุกประการ · สภาพนี้ไม่ควรเกิด ซึ่งเป็นเหตุผลที่ต้องดัง
    ไม่ใช่เหตุผลที่จะเพิกเฉย
  */
  if (active.length > 1) return { kind: 'ambiguous', names: active.map((s) => s.name) };

  const one = active[0];
  if (one !== undefined) {
    return { kind: 'sprint', sprintId: one.id, name: one.name, goal: one.goal };
  }

  /*
    ไม่มีรอบที่กำลังทำ — **ต้องไม่ตกไปแสดงงานทั้งโปรเจกต์** · คนที่เห็นกระดาน
    เต็มจะเชื่อว่านั่นคือรอบนี้ แล้ววางแผนจากงานที่ไม่มีใครรับปากว่าจะทำ ·
    บอกจำนวนที่วางไว้และที่จบแล้วไปด้วย เพื่อให้ข้อความบนหน้าจอมีประโยชน์
    มากกว่าคำว่า "ไม่มี"
  */
  return {
    kind: 'no-active',
    planned: sprints.filter((s) => s.state === PLANNED).length,
    completed: sprints.filter((s) => s.state === COMPLETED).length,
  };
}
