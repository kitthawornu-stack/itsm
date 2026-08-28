/**
 * เชื่อมโยงเรื่องเข้าด้วยกัน — เทสต์เป็นข้อกำหนด เขียนก่อนโค้ด
 *
 * `LinkType` มี 6 ชนิดในสคีมามาตั้งแต่ Phase 0 · `LINK_ITEM` อยู่ใน enum
 * และแสดงบนหน้าตั้งค่าโปรเจกต์ว่า "เชื่อมโยงเรื่อง" · **แต่โมดูล `link` ว่างเปล่า
 * และคีย์นั้นอยู่ใน `UNENFORCED_PERMISSIONS`** — ผู้ดูแลจึงอ่านหน้าจอได้ว่า
 * ให้สิทธิ์เชื่อมโยงกับใครไปแล้ว ซึ่งเป็นความเชื่อที่หน้าจอสร้างขึ้นเองทั้งหมด
 *
 * ห้าข้อที่ต้องถูกตั้งแต่แรก เพราะแก้ทีหลังแปลว่าต้องล้างข้อมูลที่ผิดไปแล้ว:
 *
 *   1. **หนึ่งความสัมพันธ์ = หนึ่งแถว** — "A blocks B" กับ "B is blocked by A"
 *      เป็นประโยคเดียวกันพูดคนละทาง · ถ้าเก็บสองแถว วันหนึ่งจะลบไปข้างเดียว
 *      แล้วเหลือความสัมพันธ์ที่มองเห็นจากฝั่งเดียว โดยไม่มีอะไรบอกว่าผิด
 *   2. **ทิศต้องถูกทำให้เป็นแบบเดียวก่อนเขียน** — unique index คุม
 *      (source, target, type) แต่ไม่คุม (target, source, ชนิดตรงข้าม)
 *      ซึ่งเป็นความสัมพันธ์เดียวกัน · ถ้าไม่ normalise หน้ารายละเอียดจะแสดงซ้ำสองบรรทัด
 *   3. **ลิงก์ไปหาตัวเองไม่ได้** — "SD-1 ซ้ำกับ SD-1" ไม่มีความหมาย
 *      และทำให้หน้าจอวนอ้างถึงตัวเอง
 *   4. **ปลายทางที่เปิดดูไม่ได้ ต้องไม่โผล่** — ทั้งตอนสร้างและตอนอ่าน ·
 *      การแสดง "ซ้ำกับ PLAT-99" ให้คนที่เปิด PLAT ไม่ได้ คือการยืนยันว่า
 *      เลขนั้นมีอยู่ และเป็นทางตันที่กดแล้วได้ 403
 *   5. **ต้องมี `LINK_ITEM` จริง** — ไม่ใช่ตรวจ `EDIT_ITEM` แล้วถือว่าครอบ
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  DuplicateLinkError,
  LinkTargetNotFoundError,
  SelfLinkError,
  linkWorkItems,
  linksOf,
  unlinkWorkItems,
} from '../src/modules/link';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
/** มี LINK_ITEM */
let staff: TenantContext;
/** แก้เรื่องได้ แต่เชื่อมโยงไม่ได้ */
let editor: TenantContext;
let staffId: bigint | undefined;
let editorId: bigint | undefined;
let staffGroupId: bigint | undefined;
let editorGroupId: bigint | undefined;

