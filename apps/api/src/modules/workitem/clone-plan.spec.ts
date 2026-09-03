/**
 * ข้อกำหนดของ "คัดลอกเรื่อง" — **เขียนก่อนโค้ด**
 *
 * ## ทำไมต้องมีไฟล์นี้
 *
 * งานที่ต้องแจ้งซ้ำ ๆ มีจริงในศูนย์บริการ (รับพนักงานใหม่ · ขอสิทธิ์ชุดเดิม ·
 * ตรวจเครื่องประจำเดือน) · การพิมพ์ใหม่ทุกครั้งทำให้ฟิลด์บังคับถูกกรอกไม่ตรงกัน
 * และเรื่องเดียวกันมีหลายหน้าตา
 *
 * ## สิ่งที่คัดลอกแล้วผิด และผิดแบบเงียบ
 *
 *   1. **คัดลอกสถานะมาด้วย** — ได้ตั๋วใหม่ที่ "ปิดแล้ว" ตั้งแต่วินาทีแรก
 *      ไม่มีใครทำ ไม่มีใครเห็นในคิว และ SLA ไม่เดิน
 *   2. **คัดลอกผลการแก้ไขมาด้วย** — เรื่องที่ยังไม่มีใครแตะ มีคำตอบแล้ว
 *   3. **คัดลอกผู้รับผิดชอบมาด้วย** — มอบงานให้คนที่ไม่รู้ตัว และคนนั้นอาจ
 *      ลาออกไปแล้ว · เรื่องใหม่ต้องผ่านการมอบหมายตามปกติ
 *   4. **คัดลอกวันครบกำหนดมาด้วย** — กำหนดที่ผ่านไปแล้ว ทำให้เรื่องใหม่
 *      หลุด SLA ตั้งแต่ยังไม่เริ่ม
 *   5. **ไม่คัดลอกฟิลด์บังคับ** — ตรงข้ามกับสี่ข้อบน · ฟิลด์บังคับคือเหตุผล
 *      ทั้งหมดที่คนอยากคัดลอก ถ้าไม่ได้มาด้วยก็ไม่ต่างจากกดสร้างใหม่
 */
import { describe, expect, it } from 'vitest';

import { CLONE_PREFIX, planClone, type CloneSource } from './clone-plan';

const source: CloneSource = {
  summary: 'ขอสิทธิ์เข้าโฟลเดอร์ฝ่ายบัญชี',
  description: 'ให้สิทธิ์อ่านอย่างเดียว',
  issueTypeName: 'Incident',
  projectKey: 'SD',
  priorityRank: 3,
  fields: { impact: 'ทั้งองค์กร', urgency: 'สูง' },
};

describe('คัดลอกเรื่อง · สิ่งที่ติดไปด้วย', () => {
  it('หัวข้อ รายละเอียด ชนิด และความสำคัญ ติดไปด้วย', () => {
    const plan = planClone(source);
    expect(plan.description).toBe('ให้สิทธิ์อ่านอย่างเดียว');
    expect(plan.issueTypeName).toBe('Incident');
    expect(plan.projectKey).toBe('SD');
    expect(plan.priorityRank).toBe(3);
  });

  /**
   * **ฟิลด์บังคับคือเหตุผลทั้งหมดที่คนอยากคัดลอก**
   *
   * ถ้าไม่ได้มาด้วย การกดคัดลอกก็ไม่ต่างจากกดสร้างใหม่ แล้วฟีเจอร์นี้
   * ไม่มีเหตุผลที่จะมีอยู่
   */
  it('**ค่าฟิลด์กำหนดเองติดไปด้วยครบ**', () => {
    expect(planClone(source).fields).toEqual({ impact: 'ทั้งองค์กร', urgency: 'สูง' });
  });

  /**
   * **สำเนาเป็นสำเนา ไม่ใช่การอ้างถึงของเดิม**
   *
   * ถ้าคืนอ็อบเจกต์เดิมออกไป ผู้เรียกที่แก้ค่าต่อจะไปแก้ของใบต้นทางด้วย
   */
  it('**ค่าฟิลด์ที่คืนออกไปเป็นสำเนา ไม่ใช่ตัวเดิม**', () => {
    const plan = planClone(source);
    expect(plan.fields).not.toBe(source.fields);
  });

  /**
   * **หัวข้อต้องบอกว่าเป็นสำเนา**
   *
   * สองใบที่หัวข้อเหมือนกันเป๊ะในคิวเดียวกัน ทำให้คนทำงานซ้ำกันโดยไม่รู้ตัว ·
   * คำนำหน้าอยู่ **ข้างหน้า** เพราะคิวตัดข้อความท้ายทิ้งเมื่อยาวเกิน
   */
  it('**หัวข้อมีคำนำหน้าบอกว่าเป็นสำเนา**', () => {
    expect(planClone(source).summary).toBe(`${CLONE_PREFIX}ขอสิทธิ์เข้าโฟลเดอร์ฝ่ายบัญชี`);
  });

  /**
   * คัดลอกสำเนาอีกที ต้องไม่ได้คำนำหน้าซ้อนกันเรื่อย ๆ —
   * `[สำเนา] [สำเนา] [สำเนา] …` กินที่หัวข้อจนอ่านไม่ออก
   */
  it('**คัดลอกสำเนาซ้ำ ไม่ซ้อนคำนำหน้า**', () => {
    const once = planClone(source);
    const twice = planClone({ ...source, summary: once.summary });
    expect(twice.summary).toBe(once.summary);
  });

  it('หัวข้อที่ยาวจนเกินเพดาน ถูกตัดหลังใส่คำนำหน้า ไม่ใช่ก่อน', () => {
    const long = 'ก'.repeat(600);
    const plan = planClone({ ...source, summary: long });
    expect(plan.summary.startsWith(CLONE_PREFIX)).toBe(true);
    expect(plan.summary.length).toBeLessThanOrEqual(500);
  });

  it('ไม่มีรายละเอียด ก็คัดลอกได้ — คืนค่าว่าง ไม่ใช่ undefined ที่ผู้เรียกต้องเดา', () => {
    const plan = planClone({ ...source, description: null });
    expect(plan.description).toBe('');
  });

  it('ไม่มีความสำคัญ ก็คัดลอกได้', () => {
    expect(planClone({ ...source, priorityRank: null }).priorityRank).toBeNull();
  });

  it('ไม่แก้ข้อมูลที่รับเข้ามา', () => {
    const snapshot = JSON.stringify(source);
    planClone(source);
    expect(JSON.stringify(source)).toBe(snapshot);
  });
});
