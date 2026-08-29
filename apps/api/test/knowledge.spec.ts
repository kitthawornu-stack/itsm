/**
 * คลังความรู้ที่ผูกกับตั๋ว — เทสต์เป็นข้อกำหนด
 *
 * ขอบเขตตั้งแต่ต้น: **ไม่ใช่ระบบเอกสารทั่วไป** — Confluence-class wiki
 * ถูกตัดออกโดยตั้งใจ · คุณค่าคือคำตอบที่ทีมตอบซ้ำทุกสัปดาห์ ย้ายมาอยู่ที่เดียว
 * แล้วแนบเข้าตั๋วได้
 *
 * ห้าข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **ผู้แจ้งเห็นเฉพาะที่เผยแพร่แล้ว** — บทความที่เขียนค้างครึ่งทางไปโผล่
 *      ให้ลูกค้าอ่าน เสียหายกว่าไม่มีบทความเลย เพราะมันดูเหมือนคำตอบทางการ
 *   2. **ค้นภาษาไทยได้จริง** — `LIKE` ไม่ใช่ FULLTEXT จึงไม่ต้องตัดคำ
 *      (CLAUDE.md ห้าม FULLTEXT เพราะ tokenizer คืนทั้งประโยคเป็น 1 token)
 *   3. **ถอนเผยแพร่ต้องมีผลทันทีทุกที่** รวมทั้งบนตั๋วที่แนบไว้แล้ว —
 *      กรองตอนอ่าน ไม่ใช่เชื่อว่าตอนแนบกรองไปแล้ว
 *   4. **ถอนเผยแพร่ไม่ล้าง `publishedAt`** — มันคือเวลาที่เคยเผยแพร่จริง
 *      ซึ่งเป็นประวัติของเหตุการณ์ที่เกิดไปแล้ว (บทเรียนของ `breachAt`)
 *   5. **ลบเป็น soft delete** — ตั๋วที่เคยแนบต้องยังตอบได้ว่าเคยแนบอะไร
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  ArticleNotFoundError,
  EmptyArticleError,
  articlesOf,
  attachArticle,
  createArticle,
  deleteArticle,
  detachArticle,
  rateArticle,
  readArticle,
  searchArticles,
  updateArticle,
} from '../src/modules/knowledge';

const STAMP = String(Date.now()).slice(-6);
/** คำไทยที่ไม่มีทางชนกับข้อมูลจริง */
const TERM = `รีเซ็ตรหัส${STAMP}`;

let tenantId: bigint;
let projectId: bigint;
/** ทีมงาน — เห็นบันทึกภายใน จึงเห็นบทความที่ยังไม่เผยแพร่ */
let staff: TenantContext;
/** ผู้แจ้ง — เห็นเฉพาะที่เผยแพร่แล้ว */
let customer: TenantContext;
/** เห็นเรื่องได้ แต่แก้ไม่ได้ */
let reader: TenantContext;
let staffId: bigint | undefined;
let customerId: bigint | undefined;
let readerId: bigint | undefined;
let staffGroupId: bigint | undefined;
let customerGroupId: bigint | undefined;
let readerGroupId: bigint | undefined;

let itemKey = '';
let itemId: bigint;
let publishedId: bigint;
let draftId: bigint;

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
    data: { tenantId, name: `ชุดสิทธิ์ความรู้ ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `KB${STAMP}`,
      name: `โปรเจกต์ทดสอบความรู้ ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = project.id;

  const mkGroup = async (n: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `kb-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  staffGroupId = await mkGroup('staff');
  customerGroupId = await mkGroup('customer');
  readerGroupId = await mkGroup('reader');

  const mkUser = async (n: string, groupId: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `kb-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  staffId = await mkUser('staff', staffGroupId);
  customerId = await mkUser('customer', customerGroupId);
  readerId = await mkUser('reader', readerGroupId);

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: staffGroupId },
      { tenantId, schemeId: scheme.id, permission: 'EDIT_ITEM', groupId: staffGroupId },
      { tenantId, schemeId: scheme.id, permission: 'VIEW_INTERNAL_COMMENT', groupId: staffGroupId },
      // ผู้แจ้ง: เห็นเรื่องได้ แต่ไม่เห็นของภายใน
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: customerGroupId },
      { tenantId, schemeId: scheme.id, permission: 'EDIT_ITEM', groupId: customerGroupId },
      // ผู้อ่าน: เห็นเรื่อง แต่แก้ไม่ได้
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: readerGroupId },
    ] as never,
  });
  staff = { tenantId, actorId: staffId };
  customer = { tenantId, actorId: customerId };
  reader = { tenantId, actorId: readerId };

  const template = await prismaClient.workItem.findFirstOrThrow({
    select: { issueTypeId: true, statusId: true },
  });
  const item = await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey: `KB${STAMP}-1`,
      issueTypeId: template.issueTypeId,
      statusId: template.statusId,
      reporterId: customerId as bigint,
      summary: `งานทดสอบความรู้ ${STAMP}`,
      rank: `zzo${STAMP}`,
    },
    select: { id: true, itemKey: true },
  });
  itemId = item.id;
  itemKey = item.itemKey;

  publishedId = (
    await createArticle(staff, {
      title: `วิธี${TERM}`,
      body: `กด "ลืมรหัสผ่าน" แล้วทำตามขั้นตอน ${STAMP}`,
      isPublished: true,
    })
  ).id;
  draftId = (
    await createArticle(staff, {
      title: `ร่าง${TERM}`,
      body: `ยังเขียนไม่เสร็จ ${STAMP}`,
    })
  ).id;
}, 180_000);

