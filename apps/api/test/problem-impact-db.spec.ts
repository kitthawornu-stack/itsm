/**
 * ผลกระทบของปัญหา — ต่อของจริง
 *
 * `problem-impact.spec.ts` ประกอบข้อมูลนำเข้าขึ้นมาเอง จึงพิสูจน์ได้แค่ว่า
 * *ถ้า* ข้อมูลหน้าตาแบบนั้นเข้ามา ผลจะถูก · ไฟล์นี้ถามคำถามที่เอนจินตอบไม่ได้:
 *
 *   1. **นับเฉพาะทิศ "เป็นสาเหตุของ"** — ใบที่ *ทำให้ตัวปัญหาเกิด* ต้องไม่ถูกนับ
 *      ความสัมพันธ์เก็บทิศเดียวแล้วคำนวณคู่ตรงข้ามตอนอ่าน ถ้าคิวรีดูทั้งสองฝั่ง
 *      ตัวเลขจะสูงกว่าความจริงโดยไม่มีใครสังเกต
 *   2. **ชนิดอื่นไม่ถูกนับ** — "เกี่ยวข้องกับ" ไม่ใช่ "เป็นสาเหตุของ"
 *   3. **เรื่องในโปรเจกต์ที่ผู้ดูเข้าไม่ถึง ต้องไม่ถูกนับ** — ตัวเลขก็เป็นข้อมูลรั่วได้
 *   4. **เวลาที่อ่านมาเป็นของใบที่ถูกทำให้เกิด ไม่ใช่ของตัวปัญหา**
 *
 * เทสต์สร้างงานและผู้ใช้ของตัวเองทั้งหมด แล้วลบทิ้ง ไม่แตะข้อมูล seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toUtcDate, type TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { linkWorkItems, problemImpactOf } from '../src/modules/link';

const STAMP = String(Date.now()).slice(-6);
const NOW = toUtcDate('2027-06-01T00:00:00.000Z');

let tenantId: bigint;
let projectId: bigint;
let template: { issueTypeId: bigint; statusId: bigint; doneStatusId: bigint };
let actorId: bigint;
let ctx: TenantContext;
/** กลุ่มและสิทธิ์ของเทสต์เอง — ไม่แตะ grant ของ seed */
let groupId: bigint;
const grantIds: bigint[] = [];
const keys: string[] = [];
const ids = new Map<string, bigint>();

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function newItem(
  tag: string,
  o: { done?: boolean; createdAt?: string; project?: { id: bigint; key: string; issueTypeId: bigint; statusId: bigint } } = {},
): Promise<string> {
  const inProject = o.project;
  const itemKey = `${inProject?.key ?? 'SD'}-PI${STAMP}${tag}`;
  const w = await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId: inProject?.id ?? projectId,
      itemKey,
      issueTypeId: inProject?.issueTypeId ?? template.issueTypeId,
      statusId:
        inProject !== undefined
          ? inProject.statusId
          : o.done === true
            ? template.doneStatusId
            : template.statusId,
      reporterId: actorId,
      summary: `[ผลกระทบ] ${tag} ${STAMP}`,
      rank: `zzp${STAMP}${tag}`,
      ...(o.createdAt === undefined ? {} : { createdAt: new Date(o.createdAt) }),
    },
    select: { id: true, itemKey: true },
  });
  keys.push(w.itemKey);
  ids.set(tag, w.id);
  return w.itemKey;
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  const project = await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } });
  projectId = project.id;
  const any = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId },
    select: { issueTypeId: true, statusId: true },
  });
  /*
    **เลือกสถานะตามหมวดที่ต้องการ ไม่ใช่ยืมสถานะของงาน seed ใบใดใบหนึ่ง** —
    งาน seed กระจายอยู่ทุกสถานะ ใบที่หยิบมาอาจอยู่หมวด DONE อยู่แล้ว
    แล้วเคส "ยังค้างหนึ่งใบ" จะแดงด้วยเหตุผลที่ไม่เกี่ยวกับสิ่งที่มันวัด
    (เกิดขึ้นจริงตอนเขียนไฟล์นี้)
  */
  const pick = async (category: 'TODO' | 'DONE'): Promise<bigint> =>
    (
      await prismaClient.workflowStatus.findFirstOrThrow({
        where: { category, workflow: { schemes: { some: { tenantId } } } },
        select: { id: true },
      })
    ).id;
  template = {
    issueTypeId: any.issueTypeId,
    statusId: await pick('TODO'),
    doneStatusId: await pick('DONE'),
  };

  actorId = (
    await prismaClient.user.create({
      data: { tenantId, email: `pi-${STAMP}@example.test`, displayName: `ผู้ดูปัญหา ${STAMP}` },
      select: { id: true },
    })
  ).id;
  ctx = { tenantId, actorId };

  /*
    ให้สิทธิ์ผ่าน **กลุ่มของเทสต์เอง** ไม่ใช่เพิ่มคนเข้ากลุ่มของ seed —
    เทสต์ที่แก้ข้อมูลร่วมเคยทำให้ agent1/agent2 หลุดจาก IT Support ค้างไว้จริง
    แล้วทุกอย่างตอบ 403 ทั้งที่โค้ดถูก (บทเรียนใน CLAUDE.md)
  */
  groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `ผลกระทบ ${STAMP}` },
      select: { id: true },
    })
  ).id;
  await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: actorId } });
  const schemeId = (
    await prismaClient.project.findFirstOrThrow({
      where: { id: projectId },
      select: { permissionSchemeId: true },
    })
  ).permissionSchemeId;
  if (schemeId === null) throw new Error('โปรเจกต์ SD ไม่มี permission scheme');
  for (const permission of ['BROWSE_PROJECT', 'LINK_ITEM'] as const) {
    const g = await prismaClient.permissionGrant.create({
      data: { tenantId, schemeId, permission, groupId },
      select: { id: true },
    });
    grantIds.push(g.id);
  }
}, 120_000);

