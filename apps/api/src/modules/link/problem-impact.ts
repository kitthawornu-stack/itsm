/**
 * ผลกระทบของปัญหา
 *
 * ITIL แยก **เรื่องที่เกิด** (incident) ออกจาก **สาเหตุ** (problem) · ระบบมี
 * ความสัมพันธ์ `เป็นสาเหตุของ` อยู่แล้ว แต่รายการลิงก์เปล่า ๆ ตอบคำถามที่
 * ผู้จัดการถามไม่ได้: "ปัญหานี้ทำให้เกิดเรื่องไปแล้วกี่ใบ ยังค้างกี่ใบ
 * เริ่มตั้งแต่เมื่อไร และยังเกิดซ้ำอยู่หรือหยุดแล้ว"
 *
 * เป็นฟังก์ชันบริสุทธิ์ · **"ตอนนี้" ส่งเข้ามา ไม่อ่านนาฬิกาเอง**
 * (กติกาเดียวกับ SLA Engine)
 */
import type { UtcDate } from '@itsm/types';

export interface CausedIncident {
  itemKey: string;
  summary: string;
  /** หมวดของสถานะ — เป็นตัวตัดสินว่า "ยังค้าง" ไม่ใช่ `resolvedAt` */
  statusCategory: 'TODO' | 'IN_PROGRESS' | 'DONE';
  projectKey: string;
  createdAt: UtcDate;
  resolvedAt: UtcDate | null;
}

export interface ProjectCount {
  key: string;
  count: number;
}

export interface ProblemImpact {
  total: number;
  open: number;
  resolved: number;
  /** เรียงตามจำนวนมากไปน้อย แล้วตามชื่อ — ที่หนักที่สุดต้องอ่านเจอก่อน */
  projects: ProjectCount[];
  /** เวลาที่เรื่องใบแรกเข้ามา — `null` เมื่อยังไม่มีใบไหนเลย */
  firstSeen: UtcDate | null;
  lastSeen: UtcDate | null;
  /** มีเรื่องใหม่ภายใน `RECURRING_DAYS` วันที่ผ่านมา */
  stillRecurring: boolean;
  /** ปัญหานี้สร้างเรื่องมาแล้วเป็นเวลาเท่าไร — ใบเดียวคือศูนย์ ไม่ใช่ค่าติดลบ */
  spanMs: number;
}

/**
 * ช่วงที่ยังถือว่า "เกิดซ้ำอยู่"
 *
 * ปัญหาที่ยังเปิดค้างเพราะไม่มีใครปิดใบ แต่ไม่มีเรื่องใหม่มาเป็นเดือน
 * **ไม่ใช่ปัญหาที่ยังกวนอยู่** · การเตือนต่อไปเรื่อย ๆ ทำให้คนเมินคำเตือนทั้งหมด
 * ซึ่งแย่กว่าไม่มีคำเตือน
 */
export const RECURRING_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * สรุปผลกระทบจากรายการเรื่องที่ปัญหานี้ทำให้เกิด
 *
 * @param now "ตอนนี้" — ส่งเข้ามาเสมอ ห้ามอ่านนาฬิกาในไฟล์นี้
 */
export function summarizeImpact(
  incidents: readonly CausedIncident[],
  now: UtcDate,
): ProblemImpact {
  if (incidents.length === 0) {
    // ตอบศูนย์ ไม่ใช่ `null` — ผู้เรียกที่ต้องเช็ค null จะลืมเช็คสักที่หนึ่งเสมอ
    return {
      total: 0,
      open: 0,
      resolved: 0,
      projects: [],
      firstSeen: null,
      lastSeen: null,
      stillRecurring: false,
      spanMs: 0,
    };
  }

  /*
    **"ยังค้าง" ดูจากหมวดของสถานะ ไม่ใช่จาก `resolvedAt`** — หน้าคิวนับแบบนี้ ·
    ถ้าที่นี่นับจาก `resolvedAt` ตัวเลขสองหน้าจอจะขัดกันโดยไม่มีใครผิด และเรื่อง
    ที่ถูกปิดโดยไม่ได้ระบุผลการแก้ไข (ยกเลิก · ซ้ำ) จะถูกนับว่ายังค้างตลอดไป
  */
  const resolved = incidents.filter((i) => i.statusCategory === 'DONE').length;

  const counts = new Map<string, number>();
  for (const i of incidents) counts.set(i.projectKey, (counts.get(i.projectKey) ?? 0) + 1);
  const projects = [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    // จำนวนเท่ากันเรียงตามชื่อ — ลำดับต้องไม่สลับไปมาระหว่างการเรียกสองครั้ง
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  /*
    **เวลาเริ่มมาจากใบที่เก่าที่สุด ไม่ใช่ใบแรกในอาร์เรย์** — ข้อมูลมาจาก
    ฐานข้อมูลซึ่งไม่รับประกันลำดับ · และมาจากใบที่ถูกทำให้เกิด ไม่ใช่จากตัวปัญหา
    เพราะปัญหาถูกบันทึกหลังจากมีเรื่องเข้ามาหลายใบแล้วเสมอ
  */
  let firstMs = incidents[0]?.createdAt.getTime() ?? 0;
  let lastMs = firstMs;
  for (const i of incidents) {
    const t = i.createdAt.getTime();
    if (t < firstMs) firstMs = t;
    if (t > lastMs) lastMs = t;
  }

  return {
    total: incidents.length,
    open: incidents.length - resolved,
    resolved,
    projects,
    firstSeen: incidents.find((i) => i.createdAt.getTime() === firstMs)?.createdAt ?? null,
    lastSeen: incidents.find((i) => i.createdAt.getTime() === lastMs)?.createdAt ?? null,
    // เขตแดนพอดีนับว่ายังเกิดซ้ำ · ใบที่เวลาเพี้ยนไปอนาคตก็นับด้วย ไม่ใช่ทำให้พัง
    stillRecurring: lastMs >= now.getTime() - RECURRING_DAYS * DAY_MS,
    spanMs: lastMs - firstMs,
  };
}
