/**
 * ระดับความเสี่ยงของการเปลี่ยนแปลง — ต่อของจริง
 *
 * `change-risk.spec.ts` ประกอบข้อมูลนำเข้าขึ้นมาเอง จึงพิสูจน์ได้แค่ว่า
 * *ถ้า* สัญญาณหน้าตาแบบนั้นเข้ามา ผลจะถูก · **ไม่ได้พิสูจน์ว่ามีอะไรในระบบ
 * สร้างสัญญาณแบบนั้นได้จริง** ซึ่งเป็นบทเรียนหมวด F ของ SLA Engine ที่
 * เทสต์เขียวอยู่หลายเดือนโดยไม่มีโค้ดเส้นไหนไปถึงสถานะที่มันประกาศ
 *
 * ไฟล์นี้จึงถามว่าสัญญาณ **เดินทางมาถึงจริงไหม**:
 *
 *   1. จำนวนสิ่งที่พึ่งพา CI มาจาก **กราฟ CMDB จริง** และนับทางอ้อมด้วย
 *   2. การชนของหน้าต่างเวลาเดินทางมาถึงเอนจิน
 *   3. การข้ามช่วงห้ามเดินทางมาถึงเอนจิน
 *   4. ใบที่ยังไม่กรอกอะไร **ไม่ได้ระดับต่ำ** — จากทางเข้าจริง ไม่ใช่จากอินพุตที่แต่ง
 *   5. ด่านสิทธิ์ทำงาน — คนที่เปิดดูโปรเจกต์ไม่ได้ ถามระดับความเสี่ยงไม่ได้
 *
 * เทสต์สร้างงาน ผู้ใช้ กลุ่ม CI และเส้นพึ่งพาของตัวเองทั้งหมด แล้วลบทิ้ง
 * ไม่แตะข้อมูล seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toUtcDate, type TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError, type PermissionKey } from '../src/modules/permission';
import { attachCi } from '../src/modules/cmdb';
import { DEPENDENTS_FOR_HIGH, riskOf, setWindow } from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);
/** ทุกเวลาอิงวันที่ตายตัว — "ตอนนี้" ส่งเข้าไปเสมอ ไม่อ่านนาฬิกาในเทสต์ */
const NOW = toUtcDate('2028-05-01T00:00:00.000Z');

let tenantId: bigint;
let projectId: bigint;
let template: { issueTypeId: bigint; statusId: bigint };
let ctx: TenantContext;
let outsiderCtx: TenantContext;
let actorId: bigint;
let groupId: bigint;
const grantIds: bigint[] = [];
const keys: string[] = [];
const ciIds: bigint[] = [];
const freezeIds: bigint[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function newItem(tag: string): Promise<string> {
  /** คีย์มี stamp เสมอ — ตอนกลไกถูกลบ ค่าที่ "ไม่ควรถูกใช้" จะถูกใช้จริง */
  const itemKey = `SD-CR${STAMP}${tag}`;
  await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey,
      issueTypeId: template.issueTypeId,
      statusId: template.statusId,
      reporterId: actorId,
      summary: `[ความเสี่ยง] ${tag} ${STAMP}`,
      rank: `0aaCR${STAMP}${tag}`,
    },
  });
  keys.push(itemKey);
  return itemKey;
}

async function newCi(tag: string, name: string): Promise<bigint> {
  const ci = await prismaClient.configurationItem.create({
    data: { tenantId, key: `CI-CR${STAMP}${tag}`, name: `${name} ${STAMP}`, kind: 'SERVICE' },
    select: { id: true },
  });
  ciIds.push(ci.id);
  return ci.id;
}

