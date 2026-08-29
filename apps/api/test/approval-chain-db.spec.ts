/**
 * สายอนุมัติหลายขั้น — ต่อของจริง
 *
 * `approval-chain.spec.ts` พิสูจน์ว่า *ถ้า* ข้อมูลหน้าตาแบบนั้นเข้ามา ผลจะถูก ·
 * มันประกอบข้อมูลนำเข้าขึ้นมาเอง จึงไม่ได้พิสูจน์ว่า**มีอะไรในระบบสร้างข้อมูล
 * แบบนั้นได้จริง** — บทเรียนเดียวกับหมวด F ของ SLA Engine ที่เขียวมาตลอด
 * ทั้งที่ไม่มีโค้ดเส้นไหนสร้างสถานะที่มันบรรยาย
 *
 * ไฟล์นี้จึงถามคำถามเดียว: **สถานะเหล่านั้นไปถึงได้จากทางเข้าจริงหรือเปล่า**
 *
 *   1. `WAITING` มีอยู่จริงในฐานข้อมูลหลังกดขอ — ไม่ใช่แค่ชนิดใน TypeScript
 *   2. `WAITING` → `PENDING` เกิดขึ้นจริงเมื่อขั้นก่อนหน้าผ่าน
 *   3. `WAITING` → `CANCELLED` เกิดขึ้นจริงเมื่อขั้นก่อนหน้าถูกปฏิเสธ
 *   4. คนที่อยู่สองกลุ่มถูกกันจริงตอนตัดสินขั้นที่สอง
 *   5. ขอใหม่หลังถูกปฏิเสธได้ และรอบเก่ายังอ่านย้อนหลังได้ครบ
 *
 * เทสต์สร้างผู้ใช้ · กลุ่ม · งานของตัวเองทั้งหมด แล้วลบทิ้ง — ไม่แตะข้อมูล seed
 * และคีย์ทุกตัวมี stamp ต่อท้าย เพราะ **ตอนกลไกถูกลบเพื่อพิสูจน์ว่าเทสต์แดงได้
 * ค่าที่ "ไม่ควรถูกใช้" จะถูกใช้จริง** แล้วมันจะไปเจอแถวที่มีอยู่
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  AlreadyDecidedInChainError,
  DuplicateGroupInChainError,
  EmptyChainError,
  NotAnApproverError,
  approvalStateOf,
  approvalsFor,
  canDecideNow,
  decideApproval,
  requestApproval,
} from '../src/modules/approval';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let projectId: bigint;
let template: { issueTypeId: bigint; statusId: bigint };
let requesterId: bigint;
let requester: TenantContext;
/** a1 อยู่ทั้งกลุ่ม 1 และกลุ่ม 2 — ตัวที่ใช้พิสูจน์กติกา "คนเดิมตัดสินสองขั้นไม่ได้" */
let a1: TenantContext;
let a2: TenantContext;
let a3: TenantContext;
const userIds: bigint[] = [];
const groupIds: bigint[] = [];
let g1: bigint;
let g2: bigint;
let g3: bigint;
let gEmpty: bigint;
const keys: string[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

/** id ของงานจากคีย์ — `approvalStateOf` รับ id ไม่ใช่คีย์ */
async function itemIdOf(itemKey: string): Promise<bigint> {
  return (await prismaClient.workItem.findFirstOrThrow({ where: { itemKey }, select: { id: true } }))
    .id;
}

/** งานใบใหม่ต่อหนึ่งเคส — เคสที่ใช้ใบร่วมกันจะพังกันเองเมื่อลำดับเปลี่ยน */
async function newItem(tag: string): Promise<string> {
  const itemKey = `SD-CHN${STAMP}${tag}`;
  await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey,
      issueTypeId: template.issueTypeId,
      statusId: template.statusId,
      reporterId: requesterId,
      summary: `ขอเปลี่ยนเซิร์ฟเวอร์ ${tag} ${STAMP}`,
      rank: `zzc${STAMP}${tag}`,
    },
  });
  keys.push(itemKey);
  return itemKey;
}

