/**
 * แจ้งเตือนคนทั้งกลุ่ม — เทสต์เป็นข้อกำหนด
 *
 * สี่ข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **คนที่เปิดเรื่องนั้นไม่ได้ ต้องไม่ได้รับ** — การแจ้งเตือนที่กดแล้วเจอ
 *      403 แย่กว่าไม่แจ้ง เพราะมันบอกว่ามีเรื่องอยู่ **พร้อมหัวข้อของมัน**
 *      ให้คนที่ไม่ควรรู้ · นี่คือการรั่วของข้อมูล ไม่ใช่แค่ประสบการณ์ที่ไม่ดี
 *   2. **กลุ่มที่ไม่มีอยู่ หรือไม่มีใครได้รับเลย ต้องโยน** ไม่ใช่คืน "0 คน"
 *      ซึ่งอ่านเหมือนสำเร็จ · ผู้ดูแลที่พิมพ์ชื่อกลุ่มผิดจะเชื่อว่ากฎทำงานอยู่
 *      ตลอดไป — เป็นความเงียบแบบเดียวกับสิทธิ์ที่ให้แล้วไม่มีผล
 *   3. **`dedupeKey` ห้ามมีเวลา** — เรียกซ้ำต้องไม่สร้างแถวใหม่ · คีย์ที่มีเวลา
 *      ทำให้ unique index ที่มีไว้กันส่งซ้ำไม่กันอะไรเลย (กติกาเดียวกับ jobId)
 *   4. **ไม่บอกคนที่เพิ่งทำเรื่องนั้นเอง** — ข้อความที่ซ้ำสิ่งที่เห็นแล้วมีแต่กวน
 *
 * สร้างผู้ใช้ · กลุ่ม · โปรเจกต์ของตัวเองแล้วลบทิ้ง ไม่แตะข้อมูล seed
 */
import type { TenantContext } from '@itsm/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  GroupNotFoundError,
  NobodyToNotifyError,
  notifyGroup,
} from '../src/modules/notification';

const STAMP = String(Date.now()).slice(-6);
const PKEY = `NTF${STAMP}`;
const GROUP = `ทีมที่เห็นโปรเจกต์ ${STAMP}`;
const BLIND = `ทีมที่ไม่เห็นโปรเจกต์ ${STAMP}`;
const EMPTY = `ทีมที่ไม่มีสมาชิก ${STAMP}`;

