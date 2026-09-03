/**
 * ฟิลด์บนการ์ดที่แต่ละคนเลือก — ต่อกับฐานข้อมูลจริง
 *
 * `card-fields.spec.ts` พิสูจน์ตรรกะของการอ่าน/เขียนค่าบนสตริงที่ประกอบเอง ·
 * ไฟล์นี้พิสูจน์ว่า **มีอะไรในระบบสร้างสถานะเหล่านั้นได้จริง** และที่สำคัญกว่า
 * คือ **สามสถานะแยกกันจริงในฐานข้อมูล**:
 *
 *   1. ไม่มีแถว = ยังไม่เคยตั้ง → ค่าปริยาย
 *   2. แถวที่เก็บสตริงว่าง = ตั้งใจไม่แสดงอะไรเลย
 *   3. แถวที่มีค่า = ตามที่เลือก
 *
 * ข้อ 1 กับ 2 ต่างกันในฐานข้อมูลจริง ๆ ไม่ใช่แค่ในหัวคนเขียน · และต้อง
 * **ไปถึงได้ทั้งสองทาง** — ความแตกต่างที่ผู้ใช้กลับไปไม่ได้ คือความแตกต่าง
 * ที่ไม่มีอยู่จริงสำหรับเขา
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { cardPrefOf, resetCardPref, setCardPref } from '../src/modules/board';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let projectId: bigint;
let projectKey = '';
let me: TenantContext;
let other: TenantContext;
let myId: bigint | undefined;
let otherId: bigint | undefined;

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
    data: { tenantId, name: `ชุดสิทธิ์การ์ด ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `CP${STAMP}`,
      name: `โปรเจกต์ทดสอบการ์ด ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true, key: true },
  });
  projectId = project.id;
  projectKey = project.key;

  const groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `cp ${STAMP}` },
      select: { id: true },
    })
  ).id;
  const mkUser = async (n: string): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `cp-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  myId = await mkUser('me');
  otherId = await mkUser('other');

  await prismaClient.permissionGrant.createMany({
    data: [{ tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId }] as never,
  });
  me = { tenantId, actorId: myId };
  other = { tenantId, actorId: otherId };
}, 180_000);

afterAll(async () => {
  const owners = [myId, otherId].filter((v): v is bigint => v !== undefined);
  await step('ค่าการ์ด', () => prismaClient.boardCardPref.deleteMany({ where: { projectId } }));
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: `CP${STAMP}` } }));
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

const rows = async (): Promise<number> =>
  prismaClient.boardCardPref.count({ where: { projectId } });

describe('A · สามสถานะที่ต้องแยกกันจริง', () => {
  it('ยังไม่เคยตั้ง = ค่าปริยาย และไม่มีแถวในฐานข้อมูล', async () => {
    const got = await cardPrefOf(me, projectKey);
    expect(got.isDefault).toBe(true);
    expect(got.fields).toEqual(['priority', 'assignee']);
    expect(await rows()).toBe(0);
  });

  it('ตั้งค่าแล้วอ่านกลับได้ และมีแถวเดียว', async () => {
    await setCardPref(me, projectKey, ['type', 'updated']);
    const got = await cardPrefOf(me, projectKey);
    expect(got.fields).toEqual(['type', 'updated']);
    expect(got.isDefault).toBe(false);
    expect(await rows()).toBe(1);
  });

  it('ตั้งซ้ำคือทับของเดิม ไม่ใช่เพิ่มแถว', async () => {
    await setCardPref(me, projectKey, ['sprint']);
    expect(await rows()).toBe(1);
    expect((await cardPrefOf(me, projectKey)).fields).toEqual(['sprint']);
  });

  /**
   * **หัวใจของไฟล์นี้**
   *
   * รายการว่างต้องเก็บเป็นแถวที่มีสตริงว่าง **ไม่ใช่ลบแถวทิ้ง** ·
   * ถ้าลบแถว การอ่านกลับจะได้ค่าปริยาย แล้วผู้ใช้ที่ตั้งใจปิดทุกอย่าง
   * จะเห็นของเดิมกลับมา และเชื่อว่าปุ่มบันทึกพัง
   */
  it('**ปิดทุกอย่าง = แถวที่ว่าง ไม่ใช่ลบแถว**', async () => {
    await setCardPref(me, projectKey, []);
    expect(await rows(), 'ลบแถวแทนที่จะเก็บว่าง — จะอ่านกลับได้ค่าปริยาย').toBe(1);
    const got = await cardPrefOf(me, projectKey);
    expect(got.fields).toEqual([]);
    expect(got.isDefault, 'อ่านกลับได้ว่ายังไม่เคยตั้ง ทั้งที่เพิ่งตั้งไป').toBe(false);
  });

  /**
   * **ต้องกลับไปเป็น "ยังไม่เคยตั้ง" ได้**
   *
   * ถ้าไปถึงไม่ได้ ผู้ใช้ที่ปิดทุกช่องแล้วจะติดอยู่ตรงนั้นตลอดไป ·
   * ความแตกต่างที่ผู้ใช้กลับไปไม่ได้ คือความแตกต่างที่ไม่มีอยู่จริงสำหรับเขา
   */
  it('**ล้างค่าแล้วกลับไปเป็นยังไม่เคยตั้ง และแถวหายไปจริง**', async () => {
    const got = await resetCardPref(me, projectKey);
    expect(got.isDefault).toBe(true);
    expect(got.fields).toEqual(['priority', 'assignee']);
    expect(await rows()).toBe(0);
  });

  it('ล้างซ้ำตอนที่ไม่มีแถวอยู่แล้ว = เงียบ ไม่ใช่ error', async () => {
    await expect(resetCardPref(me, projectKey)).resolves.toBeDefined();
    expect(await rows()).toBe(0);
  });
});