/** งานที่เทสต์สร้างเอง — ไม่แตะงานของ seed แม้แต่ใบเดียว */
const keys: string[] = [];
const ids: bigint[] = [];
/** งานจริงในโปรเจกต์ที่ผู้ใช้ของเทสต์เปิดดูไม่ได้ */
let hiddenKey: string | undefined;
let hiddenId: bigint | undefined;

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  const project = await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } });
  const schemeId = project.permissionSchemeId ?? 0n;

  const mkGroup = async (n: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `link-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  staffGroupId = await mkGroup('staff');
  editorGroupId = await mkGroup('editor');

  const mkUser = async (n: string, groupId: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `link-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  staffId = await mkUser('staff', staffGroupId);
  editorId = await mkUser('editor', editorGroupId);

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId, permission: 'BROWSE_PROJECT', groupId: staffGroupId },
      { tenantId, schemeId, permission: 'LINK_ITEM', groupId: staffGroupId },
      // แก้เรื่องได้ แต่เชื่อมโยงไม่ได้ — สองสิทธิ์นี้ตอบคนละคำถาม
      { tenantId, schemeId, permission: 'BROWSE_PROJECT', groupId: editorGroupId },
      { tenantId, schemeId, permission: 'EDIT_ITEM', groupId: editorGroupId },
    ],
  });

  staff = { tenantId, actorId: staffId };
  editor = { tenantId, actorId: editorId };

  const template = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId: project.id },
    select: { issueTypeId: true, statusId: true },
  });
  for (let i = 0; i < 6; i += 1) {
    const w = await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId: project.id,
        itemKey: `SD-LNK${STAMP}${String(i)}`,
        issueTypeId: template.issueTypeId,
        statusId: template.statusId,
        reporterId: staffId,
        summary: `งานทดสอบการเชื่อมโยง ${STAMP} ลำดับ ${String(i)}`,
        rank: `zzx${STAMP}${String(i)}`,
      },
      select: { id: true, itemKey: true },
    });
    keys.push(w.itemKey);
    ids.push(w.id);
  }

  const hidden = await prismaClient.project.findFirstOrThrow({ where: { key: 'PLAT' } });
  const hiddenItem = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId: hidden.id },
    select: { id: true, itemKey: true },
  });
  hiddenKey = hiddenItem.itemKey;
  hiddenId = hiddenItem.id;
}, 180_000);

afterAll(async () => {
  const owners = [staffId, editorId].filter((v): v is bigint => v !== undefined);
  /*
    ลบลิงก์ที่แตะงานของ seed ด้วย — ตอนกลไกขอบเขตการมองเห็นถูกลบออกเพื่อ
    พิสูจน์ว่าเทสต์แดงได้ ลิงก์ที่ชี้ไปงานของ PLAT จะถูกสร้างจริง และมันจะ
    ไปโผล่บนหน้ารายละเอียดของงานจริงในวันถัดไป · การนับแถวของ `work_item`
    จับไม่ได้เพราะไม่มีแถวไหนถูกเพิ่มหรือลบ
  */
  await step('ลิงก์ทั้งหมดที่แตะงานของเทสต์', () =>
    prismaClient.workItemLink.deleteMany({
      where: {
        OR: [
          { sourceId: { in: ids } },
          { targetId: { in: ids } },
          ...(hiddenId === undefined ? [] : [{ sourceId: hiddenId }, { targetId: hiddenId }]),
        ],
      },
    }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { actorId: { in: owners } } }),
  );
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actorId: { in: owners } } }));
  await step('งานทดสอบ', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({
      where: { groupId: { in: [staffGroupId, editorGroupId].filter((v) => v !== undefined) } },
    }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { userId: { in: owners } } }),
  );
  await step('ผู้ใช้', () => prismaClient.user.deleteMany({ where: { id: { in: owners } } }));
  await step('กลุ่ม', () =>
    prismaClient.userGroup.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await prismaClient.$disconnect();
});