let tenantId: bigint;
let projectId: bigint;
let workItemId: bigint;
let ctx: TenantContext;
let memberA: bigint | undefined;
let memberB: bigint | undefined;
let outsider: bigint | undefined;
let botUser: bigint | undefined;
const groupIds: bigint[] = [];
let schemeId: bigint | undefined;
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
    data: { tenantId, name: `ชุดสิทธิ์แจ้งกลุ่ม ${STAMP}` },
    select: { id: true },
  });
  schemeId = scheme.id;
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: PKEY,
      name: `โปรเจกต์ทดสอบแจ้งกลุ่ม ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = project.id;

  const mkGroup = async (name: string): Promise<bigint> => {
    const g = await prismaClient.userGroup.create({ data: { tenantId, name }, select: { id: true } });
    groupIds.push(g.id);
    return g.id;
  };
  const seeing = await mkGroup(GROUP);
  const blind = await mkGroup(BLIND);
  await mkGroup(EMPTY);

  const mkUser = async (n: string, groupId: bigint | null, isSystem = false): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: {
        tenantId,
        email: `ntf-${n}-${STAMP}@example.test`,
        displayName: `ผู้ใช้ ${n}`,
        isSystem,
      },
      select: { id: true },
    });
    if (groupId !== null) {
      await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    }
    return u.id;
  };
  memberA = await mkUser('a', seeing);
  memberB = await mkUser('b', seeing);
  outsider = await mkUser('outsider', blind);
  /*
    ผู้ใช้ระบบของเทสต์อยู่ในกลุ่มที่เห็นโปรเจกต์ด้วย — มีไว้พิสูจน์ว่ามันถูก
    ตัดออก · ถ้าไม่ใส่เข้าไป เคส "ไม่นับผู้ใช้ระบบ" จะเขียวโดยไม่ได้ตรวจอะไร
  */
  botUser = await mkUser('bot', seeing, true);

  await prismaClient.permissionGrant.create({
    data: {
      tenantId,
      schemeId: scheme.id,
      permission: 'BROWSE_PROJECT',
      groupId: seeing,
    } as never,
  });

  const wf = await prismaClient.workflow.create({
    data: { tenantId, name: `wf แจ้งกลุ่ม ${STAMP}` },
    select: { id: true },
  });
  workflowId = wf.id;
  const status = await prismaClient.workflowStatus.create({
    data: {
      tenantId,
      workflowId: wf.id,
      name: `เปิด ${STAMP}`,
      category: 'TODO',
      position: 1,
      isInitial: true,
    },
    select: { id: true },
  });
  const tpl = await prismaClient.workItem.findFirstOrThrow({ select: { issueTypeId: true } });
  await prismaClient.workflowScheme.create({
    data: { tenantId, projectId, issueTypeId: tpl.issueTypeId, workflowId: wf.id },
  });

  const item = await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey: `${PKEY}-1`,
      issueTypeId: tpl.issueTypeId,
      statusId: status.id,
      reporterId: memberA,
      summary: `เรื่องสำหรับทดสอบการแจ้งกลุ่ม ${STAMP}`,
      rank: '0|1000',
    },
    select: { id: true, itemKey: true },
  });
  workItemId = item.id;
  keys.push(item.itemKey);

  ctx = { tenantId, actorId: memberA };
}, 180_000);

afterAll(async () => {
  await step('แจ้งเตือน', () =>
    prismaClient.notification.deleteMany({ where: { dedupeKey: { contains: STAMP } } }),
  );
  await step('แจ้งเตือนของเรื่องนี้', () =>
    prismaClient.notification.deleteMany({ where: { workItemId } }),
  );
  await step('งาน', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
  await step('workflow scheme', () =>
    prismaClient.workflowScheme.deleteMany({ where: { projectId } }),
  );
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: PKEY } }));
  await step('สถานะ', () =>
    prismaClient.workflowStatus.deleteMany({ where: { workflowId: workflowId ?? 0n } }),
  );
  await step('workflow', () => prismaClient.workflow.deleteMany({ where: { id: workflowId ?? 0n } }));
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { groupId: { in: groupIds } } }),
  );
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({ where: { schemeId: schemeId ?? 0n } }),
  );
  await step('กลุ่ม', () => prismaClient.userGroup.deleteMany({ where: { id: { in: groupIds } } }));
  await step('ผู้ใช้', () =>
    prismaClient.user.deleteMany({ where: { email: { contains: `-${STAMP}@example.test` } } }),
  );
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { id: schemeId ?? 0n } }),
  );

  const left = await prismaClient.notification.count({ where: { workItemId } });
  if (left > 0) console.error(`**เหลือแจ้งเตือนของเทสต์ค้างอยู่ ${String(left)} รายการ**`);
  await prismaClient.$disconnect();
}, 180_000);

function notice(over: Partial<Parameters<typeof notifyGroup>[1]> = {}): Parameters<
  typeof notifyGroup
>[1] {
  return {
    groupName: GROUP,
    workItemId,
    projectId,
    kind: 'automation.notice',
    title: `${PKEY}-1 — กฎทดสอบ`,
    body: 'รายละเอียดของเรื่อง',
    dedupeSeed: `test:${STAMP}`,
    ...over,
  };
}

describe('A · ใครได้รับบ้าง', () => {
  it('**คนในกลุ่มที่เปิดโปรเจกต์ได้ ได้รับ · ผู้ใช้ระบบไม่นับ**', async () => {
    const r = await notifyGroup(ctx, notice({ excludeUserId: null }));
    // สมาชิกสามคน แต่หนึ่งในนั้นเป็นผู้ใช้ระบบซึ่งไม่มีใครอ่าน
    expect(r.notified).toBe(2);

    const got = await prismaClient.notification.findMany({
      where: { workItemId },
      select: { userId: true, title: true },
    });
    expect(new Set(got.map((g) => g.userId))).toEqual(new Set([memberA, memberB]));
    expect(got.every((g) => g.title.includes(`${PKEY}-1`))).toBe(true);
    expect(got.some((g) => g.userId === botUser)).toBe(false);
  }, 60_000);

  it('**คนที่เปิดเรื่องนั้นไม่ได้ ต้องไม่ได้รับ**', async () => {
    /*
      หัวข้อของการแจ้งเตือนมีคีย์และชื่อเรื่องอยู่ในนั้น · การส่งให้คนที่กดแล้ว
      เจอ 403 จึงเป็นการรั่วของข้อมูล ไม่ใช่แค่การรบกวน
    */
    const got = await prismaClient.notification.findMany({
      where: { workItemId },
      select: { userId: true },
    });
    expect(got.some((g) => g.userId === outsider)).toBe(false);
  }, 60_000);

  it('**ไม่บอกคนที่เพิ่งทำเรื่องนั้นเอง**', async () => {
    await prismaClient.notification.deleteMany({ where: { workItemId } });
    const r = await notifyGroup(ctx, notice({ excludeUserId: memberA ?? null }));
    expect(r.notified).toBe(1);
    const got = await prismaClient.notification.findMany({
      where: { workItemId },
      select: { userId: true },
    });
    expect(got.map((g) => g.userId)).toEqual([memberB]);
  }, 60_000);

  it('**นับคนที่ถูกข้ามเพราะเปิดเรื่องไม่ได้ ไว้ให้ผู้ดูแลเห็น**', async () => {
    /*
      ตัวเลขนี้คือสิ่งเดียวที่บอกว่า "แจ้งไป 1 จาก 2" ต่างจาก "แจ้งไป 1 จาก 1"
      — กลุ่มที่ตั้งผิดจะเงียบเหมือนกลุ่มที่ตั้งถูกทุกประการถ้าไม่มีตัวเลขนี้

      ต้องมีกลุ่มที่สมาชิก **เข้าถึงได้ไม่เท่ากันจริง** · สิทธิ์ให้ผ่านกลุ่ม
      ทุกคนในกลุ่มที่ได้ grant จึงเปิดได้หมด · เคสนี้จึงแจ้งไปที่กลุ่มที่
      *ไม่ได้* รับ grant แล้วใส่คนที่ได้สิทธิ์จากอีกกลุ่มหนึ่งเข้าไปหนึ่งคน
    */
    const blindId = groupIds[1] ?? 0n;
    await prismaClient.groupMember.create({
      data: { tenantId, groupId: blindId, userId: memberA as bigint },
    });
    try {
      await prismaClient.notification.deleteMany({ where: { workItemId } });
      const r = await notifyGroup(ctx, notice({ groupName: BLIND, excludeUserId: null }));
      expect(r.notified).toBe(1);
      expect(r.skippedNoAccess).toBe(1);

      const got = await prismaClient.notification.findMany({
        where: { workItemId },
        select: { userId: true },
      });
      expect(got.map((g) => g.userId)).toEqual([memberA]);
    } finally {
      // คืนสมาชิกภาพให้เหมือนเดิมเสมอ แม้ assertion กลางทางจะล้ม
      await prismaClient.groupMember.deleteMany({
        where: { groupId: blindId, userId: memberA as bigint },
      });
    }
  }, 60_000);
});

describe('B · ความเงียบที่ต้องไม่เกิด', () => {
  it('**กลุ่มที่ไม่มีอยู่ ต้องโยน ไม่ใช่คืน 0**', async () => {
    await expect(notifyGroup(ctx, notice({ groupName: `ไม่มีกลุ่มนี้ ${STAMP}` }))).rejects.toThrow(
      GroupNotFoundError,
    );
  }, 60_000);

  it('ชื่อกลุ่มที่เป็นช่องว่างล้วน ก็ต้องโยน', async () => {
    await expect(notifyGroup(ctx, notice({ groupName: '   ' }))).rejects.toThrow(GroupNotFoundError);
  }, 60_000);

  it('**กลุ่มที่ไม่มีสมาชิก ต้องโยนพร้อมบอกเหตุผล**', async () => {
    const err = await notifyGroup(ctx, notice({ groupName: EMPTY })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NobodyToNotifyError);
    expect(String(err)).toContain('ไม่มีสมาชิก');
  }, 60_000);

  it('**กลุ่มที่ไม่มีใครเปิดโปรเจกต์ได้ ต้องโยนคนละเหตุผล**', async () => {
    /*
      "กลุ่มว่าง" กับ "กลุ่มมีคนแต่เข้าไม่ถึง" แก้กันคนละแบบ — ข้อความเดียวกัน
      ทำให้ผู้ดูแลไปเพิ่มสมาชิกทั้งที่ปัญหาอยู่ที่ชุดสิทธิ์
    */
    const err = await notifyGroup(ctx, notice({ groupName: BLIND })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NobodyToNotifyError);
    expect(String(err)).toContain('เปิดโปรเจกต์นี้ได้');
  }, 60_000);
});

describe('C · เรียกซ้ำ', () => {
  it('**เรียกซ้ำต้องไม่สร้างแถวใหม่** — คีย์ไม่มีเวลาอยู่ในนั้น', async () => {
    /*
      กติกาเดียวกับ jobId ของคิว (CLAUDE.md §4) · รอบกวาดเรียกซ้ำได้ทุกห้านาที
      คีย์ที่มีเวลาจะสร้างแถวใหม่ทุกครั้ง แล้ว unique index ที่มีไว้กันส่งซ้ำ
      ก็ไม่กันอะไรเลย และคนในกลุ่มจะได้รับซ้ำทั้งวัน
    */
    await prismaClient.notification.deleteMany({ where: { workItemId } });
    const first = await notifyGroup(ctx, notice({ excludeUserId: null }));
    expect(first.notified).toBeGreaterThan(0);

    const before = await prismaClient.notification.count({ where: { workItemId } });
    const second = await notifyGroup(ctx, notice({ excludeUserId: null }));
    expect(second.notified).toBe(0);
    expect(await prismaClient.notification.count({ where: { workItemId } })).toBe(before);
  }, 60_000);

  it('เหตุการณ์คนละอย่างบนเรื่องเดียวกัน แจ้งได้ทั้งคู่', async () => {
    // dedupeSeed ต่างกัน = คนละเหตุการณ์ · การกันซ้ำต้องไม่กินของที่ควรส่ง
    const r = await notifyGroup(ctx, notice({ dedupeSeed: `test2:${STAMP}`, excludeUserId: null }));
    expect(r.notified).toBeGreaterThan(0);
  }, 60_000);
});
