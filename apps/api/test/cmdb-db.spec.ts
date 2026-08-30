/**
 * CMDB — ต่อของจริง
 *
 * `impact-graph.spec.ts` ประกอบกราฟขึ้นมาเอง จึงพิสูจน์ได้แค่ว่า *ถ้า* กราฟ
 * หน้าตาแบบนั้นเข้ามา ผลจะถูก · ไฟล์นี้ถามคำถามที่เอนจินตอบไม่ได้:
 *
 *   1. **กันวงจรตั้งแต่ตอนเขียน** — ผู้ดูแลต้องรู้ทันทีว่าเส้นนี้ทำให้วน
 *      ไม่ใช่รู้ตอนที่หน้าจอผลกระทบขึ้นธงในอีกสามเดือน
 *   2. **ลบสิ่งที่ดูแลแล้วเส้นที่ชี้เข้าและออกหายตาม** และจำนวนที่หาย
 *      ต้องอยู่ใน audit เพราะคำถาม "ทำไมกราฟขาดตรงนี้" ถามย้อนหลังเสมอ
 *   3. **ผลกระทบคืนชื่อจริง เรียงตามที่เอนจินบอก** ไม่ใช่ตามลำดับของฐานข้อมูล
 *   4. **ผู้ดูแลเท่านั้นที่แก้ได้**
 *
 * เทสต์สร้างผู้ใช้และรายการของตัวเองทั้งหมด แล้วลบทิ้ง ไม่แตะข้อมูล seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  AlreadyAttachedError,
  CiKeyRequiredError,
  CiNotFoundError,
  DependencyCycleError,
  DuplicateCiKeyError,
  SelfDependencyError,
  addDependency,
  createCi,
  deleteCi,
  impactOfCi,
  listCis,
  attachCi,
  cisOfItem,
  detachCi,
  openItemsInImpact,
  removeDependency,
  updateCi,
} from '../src/modules/cmdb';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let adminId: bigint;
let ctx: TenantContext;
/**
 * เวลาเริ่มของไฟล์นี้ — ใช้เก็บกวาด `audit_log`
 *
 * เก็บกวาดตาม `actorId` ของผู้ดูแลอย่างเดียวไม่พอ · **ตอนลบกลไก
 * `assertTenantAdmin` เพื่อพิสูจน์ว่าเทสต์แดงได้ เคส "คนนอกสร้างไม่ได้"
 * สร้างแถวจริงด้วย actor คนอื่น** ซึ่งถูกลบไปแล้วตอนเก็บกวาด แถว audit
 * จึงเหลือ `actorId` เป็น null และรอดจากตัวกรอง (เกิดขึ้นแล้วหนึ่งครั้ง)
 */
const STARTED_AT = new Date();
const ids = new Map<string, bigint>();

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

/** รหัสมี stamp เสมอ — ตอนกลไกถูกลบ ค่าที่ "ไม่ควรถูกใช้" จะถูกใช้จริง */
const k = (tag: string): string => `QA-${tag}-${STAMP}`;

async function ci(tag: string): Promise<bigint> {
  const r = await createCi(ctx, { key: k(tag), name: `ระบบ ${tag} ${STAMP}`, kind: 'SERVER' });
  ids.set(tag, r.id);
  return r.id;
}

/** รายการของเทสต์นี้เท่านั้น — องค์กรอาจมีของจริงอยู่แล้ว */
async function mine(): Promise<Awaited<ReturnType<typeof listCis>>> {
  return (await listCis(ctx)).filter((c) => c.key.endsWith(STAMP));
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  /*
    ใช้ผู้ดูแลที่มีอยู่จริง ไม่สร้างสิทธิ์ผู้ดูแลใหม่ — `ADMINISTER_TENANT`
    เคยถูกลบจนเหลือศูนย์รายการจากเทสต์ที่ย้าย grant ออกแล้วคืนไม่ครบ
    (บทเรียนใน CLAUDE.md) · การอ่านอย่างเดียวปลอดภัยกว่าการย้าย
  */
  const grant = await prismaClient.permissionGrant.findFirstOrThrow({
    where: { tenantId, permission: 'ADMINISTER_TENANT', groupId: { not: null } },
    select: { groupId: true },
  });
  const member = await prismaClient.groupMember.findFirstOrThrow({
    where: { groupId: grant.groupId ?? BigInt(0) },
    select: { userId: true },
  });
  adminId = member.userId;
  ctx = { tenantId, actorId: adminId };
}, 120_000);