describe('A · สิทธิ์', () => {
  it('**ไม่มี LINK_ITEM = เชื่อมโยงไม่ได้ แม้จะแก้เรื่องได้**', async () => {
    /*
      ถ้าตรวจ `EDIT_ITEM` แล้วถือว่าครอบ คีย์ `LINK_ITEM` จะยังไม่มีผลอยู่ดี
      และหน้าตั้งค่าจะยังโกหกต่อไปในแบบเดิม (บทเรียนของ `BULK_EDIT`)
    */
    await expect(linkWorkItems(editor, keys[0] as string, keys[1] as string, 'BLOCKS')).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it('ปฏิเสธแล้วต้องไม่มีลิงก์เกิดขึ้น', async () => {
    expect(await prismaClient.workItemLink.count({ where: { sourceId: { in: ids } } })).toBe(0);
  });
});

describe('B · กติกาของการเชื่อม', () => {
  it('**เชื่อมกับตัวเองไม่ได้**', async () => {
    await expect(
      linkWorkItems(staff, keys[0] as string, keys[0] as string, 'RELATES_TO'),
    ).rejects.toThrow(SelfLinkError);
  });

  it('เชื่อมได้ และอ่านเห็นจากทั้งสองฝั่ง', async () => {
    await linkWorkItems(staff, keys[0] as string, keys[1] as string, 'BLOCKS');

    const fromSource = await linksOf(staff, ids[0] as bigint);
    const fromTarget = await linksOf(staff, ids[1] as bigint);
    expect(fromSource).toHaveLength(1);
    expect(fromTarget).toHaveLength(1);
    // ฝั่งหนึ่งขวางอีกฝั่ง — อีกฝั่งจึงถูกขวาง ไม่ใช่ข้อความเดียวกันทั้งสองทาง
    expect(fromSource[0]?.type).toBe('BLOCKS');
    expect(fromTarget[0]?.type).toBe('IS_BLOCKED_BY');
    expect(fromSource[0]?.other.itemKey).toBe(keys[1]);
    expect(fromTarget[0]?.other.itemKey).toBe(keys[0]);
  });

  it('**หนึ่งความสัมพันธ์เก็บแถวเดียว** ไม่ใช่สองแถวที่แยกกันได้', async () => {
    /*
      ถ้าเก็บสองแถว วันหนึ่งจะมีคนลบไปข้างเดียว แล้วเหลือความสัมพันธ์ที่มองเห็น
      จากฝั่งเดียว · ฐานข้อมูลจะตอบสองอย่างขัดกันโดยไม่มีอะไรบอกว่าผิด
    */
    const rows = await prismaClient.workItemLink.count({
      where: { OR: [{ sourceId: { in: ids } }, { targetId: { in: ids } }] },
    });
    expect(rows).toBe(1);
  });

  it('**เชื่อมซ้ำโดยพูดกลับทางไม่ได้** — เป็นความสัมพันธ์เดียวกัน', async () => {
    /*
      unique index คุม (source, target, type) แต่ไม่คุม (target, source, ชนิดตรงข้าม)
      ซึ่งเป็นประโยคเดียวกันพูดกลับทาง · ถ้าไม่ normalise ก่อนเขียน
      หน้ารายละเอียดจะแสดงความสัมพันธ์เดียวซ้ำสองบรรทัด
    */
    await expect(
      linkWorkItems(staff, keys[1] as string, keys[0] as string, 'IS_BLOCKED_BY'),
    ).rejects.toThrow(DuplicateLinkError);
    await expect(
      linkWorkItems(staff, keys[0] as string, keys[1] as string, 'BLOCKS'),
    ).rejects.toThrow(DuplicateLinkError);
  });

  it('**พูดกลับทางแล้วความหมายต้องไม่กลับ**', async () => {
    /*
      เคสนี้พิสูจน์การพลิกทิศก่อนเขียนโดยเฉพาะ · เคส "เชื่อมซ้ำ" ข้างบน
      พิสูจน์ไม่ได้ เพราะการหาซ้ำสองทิศบังผลของการพลิกทิศไว้ — ลบการพลิกทิ้ง
      แล้วเทสต์ยังเขียวทั้ง 14 เคส

      "A เกิดจาก B" ต้องเก็บเป็น "B เป็นสาเหตุของ A" · ถ้าไม่พลิก จะเก็บเป็น
      "A เป็นสาเหตุของ B" ซึ่งกลับความหมาย แล้วคนจะไปไล่แก้ผิดใบ
    */
    await linkWorkItems(staff, keys[4] as string, keys[5] as string, 'IS_CAUSED_BY');

    const stored = await prismaClient.workItemLink.findFirstOrThrow({
      where: { OR: [{ sourceId: ids[4] }, { sourceId: ids[5] }], type: 'CAUSES' },
      select: { sourceId: true, targetId: true },
    });
    // ต้นเหตุคือ keys[5] จึงต้องเป็นฝั่ง source ของแถวที่เก็บ
    expect(stored.sourceId).toBe(ids[5]);
    expect(stored.targetId).toBe(ids[4]);

    const asked = await linksOf(staff, ids[4] as bigint);
    const cause = await linksOf(staff, ids[5] as bigint);
    expect(asked[0]?.type).toBe('IS_CAUSED_BY');
    expect(cause[0]?.type).toBe('CAUSES');
  });

  it('**ชนิดสมมาตรที่พูดกลับทาง ก็เป็นความสัมพันธ์เดียวกัน**', async () => {
    /*
      เคสนี้พิสูจน์การหาซ้ำสองทิศโดยเฉพาะ · "A เกี่ยวข้องกับ B" กับ
      "B เกี่ยวข้องกับ A" เป็นประโยคเดียวกัน แต่ unique index
      `(source, target, type)` มองว่าเป็นคนละแถว เพราะไม่มีการพลิกทิศมาช่วย

      ถ้าปล่อยผ่าน หน้ารายละเอียดจะแสดงบรรทัดเดียวกันสองครั้ง และการกดถอด
      ครั้งหนึ่งจะเหลืออีกบรรทัดค้างไว้ ซึ่งดูเหมือนระบบไม่ยอมลบ
    */
    await linkWorkItems(staff, keys[4] as string, keys[5] as string, 'RELATES_TO');
    await expect(
      linkWorkItems(staff, keys[5] as string, keys[4] as string, 'RELATES_TO'),
    ).rejects.toThrow(DuplicateLinkError);
    expect(await linksOf(staff, ids[4] as bigint)).toHaveLength(2);
  });

  it('ความสัมพันธ์คนละชนิดกับคู่เดิม เชื่อมได้', async () => {
    // "ขวางอยู่" กับ "เกี่ยวข้องกัน" ตอบคนละคำถาม ไม่ใช่ของซ้ำ
    await linkWorkItems(staff, keys[0] as string, keys[1] as string, 'RELATES_TO');
    expect(await linksOf(staff, ids[0] as bigint)).toHaveLength(2);
  });

  it('ชนิดที่ไม่มีคู่ตรงข้ามในสคีมา ต้องอ่านออกจากอีกฝั่งอยู่ดี', async () => {
    /*
      `DUPLICATES` มีทิศทาง (ใบนี้ซ้ำกับใบนั้น) แต่สคีมาไม่มี `IS_DUPLICATED_BY`
      คู่ตรงข้ามจึงเป็น **เรื่องของการแสดงผล ไม่ใช่ค่าที่เก็บ** · ถ้าไม่จัดการ
      อีกฝั่งจะอ่านว่า "ซ้ำกับ" ซึ่งกลับความหมาย: ใบต้นฉบับจะดูเหมือนเป็นใบที่ซ้ำ
    */
    await linkWorkItems(staff, keys[2] as string, keys[3] as string, 'DUPLICATES');
    const dup = (await linksOf(staff, ids[2] as bigint)).find((l) => l.type === 'DUPLICATES');
    const orig = await linksOf(staff, ids[3] as bigint);
    expect(dup?.other.itemKey).toBe(keys[3]);
    expect(orig[0]?.label).not.toBe(dup?.label);
    expect(orig[0]?.other.itemKey).toBe(keys[2]);
  });
});

describe('C · ขอบเขตการมองเห็น', () => {
  it('**เชื่อมไปหาเรื่องที่เปิดดูไม่ได้ ตอบเหมือนเรื่องที่ไม่มีอยู่จริง**', async () => {
    /*
      ตอบ "ไม่มีสิทธิ์" กับใบที่มีอยู่จริง และ "ไม่พบ" กับใบที่ไม่มี
      คือการยืนยันว่าเลขนั้นมีอยู่ — เป็นการวาดแผนที่ให้คนที่กำลังไล่เดา
    */
    await expect(
      linkWorkItems(staff, keys[0] as string, hiddenKey as string, 'RELATES_TO'),
    ).rejects.toThrow(LinkTargetNotFoundError);
    await expect(
      linkWorkItems(staff, keys[0] as string, `SD-ไม่มีจริง-${STAMP}`, 'RELATES_TO'),
    ).rejects.toThrow(LinkTargetNotFoundError);
  });

  it('ปฏิเสธแล้วต้องไม่มีลิงก์ไปหางานของโปรเจกต์ที่มองไม่เห็น', async () => {
    expect(
      await prismaClient.workItemLink.count({
        where: { OR: [{ sourceId: hiddenId }, { targetId: hiddenId }] },
      }),
    ).toBe(0);
  });

  it('**ลิงก์ที่ปลายทางมองไม่เห็น ต้องไม่โผล่ตอนอ่าน**', async () => {
    /*
      สิทธิ์เปลี่ยนได้หลังลิงก์ถูกสร้าง · ลิงก์ที่เคยถูกต้องเมื่อวาน อาจชี้ไปยัง
      โปรเจกต์ที่ผู้ใช้เข้าไม่ได้แล้ววันนี้ · ตัวกรองตอนสร้างไม่ครอบกรณีนี้เลย
      จึงต้องกรองตอนอ่านด้วย ไม่ใช่เชื่อว่าตอนสร้างกรองไปแล้ว
    */
    await prismaClient.workItemLink.create({
      data: {
        tenantId,
        sourceId: ids[0] as bigint,
        targetId: hiddenId as bigint,
        type: 'RELATES_TO',
      },
    });
    const visible = await linksOf(staff, ids[0] as bigint);
    expect(visible.some((l) => l.other.itemKey === hiddenKey)).toBe(false);
  });
});

describe('D · ถอดการเชื่อม', () => {
  it('**ถอดจากฝั่งไหนก็ได้ — เพราะเป็นแถวเดียวกัน**', async () => {
    const before = await linksOf(staff, ids[1] as bigint);
    const blocked = before.find((l) => l.type === 'IS_BLOCKED_BY');
    expect(blocked).toBeDefined();

    // ถอดจากฝั่งปลายทาง ทั้งที่แถวถูกเก็บโดยมีอีกฝั่งเป็น source
    await unlinkWorkItems(staff, BigInt(blocked?.id ?? '0'));

    expect((await linksOf(staff, ids[1] as bigint)).some((l) => l.type === 'IS_BLOCKED_BY')).toBe(
      false,
    );
    expect((await linksOf(staff, ids[0] as bigint)).some((l) => l.type === 'BLOCKS')).toBe(false);
  });

  it('ไม่มี LINK_ITEM = ถอดไม่ได้', async () => {
    const remaining = await linksOf(staff, ids[0] as bigint);
    const one = remaining[0];
    expect(one).toBeDefined();
    await expect(unlinkWorkItems(editor, BigInt(one?.id ?? '0'))).rejects.toThrow(
      PermissionDeniedError,
    );
    expect(await linksOf(staff, ids[0] as bigint)).toHaveLength(remaining.length);
  });

  it('ถอดลิงก์ที่ไม่มีอยู่จริง ตอบเหมือนไม่มีสิทธิ์เห็น', async () => {
    await expect(unlinkWorkItems(staff, BigInt(999_999_999))).rejects.toThrow(
      LinkTargetNotFoundError,
    );
  });
});
