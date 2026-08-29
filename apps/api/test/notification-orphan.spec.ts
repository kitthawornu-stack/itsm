/**
 * แถวแจ้งเตือนต้องไม่ค้างเมื่อสิ่งที่มันชี้ถึงหายไป
 *
 * ตาราง `notification` **ไม่เคยมี foreign key เลยสักตัว** · ลบผู้ใช้หรือลบงาน
 * แล้วแถวค้างอยู่เงียบ ๆ ไม่มี error สักบรรทัด และไม่มีใครเห็นเพราะทุกคิวรี
 * กรองด้วย `userId` ของคนที่ล็อกอินอยู่ — แถวกำพร้าจึงไม่โผล่ที่ไหนเลย
 *
 * วัดจริงในฐานข้อมูลพัฒนา: **170 แถวชี้ไปหาผู้ใช้ที่ถูกลบไปแล้ว** สะสมจาก
 * เทสต์ที่สร้างผู้ใช้แล้วลบ และรั่วเพิ่มทุกครั้งที่รัน CI
 *
 * นี่คือบทเรียน "อะไรที่ผิดแล้วยังเรนเดอร์ได้ ต้องมีเทสต์" ในรูปของฐานข้อมูล —
 * ระบบทำงานปกติทุกอย่างขณะที่ข้อมูลค่อย ๆ เสีย · การไล่ให้ทุกเทสต์เก็บกวาดเอง
 * คือรายการที่คนดูแลด้วยมือ ซึ่ง CLAUDE.md ห้ามไว้ · ด่านต้องอยู่ที่สคีมา
 *
 * เทสต์นี้ยืนยันสองอย่างที่ต่างกัน:
 *   1. **ตอนนี้ไม่มีแถวกำพร้าเหลืออยู่เลย** — สแกนของจริงทั้งตาราง
 *   2. **cascade ทำงานจริง** — ลบผู้ใช้/ลบงานที่เทสต์สร้างเอง แล้วแถวหายตาม
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prismaClient } from '../src/infrastructure/prisma/client';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let projectId: bigint;
let template: { issueTypeId: bigint; statusId: bigint };
/** ผู้แจ้งที่อยู่ตลอดการทดสอบ — งานต้องมีผู้แจ้ง และเราไม่อยากลบมันกลางคัน */
let reporterId: bigint;
const userIds: bigint[] = [];
const keys: string[] = [];

async function orphanCounts(): Promise<{ user: number; workItem: number; tenant: number }> {
  const r = await prismaClient.$queryRawUnsafe<
    Array<{ us: bigint; wi: bigint; te: bigint }>
  >(
    'SELECT ' +
      '(SELECT COUNT(*) FROM notification n LEFT JOIN user u ON u.id = n.user_id ' +
      'WHERE n.user_id IS NOT NULL AND u.id IS NULL) us, ' +
      '(SELECT COUNT(*) FROM notification n LEFT JOIN work_item w ON w.id = n.work_item_id ' +
      'WHERE n.work_item_id IS NOT NULL AND w.id IS NULL) wi, ' +
      '(SELECT COUNT(*) FROM notification n LEFT JOIN tenant t ON t.id = n.tenant_id ' +
      'WHERE t.id IS NULL) te',
  );
  const row = r[0];
  return {
    user: Number(row?.us ?? 0),
    workItem: Number(row?.wi ?? 0),
    tenant: Number(row?.te ?? 0),
  };
}

/** งานของเทสต์เอง — ห้ามแตะงานของ seed */
async function mkItem(tag: string, reporterId: bigint): Promise<bigint> {
  const itemKey = `SD-ORP${STAMP}${tag}`;
  const w = await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey,
      issueTypeId: template.issueTypeId,
      statusId: template.statusId,
      reporterId,
      summary: `[orphan] ${tag} ${STAMP}`,
      rank: `zzo${STAMP}${tag}`,
    },
    select: { id: true, itemKey: true },
  });
  keys.push(w.itemKey);
  return w.id;
}

async function mkUser(tag: string): Promise<bigint> {
  const u = await prismaClient.user.create({
    data: {
      tenantId,
      email: `orp-${tag}-${STAMP}@example.test`,
      displayName: `ผู้ใช้ orphan ${tag} ${STAMP}`,
    },
    select: { id: true },
  });
  userIds.push(u.id);
  return u.id;
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  projectId = (await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } })).id;
  template = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId },
    select: { issueTypeId: true, statusId: true },
  });
  reporterId = await mkUser('ผู้แจ้ง');
}, 120_000);

afterAll(async () => {
  /*
    ลบตามลำดับที่ FK ยอม · แจ้งเตือนหายตาม cascade อยู่แล้ว แต่ลบให้ชัดไว้ก่อน
    องค์กรของเทสต์ต้องเก็บกวาดด้วย เพราะ **ตอน FK ถูกถอดเพื่อพิสูจน์ว่าเทสต์
    แดงได้ เคสนั้นล้มก่อนถึงบรรทัดลบ** แล้วองค์กรจะค้างอยู่จริง
  */
  await prismaClient.notification.deleteMany({ where: { tenant: { key: `orphan-${STAMP}` } } });
  await prismaClient.tenant.deleteMany({ where: { key: `orphan-${STAMP}` } });
  await prismaClient.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } });
  await prismaClient.user.deleteMany({ where: { id: { in: userIds } } });
  await prismaClient.$disconnect();
});