/** สถานะของทุกขั้นในรอบล่าสุด อ่านตรงจากฐานข้อมูล ไม่ผ่าน service */
async function rawSteps(itemKey: string): Promise<string[]> {
  const rows = await prismaClient.approval.findMany({
    where: { workItem: { itemKey } },
    orderBy: [{ chainSeq: 'desc' }, { stepNumber: 'asc' }],
    select: { chainSeq: true, stepNumber: true, status: true },
  });
  const top = rows[0]?.chainSeq;
  return rows.filter((r) => r.chainSeq === top).map((r) => r.status);
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  projectId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } })).id;
  template = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId },
    select: { issueTypeId: true, statusId: true },
  });

  const mkUser = async (n: string): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `chn-${n}-${STAMP}@example.test`, displayName: `${n} ${STAMP}` },
      select: { id: true },
    });
    userIds.push(u.id);
    return u.id;
  };
  const mkGroup = async (n: string): Promise<bigint> => {
    const g = await prismaClient.userGroup.create({
      data: { tenantId, name: `${n} ${STAMP}` },
      select: { id: true },
    });
    groupIds.push(g.id);
    return g.id;
  };

  requesterId = await mkUser('ผู้ขอ');
  const a1Id = await mkUser('หัวหน้าทีม');
  const a2Id = await mkUser('เจ้าของระบบ');
  const a3Id = await mkUser('กรรมการเปลี่ยนแปลง');
  g1 = await mkGroup('หัวหน้าทีม');
  g2 = await mkGroup('เจ้าของระบบ');
  g3 = await mkGroup('CAB');
  gEmpty = await mkGroup('กลุ่มว่าง');

  await prismaClient.groupMember.createMany({
    data: [
      { tenantId, groupId: g1, userId: a1Id },
      // a1 อยู่กลุ่มที่สองด้วย — สถานการณ์จริงของคนที่เป็นทั้งหัวหน้าทีมและเจ้าของระบบ
      { tenantId, groupId: g2, userId: a1Id },
      { tenantId, groupId: g2, userId: a2Id },
      { tenantId, groupId: g3, userId: a3Id },
    ],
  });

  requester = { tenantId, actorId: requesterId };
  a1 = { tenantId, actorId: a1Id };
  a2 = { tenantId, actorId: a2Id };
  a3 = { tenantId, actorId: a3Id };
}, 120_000);

afterAll(async () => {
  /*
    ลบด้วยเงื่อนไข "ผู้ใช้ของเทสต์สร้าง" ก่อน แล้วค่อยตามด้วยงานที่จำไว้ —
    **ตอนกลไกถูกลบ เคสที่ "ไม่ควรสร้างอะไร" จะสร้างแถวจริง** จึงเชื่อ `keys`
    อย่างเดียวไม่ได้
  */
  await step('คำขอที่ผู้ใช้ของเทสต์สร้าง', () =>
    prismaClient.approval.deleteMany({ where: { requestedById: { in: userIds } } }),
  );
  await step('คำขอบนงานของเทสต์', () =>
    prismaClient.approval.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('แจ้งเตือน', () =>
    prismaClient.notification.deleteMany({ where: { userId: { in: userIds } } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actorId: { in: userIds } } }));
  await step('งานทดสอบ', () =>
    prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { groupId: { in: groupIds } } }),
  );
  await step('ผู้ใช้ของเทสต์', () => prismaClient.user.deleteMany({ where: { id: { in: userIds } } }));
  await step('กลุ่มของเทสต์', () =>
    prismaClient.userGroup.deleteMany({ where: { id: { in: groupIds } } }),
  );

  // ยืนยันว่าเก็บกวาดครอบจริง ไม่ใช่เชื่อว่าลูปทำงาน
  const left = await prismaClient.approval.count({ where: { requestedById: { in: userIds } } });
  if (left > 0) console.error(`เหลือคำขอของเทสต์ค้างอยู่ ${String(left)} แถว`);
  await prismaClient.$disconnect();
});

