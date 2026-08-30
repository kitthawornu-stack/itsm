/**
 * แดชบอร์ด — ต่อของจริง
 *
 * `dashboard-layout.spec.ts` ประกอบโครงร่างขึ้นมาเองในเทสต์ จึงพิสูจน์ได้แค่ว่า
 * *ถ้า* โครงร่างหน้าตาแบบนั้นเข้ามา ผลจะถูก · ไฟล์นี้ถามคำถามที่เอนจินตอบไม่ได้:
 *
 *   1. **การ์ดชนิดที่ระบบไม่รู้จัก ไปถึงได้จริงไหม** — เอนจินมีเคสนี้ตั้งแต่ต้น
 *      แต่ถ้าไม่มีทางที่แถวแบบนั้นจะเกิดขึ้นได้ เคสนั้นก็เป็นแค่การประกาศ
 *      พฤติกรรมของสถานะที่ไม่มีอยู่จริง (บทเรียนหมวด F ของ SLA ใน CLAUDE.md)
 *   2. **ย้ายแล้วยังอยู่ไหมหลังโหลดใหม่** — ลำดับที่เก็บคือความหมาย
 *      ถ้าอ่านกลับมาแล้วเรียงตาม id การกดปุ่มย้ายจะไม่มีผลอะไรเลย
 *      ซึ่งดูเหมือนปุ่มเสีย ไม่ใช่ลำดับผิด
 *   3. **id ของการ์ดคงเดิมหลังย้าย** — ถ้าเปลี่ยนทุกครั้ง ปุ่มที่คนกดรัว ๆ
 *      จะอ้าง id ที่หายไปแล้ว
 *   4. **คนอื่นเห็นอะไรบนหน้าที่แชร์** — ต้องเห็นว่ามีของถูกซ่อน
 *      แต่ไม่เห็นชื่อ · ด่านนี้อยู่ในเอนจิน แต่ที่นี่พิสูจน์ว่ามีคนส่ง
 *      `ownsLayout: false` เข้าไปจริงตามเส้นทางของจริง
 *
 * เทสต์สร้างผู้ใช้และหน้าของตัวเองทั้งหมด แล้วลบทิ้ง ไม่แตะข้อมูล seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  DuplicateDashboardNameError,
  NotDashboardOwnerError,
  TooManyGadgetsError,
  UnknownGadgetKindError,
  addGadget,
  createDashboard,
  deleteDashboard,
  listDashboards,
  moveGadgetOn,
  openDashboard,
  removeGadget,
  updateDashboard,
} from '../src/modules/reporting';

const STAMP = String(Date.now()).slice(-6);
/** ชื่อมี stamp เสมอ — ตอนกลไกถูกลบ ค่าที่ "ไม่ควรถูกใช้" จะถูกใช้จริง */
const n = (tag: string): string => `QA แดชบอร์ด ${tag} ${STAMP}`;

const STARTED_AT = new Date();

let tenantId: bigint;
let ctx: TenantContext;
/** คนนอก — ผู้ใช้ของเทสต์นี้เอง ไม่ใช่ผู้ใช้ seed */
let strangerCtx: TenantContext;
let strangerId: bigint;

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function board(tag: string): Promise<bigint> {
  return (await createDashboard(ctx, n(tag))).id;
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  /*
    ใช้ผู้ดูแลที่มีอยู่จริงเป็น "เจ้าของ" — อ่านอย่างเดียว ไม่ย้าย grant
    (บทเรียน `ADMINISTER_TENANT` เหลือศูนย์รายการใน CLAUDE.md)
  */
  const grant = await prismaClient.permissionGrant.findFirstOrThrow({
    where: { tenantId, permission: 'ADMINISTER_TENANT', groupId: { not: null } },
    select: { groupId: true },
  });
  const member = await prismaClient.groupMember.findFirstOrThrow({
    where: { groupId: grant.groupId ?? BigInt(0) },
    select: { userId: true },
  });
  ctx = { tenantId, actorId: member.userId };

  /*
    คนนอกเป็นผู้ใช้ที่เทสต์สร้างเอง และ **ไม่อยู่กลุ่มไหนเลย** — ข้อมูลที่ไม่ครบ
    ต้องแปลว่าไม่มีสิทธิ์ ไม่ใช่ได้สิทธิ์พื้นฐาน (CLAUDE.md กติกาเฉพาะของสิทธิ์)
  */
  const stranger = await prismaClient.user.create({
    data: {
      tenantId,
      email: `qa-dash-${STAMP}@example.invalid`,
      displayName: `QA คนนอก ${STAMP}`,
    },
    select: { id: true },
  });
  strangerId = stranger.id;
  strangerCtx = { tenantId, actorId: stranger.id };
}, 120_000);

