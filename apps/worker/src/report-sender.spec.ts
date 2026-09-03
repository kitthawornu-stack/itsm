/**
 * ข้อกำหนดของการส่งรายงานตามตารางเวลา
 *
 * **ตรรกะ "ส่งหรือไม่ส่ง" ทดสอบได้เพราะมันบริสุทธิ์** และ SMTP กับฐานข้อมูล
 * ฉีดเข้ามา · เคสส่วนใหญ่ของไฟล์นี้คือ **เมื่อไรจะไม่ส่ง** ซึ่งเป็นเคส
 * ที่ทดสอบไม่ได้เลยถ้าตรรกะผูกอยู่กับ SMTP จริง
 *
 * สี่ข้อที่ผิดแล้วเงียบ — ทั้งหมดมีบทเรียนอยู่ใน CLAUDE.md แล้ว:
 *
 *   1. บันทึกหลังส่งสำเร็จ → เครื่องดับระหว่างรอ SMTP แล้วส่งซ้ำทั้งชุด
 *   2. ล้มทั้งรอบเพราะใบเดียว → ตารางหนึ่งพังแล้วอีกเก้าใบไม่ได้ส่ง
 *   3. ตามเก็บรอบที่ตกไปทั้งหมด → ผู้รับเห็นเป็นสแปมแล้วเลิกอ่าน
 *   4. เหตุผลที่ไม่ส่งหายไป → ไม่มีใครสืบต่อได้ว่าทำไมคนถึงไม่ได้รับ
 */
import { describe, expect, it, vi } from 'vitest';
import { toUtcDate } from '@itsm/types';

import {
  decideSend,
  renderReportEmail,
  runReportSender,
  type ReportSenderDeps,
  type ScheduleRowRaw,
} from './report-sender';

const thai = (s: string): ReturnType<typeof toUtcDate> => toUtcDate(Date.parse(`${s}+07:00`));

/** "ตอนนี้" ของทุกเคสในไฟล์นี้ — ไม่มีเทสต์ไหนขึ้นกับเวลาที่รันจริง */
const NOW = thai('2026-09-04T09:00:00');

const row = (over: Partial<ScheduleRowRaw> = {}): ScheduleRowRaw => ({
  id: 1n,
  tenantId: 1n,
  name: 'ทุกเช้า',
  projectKey: 'SD',
  ownerEmail: 'owner@example.test',
  schedule: { kind: 'daily', hour: 8, minute: 0 },
  isEnabled: true,
  lastRunAt: null,
  ...over,
});

describe('ตัดสินว่าส่งหรือไม่', () => {
  it('ถึงเวลาแล้วและยังไม่เคยส่ง = ส่ง', () => {
    const d = decideSend(row(), thai('2026-09-03T08:00:00'));
    expect(d.send).toBe(true);
  });

  it('ยังไม่ถึงเวลา = ไม่ส่ง และบอกว่าจะถึงเมื่อไร', () => {
    const d = decideSend(row(), thai('2026-09-03T07:00:00'));
    expect(d.send).toBe(false);
    if (!d.send) expect(d.reason).toContain('ยังไม่ถึงรอบ');
  });

  // ปิดไว้ต่างจากลบทิ้ง · แถวที่เงียบโดยไม่มีเหตุผล ไม่มีใครสืบต่อได้
  it('**ปิดไว้ = ไม่ส่ง พร้อมเหตุผล**', () => {
    const d = decideSend(row({ isEnabled: false }), thai('2026-09-03T08:00:00'));
    expect(d).toEqual({ send: false, reason: 'ปิดไว้' });
  });

  it('**เจ้าของไม่มีอีเมล = ไม่ส่ง พร้อมเหตุผล**', () => {
    const d = decideSend(row({ ownerEmail: '  ' }), thai('2026-09-03T08:00:00'));
    expect(d).toEqual({ send: false, reason: 'เจ้าของไม่มีอีเมล' });
  });

  // ตัวส่งรันทุกนาที · ไม่ดู `lastRunAt` = ส่งซ้ำทุกนาทีจนหมดวัน
  it('**ส่งไปแล้วรอบนี้ = ไม่ส่งซ้ำ**', () => {
    const at = thai('2026-09-03T08:00:00');
    const d = decideSend(row({ lastRunAt: new Date(at.getTime()) }), at);
    expect(d.send).toBe(false);
  });

  /*
    ส่งย้อนหลังสามฉบับพร้อมกัน ผู้รับเห็นเป็นสแปมแล้วเลิกอ่านทั้งหมด ·
    แต่เงียบไปเลยก็ไม่มีใครรู้ว่าเคยมีรอบที่หายไป
  */
  it('**ตกไปสามรอบ = ส่งครั้งเดียว และบอกว่าตกไปสามรอบ**', () => {
    const d = decideSend(
      row({ lastRunAt: new Date(thai('2026-09-01T08:00:00').getTime()) }),
      thai('2026-09-04T09:00:00'),
    );
    expect(d.send).toBe(true);
    if (d.send) expect(d.missed).toBe(3);
  });

  it('เนื้อความบอกจำนวนรอบที่ตก เมื่อมีมากกว่าหนึ่ง', () => {
    const mail = renderReportEmail(row(), 3, 120, 'http://web');
    expect(mail.text).toContain('2 ครั้ง');
    expect(mail.subject).toContain('SD');
  });

  it('รอบเดียวไม่มีหมายเหตุ — ข้อความเตือนที่ขึ้นตลอดเวลาไม่มีใครอ่าน', () => {
    expect(renderReportEmail(row(), 1, 10, 'http://web').text).not.toContain('หมายเหตุ');
  });
});

