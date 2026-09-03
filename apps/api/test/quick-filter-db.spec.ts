/**
 * ตัวกรองด่วนของกระดาน — ต่อกับฐานข้อมูลจริง
 *
 * `prisma-target.spec.ts` พิสูจน์ว่าตัวแปลให้เงื่อนไขที่ถูก · ไฟล์นี้พิสูจน์ว่า
 * **เงื่อนไขนั้นถูกเอาไปใช้จริงกับกระดาน** และกรองการ์ดได้ตรงตามที่เขียนไว้
 *
 * ข้อที่สำคัญที่สุด:
 *
 *   1. **คิวรีถูกตรวจตอนบันทึก ไม่ใช่ตอนใช้** — ตัวกรองที่พังตอนกดใช้
 *      ทำให้กระดานทั้งหน้าใช้ไม่ได้ โดยที่คนกดไม่รู้ว่าต้นเหตุอยู่ที่
 *      การตั้งค่าเมื่อเดือนก่อน
 *   2. **จำนวนบนหัวคอลัมน์ต้องนับหลังกรอง** — ถ้านับก่อนกรอง หัวคอลัมน์
 *      จะบอกเลขของทั้งคอลัมน์ขณะที่การ์ดที่เห็นถูกกรองแล้ว · ตัวเลขที่
 *      ไม่ตรงกับสิ่งที่ตาเห็นแย่กว่าไม่มีตัวเลข และเพดาน WIP จะตัดสิน
 *      จากเลขที่ผิดไปด้วย
 *   3. **ตัวกรองที่หาไม่เจอต้องล้ม ไม่ใช่แสดงทั้งกระดาน** — กระดานที่
 *      ดูเหมือนกรองแล้วแต่ไม่ได้กรอง ทำให้คนเชื่อว่างานที่เห็นคือทั้งหมด
 *      ที่ตรงเงื่อนไข
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  InvalidQuickFilterError,
  QuickFilterNotFoundError,
  boardOf,
  createQuickFilter,
  deleteQuickFilter,
  listQuickFilters,
} from '../src/modules/board';

const STAMP = String(Date.now()).slice(-6);
const OPEN = `รอหยิบ ${STAMP}`;
const DOING = `กำลังทำ ${STAMP}`;

let tenantId: bigint;
let projectId: bigint;
let projectKey = '';
let lead: TenantContext;
let member: TenantContext;
let leadId: bigint | undefined;
let memberId: bigint | undefined;
let workflowId: bigint | undefined;
const keys: string[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์ตัวกรอง ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `QF${STAMP}`,
      name: `โปรเจกต์ทดสอบตัวกรอง ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true, key: true },
  });
  projectId = project.id;
  projectKey = project.key;

  const mkGroup = async (n: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `qf-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  const leadGroupId = await mkGroup('lead');
  const memberGroupId = await mkGroup('member');

  const mkUser = async (n: string, groupId: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `qf-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  leadId = await mkUser('lead', leadGroupId);
  memberId = await mkUser('member', memberGroupId);

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: leadGroupId },
      { tenantId, schemeId: scheme.id, permission: 'MANAGE_PROJECT', groupId: leadGroupId },
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: memberGroupId },
    ] as never,
  });
  lead = { tenantId, actorId: leadId };
  member = { tenantId, actorId: memberId };

  const wf = await prismaClient.workflow.create({
    data: { tenantId, name: `workflow ตัวกรอง ${STAMP}` },
    select: { id: true },
  });
  workflowId = wf.id;
  const mkStatus = async (
    name: string,
    category: string,
    position: number,
    init: boolean,
  ): Promise<bigint> =>
    (
      await prismaClient.workflowStatus.create({
        data: {
          tenantId,
          workflowId: wf.id,
          name,
          category: category as never,
          position,
          isInitial: init,
        },
        select: { id: true },
      })
    ).id;
  const openId = await mkStatus(OPEN, 'TODO', 1, true);
  const doingId = await mkStatus(DOING, 'IN_PROGRESS', 2, false);

  const template = await prismaClient.workItem.findFirstOrThrow({ select: { issueTypeId: true } });
  await prismaClient.workflowScheme.create({
    data: { tenantId, projectId, issueTypeId: template.issueTypeId, workflowId: wf.id },
  });

  /*
    สามใบใน "รอหยิบ" — สองใบมีผู้รับผิดชอบ หนึ่งใบไม่มี · หนึ่งใบใน "กำลังทำ"
    การมีทั้งใบที่มีและไม่มีผู้รับผิดชอบ คือสิ่งที่ทำให้เคส `!=` พิสูจน์อะไรได้
  */
  const rows: Array<[bigint, bigint | null]> = [
    [openId, leadId as bigint],
    [openId, memberId as bigint],
    [openId, null],
    [doingId, leadId as bigint],
  ];
  for (const [i, [statusId, assigneeId]] of rows.entries()) {
    const w = await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey: `QF${STAMP}-${String(i + 1)}`,
        issueTypeId: template.issueTypeId,
        statusId,
        assigneeId,
        reporterId: leadId as bigint,
        summary: `การ์ดตัวกรอง ${String(i + 1)} ${STAMP}`,
        rank: `0|${String(i + 1)}000`,
      },
      select: { itemKey: true },
    });
    keys.push(w.itemKey);
  }
}, 180_000);

