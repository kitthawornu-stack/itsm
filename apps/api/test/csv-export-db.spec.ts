/**
 * ส่งออก CSV — ต่อของจริง
 *
 * `csv-export.spec.ts` พิสูจน์ว่าตัวเขียนไฟล์ถูก · ไฟล์นี้พิสูจน์ว่า
 * **มีอะไรในระบบเรียกมันได้จริง และเรียกด้วยข้อมูลจริง** — บทเรียนใน
 * CLAUDE.md บอกว่าเทสต์ที่ประกอบข้อมูลนำเข้าขึ้นเอง พิสูจน์ได้แค่ว่า
 * *ถ้า* ข้อมูลหน้าตาแบบนั้นเข้ามา ผลจะถูก ไม่ได้พิสูจน์ว่ามีอะไรสร้างมันได้
 *
 * สามคำถามที่ตอบได้เฉพาะที่นี่:
 *   1. งานที่อยู่ในฐานข้อมูลจริง ออกมาเป็นแถวในไฟล์จริงหรือไม่
 *   2. คนที่ไม่มีสิทธิ์เปิดโปรเจกต์ ส่งออกได้หรือไม่
 *   3. มีร่องรอยใน `audit_log` ว่าใครดึงข้อมูลออกไปหรือไม่
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { parseCsv } from '../src/modules/integration/csv-import';
import {
  ProjectNotFoundForExportError,
  exportProjectCsv,
} from '../src/modules/integration/csv-export.service';
import { PermissionDeniedError } from '../src/modules/permission';

const STAMP = String(Date.now()).slice(-6);
const NOW = new Date('2026-09-02T03:00:00.000Z');

let tenantId: bigint;
let projectId: bigint;
let projectKey: string;
let memberId: bigint;
let outsiderId: bigint;
let memberCtx: TenantContext;
let outsiderCtx: TenantContext;
let groupId: bigint;
const grantIds: bigint[] = [];
/** คีย์ของงานที่เทสต์สร้างเอง — มี STAMP เสมอ จึงไม่มีทางชนกับของ seed */
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
  const project = await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } });
  projectId = project.id;
  projectKey = project.key;

  const sample = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId },
    select: { issueTypeId: true, statusId: true, priorityId: true },
  });

  const mkUser = async (tag: string): Promise<bigint> =>
    (
      await prismaClient.user.create({
        data: {
          tenantId,
          email: `exp-${tag}-${STAMP}@example.test`,
          displayName: `QA ส่งออก ${tag} ${STAMP}`,
        },
        select: { id: true },
      })
    ).id;
  memberId = await mkUser('member');
  outsiderId = await mkUser('outsider');
  memberCtx = { tenantId, actorId: memberId };
  outsiderCtx = { tenantId, actorId: outsiderId };

  const schemeId = project.permissionSchemeId;
  if (schemeId === null) throw new Error('โปรเจกต์ SD ไม่มี permission scheme');

  /*
    กลุ่มของเทสต์เอง ไม่แตะกลุ่มของ seed — เทสต์ที่แก้ข้อมูลร่วมเคยทำให้
    agent1/agent2 หลุดจาก IT Support ค้างไว้จริง (CLAUDE.md)
  */
  groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `ส่งออก ${STAMP}` },
      select: { id: true },
    })
  ).id;
  const grant = await prismaClient.permissionGrant.create({
    data: { tenantId, schemeId, permission: 'BROWSE_PROJECT', groupId },
    select: { id: true },
  });
  grantIds.push(grant.id);
  await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: memberId } });

  /*
    **งานของเทสต์เอง พร้อมหัวข้อที่มีจุลภาคและคำพูด** — ค่าที่ทำให้ CSV พัง
    ต้องมาจากฐานข้อมูลจริง ไม่ใช่จากสตริงที่เทสต์ประกอบเอง มิฉะนั้นเราจะไม่รู้
    ว่าเส้นทางจริงตั้งแต่ Prisma ถึงไฟล์รักษาค่าไว้ครบหรือไม่
  */
  for (const [i, summary] of [
    'ปริ๊นเตอร์ชั้น 3 เสีย, ด่วนมาก',
    'ขอสิทธิ์เข้าโฟลเดอร์ "บัญชี" ให้หน่อย',
  ].entries()) {
    const itemKey = `EXP-${STAMP}-${String(i)}`;
    keys.push(itemKey);
    await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey,
        summary,
        issueTypeId: sample.issueTypeId,
        statusId: sample.statusId,
        priorityId: sample.priorityId,
        reporterId: memberId,
        // LexoRank — เทสต์นี้ไม่สนใจลำดับ แต่คอลัมน์บังคับ ต้องไม่ชนกันเอง
        rank: `zzz${STAMP}${String(i)}`,
      },
    });
  }
}, 120_000);

