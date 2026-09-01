/**
 * รุ่นของโปรเจกต์ — ต่อของจริง
 *
 * `release-plan.spec.ts` ประกอบข้อมูลนำเข้าขึ้นมาเอง จึงพิสูจน์ได้แค่ว่า
 * *ถ้า* ข้อมูลหน้าตาแบบนั้นเข้ามา ผลจะถูก · ไฟล์นี้ถามคำถามที่เอนจินตอบไม่ได้:
 *
 *   1. **"เสร็จ" อ่านจากหมวดของสถานะ ไม่ใช่ `resolvedAt`** — งานที่ปิดแล้ว
 *      เปิดใหม่จะมี `resolvedAt` ค้างอยู่ · ถ้าอ่านผิดที่ รุ่นจะปล่อยได้ทั้งที่
 *      ยังมีงานค้าง และบันทึกจะลงรายการงานที่ยังไม่เสร็จเป็นของที่ปล่อยแล้ว
 *   2. **งานข้ามโปรเจกต์ใส่เข้ารุ่นไม่ได้** — ถ้าใส่ได้ บันทึกการปล่อยจะมีงาน
 *      ที่ไม่มีใครในทีมนั้นรู้จัก และตัวกรองของหน้าจอจะเลือกมันไม่เจอ
 *   3. **ชื่อซ้ำในโปรเจกต์เดียวใช้ไม่ได้** — ด่านอยู่ทั้งในโค้ดและใน unique index
 *   4. **`MANAGE_PROJECT` ต่างจาก `EDIT_ITEM`** — คนที่แก้งานได้ ไม่ได้แปลว่า
 *      ปล่อยรุ่นได้ · ถ้าไม่มีเคสที่แยกสองอย่างนี้ การเปลี่ยนด่านจะไม่มีอะไรจับได้
 *      (เจอกับตัวเองในไฟล์ `change-review-db.spec.ts` มาแล้ว)
 *   5. **ใส่งานซ้ำไม่เขียนประวัติเพิ่ม** — กดสองครั้งไม่ได้แปลว่าเกิดสองเหตุการณ์
 *
 * เทสต์สร้างงาน ผู้ใช้ กลุ่ม และรุ่นของตัวเองทั้งหมด แล้วลบทิ้ง ไม่แตะข้อมูล seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toUtcDate, type TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError, type PermissionKey } from '../src/modules/permission';
import {
  DuplicateVersionNameError,
  ItemFromOtherProjectError,
  UnfinishedItemsError,
  VersionNameRequiredError,
  createVersion,
  listVersions,
  releaseNote,
  releaseVersion,
  reopenVersion,
  setItemVersion,
  versionsOfItem,
} from '../src/modules/version';

const STAMP = String(Date.now()).slice(-6);
/** ทุกเวลาอิงวันที่ตายตัว — "ตอนนี้" ส่งเข้าไปเสมอ */
const NOW = toUtcDate('2029-03-01T00:00:00.000Z');

let tenantId: bigint;
let projectId: bigint;
let otherProjectId: bigint;
let otherProjectKey = '';
let template: { issueTypeId: bigint; todo: bigint; done: bigint };
let otherTemplate: { issueTypeId: bigint; statusId: bigint };
let ctx: TenantContext;
/** แก้งานได้ แต่จัดการโปรเจกต์ไม่ได้ — คนที่แยกสองสิทธิ์นี้ออกจากกัน */
let editorCtx: TenantContext;
/** เปิดดูได้อย่างเดียว — คนที่แยก "อ่าน" ออกจาก "แก้งาน" */
let viewerCtx: TenantContext;
let viewerGroupId: bigint;
let actorId: bigint;
let groupId: bigint;
let editorGroupId: bigint;
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

