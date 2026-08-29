/**
 * กฎอัตโนมัติ — พิสูจน์ว่าสายต่อถึงจริง
 *
 * `automation-engine.spec.ts` พิสูจน์ว่า *ถ้า* เหตุการณ์หน้าตาแบบนี้เข้ามา
 * ผลจะถูก · **มันไม่ได้พิสูจน์ว่ามีอะไรในระบบสร้างเหตุการณ์แบบนั้นได้จริง**
 * ซึ่งเป็นความต่างที่ทำให้หมวด F ของ `sla-engine.spec.ts` เขียวอยู่หลายเดือน
 * ทั้งที่ไม่มีโค้ดเส้นไหนไปถึงสถานะนั้นได้เลย (CLAUDE.md §8)
 *
 * ไฟล์นี้จึงตอบคนละคำถาม:
 *
 *   1. **มีอะไรเรียก `fireAutomation` จริงไหม** — สแกนซอร์สของ controller
 *      เพราะกลไกที่ไม่มีอะไรเรียกใช้ ป้องกันอะไรไม่ได้เลย
 *   2. **กฎที่เปิดอยู่ ทำงานกับงานจริงในฐานข้อมูลจริงไหม**
 *   3. **สิ่งที่ทำไม่ได้ ถูกบันทึกไว้ให้เห็นไหม** — ไม่ใช่เงียบหายไป
 *   4. **กฎที่ปิดอยู่ ไม่แตะอะไรเลยจริงไหม** — ไม่มีแม้แต่แถวประวัติ
 *
 * ทุกอย่างสร้างของตัวเองแล้วลบทิ้ง ไม่แตะข้อมูล seed — และคีย์มี stamp ต่อท้าย
 * เสมอ เพราะตอนกลไกถูกลบเพื่อพิสูจน์ว่าแดงได้ ค่าที่ "ไม่ควรถูกใช้" จะถูกใช้จริง
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { TenantContext } from '@itsm/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { fireAutomation } from '../src/modules/automation';

const STAMP = String(Date.now()).slice(-6);
const PKEY = `AUT${STAMP}`;

let tenantId: bigint;
let projectId: bigint;
let botId: bigint;
let ctx: TenantContext;

let reporterId: bigint | undefined;
let targetId: bigint | undefined;
let groupId: bigint | undefined;
let schemeId: bigint | undefined;
let workflowId: bigint | undefined;
let issueTypeId: bigint;
const ruleIds: bigint[] = [];
const keys: string[] = [];

const OPEN = `รอรับเรื่อง ${STAMP}`;
const DOING = `กำลังทำ ${STAMP}`;

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function mkRule(over: {
  name: string;
  trigger: string;
  isEnabled: boolean;
  conditions: unknown[];
  actions: unknown[];
}): Promise<bigint> {
  const r = await prismaClient.automationRule.create({
    data: {
      tenantId,
      projectId,
      name: `${over.name} ${STAMP}`,
      trigger: over.trigger,
      isEnabled: over.isEnabled,
      conditions: over.conditions as never,
      actions: over.actions as never,
    },
    select: { id: true },
  });
  ruleIds.push(r.id);
  return r.id;
}

async function mkItem(n: number, summary: string): Promise<string> {
  const w = await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey: `${PKEY}-${String(n)}`,
      issueTypeId,
      statusId: (
        await prismaClient.workflowStatus.findFirstOrThrow({
          where: { workflowId: workflowId ?? 0n, name: OPEN },
          select: { id: true },
        })
      ).id,
      reporterId: reporterId as bigint,
      summary,
      rank: `0|${String(1000 + n)}`,
    },
    select: { itemKey: true },
  });
  keys.push(w.itemKey);
  return w.itemKey;
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์อัตโนมัติ ${STAMP}` },
    select: { id: true },
  });
  schemeId = scheme.id;

  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: PKEY,
      name: `โปรเจกต์ทดสอบกฎอัตโนมัติ ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = project.id;

  const group = await prismaClient.userGroup.create({
    data: { tenantId, name: `aut-bot ${STAMP}` },
    select: { id: true },
  });
  groupId = group.id;

  /*
    ผู้ใช้ระบบของเทสต์ **แยกจากของจริง** และ id ต่ำกว่าไม่ได้ — `fireAutomation`
    หยิบ `isSystem` คนแรกตาม id · เทสต์จึงต้องยอมรับว่าจะได้ตัวจริงมา แล้ว
    ให้สิทธิ์ตัวจริงในกลุ่มของเทสต์แทน · การสร้าง bot ซ้อนแล้วหวังว่าจะได้ตัวเอง
    คือการเขียนเทสต์ที่ผลขึ้นกับ id ที่บังเอิญได้ ซึ่งจะพังเมื่อข้อมูลเปลี่ยน
  */
  botId = (
    await prismaClient.user.findFirstOrThrow({
      where: { tenantId, isSystem: true, isActive: true },
      orderBy: { id: 'asc' },
      select: { id: true },
    })
  ).id;
  await prismaClient.groupMember.create({ data: { tenantId, groupId: group.id, userId: botId } });

  const mkUser = async (n: string): Promise<bigint> =>
    (
      await prismaClient.user.create({
        data: { tenantId, email: `aut-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
        select: { id: true },
      })
    ).id;
  reporterId = await mkUser('reporter');
  targetId = await mkUser('target');
  // ผู้รับผิดชอบต้องอยู่ในกลุ่มที่ browse โปรเจกต์ได้ มิฉะนั้นมอบหมายไม่ผ่าน
  await prismaClient.groupMember.create({
    data: { tenantId, groupId: group.id, userId: targetId },
  });

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: group.id },
      { tenantId, schemeId: scheme.id, permission: 'EDIT_ITEM', groupId: group.id },
      { tenantId, schemeId: scheme.id, permission: 'ASSIGN_ITEM', groupId: group.id },
      { tenantId, schemeId: scheme.id, permission: 'TRANSITION_ITEM', groupId: group.id },
      { tenantId, schemeId: scheme.id, permission: 'ADD_COMMENT', groupId: group.id },
    ] as never,
  });

  const wf = await prismaClient.workflow.create({
    data: { tenantId, name: `workflow อัตโนมัติ ${STAMP}` },
    select: { id: true },
  });
  workflowId = wf.id;
  const openId = (
    await prismaClient.workflowStatus.create({
      data: { tenantId, workflowId: wf.id, name: OPEN, category: 'TODO', position: 1, isInitial: true },
      select: { id: true },
    })
  ).id;
  const doingId = (
    await prismaClient.workflowStatus.create({
      data: {
        tenantId,
        workflowId: wf.id,
        name: DOING,
        category: 'IN_PROGRESS',
        position: 2,
        isInitial: false,
      },
      select: { id: true },
    })
  ).id;
  await prismaClient.workflowTransition.create({
    data: {
      tenantId,
      workflowId: wf.id,
      name: `เริ่มทำ ${STAMP}`,
      fromStatusId: openId,
      toStatusId: doingId,
      position: 1,
    },
  });

  issueTypeId = (await prismaClient.workItem.findFirstOrThrow({ select: { issueTypeId: true } }))
    .issueTypeId;
  await prismaClient.workflowScheme.create({
    data: { tenantId, projectId, issueTypeId, workflowId: wf.id },
  });

  ctx = { tenantId, actorId: reporterId };
}, 180_000);

afterAll(async () => {
  /*
    ถามจาก `automation_run` และ `work_item_history` ว่ารอบนี้แตะอะไรไปบ้าง
    ไม่ใช่จากตัวแปรที่จำไว้ตอนเขียน — ตอนกลไกถูกลบเพื่อพิสูจน์ว่าแดงได้
    กฎที่ "ไม่ควรทำอะไร" จะทำจริง และมันจะไปเจอแถวที่มีอยู่ (CLAUDE.md §8)
  */
  await step('ประวัติของบอท', () =>
    prismaClient.workItemHistory.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('ความเห็น', () =>
    prismaClient.workItemComment.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('แจ้งเตือน', async () => {
    /*
      `Notification` ไม่มี relation ไปยัง `WorkItem` มีแต่คอลัมน์ `workItemId`
      — ต้องหา id มาก่อน ไม่ใช่กรองผ่านความสัมพันธ์ที่ไม่มีอยู่
    */
    const ids = (
      await prismaClient.workItem.findMany({
        where: { itemKey: { in: keys } },
        select: { id: true },
      })
    ).map((w) => w.id);
    await prismaClient.notification.deleteMany({ where: { workItemId: { in: ids } } });
  });
  await step('ประวัติกฎ', () =>
    prismaClient.automationRun.deleteMany({ where: { traceId: { startsWith: 'auto-' } } }),
  );
  await step('กฎ', () => prismaClient.automationRule.deleteMany({ where: { id: { in: ruleIds } } }));
  await step('นาฬิกา SLA', () =>
    prismaClient.workItemSla.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('งาน', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
  await step('workflow scheme', () =>
    prismaClient.workflowScheme.deleteMany({ where: { projectId } }),
  );
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: PKEY } }));
  await step('transition', () =>
    prismaClient.workflowTransition.deleteMany({ where: { workflowId: workflowId ?? 0n } }),
  );
  await step('สถานะ', () =>
    prismaClient.workflowStatus.deleteMany({ where: { workflowId: workflowId ?? 0n } }),
  );
  await step('workflow', () => prismaClient.workflow.deleteMany({ where: { id: workflowId ?? 0n } }));
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { groupId: groupId ?? 0n } }),
  );
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({ where: { schemeId: schemeId ?? 0n } }),
  );
  await step('กลุ่ม', () => prismaClient.userGroup.deleteMany({ where: { id: groupId ?? 0n } }));
  await step('ผู้ใช้', () =>
    prismaClient.user.deleteMany({ where: { email: { contains: `-${STAMP}@example.test` } } }),
  );
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { id: schemeId ?? 0n } }),
  );
  await prismaClient.$disconnect();
}, 180_000);

describe('A · มีอะไรเรียกมันจริงไหม', () => {
  /*
    กลไกที่ไม่มีอะไรเรียกใช้ ป้องกันอะไรไม่ได้เลย — บทเรียนที่โครงการนี้เจอ
    ซ้ำที่สุด · เทสต์พฤติกรรมข้างล่างจะเขียวทั้งชุดแม้ไม่มีใครเรียกจากทางเข้าจริง
    เพราะมันเรียก `fireAutomation` เอง · ข้อนี้เท่านั้นที่จับเรื่องนั้นได้
  */
  const controller = readFileSync(
    join(__dirname, '../src/modules/workitem/workitem.controller.ts'),
    'utf8',
  );

  it('ตัวสแกนอ่านไฟล์เจอจริง', () => {
    expect(controller).toContain('@Post()');
    expect(controller).not.toContain('ข้อความที่ไม่มีอยู่จริงในไฟล์นี้');
  });

  it('**ทางเข้าจริงทั้งสามทางเรียก fireAutomation**', () => {
    const calls = [...controller.matchAll(/fireAutomation\(ctx, [^,]+, '([a-z.]+)'/g)].map(
      (m) => m[1],
    );
    expect(new Set(calls)).toEqual(
      new Set(['item.created', 'item.transitioned', 'comment.added']),
    );
  });
});

describe('B · ทำงานกับงานจริง', () => {
  it('**กฎที่เปิดอยู่ มอบหมายงานให้จริง**', async () => {
    await mkRule({
      name: 'มอบหมายอัตโนมัติ',
      trigger: 'item.created',
      isEnabled: true,
      conditions: [{ field: 'project', op: 'is', value: PKEY }],
      actions: [{ kind: 'assign', value: String(targetId) }],
    });
    const key = await mkItem(1, `เรื่องที่ต้องถูกมอบหมาย ${STAMP}`);

    const res = await fireAutomation(ctx, key, 'item.created');
    expect(res?.runs.map((r) => r.outcome)).toEqual(['applied']);

    const after = await prismaClient.workItem.findFirstOrThrow({
      where: { itemKey: key },
      select: { assigneeId: true },
    });
    expect(after.assigneeId).toBe(targetId);
  }, 60_000);

  it('**ประวัติบอกว่ากฎข้อไหนสั่ง และโยงกลับไปแถวที่แก้จริงได้**', async () => {
    /*
      "ใครสั่ง" เป็นคำถามแรกของคนที่เจอตั๋วถูกมอบหมายเอง · คำตอบ "ระบบทำเอง"
      ไม่ช่วยอะไร · trace_id ที่ตรงกันคือสิ่งเดียวที่โยงสองตารางเข้าหากันได้
      โดยไม่ต้องเดาจากเวลาที่ใกล้กัน ซึ่งผิดทันทีที่มีสองรอบทำงานพร้อมกัน
    */
    const run = await prismaClient.automationRun.findFirstOrThrow({
      where: { tenantId, workItem: { itemKey: `${PKEY}-1` }, outcome: 'applied' },
      select: { ruleName: true, traceId: true, actionKind: true },
    });
    expect(run.ruleName).toContain('มอบหมายอัตโนมัติ');
    expect(run.actionKind).toBe('assign');

    const history = await prismaClient.workItemHistory.findMany({
      where: { traceId: run.traceId },
      select: { field: true, actorId: true },
    });
    expect(history.length).toBeGreaterThan(0);
    // ผู้กระทำต้องเป็นผู้ใช้ระบบ ไม่ใช่คนที่บังเอิญกดปุ่มแจ้งเรื่อง
    expect(history.every((h) => h.actorId === botId)).toBe(true);
  }, 60_000);

  it('**กฎที่ปิดอยู่ ไม่ทิ้งแม้แต่แถวเดียว**', async () => {
    await mkRule({
      name: 'กฎที่ปิดไว้',
      trigger: 'comment.added',
      isEnabled: false,
      conditions: [],
      actions: [{ kind: 'comment', value: 'ข้อความที่ไม่ควรถูกเขียน' }],
    });
    const key = await mkItem(2, `เรื่องที่กฎปิดอยู่ ${STAMP}`);

    const res = await fireAutomation(ctx, key, 'comment.added');
    expect(res?.runs).toEqual([]);

    const rows = await prismaClient.automationRun.count({
      where: { tenantId, workItem: { itemKey: key } },
    });
    expect(rows).toBe(0);
    const comments = await prismaClient.workItemComment.count({
      where: { workItem: { itemKey: key } },
    });
    expect(comments).toBe(0);
  }, 60_000);
});

describe('B2 · แจ้งกลุ่ม', () => {
  it('**กฎแจ้งกลุ่มที่ตั้งชื่อกลุ่มผิด ต้องบันทึกเป็น failed พร้อมชื่อที่พิมพ์ไป**', async () => {
    /*
      ชื่อกลุ่มเป็นข้อความที่ผู้ดูแลพิมพ์เอง จึงพิมพ์ผิดได้ทุกครั้ง ·
      ถ้าเงียบ กฎจะดูเหมือนทำงานอยู่ตลอดไปโดยไม่มีใครได้รับอะไรเลย
    */
    await mkRule({
      name: 'แจ้งกลุ่มที่ไม่มีอยู่',
      trigger: 'comment.added',
      isEnabled: true,
      conditions: [],
      actions: [{ kind: 'notify-group', value: `ทีมที่ไม่มีอยู่ ${STAMP}` }],
    });
    const key = await mkItem(5, `เรื่องที่กฎแจ้งกลุ่มผิด ${STAMP}`);

    const res = await fireAutomation(ctx, key, 'comment.added');
    expect(res?.runs.map((r) => r.outcome)).toEqual(['failed']);
    expect(res?.runs[0]?.reason).toContain('ทีมที่ไม่มีอยู่');
  }, 60_000);

  it('**แจ้งกลุ่มจริงแล้วคนในกลุ่มได้รับ และไม่ได้รับซ้ำเมื่อกฎทำงานอีกรอบ**', async () => {
    /*
      รอบกวาดตามเวลาเรียกซ้ำได้ทุกห้านาที · คีย์กันซ้ำจึงต้องประกอบจาก
      (กฎ, เรื่อง) เท่านั้น ไม่มีเวลา — ไม่งั้นคนในกลุ่มได้รับซ้ำทั้งวัน
    */
    await mkRule({
      name: 'แจ้งกลุ่มจริง',
      trigger: 'sla.breached',
      isEnabled: true,
      conditions: [],
      actions: [{ kind: 'notify-group', value: `aut-bot ${STAMP}` }],
    });
    const key = await mkItem(6, `เรื่องที่ต้องแจ้งกลุ่ม ${STAMP}`);

    const first = await fireAutomation(ctx, key, 'sla.breached');
    expect(first?.runs.map((r) => r.outcome)).toEqual(['applied']);

    const itemId = (
      await prismaClient.workItem.findFirstOrThrow({
        where: { itemKey: key },
        select: { id: true },
      })
    ).id;
    const got = await prismaClient.notification.count({ where: { workItemId: itemId } });
    expect(got).toBeGreaterThan(0);

    // รอบสอง — ไม่มีแถวเพิ่ม และรายงานตรง ๆ ว่าทุกคนได้รับไปแล้ว
    const second = await fireAutomation(ctx, key, 'sla.breached');
    expect(second?.runs[0]?.reason).toContain('ได้รับเรื่องนี้ไปแล้ว');
    expect(await prismaClient.notification.count({ where: { workItemId: itemId } })).toBe(got);
  }, 60_000);
});

describe('C · สิ่งที่ทำไม่ได้ ต้องเห็น', () => {
  it('**ปุ่มที่ไม่มีจากสถานะนี้ ถูกบันทึกเป็น failed พร้อมบอกว่ามีปุ่มอะไรบ้าง**', async () => {
    /*
      กฎที่สั่งเปลี่ยนสถานะไปที่ที่ไปไม่ได้ เป็นความผิดที่ผู้ดูแลแก้เองได้ทันที
      *ถ้ารู้* · การเงียบทำให้เขาสรุปว่า "ระบบอัตโนมัติใช้ไม่ได้" แล้วเลิกใช้ทั้งชุด
    */
    await mkRule({
      name: 'กดปุ่มที่ไม่มี',
      trigger: 'item.transitioned',
      isEnabled: true,
      conditions: [],
      actions: [{ kind: 'transition', value: `ปุ่มที่ไม่มีอยู่จริง ${STAMP}` }],
    });
    const key = await mkItem(3, `เรื่องที่กฎกดปุ่มผิด ${STAMP}`);

    const res = await fireAutomation(ctx, key, 'item.transitioned');
    expect(res?.runs.map((r) => r.outcome)).toEqual(['failed']);
    expect(res?.runs[0]?.reason).toContain(`เริ่มทำ ${STAMP}`);

    const row = await prismaClient.automationRun.findFirstOrThrow({
      where: { tenantId, workItem: { itemKey: key } },
      select: { outcome: true, reason: true },
    });
    expect(row.outcome).toBe('failed');
    expect(row.reason).not.toBeNull();
  }, 60_000);

  it('กฎหนึ่งที่พัง ไม่ทำให้กฎถัดไปเงียบ', async () => {
    await mkRule({
      name: 'ตามหลังกฎที่พัง',
      trigger: 'item.transitioned',
      isEnabled: true,
      conditions: [],
      /*
        ข้อแรก **โยน error จริง** (`addComment` ปฏิเสธข้อความว่าง) ไม่ใช่แค่คืน
        เหตุผล · ทั้งสองทางต้องถูกทดสอบ เพราะเดินคนละเส้น: ทางคืนเหตุผลผ่าน
        `execute` ตามปกติ ส่วนทางโยนไปเข้า `catch` ซึ่งพิสูจน์แล้วว่าถ้าไม่มีเคสนี้
        จะลบ `catch` ทิ้งได้โดยเทสต์ยังเขียวทั้งชุด
      */
      actions: [
        { kind: 'comment', value: '   ' },
        { kind: 'assign', value: 'ไม่ใช่ตัวเลข' },
        { kind: 'comment', value: 'ยังทำงานอยู่' },
      ],
    });
    const key = await mkItem(4, `เรื่องที่มีสองกฎ ${STAMP}`);

    const res = await fireAutomation(ctx, key, 'item.transitioned');
    const outcomes = res?.runs.map((r) => r.outcome) ?? [];
    // กฎแรกพัง แต่ทุกข้อที่เหลือยังได้ลงมือ — ไม่มีข้อไหนหายไปจากรายการ
    expect(outcomes).toHaveLength(4);
    expect(outcomes.filter((o) => o === 'applied')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'failed')).toHaveLength(3);
    // ข้อที่โยน error ต้องมีเหตุผลของมันเอง ไม่ใช่ข้อความรวม ๆ
    expect(res?.runs.some((r) => (r.reason ?? '').includes('ความเห็นว่างเปล่า'))).toBe(true);
  }, 60_000);
});