describe('แจ้งเตือนที่ไม่มีเจ้าของ', () => {
  it('**ตอนนี้ไม่มีแถวกำพร้าเหลืออยู่เลย** — สแกนของจริงทั้งตาราง', async () => {
    /*
      สแกนทั้งตาราง ไม่ใช่เฉพาะแถวที่เทสต์สร้าง · แถวกำพร้าที่เหลืออยู่แปลว่า
      มีทางรั่วที่ยังไม่ถูกปิด — และมันจะสะสมต่อไปเงียบ ๆ เหมือนที่ผ่านมา
    */
    expect(await orphanCounts()).toEqual({ user: 0, workItem: 0, tenant: 0 });
  });

  it('**ลบผู้ใช้แล้วแจ้งเตือนของเขาหายตาม**', async () => {
    const userId = await mkUser('ผู้รับ');
    const workItemId = await mkItem('U', reporterId);
    const created = await prismaClient.notification.create({
      data: {
        tenantId,
        userId,
        workItemId,
        kind: 'workitem.assigned',
        title: `[orphan] มอบหมายให้คุณ ${STAMP}`,
        dedupeKey: `orphan-user:${STAMP}`,
      },
      select: { id: true },
    });
    // แถว delivery ต้องหายตามด้วย — มันชี้มาที่ notification อีกทอด
    await prismaClient.notificationDelivery.create({
      data: { tenantId, notificationId: created.id, channel: 'email', state: 'pending' },
    });

    await prismaClient.user.delete({ where: { id: userId } });
    userIds.splice(userIds.indexOf(userId), 1);

    expect(await prismaClient.notification.count({ where: { id: created.id } })).toBe(0);
    expect(
      await prismaClient.notificationDelivery.count({ where: { notificationId: created.id } }),
    ).toBe(0);
  });

  it('**ลบงานแล้วแจ้งเตือนของงานนั้นหายตาม**', async () => {
    const userId = await mkUser('ผู้รับงาน');
    const workItemId = await mkItem('W', reporterId);
    const created = await prismaClient.notification.create({
      data: {
        tenantId,
        userId,
        workItemId,
        kind: 'comment.added',
        title: `[orphan] มีความเห็นใหม่ ${STAMP}`,
        dedupeKey: `orphan-item:${STAMP}`,
      },
      select: { id: true },
    });

    await prismaClient.workItem.delete({ where: { id: workItemId } });
    keys.splice(keys.indexOf(`SD-ORP${STAMP}W`), 1);

    expect(await prismaClient.notification.count({ where: { id: created.id } })).toBe(0);
    // ผู้ใช้ยังอยู่ — cascade ต้องมาจากงาน ไม่ใช่พลอยลบผู้ใช้ไปด้วย
    expect(await prismaClient.user.count({ where: { id: userId } })).toBe(1);
  });

  it('**ลบองค์กรแล้วแจ้งเตือนขององค์กรนั้นหายตาม**', async () => {
    /*
      เคสนี้ต้อง **สร้างองค์กรของตัวเองแล้วลบ** — ลบองค์กร `default` คือการ
      ทำลายฐานข้อมูลพัฒนาทั้งใบ · ตอนถอด FK ทีละตัวเพื่อพิสูจน์ว่าเทสต์แดงได้
      ด่านของ `tenant_id` **เขียวสนิท** เพราะไม่มีเทสต์ไหนลบองค์กรเลย
      บรรทัดที่ลบแล้วยังเขียวคือบรรทัดที่ไม่มีเทสต์คุ้ม

      องค์กรที่สร้างใหม่ไม่มี `workflow_scheme` จึงไม่ชนกับ `onDelete: Restrict`
      ที่ทำให้ cascade ของ tenant ใช้ไม่ได้ในกรณีทั่วไป (ดู CLAUDE.md §3)
    */
    const t = await prismaClient.tenant.create({
      data: { key: `orphan-${STAMP}`, name: `องค์กรทดสอบ orphan ${STAMP}` },
      select: { id: true },
    });
    const created = await prismaClient.notification.create({
      data: {
        tenantId: t.id,
        kind: 'automation.notice',
        title: `[orphan] ขององค์กรที่จะถูกลบ ${STAMP}`,
        dedupeKey: `orphan-tenant:${STAMP}`,
      },
      select: { id: true },
    });

    await prismaClient.tenant.delete({ where: { id: t.id } });

    expect(await prismaClient.notification.count({ where: { id: created.id } })).toBe(0);
    expect(await prismaClient.tenant.count({ where: { id: t.id } })).toBe(0);
  });

  it('แจ้งเตือนที่ไม่ระบุตัวบุคคล (`userId` ว่าง) ยังสร้างได้', async () => {
    /*
      `userId` เป็น null ได้โดยตั้งใจ — การแจ้งเตือนระดับทีมที่ยังไม่ระบุตัวคน ·
      FK ที่เผลอทำให้คอลัมน์นี้บังคับ จะตัดความสามารถนั้นทิ้งโดยไม่มีใครสังเกต
      จนกว่าจะมีคนเรียกใช้
    */
    const workItemId = await mkItem('N', reporterId);
    const created = await prismaClient.notification.create({
      data: {
        tenantId,
        userId: null,
        workItemId,
        kind: 'automation.notice',
        title: `[orphan] ไม่ระบุผู้รับ ${STAMP}`,
        dedupeKey: `orphan-null:${STAMP}`,
      },
      select: { id: true, userId: true },
    });
    expect(created.userId).toBeNull();
    await prismaClient.notification.delete({ where: { id: created.id } });
  });
});
