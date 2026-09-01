/**
 * Known Error — วิธีแก้จากปัญหาที่เป็นสาเหตุ · ต่อของจริง
 *
 * `known-error.spec.ts` ประกอบข้อมูลนำเข้าขึ้นมาเอง จึงพิสูจน์ได้แค่ว่า
 * *ถ้า* ข้อมูลหน้าตาแบบนั้นเข้ามา ผลจะถูก · ไฟล์นี้ถามคำถามที่เอนจินตอบไม่ได้
 * ทั้งหมด และทุกข้อเป็นความล้มเหลวแบบเงียบ:
 *
 *   1. **ทิศทาง** — บทความต้องมาจากปัญหาที่ **ทำให้เรื่องนี้เกิด** ไม่ใช่จาก
 *      เรื่องที่ใบนี้ทำให้เกิด · คิวรีที่สลับ `sourceId`/`targetId` ยังคืนของ
 *      ออกมาเป็นรายการสวย ๆ เหมือนกัน แค่เป็นของผิดใบ — ไม่มี error ให้เห็น
 *   2. **เฉพาะชนิด `CAUSES`** — "เกี่ยวข้องกับ" ไม่ใช่ "เกิดจาก"
 *   3. **บทความที่ยังเป็นร่าง ต้องไม่โผล่ให้คนที่ไม่มีสิทธิ์เห็น** — การกรอง
 *      อยู่ที่ `articlesOf` · ถ้ามีใครเขียนคิวรีบทความเองแทนที่จะเรียกมัน
 *      ด่านนั้นจะหายไปโดยที่ทุกอย่างยังทำงาน
 *   4. **ปัญหาในโปรเจกต์ที่ผู้ดูเข้าไม่ถึง ต้องไม่โผล่** — ชื่อปัญหาและชื่อ
 *      บทความก็เป็นข้อมูลรั่วได้
 *   5. **สถานะ "แก้ถาวรแล้ว" อ่านจากหมวดของสถานะจริงในฐานข้อมูล** — ธงที่ผิด
 *      ทำให้คนไปทำวิธีแก้ชั่วคราวทั้งที่มีวิธีแก้ถาวรอยู่แล้ว
 *
 * เทสต์สร้างงาน ผู้ใช้ กลุ่ม และบทความของตัวเองทั้งหมด แล้วลบทิ้ง
 * ไม่แตะข้อมูล seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import type { PermissionKey } from '../src/modules/permission';
import { attachArticle, createArticle } from '../src/modules/knowledge';
import { linkWorkItems, workaroundsFor } from '../src/modules/link';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let projectId: bigint;
let template: { issueTypeId: bigint; statusId: bigint; doneStatusId: bigint };
/** ผู้เขียน — เป็นทีมงาน จึงเห็นร่าง · ผู้อ่าน — ไม่เห็นร่าง */
let authorCtx: TenantContext;
let readerCtx: TenantContext;
let authorId: bigint;
let readerId: bigint;
let authorGroupId: bigint;
let readerGroupId: bigint;
const grantIds: bigint[] = [];
const keys: string[] = [];
const ids = new Map<string, bigint>();
const articleIds: bigint[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function newItem(tag: string, o: { done?: boolean } = {}): Promise<string> {
  /** คีย์มี stamp เสมอ — ตอนกลไกถูกลบ ค่าที่ "ไม่ควรถูกใช้" จะถูกใช้จริง */
  const itemKey = `SD-KE${STAMP}${tag}`;
  const w = await prismaClient.workItem.create({
    data: {
      tenantId,
      projectId,
      itemKey,
      issueTypeId: template.issueTypeId,
      statusId: o.done === true ? template.doneStatusId : template.statusId,
      reporterId: authorId,
      summary: `[Known Error] ${tag} ${STAMP}`,
      rank: `zzk${STAMP}${tag}`,
    },
    select: { id: true, itemKey: true },
  });
  keys.push(w.itemKey);
  ids.set(tag, w.id);
  return w.itemKey;
}

/** เขียนบทความแล้วแนบกับงาน — คืน id เป็นสตริงแบบเดียวกับที่ API ตอบ */
async function article(onKey: string, title: string, published: boolean): Promise<string> {
  const a = await createArticle(authorCtx, { title: `${title} ${STAMP}`, body: `วิธีแก้ ${STAMP}` });
  articleIds.push(a.id);
  if (published) {
    await prismaClient.knowledgeArticle.update({
      where: { id: a.id },
      data: { isPublished: true },
    });
  }
  await attachArticle(authorCtx, onKey, a.id);
  return a.id.toString();
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  const project = await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } });
  projectId = project.id;
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
          email: `ke-${tag}-${STAMP}@example.test`,
          displayName: `QA Known Error ${tag} ${STAMP}`,
        },
        select: { id: true },
      })
    ).id;
  authorId = await mkUser('author');
  readerId = await mkUser('reader');
  authorCtx = { tenantId, actorId: authorId };
  readerCtx = { tenantId, actorId: readerId };

  const schemeId = (
    await prismaClient.project.findFirstOrThrow({
      where: { id: projectId },
      select: { permissionSchemeId: true },
    })
  ).permissionSchemeId;
  if (schemeId === null) throw new Error('โปรเจกต์ SD ไม่มี permission scheme');

  /*
    กลุ่มของเทสต์เอง — ไม่เพิ่มคนเข้ากลุ่มของ seed · เทสต์ที่แก้ข้อมูลร่วม
    เคยทำให้ agent1/agent2 หลุดจาก IT Support ค้างไว้จริง (บทเรียนใน CLAUDE.md)

    ผู้เขียนได้ `VIEW_INTERNAL_COMMENT` จึงนับเป็นทีมงานและเห็นร่าง ·
    ผู้อ่านได้แค่ `BROWSE_PROJECT` — เป็นคนที่ด่านข้อ 3 มีไว้กัน
  */
  const mkGroup = async (name: string, permissions: readonly PermissionKey[]): Promise<bigint> => {
    const g = await prismaClient.userGroup.create({
      data: { tenantId, name: `Known Error ${name} ${STAMP}` },
      select: { id: true },
    });
    for (const permission of permissions) {
      const grant = await prismaClient.permissionGrant.create({
        data: { tenantId, schemeId, permission, groupId: g.id },
        select: { id: true },
      });
      grantIds.push(grant.id);
    }
    return g.id;
  };
  authorGroupId = await mkGroup('ผู้เขียน', [
    'BROWSE_PROJECT',
    'LINK_ITEM',
    // `attachArticle` ขอ `EDIT_ITEM` — การแนบบทความคือการแก้งาน ไม่ใช่การอ่าน
    'EDIT_ITEM',
    'VIEW_INTERNAL_COMMENT',
  ]);
  readerGroupId = await mkGroup('ผู้อ่าน', ['BROWSE_PROJECT']);
  await prismaClient.groupMember.create({
    data: { tenantId, groupId: authorGroupId, userId: authorId },
  });
  await prismaClient.groupMember.create({
    data: { tenantId, groupId: readerGroupId, userId: readerId },
  });
}, 120_000);

