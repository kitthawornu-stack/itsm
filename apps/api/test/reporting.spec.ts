/**
 * รายงาน — เทสต์เป็นข้อกำหนด เขียนก่อนโค้ด
 *
 * `VIEW_REPORT` แสดงบนหน้าตั้งค่าโปรเจกต์ว่า "ดูรายงาน" มาตั้งแต่ Phase 0
 * แต่อยู่ใน `UNENFORCED_PERMISSIONS` และโมดูล `reporting` ว่างเปล่า —
 * รูปแบบเดียวกับ `BULK_EDIT` และ `LINK_ITEM`
 *
 * ห้าข้อที่ต้องถูกตั้งแต่แรก เพราะรายงานที่ผิดจะถูกเชื่อไปเรื่อย ๆ:
 *
 *   1. **นับจากเหตุการณ์ ไม่ใช่จากสถานะปัจจุบัน** — ใบที่ปิดเดือนที่แล้วแล้ว
 *      เปิดใหม่เดือนนี้ ยังต้องอยู่ในยอดของเดือนที่แล้ว · รายงานที่เปลี่ยน
 *      ย้อนหลังโดยไม่มีใครแตะมัน คือรายงานที่เชื่อไม่ได้
 *   2. **ขอบวันเป็นเวลาไทย** — งานที่ปิด 00:30 น. วันที่ 1 ต้องอยู่เดือนใหม่
 *   3. **ค่าเฉลี่ยของศูนย์ใบคือ `null`** — "ปิดเฉลี่ย 0 ชั่วโมง" อ่านว่าปิดทันที
 *   4. **นับเฉพาะโปรเจกต์ที่อ่านได้** — ยอดรวมที่กินโปรเจกต์ที่มองไม่เห็น
 *      คือการรั่วที่ตรวจยากที่สุด เพราะไม่มีคีย์เรื่องไหนโผล่ให้เห็น
 *   5. **SLA ที่หลุด นับจาก `breachedAt`** — `isBreached` ตอบไม่ได้ว่าหลุดตอนไหน
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toUtcDate, type TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import { NoReportAccessError, reportSummary, thaiMonth } from '../src/modules/reporting';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
/** มี VIEW_REPORT ในโปรเจกต์ SD */
let reader: TenantContext;
/** เห็นงานได้ แต่ดูรายงานไม่ได้ */
let blind: TenantContext;
let readerId: bigint | undefined;
let blindId: bigint | undefined;
let readerGroupId: bigint | undefined;
let blindGroupId: bigint | undefined;
let projectId: bigint;
let hiddenProjectId: bigint;

const keys: string[] = [];

