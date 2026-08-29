/**
 * หน้าต่างเวลาดำเนินการ — ต่อของจริง
 *
 * `change-window.spec.ts` ประกอบข้อมูลนำเข้าขึ้นมาเอง จึงพิสูจน์ได้แค่ว่า
 * *ถ้า* ข้อมูลหน้าตาแบบนั้นเข้ามา ผลจะถูก · ไฟล์นี้ถามว่า **ระบบสร้างข้อมูล
 * แบบนั้นได้จริงหรือเปล่า** และคำถามที่เอนจินตอบเองไม่ได้:
 *
 *   1. **การชนคำนวณสดทุกครั้งที่อ่าน** — ใบที่ตั้งไว้ก่อนต้องเห็นว่าชน
 *      เมื่อมีใบใหม่มาทับทีหลัง · ถ้าเก็บผลไว้ตอนบันทึก มันจะบอกว่า
 *      "ไม่ชนใคร" ต่อไปตลอดกาล
 *   2. **ใบที่กำลังแก้ต้องไม่รายงานว่าชนกับตัวเอง** — เกิดทุกครั้งที่กดบันทึกซ้ำ
 *   3. **คิวรีอ่านช่วงกว้างกว่าที่ถาม** — งานที่เริ่มก่อนกรอบแต่ยังไม่จบ
 *      ต้องถูกนับ · index ครอบได้แค่ `plannedStart` ปลายช่วงจึงกรองในหน่วยความจำ
 *   4. **เหตุผลข้ามช่วงห้ามถูกเก็บเฉพาะเมื่อข้ามจริง**
 *
 * เทสต์สร้างงาน · ผู้ใช้ · ช่วงห้ามของตัวเองทั้งหมด แล้วลบทิ้ง ไม่แตะ seed ·
 * คีย์ทุกตัวมี stamp เพราะ **ตอนกลไกถูกลบ ค่าที่ "ไม่ควรถูกใช้" จะถูกใช้จริง**
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toUtcDate, type TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  BackwardWindowError,
  InFreezeWindowError,
  WindowTooLongError,
  changeCalendar,
  clearWindow,
  setWindow,
  windowOf,
} from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);
/** ทุกเวลาในไฟล์นี้อิงจากวันที่ตายตัว — "ตอนนี้" ส่งเข้าเอนจินเสมอ */
const NOW = toUtcDate('2027-03-01T00:00:00.000Z');

let tenantId: bigint;
let projectId: bigint;
let template: { issueTypeId: bigint; statusId: bigint };
let actorId: bigint;
let ctx: TenantContext;
const keys: string[] = [];
const freezeIds: bigint[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function newItem(tag: string): Promise<string> {
  const itemKey = `SD-CW${STAMP}${tag}`;
  await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey,
      issueTypeId: template.issueTypeId,
      statusId: template.statusId,
      reporterId: actorId,
      summary: `[หน้าต่าง] ${tag} ${STAMP}`,
      rank: `zzw${STAMP}${tag}`,
    },
  });
  keys.push(itemKey);
  return itemKey;
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  projectId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } })).id;
  template = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId },
    select: { issueTypeId: true, statusId: true },
  });
  actorId = (
    await prismaClient.user.create({
      data: {
        tenantId,
        email: `cw-${STAMP}@example.test`,
        displayName: `ผู้วางแผนเปลี่ยนแปลง ${STAMP}`,
      },
      select: { id: true },
    })
  ).id;
  ctx = { tenantId, actorId };
}, 120_000);

afterAll(async () => {
  await step('หน้าต่างที่ผู้ใช้ของเทสต์สร้าง', () =>
    prismaClient.changeWindow.deleteMany({ where: { createdById: actorId } }),
  );
  await step('ช่วงห้ามของเทสต์', () =>
    prismaClient.changeFreeze.deleteMany({ where: { id: { in: freezeIds } } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actorId } }));
  await step('งานทดสอบ', () =>
    prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }),
  );
  await step('ผู้ใช้ของเทสต์', () => prismaClient.user.deleteMany({ where: { id: actorId } }));

  const left = await prismaClient.changeFreeze.count({ where: { name: { contains: STAMP } } });
  if (left > 0) console.error(`เหลือช่วงห้ามของเทสต์ค้างอยู่ ${String(left)} รายการ`);
  await prismaClient.$disconnect();
});