afterAll(async () => {
  await step('เส้นพึ่งพาของเทสต์', () =>
    prismaClient.ciDependency.deleteMany({
      where: { dependent: { key: { contains: STAMP } } },
    }),
  );
  await step('เส้นที่ชี้เข้าของเทสต์', () =>
    prismaClient.ciDependency.deleteMany({
      where: { dependsOn: { key: { contains: STAMP } } },
    }),
  );
  /*
    ลบ **ทุกแถวที่เกิดในช่วงเทสต์** ไม่ใช่เฉพาะที่รหัสมี stamp

    เคส "รหัสว่างถูกปฏิเสธ" ไม่ควรสร้างอะไร · แต่**ตอนลบกลไกที่บังคับให้มีรหัส
    เพื่อพิสูจน์ว่าเทสต์แดงได้ มันสร้างแถวที่รหัสเป็นสตริงว่างขึ้นมาจริง**
    ซึ่งไม่มี stamp จึงรอดจากตัวกรอง แล้วค้างอยู่ในฐานข้อมูลพัฒนา
    (เกิดขึ้นแล้วหนึ่งครั้ง — บทเรียนเดียวกับช่วงห้ามเปลี่ยนแปลงที่ชื่อว่าง)
  */
  await step('เส้นผูกเรื่องของเทสต์', () =>
    prismaClient.workItemCi.deleteMany({
      where: { workItem: { itemKey: { startsWith: `SD-CI${STAMP}` } } },
    }),
  );
  await step('ประวัติของงานเทสต์', () =>
    prismaClient.workItemHistory.deleteMany({
      where: { workItem: { itemKey: { startsWith: `SD-CI${STAMP}` } } },
    }),
  );
  await step('งานของเทสต์', () =>
    prismaClient.workItem.deleteMany({ where: { itemKey: { startsWith: `SD-CI${STAMP}` } } }),
  );
  await step('รายการของเทสต์', () =>
    prismaClient.configurationItem.deleteMany({
      where: { OR: [{ key: { contains: STAMP } }, { createdAt: { gte: STARTED_AT } }] },
    }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({
      where: { action: { startsWith: 'cmdb.' }, createdAt: { gte: STARTED_AT } },
    }),
  );

  const left = await prismaClient.configurationItem.count({
    where: { OR: [{ key: { contains: STAMP } }, { createdAt: { gte: STARTED_AT } }] },
  });
  if (left > 0) console.error(`เหลือรายการของเทสต์ค้างอยู่ ${String(left)} รายการ`);
  await prismaClient.$disconnect();
});

describe('A · สร้างและแก้', () => {
  it('สร้างแล้วอ่านกลับได้ พร้อมป้ายภาษาคน', async () => {
    await ci('เว็บ');
    const rows = await mine();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kindLabel).toBe('เครื่องแม่ข่าย');
    expect(rows[0]?.statusLabel).toBe('ใช้งานอยู่');
    expect(rows[0]?.dependsOnCount).toBe(0);
  });

  it('**รหัสซ้ำถูกปฏิเสธด้วยข้อความที่อ่านรู้เรื่อง**', async () => {
    await expect(
      createCi(ctx, { key: k('เว็บ'), name: 'อีกอัน', kind: 'SERVICE' }),
    ).rejects.toThrow(DuplicateCiKeyError);
  });

  it('**รหัสหรือชื่อที่เป็นช่องว่างล้วน ถูกปฏิเสธ และไม่มีแถวถูกสร้าง**', async () => {
    /*
      ช่องว่างล้วนผ่าน `required` ของเบราว์เซอร์ไปได้ · รายการที่ชื่อเป็น
      ช่องว่างจะกลายเป็นบรรทัดว่างในทุกที่ที่เลือกมันได้ — เกิดขึ้นแล้วครั้งหนึ่ง
      กับหน้าตั้งค่าผลการแก้ไข (บทเรียนใน CLAUDE.md)
    */
    const before = (await mine()).length;
    await expect(
      createCi(ctx, { key: '   ', name: `ไม่มีรหัส ${STAMP}`, kind: 'OTHER' }),
    ).rejects.toThrow(CiKeyRequiredError);
    await expect(
      createCi(ctx, { key: k('ไม่มีชื่อ'), name: '   ', kind: 'OTHER' }),
    ).rejects.toThrow(CiKeyRequiredError);
    expect((await mine()).length).toBe(before);
  });

  it('แก้ชื่อและชนิดได้ · แก้ตัวที่ไม่มีอยู่ = `CiNotFoundError`', async () => {
    await updateCi(ctx, ids.get('เว็บ') ?? BigInt(0), {
      key: k('เว็บ'),
      name: `เว็บภายใน ${STAMP}`,
      kind: 'APPLICATION',
    });
    expect((await mine())[0]?.kindLabel).toBe('แอปพลิเคชัน');
    await expect(
      updateCi(ctx, BigInt('999999999'), { key: k('ผี'), name: 'x', kind: 'OTHER' }),
    ).rejects.toThrow(CiNotFoundError);
  });
});

