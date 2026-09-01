/**
 * นำเข้าข้อมูลจาก Excel/CSV — ต่อของจริง
 *
 * `csv-import.spec.ts` ประกอบข้อมูลนำเข้าขึ้นมาเอง จึงพิสูจน์ได้แค่ว่า *ถ้า*
 * ไฟล์หน้าตาแบบนั้นเข้ามา ผลจะถูก · ไฟล์นี้ถามคำถามที่เอนจินตอบไม่ได้:
 *
 *   1. **รายการที่ใช้ตรวจ มาจากฐานข้อมูลจริงไหม** — ถ้าอ่านมาเป็นรายการว่าง
 *      ทุกค่าจะถูกปฏิเสธว่า "ไม่รู้จัก" ทั้งที่ถูกต้อง
 *   2. **สถานะของโปรเจกต์อื่น ต้องถูกปฏิเสธ** — ไม่ใช่รับไว้แล้วพังตอน
 *      เปลี่ยนสถานะครั้งแรก
 *   3. **มีปัญหาแม้ข้อเดียว ไม่เขียนอะไรเลย** — ตรวจด้วยการนับแถวจริง
 *   4. **นำเข้าซ้ำไม่สร้างซ้ำ** — คนจะรันไฟล์เดิมอีกรอบเสมอ
 *   5. **`previewImport` ไม่เขียนอะไรเลย** — ถ้าเขียน คนที่กดดูตัวอย่าง
 *      จะสร้างข้อมูลโดยไม่ตั้งใจ
 *   6. **ด่านสิทธิ์** — นำเข้าเป็นการสร้างงานทีละหลายร้อยใบ
 *
 * เทสต์สร้างโปรเจกต์ ผู้ใช้ กลุ่ม และงานของตัวเองทั้งหมด แล้วลบทิ้ง
 * ไม่แตะข้อมูล seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError, type PermissionKey } from '../src/modules/permission';
import { BROKEN_TEXT_MARKER, previewImport, runImport } from '../src/modules/integration';

const STAMP = String(Date.now()).slice(-6);
const HEAD = 'externalKey,summary,status,priority,reporterEmail';

let tenantId: bigint;
let projectId: bigint;
let projectKey = '';
let statusName = '';
/** สถานะที่มีอยู่จริงในระบบ แต่ **ไม่ใช่ของโปรเจกต์นี้** */
let foreignStatusName = '';
/** ผู้แจ้งที่ **ไม่ใช่คนที่กดนำเข้า** — ใช้พิสูจน์ว่าอ่านค่าจากไฟล์จริง */
let reporterId: bigint;
let reporterEmail = '';
let ctx: TenantContext;
let outsiderCtx: TenantContext;
let actorId: bigint;
let groupId: bigint;
const grantIds: bigint[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

const csv = (...rows: string[]): string => [HEAD, ...rows].join('\n');

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  const project = await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } });
  projectId = project.id;
  projectKey = project.key;

  /*
    สถานะที่ใช้ต้องเป็นของ **workflow ที่ผูกกับโปรเจกต์นี้จริง ๆ** —
    การหยิบสถานะแรกใน tenant มาใช้ อาจได้ของโปรเจกต์อื่น แล้วเคสที่ควรผ่าน
    จะแดงด้วยเหตุผลที่ไม่เกี่ยวกับสิ่งที่มันวัด
  */
  statusName = (
    await prismaClient.workflowStatus.findFirstOrThrow({
      where: { workflow: { schemes: { some: { project: { id: projectId } } } } },
      select: { name: true },
    })
  ).name;

  /*
    สถานะของโปรเจกต์อื่น — จำเป็นเพื่อพิสูจน์ว่าตัวกรอง "ผูกกับโปรเจกต์นี้"
    ทำงานจริง · ถ้าใช้แต่สถานะที่ไม่มีอยู่เลย การถอดตัวกรองออกจะยังเขียว
    เพราะค่านั้นก็ยังไม่รู้จักอยู่ดี (พิสูจน์แล้วตอนลบกลไกทีละบรรทัด)
  */
  const mine = new Set(
    (
      await prismaClient.workflowStatus.findMany({
        where: { workflow: { schemes: { some: { project: { id: projectId } } } } },
        select: { name: true },
      })
    ).map((r) => r.name),
  );
  const foreign = (
    await prismaClient.workflowStatus.findMany({
      where: { workflow: { schemes: { some: { tenantId } } } },
      select: { name: true },
      distinct: ['name'],
    })
  ).find((r) => !mine.has(r.name));
  if (foreign === undefined) throw new Error('ไม่มีสถานะของโปรเจกต์อื่นให้ทดสอบ');
  foreignStatusName = foreign.name;

  actorId = (
    await prismaClient.user.create({
      data: {
        tenantId,
        email: `imp-${STAMP}@example.test`,
        displayName: `QA นำเข้า ${STAMP}`,
      },
      select: { id: true },
    })
  ).id;
  ctx = { tenantId, actorId };
  // ผู้แจ้งเป็นคนละคนกับผู้กดนำเข้า — ไม่งั้นการอ่านอีเมลจากไฟล์จะพิสูจน์ไม่ได้
  reporterId = (
    await prismaClient.user.create({
      data: {
        tenantId,
        email: `imp-rep-${STAMP}@example.test`,
        displayName: `ผู้แจ้งของ QA ${STAMP}`,
      },
      select: { id: true },
    })
  ).id;
  reporterEmail = `imp-rep-${STAMP}@example.test`;
  // ไม่ใส่เข้ากลุ่มไหนเลย — "ข้อมูลที่ไม่ครบต้องแปลว่าไม่มีสิทธิ์"
  outsiderCtx = {
    tenantId,
    actorId: (
      await prismaClient.user.create({
        data: {
          tenantId,
          email: `imp-out-${STAMP}@example.test`,
          displayName: `คนนอก ${STAMP}`,
        },
        select: { id: true },
      })
    ).id,
  };

  const schemeId = (
    await prismaClient.project.findFirstOrThrow({
      where: { id: projectId },
      select: { permissionSchemeId: true },
    })
  ).permissionSchemeId;
  if (schemeId === null) throw new Error('โปรเจกต์ SD ไม่มี permission scheme');
  groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId, name: `นำเข้า ${STAMP}` },
      select: { id: true },
    })
  ).id;
  await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: actorId } });
  for (const permission of ['BROWSE_PROJECT', 'MANAGE_PROJECT'] as PermissionKey[]) {
    const g = await prismaClient.permissionGrant.create({
      data: { tenantId, schemeId, permission, groupId },
      select: { id: true },
    });
    grantIds.push(g.id);
  }
}, 120_000);