describe('B · เป็นค่าของแต่ละคน', () => {
  /**
   * **ไม่มีใครแก้ของคนอื่นได้** — `userId` มาจาก `ctx.actorId` เสมอ
   * ไม่ใช่จากพารามิเตอร์ที่ผู้เรียกส่งมา · การรับตัวตนจากฝั่งผู้เรียก
   * เป็นวิธีที่ระบบสิทธิ์รั่วบ่อยที่สุด (เคยเกิดกับ `?view=` มาแล้ว)
   */
  it('**ตั้งของตัวเองแล้ว ของคนอื่นไม่เปลี่ยน**', async () => {
    await setCardPref(me, projectKey, ['type']);
    expect((await cardPrefOf(me, projectKey)).fields).toEqual(['type']);
    const theirs = await cardPrefOf(other, projectKey);
    expect(theirs.isDefault, 'ค่าของคนอื่นถูกเปลี่ยนไปด้วย').toBe(true);
    expect(theirs.fields).toEqual(['priority', 'assignee']);
    await resetCardPref(me, projectKey);
  });

  it('สองคนตั้งคนละอย่างได้พร้อมกัน', async () => {
    await setCardPref(me, projectKey, ['type']);
    await setCardPref(other, projectKey, ['sprint', 'updated']);
    expect((await cardPrefOf(me, projectKey)).fields).toEqual(['type']);
    expect((await cardPrefOf(other, projectKey)).fields).toEqual(['sprint', 'updated']);
    expect(await rows()).toBe(2);
    await resetCardPref(me, projectKey);
    await resetCardPref(other, projectKey);
    expect(await rows()).toBe(0);
  });
});

describe('C · โปรเจกต์ที่เปิดดูไม่ได้', () => {
  it('ผู้ใช้ที่ไม่อยู่กลุ่มไหนเลย ตั้งค่าไม่ได้', async () => {
    const nobody: TenantContext = { tenantId, actorId: null };
    await expect(cardPrefOf(nobody, projectKey)).rejects.toThrow();
    expect(await rows()).toBe(0);
  });
});
