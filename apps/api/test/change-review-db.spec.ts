/**
 * การทบทวนหลังทำ — ต่อของจริง
 *
 * `change-review.spec.ts` ประกอบข้อมูลนำเข้าขึ้นมาเอง จึงพิสูจน์ได้แค่ว่า
 * *ถ้า* ข้อมูลหน้าตาแบบนั้นเข้ามา ผลจะถูก · ไฟล์นี้ถามคำถามที่เอนจินตอบไม่ได้:
 *
 *   1. **ช่วงเวลาที่นัดไว้เดินทางมาถึงเอนจินจริงไหม** — ถ้า service ไม่อ่าน
 *      `change_window` มาให้ ทุกใบจะทบทวนไม่ได้ หรือแย่กว่านั้นคือทบทวนได้หมด
 *   2. **หนึ่งการเปลี่ยนแปลง หนึ่งการทบทวน** — กดบันทึกซ้ำต้องแทนที่ ไม่ใช่เพิ่ม
 *   3. **แก้แล้วเหลือร่องรอย** — ประวัติต้องบอกได้ว่าเปลี่ยนจากอะไรเป็นอะไร
 *   4. **ด่านสิทธิ์** — อ่านใช้ `BROWSE_PROJECT` เขียนใช้ `EDIT_ITEM`
 *   5. **ไม่ผูกกับสถานะของงาน** — งานที่ล้มเหลวมักถูกเปิดใหม่ ถ้าใช้ "ปิดแล้ว"
 *      เป็นเงื่อนไข ใบที่ต้องทบทวนที่สุดจะทบทวนไม่ได้เลย
 *
 * เทสต์สร้างงาน ผู้ใช้ และกลุ่มของตัวเองทั้งหมด แล้วลบทิ้ง ไม่แตะข้อมูล seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toUtcDate, type TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError, type PermissionKey } from '../src/modules/permission';
import {
  ContradictoryReviewError,
  NotImplementedYetError,
  ReviewNotesRequiredError,
  reviewOf,
  saveReview,
  setWindow,
} from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);
/** ทุกเวลาอิงวันที่ตายตัว — "ตอนนี้" ส่งเข้าไปเสมอ ไม่อ่านนาฬิกาในเทสต์ */
const NOW = toUtcDate('2028-11-20T00:00:00.000Z');

let tenantId: bigint;
let projectId: bigint;
let template: { issueTypeId: bigint; statusId: bigint; doneStatusId: bigint };
let ctx: TenantContext;
let outsiderCtx: TenantContext;
/** เปิดดูได้อย่างเดียว — คนที่แยก "อ่าน" ออกจาก "เขียน" ได้ */
let readerCtx: TenantContext;
let readerGroupId: bigint;
let actorId: bigint;
let groupId: bigint;
const grantIds: bigint[] = [];
const keys: string[] = [];
const ids = new Map<string, bigint>();

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function newItem(tag: string, o: { done?: boolean } = {}): Promise<string> {
  /** คีย์มี stamp เสมอ — ตอนกลไกถูกลบ ค่าที่ "ไม่ควรถูกใช้" จะถูกใช้จริง */
  const itemKey = `SD-PIR${STAMP}${tag}`;
  const w = await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey,
      issueTypeId: template.issueTypeId,
      statusId: o.done === true ? template.doneStatusId : template.statusId,
      reporterId: actorId,
      summary: `[ทบทวน] ${tag} ${STAMP}`,
      rank: `0aaPIR${STAMP}${tag}`,
    },
    select: { id: true },
  });
  keys.push(itemKey);
  ids.set(tag, w.id);
  return itemKey;
}

