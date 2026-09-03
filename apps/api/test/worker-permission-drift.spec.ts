/**
 * worker กับ api ต้องตอบเรื่องสิทธิ์ **ตรงกันเสมอ**
 *
 * ตัวส่งรายงานตามตารางเวลาอยู่ใน worker และตรวจสิทธิ์เองก่อนประกอบไฟล์ ·
 * `resolveGrants` เป็นตัวเดียวกัน (อยู่ใน `@itsm/types`) แต่ **คิวรีคนละที่**
 * — api อ่านผ่าน `tenantScoped` ส่วน worker อ่านด้วย client ของตัวเอง
 *
 * **คิวรีที่ต่างกันคือที่ที่สองฝั่งจะเริ่มไม่ตรงกัน** และเรื่องสิทธิ์
 * ผิดแล้วไม่มีทางเห็นจนกว่าจะมีคนได้ข้อมูลที่ไม่ควรได้ · เทสต์นี้จึงเทียบ
 * คำตอบของทั้งสองฝั่งบนข้อมูลจริง ไม่ใช่เชื่อว่าเขียนเหมือนกัน
 *
 * อยู่ในชุดเทสต์ของ api เพราะที่นี่มีทั้ง `permissionsFor` และ Prisma client
 * ให้เรียกได้ในโปรเซสเดียว
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { permissionsFor } from '../src/modules/permission';
import { permissionsInProject } from '../../worker/src/report-build';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let projectId: bigint;
let withReport: bigint | undefined;
let browseOnly: bigint | undefined;
let noGroup: bigint | undefined;
/** โปรเจกต์ที่ยังไม่ได้ผูกชุดสิทธิ์ — ต้องไม่มีใครมีสิทธิ์อะไรเลย */
let noSchemeProjectId: bigint | undefined;

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
    data: { tenantId, name: `ชุดสิทธิ์เทียบ ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `DR${STAMP}`,
      name: `โปรเจกต์เทียบสิทธิ์ ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = project.id;

  const mkGroup = async (n: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `dr-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  const gFull = await mkGroup('full');
  const gBrowse = await mkGroup('browse');

  const mkUser = async (n: string, groupId: bigint | null): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `dr-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    if (groupId !== null) {
      await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    }
    return u.id;
  };
  withReport = await mkUser('full', gFull);
  browseOnly = await mkUser('browse', gBrowse);
  /** ไม่อยู่กลุ่มไหนเลย — ต้องได้เซ็ตว่างทั้งสองฝั่ง */
  noGroup = await mkUser('none', null);

  /*
    โปรเจกต์ที่ยังไม่ได้ผูกชุดสิทธิ์ · **ต้องแปลว่าไม่มีใครมีสิทธิ์อะไรเลย**
    ไม่ใช่ทุกคนมีทุกอย่าง — ข้อมูลที่ไม่ครบต้องแปลว่าไม่มีสิทธิ์
  */
  noSchemeProjectId = (
    await prismaClient.project.create({
      data: {
        tenantId,
        key: `DN${STAMP}`,
        name: `โปรเจกต์ไม่มีชุดสิทธิ์ ${STAMP}`,
        type: 'SERVICE_DESK',
      },
      select: { id: true },
    })
  ).id;

  /*
    ชุดสิทธิ์ **ใบที่สอง** ที่ให้ VIEW_REPORT กับกลุ่มที่ควรได้แค่ BROWSE ·
    โปรเจกต์ที่ทดสอบไม่ได้ผูกใบนี้ · ถ้าฝั่งไหนอ่าน grant ของทุกชุดสิทธิ์
    แทนที่จะอ่านเฉพาะใบที่โปรเจกต์ผูกไว้ สิทธิ์จะรั่วมาทันที
  */
  const otherScheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์อื่น ${STAMP}` },
    select: { id: true },
  });

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: otherScheme.id, permission: 'VIEW_REPORT', groupId: gBrowse },
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: gFull },
      { tenantId, schemeId: scheme.id, permission: 'VIEW_REPORT', groupId: gFull },
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: gBrowse },
      /*
        grant ที่ไม่มีกลุ่ม — ต้องถูกข้ามทั้งสองฝั่ง ไม่ใช่ตีความว่าให้ทุกคน
        · การเดาไปทางให้สิทธิ์เมื่อข้อมูลไม่ครบ คือวิธีที่ระบบสิทธิ์รั่วบ่อยที่สุด
      */
      { tenantId, schemeId: scheme.id, permission: 'ADMINISTER_TENANT', groupId: null },
    ] as never,
  });
}, 180_000);

afterAll(async () => {
  const owners = [withReport, browseOnly, noGroup].filter((v): v is bigint => v !== undefined);
  await step('โปรเจกต์', () =>
    prismaClient.project.deleteMany({ where: { key: { in: [`DR${STAMP}`, `DN${STAMP}`] } } }),
  );
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

/** คำตอบของทั้งสองฝั่ง เรียงแล้วเพื่อเทียบกันได้ */
async function bothSides(userId: bigint): Promise<{ api: string[]; worker: string[] }> {
  const ctx: TenantContext = { tenantId, actorId: userId };
  const api = [...(await permissionsFor(ctx, projectId))].sort();
  const worker = [...(await permissionsInProject(prismaClient, userId, projectId))].sort();
  return { api, worker };
}

/** คำตอบของทั้งสองฝั่ง สำหรับโปรเจกต์ที่ระบุ */
async function bothSidesIn(userId: bigint, pid: bigint): Promise<{ api: string[]; worker: string[] }> {
  const ctx: TenantContext = { tenantId, actorId: userId };
  return {
    api: [...(await permissionsFor(ctx, pid))].sort(),
    worker: [...(await permissionsInProject(prismaClient, userId, pid))].sort(),
  };
}

describe('worker กับ api ตอบเรื่องสิทธิ์ตรงกัน', () => {
  /**
   * **probe** — ถ้าทั้งสองฝั่งคืนเซ็ตว่างเสมอ เคสที่เหลือจะผ่านทุกอันโดยไม่ได้
   * ตรวจอะไรเลย · เซ็ตว่างเท่ากับเซ็ตว่าง
   */
  it('probe · ผู้ใช้ที่มีสิทธิ์จริง ได้คำตอบที่ไม่ว่าง', async () => {
    const r = await bothSides(withReport ?? 0n);
    expect(r.api.length, 'ฝั่ง api ตอบว่าง — เคสที่เหลือจะไม่ได้ตรวจอะไร').toBeGreaterThan(0);
    expect(r.worker.length).toBeGreaterThan(0);
  });

  it('**คนที่ดูรายงานได้ — ทั้งสองฝั่งตอบเหมือนกัน**', async () => {
    const r = await bothSides(withReport ?? 0n);
    expect(r.worker).toEqual(r.api);
    expect(r.api).toContain('VIEW_REPORT');
  });

  it('**คนที่เห็นโปรเจกต์แต่ดูรายงานไม่ได้ — ตรงกัน และไม่มี VIEW_REPORT**', async () => {
    const r = await bothSides(browseOnly ?? 0n);
    expect(r.worker).toEqual(r.api);
    expect(r.api).not.toContain('VIEW_REPORT');
  });

  /**
   * **ผู้ใช้ที่ไม่อยู่กลุ่มไหนเลย ต้องได้เซ็ตว่างทั้งสองฝั่ง**
   *
   * และ grant ที่ไม่มี `groupId` ต้องถูกข้าม ไม่ใช่ตีความว่าให้ทุกคน —
   * เคสนี้มี grant แบบนั้นอยู่ในชุดสิทธิ์ด้วย
   */
  it('**ไม่อยู่กลุ่มไหนเลย = ไม่มีสิทธิ์อะไร ทั้งสองฝั่ง**', async () => {
    const r = await bothSides(noGroup ?? 0n);
    expect(r.api).toEqual([]);
    expect(r.worker).toEqual([]);
  });

  it('grant ที่ไม่มีกลุ่ม ไม่ถูกนับให้ใครเลย', async () => {
    for (const u of [withReport, browseOnly, noGroup]) {
      const r = await bothSides(u ?? 0n);
      expect(r.api, 'grant ที่ตั้งค่าไม่ครบถูกตีความว่าให้ทุกคน').not.toContain(
        'ADMINISTER_TENANT',
      );
      expect(r.worker).not.toContain('ADMINISTER_TENANT');
    }
  });

  /**
   * **โปรเจกต์ที่ยังไม่ได้ผูกชุดสิทธิ์ = ไม่มีใครมีสิทธิ์อะไรเลย**
   *
   * ข้อมูลที่ไม่ครบต้องแปลว่าไม่มีสิทธิ์ ไม่ใช่ทุกคนมีทุกอย่าง (CLAUDE.md) ·
   * **เคสนี้เพิ่มเข้ามาหลังพบว่ากิ่งนั้นไม่มีเทสต์คุ้ม** — เปลี่ยนให้คืน
   * สิทธิ์เต็มเมื่อไม่มีชุดสิทธิ์ แล้วเทสต์ยังเขียวทั้งห้าเคส เพราะโปรเจกต์
   * ที่ใช้ทดสอบผูกชุดสิทธิ์ไว้อยู่แล้ว กิ่งนั้นจึงไม่เคยถูกเดินผ่าน
   */
  it('**โปรเจกต์ที่ไม่มีชุดสิทธิ์ = เซ็ตว่างทั้งสองฝั่ง**', async () => {
    const r = await bothSidesIn(withReport ?? 0n, noSchemeProjectId ?? 0n);
    expect(r.worker, 'ไม่มีชุดสิทธิ์แล้วให้สิทธิ์ไปเลย').toEqual([]);
    expect(r.api).toEqual([]);
  });

  /**
   * **ต้องอ่าน grant เฉพาะชุดสิทธิ์ที่โปรเจกต์ผูกไว้**
   *
   * ชุดสิทธิ์ใบที่สองให้ `VIEW_REPORT` กับกลุ่มที่ควรได้แค่ `BROWSE_PROJECT` ·
   * ถ้าฝั่งไหนอ่าน grant ของทุกชุดสิทธิ์ สิทธิ์จะรั่วมาทันที ·
   * **เคสนี้เพิ่มหลังพบว่าเดิมจับไม่ได้** — ไม่มี grant ของชุดอื่นที่ชี้ไปยัง
   * กลุ่มของผู้ใช้ทดสอบเลย การอ่านทุกชุดจึงไม่เปลี่ยนคำตอบ
   */
  it('**grant ของชุดสิทธิ์อื่นต้องไม่รั่วเข้ามา**', async () => {
    const r = await bothSides(browseOnly ?? 0n);
    expect(r.worker, 'อ่าน grant ของชุดสิทธิ์ที่โปรเจกต์ไม่ได้ผูกไว้').not.toContain('VIEW_REPORT');
    expect(r.api).not.toContain('VIEW_REPORT');
  });
});