afterAll(async () => {
  const owners = [leadId, memberId].filter((v): v is bigint => v !== undefined);
  await step('ตัวกรอง', () => prismaClient.boardQuickFilter.deleteMany({ where: { projectId } }));
  await step('นาฬิกา SLA', () =>
    prismaClient.workItemSla.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { actorId: { in: owners } } }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({ where: { actorId: { in: owners } } }),
  );
  await step('งานทดสอบ', () =>
    prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }),
  );
  await step('workflow scheme', () =>
    prismaClient.workflowScheme.deleteMany({ where: { projectId } }),
  );
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: `QF${STAMP}` } }));
  await step('สถานะ', () =>
    prismaClient.workflowStatus.deleteMany({ where: { workflowId: workflowId ?? 0n } }),
  );
  await step('workflow', () =>
    prismaClient.workflow.deleteMany({ where: { id: workflowId ?? 0n } }),
  );
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({ where: { scheme: { name: { contains: STAMP } } } }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { userId: { in: owners } } }),
  );
  await step('ผู้ใช้', () => prismaClient.user.deleteMany({ where: { id: { in: owners } } }));
  await step('กลุ่ม', () =>
    prismaClient.userGroup.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await prismaClient.$disconnect();
});

/** คีย์ของการ์ดทั้งกระดาน เรียงตามคอลัมน์ */
const shown = async (filterId: string | null): Promise<string[]> => {
  const b = await boardOf(lead, projectKey, 100, 'kanban', filterId);
  return b.columns.flatMap((c) => c.cards.map((x) => x.itemKey));
};

describe('A · บันทึกและอ่าน', () => {
  it('ยังไม่ได้ตั้ง = รายการว่าง', async () => {
    expect(await listQuickFilters(lead, projectKey)).toEqual([]);
  });

  it('สร้างแล้วอ่านกลับได้ พร้อมข้อความคิวรีเดิม', async () => {
    const made = await createQuickFilter(lead, projectKey, {
      name: 'ของฉัน',
      hql: `assignee = "${String(leadId)}"`,
    });
    expect(made.id).toBeTypeOf('string');
    const rows = await listQuickFilters(lead, projectKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hql, 'เก็บผลการแปลแทนข้อความที่ผู้ใช้เขียน').toBe(
      `assignee = "${String(leadId)}"`,
    );
    await deleteQuickFilter(lead, projectKey, made.id);
  });

  /**
   * **id ต้องเป็น string ตอนออกจากชั้น service**
   *
   * `JSON.stringify` โยน TypeError กับ BigInt · เทสต์ที่เรียก service ตรง ๆ
   * ไม่เคยผ่านชั้น serialise จึงต้องมีเคสที่แปลงทั้งก้อนเอง (CLAUDE.md)
   */
  it('**คำตอบทั้งก้อนแปลงเป็น JSON ได้**', async () => {
    const made = await createQuickFilter(lead, projectKey, {
      name: 'ยังไม่ปิด',
      hql: 'resolved IS EMPTY',
    });
    const rows = await listQuickFilters(lead, projectKey);
    expect(() => JSON.stringify(rows)).not.toThrow();
    expect(() => JSON.stringify(made)).not.toThrow();
    await deleteQuickFilter(lead, projectKey, made.id);
  });
});

