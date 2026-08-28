/**
 * สร้างและผูกชุดสิทธิ์จากหน้าจอ — เทสต์เป็นข้อกำหนด
 *
 * **อันตรายที่แท้จริงของหน้าจอนี้ไม่ใช่การสร้างใบใหม่ แต่คือการสลับชุด**
 * โปรเจกต์ที่ถูกสลับไปใช้ชุดที่ไม่มี `BROWSE_PROJECT` จะหายไปจากสายตาทุกคน
 * ทันที รวมทั้งคนที่กดสลับเอง และไม่มี error สักบรรทัด — วิธีเดียวที่จะกู้คือ
 * แก้ฐานข้อมูลตรง ๆ · เป็นความผิดพลาดที่แก้จากหน้าจอไม่ได้อีกเลยหลังจากกด
 *
 * เคยเกิดของจริงมาแล้วในโครงการนี้: เทสต์ที่ลบ grant `ADMINISTER_TENANT`
 * รายการสุดท้ายทำให้ไม่มีใครเข้าหน้าตั้งค่าได้ และกู้ได้ทาง SQL ทางเดียว
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  DuplicateSchemeNameError,
  SchemeInUseError,
  SchemeNameRequiredError,
  SchemeNotFoundError,
  WouldHideProjectError,
  createScheme,
  listSchemes,
  removeScheme,
  setProjectScheme,
} from '../src/modules/permission';

const STAMP = String(Date.now()).slice(-6);

let ctx: TenantContext;
let tenantId: bigint;
let actorId: bigint;
let sourceSchemeId: bigint;
let copiedId: bigint;
let emptySchemeId: bigint;
let projectId: bigint;
let originalSchemeId: bigint | null;

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  tenantId = tenant.id;
  actorId = (await prismaClient.user.findFirstOrThrow({ where: { tenantId, isSystem: false } })).id;
  ctx = { tenantId, actorId };

  sourceSchemeId = (
    await prismaClient.permissionScheme.findFirstOrThrow({
      where: { tenantId, grants: { some: { permission: 'BROWSE_PROJECT' } } },
      select: { id: true },
    })
  ).id;

  /*
    สร้างโปรเจกต์ของตัวเอง ไม่แตะโปรเจกต์จริง — การสลับชุดสิทธิ์ของโปรเจกต์
    ที่ใช้งานอยู่ เปลี่ยนว่าใครเห็นอะไรทันที และถ้าเทสต์ล้มกลางทางจะค้างไว้แบบนั้น
  */
  const p = await prismaClient.project.create({
    data: {
      tenantId,
      key: `PS${STAMP}`,
      name: `โปรเจกต์ทดสอบชุดสิทธิ์ ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: sourceSchemeId,
    },
    select: { id: true, permissionSchemeId: true },
  });
  projectId = p.id;
  originalSchemeId = p.permissionSchemeId;
}, 120_000);

afterAll(async () => {
  // คืนชุดเดิมให้โปรเจกต์ก่อน แล้วค่อยลบ — ลำดับนี้สำคัญเพราะ SetNull
  await step('คืนชุดเดิม', () =>
    prismaClient.project.updateMany({
      where: { id: projectId },
      data: { permissionSchemeId: originalSchemeId },
    }),
  );
  await step('grant ของชุดที่สร้าง', () =>
    prismaClient.permissionGrant.deleteMany({
      where: { scheme: { name: { contains: STAMP } } },
    }),
  );
  await step('โปรเจกต์ทดสอบ', () =>
    prismaClient.project.deleteMany({ where: { id: projectId } }),
  );
  await step('ชุดที่สร้าง', () =>
    prismaClient.permissionScheme.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({
      where: { actorId, action: { startsWith: 'permission.scheme.' } },
    }),
  );
  await prismaClient.$disconnect();
});

describe('A · สร้างชุดสิทธิ์', () => {
  it('ชื่อว่างและชื่อซ้ำถูกปฏิเสธ', async () => {
    await expect(createScheme(ctx, '   ')).rejects.toThrow(SchemeNameRequiredError);
    const existing = await prismaClient.permissionScheme.findFirstOrThrow({ where: { tenantId } });
    await expect(createScheme(ctx, existing.name)).rejects.toThrow(DuplicateSchemeNameError);
  });

  it('**คัดลอกจากใบที่มีอยู่ ได้ grant มาครบ**', async () => {
    /*
      ชุดเปล่าคือชุดที่ไม่มีใครเปิดดูโปรเจกต์ได้เลย · ผู้ดูแลที่สร้างชุดเปล่า
      แล้วผูกเข้าโปรเจกต์ทันที จะทำให้โปรเจกต์นั้นหายไปจากทุกคน
      การคัดลอกทำให้จุดเริ่มต้นใช้งานได้จริง แล้วค่อยแก้ทีละช่อง
    */
    const before = await prismaClient.permissionGrant.count({
      where: { schemeId: sourceSchemeId },
    });
    const r = await createScheme(ctx, `คัดลอก ${STAMP}`, sourceSchemeId);
    copiedId = r.id;
    expect(r.copiedGrants).toBe(before);
    expect(await prismaClient.permissionGrant.count({ where: { schemeId: copiedId } })).toBe(before);
  });

  it('สร้างชุดเปล่าได้ แต่รายงานว่าเปิดดูโปรเจกต์ไม่ได้', async () => {
    const r = await createScheme(ctx, `ชุดเปล่า ${STAMP}`);
    emptySchemeId = r.id;
    const rows = await listSchemes(ctx);
    const empty = rows.find((s) => s.id === emptySchemeId.toString());
    expect(empty?.grantCount).toBe(0);
    // หน้าจอต้องเห็นก่อนว่าชุดนี้ใช้ไม่ได้จริง ไม่ใช่รู้ตอนผูกไปแล้ว
    expect(empty?.canBrowse).toBe(false);
  });

  it('คัดลอกจากใบที่ไม่มีอยู่จริงถูกปฏิเสธ', async () => {
    await expect(createScheme(ctx, `พัง ${STAMP}`, BigInt(999_999_999))).rejects.toThrow(
      SchemeNotFoundError,
    );
    expect(
      await prismaClient.permissionScheme.count({ where: { name: { contains: `พัง ${STAMP}` } } }),
    ).toBe(0);
  });
});

describe('B · ผูกชุดเข้าโปรเจกต์', () => {
  it('**สลับไปใช้ชุดที่ไม่มีใครเปิดดูได้ ต้องถูกปฏิเสธ**', async () => {
    /*
      เคสที่สำคัญที่สุดของไฟล์นี้ · ถ้าปล่อยผ่าน โปรเจกต์หายจากทุกคนทันที
      รวมทั้งคนที่กดเอง และกู้ได้ทาง SQL ทางเดียว — แก้จากหน้าจอไม่ได้อีกเลย
    */
    await expect(setProjectScheme(ctx, projectId, emptySchemeId)).rejects.toThrow(
      WouldHideProjectError,
    );
  });

  it('ปฏิเสธแล้วโปรเจกต์ต้องยังใช้ชุดเดิมอยู่', async () => {
    const p = await prismaClient.project.findFirstOrThrow({
      where: { id: projectId },
      select: { permissionSchemeId: true },
    });
    expect(p.permissionSchemeId).toBe(sourceSchemeId);
  });

  it('สลับไปใช้ชุดที่เปิดดูได้ ทำได้', async () => {
    await setProjectScheme(ctx, projectId, copiedId);
    const p = await prismaClient.project.findFirstOrThrow({
      where: { id: projectId },
      select: { permissionSchemeId: true },
    });
    expect(p.permissionSchemeId).toBe(copiedId);
  });

  it('สลับเป็นชุดเดิมซ้ำ ไม่ใช่ความผิดพลาด และไม่เขียน audit ซ้ำ', async () => {
    const before = await prismaClient.auditLog.count({
      where: { action: 'permission.scheme.assign' },
    });
    await setProjectScheme(ctx, projectId, copiedId);
    const after = await prismaClient.auditLog.count({
      where: { action: 'permission.scheme.assign' },
    });
    expect(after).toBe(before);
  });
});

describe('C · ลบชุดสิทธิ์', () => {
  it('**ลบชุดที่ยังมีโปรเจกต์ใช้อยู่ไม่ได้ — และบอกว่าโปรเจกต์ไหน**', async () => {
    /*
      `Project.permissionSchemeId` เป็น `onDelete: SetNull` — ฐานข้อมูล
      **ไม่ได้กันให้** ลบไปแล้วโปรเจกต์นั้นจะไม่มีชุดสิทธิ์ แปลว่าไม่มีใคร
      เข้าถึงได้เลย เงียบ ๆ · ต้องกันที่โค้ด
    */
    await expect(removeScheme(ctx, copiedId)).rejects.toThrow(SchemeInUseError);
    const p = await prismaClient.project.findFirstOrThrow({
      where: { id: projectId },
      select: { permissionSchemeId: true },
    });
    expect(p.permissionSchemeId).toBe(copiedId);
  });

  it('ชุดที่ไม่มีใครใช้ ลบได้พร้อม grant ของมัน', async () => {
    const n = await prismaClient.permissionGrant.count({ where: { schemeId: emptySchemeId } });
    expect(n).toBe(0);
    await removeScheme(ctx, emptySchemeId);
    expect(
      await prismaClient.permissionScheme.count({ where: { id: emptySchemeId } }),
    ).toBe(0);
  });

  it('ลบชุดที่ไม่มีอยู่จริงถูกปฏิเสธ', async () => {
    await expect(removeScheme(ctx, BigInt(999_999_999))).rejects.toThrow(SchemeNotFoundError);
  });
});

describe('D · รายการชุดสิทธิ์', () => {
  it('บอกว่าโปรเจกต์ไหนใช้ชุดไหน — แก้ที่นี่กระทบที่นั่น', async () => {
    const rows = await listSchemes(ctx);
    const mine = rows.find((s) => s.id === copiedId.toString());
    expect(mine?.projects).toContain(`PS${STAMP}`);
    expect(mine?.canBrowse).toBe(true);
  });
});