describe('B · เส้นพึ่งพา', () => {
  it('ผูกได้ และนับจำนวนทั้งสองทางถูก', async () => {
    await ci('แอป');
    await ci('ฐานข้อมูล');
    // เว็บ พึ่ง แอป · แอป พึ่ง ฐานข้อมูล
    await addDependency(ctx, ids.get('เว็บ') ?? BigInt(0), ids.get('แอป') ?? BigInt(0));
    await addDependency(ctx, ids.get('แอป') ?? BigInt(0), ids.get('ฐานข้อมูล') ?? BigInt(0));

    const rows = await mine();
    const app = rows.find((r) => r.key === k('แอป'));
    expect(app?.dependsOnCount).toBe(1);
    expect(app?.usedByCount).toBe(1);
  });

  it('**ผูกกับตัวที่ไม่มีอยู่จริงไม่ได้ และไม่มีแถวถูกสร้าง**', async () => {
    /*
      รหัสที่ไม่มีอยู่มาจากการพิมพ์ผิดหรือจากตัวที่เพิ่งถูกลบ · การปล่อยให้
      สร้างเส้นชี้ไปหาตัวที่ไม่มี ทำให้กราฟผลกระทบมีปลายทางลอย ๆ ที่แสดงไม่ได้
    */
    const before = await prismaClient.ciDependency.count({
      where: { dependent: { key: { contains: STAMP } } },
    });
    await expect(
      addDependency(ctx, ids.get('เว็บ') ?? BigInt(0), BigInt('999999999')),
    ).rejects.toThrow(CiNotFoundError);
    await expect(
      addDependency(ctx, BigInt('999999999'), ids.get('เว็บ') ?? BigInt(0)),
    ).rejects.toThrow(CiNotFoundError);
    expect(
      await prismaClient.ciDependency.count({ where: { dependent: { key: { contains: STAMP } } } }),
    ).toBe(before);
  });

  it('**พึ่งพาตัวเองไม่ได้**', async () => {
    const id = ids.get('เว็บ') ?? BigInt(0);
    await expect(addDependency(ctx, id, id)).rejects.toThrow(SelfDependencyError);
  });

  it('**เส้นที่ทำให้เกิดวงจรถูกปฏิเสธตั้งแต่ตอนเขียน**', async () => {
    /*
      ฐานข้อมูล พึ่ง เว็บ จะทำให้ เว็บ→แอป→ฐานข้อมูล→เว็บ วนกลับ ·
      ผู้ดูแลต้องรู้ทันที ไม่ใช่รู้ตอนที่หน้าจอผลกระทบขึ้นธงในอีกสามเดือน
    */
    await expect(
      addDependency(ctx, ids.get('ฐานข้อมูล') ?? BigInt(0), ids.get('เว็บ') ?? BigInt(0)),
    ).rejects.toThrow(DependencyCycleError);
    // และต้องไม่มีแถวถูกสร้าง
    const rows = await mine();
    expect(rows.find((r) => r.key === k('ฐานข้อมูล'))?.dependsOnCount).toBe(0);
  });

  it('ถอดเส้นได้ · ถอดเส้นที่ไม่มี = `CiNotFoundError`', async () => {
    await addDependency(ctx, ids.get('เว็บ') ?? BigInt(0), ids.get('ฐานข้อมูล') ?? BigInt(0));
    await removeDependency(ctx, ids.get('เว็บ') ?? BigInt(0), ids.get('ฐานข้อมูล') ?? BigInt(0));
    await expect(
      removeDependency(ctx, ids.get('เว็บ') ?? BigInt(0), ids.get('ฐานข้อมูล') ?? BigInt(0)),
    ).rejects.toThrow(CiNotFoundError);
  });
});