afterAll(async () => {
  /*
    ลบ **ทุกแถวที่เกิดในช่วงเทสต์** ไม่ใช่เฉพาะที่ชื่อมี stamp

    เคส "ชื่อว่างถูกปฏิเสธ" ไม่ควรสร้างอะไร · แต่ตอนลบกลไกเพื่อพิสูจน์ว่าเทสต์
    แดงได้ มันจะสร้างแถวชื่อว่างขึ้นมาจริง ซึ่งไม่มี stamp จึงรอดจากตัวกรอง
    แล้วค้างอยู่ในฐานข้อมูลพัฒนา (เกิดขึ้นแล้วกับ CMDB และช่วงห้ามเปลี่ยนแปลง)
  */
  await step('การ์ดของเทสต์', () =>
    prismaClient.dashboardGadget.deleteMany({
      where: { dashboard: { OR: [{ name: { contains: STAMP } }, { createdAt: { gte: STARTED_AT } }] } },
    }),
  );
  await step('หน้าของเทสต์', () =>
    prismaClient.dashboard.deleteMany({
      where: { OR: [{ name: { contains: STAMP } }, { createdAt: { gte: STARTED_AT } }] },
    }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({
      where: { action: { startsWith: 'dashboard.' }, createdAt: { gte: STARTED_AT } },
    }),
  );
  await step('ผู้ใช้ของเทสต์', () => prismaClient.user.deleteMany({ where: { id: strangerId } }));

  const left = await prismaClient.dashboard.count({
    where: { OR: [{ name: { contains: STAMP } }, { createdAt: { gte: STARTED_AT } }] },
  });
  if (left > 0) console.error(`เหลือแดชบอร์ดของเทสต์ค้างอยู่ ${String(left)} หน้า`);
  const users = await prismaClient.user.count({ where: { email: { contains: `qa-dash-${STAMP}` } } });
  if (users > 0) console.error(`เหลือผู้ใช้ของเทสต์ค้างอยู่ ${String(users)} คน`);
  await prismaClient.$disconnect();
});

// ============================================================

describe('แดชบอร์ด(จริง) · A · หน้าเริ่มต้น', () => {
  /**
   * การเข้าหน้าจอต้องไม่ใช่การเขียนข้อมูล
   *
   * ถ้าระบบสร้างแถวให้ก่อนคนจะได้ดู หน้านี้จะพังทันทีสำหรับคนที่เปิดดูได้
   * แต่เขียนไม่ได้ — และจะสร้างขยะหนึ่งแถวต่อคนที่แค่กดผิดเข้ามา
   */
  it('เปิดหน้าเริ่มต้นได้โดยไม่สร้างแถวในฐานข้อมูล', async () => {
    const before = await prismaClient.dashboard.count();
    const v = await openDashboard(ctx, null, 'this-month');
    expect(v.id).toBeNull();
    expect(v.gadgets.length).toBeGreaterThan(0);
    expect(await prismaClient.dashboard.count()).toBe(before);
  });

  it('หน้าเริ่มต้นไม่มีการ์ดใบไหนถูกตัด — ผู้ใช้ใหม่ไม่ควรเจอหน้าที่พังตั้งแต่วันแรก', async () => {
    const v = await openDashboard(ctx, null, 'this-month');
    expect(v.dropped).toEqual([]);
  });

  it('การ์ดได้ข้อมูลจริงมาด้วย ไม่ใช่โครงเปล่า', async () => {
    const v = await openDashboard(ctx, null, 'this-month');
    const withData = v.gadgets.filter((g) => g.data !== null);
    expect(withData.length).toBe(v.gadgets.length);
    expect(withData[0]?.data?.window.label).toBeTruthy();
  });
});

describe('แดชบอร์ด(จริง) · B · สร้าง แก้ ลบ', () => {
  it('หน้าที่สร้างใหม่มีการ์ดมาให้แล้ว ไม่ใช่หน้าเปล่า', async () => {
    const id = await board('สร้าง');
    const v = await openDashboard(ctx, id, 'this-month');
    expect(v.gadgets.length).toBeGreaterThan(0);
    expect(v.isMine).toBe(true);
  });

  it('ชื่อซ้ำของคนเดียวกันถูกปฏิเสธ', async () => {
    await board('ซ้ำ');
    await expect(createDashboard(ctx, n('ซ้ำ'))).rejects.toThrow(DuplicateDashboardNameError);
  });

  it('ชื่อว่างถูกปฏิเสธ', async () => {
    await expect(createDashboard(ctx, '   ')).rejects.toThrow();
  });

  it('เปลี่ยนจำนวนคอลัมน์แล้วอ่านกลับได้', async () => {
    const id = await board('คอลัมน์');
    await updateDashboard(ctx, id, { columns: 3 });
    expect((await openDashboard(ctx, id, 'this-month')).columns).toBe(3);
  });

  it('จำนวนคอลัมน์ที่ใช้ไม่ได้ถูกดึงกลับเข้าขอบ ไม่ใช่ปฏิเสธทั้งคำขอ', async () => {
    const id = await board('คอลัมน์เกิน');
    await updateDashboard(ctx, id, { columns: 99 });
    expect((await openDashboard(ctx, id, 'this-month')).columns).toBeLessThanOrEqual(4);
  });

  it('ลบแล้วการ์ดหายตาม ไม่เหลือแถวกำพร้า', async () => {
    const id = await board('ลบ');
    await deleteDashboard(ctx, id);
    expect(await prismaClient.dashboardGadget.count({ where: { dashboardId: id } })).toBe(0);
  });

  it('ทุกการเปลี่ยนแปลงเขียน audit', async () => {
    const id = await board('ตรวจสอบ');
    await updateDashboard(ctx, id, { name: n('ตรวจสอบใหม่') });
    const rows = await prismaClient.auditLog.findMany({
      where: { entityType: 'dashboard', entityId: id.toString() },
      select: { action: true },
    });
    expect(rows.map((r) => r.action).sort()).toEqual(['dashboard.create', 'dashboard.update']);
  });
});

describe('แดชบอร์ด(จริง) · C · การ์ดชนิดที่ระบบไม่รู้จักไปถึงได้จริง', () => {
  /**
   * ด่านที่พิสูจน์ว่าเคส `unknown-kind` ของเอนจินไม่ใช่คำประกาศลอย ๆ
   *
   * เขียนแถวตรงเข้าฐานข้อมูลด้วยชนิดที่ไม่มีในโค้ด — เลียนแบบวันที่ฟีเจอร์
   * ถูกถอดออกหลังจากมีคนใส่การ์ดนั้นไปแล้ว · ถ้าเส้นทางนี้ไปไม่ถึง
   * เคสในเอนจินก็เป็นแค่การประกาศพฤติกรรมของสถานะที่ไม่มีอยู่จริง
   */
  it('การ์ดที่ชนิดถูกถอดไปแล้ว ถูกรายงานว่าถูกตัด ไม่ใช่ทำให้ทั้งหน้าล่ม', async () => {
    const id = await board('ชนิดหาย');
    const last = await prismaClient.dashboardGadget.findFirstOrThrow({
      where: { dashboardId: id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    await prismaClient.dashboardGadget.create({
      data: {
        tenantId,
        dashboardId: id,
        kind: 'sprint-burndown-ที่ถูกถอดแล้ว',
        colIndex: 0,
        position: last.position + 1,
        title: `การ์ดเก่า ${STAMP}`,
      },
    });

    const v = await openDashboard(ctx, id, 'this-month');
    expect(v.dropped.map((d) => d.reason)).toEqual(['unknown-kind']);
    expect(v.gadgets.length).toBeGreaterThan(0);
  });

  it('เจ้าของเห็นชื่อการ์ดที่ถูกตัด จะได้รู้ว่าต้องไปแก้อะไร', async () => {
    const v = await openDashboard(ctx, await lastBoardWithDeadGadget(), 'this-month');
    expect(v.dropped[0]?.title).toContain(STAMP);
  });

  it('เพิ่มการ์ดชนิดที่ไม่รู้จักผ่าน service ไม่ได้ — ทางเข้าปกติต้องปิด', async () => {
    const id = await board('เพิ่มชนิดมั่ว');
    await expect(
      addGadget(ctx, id, { kind: 'ไม่มีจริง', column: 0, projectId: null, title: null }),
    ).rejects.toThrow(UnknownGadgetKindError);
  });
});

/** หน้าที่มีการ์ดชนิดตายอยู่ — สร้างในเคสก่อนหน้าแล้ว */
async function lastBoardWithDeadGadget(): Promise<bigint> {
  const g = await prismaClient.dashboardGadget.findFirstOrThrow({
    where: { kind: { startsWith: 'sprint-burndown' } },
    select: { dashboardId: true },
  });
  return g.dashboardId;
}

describe('แดชบอร์ด(จริง) · D · เพิ่ม ย้าย ถอด', () => {
  it('ย้ายแล้วลำดับยังอยู่หลังโหลดใหม่', async () => {
    const id = await board('ย้าย');
    const before = (await openDashboard(ctx, id, 'this-month')).gadgets;
    const first = before[0];
    expect(first).toBeDefined();

    await moveGadgetOn(ctx, id, String(first?.id), 'down');
    const after = (await openDashboard(ctx, id, 'this-month')).gadgets;
    expect(after[1]?.id).toBe(first?.id);
    expect(after[0]?.id).toBe(before[1]?.id);
  });

  /**
   * id คงเดิมหลังย้าย
   *
   * ถ้าเขียนด้วยวิธี "ลบทั้งหมดแล้วสร้างใหม่" id จะเปลี่ยนทุกครั้ง แล้วปุ่มย้าย
   * ที่คนกดรัว ๆ จะอ้าง id ที่หายไปแล้ว กลายเป็น error ทั้งที่ไม่ได้ทำอะไรผิด
   */
  it('id ของการ์ดไม่เปลี่ยนหลังย้าย', async () => {
    const id = await board('id คงเดิม');
    const before = (await openDashboard(ctx, id, 'this-month')).gadgets.map((g) => g.id).sort();
    await moveGadgetOn(ctx, id, String(before[0]), 'down');
    const after = (await openDashboard(ctx, id, 'this-month')).gadgets.map((g) => g.id).sort();
    expect(after).toEqual(before);
  });

  it('ย้ายข้ามคอลัมน์แล้วคอลัมน์ที่เก็บไว้เปลี่ยนตาม', async () => {
    const id = await board('ข้ามคอลัมน์');
    const g = (await openDashboard(ctx, id, 'this-month')).gadgets[0];
    await moveGadgetOn(ctx, id, String(g?.id), 'right');
    const moved = (await openDashboard(ctx, id, 'this-month')).gadgets.find((x) => x.id === g?.id);
    expect(moved?.column).toBe(1);
  });

  it('เพิ่มแล้วถอดออกได้ และเหลือการ์ดเท่าเดิม', async () => {
    const id = await board('ถอด');
    const start = (await openDashboard(ctx, id, 'this-month')).gadgets.length;
    await addGadget(ctx, id, { kind: 'breached', column: 0, projectId: null, title: null });
    const added = (await openDashboard(ctx, id, 'this-month')).gadgets;
    expect(added).toHaveLength(start + 1);

    const fresh = added.find((x) => x.kind === 'breached');
    await removeGadget(ctx, id, BigInt(String(fresh?.id)));
    expect((await openDashboard(ctx, id, 'this-month')).gadgets).toHaveLength(start);
  });

  it('เพิ่มเกินเพดานถูกปฏิเสธตั้งแต่ตอนเพิ่ม ไม่ใช่เงียบไปตอนเรนเดอร์', async () => {
    const id = await board('เพดาน');
    for (let i = 0; i < 20; i += 1) {
      try {
        await addGadget(ctx, id, { kind: 'summary', column: 0, projectId: null, title: null });
      } catch (e) {
        expect(e).toBeInstanceOf(TooManyGadgetsError);
        return;
      }
    }
    throw new Error('เพิ่มได้ไม่จำกัด — เพดานไม่ทำงาน');
  });
});

describe('แดชบอร์ด(จริง) · E · เจ้าของกับคนอื่น', () => {
  it('หน้าที่ไม่ได้แชร์ คนอื่นเปิดไม่ได้', async () => {
    const id = await board('ส่วนตัว');
    await expect(openDashboard(strangerCtx, id, 'this-month')).rejects.toThrow();
  });

  it('หน้าที่แชร์แล้ว คนอื่นเปิดได้', async () => {
    const id = await board('แชร์');
    await updateDashboard(ctx, id, { isShared: true });
    const v = await openDashboard(strangerCtx, id, 'this-month');
    expect(v.isMine).toBe(false);
  });

  /**
   * แชร์หน้า ≠ แชร์สิทธิ์
   *
   * กติกาเดียวกับ SavedFilter — หน้าที่แชร์แล้วต้องไม่กลายเป็นทางลัดดูข้อมูล
   * ของโปรเจกต์ที่ตัวเองเข้าไม่ถึง · คนนอกคนนี้ไม่อยู่กลุ่มไหนเลย
   * จึงต้องไม่ได้ตัวเลขสักตัว
   */
  it('คนอื่นเห็นหน้าที่แชร์ แต่ไม่ได้ตัวเลขของโปรเจกต์ที่ตัวเองดูไม่ได้', async () => {
    const id = await board('แชร์ไม่แชร์สิทธิ์');
    await updateDashboard(ctx, id, { isShared: true });
    const v = await openDashboard(strangerCtx, id, 'this-month');
    expect(v.gadgets).toEqual([]);
    expect(v.dropped.every((d) => d.reason === 'no-access')).toBe(true);
  });

  it('คนอื่นไม่เห็นชื่อการ์ดที่ถูกตัด — ชื่อบอกว่ามีโปรเจกต์อะไรอยู่', async () => {
    const id = await board('ชื่อไม่รั่ว');
    await updateDashboard(ctx, id, { isShared: true });
    await prismaClient.dashboardGadget.updateMany({
      where: { dashboardId: id },
      data: { title: `ค้างของฝ่ายลับ ${STAMP}` },
    });
    const v = await openDashboard(strangerCtx, id, 'this-month');
    expect(v.dropped.length).toBeGreaterThan(0);
    expect(v.dropped.every((d) => d.title === null)).toBe(true);
  });

  it('คนอื่นแก้หน้าที่แชร์ไม่ได้', async () => {
    const id = await board('แก้ไม่ได้');
    await updateDashboard(ctx, id, { isShared: true });
    await expect(updateDashboard(strangerCtx, id, { columns: 4 })).rejects.toThrow(
      NotDashboardOwnerError,
    );
  });

  it('คนอื่นลบหน้าที่แชร์ไม่ได้', async () => {
    const id = await board('ลบไม่ได้');
    await updateDashboard(ctx, id, { isShared: true });
    await expect(deleteDashboard(strangerCtx, id)).rejects.toThrow(NotDashboardOwnerError);
    expect(await prismaClient.dashboard.count({ where: { id } })).toBe(1);
  });

  it('รายการหน้าแสดงของตัวเองและของที่คนอื่นแชร์', async () => {
    const id = await board('อยู่ในรายการ');
    await updateDashboard(ctx, id, { isShared: true });
    const seen = (await listDashboards(strangerCtx)).map((d) => d.id);
    expect(seen).toContain(id.toString());
    expect((await listDashboards(strangerCtx)).every((d) => !d.isMine)).toBe(true);
  });
});