afterAll(async () => {
  const owners = [staffId, customerId, readerId].filter((v): v is bigint => v !== undefined);
  await step('บทความที่แนบ', () =>
    prismaClient.workItemArticle.deleteMany({ where: { workItemId: itemId } }),
  );
  await step('บทความ', () =>
    prismaClient.knowledgeArticle.deleteMany({ where: { authorId: { in: owners } } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { actorId: { in: owners } } }),
  );
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actorId: { in: owners } } }));
  await step('งานทดสอบ', () => prismaClient.workItem.deleteMany({ where: { itemKey } }));
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: `KB${STAMP}` } }));
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

describe('A · ค้นหาภาษาไทย', () => {
  it('**ค้นด้วยคำไทยที่อยู่กลางคำอื่นได้**', async () => {
    /*
      `LIKE '%คำ%'` ไม่ใช่ FULLTEXT · มันเทียบสตริงตรง ๆ จึงทำงานกับภาษาไทย
      ได้โดยไม่ต้องตัดคำเลย — ต่างจาก MySQL FULLTEXT ที่ CLAUDE.md ห้ามไว้
      เพราะ tokenizer คืนทั้งประโยคเป็น 1 token
    */
    const hits = await searchArticles(staff, TERM);
    expect(hits.map((h) => h.id).sort()).toEqual(
      [publishedId.toString(), draftId.toString()].sort(),
    );
  });

  it('ค้นจากเนื้อหา ไม่ใช่แค่ชื่อเรื่อง', async () => {
    const hits = await searchArticles(staff, 'ลืมรหัสผ่าน');
    expect(hits.some((h) => h.id === publishedId.toString())).toBe(true);
  });

  it('คำค้นว่าง = ไม่คืนอะไร ไม่ใช่คืนทั้งคลัง', async () => {
    expect(await searchArticles(staff, '   ')).toEqual([]);
  });
});

describe('B · ที่ยังไม่เผยแพร่', () => {
  it('**ผู้แจ้งค้นไม่เจอบทความที่ยังไม่เผยแพร่**', async () => {
    /*
      บทความที่เขียนค้างครึ่งทางไปโผล่ให้ลูกค้าอ่าน เสียหายกว่าไม่มีบทความเลย
      เพราะมันดูเหมือนคำตอบทางการ แล้วลูกค้าจะทำตามข้อมูลที่ยังไม่ถูกตรวจ
    */
    const hits = await searchArticles(customer, TERM);
    expect(hits.map((h) => h.id)).toEqual([publishedId.toString()]);
  });

  it('เปิดอ่านตรง ๆ ก็ไม่ได้ และตอบเหมือนไม่มีอยู่', async () => {
    // ตอบ "ไม่มีสิทธิ์" คือการยืนยันว่าบทความนั้นมีอยู่จริง
    await expect(readArticle(customer, draftId)).rejects.toThrow(ArticleNotFoundError);
    expect((await readArticle(staff, draftId)).title).toContain('ร่าง');
  });
});

describe('C · เขียนและแก้', () => {
  it('ชื่อว่างหรือเนื้อหาว่าง ถูกปฏิเสธ', async () => {
    await expect(createArticle(staff, { title: '   ', body: 'มีเนื้อหา' })).rejects.toThrow(
      EmptyArticleError,
    );
    await expect(createArticle(staff, { title: 'มีชื่อ', body: '  ' })).rejects.toThrow(
      EmptyArticleError,
    );
  });

  it('**ถอนเผยแพร่แล้ว `publishedAt` ต้องยังอยู่**', async () => {
    /*
      มันคือเวลาที่เคยเผยแพร่จริง ซึ่งเป็นประวัติของเหตุการณ์ที่เกิดไปแล้ว ·
      ค่าที่กลายเป็น null เพราะเหตุการณ์เกิดขึ้นแล้ว ไม่ใช่ที่เก็บประวัติของ
      เหตุการณ์นั้น (บทเรียนของ `breachAt` / `breachedAt`)
    */
    const before = await prismaClient.knowledgeArticle.findUniqueOrThrow({
      where: { id: publishedId },
      select: { publishedAt: true },
    });
    expect(before.publishedAt).not.toBeNull();

    await updateArticle(staff, publishedId, { isPublished: false });
    const after = await prismaClient.knowledgeArticle.findUniqueOrThrow({
      where: { id: publishedId },
      select: { publishedAt: true, isPublished: true },
    });
    expect(after.isPublished).toBe(false);
    expect(after.publishedAt).toEqual(before.publishedAt);

    await updateArticle(staff, publishedId, { isPublished: true });
  });

  it('แก้แล้วไม่เปลี่ยนอะไร ไม่เขียนประวัติเพิ่ม', async () => {
    const count = async (): Promise<number> =>
      prismaClient.auditLog.count({ where: { action: 'knowledge.update' } });
    const before = await count();
    await updateArticle(staff, publishedId, { isPublished: true });
    expect(await count()).toBe(before);
  });
});

