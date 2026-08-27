/**
 * การยืนยันปฏิทินวันหยุด — เทสต์เป็นข้อกำหนด
 *
 * `assertVerified()` เขียนไว้ตั้งแต่ Phase 0 พร้อมข้อความชัดเจนว่าห้ามใช้ปฏิทิน
 * ที่ยังไม่ตรวจสอบบน production · **ไม่เคยมีโค้ดเส้นไหนเรียกมัน** และไม่เคยมี
 * ทางให้ใครยืนยันได้เลย — กลไกที่ทำตามไม่ได้ ไม่ได้ป้องกันอะไร
 *
 * เคสที่สำคัญที่สุดคือ **แก้รายการแล้วคำยืนยันต้องหลุด** · คนที่เซ็นชื่อไว้
 * ตรวจรายการเดิม ไม่ได้ตรวจรายการใหม่ ถ้าเครื่องหมายค้างอยู่ ระบบจะอ้างชื่อ
 * เขารับรองข้อมูลที่เขาไม่เคยเห็น
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toUtcDate, type TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  EmptyYearError,
  UnverifiedYearError,
  VerificationSourceRequiredError,
  assertCalendarYearVerified,
  calendarYearStatus,
  setHolidaysForYear,
  verifyCalendarYear,
} from '../src/modules/sla';

const STAMP = String(Date.now()).slice(-6);
const YEAR = 2099;
const OFFICE = Array.from({ length: 7 }, (_, i) =>
  i === 0 || i === 6 ? [] : [{ startMinute: 510, endMinute: 1050 }],
);
const ALWAYS = Array.from({ length: 7 }, () => [{ startMinute: 0, endMinute: 1440 }]);

let ctx: TenantContext;
let actorId: bigint;
let officeId: bigint;
let alwaysId: bigint;

const LIST = [
  { date: `${String(YEAR)}-01-01`, name: 'วันขึ้นปีใหม่' },
  { date: `${String(YEAR)}-03-03`, name: 'มาฆบูชา' },
  { date: `${String(YEAR)}-05-20`, name: 'วิสาขบูชา' },
  { date: `${String(YEAR)}-07-17`, name: 'อาสาฬหบูชา' },
  { date: `${String(YEAR)}-07-18`, name: 'เข้าพรรษา' },
];

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  const user = await prismaClient.user.create({
    data: {
      tenantId: tenant.id,
      email: `cal-spec-${STAMP}@example.test`,
      displayName: 'ผู้ตรวจปฏิทิน',
    },
    select: { id: true },
  });
  actorId = user.id;
  ctx = { tenantId: tenant.id, actorId };

  const mk = async (name: string, weekly: unknown): Promise<bigint> =>
    (
      await prismaClient.slaCalendar.create({
        data: { tenantId: tenant.id, name, timezone: 'Asia/Bangkok', weekly: weekly as never },
        select: { id: true },
      })
    ).id;
  officeId = await mk(`ทดสอบ 8x5 ${STAMP}`, OFFICE);
  alwaysId = await mk(`ทดสอบ 24x7 ${STAMP}`, ALWAYS);
});

afterAll(async () => {
  await prismaClient.slaCalendarYear.deleteMany({ where: { calendarId: { in: [officeId, alwaysId] } } });
  await prismaClient.slaHoliday.deleteMany({ where: { calendarId: { in: [officeId, alwaysId] } } });
  await prismaClient.slaCalendar.deleteMany({ where: { id: { in: [officeId, alwaysId] } } });
  await prismaClient.auditLog.deleteMany({ where: { actorId } });
  await prismaClient.user.deleteMany({ where: { id: actorId } });
  await prismaClient.$disconnect();
});

describe('สถานะรายปี', () => {
  it('ปีที่ยังไม่มีข้อมูลเลย ต้องรายงานว่าว่าง ไม่ใช่ว่าไม่มีวันหยุด', async () => {
    const st = await calendarYearStatus(ctx, officeId, YEAR);
    // ทั้งสองอย่างหน้าตาเหมือนกันในฐานข้อมูล แต่คนละเรื่องกันสิ้นเชิง
    expect(st.empty).toBe(true);
    expect(st.verified).toBe(false);
    expect(st.required).toBe(true);
  });

  it('**ปฏิทิน 24×7 ไม่ต้องยืนยัน** — ไม่มีวันหยุดให้ผิด', async () => {
    // เสียงเตือนที่แก้ให้หายไม่ได้ สอนให้ทุกคนเลิกฟังเสียงเตือนทั้งหมด
    const st = await calendarYearStatus(ctx, alwaysId, YEAR);
    expect(st.required).toBe(false);
    await expect(assertCalendarYearVerified(ctx, alwaysId, YEAR)).resolves.toBeUndefined();
  });

  it('**รายการที่ขาดวันสำคัญทางจันทรคติต้องบอกว่าขาดอะไร**', async () => {
    await setHolidaysForYear(ctx, officeId, YEAR, [
      { date: `${String(YEAR)}-01-01`, name: 'วันขึ้นปีใหม่' },
    ]);
    const st = await calendarYearStatus(ctx, officeId, YEAR);
    // ปฏิทินที่มีแต่วันตายตัวขาดสี่ถึงห้าวันต่อปี — ตั๋วที่คร่อมวันเหล่านั้น
    // ถูกนับว่าเกินเวลาทั้งที่ทีมไม่ได้มาทำงาน
    expect(st.missingLunar).toEqual(['มาฆบูชา', 'วิสาขบูชา', 'อาสาฬหบูชา', 'เข้าพรรษา']);
  });

  it('**ชื่อ "วันหยุดราชการ" เฉย ๆ ยังนับว่าขาด แม้จะมีหลายวัน**', async () => {
    /*
      นี่คือหน้าตาของข้อมูลที่ seed ไว้จริง: 16 แถวที่ชื่อว่า "วันหยุดราชการ"
      ทุกแถว · การนับจำนวนแถวจะบอกว่าครบแล้ว ทั้งที่ไม่มีวันสำคัญทางจันทรคติ
      อยู่ในนั้นเลยสักวัน — ต้องอ่าน **ชื่อ** เท่านั้น เพราะวันที่เดาไม่ได้
    */
    await setHolidaysForYear(
      ctx,
      officeId,
      YEAR,
      ['01-01', '03-03', '05-20', '07-17', '07-18', '12-10'].map((d) => ({
        date: `${String(YEAR)}-${d}`,
        name: 'วันหยุดราชการ',
      })),
    );
    const st = await calendarYearStatus(ctx, officeId, YEAR);
    expect(st.count).toBe(6);
    expect(st.missingLunar).toEqual(['มาฆบูชา', 'วิสาขบูชา', 'อาสาฬหบูชา', 'เข้าพรรษา']);
  });
});