describe('A · ตั้งหน้าต่าง', () => {
  it('ตั้งแล้วอ่านกลับได้ และยังไม่ชนใคร', async () => {
    const key = await newItem('A1');
    const w = await setWindow(
      ctx,
      key,
      { plannedStart: '2027-04-03T19:00:00.000Z', plannedEnd: '2027-04-03T21:00:00.000Z' },
      NOW,
    );
    expect(w.conflicts).toEqual([]);
    expect(w.durationMs).toBe(2 * 60 * 60 * 1000);
    expect(w.startsInPast).toBe(false);

    const read = await windowOf(ctx, key, NOW);
    expect(read?.plannedStart).toBe('2027-04-03T19:00:00.000Z');
  });

  it('ยังไม่ได้ตั้ง = `null` ไม่ใช่ error', async () => {
    const key = await newItem('A2');
    expect(await windowOf(ctx, key, NOW)).toBeNull();
  });

  it('**กดบันทึกซ้ำด้วยค่าเดิม ต้องไม่รายงานว่าชนกับตัวเอง**', async () => {
    /*
      เกิดทุกครั้งที่ผู้ใช้กด "บันทึก" สองรอบ · ถ้ารายงาน คำเตือนการชน
      จะติดค้างบนทุกใบตลอดเวลา แล้วไม่มีใครเชื่อมันอีก
    */
    const key = await newItem('A3');
    const body = { plannedStart: '2027-05-08T19:00:00.000Z', plannedEnd: '2027-05-08T22:00:00.000Z' };
    await setWindow(ctx, key, body, NOW);
    const again = await setWindow(ctx, key, body, NOW);
    expect(again.conflicts).toEqual([]);
    // และต้องมีแถวเดียว ไม่ใช่สองแถว
    const rows = await prismaClient.changeWindow.count({
      where: { workItem: { itemKey: key } },
    });
    expect(rows).toBe(1);
  });

  it('ช่วงกลับหัวและช่วงที่ยาวเกินเพดาน ถูกปฏิเสธก่อนแตะฐานข้อมูล', async () => {
    const key = await newItem('A4');
    await expect(
      setWindow(
        ctx,
        key,
        { plannedStart: '2027-04-03T21:00:00.000Z', plannedEnd: '2027-04-03T19:00:00.000Z' },
        NOW,
      ),
    ).rejects.toThrow(BackwardWindowError);
    await expect(
      setWindow(
        ctx,
        key,
        { plannedStart: '2027-04-03T19:00:00.000Z', plannedEnd: '2027-05-03T19:00:00.000Z' },
        NOW,
      ),
    ).rejects.toThrow(WindowTooLongError);
    expect(await windowOf(ctx, key, NOW)).toBeNull();
  });
});

