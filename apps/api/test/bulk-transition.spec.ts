/**
 * เปลี่ยนสถานะหลายเรื่องพร้อมกัน — เทสต์เป็นข้อกำหนด เขียนก่อนโค้ด
 *
 * `bulkEditWorkItems` ครอบแค่ผู้รับผิดชอบกับระดับความสำคัญ ซึ่งเป็นค่าที่เขียน
 * ทับได้ตรง ๆ · **สถานะไม่ใช่ค่าแบบนั้น** มันเป็นผลของ state machine ที่มี
 * เงื่อนไข ตัวตรวจ และ post function อยู่ข้างหลัง การเขียน `statusId` ทับ
 * เป็นชุดคือการเดินอ้อมทุกอย่างที่ workflow มีไว้ปฏิเสธ
 *
 * ห้าข้อที่ต้องถูกตั้งแต่แรก เพราะแก้ทีหลังไม่ทัน:
 *
 *   1. **เลือกด้วยชื่อปุ่ม ไม่ใช่ id** — ชุดหนึ่งข้ามโปรเจกต์และประเภทงานได้
 *      "ปิดงาน" ของ Incident กับของ Service Request เป็นคนละแถวใน
 *      `workflow_transition` · id เดียวใช้ทั้งชุดไม่ได้ตั้งแต่ต้น
 *   2. **ตัวตรวจต้องทำงานทุกใบ** — ถ้า bulk เดินอ้อม validator ได้ กฎทั้งหมด
 *      ที่ workflow มีก็เป็นเพียงคำแนะนำ และจะพังในวันที่มีคนกดปุ่มนี้
 *   3. **ใบที่กดไม่ได้ ต้องบอกว่าทำไม** — เลือก 20 ใบแล้วขยับ 17 ใบ ต้องรู้ว่า
 *      อีก 3 ใบไหนและเพราะอะไร · การรายงานแค่ "สำเร็จ 17" คือการบอกให้ผู้ใช้
 *      ไปไล่หาเอง ทั้งที่ระบบรู้คำตอบอยู่แล้ว
 *   4. **หน้าจอต้องเสนอเฉพาะปุ่มที่มีใบทำได้จริง** — ปุ่มที่กดแล้วล้มทุกใบ
 *      คือปุ่มที่ไม่ควรมี · `bulkTransitionOptions` ตอบจากของจริงรายใบ
 *   5. **ล้มทีละใบ ไม่ล้มทั้งรอบ** — กติกาเดียวกับ `bulkEditWorkItems`
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  BULK_MAX,
  BulkTooManyItemsError,
  NothingSelectedError,
  bulkTransitionOptions,
  bulkTransitionWorkItems,
} from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
/** มี TRANSITION_ITEM + BULK_EDIT */
let staff: TenantContext;
/** เปลี่ยนสถานะทีละใบได้ แต่ไม่มี BULK_EDIT */
let single: TenantContext;
/**
 * แก้เป็นชุดได้ แต่ไม่มี TRANSITION_ITEM
 *
 * มีไว้เพราะถ้าไม่มี การตรวจ `TRANSITION_ITEM` จะเป็นบรรทัดที่ลบทิ้งแล้ว
 * เทสต์ยังเขียวทุกเคส — คือบรรทัดที่ไม่มีเทสต์คุ้ม (CLAUDE.md §4)
 */
let noTransition: TenantContext;
let staffId: bigint | undefined;
let singleId: bigint | undefined;
let noTransitionId: bigint | undefined;
let staffGroupId: bigint | undefined;
let singleGroupId: bigint | undefined;
let noTransitionGroupId: bigint | undefined;
let projectId: bigint;
let schemeId: bigint;

/** งานที่เทสต์สร้างเอง — ไม่แตะงานของ seed แม้แต่ใบเดียว */
const keys: string[] = [];
/** ใบที่ถูกดันไปอยู่สถานะปลายทางแล้ว จึงไม่มีปุ่มเดียวกันให้กดอีก */
let doneKey: string | undefined;