/** สิงหาคม 2569 ตามปฏิทินไทย — ช่วงที่งานทดสอบทั้งหมดตกอยู่ */
const AUG = thaiMonth(2026, 8);
const JUL = thaiMonth(2026, 7);

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  hiddenProjectId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'PLAT' } })).id;

  /*
    **โปรเจกต์และชุดสิทธิ์ของตัวเอง ไม่ยืมของ seed**

    รอบแรกใช้โปรเจกต์ SD แล้วเทียบตัวเลขแบบตายตัว · ผลคือเทสต์แดงด้วยเหตุผล
    ที่ไม่เกี่ยวกับสิ่งที่วัด (`expected 2942 to be 4`) เพราะงานของ seed 10,000 ใบ
    อยู่ในช่วงเดียวกัน · และชุดสิทธิ์ของ SD ยังใช้ร่วมกับโปรเจกต์ HR
    การให้ `VIEW_REPORT` บนชุดนั้นจึงให้สิทธิ์กับสองโปรเจกต์พร้อมกันโดยไม่ตั้งใจ

    รายงานเป็นตัวเลขรวม — เทสต์ที่ยืมข้อมูลของคนอื่นมาใช้ จึงยืนยันอะไรไม่ได้เลย
  */
  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์รายงาน ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `RPT${STAMP}`,
      name: `โปรเจกต์ทดสอบรายงาน ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = project.id;

  const mkGroup = async (n: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `rep-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  readerGroupId = await mkGroup('reader');
  blindGroupId = await mkGroup('blind');

  const mkUser = async (n: string, groupId: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `rep-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  readerId = await mkUser('reader', readerGroupId);
  blindId = await mkUser('blind', blindGroupId);

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: readerGroupId },
      { tenantId, schemeId: scheme.id, permission: 'VIEW_REPORT', groupId: readerGroupId },
      // เห็นงานได้ แต่ดูรายงานไม่ได้ — สองสิทธิ์นี้ตอบคนละคำถาม
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: blindGroupId },
    ],
  });

  reader = { tenantId, actorId: readerId };
  blind = { tenantId, actorId: blindId };

  // ยืมแค่ "ชนิดงาน" กับ "สถานะ" ที่มีอยู่ — ไม่ยืมงานหรือยอดของใคร
  const template = await prismaClient.workItem.findFirstOrThrow({
    select: { issueTypeId: true, statusId: true },
  });

  /*
    งานทดสอบที่คุมเวลาเองทุกใบ — ไม่พึ่งเวลาปัจจุบัน จึงรันซ้ำได้ตลอดไป
    และไม่แตะงานของ seed แม้แต่ใบเดียว

    `createdAt` ต้องเขียนตรง ๆ เพราะ Prisma ตั้ง `now()` ให้เป็นค่าปริยาย
  */
  /*
    จับค่าไว้นอก closure ครั้งเดียว

    `readerId` ประกาศเป็น `bigint | undefined` เพราะ `beforeAll` ล้มกลางทางได้
    · ตรงนี้ TypeScript รู้แล้วว่าเป็น `bigint` (เพิ่งกำหนดค่าไป) แต่**ข้างใน
    closure มันกว้างกลับเป็นชนิดที่ประกาศ** — จึงต้องจับค่าไว้ ไม่ใช่ใส่ `!`
    ซึ่งจะกลบข้อเท็จจริงว่ามันว่างได้จริงตอน `beforeAll` ล้ม
  */
  const owner = readerId;

  const mk = async (
    n: number,
    createdIso: string,
    resolvedIso: string | null,
  ): Promise<void> => {
    const w = await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey: `RPT${STAMP}-${String(n)}`,
        issueTypeId: template.issueTypeId,
        statusId: template.statusId,
        reporterId: owner,
        assigneeId: n % 2 === 0 ? owner : null,
        summary: `งานทดสอบรายงาน ${STAMP} ลำดับ ${String(n)}`,
        rank: `zzw${STAMP}${String(n)}`,
        createdAt: new Date(createdIso),
        ...(resolvedIso === null ? {} : { resolvedAt: new Date(resolvedIso) }),
      },
      select: { itemKey: true },
    });
    keys.push(w.itemKey);
  };

  // สองใบเปิดกลางเดือนสิงหาคม ปิดในเดือนเดียวกัน
  await mk(0, '2026-08-10T03:00:00.000Z', '2026-08-11T03:00:00.000Z');
  await mk(1, '2026-08-12T03:00:00.000Z', '2026-08-13T03:00:00.000Z');
  // เปิดสิงหาคม ยังไม่ปิด
  await mk(2, '2026-08-15T03:00:00.000Z', null);
  /*
    ขอบเดือน: 31 ก.ค. 17:30 UTC = 1 ส.ค. 00:30 น. เวลาไทย
    ต้องนับเข้าเดือนสิงหาคม ไม่ใช่กรกฎาคม
  */
  await mk(3, '2026-07-31T17:30:00.000Z', '2026-08-02T03:00:00.000Z');
  // ก่อนเที่ยงคืนไทยครึ่งชั่วโมง — ยังเป็นเดือนกรกฎาคม
  await mk(4, '2026-07-31T16:30:00.000Z', '2026-07-31T16:45:00.000Z');
}, 180_000);

afterAll(async () => {
  const owners = [readerId, blindId].filter((v): v is bigint => v !== undefined);
  await step('งานทดสอบ', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
  await step('โปรเจกต์ทดสอบ', () =>
    prismaClient.project.deleteMany({ where: { key: `RPT${STAMP}` } }),
  );
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({
      where: { groupId: { in: [readerGroupId, blindGroupId].filter((v) => v !== undefined) } },
    }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { userId: { in: owners } } }),
  );
  await step('ผู้ใช้', () => prismaClient.user.deleteMany({ where: { id: { in: owners } } }));
  await step('กลุ่ม', () =>
    prismaClient.userGroup.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  // ชุดสิทธิ์ต้องลบหลังโปรเจกต์ — `permissionSchemeId` เป็น SetNull ไม่ได้กันให้
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await prismaClient.$disconnect();
});

describe('A · สิทธิ์', () => {
  it('**เห็นงานได้ ไม่ได้แปลว่าดูรายงานได้**', async () => {
    /*
      ถ้าตรวจ `BROWSE_PROJECT` แล้วถือว่าครอบ คีย์ `VIEW_REPORT` จะไม่มีผลอยู่ดี
      และหน้าตั้งค่าจะยังโกหกต่อไปในแบบเดิม
    */
    await expect(reportSummary(blind, AUG, projectId)).rejects.toThrow(PermissionDeniedError);
  });

  it('ไม่มีโปรเจกต์ไหนดูรายงานได้เลย = ปฏิเสธ ไม่ใช่ยอดศูนย์', async () => {
    /*
      ยอดศูนย์อ่านว่า "ไม่มีงานเลย" ซึ่งเป็นคำตอบที่ผิดคนละเรื่องกับ
      "คุณดูรายงานไม่ได้" · ผู้บริหารที่เห็นศูนย์จะสรุปว่าทีมไม่ได้ทำอะไร
    */
    await expect(reportSummary(blind, AUG)).rejects.toThrow(NoReportAccessError);
  });

  it('ขอรายงานของโปรเจกต์ที่เปิดดูไม่ได้ ถูกปฏิเสธ', async () => {
    await expect(reportSummary(reader, AUG, hiddenProjectId)).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it('**ยอดรวมนับเฉพาะโปรเจกต์ที่ดูรายงานได้**', async () => {
    const all = await reportSummary(reader, AUG);
    expect(all.projects).toEqual([`RPT${STAMP}`]);
  });
});

describe('B · ขอบของเดือนเป็นเวลาไทย', () => {
  it('**งานที่เปิด 00:30 น. วันที่ 1 อยู่ในเดือนใหม่**', async () => {
    /*
      เคสที่ทั้งไฟล์นี้มีไว้เพื่อดัก · เวลานั้นเป็น 31 ก.ค. ใน UTC
      ถ้าหั่นตามเดือน UTC ใบนี้จะไปอยู่เดือนกรกฎาคม ทั้งที่คนแจ้งเห็นเป็นสิงหาคม
      — ไม่มี error ไม่มีอะไรผิดสังเกต แค่ยอดสองเดือนคลาดกันทุกเดือน
    */
    const aug = await reportSummary(reader, AUG, projectId);
    const jul = await reportSummary(reader, JUL, projectId);
    expect(aug.opened).toBe(4);
    // ใบที่ 3 อยู่สิงหาคม · ใบที่ 4 อยู่กรกฎาคม แม้ห่างกันชั่วโมงเดียว
    expect(jul.opened).toBe(1);
  });

  it('รายวันมีครบทุกวันของเดือน รวมวันที่ไม่มีงาน', async () => {
    const r = await reportSummary(reader, AUG, projectId);
    expect(r.daily).toHaveLength(31);
    expect(r.daily[0]?.day).toBe('2026-08-01');
    // ใบที่เปิด 00:30 น. วันที่ 1 ต้องตกในแท่งของวันที่ 1
    expect(r.daily[0]?.opened).toBe(1);
    expect(r.daily.every((d) => d.opened >= 0 && d.resolved >= 0)).toBe(true);
  });
});

describe('C · นับจากเหตุการณ์ ไม่ใช่สถานะปัจจุบัน', () => {
  it('**ปิดกี่ใบ นับจากเวลาที่ปิด ไม่ใช่จากสถานะตอนนี้**', async () => {
    const r = await reportSummary(reader, AUG, projectId);
    // ใบ 0, 1, 3 ปิดในเดือนสิงหาคม · ใบ 4 ปิดกรกฎาคม · ใบ 2 ยังไม่ปิด
    expect(r.resolved).toBe(3);
  });

  it('ใบที่ถูกเปิดใหม่ ยังอยู่ในยอดของเดือนที่มันเคยปิด', async () => {
    /*
      จำลองการเปิดใหม่: ล้าง `resolvedAt` เหมือนที่ `applyTransition` ทำ
      ตอนงานออกจากหมวด DONE · ถ้ารายงานนับจากสถานะปัจจุบัน ยอดของเดือน
      สิงหาคมจะลดลงย้อนหลัง ทั้งที่ใบนั้นปิดไปจริงในเดือนนั้น

      เทสต์นี้ยอมรับความจริงข้อหนึ่ง: `resolvedAt` เป็นค่าล่าสุด ไม่ใช่ประวัติ
      รายงานจึงตอบได้แค่ "ปิดครั้งล่าสุดเมื่อไร" — ข้อจำกัดที่ต้องรู้
      ไม่ใช่ข้อที่แกล้งว่าไม่มี
    */
    const before = await reportSummary(reader, AUG, projectId);
    await prismaClient.workItem.updateMany({
      where: { itemKey: `RPT${STAMP}-0` },
      data: { resolvedAt: null },
    });
    const after = await reportSummary(reader, AUG, projectId);
    expect(after.resolved).toBe(before.resolved - 1);
    // คืนค่าเดิมทันที ไม่รอ afterAll ซึ่งไม่ถูกรันเมื่อกลางทางล้ม
    await prismaClient.workItem.updateMany({
      where: { itemKey: `RPT${STAMP}-0` },
      data: { resolvedAt: new Date('2026-08-11T03:00:00.000Z') },
    });
    expect((await reportSummary(reader, AUG, projectId)).resolved).toBe(before.resolved);
  });

  it('"ค้างอยู่ตอนนี้" เป็นค่าของปัจจุบัน ไม่ใช่ของช่วง', async () => {
    // ตัวเลขสองชนิดนี้ตอบคนละคำถาม ป้ายบนหน้าจอจึงต้องแยกกัน
    const aug = await reportSummary(reader, AUG, projectId);
    const jul = await reportSummary(reader, JUL, projectId);
    expect(aug.openNow).toBe(jul.openNow);
  });
});

describe('D · ค่าเฉลี่ยและการแจกแจง', () => {
  it('**ไม่มีใบไหนปิดในช่วง = ค่าเฉลี่ยเป็น null ไม่ใช่ 0**', async () => {
    /*
      "เวลาปิดเฉลี่ย 0 ชั่วโมง" อ่านว่าปิดทันที ซึ่งกลับความหมายของ
      "ยังไม่มีใบไหนปิดเลย" — และเป็นตัวเลขที่ดูดีจนไม่มีใครสงสัย
    */
    const empty = thaiMonth(2025, 1);
    const r = await reportSummary(reader, empty, projectId);
    expect(r.resolved).toBe(0);
    expect(r.avgResolveHours).toBeNull();
  });

  it('ค่าเฉลี่ยคำนวณจากเวลาที่ใช้จริง', async () => {
    const r = await reportSummary(reader, AUG, projectId);
    // ใบ 0 และ 1 ใช้ 24 ชม. · ใบ 3 ใช้ประมาณ 33.5 ชม.
    expect(r.avgResolveHours).not.toBeNull();
    expect(r.avgResolveHours ?? 0).toBeGreaterThan(20);
    expect(r.avgResolveHours ?? 0).toBeLessThan(40);
  });

  it('งานที่ปิดโดยไม่มีผู้รับผิดชอบ ต้องนับ ไม่ใช่หายไป', async () => {
    /*
      การตัดแถวที่เป็น null ออกเงียบ ๆ ทำให้ผลรวมของคอลัมน์ไม่เท่ากับยอดรวม
      ด้านบน แล้วคนอ่านจะคิดว่าตัวเองอ่านผิด ไม่ใช่ว่ารายงานผิด
    */
    const r = await reportSummary(reader, AUG, projectId);
    const total = r.byAssignee.reduce((a, b) => a + b.resolved, 0);
    expect(total).toBe(r.resolved);
    expect(r.byAssignee.some((a) => a.name === 'ไม่มีผู้รับผิดชอบ')).toBe(true);
  });

  it('แจกแจงตามความสำคัญรวมกันเท่ากับยอดที่เปิด', async () => {
    const r = await reportSummary(reader, AUG, projectId);
    expect(r.byPriority.reduce((a, b) => a + b.opened, 0)).toBe(r.opened);
  });

  it('ช่วงที่บอกมา ต้องถูกส่งกลับไปกับตัวเลขเสมอ', async () => {
    /*
      ตัวเลขที่ไม่บอกว่านับจากช่วงไหนและโปรเจกต์ไหน เป็นตัวเลขที่ตรวจไม่ได้
      — และตัวเลขที่ตรวจไม่ได้ จะถูกเชื่อไปเรื่อย ๆ จนวันที่มันผิด
    */
    const r = await reportSummary(reader, AUG, projectId);
    expect(r.window.from).toBe(toUtcDate('2026-07-31T17:00:00.000Z').toISOString());
    expect(r.window.label).toBe('สิงหาคม 2569');
    expect(r.projects).toEqual([`RPT${STAMP}`]);
  });
});