describe('A · สร้างสาย', () => {
  it('**`WAITING` มีอยู่จริงในฐานข้อมูลหลังกดขอ**', async () => {
    /*
      ข้อพิสูจน์ว่าสถานะนี้ไปถึงได้จากทางเข้าจริง ไม่ใช่แค่ค่าในชนิดของ TypeScript
      ที่ไม่มีใครเคยเขียนลงไป
    */
    const key = await newItem('A1');
    const r = await requestApproval(requester, key, [g1, g2, g3], 'เปลี่ยนเครื่องแม่ข่าย');
    expect(r.steps).toBe(3);
    expect(await rawSteps(key)).toEqual(['PENDING', 'WAITING', 'WAITING']);
    expect(await approvalStateOf(requester, await itemIdOf(key))).toBe('pending');
  });

  it('สายขั้นเดียวยังทำงานเหมือนเดิม', async () => {
    const key = await newItem('A2');
    const r = await requestApproval(requester, key, [g1]);
    expect(r.steps).toBe(1);
    expect(await rawSteps(key)).toEqual(['PENDING']);
  });

  it('**ไม่เลือกกลุ่มเลย = ปฏิเสธ ไม่ใช่สายที่อนุมัติแล้วทันที**', async () => {
    const key = await newItem('A3');
    await expect(requestApproval(requester, key, [])).rejects.toThrow(EmptyChainError);
    expect(await rawSteps(key)).toEqual([]);
  });

  it('**กลุ่มซ้ำในสายเดียว ขอไม่ได้ — และต้องไม่สร้างขั้นไหนทิ้งไว้**', async () => {
    const key = await newItem('A4');
    await expect(requestApproval(requester, key, [g1, g2, g1])).rejects.toThrow(
      DuplicateGroupInChainError,
    );
    // ตรวจทั้งสายก่อนแตะฐานข้อมูล ไม่ใช่สร้างสองขั้นแรกไปแล้วค่อยล้ม
    expect(await rawSteps(key)).toEqual([]);
  });

  it('**กลุ่มว่างที่ขั้นท้าย ๆ ก็ขอไม่ได้ ไม่ใช่ตรวจแค่ขั้นแรก**', async () => {
    const key = await newItem('A5');
    await expect(requestApproval(requester, key, [g1, gEmpty])).rejects.toThrow(NotAnApproverError);
    expect(await rawSteps(key)).toEqual([]);
  });
});

