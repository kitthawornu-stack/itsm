/**
 * แผนงานบนเส้นเวลา — ต่อของจริง
 *
 * `roadmap.spec.ts` ประกอบข้อมูลนำเข้าขึ้นมาเอง จึงพิสูจน์ได้แค่ว่า *ถ้า*
 * ข้อมูลหน้าตาแบบนั้นเข้ามา ผลจะถูก · ไฟล์นี้ถามคำถามที่เอนจินตอบไม่ได้:
 *
 *   1. **สัญญาณเดินทางมาถึงจริงไหม** — รุ่นและรอบการทำงานถูกอ่านมาวางจริง
 *      ไม่ใช่รายการว่างที่ทำให้ทุกอย่างดูเรียบร้อย
 *   2. **การขวางข้ามรุ่นอ่านจากลิงก์จริง** — และ**นับทิศเดียว** · การอ่าน
 *      ทั้งสองทิศจะนับคู่เดียวกันสองครั้ง แล้วรายงานจะบอกว่ามีปัญหาเท่าตัว
 *   3. **งานที่อยู่หลายรุ่น ใช้รุ่นที่ปล่อยเร็วที่สุด** — ถ้าใช้รุ่นล่าสุด
 *      การขวางที่เป็นปัญหาจริงจะถูกกลบ
 *   4. **สิ่งที่ตรวจไม่ได้ ต้องรายงาน ไม่ใช่เงียบ**
 *   5. **ด่านสิทธิ์** — แผนงานบอกชื่อรุ่นและคีย์งานทั้งโปรเจกต์
 *
 * เทสต์สร้างงาน ผู้ใช้ กลุ่ม และรุ่นของตัวเองทั้งหมด แล้วลบทิ้ง ไม่แตะข้อมูล seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toUtcDate, type TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError, type PermissionKey } from '../src/modules/permission';
import { linkWorkItems } from '../src/modules/link';
import { createVersion, roadmapOf, setItemVersion } from '../src/modules/version';

const STAMP = String(Date.now()).slice(-6);
/** ทุกเวลาอิงวันที่ตายตัว — "ตอนนี้" ส่งเข้าไปเสมอ */
const NOW = toUtcDate('2029-07-01T00:00:00.000Z');
const RANGE = { from: '2029-01-01T00:00:00.000Z', to: '2029-12-31T00:00:00.000Z' };

let tenantId: bigint;
let projectId: bigint;
let template: { issueTypeId: bigint; statusId: bigint };
let ctx: TenantContext;
let outsiderCtx: TenantContext;
let actorId: bigint;
let groupId: bigint;
const grantIds: bigint[] = [];
const keys: string[] = [];
const versionIds: bigint[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function newItem(tag: string): Promise<string> {
  /** คีย์มี stamp เสมอ — ตอนกลไกถูกลบ ค่าที่ "ไม่ควรถูกใช้" จะถูกใช้จริง */
  const itemKey = `SD-RM${STAMP}${tag}`;
  await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey,
      issueTypeId: template.issueTypeId,
      statusId: template.statusId,
      reporterId: actorId,
      summary: `[แผนงาน] ${tag} ${STAMP}`,
      rank: `0aaRM${STAMP}${tag}`,
    },
  });
  keys.push(itemKey);
  return itemKey;
}

async function newVersion(name: string, releaseDate: string | null): Promise<bigint> {
  const v = await createVersion(ctx, 'SD', {
    name: `${name} ${STAMP}`,
    ...(releaseDate === null ? {} : { releaseDate }),
  });
  versionIds.push(v.id);
  return v.id;
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
          email: `rm-${tag}-${STAMP}@example.test`,
          displayName: `QA แผนงาน ${tag} ${STAMP}`,
        },
        select: { id: true },
      })
    ).id;
  actorId = await mkUser('owner');
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
      data: { tenantId, name: `แผนงาน ${STAMP}` },
      select: { id: true },
    })
  ).id;
  await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: actorId } });
  for (const permission of [
    'BROWSE_PROJECT',
    'EDIT_ITEM',
    'LINK_ITEM',
    'MANAGE_PROJECT',
  ] as PermissionKey[]) {
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
      where: { OR: [{ source: { itemKey: { in: keys } } }, { target: { itemKey: { in: keys } } }] },
    }),
  );
  await step('งานในรุ่น', () =>
    prismaClient.workItemVersion.deleteMany({ where: { versionId: { in: versionIds } } }),
  );
  /*
    ลบรุ่นตาม "ใครสร้าง" ไม่ใช่ตามชื่อ — ตอนกลไกถูกลบ เคสที่ไม่ควรสร้างอะไร
    อาจสร้างรุ่นชื่อแปลก ๆ ที่ไม่มี stamp ขึ้นมา แล้ว FK `Restrict` บน
    `created_by_id` จะกันการลบผู้ใช้ต่อเป็นลูกโซ่ (เกิดขึ้นมาแล้วจริง)
  */
  await step('รุ่นของเทสต์', async () => {
    const users = await prismaClient.user.findMany({
      where: { email: { contains: STAMP } },
      select: { id: true },
    });
    await prismaClient.projectVersion.deleteMany({
      where: { createdById: { in: users.map((u) => u.id) } },
    });
  });
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
  const left = await prismaClient.projectVersion.count({
    where: { createdBy: { email: { contains: STAMP } } },
  });
  if (left > 0) console.error(`เหลือรุ่นของเทสต์ค้างอยู่ ${String(left)} รุ่น`);
  await prismaClient.$disconnect();
});