afterAll(async () => {
  /*
    ลบงานที่ **การนำเข้าสร้างขึ้น** ผ่าน `import_record` ไม่ใช่ตามคีย์ที่เดาเอง —
    คีย์ของงานที่นำเข้ามาจาก `projectCounter` เราจึงไม่รู้ล่วงหน้าว่าเป็นเลขอะไร
    · และตอนกลไกถูกลบ อาจมีงานที่ไม่ควรถูกสร้างขึ้นมาจริง
  */
  await step('งานที่นำเข้า', async () => {
    const recs = await prismaClient.importRecord.findMany({
      where: { importedById: actorId },
      select: { workItemId: true },
    });
    const ids = recs.map((r) => r.workItemId);
    await prismaClient.importRecord.deleteMany({ where: { importedById: actorId } });
    await prismaClient.workItemHistory.deleteMany({ where: { workItemId: { in: ids } } });
    await prismaClient.workItem.deleteMany({ where: { id: { in: ids } } });
  });
  await step('งานที่ผู้ใช้ของเทสต์เป็นผู้แจ้ง', () =>
    prismaClient.workItem.deleteMany({ where: { reporterId: { in: [actorId, reporterId] } } }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({ where: { actor: { email: { contains: STAMP } } } }),
  );
  await step('สิทธิ์ของเทสต์', () =>
    prismaClient.permissionGrant.deleteMany({ where: { id: { in: grantIds } } }),
  );
  await step('สมาชิกกลุ่ม', () => prismaClient.groupMember.deleteMany({ where: { groupId } }));
  await step('ผู้ใช้ของเทสต์', () =>
    prismaClient.user.deleteMany({ where: { email: { contains: STAMP } } }),
  );
  await step('กลุ่มของเทสต์', () => prismaClient.userGroup.deleteMany({ where: { id: groupId } }));

  // ยืนยันด้วยการนับหลังคืน ไม่ใช่เชื่อว่าลูปทำงาน
  const left = await prismaClient.importRecord.count({ where: { importedById: actorId } });
  if (left > 0) console.error(`เหลือร่องรอยการนำเข้าค้างอยู่ ${String(left)} แถว`);
  await prismaClient.$disconnect();
});

const countMine = async (): Promise<number> =>
  prismaClient.importRecord.count({ where: { importedById: actorId } });

describe('นำเข้า CSV · ต่อของจริง', () => {
  it('**รายการที่ใช้ตรวจ มาจากฐานข้อมูลจริง — ค่าที่ถูกต้องต้องผ่าน**', async () => {
    const r = await runImport(
      ctx,
      projectKey,
      csv(`X-${STAMP}-1,งานเก่าจาก Excel ${STAMP},${statusName},,${reporterEmail}`),
    );
    expect(r.problems, JSON.stringify(r.problems)).toEqual([]);
    expect(r.created).toBe(1);
    expect(await countMine()).toBe(1);
  });

  /**
   * **สถานะที่โปรเจกต์นี้ไม่มี ต้องถูกปฏิเสธ**
   *
   * ไม่ใช่รับไว้แล้วพังตอนเปลี่ยนสถานะครั้งแรก — ตอนนั้นไม่มีใครโยงกลับมาถึง
   * การนำเข้าเมื่อสามเดือนก่อนได้แล้ว
   */
  it('**สถานะที่ไม่รู้จัก ถูกปฏิเสธ และไม่เขียนอะไรเลย**', async () => {
    const before = await countMine();
    const r = await runImport(
      ctx,
      projectKey,
      csv(`X-${STAMP}-BAD,ทดสอบ,สถานะที่ไม่มีจริง ${STAMP},,${reporterEmail}`),
    );
    expect(r.created).toBe(0);
    expect(r.problems[0]?.column).toBe('status');
    expect(await countMine()).toBe(before);
  });

  /**
   * **มีปัญหาแม้ข้อเดียว ไม่เขียนอะไรเลย** — ตรวจด้วยการนับแถวจริง
   * ไม่ใช่เชื่อค่าที่ฟังก์ชันคืนมา
   */
  it('**สองแถวถูก หนึ่งแถวผิด = ไม่มีอะไรถูกสร้าง**', async () => {
    const before = await countMine();
    const r = await runImport(
      ctx,
      projectKey,
      csv(
        `X-${STAMP}-P1,ถูก,${statusName},,${reporterEmail}`,
        `X-${STAMP}-P2,ผิด,ไม่มีสถานะนี้,,${reporterEmail}`,
        `X-${STAMP}-P3,ถูก,${statusName},,${reporterEmail}`,
      ),
    );
    expect(r.created).toBe(0);
    expect(await countMine()).toBe(before);
  });

  it('**นำเข้าไฟล์เดิมซ้ำ ไม่สร้างซ้ำ**', async () => {
    const file = csv(`X-${STAMP}-1,งานเก่าจาก Excel ${STAMP},${statusName},,${reporterEmail}`);
    const before = await countMine();
    const r = await runImport(ctx, projectKey, file);
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(1);
    expect(await countMine()).toBe(before);
  });

  it('**ดูตัวอย่างแล้วไม่มีอะไรถูกเขียน**', async () => {
    const before = await countMine();
    const p = await previewImport(
      ctx,
      projectKey,
      csv(
        `X-${STAMP}-PRE,ยังไม่ได้นำเข้า,${statusName},,${reporterEmail}`,
        `X-${STAMP}-1,เคยนำเข้าแล้ว,${statusName},,${reporterEmail}`,
      ),
    );
    expect(p.problems).toEqual([]);
    expect(p.toCreate).toBe(1);
    expect(p.alreadyImported).toBe(1);
    expect(p.totalRows).toBe(2);
    expect(await countMine(), 'ดูตัวอย่างแล้วมีแถวเพิ่ม — แปลว่ามันเขียนจริง').toBe(before);
  });

  it('**ไฟล์ที่รหัสอักขระเสีย ถูกปฏิเสธทั้งไฟล์**', async () => {
    const before = await countMine();
    const r = await runImport(
      ctx,
      projectKey,
      csv(`X-${STAMP}-ENC,เครื่องพิมพ์${BROKEN_TEXT_MARKER}เสีย,${statusName},,${reporterEmail}`),
    );
    expect(r.created).toBe(0);
    expect(r.problems[0]?.message).toContain('รหัสอักขระ');
    expect(await countMine()).toBe(before);
  });

  /**
   * **สถานะของโปรเจกต์อื่น ต้องถูกปฏิเสธ**
   *
   * มันมีอยู่จริงในระบบ แค่ไม่ใช่ของ workflow ที่ผูกกับโปรเจกต์นี้ ·
   * ถ้ารับไว้ งานจะถูกสร้างด้วยสถานะที่ workflow ของมันไม่รู้จัก
   * แล้วพังตอนกดเปลี่ยนสถานะครั้งแรก — ซึ่งไม่มีใครโยงกลับมาถึงการนำเข้าได้แล้ว
   */
  it('**สถานะที่เป็นของโปรเจกต์อื่น ถูกปฏิเสธ**', async () => {
    const before = await countMine();
    const r = await runImport(
      ctx,
      projectKey,
      csv(`X-${STAMP}-FOREIGN,ทดสอบ,${foreignStatusName},,${reporterEmail}`),
    );
    expect(r.created).toBe(0);
    expect(r.problems[0]?.column).toBe('status');
    expect(r.problems[0]?.message).toContain(foreignStatusName);
    expect(await countMine()).toBe(before);
  });

  it('**คนที่ไม่มีสิทธิ์จัดการโปรเจกต์ นำเข้าไม่ได้ และดูตัวอย่างไม่ได้**', async () => {
    await expect(
      runImport(outsiderCtx, projectKey, csv(`X-${STAMP}-SEC,ทดสอบ,${statusName},,${reporterEmail}`)),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(previewImport(outsiderCtx, projectKey, csv())).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  /**
   * **ภาษาไทยต้องรอดตลอดทางจนถึงฐานข้อมูลและกลับมา**
   *
   * §9 ของ CLAUDE.md บันทึกไว้ว่าเคยยืนยันว่า "ค้นหาภาษาไทยได้แล้ว" ทั้งที่
   * ทั้งสองฝั่งถูกแปลงเป็นเครื่องหมายคำถามเหมือนกัน · เคสนี้อ่านกลับผ่าน Prisma
   * แล้วเทียบกับสตริงในซอร์ส ซึ่งไม่ผ่านคอนโซลหรือ shell เลยสักชั้น
   */
  it('**ข้อความไทยที่นำเข้า อ่านกลับมาได้ครบทุกตัวอักษร**', async () => {
    const thai = `เครื่องพิมพ์ชั้น 3 พิมพ์ไม่ออก สระอำและวรรณยุกต์ครบ ${STAMP}`;
    const r = await runImport(
      ctx,
      projectKey,
      csv(`X-${STAMP}-TH,${thai},${statusName},,${reporterEmail}`),
    );
    expect(r.created).toBe(1);
    const rec = await prismaClient.importRecord.findFirstOrThrow({
      where: { importedById: actorId, externalKey: `X-${STAMP}-TH` },
      select: { workItem: { select: { summary: true } } },
    });
    expect(rec.workItem.summary).toBe(thai);
    // และไม่มีอักขระแทนที่ปนมาแม้แต่ตัวเดียว
    expect(rec.workItem.summary).not.toContain(BROKEN_TEXT_MARKER);
  });

  it('งานที่นำเข้ามา อ่านกลับได้และผูกกับผู้แจ้งที่ระบุในไฟล์', async () => {
    const rec = await prismaClient.importRecord.findFirstOrThrow({
      where: { importedById: actorId, externalKey: `X-${STAMP}-1` },
      select: { workItem: { select: { summary: true, reporterId: true, projectId: true } } },
    });
    expect(rec.workItem.summary).toContain(STAMP);
    // ผู้แจ้งมาจากอีเมลในไฟล์ ไม่ใช่คนที่กดนำเข้า
    expect(rec.workItem.reporterId).toBe(reporterId);
    expect(rec.workItem.reporterId).not.toBe(actorId);
    expect(rec.workItem.projectId).toBe(projectId);
  });
});