describe('B · เดินสาย', () => {
  it('**อนุมัติขั้นแรกแล้วขั้นที่สองกลายเป็น PENDING จริง**', async () => {
    const key = await newItem('B1');
    await requestApproval(requester, key, [g1, g2, g3]);
    await decideApproval(a1, key, { approve: true });
    expect(await rawSteps(key)).toEqual(['APPROVED', 'PENDING', 'WAITING']);
    // ยังไม่จบ — การตอบว่าอนุมัติแล้วตรงนี้ทำให้งานเดินต่อทั้งที่ยังไม่ผ่าน CAB
    expect(await approvalStateOf(requester, await itemIdOf(key))).toBe('pending');
  });

  it('**คนที่อยู่ทั้งสองกลุ่ม ตัดสินขั้นที่สองไม่ได้**', async () => {
    const key = await newItem('B2');
    await requestApproval(requester, key, [g1, g2]);
    await decideApproval(a1, key, { approve: true });
    // a1 อยู่กลุ่มที่สองจริง ๆ — ด่านที่กันคือกติกาของสาย ไม่ใช่การไม่อยู่กลุ่ม
    await expect(decideApproval(a1, key, { approve: true })).rejects.toThrow(
      AlreadyDecidedInChainError,
    );
    // และต้องไม่แก้อะไรทิ้งไว้ก่อนล้ม
    expect(await rawSteps(key)).toEqual(['APPROVED', 'PENDING']);
    // คนอื่นในกลุ่มเดียวกันยังตัดสินได้ตามปกติ
    await decideApproval(a2, key, { approve: true });
    expect(await approvalStateOf(requester, await itemIdOf(key))).toBe('approved');
  });

  it('อนุมัติครบทุกขั้นจึงจะ approved', async () => {
    const key = await newItem('B3');
    await requestApproval(requester, key, [g1, g2, g3]);
    await decideApproval(a1, key, { approve: true });
    await decideApproval(a2, key, { approve: true });
    expect(await approvalStateOf(requester, await itemIdOf(key))).toBe('pending');
    await decideApproval(a3, key, { approve: true });
    expect(await rawSteps(key)).toEqual(['APPROVED', 'APPROVED', 'APPROVED']);
    expect(await approvalStateOf(requester, await itemIdOf(key))).toBe('approved');
  });

  it('**แจ้งผู้ขอครั้งเดียวตอนสายจบ ไม่ใช่ทุกขั้นที่ผ่าน**', async () => {
    /*
      แจ้งทุกขั้นจะกลายเป็นสามฉบับต่อหนึ่งคำขอ ซึ่งกวนกว่าช่วย และทำให้ฉบับ
      ที่สำคัญจริงจมหายไป · เคสนี้เกิดจากการลบบรรทัด `if (plan.finishes)` แล้ว
      เทสต์ยังเขียวทั้งชุด — แปลว่าไม่มีใครคุ้มบรรทัดนั้นอยู่เลย
    */
    const key = await newItem('B5');
    await requestApproval(requester, key, [g1, g2, g3]);
    const itemId = await itemIdOf(key);
    const decided = async (): Promise<number> =>
      prismaClient.notification.count({
        where: { userId: requesterId, kind: 'approval.decided', workItemId: itemId },
      });

    await decideApproval(a1, key, { approve: true });
    expect(await decided()).toBe(0);
    await decideApproval(a2, key, { approve: true });
    expect(await decided()).toBe(0);

    await decideApproval(a3, key, { approve: true });
    expect(await decided()).toBe(1);
  });

  it('**กลุ่มของขั้นถัดไปได้รับแจ้งตอนขั้นก่อนหน้าผ่าน ไม่ใช่ตั้งแต่ตอนขอ**', async () => {
    /*
      แจ้งทุกกลุ่มพร้อมกันตั้งแต่ตอนขอ จะทำให้ผู้อนุมัติขั้นที่สามเปิดเข้ามา
      แล้วกดอะไรไม่ได้ แล้วสรุปเองว่าระบบพัง
    */
    const key = await newItem('B6');
    const itemId = await itemIdOf(key);
    const waiting = async (ctx: TenantContext): Promise<number> =>
      prismaClient.notification.count({
        where: { userId: ctx.actorId ?? BigInt(0), kind: 'approval.requested', workItemId: itemId },
      });

    await requestApproval(requester, key, [g1, g3]);
    expect(await waiting(a1)).toBe(1);
    expect(await waiting(a3)).toBe(0);

    await decideApproval(a1, key, { approve: true });
    expect(await waiting(a3)).toBe(1);
  });

  it('**ปฏิเสธขั้นกลางแล้วขั้นที่เหลือถูกยกเลิกจริง ไม่ค้างเป็น WAITING**', async () => {
    const key = await newItem('B4');
    await requestApproval(requester, key, [g1, g2, g3]);
    await decideApproval(a1, key, { approve: true });
    await decideApproval(a2, key, { approve: false, note: 'งบไม่พอปีนี้' });
    expect(await rawSteps(key)).toEqual(['APPROVED', 'REJECTED', 'CANCELLED']);
    expect(await approvalStateOf(requester, await itemIdOf(key))).toBe('rejected');
  });
});

