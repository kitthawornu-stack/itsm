/**
 * ผลกระทบของปัญหา — เทสต์เป็นข้อกำหนด เขียนก่อนโค้ด
 *
 * ITIL แยก **เรื่องที่เกิด** (incident) ออกจาก **สาเหตุ** (problem) · ระบบมี
 * ความสัมพันธ์ `เป็นสาเหตุของ` อยู่แล้ว แต่รายการลิงก์เปล่า ๆ ตอบคำถามที่
 * ผู้จัดการถามไม่ได้: **"ปัญหานี้ทำให้เกิดเรื่องไปแล้วกี่ใบ ยังค้างกี่ใบ
 * เริ่มตั้งแต่เมื่อไร และยังเกิดซ้ำอยู่หรือหยุดแล้ว"**
 *
 * ห้าข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **"ยังค้าง" ดูจากหมวดของสถานะ ไม่ใช่จาก `resolvedAt`** — หน้าคิวนับ
 *      แบบนั้น · ถ้าสองที่นับคนละแบบ ตัวเลขบนสองหน้าจอจะขัดกันโดยไม่มีใครผิด
 *   2. **เวลาเริ่มมาจากใบที่ถูกทำให้เกิด ไม่ใช่จากตัวปัญหา** — ปัญหาถูกบันทึก
 *      หลังจากมีเรื่องเข้ามาหลายใบแล้วเสมอ · ใช้เวลาของตัวปัญหาจะทำให้
 *      "ปัญหานี้กวนมานานแค่ไหน" สั้นกว่าความจริงทุกครั้ง
 *   3. **"ยังเกิดซ้ำ" ต้องใช้ "ตอนนี้" ที่ส่งเข้ามา** — ห้ามอ่านนาฬิกาเอง
 *      (กติกาเดียวกับ SLA Engine) มิฉะนั้นทดสอบเคสข้ามเดือนไม่ได้
 *   4. **ไม่มีใบไหนเกี่ยวเลย ต้องตอบศูนย์ ไม่ใช่ `null`** — ผู้เรียกที่ต้อง
 *      เช็ค null ก่อนทุกครั้ง จะลืมเช็คสักที่หนึ่งเสมอ
 *   5. **โปรเจกต์เรียงตามจำนวนที่กระทบ** — ผู้อ่านต้องเห็นที่หนักที่สุดก่อน
 */
import { describe, expect, it } from 'vitest';
import { toUtcDate } from '@itsm/types';

import {
  RECURRING_DAYS,
  summarizeImpact,
  type CausedIncident,
} from './problem-impact';

const at = (iso: string): ReturnType<typeof toUtcDate> => toUtcDate(iso);
const NOW = at('2027-03-01T00:00:00.000Z');

/** `createdAt` เป็นสตริงในเทสต์เพื่ออ่านง่าย — แปลงเป็น `UtcDate` ตรงนี้ที่เดียว */
interface IncidentOptions {
  createdAt: string;
  statusCategory?: CausedIncident['statusCategory'];
  projectKey?: string;
  resolvedAt?: CausedIncident['resolvedAt'];
}

function incident(key: string, o: IncidentOptions): CausedIncident {
  return {
    itemKey: key,
    summary: `เรื่อง ${key}`,
    statusCategory: o.statusCategory ?? 'TODO',
    projectKey: o.projectKey ?? 'SD',
    createdAt: at(o.createdAt),
    resolvedAt: o.resolvedAt ?? null,
  };
}