/** `dependentId` พึ่งพา `dependsOnId` — ตัวหลังล่ม ตัวแรกพัง */
async function dependsOn(dependentId: bigint, dependsOnId: bigint): Promise<void> {
  await prismaClient.ciDependency.create({ data: { tenantId, dependentId, dependsOnId } });
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  projectId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } })).id;
  template = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId },
    select: { issueTypeId: true, statusId: true },
  });

  const mkUser = async (tag: string): Promise<bigint> =>
    (
      await prismaClient.user.create({
        data: {
          tenantId,
          email: `cr-${tag}-${STAMP}@example.test`,
          displayName: `QA ความเสี่ยง ${tag} ${STAMP}`,
        },
        select: { id: true },
      })
    ).id;
  actorId = await mkUser('actor');
  ctx = { tenantId, actorId };
  // ไม่ใส่เข้ากลุ่มไหนเลย — "ข้อมูลที่ไม่ครบต้องแปลว่าไม่มีสิทธิ์"
  outsiderCtx = { tenantId, actorId: await mkUser('outsider') };

  const schemeId = (
    await prismaClient.project.findFirstOrThrow({
      where: { id: projectId },
      select: { permissionSchemeId: true },
    })
  ).permissionSchemeId;
  if (schemeId === null) throw new Error('โปรเจกต์ SD ไม่มี permission scheme');
  groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `ความเสี่ยง ${STAMP}` },
      select: { id: true },
    })
  ).id;
  await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: actorId } });
  for (const permission of ['BROWSE_PROJECT', 'EDIT_ITEM'] as PermissionKey[]) {
    const g = await prismaClient.permissionGrant.create({
      data: { tenantId, schemeId, permission, groupId },
      select: { id: true },
    });
    grantIds.push(g.id);
  }
}, 120_000);