afterAll(async () => {
  await step('งานทดสอบ', () =>
    prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }),
  );
  /*
    ถาม `audit_log` ว่าผู้ใช้ของเทสต์แตะอะไรไปบ้าง แทนที่จะเชื่อตัวแปรที่จำไว้
    — และต้องลบ **หลัง** เคสที่อ่าน audit ทำงานเสร็จแล้ว
  */
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({ where: { actorId: { in: [memberId, outsiderId] } } }),
  );
  await step('สิทธิ์ของเทสต์', () =>
    prismaClient.permissionGrant.deleteMany({ where: { id: { in: grantIds } } }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { userId: { in: [memberId, outsiderId] } } }),
  );
  /*
    ลบผู้ใช้ด้วย **รูปอีเมลที่ไฟล์นี้เป็นเจ้าของ** ไม่ใช่ตัวแปรที่จำไว้ —
    ตอนกลไกหายไป เคสที่ "ไม่ควรสร้างอะไร" จะสร้างจริง (CLAUDE.md)
  */
  await step('ผู้ใช้', () =>
    prismaClient.user.deleteMany({ where: { email: { endsWith: `-${STAMP}@example.test` } } }),
  );
  await step('กลุ่ม', () => prismaClient.userGroup.deleteMany({ where: { id: groupId } }));

  const left = await prismaClient.user.count({
    where: { email: { endsWith: `-${STAMP}@example.test` } },
  });
  await prismaClient.$disconnect();
  expect(left, `เก็บกวาดไม่ครบ — เหลือผู้ใช้ของเทสต์ ${String(left)} คน`).toBe(0);
});

describe('ส่งออก CSV · ต่อของจริง', () => {
  it('**งานที่อยู่ในฐานข้อมูลจริง ออกมาเป็นแถวในไฟล์**', async () => {
    const out = await exportProjectCsv(memberCtx, projectKey, NOW);
    const parsed = parseCsv(out.csv);
    const found = parsed.rows.filter((r) => keys.includes(r.values[0] ?? ''));
    expect(found).toHaveLength(2);
    expect(out.rows).toBe(parsed.rows.length);
  }, 120_000);

  /**
   * **หัวใจของไฟล์นี้** — ค่าที่ทำให้ CSV พัง เดินทางจาก MySQL ผ่าน Prisma
   * ผ่านตัวเขียน แล้วอ่านกลับได้เหมือนเดิมทุกตัวอักษร · เทสต์ของฟังก์ชัน
   * บริสุทธิ์พิสูจน์ตรงนี้ไม่ได้ เพราะมันไม่เคยผ่านฐานข้อมูลจริง
   */
  it('**จุลภาคและคำพูดในหัวข้อจริง วนกลับได้ครบตัวอักษร**', async () => {
    const out = await exportProjectCsv(memberCtx, projectKey, NOW);
    const byKey = new Map(parseCsv(out.csv).rows.map((r) => [r.values[0] ?? '', r.values]));
    expect(byKey.get(keys[0] as string)?.[1]).toBe('ปริ๊นเตอร์ชั้น 3 เสีย, ด่วนมาก');
    expect(byKey.get(keys[1] as string)?.[1]).toBe('ขอสิทธิ์เข้าโฟลเดอร์ "บัญชี" ให้หน่อย');
  }, 120_000);

  it('ชื่อไฟล์บอกโปรเจกต์และวันที่ — คนดาวน์โหลดหลายใบต้องแยกออก', async () => {
    const out = await exportProjectCsv(memberCtx, projectKey, NOW);
    expect(out.filename).toBe('SD-2026-09-02.csv');
  }, 120_000);

  /**
   * **คนที่ไม่มีสิทธิ์เปิดโปรเจกต์ ส่งออกไม่ได้**
   *
   * การส่งออกคือการอ่านทุกใบพร้อมกัน จึงต้องไม่ง่ายกว่าการเปิดดูทีละใบ ·
   * เคสนี้คือเหตุผลที่ `assertCan` อยู่ในเส้นทางนี้
   */
  it('**คนที่ไม่อยู่กลุ่มไหนเลย ส่งออกไม่ได้**', async () => {
    await expect(exportProjectCsv(outsiderCtx, projectKey, NOW)).rejects.toThrow(
      PermissionDeniedError,
    );
  }, 120_000);

  it('โปรเจกต์ที่ไม่มีอยู่ ตอบว่าไม่พบ ไม่ใช่ไฟล์เปล่า', async () => {
    await expect(exportProjectCsv(memberCtx, `ไม่มี${STAMP}`, NOW)).rejects.toThrow(
      ProjectNotFoundForExportError,
    );
  }, 120_000);

  /**
   * **ต้องมีร่องรอยว่าข้อมูลออกจากระบบไปแล้ว**
   *
   * การส่งออกไม่ใช่การแก้ข้อมูล แต่เป็นเหตุการณ์ที่ต้องตอบได้ภายหลังว่า
   * ใครดึงอะไรออกไปเมื่อไร · ถ้าไม่บันทึก จะไม่มีทางรู้เลยว่าเคยเกิดขึ้น
   */
  it('**บันทึก audit ว่าใครส่งออกอะไรไปกี่แถว**', async () => {
    const before = await prismaClient.auditLog.count({
      where: { actorId: memberId, action: 'integration.export.csv' },
    });
    const out = await exportProjectCsv(memberCtx, projectKey, NOW);
    const rowsAfter = await prismaClient.auditLog.findMany({
      where: { actorId: memberId, action: 'integration.export.csv' },
      orderBy: { id: 'desc' },
      take: 1,
    });
    expect(rowsAfter).toHaveLength(1);
    expect(
      await prismaClient.auditLog.count({
        where: { actorId: memberId, action: 'integration.export.csv' },
      }),
    ).toBe(before + 1);
    const payload = rowsAfter[0]?.payload as { rows?: number; projectKey?: string } | null;
    expect(payload?.projectKey).toBe('SD');
    expect(payload?.rows).toBe(out.rows);
  }, 120_000);
});