describe('A · การนับ', () => {
  const list = [
    incident('SD-1', { createdAt: '2027-01-05T03:00:00.000Z', statusCategory: 'DONE' }),
    incident('SD-2', { createdAt: '2027-01-20T03:00:00.000Z', statusCategory: 'IN_PROGRESS' }),
    incident('SD-3', { createdAt: '2027-02-10T03:00:00.000Z', statusCategory: 'TODO' }),
  ];

  it('**"ยังค้าง" ดูจากหมวดของสถานะ ไม่ใช่จาก `resolvedAt`**', () => {
    /*
      หน้าคิวนับแบบนี้ · ถ้าที่นี่นับจาก `resolvedAt` ตัวเลขสองหน้าจอจะขัดกัน
      โดยไม่มีใครผิด — และเรื่องที่ถูกปิดโดยไม่ได้ระบุผลการแก้ไข
      (ยกเลิก · ซ้ำ) จะถูกนับว่ายังค้างตลอดไป
    */
    const closedWithoutResolvedAt = incident('SD-9', {
      createdAt: '2027-01-01T00:00:00.000Z',
      statusCategory: 'DONE',
      resolvedAt: null,
    });
    const r = summarizeImpact([...list, closedWithoutResolvedAt], NOW);
    expect(r.total).toBe(4);
    expect(r.open).toBe(2);
    expect(r.resolved).toBe(2);
  });

  it('**ไม่มีใบไหนเกี่ยวเลย ตอบศูนย์ ไม่ใช่ `null`**', () => {
    const r = summarizeImpact([], NOW);
    expect(r).toEqual({
      total: 0,
      open: 0,
      resolved: 0,
      projects: [],
      firstSeen: null,
      lastSeen: null,
      stillRecurring: false,
      spanMs: 0,
    });
  });

  it('**รายการว่างไม่มีวัน "ยังเกิดซ้ำ" ไม่ว่า "ตอนนี้" จะเป็นเมื่อไร**', () => {
    /*
      เคสข้างบนผ่านได้แม้ไม่มีทางลัดสำหรับรายการว่าง เพราะทางปกติบังเอิญ
      ให้คำตอบเดียวกัน: เวลาของใบแรกกลายเป็น 0 แล้ว `0 >= now - 30 วัน`
      เป็นเท็จพอดีเมื่อ "ตอนนี้" อยู่ปี 2570 — ลบทางลัดทิ้งก็ยังเขียว
      (พิสูจน์แล้วตอนลบทีละบรรทัด)

      แต่ความถูกต้องนั้นมาจากตัวเลขที่บังเอิญ ไม่ใช่จากตรรกะ · เมื่อ "ตอนนี้"
      อยู่ใกล้จุดเริ่มของเวลา (นาฬิกาที่ตั้งผิด · เทสต์ที่ฉีดเวลาเข้ามา)
      มันจะตอบว่าปัญหาที่ไม่มีเรื่องเลย "ยังเกิดซ้ำอยู่"
    */
    const nearEpoch = at('1970-01-10T00:00:00.000Z');
    expect(summarizeImpact([], nearEpoch).stillRecurring).toBe(false);
    expect(summarizeImpact([], nearEpoch).firstSeen).toBeNull();
  });
});

describe('B · ช่วงเวลา', () => {
  it('**เวลาเริ่มมาจากใบที่เก่าที่สุด ไม่ใช่ใบแรกในอาร์เรย์**', () => {
    /*
      ข้อมูลมาจากฐานข้อมูลซึ่งไม่รับประกันลำดับ · ถ้าใช้ใบแรกในอาร์เรย์
      "ปัญหานี้กวนมานานแค่ไหน" จะเปลี่ยนไปทุกครั้งที่คิวรีคืนลำดับต่างกัน
    */
    const shuffled = [
      incident('SD-กลาง', { createdAt: '2027-01-20T03:00:00.000Z' }),
      incident('SD-เก่าสุด', { createdAt: '2026-11-02T03:00:00.000Z' }),
      incident('SD-ใหม่สุด', { createdAt: '2027-02-10T03:00:00.000Z' }),
    ];
    const r = summarizeImpact(shuffled, NOW);
    expect(r.firstSeen?.toISOString()).toBe('2026-11-02T03:00:00.000Z');
    expect(r.lastSeen?.toISOString()).toBe('2027-02-10T03:00:00.000Z');
    expect(r.spanMs).toBe(Date.parse('2027-02-10T03:00:00.000Z') - Date.parse('2026-11-02T03:00:00.000Z'));
  });

  it('ใบเดียว = ช่วงเวลาศูนย์ ไม่ใช่ค่าติดลบ', () => {
    const r = summarizeImpact([incident('SD-1', { createdAt: '2027-01-05T03:00:00.000Z' })], NOW);
    expect(r.spanMs).toBe(0);
    expect(r.firstSeen?.toISOString()).toBe(r.lastSeen?.toISOString());
  });
});

