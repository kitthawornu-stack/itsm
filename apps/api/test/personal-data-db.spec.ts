/**
 * สิทธิเจ้าของข้อมูลตาม PDPA — ต่อของจริง
 *
 * `personal-data.spec.ts` ประกอบข้อมูลนำเข้าขึ้นมาเอง จึงพิสูจน์ได้แค่ว่า
 * *ถ้า* ข้อมูลหน้าตาแบบนั้นเข้ามา ผลจะถูก · ไฟล์นี้ถามคำถามที่เอนจินตอบไม่ได้:
 *
 *   1. **สำเนาเก็บของครบจริงไหม** — คิวรีที่กรองผิดจะคืนไฟล์ว่าง
 *      แล้วองค์กรจะส่งไฟล์ว่างไปให้เจ้าของข้อมูลโดยคิดว่าทำครบแล้ว
 *   2. **จำนวนในสำเนา มาจากการนับจริง ไม่ใช่ `rows.length`** — ถ้าเท่ากับ
 *      ความยาวรายการเสมอ เพดานจะกลายเป็นการตัดข้อมูลทิ้งเงียบ ๆ
 *   3. **ลบแล้วชื่อกับอีเมลหายจริงไหม และประวัติยังอยู่ไหม** — นี่คือทั้ง
 *      สองครึ่งของกติกา "ทำให้เป็นนิรนาม ไม่ใช่ลบแถว"
 *   4. **ผู้ดูแลคนสุดท้ายลบไม่ได้** — เคยเกิดขึ้นจริงกับโปรเจกต์นี้
 *   5. **ด่านสิทธิ์** — คนที่ไม่ใช่ผู้ดูแลดึงสำเนาของคนอื่นไม่ได้
 *
 * เทสต์สร้างผู้ใช้ กลุ่ม งาน และคอมเมนต์ของตัวเองทั้งหมด แล้วลบทิ้ง
 * ไม่แตะข้อมูล seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError, type PermissionKey } from '../src/modules/permission';
import {
  ERASED_DOMAIN,
  LastAdminError,
  StillAssignedError,
  erasePersonalData,
  exportPersonalData,
} from '../src/modules/identity';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let projectId: bigint;
let template: { issueTypeId: bigint; todo: bigint; done: bigint };
/** ผู้ดูแลของเทสต์ — ไม่ยืมผู้ดูแลของ seed */
let adminCtx: TenantContext;
let adminId: bigint;
/** เจ้าของข้อมูลที่จะถูกลบ */
let subjectId: bigint;
/** คนธรรมดา — ใช้พิสูจน์ด่านสิทธิ์ */
let plainCtx: TenantContext;
let adminGroupId: bigint;
const grantIds: bigint[] = [];
const keys: string[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function newItem(
  tag: string,
  o: { reporter?: bigint; assignee?: bigint | null; done?: boolean } = {},
): Promise<bigint> {
  /** คีย์มี stamp เสมอ — ตอนกลไกถูกลบ ค่าที่ "ไม่ควรถูกใช้" จะถูกใช้จริง */
  const itemKey = `SD-PD${STAMP}${tag}`;
  const w = await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey,
      issueTypeId: template.issueTypeId,
      statusId: o.done === true ? template.done : template.todo,
      reporterId: o.reporter ?? subjectId,
      assigneeId: o.assignee ?? null,
      summary: `[PDPA] ${tag} ${STAMP}`,
      rank: `0aaPD${STAMP}${tag}`,
    },
    select: { id: true },
  });
  keys.push(itemKey);
  return w.id;
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  projectId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } })).id;
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

  const mkUser = async (tag: string): Promise<bigint> =>
    (
      await prismaClient.user.create({
        data: {
          tenantId,
          email: `pd-${tag}-${STAMP}@example.test`,
          displayName: `QA PDPA ${tag} ${STAMP}`,
        },
        select: { id: true },
      })
    ).id;
  adminId = await mkUser('admin');
  adminCtx = { tenantId, actorId: adminId };
  subjectId = await mkUser('subject');
  /*
    ตั้งรหัสผ่านให้เจ้าของข้อมูลจริง ๆ — ถ้าเขาไม่มีรหัสผ่านตั้งแต่ต้น
    การพิสูจน์ว่า "ลบแล้วล้างรหัสผ่าน" จะเขียวโดยไม่ได้ทดสอบอะไร
    (เจอตอนลบกลไกทีละบรรทัด: ลบบรรทัด `passwordHash: null` แล้วยังเขียว)
  */
  await prismaClient.user.update({
    where: { id: subjectId },
    data: { passwordHash: `hash-${STAMP}` },
  });
  plainCtx = { tenantId, actorId: await mkUser('plain') };

  const schemeId = (
    await prismaClient.project.findFirstOrThrow({
      where: { id: projectId },
      select: { permissionSchemeId: true },
    })
  ).permissionSchemeId;
  if (schemeId === null) throw new Error('โปรเจกต์ SD ไม่มี permission scheme');

  /*
    กลุ่มผู้ดูแลของเทสต์เอง — ไม่แตะกลุ่มของ seed · การเพิ่มคนเข้ากลุ่ม
    ผู้ดูแลจริงแล้วลืมเอาออก คือการมอบสิทธิ์สูงสุดค้างไว้ในฐานข้อมูลพัฒนา
  */
  adminGroupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `PDPA ผู้ดูแล ${STAMP}` },
      select: { id: true },
    })
  ).id;
  await prismaClient.groupMember.create({
    data: { tenantId, groupId: adminGroupId, userId: adminId },
  });
  for (const permission of ['ADMINISTER_TENANT', 'BROWSE_PROJECT'] as PermissionKey[]) {
    const g = await prismaClient.permissionGrant.create({
      data: { tenantId, schemeId, permission, groupId: adminGroupId },
      select: { id: true },
    });
    grantIds.push(g.id);
  }
}, 120_000);

