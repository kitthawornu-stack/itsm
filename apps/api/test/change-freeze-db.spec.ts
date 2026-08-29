/**
 * ช่วงห้ามเปลี่ยนแปลง — ต่อของจริง
 *
 * ตาราง `change_freeze` มีมาก่อนหน้านี้และเอนจินใช้จริง **แต่ไม่มีทางเข้าใด ๆ
 * นอกจากเขียน SQL** — กลไกที่ไม่มีอะไรเรียกใช้ ป้องกันอะไรไม่ได้เลย ·
 * ในทางปฏิบัติแปลว่าไม่มีองค์กรไหนเคยมีช่วงห้ามสักช่วง
 *
 * ข้อที่ไฟล์นี้ยืนยัน:
 *
 *   1. **สร้าง แก้ ลบ ได้จริงจากทางเข้าปกติ** ไม่ใช่แค่มีตาราง
 *   2. **จำนวนหน้าต่างที่กระทบ นับด้วย `overlaps` ตัวเดียวกับที่กั้นจริง** —
 *      ถ้านับด้วยเงื่อนไขที่เขียนใหม่ ตัวเลขบนหน้าจอจะไม่ตรงกับสิ่งที่ระบบทำ
 *   3. **ลบช่วงห้ามแล้วหน้าต่างเวลาไม่ถูกย้อนกลับ** — มันแค่ไม่มีคำเตือนแล้ว
 *   4. **ช่วงห้ามที่ไม่บอกเหตุผล ถูกปฏิเสธ** — เหตุผลไม่ใช่ของประดับ
 *      คนที่จะขอข้ามต้องอ่านแล้วตัดสินใจได้เอง
 *
 * เทสต์สร้างผู้ใช้ · งาน · ช่วงห้ามของตัวเองทั้งหมด แล้วลบทิ้ง ไม่แตะ seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toUtcDate, type TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  BackwardWindowError,
  DuplicateFreezeError,
  FreezeNameRequiredError,
  FreezeNotFoundError,
  FreezeReasonRequiredError,
  FreezeTooLongError,
  createFreeze,
  deleteFreeze,
  listFreezes,
  setWindow,
  updateFreeze,
  windowOf,
} from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);
const NOW = toUtcDate('2029-01-01T00:00:00.000Z');

let tenantId: bigint;
let projectId: bigint;
let template: { issueTypeId: bigint; statusId: bigint };
let actorId: bigint;
let ctx: TenantContext;
const keys: string[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function newItem(tag: string): Promise<string> {
  const itemKey = `SD-CF${STAMP}${tag}`;
  await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey,
      issueTypeId: template.issueTypeId,
      statusId: template.statusId,
      reporterId: actorId,
      summary: `[ช่วงห้าม] ${tag} ${STAMP}`,
      rank: `zzf${STAMP}${tag}`,
    },
  });
  keys.push(itemKey);
  return itemKey;
}

/** ช่วงห้ามของเทสต์เท่านั้น — องค์กรอาจมีของจริงอยู่แล้ว */
async function mine(): Promise<Awaited<ReturnType<typeof listFreezes>>> {
  return (await listFreezes(ctx)).filter((f) => f.name.includes(STAMP));
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
        email: `cf-${STAMP}@example.test`,
        displayName: `ผู้ดูแลช่วงห้าม ${STAMP}`,
      },
      select: { id: true },
    })
  ).id;
  ctx = { tenantId, actorId };
}, 120_000);

