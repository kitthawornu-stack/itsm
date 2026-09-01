/**
 * ตัวเก็บกวาดเซสชัน — ต่อฐานข้อมูล
 *
 * `session-reaper.ts` ตัดสินว่าแถวไหนลบได้ · ไฟล์นี้อ่านของจริงมาให้มันตัดสิน
 * แล้วลบตาม
 *
 * **ข้ามทุก tenant โดยตั้งใจ** — งานเบื้องหลังที่ไม่ได้มาจากคำขอของผู้ใช้
 * และเซสชันตายขององค์กรไหนก็ต้องถูกเก็บเหมือนกัน · ใช้ `withSystemScope()`
 * ที่ประกาศเจตนาชัดเจนตาม §1.1
 */
import { systemClock, type UtcDate } from '@itsm/types';

import { withSystemScope } from '../../infrastructure/prisma/tenant-scope';
import { REAP_BATCH, SESSION_KEEP_DAYS, reapable } from './session-reaper';

export interface ReapResult {
  /** จำนวนที่ตรวจในรอบนี้ — ศูนย์แปลว่าไม่มีอะไรตาย ไม่ใช่ว่าตัวกวาดพัง */
  scanned: number;
  deleted: number;
}

/**
 * กวาดหนึ่งรอบ
 *
 * **อ่านเฉพาะแถวที่มีสิทธิ์ตายแล้ว** — คิวรีกรองด้วยวันที่ก่อน ไม่ใช่ดึง
 * ทั้งตารางมาให้ฟังก์ชันบริสุทธิ์กรอง · บนตารางที่มีเป็นแสนแถว การดึงมาทั้งหมด
 * คือการย้ายปัญหาจากฐานข้อมูลมาไว้ในหน่วยความจำ
 *
 * ตัวกรองในคิวรี **กว้างกว่า** กติกาจริงโดยตั้งใจ (เอาทุกแถวที่หมดอายุแล้ว
 * หรือถูกเพิกถอนแล้ว) แล้วปล่อยให้ `reapable` ตัดสินเรื่องช่วงผ่อนผันและ
 * "ตายเมื่อไร" — กติกาอยู่ที่เดียว ไม่ได้เขียนซ้ำเป็น SQL อีกชุด
 */
export async function reapSessions(
  now: UtcDate = systemClock.nowUtc(),
  keepDays: number = SESSION_KEEP_DAYS,
  batch: number = REAP_BATCH,
): Promise<ReapResult> {
  return withSystemScope(
    'เก็บกวาดเซสชันที่ตายแล้วของทุกองค์กร — งานเบื้องหลัง ไม่ได้มาจากคำขอของผู้ใช้',
    async (db) => {
      const rows = await db.session.findMany({
        where: { OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }] },
        select: { id: true, expiresAt: true, revokedAt: true },
        /*
          ดึงมามากกว่าเพดานเล็กน้อย เผื่อว่าบางแถวยังอยู่ในช่วงผ่อนผัน ·
          ไม่ดึงทั้งตาราง และไม่ดึงพอดีเพดาน เพราะจะได้ไม่ครบเมื่อมีแถว
          ที่ยังไม่ถึงเวลาปนมา
        */
        take: batch * 4,
        orderBy: { expiresAt: 'asc' },
      });

      const ids = reapable(
        rows.map((r) => ({ id: r.id, expiresAt: r.expiresAt, revokedAt: r.revokedAt })),
        now,
        keepDays,
        batch,
      );
      if (ids.length === 0) return { scanned: rows.length, deleted: 0 };

      const r = await db.session.deleteMany({ where: { id: { in: ids } } });
      return { scanned: rows.length, deleted: r.count };
    },
  );
}