/** ตั้งช่วงเวลาที่ **เริ่มไปแล้ว** เทียบกับ NOW */
async function windowStarted(key: string): Promise<void> {
  await setWindow(
    ctx,
    key,
    { plannedStart: '2028-11-19T18:00:00.000Z', plannedEnd: '2028-11-19T21:00:00.000Z' },
    NOW,
  );
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
  template = {
    issueTypeId: any.issueTypeId,
    statusId: await pick('TODO'),
    doneStatusId: await pick('DONE'),
  };

  const mkUser = async (tag: string): Promise<bigint> =>
    (
      await prismaClient.user.create({
        data: {
          tenantId,
          email: `pir-${tag}-${STAMP}@example.test`,
          displayName: `QA ทบทวน ${tag} ${STAMP}`,
        },
        select: { id: true },
      })
    ).id;
  actorId = await mkUser('actor');
  ctx = { tenantId, actorId };
  // ไม่ใส่เข้ากลุ่มไหนเลย — "ข้อมูลที่ไม่ครบต้องแปลว่าไม่มีสิทธิ์"
  outsiderCtx = { tenantId, actorId: await mkUser('outsider') };
  const readerId = await mkUser('reader');
  readerCtx = { tenantId, actorId: readerId };

  const schemeId = (
    await prismaClient.project.findFirstOrThrow({
      where: { id: projectId },
      select: { permissionSchemeId: true },
    })
  ).permissionSchemeId;
  if (schemeId === null) throw new Error('โปรเจกต์ SD ไม่มี permission scheme');
  groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `ทบทวนหลังทำ ${STAMP}` },
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

  /*
    **กลุ่มที่เปิดดูได้อย่างเดียว** — จำเป็นเพื่อแยก "อ่าน" ออกจาก "เขียน" ·
    ถ้ามีแต่คนนอกที่ไม่มีสิทธิ์อะไรเลย การเปลี่ยนด่านเขียนจาก `EDIT_ITEM`
    เป็น `BROWSE_PROJECT` จะยังเขียว เพราะคนนอกไม่มีทั้งสองอย่างอยู่แล้ว
    (เจอตอนลบกลไกทีละบรรทัด — เทสต์ชุดแรกไม่ได้ตรึงด่านเขียนไว้เลย)
  */
  readerGroupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `ทบทวนหลังทำ (อ่าน) ${STAMP}` },
      select: { id: true },
    })
  ).id;
  await prismaClient.groupMember.create({
    data: { tenantId, groupId: readerGroupId, userId: readerId },
  });
  const rg = await prismaClient.permissionGrant.create({
    data: { tenantId, schemeId, permission: 'BROWSE_PROJECT', groupId: readerGroupId },
    select: { id: true },
  });
  grantIds.push(rg.id);
}, 120_000);

afterAll(async () => {
  await step('การทบทวน', () =>
    prismaClient.changeReview.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  await step('หน้าต่างเวลา', () =>
    prismaClient.changeWindow.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
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
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { groupId: { in: [groupId, readerGroupId] } } }),
  );
  await step('ผู้ใช้ของเทสต์', () =>
    prismaClient.user.deleteMany({ where: { email: { contains: STAMP } } }),
  );
  await step('กลุ่มของเทสต์', () =>
    prismaClient.userGroup.deleteMany({ where: { id: { in: [groupId, readerGroupId] } } }),
  );

  // ยืนยันด้วยการนับหลังคืน ไม่ใช่เชื่อว่าลูปทำงาน
  const left = await prismaClient.changeReview.count({
    where: { workItem: { itemKey: { startsWith: `SD-PIR${STAMP}` } } },
  });
  if (left > 0) console.error(`เหลือการทบทวนของเทสต์ค้างอยู่ ${String(left)} ใบ`);
  await prismaClient.$disconnect();
});

