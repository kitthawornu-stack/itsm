/**
 * ตัวกู้การแจ้งเตือนที่หายไป — เทสต์เป็นข้อกำหนด
 *
 * ทุกเคสที่นี่คือเหตุผลที่จะ **ไม่** ส่ง หรือเหตุผลที่ต้องส่งทั้งที่ไม่มีงานในคิว
 */
import { describe, expect, it } from 'vitest';

import {
  pickMissedBreaches,
  reconcileDedupeKey,
  runReconcile,
  type ClockRow,
  type ReconcileDeps,
} from './sla-reconciler';
import type { PlannedJob } from './sla-queue';

const NOW = new Date('2026-08-25T10:00:00Z');
const clock = (over: Partial<ClockRow> = {}): ClockRow => ({
  id: 7n,
  tenantId: 1n,
  workItemId: 42n,
  state: 'breached',
  breachedAt: new Date('2026-08-25T09:00:00Z'),
  ...over,
});

const pick = (clocks: ClockRow[], notified: string[] = []) =>
  pickMissedBreaches({ clocks, notifiedKeys: new Set(notified), now: NOW });

describe('pickMissedBreaches', () => {
  it('นาฬิกาที่หลุดแล้วและยังไม่มีแจ้งเตือน ถูกหยิบมาส่งทันที', () => {
    const jobs = pick([clock()]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.jobId).toBe('sla:7:100');
    expect(jobs[0]?.delayMs).toBe(0);
    expect(jobs[0]?.payload.threshold).toBe(1);
  });

  it('**ที่แจ้งไปแล้วไม่ส่งซ้ำ** — นี่คือเหตุผลที่รันซ้ำได้ทุกกี่นาทีก็ได้', () => {
    expect(pick([clock()], [reconcileDedupeKey(7n)])).toEqual([]);
  });

  it('นาฬิกาที่พักอยู่ไม่ถูกหยิบ แม้ breach_at จะเลยมาแล้ว', () => {
    // ตั๋วที่รอลูกค้าตอบไม่ควรถูกนับว่าหลุด — เวลาหยุดเดินตั้งแต่ตอนพัก
    expect(pick([clock({ state: 'paused' })])).toEqual([]);
  });

  it('นาฬิกาที่ปิดแล้วไม่ถูกหยิบ', () => {
    for (const state of ['met', 'not-started', 'cancelled']) {
      expect(pick([clock({ state })])).toEqual([]);
    }
  });

  it('ยังไม่ถึงเวลาหลุดไม่ถูกหยิบ — งานที่ตั้งไว้ตามปกติจะจัดการเอง', () => {
    expect(pick([clock({ state: 'running', breachedAt: new Date('2026-08-25T11:00:00Z') })])).toEqual([]);
  });

  it('หลุดพอดีวินาทีนี้ ถูกหยิบ (ขอบเขตแบบ >= )', () => {
    expect(pick([clock({ breachedAt: NOW })])).toHaveLength(1);
  });

  it('ไม่มี breached_at ไม่ถูกหยิบ — ยังไม่หลุด', () => {
    expect(pick([clock({ breachedAt: null })])).toEqual([]);
  });

  it('นาฬิกาที่ยัง running แต่เลยเวลาหลุดแล้ว ก็ถูกหยิบ', () => {
    // state ใน DB อาจตามความจริงไม่ทัน เพราะมันอัปเดตตอนมีเหตุการณ์เท่านั้น
    // ถ้าเชื่อเฉพาะ state='breached' ตั๋วที่ไม่มีใครแตะจะเงียบตลอดไป
    expect(pick([clock({ state: 'running' })])).toHaveLength(1);
  });

  it('scheduledFor คือเวลาที่หลุดจริง ไม่ใช่เวลาที่กู้ — เพื่อให้รู้ว่าช้าไปเท่าไร', () => {
    expect(pick([clock()])[0]?.payload.scheduledFor).toBe('2026-08-25T09:00:00.000Z');
  });

  it('คัดจากหลายเรือนพร้อมกันได้ และข้ามเฉพาะอันที่ควรข้าม', () => {
    const jobs = pick(
      [
        clock({ id: 1n }),
        clock({ id: 2n, state: 'paused' }),
        clock({ id: 3n }),
        clock({ id: 4n, breachedAt: new Date('2026-08-26T00:00:00Z'), state: 'running' }),
      ],
      [reconcileDedupeKey(3n)],
    );
    expect(jobs.map((j) => j.jobId)).toEqual(['sla:1:100']);
  });

  it('คีย์ที่ใช้เทียบตรงกับที่ตัวจัดคิวปกติสร้าง — ไม่งั้นจะกู้ซ้ำทุกครั้ง', async () => {
    // ถ้าสองที่สร้างคีย์คนละแบบ ตัวกู้จะมองไม่เห็นว่าเคยส่งแล้ว
    // แล้วมันจะยิงงานซ้ำทุกนาที ให้ unique index รับหน้าอยู่ฝ่ายเดียว
    const { slaDedupeKey } = await import('../../api/src/modules/sla/sla-scheduler');
    expect(reconcileDedupeKey(7n)).toBe(slaDedupeKey(7n, 1));
  });
});

describe('runReconcile', () => {
  const mk = (over: Record<string, unknown> = {}) => {
    const enqueued: PlannedJob[][] = [];
    const deps: ReconcileDeps = {
      loadOverdueClocks: async () => [clock({ id: 1n }), clock({ id: 2n })],
      loadNotifiedKeys: async () => [],
      enqueue: async (j) => {
        enqueued.push(j);
      },
      now: () => NOW,
      ...over,
    };
    return { deps, enqueued };
  };

  it('ยิงงานเฉพาะเรือนที่ยังไม่เคยแจ้ง', async () => {
    const { deps, enqueued } = mk({ loadNotifiedKeys: async () => [reconcileDedupeKey(1n)] });
    expect(await runReconcile(deps)).toEqual({ scanned: 2, enqueued: 1 });
    expect(enqueued[0]?.[0]?.jobId).toBe('sla:2:100');
  });

  it('ไม่มีนาฬิกาค้าง = ไม่แตะฐานข้อมูลต่อและไม่ยิงงาน', async () => {
    let askedForKeys = false;
    const { deps, enqueued } = mk({
      loadOverdueClocks: async () => [],
      loadNotifiedKeys: async () => {
        askedForKeys = true;
        return [];
      },
    });
    expect(await runReconcile(deps)).toEqual({ scanned: 0, enqueued: 0 });
    expect(askedForKeys).toBe(false);
    expect(enqueued).toEqual([]);
  });

  it('ทุกเรือนแจ้งไปแล้ว = ไม่เรียก enqueue เลย (ไม่ใช่เรียกด้วยรายการว่าง)', async () => {
    const { deps, enqueued } = mk({
      loadNotifiedKeys: async () => [reconcileDedupeKey(1n), reconcileDedupeKey(2n)],
    });
    expect(await runReconcile(deps)).toEqual({ scanned: 2, enqueued: 0 });
    expect(enqueued).toEqual([]);
  });

  it('ส่ง limit ต่อไปให้ตัวโหลด — กันการยิงถล่มรอบเดียว', async () => {
    let got = -1;
    const { deps } = mk({
      loadOverdueClocks: async (n: number) => {
        got = n;
        return [];
      },
    });
    await runReconcile(deps, 50);
    expect(got).toBe(50);
  });
});