describe('B · การชนที่คำนวณสด', () => {
  it('**ใบที่ตั้งไว้ก่อน ต้องเห็นว่าชนเมื่อมีใบใหม่มาทับทีหลัง**', async () => {
    /*
      หัวใจของเรื่องนี้ · ถ้าเก็บผลการชนไว้ตอนบันทึก ใบแรกจะบอกว่า
      "ไม่ชนใคร" ต่อไปตลอดกาล ทั้งที่ตอนนี้มีคนมาทับแล้ว
    */
    const first = await newItem('B1');
    const second = await newItem('B2');
    const w1 = await setWindow(
      ctx,
      first,
      { plannedStart: '2027-06-05T19:00:00.000Z', plannedEnd: '2027-06-05T22:00:00.000Z' },
      NOW,
    );
    expect(w1.conflicts).toEqual([]);

    const w2 = await setWindow(
      ctx,
      second,
      { plannedStart: '2027-06-05T21:00:00.000Z', plannedEnd: '2027-06-05T23:00:00.000Z' },
      NOW,
    );
    expect(w2.conflicts.map((c) => c.itemKey)).toEqual([first]);

    // อ่านใบแรกใหม่ — ต้องเห็นใบที่สองด้วย
    const reread = await windowOf(ctx, first, NOW);
    expect(reread?.conflicts.map((c) => c.itemKey)).toEqual([second]);
  });

  it('ปลายชนต้นพอดี ไม่ถือว่าชน — วัดผ่านฐานข้อมูลจริง', async () => {
    const a = await newItem('B3');
    const b = await newItem('B4');
    await setWindow(
      ctx,
      a,
      { plannedStart: '2027-07-03T19:00:00.000Z', plannedEnd: '2027-07-03T21:00:00.000Z' },
      NOW,
    );
    const w = await setWindow(
      ctx,
      b,
      { plannedStart: '2027-07-03T21:00:00.000Z', plannedEnd: '2027-07-03T23:00:00.000Z' },
      NOW,
    );
    expect(w.conflicts).toEqual([]);
  });

  it('**งานที่เริ่มก่อนกรอบแต่ยังไม่จบ ต้องถูกนับ**', async () => {
    /*
      คิวรีคัดด้วย `plannedStart` เท่านั้นเพราะ index ครอบได้คอลัมน์เดียว ·
      ถ้ากรอบเริ่มที่เวลาเดียวกับที่ถาม งานยาวห้าวันที่เริ่มไปแล้วจะหายไป
    */
    const long = await newItem('B5');
    const late = await newItem('B6');
    await setWindow(
      ctx,
      long,
      { plannedStart: '2027-08-01T00:00:00.000Z', plannedEnd: '2027-08-06T00:00:00.000Z' },
      NOW,
    );
    const w = await setWindow(
      ctx,
      late,
      { plannedStart: '2027-08-05T00:00:00.000Z', plannedEnd: '2027-08-05T02:00:00.000Z' },
      NOW,
    );
    expect(w.conflicts.map((c) => c.itemKey)).toEqual([long]);
  });

  it('ถอนหน้าต่างแล้ว ต้องไม่ไปชนกับใครอีก', async () => {
    const gone = await newItem('B7');
    const other = await newItem('B8');
    await setWindow(
      ctx,
      gone,
      { plannedStart: '2027-09-04T19:00:00.000Z', plannedEnd: '2027-09-04T23:00:00.000Z' },
      NOW,
    );
    await clearWindow(ctx, gone);
    expect(await windowOf(ctx, gone, NOW)).toBeNull();

    const w = await setWindow(
      ctx,
      other,
      { plannedStart: '2027-09-04T20:00:00.000Z', plannedEnd: '2027-09-04T22:00:00.000Z' },
      NOW,
    );
    expect(w.conflicts).toEqual([]);
  });
});

describe('C · ช่วงห้ามเปลี่ยนแปลง', () => {
  beforeAll(async () => {
    const f = await prismaClient.changeFreeze.create({
      data: {
        tenantId,
        name: `ปิดงบสิ้นปี ${STAMP}`,
        reason: 'ระบบบัญชีปิดงบ',
        startsAt: new Date('2027-12-25T17:00:00.000Z'),
        endsAt: new Date('2028-01-05T17:00:00.000Z'),
      },
      select: { id: true },
    });
    freezeIds.push(f.id);
  });

  it('**อยู่ในช่วงห้ามโดยไม่ให้เหตุผล = ถูกปฏิเสธ และไม่มีแถวถูกสร้าง**', async () => {
    const key = await newItem('C1');
    await expect(
      setWindow(
        ctx,
        key,
        { plannedStart: '2027-12-28T19:00:00.000Z', plannedEnd: '2027-12-28T21:00:00.000Z' },
        NOW,
      ),
    ).rejects.toThrow(InFreezeWindowError);
    expect(await windowOf(ctx, key, NOW)).toBeNull();
  });

  it('**ให้เหตุผลแล้วผ่าน และเหตุผลถูกเก็บไว้**', async () => {
    const key = await newItem('C2');
    const w = await setWindow(
      ctx,
      key,
      {
        plannedStart: '2027-12-28T19:00:00.000Z',
        plannedEnd: '2027-12-28T21:00:00.000Z',
        freezeOverrideReason: 'ระบบล่ม ต้องกู้คืนทันที',
      },
      NOW,
    );
    expect(w.freezes.map((f) => f.name)).toEqual([`ปิดงบสิ้นปี ${STAMP}`]);
    expect(w.freezeOverrideReason).toBe('ระบบล่ม ต้องกู้คืนทันที');
  });

  it('**เหตุผลถูกเก็บเฉพาะเมื่อข้ามช่วงห้ามจริง**', async () => {
    /*
      ถ้าเก็บทุกครั้งที่มีข้อความส่งมา รายงาน "จำนวนครั้งที่ข้ามช่วงห้าม"
      จะสูงกว่าความจริงตลอด และผู้ตรวจสอบจะไล่ดูใบที่ไม่เคยข้ามอะไรเลย
    */
    const key = await newItem('C3');
    const w = await setWindow(
      ctx,
      key,
      {
        plannedStart: '2027-10-02T19:00:00.000Z',
        plannedEnd: '2027-10-02T21:00:00.000Z',
        freezeOverrideReason: 'เผื่อไว้',
      },
      NOW,
    );
    expect(w.freezes).toEqual([]);
    expect(w.freezeOverrideReason).toBeNull();
  });
});