afterAll(async () => {
  await step('ความสัมพันธ์', () =>
    prismaClient.workItemLink.deleteMany({
      where: {
        OR: [
          { source: { itemKey: { in: keys } } },
          { target: { itemKey: { in: keys } } },
        ],
      },
    }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actorId } }));
  await step('งานทดสอบ', () =>
    prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }),
  );
  /*
    ลบ grant ที่สร้างเอง **ก่อน** ลบกลุ่ม · grant ที่ค้างอยู่จะให้กลุ่มที่
    ไม่มีอยู่แล้วมองเห็นโปรเจกต์ ซึ่งเป็นสิทธิ์ที่ไม่มีใครตั้งใจให้
  */
  await step('สิทธิ์ของเทสต์', () =>
    prismaClient.permissionGrant.deleteMany({ where: { id: { in: grantIds } } }),
  );
  await step('สมาชิกกลุ่ม', () => prismaClient.groupMember.deleteMany({ where: { groupId } }));
  // ลบทุกผู้ใช้ที่เทสต์นี้สร้าง รวม "คนนอก" ที่เคสหนึ่งสร้างขึ้นมาเอง
  await step('ผู้ใช้ของเทสต์', () =>
    prismaClient.user.deleteMany({ where: { email: { contains: STAMP } } }),
  );
  await step('กลุ่มของเทสต์', () => prismaClient.userGroup.deleteMany({ where: { id: groupId } }));

  const leftGrants = await prismaClient.permissionGrant.count({ where: { groupId } });
  if (leftGrants > 0) console.error(`เหลือสิทธิ์ของเทสต์ค้างอยู่ ${String(leftGrants)} รายการ`);
  await prismaClient.$disconnect();
});