afterAll(async () => {
  /*
    **ถามจาก `audit_log` ว่าผู้ใช้ของเทสต์สร้างช่วงห้ามใบไหนไปบ้าง** ไม่ใช่
    ลบตามชื่อที่มี stamp · ตอนลบกลไก "ต้องมีชื่อ" ออกเพื่อพิสูจน์ว่าเทสต์แดงได้
    เคสนั้นสร้างแถวที่ **ชื่อเป็นสตริงว่าง** ขึ้นมาจริง ซึ่งไม่มี stamp
    จึงรอดจากการเก็บกวาดและค้างอยู่ในฐานข้อมูลพัฒนา (เกิดขึ้นแล้วหนึ่งครั้ง)
  */
  await step('ช่วงห้ามที่ผู้ใช้ของเทสต์สร้าง', async () => {
    const touched = await prismaClient.auditLog.findMany({
      where: { actorId, entityType: 'change-freeze' },
      select: { entityId: true },
    });
    const ids = touched.map((a) => BigInt(a.entityId));
    if (ids.length > 0) await prismaClient.changeFreeze.deleteMany({ where: { id: { in: ids } } });
    await prismaClient.changeFreeze.deleteMany({ where: { name: { contains: STAMP } } });
  });
  await step('หน้าต่างของเทสต์', () =>
    prismaClient.changeWindow.deleteMany({ where: { createdById: actorId } }),
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

describe('A · สร้างและแก้', () => {
  it('**สร้างได้จากทางเข้าปกติ** แล้วอ่านกลับเจอ', async () => {
    await createFreeze(ctx, {
      name: `สงกรานต์ ${STAMP}`,
      reason: 'ไม่มีคนอยู่ประจำการ',
      startsAt: '2029-04-12T17:00:00.000Z',
      endsAt: '2029-04-16T17:00:00.000Z',
    });
    const rows = await mine();
    expect(rows.map((f) => f.name)).toEqual([`สงกรานต์ ${STAMP}`]);
    expect(rows[0]?.reason).toBe('ไม่มีคนอยู่ประจำการ');
    expect(rows[0]?.affectedCount).toBe(0);
  });

  it('แก้ชื่อ เหตุผล และเวลาได้', async () => {
    const id = (await mine())[0]?.id ?? '';
    await updateFreeze(ctx, BigInt(id), {
      name: `สงกรานต์ ${STAMP}`,
      reason: 'ไม่มีคนอยู่ประจำการ และผู้ให้บริการปิดด้วย',
      startsAt: '2029-04-11T17:00:00.000Z',
      endsAt: '2029-04-16T17:00:00.000Z',
    });
    const f = (await mine())[0];
    expect(f?.reason).toContain('ผู้ให้บริการปิด');
    expect(f?.startsAt).toBe('2029-04-11T17:00:00.000Z');
  });

  it('แก้ช่วงห้ามที่ไม่มีอยู่ = `FreezeNotFoundError`', async () => {
    await expect(
      updateFreeze(ctx, BigInt('999999999'), {
        name: `ผี ${STAMP}`,
        reason: 'ไม่มีจริง',
        startsAt: '2029-04-12T17:00:00.000Z',
        endsAt: '2029-04-13T17:00:00.000Z',
      }),
    ).rejects.toThrow(FreezeNotFoundError);
  });
});

describe('B · สิ่งที่รับไม่ได้', () => {
  const base = {
    startsAt: '2029-05-01T00:00:00.000Z',
    endsAt: '2029-05-02T00:00:00.000Z',
  };

  it('**ไม่บอกเหตุผล = ปฏิเสธ** และไม่มีแถวถูกสร้าง', async () => {
    const before = (await mine()).length;
    await expect(
      createFreeze(ctx, { ...base, name: `ไม่มีเหตุผล ${STAMP}`, reason: '   ' }),
    ).rejects.toThrow(FreezeReasonRequiredError);
    expect((await mine()).length).toBe(before);
  });

  it('ไม่มีชื่อ = ปฏิเสธ', async () => {
    await expect(
      createFreeze(ctx, { ...base, name: '   ', reason: 'มีเหตุผลแต่ไม่มีชื่อ' }),
    ).rejects.toThrow(FreezeNameRequiredError);
  });

  it('ช่วงกลับหัวและช่วงยาวเกินเพดาน = ปฏิเสธ', async () => {
    await expect(
      createFreeze(ctx, {
        name: `กลับหัว ${STAMP}`,
        reason: 'x',
        startsAt: '2029-05-02T00:00:00.000Z',
        endsAt: '2029-05-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(BackwardWindowError);
    await expect(
      createFreeze(ctx, {
        name: `ยาวเกิน ${STAMP}`,
        reason: 'x',
        startsAt: '2029-01-01T00:00:00.000Z',
        endsAt: '2029-12-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(FreezeTooLongError);
  });

  it('**ชื่อซ้ำที่เริ่มเวลาเดียวกัน = ปฏิเสธด้วยข้อความที่อ่านรู้เรื่อง**', async () => {
    /*
      unique index กันไว้อยู่แล้ว แต่ข้อความจากฐานข้อมูลอ่านไม่รู้เรื่อง
      สำหรับผู้ดูแล — ต้องดักด้วยโค้ดก่อน แล้วให้ index เป็นด่านสุดท้าย
    */
    const input = {
      name: `ซ้ำ ${STAMP}`,
      reason: 'ครั้งแรก',
      startsAt: '2029-06-01T00:00:00.000Z',
      endsAt: '2029-06-02T00:00:00.000Z',
    };
    await createFreeze(ctx, input);
    await expect(createFreeze(ctx, { ...input, reason: 'ครั้งที่สอง' })).rejects.toThrow(
      DuplicateFreezeError,
    );
  });
});

describe('C · จำนวนที่กระทบ', () => {
  it('**นับหน้าต่างที่คาบเกี่ยวจริง และปลายชนต้นพอดีไม่นับ**', async () => {
    const inside = await newItem('IN');
    const touching = await newItem('TOUCH');
    const outside = await newItem('OUT');

    const f = await createFreeze(ctx, {
      name: `ปิดงบ ${STAMP}`,
      reason: 'ระบบบัญชีปิดงบ',
      startsAt: '2029-07-01T00:00:00.000Z',
      endsAt: '2029-07-10T00:00:00.000Z',
    });

    // อยู่ข้างใน — ต้องข้ามช่วงห้ามจึงจะบันทึกได้
    await setWindow(
      ctx,
      inside,
      {
        plannedStart: '2029-07-05T00:00:00.000Z',
        plannedEnd: '2029-07-05T02:00:00.000Z',
        freezeOverrideReason: 'งานฉุกเฉิน',
      },
      NOW,
    );
    // เริ่มพอดีตอนช่วงห้ามจบ — `[start, end)` จึงไม่นับ
    await setWindow(
      ctx,
      touching,
      { plannedStart: '2029-07-10T00:00:00.000Z', plannedEnd: '2029-07-10T02:00:00.000Z' },
      NOW,
    );
    await setWindow(
      ctx,
      outside,
      { plannedStart: '2029-08-01T00:00:00.000Z', plannedEnd: '2029-08-01T02:00:00.000Z' },
      NOW,
    );

    const row = (await mine()).find((x) => x.id === f.id.toString());
    expect(row?.affectedCount).toBe(1);
  });

  it('**ช่วงห้ามคนละช่วงได้เลขคนละตัว ไม่ใช่ยอดรวมของทุกหน้าต่าง**', async () => {
    /*
      คิวรีอ่านหน้าต่างในกรอบที่กว้างที่สุดของ **ทุกช่วงห้ามรวมกัน** รอบเดียว
      (กัน N+1) แล้วให้ `overlaps` แยกทีละช่วง · เคสข้างบนมีช่วงห้ามเดียวที่
      คาบเกี่ยว ตัวกรองของคิวรีจึงให้คำตอบเดียวกันพอดี — ลบ `overlaps` ทิ้งก็ยัง
      เขียว (พิสูจน์แล้วตอนลบทีละบรรทัด)

      ที่นี่ "สงกรานต์" อยู่เดือนเมษายน ส่วนหน้าต่างทั้งหมดอยู่เดือนกรกฎาคม–สิงหาคม
      ถ้านับด้วยจำนวนแถวที่คิวรีคืนมา มันจะได้เลขของเดือนกรกฎาคมไปด้วย
    */
    const april = (await mine()).find((x) => x.name === `สงกรานต์ ${STAMP}`);
    expect(april?.affectedCount).toBe(0);
  });
});

describe('D · ลบ', () => {
  it('**ลบช่วงห้ามแล้วหน้าต่างเวลาไม่ถูกย้อนกลับ — แค่ไม่มีคำเตือนแล้ว**', async () => {
    const inside = `SD-CF${STAMP}IN`;
    const before = await windowOf(ctx, inside, NOW);
    expect(before?.freezes.length).toBe(1);
    expect(before?.freezeOverrideReason).toBe('งานฉุกเฉิน');

    const f = (await mine()).find((x) => x.name === `ปิดงบ ${STAMP}`);
    await deleteFreeze(ctx, BigInt(f?.id ?? '0'));

    const after = await windowOf(ctx, inside, NOW);
    // หน้าต่างยังอยู่ที่เดิม
    expect(after?.plannedStart).toBe(before?.plannedStart);
    // คำเตือนหายไป แต่เหตุผลที่เคยข้ามยังอยู่ในแถว — ร่องรอยต้องไม่หาย
    expect(after?.freezes).toEqual([]);
    expect(after?.freezeOverrideReason).toBe('งานฉุกเฉิน');
  });

  it('ลบช่วงห้ามที่ไม่มีอยู่ = `FreezeNotFoundError`', async () => {
    await expect(deleteFreeze(ctx, BigInt('999999999'))).rejects.toThrow(FreezeNotFoundError);
  });
});