/**
 * งานจริงในโปรเจกต์ที่ `staff` เปิดดูไม่ได้
 *
 * ต้องเป็นใบที่ **มีอยู่จริง** ไม่ใช่คีย์ที่แต่งขึ้น — คีย์ที่ไม่มีอยู่จริง
 * ได้ผลเป็น not-found อยู่แล้วแม้ตัวกรองขอบเขตจะถูกลบทิ้ง เทสต์จึงเขียวทั้งที่
 * กลไกหายไป (พิสูจน์แล้วในรอบลบทีละบรรทัด: guard นี้เขียวสนิททั้ง 16 เคส)
 */
let hiddenKey: string | undefined;
let hiddenBefore: {
  statusId: bigint;
  assigneeId: bigint | null;
  resolutionId: number | null;
  resolvedAt: Date | null;
} | null = null;

let initialStatusName: string;
let nextTransitionName: string;

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  const project = await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } });
  projectId = project.id;
  schemeId = project.permissionSchemeId ?? 0n;

  const mkGroup = async (n: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `bulk-tr-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  staffGroupId = await mkGroup('staff');
  singleGroupId = await mkGroup('single');
  noTransitionGroupId = await mkGroup('notr');

  const mkUser = async (n: string, groupId: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `bulktr-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  staffId = await mkUser('staff', staffGroupId);
  singleId = await mkUser('single', singleGroupId);
  noTransitionId = await mkUser('notr', noTransitionGroupId);

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId, permission: 'BROWSE_PROJECT', groupId: staffGroupId },
      { tenantId, schemeId, permission: 'TRANSITION_ITEM', groupId: staffGroupId },
      { tenantId, schemeId, permission: 'BULK_EDIT', groupId: staffGroupId },
      // เปลี่ยนสถานะทีละใบได้ แต่ทำเป็นชุดไม่ได้
      { tenantId, schemeId, permission: 'BROWSE_PROJECT', groupId: singleGroupId },
      { tenantId, schemeId, permission: 'TRANSITION_ITEM', groupId: singleGroupId },
      // แก้เป็นชุดได้ แต่ไม่มีสิทธิ์เปลี่ยนสถานะ
      { tenantId, schemeId, permission: 'BROWSE_PROJECT', groupId: noTransitionGroupId },
      { tenantId, schemeId, permission: 'BULK_EDIT', groupId: noTransitionGroupId },
    ],
  });

  staff = { tenantId, actorId: staffId };
  single = { tenantId, actorId: singleId };
  noTransition = { tenantId, actorId: noTransitionId };

  /*
    ตั้งงานทดสอบที่สถานะเริ่มต้นของ workflow ที่โปรเจกต์นี้ใช้จริง
    ไม่ประกอบสถานะขึ้นมาเอง — เทสต์ที่ประกอบข้อมูลนำเข้าเองพิสูจน์ได้แค่ว่า
    *ถ้า* ข้อมูลหน้าตาแบบนั้นเข้ามา ผลจะถูก (บทเรียนหมวด F ของ SLA Engine)
  */
  const template = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId },
    select: { issueTypeId: true },
  });
  const scheme = await prismaClient.workflowScheme.findFirstOrThrow({
    where: { projectId, issueTypeId: template.issueTypeId },
    select: { workflowId: true },
  });
  const initial = await prismaClient.workflowStatus.findFirstOrThrow({
    where: { workflowId: scheme.workflowId, isInitial: true },
    select: { id: true, name: true },
  });
  initialStatusName = initial.name;

  const outgoing = await prismaClient.workflowTransition.findMany({
    where: { workflowId: scheme.workflowId, fromStatusId: initial.id },
    include: { rules: true },
    orderBy: { position: 'asc' },
  });
  /*
    ปุ่มที่กดได้จากสถานะเริ่มต้นโดยไม่ต้องกรอกอะไร — ถ้าเลือกปุ่มที่มี
    `required-fields` มาเป็นตัวหลัก เทสต์จะแดงด้วยเหตุผลที่ไม่เกี่ยวกับสิ่งที่วัด
  */
  const plain = outgoing.find(
    (t) => !t.rules.some((r) => r.ruleType === 'required-fields' || r.ruleType === 'in-group'),
  );
  if (plain === undefined) throw new Error('workflow ของ SD ไม่มี transition ที่กดได้เปล่า ๆ');
  nextTransitionName = plain.name;

  for (let i = 0; i < 4; i += 1) {
    const w = await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey: `SD-BTR${STAMP}${String(i)}`,
        issueTypeId: template.issueTypeId,
        statusId: initial.id,
        reporterId: staffId,
        summary: `งานทดสอบเปลี่ยนสถานะเป็นชุด ${STAMP} ลำดับ ${String(i)}`,
        rank: `zzy${STAMP}${String(i)}`,
      },
      select: { itemKey: true },
    });
    keys.push(w.itemKey);
  }
  doneKey = keys[3];

  const hidden = await prismaClient.project.findFirstOrThrow({ where: { key: 'PLAT' } });
  const hiddenItem = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId: hidden.id },
    select: {
      itemKey: true,
      statusId: true,
      assigneeId: true,
      resolutionId: true,
      resolvedAt: true,
    },
  });
  hiddenKey = hiddenItem.itemKey;
  hiddenBefore = {
    statusId: hiddenItem.statusId,
    assigneeId: hiddenItem.assigneeId,
    resolutionId: hiddenItem.resolutionId,
    resolvedAt: hiddenItem.resolvedAt,
  };
}, 180_000);

