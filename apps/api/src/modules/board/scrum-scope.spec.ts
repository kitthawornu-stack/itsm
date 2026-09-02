/**
 * ข้อกำหนดของ "กระดานแบบ Scrum แสดงงานของรอบไหน" — **เขียนก่อนโค้ด**
 *
 * ## ทำไมต้องมีไฟล์นี้
 *
 * กระดานแบบ Kanban แสดงงานทั้งโปรเจกต์ · กระดานแบบ Scrum แสดง **เฉพาะงาน
 * ในรอบที่กำลังทำอยู่** — นั่นคือความต่างทั้งหมด และเป็นจุดที่ผิดแล้วเงียบ
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 *   1. **ไม่มีรอบที่กำลังทำ แล้วแสดงงานทั้งโปรเจกต์** — คนเห็นกระดานเต็ม
 *      แล้วเชื่อว่านั่นคือรอบนี้ · ทีมจะวางแผนจากงานที่ไม่ได้รับปากว่าจะทำ
 *   2. **ขอบเขตว่างเปล่า แล้วแปลว่าไม่กรอง** — กติกาเดิมของโปรเจกต์นี้:
 *      รายการที่ใช้กรองว่างเปล่า ต้องแปลว่าไม่เห็นอะไรเลย ไม่ใช่เห็นทุกอย่าง
 *   3. **มีรอบที่ active สองรอบพร้อมกัน แล้วเลือกมาอันเดียวเงียบ ๆ** —
 *      งานของอีกครึ่งทีมหายไปจากกระดานโดยไม่มีอะไรบอก · สภาพนี้ไม่ควรเกิด
 *      แต่ถ้าเกิด **ต้องดังกว่าการเดา**
 */
import { describe, expect, it } from 'vitest';

import { scrumScopeOf, type SprintRef } from './scrum-scope';

const s = (id: string, state: string, name = `รอบ ${id}`): SprintRef => ({
  id,
  name,
  goal: null,
  state,
});

describe('ขอบเขตของกระดาน Scrum', () => {
  it('มีรอบที่กำลังทำอยู่รอบเดียว — ใช้รอบนั้น', () => {
    const scope = scrumScopeOf([s('1', 'completed'), s('2', 'active'), s('3', 'planned')]);
    expect(scope.kind).toBe('sprint');
    if (scope.kind === 'sprint') {
      expect(scope.sprintId).toBe('2');
      expect(scope.name).toBe('รอบ 2');
    }
  });

  it('เป้าหมายของรอบถูกส่งต่อไปให้หน้าจอ — เป็นสิ่งเดียวที่ตอบว่ารอบนี้จะได้อะไร', () => {
    const withGoal: SprintRef = { id: '9', name: 'รอบ 9', goal: 'ปิดงานค้างจากไตรมาสก่อน', state: 'active' };
    const scope = scrumScopeOf([withGoal]);
    expect(scope.kind === 'sprint' && scope.goal).toBe('ปิดงานค้างจากไตรมาสก่อน');
  });

  /**
   * **หัวใจข้อที่หนึ่ง**
   *
   * ไม่มีรอบที่กำลังทำ **ต้องไม่ตกไปแสดงงานทั้งโปรเจกต์** · คนที่เห็นกระดาน
   * เต็มจะเชื่อว่านั่นคือรอบนี้ แล้ววางแผนจากงานที่ไม่มีใครรับปากว่าจะทำ
   */
  it('**ยังไม่เริ่มรอบไหนเลย — บอกว่ายังไม่มีรอบ ไม่ใช่แสดงทั้งโปรเจกต์**', () => {
    const scope = scrumScopeOf([s('1', 'planned'), s('2', 'planned')]);
    expect(scope.kind).toBe('no-active');
    if (scope.kind === 'no-active') {
      expect(scope.planned).toBe(2);
      expect(scope.completed).toBe(0);
    }
  });

  it('รอบจบไปหมดแล้ว — บอกจำนวนที่จบ เพื่อให้ข้อความบนหน้าจอมีประโยชน์', () => {
    const scope = scrumScopeOf([s('1', 'completed'), s('2', 'completed')]);
    expect(scope.kind).toBe('no-active');
    if (scope.kind === 'no-active') expect(scope.completed).toBe(2);
  });

  /**
   * โปรเจกต์ที่ไม่ได้ทำงานเป็นรอบ (เช่นศูนย์บริการ) ต่างจากโปรเจกต์ที่ทำเป็นรอบ
   * แต่ยังไม่เริ่มรอบ · ข้อความที่ควรบอกคนก็ต่างกัน
   */
  it('**โปรเจกต์ที่ไม่มีสปรินต์เลย ต่างจากยังไม่เริ่มรอบ**', () => {
    expect(scrumScopeOf([]).kind).toBe('not-scrum');
  });

  /**
   * **หัวใจข้อที่สาม**
   *
   * สองรอบ active พร้อมกันไม่ควรเกิด · ถ้าเกิด การเลือกมาอันเดียวเงียบ ๆ
   * ทำให้งานของอีกครึ่งทีมหายไปจากกระดานโดยไม่มีอะไรบอก
   */
  it('**มีรอบที่กำลังทำมากกว่าหนึ่ง — รายงาน ไม่ใช่เดา**', () => {
    const scope = scrumScopeOf([s('1', 'active'), s('2', 'active')]);
    expect(scope.kind).toBe('ambiguous');
    if (scope.kind === 'ambiguous') expect(scope.names).toEqual(['รอบ 1', 'รอบ 2']);
  });

  it('สถานะที่ไม่รู้จัก ไม่ถูกนับว่ากำลังทำอยู่', () => {
    const scope = scrumScopeOf([s('1', 'อะไรก็ไม่รู้')]);
    expect(scope.kind).toBe('no-active');
  });

  it('ไม่แก้ข้อมูลที่รับเข้ามา', () => {
    const list = [s('1', 'active'), s('2', 'planned')];
    const snapshot = JSON.stringify(list);
    scrumScopeOf(list);
    expect(JSON.stringify(list)).toBe(snapshot);
  });
});