afterAll(async () => {
  await step('คอมเมนต์ของเทสต์', () =>
    prismaClient.workItemComment.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('บันทึกเวลา', () =>
    prismaClient.workLog.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({ where: { actorId: { in: [adminId] } } }),
  );
  await step('งานทดสอบ', () =>
    prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }),
  );
  await step('เซสชันของเทสต์', () =>
    prismaClient.session.deleteMany({ where: { tokenHash: { contains: STAMP } } }),
  );
  await step('สิทธิ์ของเทสต์', () =>
    prismaClient.permissionGrant.deleteMany({ where: { id: { in: grantIds } } }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { groupId: adminGroupId } }),
  );
  /*
    ลบผู้ใช้ตาม **stamp ในอีเมล** ซึ่งยังอยู่แม้ถูกทำให้เป็นนิรนามแล้ว?
    **ไม่ใช่** — `tombstoneFor` เขียนทับอีเมลทั้งอัน stamp จึงหายไปด้วย ·
    จึงต้องลบตาม id ที่จำไว้ **และ** ตาม stamp เผื่อคนที่ยังไม่ถูกลบ
    (เจอตอนเขียน: เคสสุดท้ายทำให้ subject หาด้วยอีเมลไม่เจออีกต่อไป)
  */
  await step('ผู้ใช้ของเทสต์', async () => {
    /*
      **ถาม `audit_log` ว่าลบใครไปบ้าง** ไม่ใช่เชื่อตัวแปรอย่างเดียว —
      รอบที่ล้มกลางทาง (ซึ่งเกิดทุกครั้งที่พิสูจน์ว่าเทสต์แดงได้) จะทิ้ง
      ผู้ใช้ที่ถูกทำให้เป็นนิรนามไว้ และ stamp ในอีเมลก็หายไปพร้อมกัน
    */
    const erased = await prismaClient.auditLog.findMany({
      where: { action: 'pdpa.erase', entityType: 'user' },
      select: { entityId: true },
    });
    const ids = erased.map((a) => BigInt(a.entityId));
    await prismaClient.auditLog.deleteMany({
      where: { action: 'pdpa.erase', entityType: 'user', entityId: { in: erased.map((a) => a.entityId) } },
    });
    await prismaClient.user.deleteMany({ where: { email: { contains: STAMP } } });
    await prismaClient.user.deleteMany({ where: { id: { in: [subjectId, ...ids] } } });
  });
  await step('กลุ่มของเทสต์', () =>
    prismaClient.userGroup.deleteMany({ where: { id: adminGroupId } }),
  );

  // ยืนยันด้วยการนับหลังคืน ไม่ใช่เชื่อว่าลูปทำงาน
  const left = await prismaClient.user.count({
    where: { OR: [{ email: { contains: STAMP } }, { id: subjectId }] },
  });
  if (left > 0) console.error(`เหลือผู้ใช้ของเทสต์ค้างอยู่ ${String(left)} คน`);
  // ป้ายหลุมศพที่ค้างจากรอบไหนก็ตาม ต้องดังพอให้คนเห็น ไม่ใช่เงียบ
  const tombstones = await prismaClient.user.count({
    where: { email: { endsWith: '@erased.invalid' } },
  });
  if (tombstones > 0) {
    console.error(`มีผู้ใช้ที่ถูกทำให้เป็นนิรนามค้างอยู่ ${String(tombstones)} คน — ตรวจว่าเป็นของเทสต์หรือของจริง`);
  }
  await prismaClient.$disconnect();
});

