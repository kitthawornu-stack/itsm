/**
 * รายงานเวลาของทีม — เทสต์เป็นข้อกำหนด
 *
 * ห้าข้อที่ต้องถูก:
 *
 *   1. **กรองด้วย `startedAt` ไม่ใช่ `createdAt`** — คนลงงานวันศุกร์ในเช้า
 *      วันจันทร์ · กรองผิดแล้วงานย้ายข้ามสัปดาห์ทุกครั้ง สัปดาห์ที่แล้วดูว่าง
 *      สัปดาห์นี้ดูล้น โดยไม่มีอะไรฟ้อง
 *   2. **จัดกลุ่มตามวันของไทย ไม่ใช่วัน UTC** — งานตอนตีหนึ่งไทยคือ 18:00Z
 *      ของวันก่อน · ใช้ UTC แล้วเจ็ดชั่วโมงของทุกวันไปอยู่ผิดถัง **และ
 *      ยอดรวมยังถูกอยู่** จึงไม่มีใครสังเกต
 *   3. **ยอดรวมต้องเท่ากับผลบวกของทุกถัง** — ยอดที่มาจากคิวรีคนละชุดกับถัง
 *      จะเริ่มไม่ตรงกันวันหนึ่ง แล้วไม่มีใครรู้ว่าอันไหนจริง
 *   4. **โปรเจกต์ที่เปิดดูไม่ได้ ต้องไม่โผล่ในยอด** — ยอดรวมบอกปริมาณงาน
 *      ของทีมอื่น และรายชื่อเรื่องบอกมากกว่านั้นอีก
 *   5. **วันที่ไม่มีใครบันทึก ต้องมีในกราฟ** — วันว่างคือข้อมูล · กราฟที่ข้าม
 *      วันว่างบีบเส้นเวลาให้สั้นลง แล้วสัปดาห์ที่เงียบดูเหมือนสัปดาห์ที่ยุ่ง
 */
import { toUtcDate, type TenantContext } from '@itsm/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { NoTimeReportAccessError, thaiMonth, timeReport } from '../src/modules/reporting';

const STAMP = String(Date.now()).slice(-6);
const MINE = `TRA${STAMP}`;
const HIDDEN = `TRB${STAMP}`;

/** กันยายน 2569 ตามปฏิทินไทย — ช่วงที่ทุกเคสอยู่ในนั้น */
const WIN = thaiMonth(2026, 9);

let tenantId: bigint;
let myProjectId: bigint;
let hiddenProjectId: bigint;
let ctx: TenantContext;
let meId: bigint | undefined;
let mateId: bigint | undefined;
let groupId: bigint | undefined;
let hiddenGroupId: bigint | undefined;
let schemeId: bigint | undefined;
let hiddenSchemeId: bigint | undefined;
let workflowId: bigint | undefined;
let issueTypeId: bigint;
let statusId: bigint;
const keys: string[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function mkItem(projectId: bigint, key: string, summary: string): Promise<bigint> {
  const w = await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey: key,
      issueTypeId,
      statusId,
      reporterId: meId as bigint,
      summary,
      rank: `0|${String(keys.length + 1)}000`,
    },
    select: { id: true, itemKey: true },
  });
  keys.push(w.itemKey);
  return w.id;
}

/**
 * บันทึกเวลาโดยระบุทั้งเวลาที่ทำงานและเวลาที่บันทึก
 *
 * `createdAt` ถูกตั้งด้วย raw SQL เพราะ Prisma เขียนทับตอน create — และ
 * **ความต่างของสองค่านี้คือทั้งหมดที่เทสต์ข้อแรกวัด**
 */