describe('D · หน้าจอถามว่าจะให้เห็นปุ่มไหม', () => {
  /*
    `canDecideNow` มีไว้ซ่อนปุ่มที่กดแล้วได้ 403 เท่านั้น · เทสต์ชุดนี้จึงต้อง
    ตอบตรงกับสิ่งที่ `decideApproval` จะยอมจริงทุกกรณี — ไม่งั้นหน้าจอจะสร้าง
    ความเชื่อขึ้นมาเอง ซึ่งเป็นสิ่งที่เจอจริงตอนกดในเบราว์เซอร์: ปุ่มขึ้นให้ทุกคน
    รวมทั้งผู้ขอเอง ทั้งที่คอมเมนต์ในคอมโพเนนต์อ้างว่าขึ้นตามที่เซิร์ฟเวอร์จะยอม
  */
  it('คนในกลุ่มของขั้นที่รออยู่ → เห็นปุ่ม', async () => {
    const key = await newItem('D1');
    await requestApproval(requester, key, [g1, g2]);
    expect(await canDecideNow(a1, key)).toBe(true);
  });

  it('**ผู้ขอไม่เห็นปุ่ม แม้อยู่ในกลุ่มผู้อนุมัติ**', async () => {
    const key = await newItem('D2');
    // ให้ผู้ขออยู่ในกลุ่มของขั้นแรกจริง ๆ — ถ้าดูแค่ "อยู่กลุ่มไหม" จะตอบผิด
    await prismaClient.groupMember.create({
      data: { tenantId, groupId: g1, userId: requesterId },
    });
    try {
      await requestApproval(requester, key, [g1]);
      expect(await canDecideNow(requester, key)).toBe(false);
    } finally {
      // คืนทุกแถวที่จับมา ไม่ใช่เชื่อว่าเคสจบสวย
      await prismaClient.groupMember.deleteMany({
        where: { groupId: g1, userId: requesterId },
      });
    }
  });

  it('คนในกลุ่มของขั้น**ถัดไป** ยังไม่เห็นปุ่ม', async () => {
    const key = await newItem('D3');
    await requestApproval(requester, key, [g1, g2]);
    expect(await canDecideNow(a2, key)).toBe(false);
    await decideApproval(a1, key, { approve: true });
    expect(await canDecideNow(a2, key)).toBe(true);
  });

  it('**คนที่ตัดสินขั้นก่อนหน้าไปแล้ว ไม่เห็นปุ่มของขั้นถัดไป**', async () => {
    const key = await newItem('D4');
    // a1 อยู่ทั้ง g1 และ g2 — ถ้าดูแค่สมาชิกภาพจะตอบว่าเห็น แล้วกดได้ 403
    await requestApproval(requester, key, [g1, g2]);
    await decideApproval(a1, key, { approve: true });
    expect(await canDecideNow(a1, key)).toBe(false);
  });

  it('สายที่จบแล้ว ไม่มีใครเห็นปุ่ม', async () => {
    const key = await newItem('D5');
    await requestApproval(requester, key, [g1]);
    await decideApproval(a1, key, { approve: true });
    expect(await canDecideNow(a1, key)).toBe(false);
    expect(await canDecideNow(a2, key)).toBe(false);
  });

  it('เรื่องที่ไม่มีอยู่ / ยังไม่เคยขอ → ไม่เห็นปุ่ม ไม่ใช่ error', async () => {
    const key = await newItem('D6');
    expect(await canDecideNow(a1, key)).toBe(false);
    expect(await canDecideNow(a1, `SD-ไม่มีจริง${STAMP}`)).toBe(false);
  });
});

describe('C · ขอใหม่', () => {
  it('**ปฏิเสธแล้วขอใหม่ได้ และรอบเก่ายังอ่านย้อนหลังได้ครบ**', async () => {
    const key = await newItem('C1');
    await requestApproval(requester, key, [g1, g2], 'รอบแรก');
    await decideApproval(a1, key, { approve: false, note: 'ยังไม่มีแผนสำรอง' });
    expect(await rawSteps(key)).toEqual(['REJECTED', 'CANCELLED']);

    await requestApproval(requester, key, [g1, g2, g3], 'รอบสอง มีแผนสำรองแล้ว');
    expect(await rawSteps(key)).toEqual(['PENDING', 'WAITING', 'WAITING']);

    const all = await approvalsFor(requester, key);
    expect(all).toHaveLength(5);
    // รอบใหม่มาก่อน และในรอบเรียงตามขั้น — ไม่ใช่ลำดับสุ่มเพราะเวลาเท่ากัน
    expect(all.map((a) => `${String(a.chainSeq)}.${String(a.stepNumber)}`)).toEqual([
      '2.1',
      '2.2',
      '2.3',
      '1.1',
      '1.2',
    ]);
    expect(all[0]?.stepCount).toBe(3);
    expect(all[3]?.stepCount).toBe(2);
    // เหตุผลที่ถูกปฏิเสธรอบแรกต้องยังตอบได้
    expect(all[3]?.decisionNote).toBe('ยังไม่มีแผนสำรอง');
  });
});