describe('ผลกระทบของปัญหา', () => {
  it('งานที่ไม่ได้เป็นสาเหตุของอะไรเลย ตอบศูนย์ ไม่ใช่ error', async () => {
    const lonely = await newItem('LONE');
    const r = await problemImpactOf(ctx, ids.get('LONE') ?? BigInt(0), NOW);
    expect(r.impact.total).toBe(0);
    expect(r.impact.stillRecurring).toBe(false);
    expect(r.incidents).toEqual([]);
    expect(lonely).toContain(STAMP);
  });

  it('**นับเฉพาะทิศ "เป็นสาเหตุของ" และเฉพาะชนิดนั้น**', async () => {
    /*
      ความสัมพันธ์เก็บทิศเดียวแล้วคำนวณคู่ตรงข้ามตอนอ่าน · ถ้าคิวรีของ
      ผลกระทบดูทั้ง `sourceId` และ `targetId` เหมือน `linksOf` ปัญหาจะรวม
      ใบที่ **ทำให้ตัวมันเกิด** เข้าไปด้วย แล้วตัวเลขจะสูงกว่าความจริง
    */
    const problem = await newItem('PROB');
    const causedA = await newItem('A', { createdAt: '2027-01-05T03:00:00.000Z' });
    const causedB = await newItem('B', { createdAt: '2027-05-20T03:00:00.000Z', done: true });
    const cause = await newItem('CAUSE');
    const related = await newItem('REL');

    await linkWorkItems(ctx, problem, causedA, 'CAUSES');
    await linkWorkItems(ctx, problem, causedB, 'CAUSES');
    // ทิศกลับกัน — CAUSE ทำให้ PROB เกิด · ต้องไม่ถูกนับเป็นผลกระทบของ PROB
    await linkWorkItems(ctx, problem, cause, 'IS_CAUSED_BY');
    // ชนิดอื่น — ต้องไม่ถูกนับ
    await linkWorkItems(ctx, problem, related, 'RELATES_TO');

    const r = await problemImpactOf(ctx, ids.get('PROB') ?? BigInt(0), NOW);
    expect(r.incidents.map((i) => i.itemKey).sort()).toEqual([causedA, causedB].sort());
    expect(r.impact.total).toBe(2);
    expect(r.impact.open).toBe(1);
    expect(r.impact.resolved).toBe(1);
  });

  it('**เวลาที่อ่านมาเป็นของใบที่ถูกทำให้เกิด ไม่ใช่ของตัวปัญหา**', async () => {
    /*
      ตัวปัญหาถูกสร้างในเทสต์นี้ (วันนี้) ส่วนใบที่มันทำให้เกิดถูกตั้งเวลา
      ย้อนไปมกราคม · ถ้าอ่านเวลาจากตัวปัญหา "กวนมานานแค่ไหน" จะเป็นศูนย์
    */
    const r = await problemImpactOf(ctx, ids.get('PROB') ?? BigInt(0), NOW);
    expect(r.impact.firstSeen?.toISOString()).toBe('2027-01-05T03:00:00.000Z');
    expect(r.impact.lastSeen?.toISOString()).toBe('2027-05-20T03:00:00.000Z');
    expect(r.impact.spanMs).toBeGreaterThan(100 * 24 * 60 * 60 * 1000);
    // ใบล่าสุด 20 พ.ค. · "ตอนนี้" 1 มิ.ย. — ห่างสิบสองวัน ยังอยู่ในสามสิบวัน
    expect(r.impact.stillRecurring).toBe(true);
  });

  it('**เรื่องในโปรเจกต์ที่ผู้ดูเข้าไม่ถึง ถูกตัดออกจากตัวเลข**', async () => {
    /*
      เคส "คนนอกที่ไม่มีสิทธิ์ที่ไหนเลย" ข้างล่างผ่านได้สองทาง: ทางลัดตอน
      `allowed.length === 0` หรือตัวกรองปลายทาง — สองอันนั้นบังกันเอง
      ลบอันไหนออกก็ยังเขียว (พิสูจน์แล้วตอนลบทีละบรรทัด)

      เคสนี้แยกทั้งสองอันออกจากกัน: ผู้ดู **มี** สิทธิ์ใน SD (ทางลัดไม่ทำงาน)
      แต่ไม่มีใน PLAT ซึ่งใช้ permission scheme คนละใบ · เรื่องที่ปัญหาทำให้เกิด
      ใน PLAT จึงต้องหายไปจากตัวเลขด้วยตัวกรองเท่านั้น
    */
    const plat = await prismaClient.project.findFirstOrThrow({
      where: { key: 'PLAT' },
      select: { id: true, key: true },
    });
    const platItem = await prismaClient.workItem.findFirstOrThrow({
      where: { projectId: plat.id },
      select: { issueTypeId: true, statusId: true },
    });
    const hidden = await newItem('PLAT', {
      project: { id: plat.id, key: plat.key, ...platItem },
    });
    /*
      สร้างแถวความสัมพันธ์ตรง ๆ ไม่ผ่าน `linkWorkItems` — เพราะบริการนั้น
      ตรวจ `LINK_ITEM` ของ **ทั้งสองฝั่ง** ผู้ใช้ของเทสต์จึงเชื่อมข้ามไป PLAT
      ไม่ได้ ซึ่งถูกต้องแล้ว · สิ่งที่เคสนี้วัดคือการอ่าน ไม่ใช่การเขียน
    */
    await prismaClient.workItemLink.create({
      data: {
        tenantId,
        sourceId: ids.get('PROB') ?? BigInt(0),
        targetId: ids.get('PLAT') ?? BigInt(0),
        type: 'CAUSES',
      },
    });

    const r = await problemImpactOf(ctx, ids.get('PROB') ?? BigInt(0), NOW);
    expect(r.incidents.map((i) => i.itemKey)).not.toContain(hidden);
    // ยังนับสองใบใน SD เหมือนเดิม — ไม่ใช่ศูนย์เพราะตัวกรองกวาดหมด
    expect(r.impact.total).toBe(2);
  });

  it('คนที่ไม่มีสิทธิ์ที่ไหนเลย ได้ศูนย์', async () => {
    /*
      ผู้ใช้ที่ไม่มี `BROWSE_PROJECT` ที่ไหนเลย ต้องได้ศูนย์ ไม่ใช่ได้ตัวเลข
      ที่บอกว่ามีเรื่องอยู่กี่ใบ · จำนวนเรื่องที่ปัญหาหนึ่งทำให้เกิด
      บอกขนาดของเหตุการณ์ได้เอง แม้จะอ่านรายละเอียดไม่ได้
    */
    const stranger = await prismaClient.user.create({
      data: { tenantId, email: `pi-นอก-${STAMP}@example.test`, displayName: `คนนอก ${STAMP}` },
      select: { id: true },
    });
    try {
      const r = await problemImpactOf(
        { tenantId, actorId: stranger.id },
        ids.get('PROB') ?? BigInt(0),
        NOW,
      );
      expect(r.impact.total).toBe(0);
      expect(r.incidents).toEqual([]);
    } finally {
      // คืนทุกแถวที่จับมา ไม่ใช่เชื่อว่าเคสจบสวย
      await prismaClient.user.deleteMany({ where: { id: stranger.id } });
    }
  });
});