afterAll(async () => {
  await step('หน้าต่างเวลา', () =>
    prismaClient.changeWindow.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('ช่วงห้ามของเทสต์', () =>
    prismaClient.changeFreeze.deleteMany({ where: { id: { in: freezeIds } } }),
  );
  await step('CI ที่ผูกกับงาน', () =>
    prismaClient.workItemCi.deleteMany({ where: { ciId: { in: ciIds } } }),
  );
  await step('เส้นพึ่งพา', () =>
    prismaClient.ciDependency.deleteMany({
      where: { OR: [{ dependentId: { in: ciIds } }, { dependsOnId: { in: ciIds } }] },
    }),
  );
  await step('ทะเบียน CI ของเทสต์', () =>
    prismaClient.configurationItem.deleteMany({ where: { id: { in: ciIds } } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({ where: { actor: { email: { contains: STAMP } } } }),
  );
  await step('งานทดสอบ', () =>
    prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }),
  );
  await step('สิทธิ์ของเทสต์', () =>
    prismaClient.permissionGrant.deleteMany({ where: { id: { in: grantIds } } }),
  );
  await step('สมาชิกกลุ่ม', () => prismaClient.groupMember.deleteMany({ where: { groupId } }));
  await step('ผู้ใช้ของเทสต์', () =>
    prismaClient.user.deleteMany({ where: { email: { contains: STAMP } } }),
  );
  await step('กลุ่มของเทสต์', () => prismaClient.userGroup.deleteMany({ where: { id: groupId } }));

  // ยืนยันด้วยการนับหลังคืน ไม่ใช่เชื่อว่าลูปทำงาน
  const leftCis = await prismaClient.configurationItem.count({
    where: { key: { startsWith: `CI-CR${STAMP}` } },
  });
  if (leftCis > 0) console.error(`เหลือ CI ของเทสต์ค้างอยู่ ${String(leftCis)} รายการ`);
  await prismaClient.$disconnect();
});

describe('ความเสี่ยง · ต่อของจริง', () => {
  /**
   * **หัวใจของไฟล์** — จากทางเข้าจริง ไม่ใช่จากอินพุตที่แต่งขึ้น
   *
   * งานที่เพิ่งสร้าง ยังไม่ผูก CI ยังไม่ตั้งเวลา ต้องไม่ได้ระดับต่ำ
   */
  it('**งานที่ยังไม่กรอกอะไรเลย ไม่ได้ระดับต่ำ**', async () => {
    const key = await newItem('BLANK');
    const r = await riskOf(ctx, key, NOW);
    expect(r.level).not.toBe('LOW');
    expect(r.reasons.map((x) => x.code).sort()).toEqual(['no-ci', 'no-window']);
  });

  it('**จำนวนสิ่งที่พึ่งพา มาจากกราฟ CMDB จริง และนับทางอ้อมด้วย**', async () => {
    /*
      ต่อเป็นสาย: A → core, B → A, C → B · ถ้า `core` ล่ม พังตามสามตัว
      แต่ **มีแค่ตัวเดียวที่พึ่งพา `core` โดยตรง** · การนับเฉพาะเส้นตรง
      จะได้ 1 ซึ่งต่ำกว่าเกณฑ์ และระดับจะเป็นกลางแทนที่จะเป็นสูง
    */
    const core = await newCi('CORE', 'ฐานข้อมูลกลาง');
    const a = await newCi('A', 'ระบบเวลาเข้างาน');
    const b = await newCi('B', 'ระบบเบิกจ่าย');
    const c = await newCi('C', 'หน้าเว็บพนักงาน');
    await dependsOn(a, core);
    await dependsOn(b, a);
    await dependsOn(c, b);
    expect(DEPENDENTS_FOR_HIGH).toBeLessThanOrEqual(3);

    const key = await newItem('DEEP');
    await attachCi(ctx, key, core);
    await setWindow(
      ctx,
      key,
      { plannedStart: '2028-06-01T18:00:00.000Z', plannedEnd: '2028-06-01T20:00:00.000Z' },
      NOW,
    );

    const r = await riskOf(ctx, key, NOW);
    const reason = r.reasons.find((x) => x.code === 'dependents');
    expect(reason?.detail).toContain('3');
    expect(reason?.detail).toContain('ฐานข้อมูลกลาง');
    expect(r.level).toBe('HIGH');
  });

  it('CI ที่ไม่มีใครพึ่งพา และเวลาที่ไม่ชนอะไร ได้ระดับต่ำ', async () => {
    const lonely = await newCi('LONE', 'จอในห้องประชุม');
    const key = await newItem('CLEAN');
    await attachCi(ctx, key, lonely);
    await setWindow(
      ctx,
      key,
      { plannedStart: '2028-07-11T18:00:00.000Z', plannedEnd: '2028-07-11T20:00:00.000Z' },
      NOW,
    );
    const r = await riskOf(ctx, key, NOW);
    expect(r.level).toBe('LOW');
    expect(r.reasons).toEqual([]);
  });

  it('**การชนกับใบอื่นเดินทางมาถึงเอนจิน**', async () => {
    const lonely = await newCi('LONE2', 'เครื่องพิมพ์ชั้น 3');
    const first = await newItem('CONF1');
    const second = await newItem('CONF2');
    for (const key of [first, second]) {
      await attachCi(ctx, key, lonely);
      await setWindow(
        ctx,
        key,
        { plannedStart: '2028-08-02T18:00:00.000Z', plannedEnd: '2028-08-02T20:00:00.000Z' },
        NOW,
      );
    }
    const r = await riskOf(ctx, first, NOW);
    expect(r.reasons.find((x) => x.code === 'conflicts')?.detail).toContain('1');
    expect(r.level).toBe('MEDIUM');
  });

  it('**การข้ามช่วงห้ามเดินทางมาถึงเอนจิน**', async () => {
    const freeze = await prismaClient.changeFreeze.create({
      data: {
        tenantId,
        name: `ปิดงบสิ้นปี ${STAMP}`,
        reason: `ห้ามแตะระบบช่วงปิดงบ ${STAMP}`,
        startsAt: new Date('2028-09-01T00:00:00.000Z'),
        endsAt: new Date('2028-09-30T00:00:00.000Z'),
      },
      select: { id: true },
    });
    freezeIds.push(freeze.id);

    const lonely = await newCi('LONE3', 'เครื่องสำรองไฟ');
    const key = await newItem('FRZ');
    await attachCi(ctx, key, lonely);
    await setWindow(
      ctx,
      key,
      {
        plannedStart: '2028-09-15T18:00:00.000Z',
        plannedEnd: '2028-09-15T20:00:00.000Z',
        freezeOverrideReason: 'ระบบล่ม ต้องกู้คืนทันที',
      },
      NOW,
    );
    const r = await riskOf(ctx, key, NOW);
    expect(r.reasons.some((x) => x.code === 'freeze-override')).toBe(true);
    expect(r.level).toBe('HIGH');
  });

  it('**คนที่เปิดดูโปรเจกต์ไม่ได้ ถามระดับความเสี่ยงไม่ได้**', async () => {
    const key = await newItem('SEC');
    // เจ้าของสิทธิ์ถามได้ — ถ้าเคสนี้ล้ม แปลว่าด่านกันผิดคน ไม่ใช่กันถูกคน
    expect((await riskOf(ctx, key, NOW)).level).not.toBe('LOW');
    await expect(riskOf(outsiderCtx, key, NOW)).rejects.toThrow(PermissionDeniedError);
  });
});