/** deps ปลอมที่จำสิ่งที่ถูกเรียกไว้ตามลำดับ */
function fakeDeps(over: Partial<ReportSenderDeps> = {}): ReportSenderDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    loadEnabled: () => Promise.resolve([row({ lastRunAt: new Date(NOW.getTime() - 86_400_000 * 2) })]),
    claim: (id) => {
      calls.push(`claim:${String(id)}`);
      return Promise.resolve(true);
    },
    buildCsv: () => {
      calls.push('build');
      return Promise.resolve({ csv: 'a,b', filename: 'x.csv', rows: 2 });
    },
    markError: (id, e) => {
      calls.push(`error:${String(id)}:${e}`);
      return Promise.resolve();
    },
    clearError: () => Promise.resolve(),
    mailer: {
      send: () => {
        calls.push('send');
        return Promise.resolve();
      },
    },
    webBaseUrl: 'http://web',
    ...over,
  };
}

describe('รอบการส่ง', () => {
  /**
   * **หัวใจของไฟล์นี้**
   *
   * จองก่อนประกอบไฟล์และก่อนติดต่อ SMTP · การประกอบไฟล์ใช้เวลาได้หลายวินาที
   * ถ้าบันทึกหลังส่งสำเร็จ เครื่องที่ดับระหว่างนั้นจะกลับมาส่งซ้ำทั้งชุด
   * โดยไม่มีอะไรจำได้ว่าเคยพยายามแล้ว
   */
  it('**จองก่อนประกอบไฟล์และก่อนส่ง**', async () => {
    const deps = fakeDeps();
    await runReportSender(deps, NOW);
    expect(deps.calls).toEqual(['claim:1', 'build', 'send']);
  });

  it('จองไม่ได้ (มีตัวอื่นจองไปแล้ว) = ข้าม ไม่ประกอบไฟล์และไม่ส่ง', async () => {
    const deps = fakeDeps({ claim: () => Promise.resolve(false) });
    const r = await runReportSender(deps, NOW);
    expect(r.sent).toBe(0);
    expect(r.skipped).toBe(1);
    expect(deps.calls).not.toContain('build');
  });

  // ตารางหนึ่งที่พัง (สิทธิ์ถูกถอน · SMTP ปฏิเสธ) ต้องไม่ทำให้อีกใบไม่ได้ส่ง
  it('**ใบหนึ่งล้ม อีกใบยังส่งได้**', async () => {
    // ทั้งสองใบต้องถึงรอบจริง มิฉะนั้นเคสนี้ผ่านเพราะไม่มีใบไหนถูกส่งเลย
    const past = new Date(NOW.getTime() - 86_400_000 * 2);
    const rows = [row({ id: 1n, lastRunAt: past }), row({ id: 2n, lastRunAt: past })];
    const deps = fakeDeps({
      loadEnabled: () => Promise.resolve(rows),
      buildCsv: (r) => {
        if (r.id === 1n) return Promise.reject(new Error('ไม่มีสิทธิ์ดูรายงานแล้ว'));
        return Promise.resolve({ csv: 'a', filename: 'x.csv', rows: 1 });
      },
    });
    const report = await runReportSender(deps, NOW);
    expect(report.failed).toBe(1);
    expect(report.sent).toBe(1);
  });

  /*
    เจ้าของต้องเห็นว่าทำไมรายงานไม่มา มิฉะนั้นไม่รู้ด้วยซ้ำว่าควรได้รับ
    — รายงานที่ไม่ถูกส่งไม่มีใครทวง
  */
  it('**เหตุผลที่ล้มถูกบันทึกลงแถว**', async () => {
    const deps = fakeDeps({
      buildCsv: () => Promise.reject(new Error('ไม่มีสิทธิ์ดูรายงานแล้ว')),
    });
    await runReportSender(deps, NOW);
    expect(deps.calls.some((c) => c.startsWith('error:1:ไม่มีสิทธิ์'))).toBe(true);
  });

  it('ยังไม่ถึงรอบ = ไม่จอง ไม่ส่ง', async () => {
    const deps = fakeDeps({
      loadEnabled: () => Promise.resolve([row({ lastRunAt: new Date(NOW.getTime()) })]),
    });
    const r = await runReportSender(deps, NOW);
    expect(r.skipped).toBe(1);
    expect(deps.calls).toEqual([]);
  });

  it('SMTP ล้ม = นับเป็นล้ม และบันทึกเหตุผล ไม่ใช่เงียบ', async () => {
    const deps = fakeDeps({
      mailer: { send: () => Promise.reject(new Error('SMTP ปฏิเสธ')) },
    });
    const r = await runReportSender(deps, NOW);
    expect(r.failed).toBe(1);
    expect(deps.calls.some((c) => c.includes('SMTP ปฏิเสธ'))).toBe(true);
  });

  it('ไม่มีตารางเลย = รอบว่าง ไม่ใช่ error', async () => {
    const deps = fakeDeps({ loadEnabled: () => Promise.resolve([]) });
    expect(await runReportSender(deps, NOW)).toEqual({ scanned: 0, sent: 0, skipped: 0, failed: 0 });
  });

  it('ไม่เรียก mailer เลยเมื่อไม่มีอะไรถึงรอบ', async () => {
    const send = vi.fn();
    const deps = fakeDeps({
      loadEnabled: () => Promise.resolve([row({ isEnabled: false })]),
      mailer: { send },
    });
    await runReportSender(deps, NOW);
    expect(send).not.toHaveBeenCalled();
  });
});
