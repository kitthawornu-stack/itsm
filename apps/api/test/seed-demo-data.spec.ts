/**
 * ฟีเจอร์ที่เสร็จแล้ว ต้องมีข้อมูลตัวอย่างให้เห็น
 *
 * เจ็ดตารางเคยว่างเปล่าบนทุกเครื่อง เพราะ `seed.ts` ไม่เคยสร้างมัน · ฟีเจอร์
 * ที่เช็กลิสต์กาว่าเสร็จจึงเปิดหน้าจอแล้วว่างเปล่าเสมอ และไม่มีใครเคยเห็น
 * มันทำงาน — **"ฟีเจอร์ยังไม่มี" กับ "ไม่เคยมีข้อมูลตัวอย่างเลย" ให้อาการ
 * เหมือนกันบนหน้าจอ** และมันบล็อกการตรวจจริงไปแล้วสามครั้ง
 *
 * ด่านนี้ถามฐานข้อมูลตรง ๆ ว่ายังมีของอยู่ไหม · ใช้ขอบล่างเท่านั้น จึงไม่แกว่ง
 * ตามแถวที่ไฟล์เทสต์อื่นสร้างขึ้นพร้อมกัน
 *
 * ถ้าแดง: รัน `pnpm --filter @itsm/api seed`
 *
 * **ยังไม่ครอบ**: ฐานข้อมูลที่เพิ่ง seed ยังมี **38 ตารางที่ว่างทั้งใบ**
 * (นับจาก `information_schema` เมื่อ 2569-09-11) · ด่านนี้ครอบแค่ไม่กี่ใบ
 * ที่เติมไปแล้ว — เช่น `change_window` · `automation_rule` · `dashboard`
 * ยังไม่มีข้อมูลตัวอย่างเลย · เขียนไว้ตรงนี้เพราะด่านที่ไม่บอกขอบเขต
 * ของตัวเอง ทำให้คนเชื่อว่ามันครอบหมด
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient as prisma } from '../src/infrastructure/prisma/client';
import { listComments } from '../src/modules/workitem/comment.service';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ข้อมูลตัวอย่างของฟีเจอร์ที่เสร็จแล้ว', () => {
  it('**ทะเบียน CI มีของ และมีเส้นพึ่งพา**', async () => {
    expect(await prisma.configurationItem.count()).toBeGreaterThanOrEqual(10);
    expect(await prisma.ciDependency.count()).toBeGreaterThanOrEqual(10);
  });

  /**
   * **สายพึ่งพาต้องลึกอย่างน้อยสามชั้น** — เส้นชั้นเดียวทำให้แผงผลกระทบ
   * แสดงว่า "ไม่กระทบอะไร" ทุกใบ ซึ่งอ่านเหมือนฟีเจอร์พัง ไม่ใช่เหมือน
   * ข้อมูลตัวอย่างบาง
   */
  it('**สายพึ่งพาลึกพอที่ผลกระทบจะไม่เป็นศูนย์**', async () => {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM ci_dependency a
      JOIN ci_dependency b ON b.dependent_id = a.depends_on_id
      JOIN ci_dependency c ON c.dependent_id = b.depends_on_id`;
    expect(Number(rows[0]?.n ?? 0)).toBeGreaterThan(0);
  });

  it('มีเรื่องที่ผูก CI ไว้จริง — แผงผลกระทบจึงมีของให้แสดง', async () => {
    expect(await prisma.workItemCi.count()).toBeGreaterThanOrEqual(5);
  });

  /**
   * **ต้องมีทั้งที่เผยแพร่แล้วและที่ยังไม่เผยแพร่** · ถ้ามีแต่แบบเดียว
   * ความต่างระหว่าง "ทีมเห็น" กับ "ผู้แจ้งเห็นด้วย" จะไม่มีใครเคยเห็น
   */
  it('**คลังความรู้มีทั้งสองสถานะ**', async () => {
    expect(await prisma.knowledgeArticle.count({ where: { isPublished: true } })).toBeGreaterThan(0);
    expect(await prisma.knowledgeArticle.count({ where: { isPublished: false } })).toBeGreaterThan(
      0,
    );
  });

  it('มีบทความที่ถูกแนบกับเรื่องจริง — คลังที่ไม่เคยถูกแนบอ่านเหมือนไม่มีใครใช้', async () => {
    expect(await prisma.workItemArticle.count()).toBeGreaterThan(0);
  });
});

describe('ข้อมูลตัวอย่างของรอบการทำงานและรุ่น', () => {
  it('**มีทั้งรอบที่ปิดแล้ว รอบที่กำลังเดิน และรอบที่ยังไม่เริ่ม**', async () => {
    const byState = async (state: string): Promise<number> =>
      prisma.sprint.count({ where: { state } });
    /* ความเร็วทีมต้องมีอย่างน้อยสองรอบที่ปิดแล้ว ไม่งั้นมันบอกได้แค่ตัวเลขเดียว */
    expect(await byState('completed')).toBeGreaterThanOrEqual(2);
    expect(await byState('active')).toBeGreaterThanOrEqual(1);
    expect(await byState('planned')).toBeGreaterThanOrEqual(1);
  });

  it('มีงานผูกกับรอบจริง — backlog ที่ไม่มีงานในรอบไหนเลย อ่านเหมือนฟีเจอร์พัง', async () => {
    expect(await prisma.workItem.count({ where: { sprintId: { not: null } } })).toBeGreaterThan(10);
  });

  /**
   * **ตัวเลขสรุปต้องมาจากแถวที่ผูกจริง ไม่ใช่ค่าที่พิมพ์ลงไป**
   *
   * ยอดที่ตั้งขึ้นเองจะทำให้ burndown ขัดกับข้อมูล ซึ่งเป็นเกณฑ์ที่เฟส 2
   * ต้องผ่าน · และเป็นรูปแบบเดียวกับ "ตัวเลขที่ไม่มีใครวัด" ที่เอกสารสถานะ
   * เคยมีอยู่ — ถ้าวันหนึ่งมีคนแก้ข้อมูลตัวอย่างแล้วลืมแก้ยอด ข้อนี้แดง
   */
  it('**ยอดที่ทำเสร็จของรอบที่ปิดแล้ว ตรงกับจำนวนงานที่ปิดจริงในรอบนั้น**', async () => {
    const closed = await prisma.sprint.findMany({
      where: { state: 'completed' },
      select: { id: true, name: true, completedCount: true },
    });
    expect(closed.length).toBeGreaterThanOrEqual(2);
    for (const s of closed) {
      const done = await prisma.workItem.count({
        where: { sprintId: s.id, resolvedAt: { not: null } },
      });
      expect(s.completedCount, `รอบ ${s.name} ยอดที่บันทึกไว้ไม่ตรงกับแถวจริง`).toBe(done);
    }
  });

  it('**มีรุ่นครบทั้งที่ปล่อยแล้ว ยังไม่ปล่อย และที่เก็บเข้าคลัง**', async () => {
    expect(await prisma.projectVersion.count({ where: { releasedAt: { not: null } } })).toBeGreaterThan(0);
    expect(await prisma.projectVersion.count({ where: { releasedAt: null } })).toBeGreaterThan(0);
    expect(await prisma.projectVersion.count({ where: { archived: true } })).toBeGreaterThan(0);
  });

  /**
   * **รุ่นที่ปล่อยแล้วต้องไม่มีงานค้าง** — ระบบห้ามปล่อยรุ่นที่ยังมีงานค้าง
   * อยู่แล้ว · ข้อมูลตัวอย่างที่ขัดกับกฎของระบบเอง ทำให้คนที่เปิดดูสรุปว่า
   * กฎนั้นไม่ทำงาน ทั้งที่มันทำงาน
   */
  it('**รุ่นที่ปล่อยแล้วไม่มีงานค้างสักใบ**', async () => {
    const leaked = await prisma.workItemVersion.count({
      where: { version: { releasedAt: { not: null } }, workItem: { resolvedAt: null } },
    });
    expect(leaked).toBe(0);
  });

  /** ถ้าทุกรุ่นที่ยังไม่ปล่อยมีงานค้างเป็นศูนย์ บันทึกการปล่อยจะบอก "ยังค้าง 0" เสมอ */
  it('มีรุ่นที่ยังไม่ปล่อยและยังมีงานค้าง — บันทึกการปล่อยจึงมีอะไรให้เตือน', async () => {
    const pending = await prisma.workItemVersion.count({
      where: { version: { releasedAt: null }, workItem: { resolvedAt: null } },
    });
    expect(pending).toBeGreaterThan(0);
  });
});

/**
 * บันทึกภายในของ **ข้อมูลตั้งต้น** ต้องไม่ถึงผู้แจ้ง
 *
 * `workitem-comment.spec.ts` พิสูจน์ตรรกะด้วยความเห็นที่มันสร้างเอง —
 * ซึ่งพิสูจน์ได้ว่า *ถ้า* มีบันทึกภายในแบบนั้น การกรองจะถูก · ไฟล์นี้ถามอีกคำถาม:
 * **ข้อมูลตั้งต้นมีบันทึกภายในให้ด่านนั้นจับจริงหรือยัง**
 *
 * ก่อนหน้านี้คำตอบคือไม่มีเลยสักข้อ จาก 10,010 ใบ · ทั้งคนที่มีสิทธิ์และ
 * ไม่มีสิทธิ์จึงได้รายการว่างเหมือนกัน และ **เซ็ตว่างเท่ากับเซ็ตว่าง** —
 * กับดักเดียวกับ `GET /config-items` ที่ดูเหมือนมีด่านเพราะตารางว่าง
 *
 * เทสต์นี้ **อ่านอย่างเดียว** จากข้อมูลตั้งต้น และสร้างผู้ใช้/กลุ่มของตัวเอง
 * แล้วลบทิ้ง — ไม่แตะความเห็นของ seed สักแถว
 */
describe('บันทึกภายในในข้อมูลตั้งต้น', () => {
  const STAMP = String(Date.now()).slice(-6);
  let reporter: TenantContext;
  let staff: TenantContext;
  let itemKey: string;
  let tenantId: bigint;
  const madeUsers: bigint[] = [];
  const madeGroups: bigint[] = [];
  const madeGrants: bigint[] = [];

  beforeAll(async () => {
    tenantId = (await prisma.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
    /* เรื่องที่ *มีบันทึกภายในอยู่จริง* — ถ้าหาไม่เจอ เคสข้างล่างต้องแดง ไม่ใช่ข้าม */
    const withNote = await prisma.workItemComment.findFirstOrThrow({
      where: { isInternal: true, deletedAt: null },
      select: { workItem: { select: { itemKey: true, projectId: true } } },
      orderBy: { id: 'asc' },
    });
    itemKey = withNote.workItem.itemKey;
    const project = await prisma.project.findFirstOrThrow({
      where: { id: withNote.workItem.projectId },
      select: { permissionSchemeId: true },
    });
    const schemeId = project.permissionSchemeId;
    if (schemeId === null) throw new Error('โปรเจกต์ของเรื่องนี้ไม่มี permission scheme');

    const mk = async (role: string, perms: string[]): Promise<TenantContext> => {
      const group = await prisma.userGroup.create({
        data: { tenantId, name: `note-${role}-${STAMP}` },
        select: { id: true },
      });
      madeGroups.push(group.id);
      const user = await prisma.user.create({
        data: {
          tenantId,
          email: `note-${role}-${STAMP}@example.test`,
          displayName: `ผู้ทดสอบ ${role} ${STAMP}`,
        },
        select: { id: true },
      });
      madeUsers.push(user.id);
      await prisma.groupMember.create({ data: { tenantId, groupId: group.id, userId: user.id } });
      for (const permission of perms) {
        const g = await prisma.permissionGrant.create({
          data: { tenantId, schemeId, permission: permission as never, groupId: group.id },
          select: { id: true },
        });
        madeGrants.push(g.id);
      }
      return { tenantId, actorId: user.id };
    };
    /** ผู้แจ้ง — เปิดดูโปรเจกต์ได้ แต่ไม่มีสิทธิ์เห็นบันทึกภายใน */
    reporter = await mk('reporter', ['BROWSE_PROJECT']);
    staff = await mk('staff', ['BROWSE_PROJECT', 'VIEW_INTERNAL_COMMENT']);
  }, 120_000);

  afterAll(async () => {
    await prisma.permissionGrant.deleteMany({ where: { id: { in: madeGrants } } });
    await prisma.groupMember.deleteMany({ where: { userId: { in: madeUsers } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: madeUsers } } });
    await prisma.user.deleteMany({ where: { id: { in: madeUsers } } });
    await prisma.userGroup.deleteMany({ where: { id: { in: madeGroups } } });
    const left = await prisma.user.count({ where: { id: { in: madeUsers } } });
    expect(left, 'เหลือผู้ใช้ของเทสต์ค้างอยู่').toBe(0);
  });

  it('**ข้อมูลตั้งต้นมีบันทึกภายในให้ด่านจับจริง**', async () => {
    expect(
      await prisma.workItemComment.count({ where: { isInternal: true, deletedAt: null } }),
    ).toBeGreaterThan(50);
  });

  /** ถ้าคนที่มีสิทธิ์ก็ไม่เห็น แปลว่าเคสข้างล่างผ่านเพราะรายการว่าง ไม่ใช่เพราะด่าน */
  it('คนที่มีสิทธิ์เห็นบันทึกภายในของเรื่องนี้', async () => {
    const rows = await listComments(staff, itemKey);
    expect(rows.some((r) => r.isInternal)).toBe(true);
  });

  /**
   * **หัวใจของไฟล์นี้** — ผู้แจ้งต้องไม่ได้รับบันทึกภายในสักข้อ
   *
   * ตรวจสองชั้น: ไม่มีแถวที่ `isInternal` และ **ไม่มีข้อความของบันทึกภายใน
   * ปนอยู่ในเนื้อความที่ส่งออกไป** · ชั้นหลังจับกรณีที่ธงถูกล้างแต่ข้อความ
   * ยังหลุด ซึ่งเป็นความล้มเหลวที่ธงอย่างเดียวมองไม่เห็น
   */
  it('**ผู้แจ้งไม่เห็นบันทึกภายในสักข้อ**', async () => {
    const notes = await prisma.workItemComment.findMany({
      where: { isInternal: true, deletedAt: null },
      select: { body: true },
      take: 200,
    });
    const secret = new Set(
      notes
        .map((n) => (n.body as { text?: unknown }).text)
        .filter((t): t is string => typeof t === 'string'),
    );
    expect(secret.size, 'อ่านข้อความของบันทึกภายในไม่ได้ — ตัวตรวจพัง').toBeGreaterThan(0);

    const rows = await listComments(reporter, itemKey);
    expect(rows.length, 'ผู้แจ้งต้องยังเห็นความเห็นสาธารณะ').toBeGreaterThan(0);
    expect(rows.filter((r) => r.isInternal)).toEqual([]);
    const leaked = rows.filter((r) => secret.has(r.body));
    expect(leaked, `ข้อความของบันทึกภายในหลุดถึงผู้แจ้ง: ${JSON.stringify(leaked)}`).toEqual([]);
  });

  /** ความเห็นที่ถูกลบแบบ soft ต้องไม่กลับมาในรายการของใครเลย */
  it('ความเห็นที่ถูกลบแล้ว ไม่กลับมาในรายการของคนที่มีสิทธิ์', async () => {
    const deleted = await prisma.workItemComment.findFirstOrThrow({
      where: { deletedAt: { not: null } },
      select: { body: true, workItem: { select: { itemKey: true } } },
    });
    const text = (deleted.body as { text?: unknown }).text;
    const rows = await listComments(staff, deleted.workItem.itemKey);
    expect(rows.map((r) => r.body)).not.toContain(text);
  });
});