afterAll(async () => {
  await step('ความสัมพันธ์', () =>
    prismaClient.workItemLink.deleteMany({
      where: { OR: [{ source: { itemKey: { in: keys } } }, { target: { itemKey: { in: keys } } }] },
    }),
  );
  await step('บทความที่แนบ', () =>
    prismaClient.workItemArticle.deleteMany({ where: { articleId: { in: articleIds } } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { workItem: { itemKey: { in: keys } } } }),
  );
  /*
    ถาม `audit_log` ว่าผู้ใช้ของเทสต์แตะอะไรไปบ้าง แทนที่จะเชื่อตัวแปรที่จำไว้
    ตอนเขียน — ตอนกลไกหายไป เคสที่ "ไม่ควรสร้างอะไร" จะสร้างจริง
  */
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({ where: { actorId: { in: [authorId, readerId] } } }),
  );
  await step('งานทดสอบ', () =>
    prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }),
  );
  await step('บทความ', () => prismaClient.knowledgeArticle.deleteMany({ where: { authorId } }));
  await step('สิทธิ์ของเทสต์', () =>
    prismaClient.permissionGrant.deleteMany({ where: { id: { in: grantIds } } }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({
      where: { groupId: { in: [authorGroupId, readerGroupId] } },
    }),
  );
  await step('ผู้ใช้ของเทสต์', () =>
    prismaClient.user.deleteMany({ where: { email: { contains: STAMP } } }),
  );
  await step('กลุ่มของเทสต์', () =>
    prismaClient.userGroup.deleteMany({ where: { id: { in: [authorGroupId, readerGroupId] } } }),
  );

  // ยืนยันด้วยการนับหลังคืน ไม่ใช่เชื่อว่าลูปทำงาน
  const left = await prismaClient.knowledgeArticle.count({ where: { authorId } });
  if (left > 0) console.error(`เหลือบทความของเทสต์ค้างอยู่ ${String(left)} ฉบับ`);
  await prismaClient.$disconnect();
});