describe('B · กรองการ์ดจริง', () => {
  it('ไม่ระบุตัวกรอง = เห็นทุกใบ', async () => {
    expect(await shown(null)).toHaveLength(4);
  });

  it('กรองตามผู้รับผิดชอบ', async () => {
    const f = await createQuickFilter(lead, projectKey, {
      name: `ของหัวหน้า ${STAMP}`,
      hql: `assignee = "${String(leadId)}"`,
    });
    expect(await shown(f.id)).toEqual([`QF${STAMP}-1`, `QF${STAMP}-4`]);
    await deleteQuickFilter(lead, projectKey, f.id);
  });

  /**
   * **`!=` ต้องรวมใบที่ยังไม่มีผู้รับผิดชอบ**
   *
   * `NULL != x` ใน SQL ได้ UNKNOWN ไม่ใช่ TRUE · ถ้าไม่เผื่อไว้ ใบที่ยังไม่มี
   * คนรับจะหายไปจากตัวกรอง "ไม่ใช่คนนี้" ซึ่งบนกระดานศูนย์บริการคือกอง
   * ที่สำคัญที่สุด และไม่มีอะไรบอกเลยว่ามันหายไป
   */
  it('**`!=` เห็นใบที่ยังไม่มีผู้รับผิดชอบด้วย**', async () => {
    const f = await createQuickFilter(lead, projectKey, {
      name: `ไม่ใช่หัวหน้า ${STAMP}`,
      hql: `assignee != "${String(leadId)}"`,
    });
    const got = await shown(f.id);
    expect(got, 'ใบที่ยังไม่มีผู้รับผิดชอบหายไป').toContain(`QF${STAMP}-3`);
    expect(got).toEqual([`QF${STAMP}-2`, `QF${STAMP}-3`]);
    await deleteQuickFilter(lead, projectKey, f.id);
  });

  it('กรองตามสถานะ', async () => {
    const f = await createQuickFilter(lead, projectKey, {
      name: `กำลังทำ ${STAMP}`,
      hql: `status = "${DOING}"`,
    });
    expect(await shown(f.id)).toEqual([`QF${STAMP}-4`]);
    await deleteQuickFilter(lead, projectKey, f.id);
  });

  /**
   * **จำนวนบนหัวคอลัมน์ต้องนับหลังกรอง**
   *
   * ถ้านับก่อนกรอง หัวคอลัมน์จะบอก 3 ขณะที่เห็นการ์ดใบเดียว · ตัวเลข
   * ที่ไม่ตรงกับสิ่งที่ตาเห็นแย่กว่าไม่มีตัวเลข และเพดาน WIP ก็จะตัดสิน
   * จากเลขที่ผิดไปด้วย
   */
  it('**จำนวนบนหัวคอลัมน์นับหลังกรอง ไม่ใช่ก่อนกรอง**', async () => {
    const f = await createQuickFilter(lead, projectKey, {
      name: `เฉพาะหัวหน้า ${STAMP}`,
      hql: `assignee = "${String(leadId)}"`,
    });
    const b = await boardOf(lead, projectKey, 100, 'kanban', f.id);
    const open = b.columns.find((c) => c.name === OPEN);
    expect(open?.cards).toHaveLength(1);
    expect(open?.count, 'นับก่อนกรอง — เลขไม่ตรงกับการ์ดที่เห็น').toBe(1);
    await deleteQuickFilter(lead, projectKey, f.id);
  });
});

describe('C · คิวรีที่บันทึกไม่ได้', () => {
  const rejected = async (hql: string): Promise<void> => {
    await expect(
      createQuickFilter(lead, projectKey, { name: `ทดสอบ ${STAMP}`, hql }),
    ).rejects.toThrow(InvalidQuickFilterError);
  };

  /**
   * **ตรวจตอนบันทึก ไม่ใช่ตอนใช้**
   *
   * ตัวกรองที่พังตอนกดใช้ ทำให้กระดานทั้งหน้าใช้ไม่ได้ โดยที่คนกดไม่รู้ว่า
   * ต้นเหตุอยู่ที่การตั้งค่าเมื่อเดือนก่อน และไม่รู้ว่าต้องไปแก้ที่ไหน
   */
  it('**ฟิลด์ข้อความถูกปฏิเสธตั้งแต่ตอนบันทึก**', async () => {
    await rejected('summary ~ "ปริ้นเตอร์"');
    expect(await listQuickFilters(lead, projectKey)).toHaveLength(0);
  });

  it('ไวยากรณ์ผิดถูกปฏิเสธ', async () => {
    await rejected('status =');
  });

  it('ฟิลด์ที่ไม่รู้จักถูกปฏิเสธ', async () => {
    await rejected('ไม่มีฟิลด์นี้ = "x"');
  });

  it('ชื่อว่างเปล่าถูกปฏิเสธ — ปุ่มไม่มีข้อความคือปุ่มที่ไม่มีใครรู้ว่ากดแล้วได้อะไร', async () => {
    await expect(
      createQuickFilter(lead, projectKey, { name: '   ', hql: 'resolved IS EMPTY' }),
    ).rejects.toThrow(InvalidQuickFilterError);
    expect(await listQuickFilters(lead, projectKey)).toHaveLength(0);
  });

  it('คิวรีว่างเปล่าถูกปฏิเสธ — ตัวกรองที่ไม่กรองอะไร ไม่ได้กรองอะไร', async () => {
    await expect(
      createQuickFilter(lead, projectKey, { name: `ว่าง ${STAMP}`, hql: '  ' }),
    ).rejects.toThrow(InvalidQuickFilterError);
  });
});