describe('C · ผลกระทบ', () => {
  it('**คืนชื่อจริง เรียงจากใกล้ไปไกล**', async () => {
    const r = await impactOfCi(ctx, ids.get('ฐานข้อมูล') ?? BigInt(0));
    expect(r.root.key).toBe(k('ฐานข้อมูล'));
    expect(r.affected.map((a) => a.key)).toEqual([k('แอป'), k('เว็บ')]);
    expect(r.affected.map((a) => a.distance)).toEqual([1, 2]);
    expect(r.hasCycle).toBe(false);
    expect(r.truncated).toBe(0);
  });

  it('ตัวที่ไม่มีใครพึ่ง = ไม่มีอะไรพังตาม', async () => {
    const r = await impactOfCi(ctx, ids.get('เว็บ') ?? BigInt(0));
    expect(r.affected).toEqual([]);
  });

  it('ตัวที่ไม่มีอยู่ = `CiNotFoundError` ไม่ใช่ผลลัพธ์ว่าง', async () => {
    await expect(impactOfCi(ctx, BigInt('999999999'))).rejects.toThrow(CiNotFoundError);
  });
});

describe('D · ลบ', () => {
  it('**ลบแล้วเส้นที่ชี้เข้าและออกหายตาม และจำนวนอยู่ใน audit**', async () => {
    const appId = ids.get('แอป') ?? BigInt(0);
    const before = await prismaClient.ciDependency.count({
      where: { OR: [{ dependentId: appId }, { dependsOnId: appId }] },
    });
    expect(before).toBe(2);

    await deleteCi(ctx, appId);
    const after = await prismaClient.ciDependency.count({
      where: { OR: [{ dependentId: appId }, { dependsOnId: appId }] },
    });
    expect(after).toBe(0);

    const entry = await prismaClient.auditLog.findFirst({
      where: { action: 'cmdb.ci.delete', entityId: appId.toString() },
      orderBy: { id: 'desc' },
      select: { payload: true },
    });
    expect((entry?.payload as { removedEdges?: number } | null)?.removedEdges).toBe(2);
  });

  it('ลบตัวที่ไม่มีอยู่ = `CiNotFoundError`', async () => {
    await expect(deleteCi(ctx, BigInt('999999999'))).rejects.toThrow(CiNotFoundError);
  });
});