describe('D · ปฏิทิน', () => {
  it('คืนงานในช่วงที่ขอ พร้อมช่วงห้าม และเรียงตามเวลาเริ่ม', async () => {
    const cal = await changeCalendar(ctx, '2027-12-01T00:00:00.000Z', '2028-01-31T00:00:00.000Z');
    const mine = cal.entries.filter((e) => e.itemKey.startsWith(`SD-CW${STAMP}`));
    expect(mine.map((e) => e.itemKey)).toEqual([`SD-CW${STAMP}C2`]);
    expect(mine[0]?.overridden).toBe(true);
    expect(cal.freezes.some((f) => f.name === `ปิดงบสิ้นปี ${STAMP}`)).toBe(true);

    const sorted = [...cal.entries].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    expect(cal.entries.map((e) => e.start)).toEqual(sorted.map((e) => e.start));
  });

  it('**งานที่เริ่มก่อนกรอบแต่ยังไม่จบ ต้องอยู่ในปฏิทิน**', async () => {
    const cal = await changeCalendar(ctx, '2027-08-03T00:00:00.000Z', '2027-08-04T00:00:00.000Z');
    expect(cal.entries.map((e) => e.itemKey)).toContain(`SD-CW${STAMP}B5`);
  });

  it('**งานที่จบไปก่อนกรอบ ต้องไม่อยู่ในปฏิทิน แม้จะถูกดึงมาด้วย lookback**', async () => {
    /*
      คิวรีถอยหลัง `MAX_WINDOW_DAYS` เพื่อไม่ให้พลาดงานยาวที่เริ่มไปแล้ว ·
      แปลว่ามันดึงงานที่ **จบไปแล้ว** มาด้วยเสมอ · ตัวกรองปลายช่วงคือสิ่งเดียว
      ที่คัดออก — ลบทิ้งแล้วเทสต์ยังเขียวทั้ง 34 เคส (พิสูจน์ตอนลบทีละบรรทัด)
      เพราะไม่มีเคสไหนถามช่วงที่อยู่หลังงานแต่ยังอยู่ในระยะ lookback

      B5 คือ 2027-08-01 → 2027-08-06 · ถามช่วง 08-10 ถึง 08-11 ซึ่งห่าง
      เก้าวัน จึงยังอยู่ในระยะถอยหลังสิบสี่วัน
    */
    const cal = await changeCalendar(ctx, '2027-08-10T00:00:00.000Z', '2027-08-11T00:00:00.000Z');
    expect(cal.entries.map((e) => e.itemKey)).not.toContain(`SD-CW${STAMP}B5`);
  });

  it('ช่วงที่ไม่มีอะไรเลย = รายการว่าง', async () => {
    const cal = await changeCalendar(ctx, '2030-01-01T00:00:00.000Z', '2030-01-02T00:00:00.000Z');
    expect(cal.entries.filter((e) => e.itemKey.startsWith(`SD-CW${STAMP}`))).toEqual([]);
  });
});
