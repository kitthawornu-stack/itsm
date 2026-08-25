/**
 * ตัวจัดคิวแจ้งเตือน SLA — เทสต์เป็นข้อกำหนด
 *
 * เน้นที่จุดที่แผน (master-plan Part 03) เตือนไว้ว่าพลาดง่ายที่สุด:
 * การตั้งงานใหม่ต้องแทนที่ของเดิม ไม่ใช่เพิ่มซ้อน
 */
import { describe, expect, it } from 'vitest';
import { toUtcDate } from '@itsm/types';

import {
  SLA_THRESHOLDS,
  planSlaJobs,
  slaDedupeKey,
  slaJobId,
  slaNotificationText,
} from './sla-scheduler';

const at = (iso: string) => toUtcDate(iso);
const NOW = at('2026-08-25T03:00:00Z');

const base = {
  tenantId: 1n,
  workItemId: 42n,
  workItemSlaId: 7n,
  state: 'running',
  now: NOW,
};

describe('jobId', () => {
  it('ประกอบจากนาฬิกาและเกณฑ์เท่านั้น', () => {
    expect(slaJobId(7n, 0.5)).toBe('sla:7:50');
    expect(slaJobId(7n, 0.75)).toBe('sla:7:75');
    expect(slaJobId(7n, 1)).toBe('sla:7:100');
  });

  it('**ไม่มีเวลาอยู่ในคีย์** — คีย์เดิมต้องคงที่แม้ตั้งใหม่คนละเวลา', () => {
    // นี่คือคุณสมบัติที่ทำให้การตั้งใหม่แทนที่ของเดิมได้
    // ถ้าใส่เวลาเข้าไป การตั้งใหม่จะสร้าง job เพิ่ม แล้วผู้ใช้จะได้เตือนซ้ำ
    const a = slaJobId(7n, 0.5);
    const b = slaJobId(7n, 0.5);
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('นาฬิกาคนละเรือนได้คีย์คนละตัว', () => {
    expect(slaJobId(7n, 0.5)).not.toBe(slaJobId(8n, 0.5));
  });
});

describe('planSlaJobs', () => {
  it('ตั้งครบสามเกณฑ์เมื่อนาฬิกาเดินอยู่', () => {
    const jobs = planSlaJobs({
      ...base,
      notifications: [
        { threshold: 0.5, at: at('2026-08-25T04:00:00Z') },
        { threshold: 0.75, at: at('2026-08-25T05:00:00Z') },
        { threshold: 1, at: at('2026-08-25T06:00:00Z') },
      ],
    });
    expect(jobs.map((j) => j.jobId)).toEqual(['sla:7:50', 'sla:7:75', 'sla:7:100']);
    expect(jobs.map((j) => j.delayMs)).toEqual([3_600_000, 7_200_000, 10_800_000]);
  });

  it('นาฬิกาที่พักอยู่ไม่ตั้งงานเลย', () => {
    const jobs = planSlaJobs({
      ...base,
      state: 'paused',
      notifications: [{ threshold: 0.5, at: at('2026-08-25T04:00:00Z') }],
    });
    expect(jobs).toEqual([]);
  });

  it('นาฬิกาที่ปิดแล้วไม่ตั้งงานเลย', () => {
    for (const state of ['met', 'breached', 'not-started']) {
      expect(planSlaJobs({ ...base, state, notifications: [{ threshold: 1, at: at('2026-08-25T04:00:00Z') }] })).toEqual([]);
    }
  });

  it('เกณฑ์ที่เลยเวลามาแล้วไม่ตั้งย้อนหลัง', () => {
    const jobs = planSlaJobs({
      ...base,
      notifications: [
        { threshold: 0.5, at: at('2026-08-25T02:00:00Z') }, // เลยมาแล้ว
        { threshold: 1, at: at('2026-08-25T06:00:00Z') },
      ],
    });
    expect(jobs.map((j) => j.jobId)).toEqual(['sla:7:100']);
  });

  it('เกณฑ์ที่ตรงเวลาปัจจุบันพอดี ยังตั้งได้ (delay 0)', () => {
    const jobs = planSlaJobs({ ...base, notifications: [{ threshold: 1, at: NOW }] });
    expect(jobs[0]?.delayMs).toBe(0);
  });

  it('payload มีข้อมูลครบสำหรับตรวจซ้ำตอน job ทำงาน', () => {
    const jobs = planSlaJobs({
      ...base,
      notifications: [{ threshold: 0.75, at: at('2026-08-25T05:00:00Z') }],
    });
    expect(jobs[0]?.payload).toEqual({
      tenantId: '1',
      workItemId: '42',
      workItemSlaId: '7',
      threshold: 0.75,
      scheduledFor: '2026-08-25T05:00:00.000Z',
    });
  });

  it('ตั้งใหม่หลังกลับมาเดิน ได้คีย์เดิมแต่เวลาใหม่ — จึงแทนที่ของเดิมได้', () => {
    const before = planSlaJobs({
      ...base,
      notifications: [{ threshold: 0.5, at: at('2026-08-25T04:00:00Z') }],
    });
    const afterResume = planSlaJobs({
      ...base,
      now: at('2026-08-27T03:00:00Z'),
      notifications: [{ threshold: 0.5, at: at('2026-08-27T04:00:00Z') }],
    });
    expect(afterResume[0]?.jobId).toBe(before[0]?.jobId);
    expect(afterResume[0]?.payload.scheduledFor).not.toBe(before[0]?.payload.scheduledFor);
  });

  it('รายการแจ้งเตือนว่างได้รายการงานว่าง', () => {
    expect(planSlaJobs({ ...base, notifications: [] })).toEqual([]);
  });
});

describe('dedupeKey', () => {
  it('เหตุการณ์เดียวกันได้คีย์เดียวกัน', () => {
    expect(slaDedupeKey(7n, 0.5)).toBe(slaDedupeKey(7n, 0.5));
  });

  it('เกณฑ์ต่างกันได้คีย์ต่างกัน — เตือนได้สามครั้งต่อนาฬิกาหนึ่งเรือน', () => {
    const keys = SLA_THRESHOLDS.map((t) => slaDedupeKey(7n, t));
    expect(new Set(keys).size).toBe(3);
  });

  it('ยาวไม่เกิน 191 อักขระ (ข้อจำกัด unique index ของ MySQL utf8mb4)', () => {
    expect(slaDedupeKey(9_223_372_036_854_775_807n, 1).length).toBeLessThanOrEqual(191);
  });
});

describe('ข้อความแจ้งเตือน', () => {
  it('เกณฑ์ 100% บอกว่าหลุดแล้ว ไม่ใช่ "ใช้ไป 100%"', () => {
    const t = slaNotificationText({
      itemKey: 'SD-1042',
      summary: 'ระบบล่ม',
      goalName: 'แก้ไขให้เสร็จ · P1',
      threshold: 1,
    });
    expect(t.title).toContain('หลุด SLA แล้ว');
    expect(t.title).toContain('SD-1042');
  });

  it('เกณฑ์ก่อนหน้าบอกเปอร์เซ็นต์ที่ใช้ไป', () => {
    expect(
      slaNotificationText({ itemKey: 'SD-1', summary: 'x', goalName: 'g', threshold: 0.75 }).title,
    ).toContain('75%');
  });

  it('เนื้อหามีหัวข้องานและชื่อเป้าหมาย', () => {
    const t = slaNotificationText({
      itemKey: 'SD-1',
      summary: 'เครื่องพิมพ์เสีย',
      goalName: 'แก้ไขให้เสร็จ · P2',
      threshold: 0.5,
    });
    expect(t.body).toContain('เครื่องพิมพ์เสีย');
    expect(t.body).toContain('แก้ไขให้เสร็จ · P2');
  });
});