describe('แทนที่รายการทั้งปี', () => {
  it('แทนที่ทั้งปี ไม่ใช่เพิ่มทับของเดิม', async () => {
    await setHolidaysForYear(ctx, officeId, YEAR, LIST);
    const st = await calendarYearStatus(ctx, officeId, YEAR);
    expect(st.count).toBe(LIST.length);
    expect(st.missingLunar).toEqual([]);
  });

  it('วันที่ของปีอื่นถูกทิ้ง — ไม่งั้น "แทนที่ทั้งปี" จะลบของปีอื่นไปด้วย', async () => {
    await setHolidaysForYear(ctx, officeId, YEAR + 1, [
      { date: `${String(YEAR + 1)}-01-01`, name: 'วันขึ้นปีใหม่' },
    ]);
    const r = await setHolidaysForYear(ctx, officeId, YEAR, [
      ...LIST,
      { date: `${String(YEAR + 1)}-12-31`, name: 'ของปีหน้า' },
    ]);
    expect(r.count).toBe(LIST.length);
    // ปีถัดไปต้องไม่ถูกแตะ
    expect((await calendarYearStatus(ctx, officeId, YEAR + 1)).count).toBe(1);
  });

  it('วันซ้ำและชื่อว่างถูกตัดทิ้ง', async () => {
    const r = await setHolidaysForYear(ctx, officeId, YEAR, [
      ...LIST,
      { date: LIST[0]?.date ?? '', name: 'ซ้ำ' },
      { date: `${String(YEAR)}-09-09`, name: '   ' },
      { date: 'ไม่ใช่วันที่', name: 'x' },
    ]);
    expect(r.count).toBe(LIST.length);
  });
});