describe('C · ยังเกิดซ้ำอยู่ไหม', () => {
  it('**มีใบใหม่ในช่วงที่กำหนด = ยังเกิดซ้ำ**', () => {
    const recent = new Date(NOW.getTime() - (RECURRING_DAYS - 1) * 86_400_000).toISOString();
    expect(summarizeImpact([incident('SD-1', { createdAt: recent })], NOW).stillRecurring).toBe(
      true,
    );
  });

  it('**ใบล่าสุดเก่ากว่านั้น = หยุดแล้ว** — ปัญหาที่แก้ไปแล้วต้องเลิกเตือน', () => {
    /*
      ปัญหาที่ยังเปิดค้างเพราะไม่มีใครปิดใบ แต่ไม่มีเรื่องใหม่มาเป็นเดือน
      ไม่ใช่ปัญหาที่ยังกวนอยู่ · การเตือนต่อไปเรื่อย ๆ ทำให้คนเมินคำเตือนทั้งหมด
    */
    const old = new Date(NOW.getTime() - (RECURRING_DAYS + 1) * 86_400_000).toISOString();
    expect(summarizeImpact([incident('SD-1', { createdAt: old })], NOW).stillRecurring).toBe(false);
  });

  it('**เขตแดนพอดี = ยังเกิดซ้ำ**', () => {
    // จุดที่ `<` กับ `<=` ให้คำตอบต่างกัน
    const edge = new Date(NOW.getTime() - RECURRING_DAYS * 86_400_000).toISOString();
    expect(summarizeImpact([incident('SD-1', { createdAt: edge })], NOW).stillRecurring).toBe(true);
  });

  it('ใบที่เกิดในอนาคต (ข้อมูลเพี้ยน) ไม่ทำให้พัง', () => {
    const future = new Date(NOW.getTime() + 86_400_000).toISOString();
    const r = summarizeImpact([incident('SD-1', { createdAt: future })], NOW);
    expect(r.stillRecurring).toBe(true);
    expect(r.total).toBe(1);
  });
});

describe('D · โปรเจกต์ที่กระทบ', () => {
  it('**เรียงตามจำนวนที่กระทบ มากไปน้อย**', () => {
    /*
      ผู้อ่านต้องเห็นที่หนักที่สุดก่อน · เรียงตามตัวอักษรทำให้โปรเจกต์ที่มี
      เรื่องใบเดียวขึ้นก่อนโปรเจกต์ที่มีสามสิบใบ เมื่อชื่อมันมาก่อน
    */
    const list = [
      incident('HR-1', { createdAt: '2027-01-01T00:00:00.000Z', projectKey: 'HR' }),
      incident('SD-1', { createdAt: '2027-01-02T00:00:00.000Z', projectKey: 'SD' }),
      incident('SD-2', { createdAt: '2027-01-03T00:00:00.000Z', projectKey: 'SD' }),
      incident('SD-3', { createdAt: '2027-01-04T00:00:00.000Z', projectKey: 'SD' }),
    ];
    expect(summarizeImpact(list, NOW).projects).toEqual([
      { key: 'SD', count: 3 },
      { key: 'HR', count: 1 },
    ]);
  });

  it('จำนวนเท่ากันเรียงตามชื่อ — ผลลัพธ์ต้องไม่สลับไปมาระหว่างการเรียกสองครั้ง', () => {
    const list = [
      incident('SD-1', { createdAt: '2027-01-02T00:00:00.000Z', projectKey: 'SD' }),
      incident('HR-1', { createdAt: '2027-01-01T00:00:00.000Z', projectKey: 'HR' }),
    ];
    expect(summarizeImpact(list, NOW).projects).toEqual([
      { key: 'HR', count: 1 },
      { key: 'SD', count: 1 },
    ]);
  });
});