afterAll(async () => {
  /*
    คืนงานของ PLAT ให้เหมือนเดิม **ก่อนอย่างอื่น**

    ตอนตัวกรองขอบเขตถูกลบออกเพื่อพิสูจน์ว่าเทสต์แดงได้ ใบนี้จะถูกขยับจริง
    · การลบประวัติอย่างเดียวไม่พอ เพราะค่าที่เปลี่ยนไปค้างอยู่บนงานของ seed
    ที่หน้าจอจริงอ่านอยู่ทุกวัน และการนับแถวจับการแก้ค่าไม่ได้ (CLAUDE.md §9)
  */
  const wasHidden = hiddenBefore;
  if (hiddenKey !== undefined && wasHidden !== null) {
    await step('คืนงานของ PLAT', () =>
      prismaClient.workItem.updateMany({
        where: { itemKey: hiddenKey },
        data: {
          statusId: wasHidden.statusId,
          assigneeId: wasHidden.assigneeId,
          resolutionId: wasHidden.resolutionId,
          resolvedAt: wasHidden.resolvedAt,
        },
      }),
    );
  }
  const owners = [staffId, singleId, noTransitionId].filter((v): v is bigint => v !== undefined);
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { actorId: { in: owners } } }),
  );
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actorId: { in: owners } } }));
  await step('แจ้งเตือน', () =>
    prismaClient.notification.deleteMany({ where: { userId: { in: owners } } }),
  );
  /*
    เหตุการณ์ก่อนนาฬิกา — `SlaEvent` เป็น Cascade ของ `WorkItemSla` ก็จริง
    แต่ลำดับที่เขียนเองอ่านแล้วรู้ว่าอะไรขึ้นกับอะไร และไม่ต้องหวังว่า
    ลำดับ cascade ของ MySQL จะเป็นอย่างที่คิด (บทเรียนของ seed.ts)
  */
  await step('เหตุการณ์ SLA', () =>
    prismaClient.slaEvent.deleteMany({
      where: { sla: { workItem: { itemKey: { in: keys } } } },
    }),
  );
  await step('นาฬิกา SLA', () =>
    prismaClient.workItemSla.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('งานทดสอบ', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({
      where: {
        groupId: {
          in: [staffGroupId, singleGroupId, noTransitionGroupId].filter((v) => v !== undefined),
        },
      },
    }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { userId: { in: owners } } }),
  );
  await step('ผู้ใช้', () => prismaClient.user.deleteMany({ where: { id: { in: owners } } }));
  await step('กลุ่ม', () =>
    prismaClient.userGroup.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await prismaClient.$disconnect();
});