describe('ทบทวนหลังทำ · ต่อของจริง', () => {
  it('ยังไม่เคยทบทวน = `null` ไม่ใช่ error', async () => {
    const key = await newItem('NONE');
    const st = await reviewOf(ctx, key);
    expect(st.review).toBeNull();
    // ยังไม่ได้ตั้งช่วงเวลา จึงยังทบทวนไม่ได้ และหน้าจอต้องบอกเหตุผลนั้นได้
    expect(st.reviewableFrom).toBeNull();
  });

  /**
   * **ช่วงเวลาที่นัดไว้ต้องเดินทางมาถึงเอนจินจริง**
   *
   * ถ้า service ไม่อ่าน `change_window` มาให้ เอนจินจะเห็น `window: null`
   * เสมอ แล้วทุกใบจะทบทวนไม่ได้ — หรือถ้าส่งค่าปลอมมา ทุกใบจะทบทวนได้หมด
   * ทั้งที่ยังไม่ถึงเวลา · สองเคสนี้แยกสองทางนั้นออกจากกัน
   */
  it('**งานที่ยังไม่ได้กำหนดช่วงเวลา ทบทวนไม่ได้**', async () => {
    const key = await newItem('NOWIN');
    await expect(
      saveReview(ctx, key, { outcome: 'SUCCESS', rolledBack: false, notes: '' }, NOW),
    ).rejects.toThrow(NotImplementedYetError);
  });

  it('**ช่วงเวลาที่ยังไม่ถึง ทบทวนไม่ได้**', async () => {
    const key = await newItem('FUTURE');
    await setWindow(
      ctx,
      key,
      { plannedStart: '2029-01-05T18:00:00.000Z', plannedEnd: '2029-01-05T20:00:00.000Z' },
      NOW,
    );
    await expect(
      saveReview(ctx, key, { outcome: 'SUCCESS', rolledBack: false, notes: '' }, NOW),
    ).rejects.toThrow(NotImplementedYetError);
  });

  it('ช่วงเวลาที่เริ่มไปแล้ว ทบทวนได้ และอ่านกลับได้', async () => {
    const key = await newItem('OK');
    await windowStarted(key);
    await saveReview(
      ctx,
      key,
      { outcome: 'SUCCESS', rolledBack: false, notes: '  ย้ายเสร็จก่อนเวลา  ' },
      NOW,
    );
    const r = (await reviewOf(ctx, key)).review;
    expect(r?.outcome).toBe('SUCCESS');
    expect(r?.outcomeLabel).toBe('สำเร็จตามแผน');
    expect(r?.notes).toBe('ย้ายเสร็จก่อนเวลา');
    expect(r?.reviewedBy).toContain(STAMP);
  });

  /**
   * **ไม่ผูกกับสถานะของงาน**
   *
   * งานที่ล้มเหลวมักถูกเปิดใหม่ · ถ้าใช้ "ปิดแล้ว" เป็นเงื่อนไข การเปลี่ยนแปลง
   * ที่ล้มเหลว ซึ่งเป็นใบที่ต้องทบทวนที่สุด จะทบทวนไม่ได้เลย
   */
  it('**งานที่ยังไม่ปิด ทบทวนได้ ถ้าช่วงเวลาเริ่มไปแล้ว**', async () => {
    const key = await newItem('OPEN');
    await windowStarted(key);
    const r = await saveReview(
      ctx,
      key,
      { outcome: 'FAILED', rolledBack: true, notes: 'ไดรเวอร์รุ่นใหม่ไม่รองรับการ์ดเดิม' },
      NOW,
    );
    expect(r.outcome).toBe('FAILED');
    expect(r.rolledBack).toBe(true);
  });

  it('**หนึ่งการเปลี่ยนแปลง หนึ่งการทบทวน** — บันทึกซ้ำแทนที่ ไม่ใช่เพิ่ม', async () => {
    const key = await newItem('TWICE');
    await windowStarted(key);
    await saveReview(ctx, key, { outcome: 'SUCCESS', rolledBack: false, notes: '' }, NOW);
    await saveReview(
      ctx,
      key,
      { outcome: 'PARTIAL', rolledBack: false, notes: 'ย้ายได้แค่ฐานข้อมูลหลัก' },
      NOW,
    );
    const rows = await prismaClient.changeReview.count({
      where: { workItemId: ids.get('TWICE') ?? BigInt(0) },
    });
    expect(rows).toBe(1);
    expect((await reviewOf(ctx, key)).review?.outcome).toBe('PARTIAL');
  });

  it('**แก้แล้วประวัติบอกได้ว่าเปลี่ยนจากอะไรเป็นอะไร**', async () => {
    const rows = await prismaClient.workItemHistory.findMany({
      where: { workItemId: ids.get('TWICE') ?? BigInt(0), field: 'changeReview' },
      orderBy: { id: 'asc' },
      select: { oldValue: true, newValue: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.oldValue).toBeNull();
    expect(rows[0]?.newValue).toBe('สำเร็จตามแผน');
    expect(rows[1]?.oldValue).toBe('สำเร็จตามแผน');
    expect(rows[1]?.newValue).toBe('สำเร็จบางส่วน');
  });

  it('ความขัดแย้งจากเอนจิน ถูกปฏิเสธก่อนแตะฐานข้อมูล', async () => {
    const key = await newItem('BAD');
    await windowStarted(key);
    await expect(
      saveReview(ctx, key, { outcome: 'SUCCESS', rolledBack: true, notes: '' }, NOW),
    ).rejects.toThrow(ContradictoryReviewError);
    await expect(
      saveReview(ctx, key, { outcome: 'FAILED', rolledBack: true, notes: '  ' }, NOW),
    ).rejects.toThrow(ReviewNotesRequiredError);
    const st = await reviewOf(ctx, key);
    expect(st.review).toBeNull();
    /*
      ใบนี้ **มี** ช่วงเวลาแล้ว — ยืนยันไว้เพื่อให้ชัดว่าที่ถูกปฏิเสธข้างบน
      มาจากกติกาของเนื้อหา ไม่ใช่จาก "ยังไม่ถึงเวลา" ซึ่งเป็นคนละเหตุผล
    */
    expect(st.reviewableFrom).not.toBeNull();
  });

  /**
   * **`reviewableFrom` มาจากช่วงเวลาจริง** — หน้าจอใช้ค่านี้บอกว่าทบทวนได้
   * ตั้งแต่เมื่อไร · ถ้าคำนวณเองที่หน้าจอ สองที่จะเพี้ยนกันในวันที่กติกาเปลี่ยน
   */
  it('**บอกได้ว่าทบทวนได้ตั้งแต่เมื่อไร ตรงกับช่วงเวลาที่ตั้งไว้**', async () => {
    const key = await newItem('FROM');
    await windowStarted(key);
    expect((await reviewOf(ctx, key)).reviewableFrom).toBe('2028-11-19T18:00:00.000Z');
  });

  it('**คนที่ไม่มีสิทธิ์ อ่านและเขียนการทบทวนไม่ได้**', async () => {
    const key = await newItem('SEC');
    await windowStarted(key);
    await saveReview(ctx, key, { outcome: 'SUCCESS', rolledBack: false, notes: '' }, NOW);
    // เจ้าของสิทธิ์อ่านได้ — ถ้าเคสนี้ล้ม แปลว่าด่านกันผิดคน ไม่ใช่กันถูกคน
    expect((await reviewOf(ctx, key)).review).not.toBeNull();
    await expect(reviewOf(outsiderCtx, key)).rejects.toThrow(PermissionDeniedError);
    await expect(
      saveReview(outsiderCtx, key, { outcome: 'FAILED', rolledBack: true, notes: 'แอบแก้' }, NOW),
    ).rejects.toThrow(PermissionDeniedError);

    /*
      ตรวจ **ค่าในแถว** ไม่ใช่แค่ว่าโยน error — ด่านที่อยู่หลังการเขียน
      จะโยนหลังจากข้อมูลเสียไปแล้ว (CLAUDE.md: การนับแถวจับการแก้ค่าไม่ได้)
    */
    expect((await reviewOf(ctx, key)).review?.outcome).toBe('SUCCESS');
  });

  /**
   * **"อ่านได้" ไม่ใช่ "เขียนได้"**
   *
   * ด่านอ่านใช้ `BROWSE_PROJECT` ด่านเขียนใช้ `EDIT_ITEM` · ถ้าไม่มีเคสนี้
   * การเปลี่ยนด่านเขียนให้เหลือแค่ `BROWSE_PROJECT` จะไม่มีอะไรจับได้เลย
   * — ผลคือใครก็ตามที่เปิดดูโปรเจกต์ได้ จะเขียนผลการทบทวนทับได้
   */
  it('**คนที่เปิดดูได้อย่างเดียว อ่านการทบทวนได้ แต่เขียนไม่ได้**', async () => {
    const key = await newItem('READONLY');
    await windowStarted(key);
    await saveReview(
      ctx,
      key,
      { outcome: 'PARTIAL', rolledBack: false, notes: 'ย้ายได้แค่ครึ่ง' },
      NOW,
    );

    expect((await reviewOf(readerCtx, key)).review?.outcome).toBe('PARTIAL');
    await expect(
      saveReview(readerCtx, key, { outcome: 'SUCCESS', rolledBack: false, notes: '' }, NOW),
    ).rejects.toThrow(PermissionDeniedError);
    expect((await reviewOf(ctx, key)).review?.outcome).toBe('PARTIAL');
  });
});