describe('D · แนบเข้าตั๋ว', () => {
  it('**ไม่มี EDIT_ITEM = แนบไม่ได้**', async () => {
    await expect(attachArticle(reader, itemKey, publishedId)).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it('แนบได้ และแนบซ้ำไม่เขียนประวัติเพิ่ม', async () => {
    await attachArticle(staff, itemKey, publishedId);
    const rows = await articlesOf(staff, itemId);
    expect(rows.map((r) => r.id)).toEqual([publishedId.toString()]);

    const before = await prismaClient.workItemHistory.count({
      where: { workItemId: itemId, field: '__article__' },
    });
    await attachArticle(staff, itemKey, publishedId);
    const after = await prismaClient.workItemHistory.count({
      where: { workItemId: itemId, field: '__article__' },
    });
    expect(after).toBe(before);
  });

  it('**บทความที่ยังไม่เผยแพร่ แนบไม่ได้**', async () => {
    await expect(attachArticle(customer, itemKey, draftId)).rejects.toThrow(ArticleNotFoundError);
  });

  it('**ถอนเผยแพร่แล้ว ต้องหายจากตั๋วของผู้แจ้งทันที**', async () => {
    /*
      กรองตอนอ่าน ไม่ใช่เชื่อว่าตอนแนบกรองไปแล้ว · สถานะเผยแพร่เปลี่ยนได้
      หลังแนบ และการถอนเผยแพร่ต้องมีผลทันทีทุกที่ที่บทความนั้นโผล่
      — ไม่ใช่แค่ในหน้าค้นหา
    */
    expect(await articlesOf(customer, itemId)).toHaveLength(1);
    await updateArticle(staff, publishedId, { isPublished: false });
    try {
      expect(await articlesOf(customer, itemId)).toHaveLength(0);
      // ทีมยังเห็นอยู่ — บทความไม่ได้หายไปไหน แค่ลูกค้าไม่เห็น
      expect(await articlesOf(staff, itemId)).toHaveLength(1);
    } finally {
      await updateArticle(staff, publishedId, { isPublished: true });
    }
    expect(await articlesOf(customer, itemId)).toHaveLength(1);
  });

  it('บอกว่าช่วยได้ไหม — และ null ต่างจาก false', async () => {
    /*
      `null` = ยังไม่มีใครบอก · `false` = ลองแล้วไม่ช่วย · สองอย่างนี้ตอบ
      คนละคำถามเวลาถามว่า "บทความไหนควรเลิกดูแล"
    */
    expect((await articlesOf(staff, itemId))[0]?.helpful).toBeNull();
    await rateArticle(customer, itemKey, publishedId, false);
    expect((await articlesOf(staff, itemId))[0]?.helpful).toBe(false);
    await rateArticle(customer, itemKey, publishedId, true);
    expect((await articlesOf(staff, itemId))[0]?.helpful).toBe(true);
  });

  it('ถอดออกได้ และถอดซ้ำไม่ใช่ความผิดพลาด', async () => {
    await detachArticle(staff, itemKey, publishedId);
    expect(await articlesOf(staff, itemId)).toHaveLength(0);
    await detachArticle(staff, itemKey, publishedId);
    expect(await articlesOf(staff, itemId)).toHaveLength(0);
  });
});

describe('E · ลบบทความ', () => {
  it('**ลบเป็น soft delete และหายจากทุกที่**', async () => {
    /*
      ตั๋วที่เคยแนบบทความนี้ต้องยังตอบได้ว่าเคยแนบอะไร — ประวัติเก็บชื่อไว้แล้ว
      · การลบจริงจะทำให้แถวประวัติชี้ไปที่ความว่างเปล่า
    */
    await attachArticle(staff, itemKey, publishedId);
    await deleteArticle(staff, publishedId);

    expect(await searchArticles(staff, TERM)).toHaveLength(1); // เหลือแต่ร่าง
    expect(await articlesOf(staff, itemId)).toHaveLength(0);
    await expect(readArticle(staff, publishedId)).rejects.toThrow(ArticleNotFoundError);

    // แถวยังอยู่ในฐานข้อมูล พร้อมเวลาที่ลบ
    const row = await prismaClient.knowledgeArticle.findUniqueOrThrow({
      where: { id: publishedId },
      select: { deletedAt: true, title: true },
    });
    expect(row.deletedAt).not.toBeNull();
    expect(row.title).toContain(TERM);
  });

  it('ลบซ้ำ ตอบเหมือนไม่มีอยู่', async () => {
    await expect(deleteArticle(staff, publishedId)).rejects.toThrow(ArticleNotFoundError);
  });
});