async function log(
  workItemId: bigint,
  userId: bigint,
  minutes: number,
  startedAt: string,
  createdAt?: string,
): Promise<void> {
  const row = await prismaClient.workLog.create({
    data: {
      tenantId,
      workItemId,
      userId,
      spentMinutes: minutes,
      startedAt: new Date(startedAt),
      note: `บันทึกทดสอบ ${STAMP}`,
    },
    select: { id: true },
  });
  if (createdAt !== undefined) {
    await prismaClient.$executeRaw`UPDATE work_log SET created_at = ${new Date(createdAt)} WHERE id = ${row.id}`;
  }
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  const mkScheme = async (n: string): Promise<bigint> =>
    (
      await prismaClient.permissionScheme.create({
        data: { tenantId, name: `ชุดสิทธิ์รายงานเวลา ${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  schemeId = await mkScheme('A');
  hiddenSchemeId = await mkScheme('B');

  const mkProject = async (key: string, scheme: bigint): Promise<bigint> =>
    (
      await prismaClient.project.create({
        data: {
          tenantId,
          key,
          name: `โปรเจกต์ทดสอบรายงานเวลา ${key}`,
          type: 'SERVICE_DESK',
          permissionSchemeId: scheme,
        },
        select: { id: true },
      })
    ).id;
  myProjectId = await mkProject(MINE, schemeId);
  hiddenProjectId = await mkProject(HIDDEN, hiddenSchemeId);

  const mkGroup = async (n: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `tra-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  groupId = await mkGroup('mine');
  hiddenGroupId = await mkGroup('hidden');

  const mkUser = async (n: string, g: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `tra-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId: g, userId: u.id } });
    return u.id;
  };
  meId = await mkUser('me', groupId);
  mateId = await mkUser('mate', groupId);

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId, permission: 'BROWSE_PROJECT', groupId },
      { tenantId, schemeId, permission: 'VIEW_REPORT', groupId },
      // โปรเจกต์ที่ซ่อน: ให้สิทธิ์กับกลุ่มที่ผู้ใช้ของเทสต์ไม่ได้อยู่
      { tenantId, schemeId: hiddenSchemeId, permission: 'BROWSE_PROJECT', groupId: hiddenGroupId },
      { tenantId, schemeId: hiddenSchemeId, permission: 'VIEW_REPORT', groupId: hiddenGroupId },
    ] as never,
  });

  const wf = await prismaClient.workflow.create({
    data: { tenantId, name: `wf รายงานเวลา ${STAMP}` },
    select: { id: true },
  });
  workflowId = wf.id;
  statusId = (
    await prismaClient.workflowStatus.create({
      data: {
        tenantId,
        workflowId: wf.id,
        name: `เปิด ${STAMP}`,
        category: 'TODO',
        position: 1,
        isInitial: true,
      },
      select: { id: true },
    })
  ).id;
  issueTypeId = (await prismaClient.workItem.findFirstOrThrow({ select: { issueTypeId: true } }))
    .issueTypeId;

  ctx = { tenantId, actorId: meId };

  // ---------- ข้อมูลของรายงาน ----------
  const a = await mkItem(myProjectId, `${MINE}-1`, 'เครื่องพิมพ์ชั้น 3 ใช้ไม่ได้');
  const b = await mkItem(myProjectId, `${MINE}-2`, 'ตั้งค่าเครื่องใหม่ให้พนักงานใหม่');
  const hidden = await mkItem(hiddenProjectId, `${HIDDEN}-1`, 'งานของทีมที่เราไม่เห็น');

  /*
    10 ก.ย. 2569 เวลา 16:00 ไทย = 09:00Z · อยู่ในวันเดียวกันทั้งสองเขตเวลา
  */
  await log(a, meId, 120, '2026-09-10T09:00:00.000Z');

  /*
    **เคสสำคัญที่สุด**: 11 ก.ย. เวลา 01:00 ไทย = 10 ก.ย. 18:00Z
    ถ้าจัดกลุ่มด้วยวัน UTC จะไปตกวันที่ 10 ซึ่งผิด
  */
  await log(a, meId, 60, '2026-09-10T18:00:00.000Z');

  /*
    งานของวันที่ 4 ที่ **บันทึกวันที่ 30** — ถ้ากรองด้วย `createdAt` จะยังอยู่ในเดือน
    เดียวกันจึงจับไม่ได้ · จึงตั้ง `createdAt` ไว้เดือนถัดไปเพื่อให้ต่างชัด
  */
  await log(b, mateId as bigint, 90, '2026-09-04T03:00:00.000Z', '2026-10-02T03:00:00.000Z');

  // นอกช่วง — ต้องไม่ถูกนับ
  await log(a, meId, 999, '2026-08-31T09:00:00.000Z');

  // โปรเจกต์ที่ผู้ใช้ของเทสต์เปิดดูไม่ได้
  await log(hidden, mateId as bigint, 480, '2026-09-05T03:00:00.000Z');
}, 180_000);

afterAll(async () => {
  await step('บันทึกเวลา', () =>
    prismaClient.workLog.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('งาน', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
  await step('โปรเจกต์', () =>
    prismaClient.project.deleteMany({ where: { key: { in: [MINE, HIDDEN] } } }),
  );
  await step('สถานะ', () =>
    prismaClient.workflowStatus.deleteMany({ where: { workflowId: workflowId ?? 0n } }),
  );
  await step('workflow', () => prismaClient.workflow.deleteMany({ where: { id: workflowId ?? 0n } }));
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({
      where: { groupId: { in: [groupId, hiddenGroupId].filter((v): v is bigint => v !== undefined) } },
    }),
  );
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({
      where: { schemeId: { in: [schemeId, hiddenSchemeId].filter((v): v is bigint => v !== undefined) } },
    }),
  );
  await step('กลุ่ม', () =>
    prismaClient.userGroup.deleteMany({
      where: { id: { in: [groupId, hiddenGroupId].filter((v): v is bigint => v !== undefined) } },
    }),
  );
  await step('ผู้ใช้', () =>
    prismaClient.user.deleteMany({ where: { email: { contains: `-${STAMP}@example.test` } } }),
  );
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({
      where: { id: { in: [schemeId, hiddenSchemeId].filter((v): v is bigint => v !== undefined) } },
    }),
  );
  await prismaClient.$disconnect();
}, 180_000);

describe('A · ขอบเขตของตัวเลข', () => {
  it('**นับเฉพาะโปรเจกต์ที่เปิดดูได้**', async () => {
    /*
      ยอดรวมที่กินโปรเจกต์ที่เขาเห็นไม่ได้ ทำให้เขารู้ปริมาณงานของทีมอื่น
      และรายชื่อเรื่องยิ่งบอกมากกว่านั้นอีก
    */
    const r = await timeReport(ctx, WIN);
    expect(r.projects).toEqual([MINE]);
    expect(r.byProject.map((b) => b.name)).toEqual([MINE]);
    expect(r.topItems.every((i) => i.itemKey.startsWith(MINE))).toBe(true);
    // 480 นาทีของโปรเจกต์ที่ซ่อนต้องไม่โผล่ในยอดรวม
    expect(r.totalMinutes).toBe(120 + 60 + 90);
  }, 60_000);

  it('**นอกช่วงเวลาไม่ถูกนับ**', async () => {
    /*
      มีบันทึก 999 นาทีของวันที่ 31 ส.ค. รออยู่ · ถ้าตัวกรองช่วงหลุด ยอดจะเป็น
      1,269 ทันที ซึ่งเป็นตัวเลขที่ต่างชัดพอให้จับได้ในนัดเดียว
    */
    const r = await timeReport(ctx, WIN);
    expect(r.totalMinutes).toBe(270);
  }, 60_000);

  it('ระบุโปรเจกต์ที่ไม่มีสิทธิ์ ได้คำปฏิเสธ ไม่ใช่ยอดศูนย์', async () => {
    // ยอดศูนย์อ่านว่า "โปรเจกต์นี้ไม่มีใครบันทึกเวลาเลย" ซึ่งเป็นข้อมูลที่เขาไม่ควรได้
    await expect(timeReport(ctx, WIN, { projectId: hiddenProjectId })).rejects.toThrow(
      NoTimeReportAccessError,
    );
  }, 60_000);
});

describe('B · จัดกลุ่มตามวัน', () => {
  it('**งานตอนตีหนึ่งไทย ต้องอยู่วันของไทย ไม่ใช่วัน UTC**', async () => {
    /*
      11 ก.ย. 01:00 ไทย = 10 ก.ย. 18:00Z · จัดกลุ่มด้วย UTC แล้วมันไปตกวันที่ 10
      — เจ็ดชั่วโมงของทุกวันไปอยู่ผิดถัง **และยอดรวมยังถูกอยู่** จึงไม่มีใครสังเกต
    */
    const r = await timeReport(ctx, WIN);
    const byDay = new Map(r.daily.map((d) => [d.day, d.minutes]));
    expect(byDay.get('2026-09-10')).toBe(120);
    expect(byDay.get('2026-09-11')).toBe(60);
  }, 60_000);

  it('**วันที่ไม่มีใครบันทึก ต้องมีในกราฟ**', async () => {
    // กราฟที่ข้ามวันว่างบีบเส้นเวลาให้สั้นลง แล้วสัปดาห์ที่เงียบดูเหมือนสัปดาห์ที่ยุ่ง
    const r = await timeReport(ctx, WIN);
    expect(r.daily).toHaveLength(30);
    expect(r.daily.filter((d) => d.minutes === 0).length).toBeGreaterThan(20);
  }, 60_000);

  it('**ยอดรวมเท่ากับผลบวกของทุกถัง**', async () => {
    /*
      ยอดที่มาจากคิวรีคนละชุดกับถัง จะเริ่มไม่ตรงกันวันหนึ่ง แล้วไม่มีใครรู้ว่า
      อันไหนจริง · เทสต์นี้เทียบสี่ทางพร้อมกัน
    */
    const r = await timeReport(ctx, WIN);
    const sum = (xs: { minutes: number }[]): number => xs.reduce((a, b) => a + b.minutes, 0);
    expect(sum(r.daily)).toBe(r.totalMinutes);
    expect(sum(r.byUser)).toBe(r.totalMinutes);
    expect(sum(r.byProject)).toBe(r.totalMinutes);
    // topItems ถูกตัดตามเพดานได้ จึงเทียบเฉพาะตอนที่ไม่มีอะไรถูกตัด
    if (r.itemsNotShown === 0) expect(sum(r.topItems)).toBe(r.totalMinutes);
  }, 60_000);
});

describe('C · เวลาที่ทำงาน ไม่ใช่เวลาที่บันทึก', () => {
  it('**งานของวันที่ 4 ที่บันทึกเดือนถัดไป ยังนับให้เดือนกันยายน**', async () => {
    /*
      กรองด้วย `createdAt` แล้วงาน 90 นาทีนี้จะหายไปจากเดือนกันยายนทั้งก้อน
      และไปโผล่ในเดือนตุลาคมแทน — คนที่ดูรายงานเดือนกันยายนจะไม่มีทางรู้
    */
    const r = await timeReport(ctx, WIN);
    const byDay = new Map(r.daily.map((d) => [d.day, d.minutes]));
    expect(byDay.get('2026-09-04')).toBe(90);

    // และมันมาจากแถวที่ `createdAt` อยู่คนละเดือนจริง ๆ
    const row = await prismaClient.workLog.findFirstOrThrow({
      where: { spentMinutes: 90, workItem: { itemKey: { in: keys } } },
      select: { startedAt: true, createdAt: true },
    });
    expect(toUtcDate(row.createdAt).getUTCMonth()).not.toBe(
      toUtcDate(row.startedAt).getUTCMonth(),
    );
  }, 60_000);
});

describe('D · แยกตามคน', () => {
  it('เรียงจากมากไปน้อย และบอกจำนวนคนที่บันทึก', async () => {
    const r = await timeReport(ctx, WIN);
    expect(r.byUser.map((b) => b.minutes)).toEqual([180, 90]);
    // 0 คนกับ 0 นาที เป็นคนละเรื่อง — ตัวเลขนี้จึงแยกออกมา
    expect(r.contributors).toBe(2);
  }, 60_000);

  it('แสดงเป็นข้อความที่คนอ่านออก ไม่ใช่จำนวนนาทีดิบ', async () => {
    const r = await timeReport(ctx, WIN);
    expect(r.totalText).toBe('4h 30m');
    expect(r.byUser[0]?.text).toBe('3h');
  }, 60_000);

  it('**บอกจำนวนเรื่องที่ถูกตัดออกจากตาราง**', async () => {
    /*
      ตัดเงียบ ๆ อ่านเหมือนครอบทั้งหมด · ต้องวัดด้วยเพดานที่ทำให้มีของถูกตัดจริง
      — เพดานจริง 10 กับข้อมูลสองใบ ทำให้ค่าที่ถูกและค่าที่ตายตัวเท่ากันพอดี
      แล้วเคสนี้จะเขียวแม้โค้ดจะเขียน 0 ทิ้งไว้เฉย ๆ (พิสูจน์มาแล้วตอนลบทีละบรรทัด)
    */
    const cut = await timeReport(ctx, WIN, { topItems: 1 });
    expect(cut.topItems).toHaveLength(1);
    expect(cut.itemsNotShown).toBe(1);

    const all = await timeReport(ctx, WIN);
    expect(all.itemsNotShown).toBe(0);
    expect(all.topItems).toHaveLength(2);
  }, 60_000);
});