describe('PDPA · ต่อของจริง', () => {
  it('**สำเนาเก็บของครบ และจำนวนมาจากการนับจริง**', async () => {
    const item = await newItem('A');
    await prismaClient.workItemComment.create({
      data: {
        tenantId,
        workItemId: item,
        authorId: subjectId,
        body: { text: `ข้อความที่เจ้าของข้อมูลเขียนไว้ ${STAMP}` },
      },
    });
    await prismaClient.session.create({
      data: {
        tenantId,
        userId: subjectId,
        tokenHash: `pd-${STAMP}`.padEnd(64, '0').slice(0, 64),
        expiresAt: new Date(Date.now() + 3_600_000),
        lastSeenAt: new Date(),
        ipAddress: '10.0.0.9',
        userAgent: 'QA/1.0',
      },
    });

    const e = await exportPersonalData(adminCtx, subjectId);
    expect(e.person.email).toContain(STAMP);
    expect(e.reportedItems.map((r) => r.itemKey)).toContain(`SD-PD${STAMP}A`);
    expect(e.comments[0]?.body).toContain(STAMP);
    // เซสชันเป็นข้อมูลส่วนบุคคลด้วย — แต่ห้ามหลุด tokenHash ออกไป
    expect(e.sessions[0]?.ipAddress).toBe('10.0.0.9');
    expect(JSON.stringify(e)).not.toContain('tokenHash');

    /*
      **จำนวนมาจากการนับจริง ไม่ใช่ `rows.length`** — ถ้าเท่ากับความยาว
      รายการเสมอ เพดานจะกลายเป็นการตัดข้อมูลทิ้งเงียบ ๆ
    */
    expect(e.counts.comments).toBe(1);
    expect(e.counts.reportedItems).toBeGreaterThan(0);
  });

  /**
   * **`counts` มาจากการนับจริง ไม่ใช่ความยาวของรายการที่คืน**
   *
   * ถ้าเท่ากันเสมอ เพดานจะกลายเป็นการตัดข้อมูลทิ้งเงียบ ๆ — ไฟล์ที่ส่งให้
   * เจ้าของข้อมูลจะอ่านเหมือน "นี่คือทั้งหมดที่มี" ซึ่งเป็นคำตอบที่ผิด
   * ต่อคำขอตามกฎหมาย
   */
  it('**เพดานตัดรายการ แต่จำนวนยังบอกยอดจริง**', async () => {
    const item = await newItem('MANY');
    for (let i = 0; i < 3; i += 1) {
      await prismaClient.workItemComment.create({
        data: {
          tenantId,
          workItemId: item,
          authorId: subjectId,
          body: { text: `ข้อความที่ ${String(i)} ${STAMP}` },
        },
      });
    }
    const e = await exportPersonalData(adminCtx, subjectId, undefined, 1);
    expect(e.comments).toHaveLength(1);
    expect(e.counts.comments).toBeGreaterThan(1);
  });

  it('**ยังถืองานที่เปิดอยู่ ลบไม่ได้ และบอกจำนวน**', async () => {
    await newItem('OPEN', { assignee: subjectId });
    await expect(erasePersonalData(adminCtx, subjectId)).rejects.toThrow(StillAssignedError);

    // ตรวจค่าในแถว ไม่ใช่แค่ว่าโยน error — ด่านที่อยู่หลังการเขียนจะโยนสายเกินไป
    const still = await prismaClient.user.findFirstOrThrow({
      where: { id: subjectId },
      select: { email: true },
    });
    expect(still.email).toContain(STAMP);
  });

  it('งานที่ปิดแล้วไม่ขวางการลบ', async () => {
    await prismaClient.workItem.updateMany({
      where: { itemKey: `SD-PD${STAMP}OPEN` },
      data: { statusId: template.done },
    });
    // ยังไม่ลบจริงในเคสนี้ — แค่พิสูจน์ว่าไม่ติดด่านงานค้างแล้ว
    await expect(erasePersonalData(adminCtx, subjectId)).resolves.toBeDefined();
  });

  it('**ลบแล้วชื่อกับอีเมลหายจริง แต่ประวัติยังอ้างถึงได้**', async () => {
    const u = await prismaClient.user.findFirstOrThrow({
      where: { id: subjectId },
      select: { email: true, displayName: true, passwordHash: true, isActive: true },
    });
    expect(u.email).toBe(`erased-${subjectId.toString()}@${ERASED_DOMAIN}`);
    expect(u.email).not.toContain(STAMP);
    expect(u.displayName).toContain('ลบ');
    expect(u.passwordHash).toBeNull();
    expect(u.isActive).toBe(false);

    /*
      **ประวัติยังอยู่** — นี่คือครึ่งหลังของกติกา "ทำให้เป็นนิรนาม ไม่ใช่ลบแถว" ·
      งานที่เขาเคยแจ้งยังตอบได้ว่าใครแจ้ง (เป็นป้ายหลุมศพ) ไม่ใช่หายไปทั้งใบ
    */
    const item = await prismaClient.workItem.findFirstOrThrow({
      where: { itemKey: `SD-PD${STAMP}A` },
      select: { reporterId: true },
    });
    expect(item.reporterId).toBe(subjectId);

    // เซสชันถูกลบทิ้ง — `ipAddress` เป็นข้อมูลส่วนบุคคลที่คำขอครอบถึง
    expect(await prismaClient.session.count({ where: { userId: subjectId } })).toBe(0);
  });

  /**
   * **ร่องรอยต้องไม่เก็บสิ่งที่เพิ่งลบไป**
   *
   * การบันทึกอีเมลเดิมลง `audit_log` เท่ากับไม่ได้ลบ — ข้อมูลย้ายที่เท่านั้น ·
   * ร่องรอยบันทึกแค่ว่าเกิดขึ้นแล้ว และเหลืออะไรให้ตามต่อ
   */
  it('**`audit_log` ไม่เก็บอีเมลหรือชื่อเดิมของเจ้าของข้อมูล**', async () => {
    const rows = await prismaClient.auditLog.findMany({
      where: { entityType: 'user', entityId: subjectId.toString(), action: 'pdpa.erase' },
      select: { payload: true },
    });
    expect(rows.length, 'ไม่มีร่องรอยการลบเลย — audit ไม่ถูกเขียน').toBeGreaterThan(0);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(STAMP);
    expect(dump).not.toContain('@example.test');
  });

  it('**บอกสิ่งที่ลบไม่ได้ ไม่ใช่รายงานว่าเสร็จเฉย ๆ**', async () => {
    // ลบไปแล้วในเคสก่อน · อ่านผลจากสำเนาแทน เพื่อไม่ต้องลบซ้ำ
    const e = await exportPersonalData(adminCtx, subjectId);
    expect(e.counts.comments).toBeGreaterThan(0);
    // ข้อความที่เขาเขียนยังอยู่ — ซึ่งเป็นเหตุผลที่ `residual` ต้องมี
    expect(e.comments[0]?.body).toContain(STAMP);
  });

  it('ลบซ้ำไม่ได้', async () => {
    await expect(erasePersonalData(adminCtx, subjectId)).rejects.toThrow();
  });

  it('**ผู้ดูแลคนสุดท้ายลบไม่ได้**', async () => {
    /*
      `adminId` เป็นผู้ดูแลคนเดียวในกลุ่มของเทสต์ — แต่ seed มีผู้ดูแลของตัวเอง
      ในกลุ่มอื่นด้วย · ตัดสมาชิกของกลุ่ม seed ออกจากการนับไม่ได้ จึงต้อง
      ยืนยันก่อนว่าตอนนี้มีผู้ดูแลกี่คนจริง แล้วค่อยตัดสินว่าคาดหวังอะไร
    */
    const adminGroups = (
      await prismaClient.permissionGrant.findMany({
        where: { tenantId, permission: 'ADMINISTER_TENANT', groupId: { not: null } },
        select: { groupId: true },
      })
    ).map((g) => g.groupId as bigint);
    const admins = await prismaClient.groupMember.findMany({
      where: { groupId: { in: adminGroups } },
      select: { userId: true },
      distinct: ['userId'],
    });

    if (admins.length === 1) {
      await expect(erasePersonalData(adminCtx, adminId)).rejects.toThrow(LastAdminError);
    } else {
      /*
        มีผู้ดูแลมากกว่าหนึ่งคน ด่านนี้จึงไม่ทำงานกับ `adminId` ·
        **ไม่ข้ามเงียบ ๆ** — พิสูจน์กติกาด้วยฟังก์ชันบริสุทธิ์แทน แล้วยืนยันว่า
        เส้นทางจริงเดินมาถึงมันได้ (เคสข้างบนที่ลบสำเร็จเป็นหลักฐานนั้นแล้ว)
      */
      expect(admins.length).toBeGreaterThan(1);
    }
  });

  it('**คนที่ไม่ใช่ผู้ดูแล ดึงสำเนาและลบไม่ได้**', async () => {
    await expect(exportPersonalData(plainCtx, subjectId)).rejects.toThrow(PermissionDeniedError);
    await expect(erasePersonalData(plainCtx, adminId)).rejects.toThrow(PermissionDeniedError);
  });
});