describe('E · ผูกเรื่องกับสิ่งที่ดูแล', () => {
  let itemKey = '';
  let downstreamKey = '';

  beforeAll(async () => {
    const project = await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } });
    const template = await prismaClient.workItem.findFirstOrThrow({
      where: { projectId: project.id },
      select: { issueTypeId: true },
    });
    const todo = await prismaClient.workflowStatus.findFirstOrThrow({
      where: { category: 'TODO', workflow: { schemes: { some: { tenantId } } } },
      select: { id: true },
    });
    const mk = async (tag: string): Promise<string> => {
      const w = await prismaClient.workItem.create({
        data: {
          tenantId,
          projectId: project.id,
          itemKey: `SD-CI${STAMP}${tag}`,
          issueTypeId: template.issueTypeId,
          statusId: todo.id,
          reporterId: adminId,
          summary: `[CMDB] ${tag} ${STAMP}`,
          rank: `zzm${STAMP}${tag}`,
        },
        select: { itemKey: true },
      });
      return w.itemKey;
    };
    itemKey = await mk('A');
    downstreamKey = await mk('B');

    /*
      สร้างเส้น เว็บ → ฐานข้อมูล ขึ้นใหม่ที่นี่ **ไม่พึ่งเส้นจากหมวด B**

      หมวด D ลบ "แอป" ทิ้ง ซึ่ง cascade เอาเส้นทั้งสองที่ผ่านมันไปด้วย ·
      เทสต์ที่พึ่งสถานะที่หมวดก่อนหน้าทิ้งไว้ จะแดงด้วยเหตุผลที่ไม่เกี่ยวกับ
      สิ่งที่มันวัด ในวันที่มีคนสลับลำดับหมวด
    */
    await addDependency(ctx, ids.get('เว็บ') ?? BigInt(0), ids.get('ฐานข้อมูล') ?? BigInt(0));
  });

  it('ผูกแล้วอ่านกลับได้ · ผูกซ้ำถูกปฏิเสธ', async () => {
    await attachCi(ctx, itemKey, ids.get('เว็บ') ?? BigInt(0));
    const rows = await cisOfItem(ctx, itemKey);
    expect(rows.map((r) => r.key)).toEqual([k('เว็บ')]);
    await expect(attachCi(ctx, itemKey, ids.get('เว็บ') ?? BigInt(0))).rejects.toThrow(
      AlreadyAttachedError,
    );
  });

  it('**การผูกถูกบันทึกในไทม์ไลน์ของเรื่อง ไม่ใช่ audit ระดับระบบ**', async () => {
    /*
      คนอ่านไทม์ไลน์ของตั๋วต้องเห็นว่าใครผูกเครื่องไหนเข้ามาเมื่อไร ·
      ร่องรอยที่อยู่คนละที่กับเรื่อง ไม่มีใครไปเปิดดู
    */
    const rows = await prismaClient.workItemHistory.findMany({
      where: { workItem: { itemKey }, field: 'configItem' },
      select: { oldValue: true, newValue: true },
    });
    expect(rows.some((r) => r.newValue === k('เว็บ'))).toBe(true);
  });

  it('ถอดออกได้ · ถอดตัวที่ไม่ได้ผูก = `CiNotFoundError`', async () => {
    await attachCi(ctx, itemKey, ids.get('ฐานข้อมูล') ?? BigInt(0));
    await detachCi(ctx, itemKey, ids.get('ฐานข้อมูล') ?? BigInt(0));
    expect((await cisOfItem(ctx, itemKey)).map((r) => r.key)).toEqual([k('เว็บ')]);
    await expect(detachCi(ctx, itemKey, ids.get('ฐานข้อมูล') ?? BigInt(0))).rejects.toThrow(
      CiNotFoundError,
    );
  });

  it('**เรื่องของระบบปลายทางถูกนับเป็นผลกระทบด้วย**', async () => {
    /*
      นี่คือคำตอบที่ ITIL เรียกว่า impact analysis · ไม่ใช่ "เครื่องนี้มีเรื่องกี่ใบ"
      แต่คือ "เหตุการณ์นี้กระทบเรื่องที่ค้างอยู่ทั้งหมดกี่ใบ" ซึ่งรวมเรื่องของ
      ระบบปลายทางที่คนแจ้งไม่รู้ด้วยซ้ำว่าต้นเหตุอยู่ที่ไหน

      เว็บ พึ่ง ฐานข้อมูล (ผูกไว้ในหมวด B) · เรื่อง A อยู่บนเว็บ
      ถามผลกระทบของฐานข้อมูล ต้องเห็นเรื่อง A ด้วย
    */
    await attachCi(ctx, downstreamKey, ids.get('ฐานข้อมูล') ?? BigInt(0));
    const r = await openItemsInImpact(ctx, ids.get('ฐานข้อมูล') ?? BigInt(0));
    const keys = r.items.map((i) => i.itemKey);
    expect(keys).toContain(downstreamKey);
    expect(keys).toContain(itemKey);
    // เรื่องที่อยู่บนตัวต้นเหตุเองมาก่อน แล้วค่อยไล่ออกไป
    expect(r.items[0]?.distance).toBe(0);
    expect(r.items.find((i) => i.itemKey === itemKey)?.viaCiKey).toBe(k('เว็บ'));
  });

  it('**คนที่แก้เรื่องนั้นไม่ได้ ผูกสิ่งที่ดูแลเข้าไปไม่ได้**', async () => {
    /*
      การผูกใช้สิทธิ์ **แก้เรื่องนั้น** ไม่ใช่สิทธิ์ผู้ดูแล — คนที่ทำงานกับตั๋ว
      ต้องบอกได้ว่าเรื่องนี้กระทบเครื่องไหน มิฉะนั้นข้อมูลจะไม่มีวันถูกกรอก ·
      แต่คนที่แตะเรื่องนั้นไม่ได้เลย ก็ต้องผูกไม่ได้เช่นกัน
    */
    const outsider = await prismaClient.user.create({
      data: { tenantId, email: `cmdb-ผูก-${STAMP}@example.test`, displayName: `คนนอกผูก ${STAMP}` },
      select: { id: true },
    });
    try {
      const before = await prismaClient.workItemCi.count({
        where: { workItem: { itemKey } },
      });
      await expect(
        attachCi({ tenantId, actorId: outsider.id }, itemKey, ids.get('ฐานข้อมูล') ?? BigInt(0)),
      ).rejects.toThrow();
      // ไม่มีแถวถูกสร้างจากคำสั่งที่ถูกปฏิเสธ
      expect(await prismaClient.workItemCi.count({ where: { workItem: { itemKey } } })).toBe(before);
    } finally {
      await prismaClient.user.deleteMany({ where: { id: outsider.id } });
    }
  });

  it('**เรื่องที่ปิดแล้วไม่นับเป็นผลกระทบ**', async () => {
    // ผลกระทบคือสิ่งที่ต้องจัดการตอนนี้ · เรื่องที่จบแล้วไม่ใช่
    const done = await prismaClient.workflowStatus.findFirstOrThrow({
      where: { category: 'DONE', workflow: { schemes: { some: { tenantId } } } },
      select: { id: true },
    });
    await prismaClient.workItem.updateMany({
      where: { itemKey: downstreamKey },
      data: { statusId: done.id },
    });
    const r = await openItemsInImpact(ctx, ids.get('ฐานข้อมูล') ?? BigInt(0));
    expect(r.items.map((i) => i.itemKey)).not.toContain(downstreamKey);
    expect(r.items.map((i) => i.itemKey)).toContain(itemKey);
  });
});