describe('Known Error · ต่อของจริง', () => {
  it('เรื่องที่ไม่ได้เกิดจากปัญหาอะไรเลย ได้รายการว่าง ไม่ใช่ error', async () => {
    await newItem('LONE');
    expect(await workaroundsFor(authorCtx, ids.get('LONE') ?? BigInt(0))).toEqual([]);
  });

  it('**บทความมาจากปัญหาที่ทำให้เรื่องนี้เกิด ไม่ใช่จากเรื่องที่ใบนี้ทำให้เกิด**', async () => {
    /*
      ทั้งสองทิศเป็นแถวชนิด `CAUSES` เหมือนกัน ต่างกันแค่ว่าใครเป็น `source` ·
      คิวรีที่สลับข้างยังคืนรายการสวย ๆ ออกมาเหมือนกัน แค่เป็นบทความของใบผิด
    */
    const incident = await newItem('INC');
    const problem = await newItem('PROB');
    const victim = await newItem('VICTIM');

    const wanted = await article(problem, 'ล้างคิวพิมพ์', true);
    const wrongWay = await article(victim, 'อย่าให้บทความนี้โผล่', true);

    await linkWorkItems(authorCtx, problem, incident, 'CAUSES');
    // ใบนี้เป็นสาเหตุของ VICTIM — บทความของ VICTIM ต้องไม่ใช่วิธีแก้ของ INC
    await linkWorkItems(authorCtx, incident, victim, 'CAUSES');

    const r = await workaroundsFor(authorCtx, ids.get('INC') ?? BigInt(0));
    expect(r.map((w) => w.articleId)).toEqual([wanted]);
    expect(r.map((w) => w.articleId)).not.toContain(wrongWay);
    expect(r[0]?.problemKey).toBe(problem);
  });

  it('**ความสัมพันธ์ชนิดอื่นไม่นับ** — "เกี่ยวข้องกับ" ไม่ใช่ "เกิดจาก"', async () => {
    const incident = await newItem('INC2');
    const related = await newItem('REL');
    const noise = await article(related, 'บทความของเรื่องที่แค่เกี่ยวข้อง', true);

    await linkWorkItems(authorCtx, related, incident, 'RELATES_TO');

    const r = await workaroundsFor(authorCtx, ids.get('INC2') ?? BigInt(0));
    expect(r.map((w) => w.articleId)).not.toContain(noise);
    expect(r).toEqual([]);
  });

  it('**บทความที่ยังเป็นร่าง ไม่โผล่ให้ผู้อ่านที่ไม่ใช่ทีมงาน**', async () => {
    const incident = await newItem('INC3');
    const problem = await newItem('PROB3');
    const draft = await article(problem, 'ร่างที่ยังเขียนไม่เสร็จ', false);
    const live = await article(problem, 'วิธีแก้ที่เผยแพร่แล้ว', true);

    await linkWorkItems(authorCtx, problem, incident, 'CAUSES');
    const id = ids.get('INC3') ?? BigInt(0);

    // ทีมงานเห็นทั้งสองฉบับ — ยืนยันว่าร่างนั้นแนบติดอยู่จริง ไม่ใช่หายไปตั้งแต่แรก
    expect((await workaroundsFor(authorCtx, id)).map((w) => w.articleId).sort()).toEqual(
      [draft, live].sort(),
    );
    // ผู้อ่านเห็นเฉพาะที่เผยแพร่แล้ว
    expect((await workaroundsFor(readerCtx, id)).map((w) => w.articleId)).toEqual([live]);
  });

  it('**ปัญหาในโปรเจกต์ที่ผู้ดูเข้าไม่ถึง ไม่โผล่เลย**', async () => {
    /*
      คนที่ไม่มีสิทธิ์ที่ไหนเลย · ไม่ใส่เข้ากลุ่มไหนทั้งนั้น — "ข้อมูลที่ไม่ครบ
      ต้องแปลว่าไม่มีสิทธิ์" (CLAUDE.md) · ชื่อปัญหาและชื่อบทความก็รั่วได้
    */
    const outsiderId = (
      await prismaClient.user.create({
        data: { tenantId, email: `ke-out-${STAMP}@example.test`, displayName: `คนนอก ${STAMP}` },
        select: { id: true },
      })
    ).id;
    const r = await workaroundsFor({ tenantId, actorId: outsiderId }, ids.get('INC') ?? BigInt(0));
    expect(r).toEqual([]);
  });

  it('**ธง "แก้ถาวรแล้ว" อ่านจากหมวดของสถานะจริง**', async () => {
    const incident = await newItem('INC4');
    const openProblem = await newItem('POPEN');
    const doneProblem = await newItem('PDONE', { done: true });
    await article(openProblem, 'วิธีแก้จากปัญหาที่ยังเปิด', true);
    await article(doneProblem, 'วิธีแก้จากปัญหาที่ปิดแล้ว', true);

    await linkWorkItems(authorCtx, doneProblem, incident, 'CAUSES');
    await linkWorkItems(authorCtx, openProblem, incident, 'CAUSES');

    const r = await workaroundsFor(authorCtx, ids.get('INC4') ?? BigInt(0));
    expect(r).toHaveLength(2);
    // ปัญหาที่ยังเปิดอยู่มาก่อน แม้จะถูกเชื่อมทีหลัง
    expect(r[0]?.problemKey).toBe(openProblem);
    expect(r[0]?.problemResolved).toBe(false);
    expect(r[1]?.problemKey).toBe(doneProblem);
    expect(r[1]?.problemResolved).toBe(true);
  });
});
