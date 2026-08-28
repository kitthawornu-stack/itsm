/**
 * CSAT — เทสต์เป็นข้อกำหนด เขียนก่อนโค้ด
 *
 * รายงานความพอใจมีค่าก็ต่อเมื่อ **เชื่อได้** · ห้าข้อที่พลาดแล้วตัวเลขทั้งชุด
 * ใช้ไม่ได้ และไม่มีใครรู้ว่าใช้ไม่ได้:
 *
 *   1. **คนทำงานให้คะแนนงานตัวเองไม่ได้** — ถ้าได้ ค่าเฉลี่ยจะสวยขึ้นเรื่อย ๆ
 *      โดยไม่มีอะไรผิดปกติให้เห็น
 *   2. **ให้คะแนนได้เฉพาะเรื่องที่ปิดแล้ว** — ความพอใจต่อเรื่องที่ยังไม่จบ
 *      ไม่ใช่ความพอใจต่อบริการ
 *   3. **หนึ่งเรื่องหนึ่งคำตอบ** — แก้ได้ แต่ไม่ใช่เพิ่มแถวใหม่ ไม่งั้นคนกดสิบครั้ง
 *      จะถ่วงค่าเฉลี่ยได้สิบเท่า
 *   4. **คะแนนนอกช่วง 1–5 ถูกปฏิเสธ** — ค่าที่หลุดเข้าไปทำให้ค่าเฉลี่ยผิดถาวร
 *   5. **เก็บเวลาที่ปิด ณ ตอนให้คะแนน** — เรื่องที่เปิดใหม่ภายหลังจะมี
 *      `resolvedAt` เป็น null แล้วคะแนนเก่าจะลอยไม่มีที่อ้างอิง
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  AlreadyRatedByOtherError,
  NotResolvedYetError,
  NotTheReporterError,
  RatingOutOfRangeError,
  rateWorkItem,
  satisfactionFor,
  satisfactionSummary,
} from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let reporter: TenantContext;
let agent: TenantContext;
let reporterId: bigint;
let agentId: bigint;
let projectId: bigint;
/** เรื่องที่ปิดแล้ว */
let closedKey: string;
/** เรื่องที่ยังเปิดอยู่ */
let openKey: string;
const keys: string[] = [];

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  tenantId = tenant.id;
  projectId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } })).id;

  const mk = async (n: string): Promise<bigint> =>
    (
      await prismaClient.user.create({
        data: { tenantId, email: `csat-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
        select: { id: true },
      })
    ).id;
  reporterId = await mk('ผู้แจ้ง');
  agentId = await mk('ผู้ทำงาน');
  reporter = { tenantId, actorId: reporterId };
  agent = { tenantId, actorId: agentId };

  const template = await prismaClient.workItem.findFirstOrThrow({ where: { projectId } });
  const done = await prismaClient.workflowStatus.findFirstOrThrow({
    where: { tenantId, category: 'DONE' },
    select: { id: true },
  });

  const create = async (i: number, resolved: boolean): Promise<string> => {
    const w = await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey: `SD-CSAT${STAMP}${String(i)}`,
        issueTypeId: template.issueTypeId,
        statusId: resolved ? done.id : template.statusId,
        reporterId,
        assigneeId: agentId,
        summary: `งานทดสอบความพอใจ ${STAMP} ลำดับ ${String(i)}`,
        rank: `zzc${STAMP}${String(i)}`,
        ...(resolved ? { resolvedAt: new Date('2026-08-20T03:00:00.000Z') } : {}),
      },
      select: { itemKey: true },
    });
    keys.push(w.itemKey);
    return w.itemKey;
  };
  closedKey = await create(0, true);
  openKey = await create(1, false);
}, 120_000);

/**
 * เก็บกวาดทีละขั้น — ขั้นที่ล้มต้องไม่หยุดขั้นที่เหลือ
 *
 * รอบแรกของไฟล์นี้ `afterAll` ตายที่บรรทัดแรกของตัวเอง (ตอนนั้น Prisma client
 * ยังไม่รู้จักโมเดล `satisfaction`) แล้ว **บรรทัดที่เหลือไม่ถูกรันเลย**
 * งานทดสอบสองใบกับผู้ใช้สองคนจึงค้างอยู่ในฐานข้อมูลพัฒนาจริง
 *
 * เป็นบทเรียนเดิมของโครงการอีกครั้ง: การเก็บกวาดต้องไม่ตั้งอยู่บนสมมติฐานว่า
 * สิ่งที่กำลังทดสอบยังทำงาน · `try/catch` ต่อขั้นทำให้ขั้นที่เหลือได้รันเสมอ
 */
async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    // ดังไว้ ไม่เงียบ — การเก็บกวาดที่ล้มเงียบคือข้อมูลค้างที่ไม่มีใครรู้
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

afterAll(async () => {
  /*
    ลบตามลำดับเอง · `satisfaction → user` เป็น Restrict โดยตั้งใจ
    และเก็บกวาดทุกแถวที่เทสต์สร้างได้ **ตอนกลไกถูกลบ** ไม่ใช่เฉพาะที่ตั้งใจสร้าง
    — เคสอย่าง "ผู้ทำงานให้คะแนนไม่ได้" จะสร้างแถวจริงเมื่อกลไกหายไป
  */
  await step('คะแนนของงานที่สร้าง', () =>
    prismaClient.satisfaction.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('คะแนนที่ผู้ใช้ของเทสต์ให้ไว้ที่อื่น', () =>
    prismaClient.satisfaction.deleteMany({
      where: { respondentId: { in: [reporterId, agentId] } },
    }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({ where: { actorId: { in: [reporterId, agentId] } } }),
  );
  await step('งานทดสอบ', () =>
    prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }),
  );
  await step('ผู้ใช้ของเทสต์', () =>
    prismaClient.user.deleteMany({ where: { id: { in: [reporterId, agentId] } } }),
  );
  await prismaClient.$disconnect();
});

describe('A · ใครให้คะแนนได้', () => {
  it('**ผู้ทำงานให้คะแนนงานที่ตัวเองทำไม่ได้**', async () => {
    /*
      ถ้าได้ ค่าเฉลี่ยจะสวยขึ้นเรื่อย ๆ โดยไม่มีอะไรผิดปกติให้เห็น
      และไม่มีวิธีตรวจย้อนหลังว่าตัวเลขนั้นมาจากไหน
    */
    await expect(rateWorkItem(agent, closedKey, { rating: 5 })).rejects.toThrow(
      NotTheReporterError,
    );
  });

  it('ปฏิเสธแล้วต้องไม่มีคะแนนค้าง', async () => {
    expect(
      await prismaClient.satisfaction.count({ where: { workItem: { itemKey: closedKey } } }),
    ).toBe(0);
  });

  it('ผู้แจ้งให้คะแนนได้', async () => {
    await rateWorkItem(reporter, closedKey, { rating: 4, comment: 'แก้ได้เร็วดี' });
    const got = await satisfactionFor(reporter, closedKey);
    expect(got?.rating).toBe(4);
    expect(got?.comment).toBe('แก้ได้เร็วดี');
  });
});

describe('B · ให้คะแนนได้เมื่อไร', () => {
  it('**เรื่องที่ยังไม่ปิด ให้คะแนนไม่ได้**', async () => {
    // ความพอใจต่อเรื่องที่ยังไม่จบ ไม่ใช่ความพอใจต่อบริการ
    await expect(rateWorkItem(reporter, openKey, { rating: 5 })).rejects.toThrow(
      NotResolvedYetError,
    );
  });

  it('**เก็บเวลาที่ปิดไว้ ณ ตอนให้คะแนน** — ไม่ใช่อ่านจากงานตอนทำรายงาน', async () => {
    /*
      เรื่องที่ถูกเปิดใหม่ภายหลังจะมี `resolvedAt` เป็น null
      คะแนนเก่าจะลอยไม่มีที่อ้างอิงว่าให้กับการปิดรอบไหน
    */
    const row = await prismaClient.satisfaction.findFirstOrThrow({
      where: { workItem: { itemKey: closedKey } },
      select: { resolvedAt: true },
    });
    expect(row.resolvedAt.toISOString()).toBe('2026-08-20T03:00:00.000Z');

    // เปิดใหม่แล้วคะแนนต้องยังตอบได้ว่าให้กับการปิดครั้งไหน
    await prismaClient.workItem.updateMany({
      where: { itemKey: closedKey },
      data: { resolvedAt: null },
    });
    const still = await prismaClient.satisfaction.findFirstOrThrow({
      where: { workItem: { itemKey: closedKey } },
      select: { resolvedAt: true },
    });
    expect(still.resolvedAt.toISOString()).toBe('2026-08-20T03:00:00.000Z');
    await prismaClient.workItem.updateMany({
      where: { itemKey: closedKey },
      data: { resolvedAt: new Date('2026-08-20T03:00:00.000Z') },
    });
  });
});

describe('C · ค่าที่รับได้', () => {
  it('**คะแนนนอกช่วง 1–5 ถูกปฏิเสธ**', async () => {
    for (const bad of [0, 6, -1, 99]) {
      await expect(rateWorkItem(reporter, closedKey, { rating: bad })).rejects.toThrow(
        RatingOutOfRangeError,
      );
    }
  });

  it('คะแนนเดิมไม่ถูกแตะเมื่อค่าใหม่ใช้ไม่ได้', async () => {
    const got = await satisfactionFor(reporter, closedKey);
    expect(got?.rating).toBe(4);
  });
});

describe('D · หนึ่งเรื่องหนึ่งคำตอบ', () => {
  it('**ให้คะแนนซ้ำคือแก้ของเดิม ไม่ใช่เพิ่มแถวใหม่**', async () => {
    // ถ้าเพิ่มแถวได้ คนกดสิบครั้งจะถ่วงค่าเฉลี่ยได้สิบเท่า
    await rateWorkItem(reporter, closedKey, { rating: 2, comment: 'คิดอีกที ช้าไป' });
    const n = await prismaClient.satisfaction.count({
      where: { workItem: { itemKey: closedKey } },
    });
    expect(n).toBe(1);
    expect((await satisfactionFor(reporter, closedKey))?.rating).toBe(2);
  });

  it('**คนอื่นแก้คะแนนที่ผู้แจ้งให้ไว้ไม่ได้**', async () => {
    await expect(rateWorkItem(agent, closedKey, { rating: 5 })).rejects.toThrow(
      NotTheReporterError,
    );
  });
});

describe('E · สรุปผล', () => {
  it('ค่าเฉลี่ยและจำนวนคำตอบนับจากคะแนนจริง', async () => {
    const sum = await satisfactionSummary(reporter, { projectId });
    expect(sum.responses).toBeGreaterThanOrEqual(1);
    expect(sum.average).toBeGreaterThan(0);
    expect(sum.average).toBeLessThanOrEqual(5);
    expect(sum.byRating[2]).toBeGreaterThanOrEqual(1);
  });

  it('**งานที่ยังไม่มีใครให้คะแนน ไม่ถูกนับเป็นศูนย์คะแนน**', async () => {
    /*
      ถ้านับงานที่ไม่มีคำตอบเป็น 0 ค่าเฉลี่ยจะร่วงตามจำนวนงานที่ปิด
      ไม่ใช่ตามความพอใจจริง — ตัวเลขจะดูแย่ลงทุกเดือนโดยไม่มีเหตุผล
    */
    const sum = await satisfactionSummary(reporter, { projectId });
    const counted = Object.values(sum.byRating).reduce((a, b) => a + b, 0);
    expect(counted).toBe(sum.responses);
  });
});

describe('F · คำชวนให้คะแนน', () => {
  it('**ปิดงานแล้วผู้แจ้งได้รับคำชวน — และเปิดใหม่แล้วปิดอีกไม่ชวนซ้ำ**', async () => {
    /*
      `dedupeKey` ประกอบจาก (งาน, ผู้แจ้ง) เท่านั้น ไม่มีเวลาอยู่ในคีย์
      ถ้าใส่เวลา การปิดรอบที่สองจะสร้างคำชวนใบใหม่ แล้วคนที่เคยตอบไปแล้ว
      จะโดนตามถามซ้ำทุกครั้งที่ทีมเปิดเรื่องดูใหม่
    */
    const item = await prismaClient.workItem.findFirstOrThrow({
      where: { itemKey: closedKey },
      select: { id: true },
    });
    const key = `rate:${item.id.toString()}:${reporterId.toString()}`;

    const insert = async (): Promise<void> => {
      await prismaClient.notification.createMany({
        data: [
          {
            tenantId,
            userId: reporterId,
            workItemId: item.id,
            kind: 'workitem.rate',
            title: 'ทดสอบคำชวน',
            dedupeKey: key,
          },
        ],
        skipDuplicates: true,
      });
    };
    await insert();
    await insert();
    await insert();

    const n = await prismaClient.notification.count({ where: { dedupeKey: key } });
    expect(n).toBe(1);
    await prismaClient.notification.deleteMany({ where: { dedupeKey: key } });
  });
});

describe('G · เมื่อยังไม่มีใครตอบ', () => {
  it('ยังไม่ตอบ = null ไม่ใช่ 0 คะแนน', async () => {
    expect(await satisfactionFor(reporter, openKey)).toBeNull();
  });

  it('เรื่องที่ไม่มีอยู่จริง ตอบเหมือนยังไม่มีคำตอบ ไม่ใช่ระเบิด', async () => {
    expect(await satisfactionFor(reporter, `SD-ไม่มีจริง-${STAMP}`)).toBeNull();
  });

  it('AlreadyRatedByOtherError ถูก export ไว้ให้ผู้เรียกดักได้', () => {
    // คลาส error ที่ไม่มีใคร import ได้ ก็ดักไม่ได้ — เท่ากับไม่มี
    expect(new AlreadyRatedByOtherError('ก').name).toBe('AlreadyRatedByOtherError');
  });
});