describe('A · สิทธิ์', () => {
  it('**ไม่มี BULK_EDIT = ทำไม่ได้ แม้เปลี่ยนสถานะทีละใบได้**', async () => {
    /*
      `single` มี TRANSITION_ITEM จึงกดปุ่มทีละใบได้อยู่แล้ว · ถ้า bulk ตรวจแค่
      TRANSITION_ITEM คีย์ BULK_EDIT จะไม่มีผลกับเส้นทางนี้ และหน้าตั้งค่า
      จะโกหกอีกครั้งในแบบเดิม
    */
    await expect(
      bulkTransitionWorkItems(single, keys.slice(0, 2), { transitionName: nextTransitionName }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('**ไม่มี TRANSITION_ITEM = ทำไม่ได้ แม้จะแก้เป็นชุดได้**', async () => {
    /*
      สองสิทธิ์นี้ตอบคนละคำถาม: BULK_EDIT คือ "ทำทีละหลายใบได้ไหม"
      TRANSITION_ITEM คือ "ขยับสถานะได้ไหม" · ถ้าตรวจแค่ตัวแรก คนที่ได้สิทธิ์
      แก้ผู้รับผิดชอบเป็นชุด จะปิดงานทั้งคิวได้ด้วยโดยไม่มีใครตั้งใจให้
    */
    await expect(
      bulkTransitionWorkItems(noTransition, keys.slice(0, 2), {
        transitionName: nextTransitionName,
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('ปฏิเสธแล้วต้องไม่มีใบไหนขยับ — ไม่ใช่ขยับไปครึ่งชุด', async () => {
    const rows = await prismaClient.workItem.findMany({
      where: { itemKey: { in: keys.slice(0, 2) } },
      select: { status: { select: { name: true } } },
    });
    for (const r of rows) expect(r.status.name).toBe(initialStatusName);
  });
});

describe('B · คำขอที่ผิดทั้งชุด', () => {
  it('ไม่ได้เลือกงาน หรือไม่ได้เลือกปุ่ม = ปฏิเสธก่อนแตะใบไหน', async () => {
    await expect(
      bulkTransitionWorkItems(staff, [], { transitionName: nextTransitionName }),
    ).rejects.toThrow(NothingSelectedError);
    await expect(
      bulkTransitionWorkItems(staff, keys.slice(0, 1), { transitionName: '   ' }),
    ).rejects.toThrow(NothingSelectedError);
  });

  it('เกินเพดานปฏิเสธทั้งชุด ไม่ตัดเงียบ ๆ', async () => {
    /*
      คีย์ที่ประกอบเองต้องไม่มีทางชนกับของจริง — ครั้งหนึ่งเคยใช้ `SD-1`…`SD-50`
      แล้วตอนลบกลไกเพดานออกเพื่อพิสูจน์ว่าเทสต์แดงได้ คำสั่งทำงานจนจบ
      และเปลี่ยนงานจริง 43 ใบค้างไว้ในฐานข้อมูลพัฒนา (CLAUDE.md §8)
    */
    const many = Array.from({ length: BULK_MAX + 1 }, (_, i) => `SD-BTRX${STAMP}${String(i)}`);
    await expect(
      bulkTransitionWorkItems(staff, many, { transitionName: nextTransitionName }),
    ).rejects.toThrow(BulkTooManyItemsError);
  });
});

describe('C · ปุ่มที่หน้าจอควรเสนอ', () => {
  it('**ตอบจากของจริงรายใบ — พร้อมจำนวนใบที่กดได้**', async () => {
    /*
      ปุ่มที่กดแล้วล้มทุกใบคือปุ่มที่ไม่ควรมีบนหน้าจอ · และจำนวนต้องมาก่อนกด
      ไม่ใช่รู้ตอนอ่านผล เพราะการกดปุ่มที่ขยับได้ใบเดียวจาก 20 ใบ
      คือการเสียเวลาที่ระบบรู้ล่วงหน้าอยู่แล้ว
    */
    const opts = await bulkTransitionOptions(staff, keys.slice(0, 3));
    const target = opts.find((o) => o.name === nextTransitionName);
    expect(target?.eligible).toBe(3);
    expect(opts.every((o) => o.eligible > 0)).toBe(true);
  });

  it('บอกว่าปุ่มไหนต้องกรอกอะไรก่อน', async () => {
    const opts = await bulkTransitionOptions(staff, keys.slice(0, 3));
    for (const o of opts) expect(Array.isArray(o.requiredFields)).toBe(true);
  });

  it('ไม่มีสิทธิ์ = ไม่เห็นปุ่มไหนเลย ไม่ใช่เห็นแล้วกดไม่ได้', async () => {
    await expect(bulkTransitionOptions(single, keys.slice(0, 2))).rejects.toThrow(
      PermissionDeniedError,
    );
  });
});

describe('D · เปลี่ยนสถานะจริง', () => {
  it('**ขยับได้ทั้งชุด และประวัติบันทึกว่าผ่านปุ่มไหน**', async () => {
    const res = await bulkTransitionWorkItems(staff, keys.slice(0, 3), {
      transitionName: nextTransitionName,
    });
    expect(res.changed).toBe(3);
    expect(res.items.every((i) => i.outcome === 'changed')).toBe(true);
    expect(res.items[0]?.from).toBe(initialStatusName);

    /*
      INVARIANT 2 — ทุก mutation เขียนประวัติ · และต้องตอบได้ว่า "ผ่านปุ่มไหน"
      ไม่ใช่แค่ "สถานะเปลี่ยนจากอะไรเป็นอะไร" เพราะสองปุ่มไปสถานะเดียวกันได้
    */
    const trail = await prismaClient.workItemHistory.count({
      where: { workItem: { itemKey: { in: keys.slice(0, 3) } }, field: '__transition__' },
    });
    expect(trail).toBe(3);
  });

  it('**ใบที่ไม่มีปุ่มนั้นจากสถานะปัจจุบัน ต้องบอกว่าทำไม**', async () => {
    /*
      สามใบแรกขยับไปแล้ว ปุ่มเดิมจึงไม่มีให้กดอีก · ผลต้องเป็น failed
      พร้อมเหตุผลที่อ่านแล้วรู้ว่าต้องทำอะไรต่อ ไม่ใช่หายไปเฉย ๆ จากรายงาน
    */
    const res = await bulkTransitionWorkItems(staff, keys.slice(0, 3), {
      transitionName: nextTransitionName,
    });
    expect(res.changed).toBe(0);
    expect(res.failed).toBe(3);
    expect(res.items[0]?.reason ?? '').not.toBe('');
  });

  it('**ใบที่เปิดดูไม่ได้ ตอบเหมือนใบที่ไม่มีอยู่จริง**', async () => {
    /*
      `staff` ไม่มี BROWSE_PROJECT ของ PLAT · ถ้าตอบ "ไม่มีสิทธิ์" กับใบที่มีอยู่จริง
      และ "ไม่พบ" กับใบที่ไม่มี ผู้ใช้จะไล่เดาเลขที่เรื่องเพื่อดูว่าใบไหนมีอยู่ได้

      ใบจริงของ PLAT ต้องอยู่ในเคสนี้ ไม่ใช่แค่คีย์ที่แต่งขึ้น — คีย์ที่แต่งขึ้น
      ได้ not-found อยู่แล้วแม้ตัวกรองขอบเขตจะหายไป
    */
    const res = await bulkTransitionWorkItems(
      staff,
      [hiddenKey as string, `SD-ไม่มีจริง-${STAMP}`],
      { transitionName: nextTransitionName },
    );
    expect(res.items.map((i) => i.outcome)).toEqual(['not-found', 'not-found']);

    const untouched = await prismaClient.workItem.findFirstOrThrow({
      where: { itemKey: hiddenKey },
      select: { statusId: true },
    });
    expect(untouched.statusId).toBe(hiddenBefore?.statusId);
  });

  it('ใบที่กดได้ปนกับใบที่กดไม่ได้ — ใบที่กดได้ต้องขยับ', async () => {
    // doneKey ยังอยู่สถานะเริ่มต้น ส่วนสามใบแรกขยับไปแล้ว
    const mixed = [...keys.slice(0, 2), doneKey as string];
    const res = await bulkTransitionWorkItems(staff, mixed, {
      transitionName: nextTransitionName,
    });
    expect(res.changed).toBe(1);
    expect(res.failed).toBe(2);
    const moved = await prismaClient.workItem.findFirstOrThrow({
      where: { itemKey: doneKey },
      select: { status: { select: { name: true } } },
    });
    expect(moved.status.name).not.toBe(initialStatusName);
  });
});
describe('E · เงื่อนไขและตัวตรวจของ workflow ต้องทำงานทุกใบ', () => {
  /*
    หมวดนี้เคยเขียนไว้แบบ `if (... === undefined) return;` แล้ว **เขียวทั้งหมด
    โดยไม่ได้ตรวจอะไรเลย** — เพราะจากสถานะเริ่มต้น (New) ปุ่มเดียวที่มีคือ
    "เริ่มตรวจสอบ" ซึ่งไม่มีกฎสักข้อ · เงื่อนไขและตัวตรวจอยู่บนปุ่มถัดไป
    ซึ่งเทสต์ไปไม่ถึง (CLAUDE.md — เทสต์ที่ตรวจไม่ได้ต้องแดงหรือ skip ห้ามเขียว)

    เขียนใหม่ให้เดินไปยืนที่สถานะที่มีกฎจริงก่อน แล้วค่อยวัด · และประกาศ
    ข้อสมมติเป็น assertion ไม่ใช่ `return` เงียบ ๆ ถ้า workflow ของ seed
    เปลี่ยนจนไปไม่ถึง เทสต์ต้องแดงให้เห็น ไม่ใช่หายไปจากรายงาน
  */
  let gated: string;
  let gatedFields: string[] = [];

  beforeAll(async () => {
    // ทั้งสี่ใบยืนอยู่ที่สถานะถัดจากเริ่มต้นแล้วหลังหมวด D
    const opts = await bulkTransitionOptions(staff, keys.slice(0, 2));
    const withRule = opts.find((o) => o.requiredFields.length > 0);
    /*
      ยังไม่มีปุ่มที่ขอฟิลด์ เพราะ `assignee-is-current-user` ปิดไว้อยู่ —
      ซึ่งเป็นสิ่งที่หมวดนี้จะพิสูจน์เป็นข้อแรก
    */
    expect(withRule).toBeUndefined();

    await prismaClient.workItem.updateMany({
      where: { itemKey: { in: keys.slice(0, 2) } },
      data: { assigneeId: staffId },
    });
    const after = await bulkTransitionOptions(staff, keys.slice(0, 2));
    const found = after.find((o) => o.requiredFields.includes('resolution'));
    if (found === undefined) {
      throw new Error(
        `workflow ของ SD ไม่มีปุ่มที่ขอ resolution จากสถานะนี้ — ปุ่มที่มี: ${after
          .map((o) => o.name)
          .join(' · ')}`,
      );
    }
    gated = found.name;
    gatedFields = found.requiredFields;
  }, 60_000);

  it('**เงื่อนไขทำงาน — ปุ่มโผล่หลังเป็นผู้รับผิดชอบเท่านั้น**', () => {
    /*
      `assignee-is-current-user` เป็น CONDITION ซึ่งซ่อนปุ่ม ไม่ใช่ปฏิเสธตอนกด
      `beforeAll` ข้างบนพิสูจน์ทั้งสองฝั่ง: ก่อนมอบหมายไม่มีปุ่มที่ขอฟิลด์เลย
      หลังมอบหมายจึงมี · ถ้า bulk อ่านปุ่มจากตารางตรง ๆ แทนที่จะถาม engine
      ปุ่มนี้จะโผล่ให้ทุกคนตั้งแต่แรก
    */
    expect(gated).not.toBe('');
    expect(gatedFields).toContain('resolution');
  });

  it('**ตัวตรวจทำงาน — ไม่กรอกผลการแก้ไข ต้องไม่ปิดงาน**', async () => {
    /*
      เคสสำคัญที่สุดของไฟล์นี้ · ถ้า bulk เดินอ้อม validator ได้ งานจะถูกปิด
      โดยไม่มีผลการแก้ไข ซึ่งทำให้ตัวกรอง "งานที่ยังไม่จบ" ตกงานใบนั้นไปเงียบ ๆ
      และรายงานทุกใบอ่านต่อไม่ได้ — ไม่มี error ให้เห็นสักบรรทัด
    */
    const res = await bulkTransitionWorkItems(staff, keys.slice(0, 2), { transitionName: gated });
    expect(res.changed).toBe(0);
    expect(res.failed).toBe(2);

    const rows = await prismaClient.workItem.findMany({
      where: { itemKey: { in: keys.slice(0, 2) } },
      select: { resolutionId: true, resolvedAt: true, status: { select: { category: true } } },
    });
    for (const r of rows) {
      expect(r.resolutionId).toBeNull();
      expect(r.resolvedAt).toBeNull();
      expect(r.status.category).not.toBe('DONE');
    }
  });

  it('ผลการแก้ไขที่ระบบไม่รู้จัก ปฏิเสธทั้งชุดก่อนแตะใบไหน', async () => {
    /*
      ค่าที่กรอกผิดเป็นความผิดของ **คำขอ** ไม่ใช่ของงานใบใดใบหนึ่ง
      ถ้าปล่อยให้โยนรายใบ ใบที่ไม่ต้องใช้ค่านี้จะขยับไปก่อน แล้วผู้ใช้ได้ผล
      ปนกันที่อ่านไม่ออกว่าตกลงค่าที่กรอกผิดหรืองานมีปัญหา
    */
    await expect(
      bulkTransitionWorkItems(staff, keys.slice(0, 2), {
        transitionName: gated,
        resolutionName: `ไม่มีผลแบบนี้ ${STAMP}`,
      }),
    ).rejects.toThrow(NothingSelectedError);
  });

  it('**กรอกครบแล้วผ่าน — และ post function ทำงานครบเหมือนกดทีละใบ**', async () => {
    /*
      ไม่ได้วัดแค่ว่าสถานะเปลี่ยน · `stop-sla` ต้องตั้ง `resolvedAt` ซึ่งเป็นฐาน
      ของ MTTR ทุกรายงาน · การเขียน `statusId` ทับเป็นชุดจะได้สถานะที่ถูก
      แต่ `resolvedAt` ว่าง และไม่มีอะไรบอกว่าผิด จนกว่าจะมีคนเปิดรายงาน
    */
    const res = await bulkTransitionWorkItems(staff, keys.slice(0, 2), {
      transitionName: gated,
      resolutionName: 'แก้ไขเรียบร้อย',
    });
    expect(res.changed).toBe(2);
    expect(res.items[0]?.to).not.toBe(res.items[0]?.from);

    const rows = await prismaClient.workItem.findMany({
      where: { itemKey: { in: keys.slice(0, 2) } },
      select: {
        resolvedAt: true,
        resolution: { select: { name: true } },
        status: { select: { category: true } },
      },
    });
    for (const r of rows) {
      expect(r.status.category).toBe('DONE');
      expect(r.resolution?.name).toBe('แก้ไขเรียบร้อย');
      expect(r.resolvedAt).not.toBeNull();
    }
  });
});