describe('การยืนยัน', () => {
  it('ต้องระบุประกาศที่ใช้ตรวจ', async () => {
    await expect(verifyCalendarYear(ctx, officeId, YEAR, '   ')).rejects.toThrow(
      VerificationSourceRequiredError,
    );
  });

  it('**ยืนยันปีที่ไม่มีวันหยุดสักวันไม่ได้**', async () => {
    // เท่ากับรับรองว่าทั้งปีไม่มีวันหยุดเลย ซึ่งไม่เคยเป็นความจริง
    await expect(verifyCalendarYear(ctx, officeId, YEAR + 5, 'อะไรก็ตาม')).rejects.toThrow(
      EmptyYearError,
    );
  });

  it('ยืนยันแล้วเก็บชื่อคน เวลา และประกาศที่ใช้ตรวจ', async () => {
    await verifyCalendarYear(
      ctx,
      officeId,
      YEAR,
      'มติ ครม. 4 พ.ย. 2568',
      toUtcDate('2026-08-27T03:00:00.000Z'),
    );
    const st = await calendarYearStatus(ctx, officeId, YEAR);
    expect(st.verified).toBe(true);
    expect(st.verifiedBy).toBe('ผู้ตรวจปฏิทิน');
    expect(st.source).toBe('มติ ครม. 4 พ.ย. 2568');
    expect(st.verifiedAt).toBe('2026-08-27T03:00:00.000Z');
  });

  it('ยืนยันแล้วผ่านด่านตรวจ', async () => {
    await expect(assertCalendarYearVerified(ctx, officeId, YEAR)).resolves.toBeUndefined();
  });

  it('**ปีที่ยังไม่ยืนยันถูกปฏิเสธที่ด่านตรวจ**', async () => {
    await expect(assertCalendarYearVerified(ctx, officeId, YEAR + 1)).rejects.toThrow(
      UnverifiedYearError,
    );
  });

  it('**ยืนยันปีหนึ่งไม่ได้ยืนยันปีถัดไป** — วันหยุดเปลี่ยนทุกปี', async () => {
    // บูลีนตัวเดียวต่อปฏิทินถูกได้อย่างมากหนึ่งปี แล้วค้างเป็นคำโกหกในปีถัดไป
    expect((await calendarYearStatus(ctx, officeId, YEAR)).verified).toBe(true);
    expect((await calendarYearStatus(ctx, officeId, YEAR + 1)).verified).toBe(false);
  });

  it('**แก้รายการวันหยุดแล้วคำยืนยันต้องหลุด**', async () => {
    expect((await calendarYearStatus(ctx, officeId, YEAR)).verified).toBe(true);
    await setHolidaysForYear(ctx, officeId, YEAR, [
      ...LIST,
      { date: `${String(YEAR)}-12-10`, name: 'วันรัฐธรรมนูญ' },
    ]);
    // คนที่เซ็นชื่อไว้ตรวจรายการเดิม ไม่ได้ตรวจรายการนี้
    const st = await calendarYearStatus(ctx, officeId, YEAR);
    expect(st.verified).toBe(false);
    expect(st.verifiedBy).toBeNull();
    await expect(assertCalendarYearVerified(ctx, officeId, YEAR)).rejects.toThrow(
      UnverifiedYearError,
    );
  });

  it('บันทึก audit ทั้งการแก้รายการและการยืนยัน', async () => {
    const rows = await prismaClient.auditLog.findMany({
      where: { actorId, entityType: 'sla_calendar' },
      select: { action: true },
    });
    expect(new Set(rows.map((r) => r.action))).toEqual(
      new Set(['sla.calendar.holidays', 'sla.calendar.verify']),
    );
  });
});