describe('แผนงาน · ต่อของจริง', () => {
  it('**รุ่นที่มีวันปล่อยถูกวางบนเส้นเวลา และรุ่นที่ไม่มีวันที่อยู่ในรายการที่วางไม่ได้**', async () => {
    const withDate = await newVersion('1.0', '2029-05-31T00:00:00.000Z');
    const noDate = await newVersion('ยังไม่กำหนด', null);

    const r = await roadmapOf(ctx, 'SD', RANGE, NOW);
    const placed = r.bars.find((b) => b.key === `v${withDate.toString()}`);
    expect(placed, 'รุ่นที่มีวันปล่อยต้องถูกวาง — ถ้าไม่ แปลว่าสัญญาณไม่ถึงเอนจิน').toBeDefined();
    // มีแต่วันปล่อย ไม่มีวันเริ่ม จึงเป็นหมุด
    expect(placed?.milestone).toBe(true);

    const skipped = r.unplaced.find((u) => u.key === `v${noDate.toString()}`);
    expect(skipped?.reason).toBe('no-dates');
    expect(skipped?.reasonLabel).toContain('ยังไม่ได้กำหนด');
  });

  /**
   * **หัวใจของไฟล์**
   *
   * งานในรุ่นที่ปล่อยทีหลัง ขวางงานในรุ่นที่ปล่อยก่อน = รุ่นแรกปล่อยไม่ได้จริง
   */
  it('**การขวางข้ามรุ่นถูกจับได้จากลิงก์จริง**', async () => {
    const early = await newVersion('0.9', '2029-03-31T00:00:00.000Z');
    const late = await newVersion('2.0', '2029-09-30T00:00:00.000Z');
    const blocker = await newItem('BLOCKER');
    const blocked = await newItem('BLOCKED');
    await setItemVersion(ctx, blocker, late, true);
    await setItemVersion(ctx, blocked, early, true);
    await linkWorkItems(ctx, blocker, blocked, 'BLOCKS');

    const r = await roadmapOf(ctx, 'SD', RANGE, NOW);
    const c = r.conflicts.find((x) => x.blockedKey === blocked);
    expect(c?.blockerKey).toBe(blocker);
    expect(c?.blockerVersionLabel).toContain('2.0');
    expect(c?.blockedVersionLabel).toContain('0.9');

    /*
      **นับทิศเดียว** — ลิงก์ถูกเก็บเป็น `BLOCKS` ทิศเดียว ถ้าคิวรีอ่านทั้ง
      `source` และ `target` เป็นตัวขวาง คู่นี้จะถูกนับสองครั้ง
    */
    expect(r.conflicts.filter((x) => x.blockedKey === blocked)).toHaveLength(1);
  });

  it('**งานที่อยู่หลายรุ่น ใช้รุ่นที่ปล่อยเร็วที่สุด**', async () => {
    /*
      ตัวขวางอยู่ทั้ง 2.0 (ก.ย.) และ 0.5 (ก.พ.) · ถ้าใช้รุ่นล่าสุดเป็นตัวแทน
      คู่นี้จะยังถูกรายงานว่าขัดแย้ง ทั้งที่ของชิ้นนั้นพร้อมตั้งแต่ ก.พ.
      — การกลบแบบนี้ทำให้รายงานมีเสียงรบกวนจนไม่มีใครอ่าน
    */
    const veryEarly = await newVersion('0.5', '2029-02-28T00:00:00.000Z');
    const blocker = `SD-RM${STAMP}BLOCKER`;
    await setItemVersion(ctx, blocker, veryEarly, true);

    const r = await roadmapOf(ctx, 'SD', RANGE, NOW);
    expect(r.conflicts.filter((x) => x.blockerKey === blocker)).toEqual([]);
  });

  /**
   * **รุ่นที่ยังไม่มีวันปล่อย ต้องไม่ชนะรุ่นที่มีวันปล่อย**
   *
   * งานที่อยู่ทั้งรุ่นที่ยังไม่กำหนดวันและรุ่นที่กำหนดแล้ว **มีกำหนดจริงอยู่หนึ่งอัน**
   * — ถ้าปล่อยให้รุ่นที่ไม่มีวันเป็นตัวแทน คู่นั้นจะถูกรายงานว่า "ตรวจไม่ได้"
   * ทั้งที่ตรวจได้ และการขวางที่เป็นปัญหาจริงจะหายไปในกองที่ตรวจไม่ได้
   *
   * เคสนี้เพิ่มเข้ามาเพราะตอนลบกลไกทีละบรรทัด บรรทัดนั้นลบแล้วยังเขียว
   */
  it('**งานที่อยู่ทั้งรุ่นไร้วันและรุ่นมีวัน ใช้รุ่นที่มีวัน**', async () => {
    const noDate = await newVersion('ค้างไว้ก่อน', null);

    const blocked = await newItem('MIXED');
    // ผูกรุ่นที่ไม่มีวันก่อน เพื่อให้มันเป็นตัวที่พบก่อนตอนไล่หา
    await setItemVersion(ctx, blocked, noDate, true);
    const earlyDated = await newVersion('0.8', '2029-03-01T00:00:00.000Z');
    await setItemVersion(ctx, blocked, earlyDated, true);

    const blocker = `SD-RM${STAMP}BLOCKER2`;
    await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey: blocker,
        issueTypeId: template.issueTypeId,
        statusId: template.statusId,
        reporterId: actorId,
        summary: `[แผนงาน] BLOCKER2 ${STAMP}`,
        rank: `0aaRM${STAMP}BLOCKER2`,
      },
    });
    keys.push(blocker);
    const late = await newVersion('3.0', '2029-10-31T00:00:00.000Z');
    await setItemVersion(ctx, blocker, late, true);
    await linkWorkItems(ctx, blocker, blocked, 'BLOCKS');

    const r = await roadmapOf(ctx, 'SD', RANGE, NOW);
    expect(r.conflicts.some((x) => x.blockedKey === blocked)).toBe(true);
    expect(r.uncheckable.some((x) => x.blockedKey === blocked)).toBe(false);
  });

  it('**คู่ที่ตรวจไม่ได้ ถูกรายงานว่าตรวจไม่ได้ ไม่ใช่เงียบ**', async () => {
    const lonely = await newItem('LONELY');
    const target = await newItem('TARGET');
    await linkWorkItems(ctx, lonely, target, 'BLOCKS');

    const r = await roadmapOf(ctx, 'SD', RANGE, NOW);
    const u = r.uncheckable.find((x) => x.blockerKey === lonely);
    expect(u?.blockedKey).toBe(target);
    expect(r.conflicts.filter((x) => x.blockerKey === lonely)).toEqual([]);
  });

  it('กรอบเวลาที่ไม่ครอบรุ่นไหนเลย — รุ่นอยู่ในรายการที่วางไม่ได้ พร้อมเหตุผล', async () => {
    const r = await roadmapOf(
      ctx,
      'SD',
      { from: '2031-01-01T00:00:00.000Z', to: '2031-12-31T00:00:00.000Z' },
      NOW,
    );
    const mine = r.unplaced.filter((u) => u.label.includes(STAMP));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.some((u) => u.reason === 'outside-window')).toBe(true);
  });

  it('**คนที่เปิดดูโปรเจกต์ไม่ได้ อ่านแผนงานไม่ได้**', async () => {
    // เจ้าของสิทธิ์อ่านได้ — ถ้าเคสนี้ล้ม แปลว่าด่านกันผิดคน ไม่ใช่กันถูกคน
    expect((await roadmapOf(ctx, 'SD', RANGE, NOW)).bars.length).toBeGreaterThan(0);
    await expect(roadmapOf(outsiderCtx, 'SD', RANGE, NOW)).rejects.toThrow(PermissionDeniedError);
  });
});