describe('D · สิทธิ์และตัวกรองที่หาไม่เจอ', () => {
  it('**ไม่มี MANAGE_PROJECT สร้างไม่ได้**', async () => {
    await expect(
      createQuickFilter(member, projectKey, { name: `ของสมาชิก ${STAMP}`, hql: 'resolved IS EMPTY' }),
    ).rejects.toThrow(PermissionDeniedError);
    expect(await listQuickFilters(lead, projectKey)).toHaveLength(0);
  });

  it('แต่คนที่เปิดดูกระดานได้ อ่านรายการตัวกรองได้', async () => {
    const f = await createQuickFilter(lead, projectKey, {
      name: `อ่านได้ ${STAMP}`,
      hql: 'resolved IS EMPTY',
    });
    expect(await listQuickFilters(member, projectKey)).toHaveLength(1);
    await deleteQuickFilter(lead, projectKey, f.id);
  });

  /**
   * **ตัวกรองที่หาไม่เจอต้องล้ม ไม่ใช่แสดงทั้งกระดาน**
   *
   * กระดานที่ดูเหมือนกรองแล้วแต่ไม่ได้กรอง ทำให้คนเชื่อว่างานที่เห็น
   * คือทั้งหมดที่ตรงเงื่อนไข ซึ่งเป็นความเชื่อที่หน้าจอสร้างขึ้นเอง
   */
  it('**รหัสตัวกรองที่ไม่มีอยู่ ทำให้ล้ม ไม่ใช่เห็นทุกใบ**', async () => {
    await expect(boardOf(lead, projectKey, 100, 'kanban', '999999999')).rejects.toThrow(
      QuickFilterNotFoundError,
    );
  });

  it('รหัสที่ไม่ใช่ตัวเลข ก็ล้มเหมือนกัน ไม่ใช่ถูกข้าม', async () => {
    await expect(boardOf(lead, projectKey, 100, 'kanban', 'ไม่ใช่ตัวเลข')).rejects.toThrow(
      QuickFilterNotFoundError,
    );
  });

  /**
   * ตัวกรองของโปรเจกต์อื่น ต้องใช้กับกระดานนี้ไม่ได้ — มิฉะนั้นคนที่รู้
   * รหัสจะกรองด้วยเงื่อนไขที่โปรเจกต์นี้ไม่ได้ตั้งไว้ และรู้ได้ว่ามีอะไรอยู่
   * จากจำนวนผลลัพธ์
   */
  it('ตัวกรองที่ไม่ได้เป็นของโปรเจกต์นี้ ใช้ไม่ได้', async () => {
    const f = await createQuickFilter(lead, projectKey, {
      name: `ของโปรเจกต์นี้ ${STAMP}`,
      hql: 'resolved IS EMPTY',
    });
    const other = await prismaClient.project.findFirstOrThrow({
      where: { tenantId, id: { not: projectId } },
      select: { key: true },
    });
    await expect(boardOf(lead, other.key, 100, 'kanban', f.id)).rejects.toThrow();
    await deleteQuickFilter(lead, projectKey, f.id);
  });
});

describe('E · ร่องรอย', () => {
  it('**สร้างและลบ เขียน audit ทั้งคู่**', async () => {
    const where = { actorId: leadId ?? 0n, action: { startsWith: 'board.quick_filter' } };
    const before = await prismaClient.auditLog.count({ where });
    const f = await createQuickFilter(lead, projectKey, {
      name: `ร่องรอย ${STAMP}`,
      hql: 'resolved IS EMPTY',
    });
    await deleteQuickFilter(lead, projectKey, f.id);
    const rows = await prismaClient.auditLog.findMany({
      where,
      orderBy: { id: 'asc' },
      select: { action: true },
    });
    expect(rows.length - before).toBe(2);
    expect(rows.map((r) => r.action).slice(-2)).toEqual([
      'board.quick_filter.create',
      'board.quick_filter.delete',
    ]);
  });

  it('คิวรีที่ถูกปฏิเสธไม่เขียน audit', async () => {
    const where = { actorId: leadId ?? 0n, action: { startsWith: 'board.quick_filter' } };
    const before = await prismaClient.auditLog.count({ where });
    await expect(
      createQuickFilter(lead, projectKey, { name: `ผิด ${STAMP}`, hql: 'summary ~ "x"' }),
    ).rejects.toThrow();
    expect(await prismaClient.auditLog.count({ where })).toBe(before);
  });
});