async function newItem(tag: string, o: { done?: boolean; other?: boolean } = {}): Promise<string> {
  /** คีย์มี stamp เสมอ — ตอนกลไกถูกลบ ค่าที่ "ไม่ควรถูกใช้" จะถูกใช้จริง */
  const prefix = o.other === true ? otherProjectKey : 'SD';
  const itemKey = `${prefix}-VER${STAMP}${tag}`;
  await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId: o.other === true ? otherProjectId : projectId,
      itemKey,
      issueTypeId: o.other === true ? otherTemplate.issueTypeId : template.issueTypeId,
      statusId:
        o.other === true
          ? otherTemplate.statusId
          : o.done === true
            ? template.done
            : template.todo,
      reporterId: actorId,
      summary: `[รุ่น] ${tag} ${STAMP}`,
      rank: `0aaVER${STAMP}${tag}`,
    },
  });
  keys.push(itemKey);
  return itemKey;
}

async function newVersion(name: string): Promise<bigint> {
  const v = await createVersion(ctx, 'SD', { name: `${name} ${STAMP}` });
  versionIds.push(v.id);
  return v.id;
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  projectId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } })).id;
  const other = await prismaClient.project.findFirstOrThrow({ where: { key: 'PLAT' } });
  otherProjectId = other.id;
  otherProjectKey = other.key;

  const any = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId },
    select: { issueTypeId: true },
  });
  const pick = async (category: 'TODO' | 'DONE'): Promise<bigint> =>
    (
      await prismaClient.workflowStatus.findFirstOrThrow({
        where: { category, workflow: { schemes: { some: { tenantId } } } },
        select: { id: true },
      })
    ).id;
  template = { issueTypeId: any.issueTypeId, todo: await pick('TODO'), done: await pick('DONE') };
  const anyOther = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId: otherProjectId },
    select: { issueTypeId: true, statusId: true },
  });
  otherTemplate = { issueTypeId: anyOther.issueTypeId, statusId: anyOther.statusId };

  const mkUser = async (tag: string): Promise<bigint> =>
    (
      await prismaClient.user.create({
        data: {
          tenantId,
          email: `ver-${tag}-${STAMP}@example.test`,
          displayName: `QA รุ่น ${tag} ${STAMP}`,
        },
        select: { id: true },
      })
    ).id;
  actorId = await mkUser('owner');
  ctx = { tenantId, actorId };
  const editorId = await mkUser('editor');
  editorCtx = { tenantId, actorId: editorId };
  const viewerId = await mkUser('viewer');
  viewerCtx = { tenantId, actorId: viewerId };

  const schemeOf = async (id: bigint): Promise<bigint> => {
    const s = (
      await prismaClient.project.findFirstOrThrow({
        where: { id },
        select: { permissionSchemeId: true },
      })
    ).permissionSchemeId;
    if (s === null) throw new Error('โปรเจกต์ไม่มี permission scheme');
    return s;
  };
  const sdScheme = await schemeOf(projectId);
  const platScheme = await schemeOf(otherProjectId);

  const mkGroup = async (
    name: string,
    userId: bigint,
    grants: Array<[bigint, PermissionKey]>,
  ): Promise<bigint> => {
    const g = await prismaClient.userGroup.create({
      data: { tenantId, name: `รุ่น ${name} ${STAMP}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId: g.id, userId } });
    for (const [schemeId, permission] of grants) {
      const row = await prismaClient.permissionGrant.create({
        data: { tenantId, schemeId, permission, groupId: g.id },
        select: { id: true },
      });
      grantIds.push(row.id);
    }
    return g.id;
  };

  groupId = await mkGroup('เจ้าของ', actorId, [
    [sdScheme, 'BROWSE_PROJECT'],
    [sdScheme, 'EDIT_ITEM'],
    [sdScheme, 'MANAGE_PROJECT'],
    // ต้องเห็น PLAT ด้วย ไม่งั้นเคส "งานข้ามโปรเจกต์" จะแดงเพราะสิทธิ์ ไม่ใช่เพราะกฎ
    [platScheme, 'BROWSE_PROJECT'],
    [platScheme, 'EDIT_ITEM'],
  ]);
  /*
    **กลุ่มที่แก้งานได้แต่จัดการโปรเจกต์ไม่ได้**

    จำเป็นเพื่อแยก `EDIT_ITEM` ออกจาก `MANAGE_PROJECT` · ถ้ามีแต่คนนอกที่ไม่มี
    สิทธิ์อะไรเลย การเปลี่ยนด่านปล่อยรุ่นเป็น `EDIT_ITEM` จะยังเขียว
    (บทเรียนจาก `change-review-db.spec.ts` ที่เจอกับตัวเองมาแล้ว)
  */
  editorGroupId = await mkGroup('คนแก้งาน', editorId, [
    [sdScheme, 'BROWSE_PROJECT'],
    [sdScheme, 'EDIT_ITEM'],
  ]);
  /*
    **กลุ่มที่เปิดดูได้อย่างเดียว**

    ชั้นที่สามของการแยกสิทธิ์: BROWSE < EDIT < MANAGE · ถ้าขาดชั้นนี้
    การเปลี่ยนด่าน "ใส่งานเข้ารุ่น" จาก `EDIT_ITEM` เป็น `BROWSE_PROJECT`
    จะยังเขียว — พิสูจน์แล้วตอนลบกลไกทีละบรรทัด
  */
  viewerGroupId = await mkGroup('คนอ่าน', viewerId, [[sdScheme, 'BROWSE_PROJECT']]);
}, 120_000);

afterAll(async () => {
  await step('งานในรุ่น', () =>
    prismaClient.workItemVersion.deleteMany({ where: { versionId: { in: versionIds } } }),
  );
  /*
    **ลบตาม "ใครสร้าง" ไม่ใช่ตาม "ชื่อมี stamp"**

    ตอนลบกลไก "ชื่อว่างถูกปฏิเสธ" ออกเพื่อพิสูจน์ว่าเทสต์แดงได้ เคสนั้น
    **สร้างรุ่นชื่อสตริงว่างขึ้นมาจริง** ซึ่งไม่มี stamp จึงรอดจากการเก็บกวาด ·
    แล้ว FK `Restrict` บน `created_by_id` ก็กันไม่ให้ลบผู้ใช้ของเทสต์ต่อ
    — ผลคือรุ่นชื่อว่างหนึ่งใบและผู้ใช้สองคนค้างในฐานข้อมูลพัฒนาจริง
    (เจอเพราะลายนิ้วมือตาราง `user` ไม่ตรง)

    รุ่นชื่อว่างจะไปโผล่เป็น **ตัวเลือกว่างเปล่า** ในฟอร์มเลือกรุ่นของจริง
    ซึ่งเป็นอาการเดียวกับที่เคยเกิดกับ "ผลการแก้ไข" มาแล้ว (CLAUDE.md)
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
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({
      where: { groupId: { in: [groupId, editorGroupId, viewerGroupId] } },
    }),
  );
  await step('ผู้ใช้ของเทสต์', () =>
    prismaClient.user.deleteMany({ where: { email: { contains: STAMP } } }),
  );
  await step('กลุ่มของเทสต์', () =>
    prismaClient.userGroup.deleteMany({
      where: { id: { in: [groupId, editorGroupId, viewerGroupId] } },
    }),
  );

  // ยืนยันด้วยการนับหลังคืน ไม่ใช่เชื่อว่าลูปทำงาน
  const left = await prismaClient.projectVersion.count({
    where: { createdBy: { email: { contains: STAMP } } },
  });
  if (left > 0) console.error(`เหลือรุ่นของเทสต์ค้างอยู่ ${String(left)} รุ่น`);
  await prismaClient.$disconnect();
});

describe('รุ่น · ต่อของจริง', () => {
  it('สร้างแล้วอ่านกลับได้ พร้อมจำนวนงานที่เริ่มจากศูนย์', async () => {
    const id = await newVersion('1.0');
    const rows = await listVersions(ctx, 'SD', NOW);
    const mine = rows.find((r) => r.id === id.toString());
    expect(mine?.total).toBe(0);
    expect(mine?.state).toBe('UNRELEASED');
  });

  it('ชื่อว่างถูกปฏิเสธ และชื่อซ้ำในโปรเจกต์เดียวถูกปฏิเสธ', async () => {
    await expect(createVersion(ctx, 'SD', { name: '   ' })).rejects.toThrow(
      VersionNameRequiredError,
    );
    await expect(createVersion(ctx, 'SD', { name: `1.0 ${STAMP}` })).rejects.toThrow(
      DuplicateVersionNameError,
    );
  });

  /**
   * **"เสร็จ" อ่านจากหมวดของสถานะ ไม่ใช่ `resolvedAt`**
   *
   * งานที่เคยปิดแล้วเปิดใหม่จะมี `resolvedAt` ค้างอยู่ · ถ้าอ่านผิดที่
   * รุ่นจะปล่อยได้ทั้งที่ยังมีงานค้าง โดยไม่มี error ให้เห็น
   */
  it('**งานที่มี `resolvedAt` ค้างแต่สถานะยังไม่ DONE นับว่ายังไม่เสร็จ**', async () => {
    const id = await newVersion('1.1');
    const open = await newItem('REOPEN');
    // เหมือนใบที่ถูกปิดแล้วเปิดใหม่: มีเวลาปิดค้างอยู่ แต่สถานะกลับมา TODO
    await prismaClient.workItem.updateMany({
      where: { itemKey: open },
      data: { resolvedAt: new Date('2029-01-01T00:00:00.000Z') },
    });
    await setItemVersion(ctx, open, id, true);

    const rows = await listVersions(ctx, 'SD', NOW);
    expect(rows.find((r) => r.id === id.toString())?.done).toBe(0);
    await expect(releaseVersion(ctx, id, NOW)).rejects.toThrow(UnfinishedItemsError);
  });

  it('งานเสร็จหมดแล้ว ปล่อยได้ และสถานะเปลี่ยนเป็นปล่อยแล้ว', async () => {
    const id = await newVersion('1.2');
    await setItemVersion(ctx, await newItem('OK1', { done: true }), id, true);
    await releaseVersion(ctx, id, NOW);
    const rows = await listVersions(ctx, 'SD', NOW);
    const mine = rows.find((r) => r.id === id.toString());
    expect(mine?.state).toBe('RELEASED');
    expect(mine?.releasedAt).toBe('2029-03-01T00:00:00.000Z');
  });

  it('ปล่อยแล้วเปิดใหม่ได้ และเวลาที่ปล่อยถูกล้าง', async () => {
    const id = versionIds[versionIds.length - 1] as bigint;
    await reopenVersion(ctx, id);
    const rows = await listVersions(ctx, 'SD', NOW);
    expect(rows.find((r) => r.id === id.toString())?.releasedAt).toBeNull();
  });

  /** รุ่นเป็นของโปรเจกต์ — ใส่งานข้ามโปรเจกต์เข้าไปได้เมื่อไร บันทึกจะมั่ว */
  it('**งานจากโปรเจกต์อื่นใส่เข้ารุ่นนี้ไม่ได้**', async () => {
    const id = await newVersion('1.3');
    const foreign = await newItem('FOREIGN', { other: true });
    await expect(setItemVersion(ctx, foreign, id, true)).rejects.toThrow(
      ItemFromOtherProjectError,
    );
    const rows = await listVersions(ctx, 'SD', NOW);
    expect(rows.find((r) => r.id === id.toString())?.total).toBe(0);
  });

  it('**ใส่งานซ้ำไม่เขียนประวัติเพิ่ม** — กดสองครั้งไม่ใช่สองเหตุการณ์', async () => {
    const id = await newVersion('1.4');
    const key = await newItem('TWICE');
    await setItemVersion(ctx, key, id, true);
    await setItemVersion(ctx, key, id, true);
    const history = await prismaClient.workItemHistory.count({
      where: { workItem: { itemKey: key }, field: 'fixVersion' },
    });
    expect(history).toBe(1);
    const links = await prismaClient.workItemVersion.count({ where: { versionId: id } });
    expect(links).toBe(1);
  });

  it('เอางานออกจากรุ่นได้ และงานไม่หายไปไหน', async () => {
    const id = await newVersion('1.5');
    const key = await newItem('OUT');
    await setItemVersion(ctx, key, id, true);
    await setItemVersion(ctx, key, id, false);
    expect(await prismaClient.workItemVersion.count({ where: { versionId: id } })).toBe(0);
    expect(await prismaClient.workItem.count({ where: { itemKey: key } })).toBe(1);
  });

  /**
   * **บันทึกการปล่อยบอกจำนวนที่ยังไม่เสร็จเสมอ**
   *
   * บันทึกที่ตัดงานค้างทิ้งเงียบ ๆ อ่านเหมือน "นี่คือทั้งหมดที่อยู่ในรุ่นนี้"
   */
  it('**บันทึกลงเฉพาะงานที่เสร็จ แต่บอกจำนวนที่ค้าง**', async () => {
    const id = await newVersion('2.0');
    await setItemVersion(ctx, await newItem('N1', { done: true }), id, true);
    await setItemVersion(ctx, await newItem('N2'), id, true);
    const note = await releaseNote(ctx, id);
    expect(note.groups.flatMap((g) => g.items).length).toBe(1);
    expect(note.unfinished).toBe(1);
    expect(note.finished).toBe(1);
  });

  it('รุ่นที่งานใบหนึ่งอยู่ และรุ่นที่ยังเลือกได้ ไม่ปนกัน', async () => {
    const inIt = await newVersion('3.0');
    const notIn = await newVersion('3.1');
    const key = await newItem('WHICH');
    await setItemVersion(ctx, key, inIt, true);
    const r = await versionsOfItem(ctx, key, NOW);
    expect(r.inVersions.map((v) => v.id)).toEqual([inIt.toString()]);
    expect(r.available.map((v) => v.id)).toContain(notIn.toString());
    expect(r.available.map((v) => v.id)).not.toContain(inIt.toString());
  });

  /**
   * **`EDIT_ITEM` ไม่ใช่ `MANAGE_PROJECT`**
   *
   * คนที่แก้งานได้ ต้องใส่งานเข้ารุ่นได้ แต่ต้องสร้างหรือปล่อยรุ่นไม่ได้ ·
   * ถ้าไม่มีเคสนี้ การเปลี่ยนด่านจาก `MANAGE_PROJECT` เป็น `EDIT_ITEM`
   * จะไม่มีอะไรจับได้เลย
   */
  it('**คนที่แก้งานได้ ใส่งานเข้ารุ่นได้ แต่สร้างและปล่อยรุ่นไม่ได้**', async () => {
    const id = await newVersion('4.0');
    const key = await newItem('BYEDITOR', { done: true });

    await setItemVersion(editorCtx, key, id, true);
    expect(await prismaClient.workItemVersion.count({ where: { versionId: id } })).toBe(1);

    await expect(createVersion(editorCtx, 'SD', { name: `4.1 ${STAMP}` })).rejects.toThrow(
      PermissionDeniedError,
    );
    await expect(releaseVersion(editorCtx, id, NOW)).rejects.toThrow(PermissionDeniedError);
    // ตรวจค่าในแถว ไม่ใช่แค่ว่าโยน error — ด่านที่อยู่หลังการเขียนจะโยนสายเกินไป
    const rows = await listVersions(ctx, 'SD', NOW);
    expect(rows.find((r) => r.id === id.toString())?.releasedAt).toBeNull();
  });

  /**
   * **`BROWSE_PROJECT` ไม่ใช่ `EDIT_ITEM`**
   *
   * ชั้นที่สามของการแยกสิทธิ์ · คนที่เปิดดูโปรเจกต์ได้ ต้องเห็นรุ่นได้
   * แต่ต้องใส่งานเข้ารุ่นไม่ได้ · ถ้าไม่มีเคสนี้ การเปลี่ยนด่านใส่งานจาก
   * `EDIT_ITEM` เป็น `BROWSE_PROJECT` จะไม่มีอะไรจับได้เลย — พิสูจน์แล้วว่า
   * เทสต์ชุดก่อนหน้ายังเขียวกับการเปลี่ยนนั้น
   */
  it('**คนที่เปิดดูได้อย่างเดียว เห็นรุ่นได้ แต่ใส่งานเข้ารุ่นไม่ได้**', async () => {
    const id = await newVersion('5.0');
    const key = await newItem('BYVIEWER');

    expect((await listVersions(viewerCtx, 'SD', NOW)).map((v) => v.id)).toContain(id.toString());
    await expect(setItemVersion(viewerCtx, key, id, true)).rejects.toThrow(PermissionDeniedError);
    expect(await prismaClient.workItemVersion.count({ where: { versionId: id } })).toBe(0);
  });
});