describe('F · สิทธิ์', () => {
  it('**คนที่ไม่ใช่ผู้ดูแลแก้ไม่ได้ แต่ยังอ่านได้**', async () => {
    /*
      สร้างผู้ใช้ของตัวเองแล้วลบทิ้ง — ไม่ย้ายสมาชิกออกจากกลุ่มของ seed
      ซึ่งเคยทำให้ agent1/agent2 หลุดจาก IT Support ค้างไว้จริง
    */
    const outsider = await prismaClient.user.create({
      data: { tenantId, email: `cmdb-นอก-${STAMP}@example.test`, displayName: `คนนอก ${STAMP}` },
      select: { id: true },
    });
    try {
      const asOutsider: TenantContext = { tenantId, actorId: outsider.id };
      await expect(
        createCi(asOutsider, { key: k('ห้าม'), name: 'ไม่ควรถูกสร้าง', kind: 'OTHER' }),
      ).rejects.toThrow();
      // ไม่มีแถวถูกสร้างจากคำสั่งที่ถูกปฏิเสธ
      expect((await mine()).some((c) => c.key === k('ห้าม'))).toBe(false);
      // การอ่านยังทำได้ — ผลกระทบเป็นข้อมูลที่ทีมต้องเห็นตอนเกิดเหตุ
      expect((await listCis(asOutsider)).length).toBeGreaterThanOrEqual(0);
    } finally {
      await prismaClient.user.deleteMany({ where: { id: outsider.id } });
    }
  });
});
