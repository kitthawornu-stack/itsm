/**
 * เทสต์กลไกบังคับ INVARIANT 1 และ 2 ในเส้นทางที่ยังไม่เคยถูกทดสอบ
 *
 * การวัด coverage รอบแรกพบว่าไฟล์ที่ครอบคลุมต่ำที่สุดสองไฟล์
 * คือ tenant-scope.ts (78.6%) และ audited-transaction.ts (79.7%)
 * ซึ่งบังเอิญเป็น **กลไกบังคับ invariant ทั้งสองข้อ** — คือที่ที่ branch
 * ที่ไม่ถูกทดสอบอันตรายที่สุดในระบบทั้งหมด
 *
 * เส้นทางที่ขาดไป:
 *   - upsert (ทั้ง where และ create ต้องถูก inject tenantId)
 *   - withSystemScope (ทางออกฉุกเฉินที่ข้าม tenant scope ได้จริง)
 *   - audit_log สำหรับเหตุการณ์ระดับระบบ (ไม่ใช่แค่ work_item_history)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  auditedTransaction,
  type AuditEntry,
} from '../src/infrastructure/audit/audited-transaction';
import { prismaClient } from '../src/infrastructure/prisma/client';
import { tenantScoped, withSystemScope } from '../src/infrastructure/prisma/tenant-scope';
import { CrossTenantAccessError, type TenantContext } from '@itsm/types';

import { purgeTenants } from './helpers/cleanup';

const KEY_A = 'test-inv-a';
const KEY_B = 'test-inv-b';

let ctxA: TenantContext;
let ctxB: TenantContext;
let tenantB: bigint;

beforeAll(async () => {
  await purgeTenants([KEY_A, KEY_B]);
  const a = await prismaClient.tenant.create({ data: { key: KEY_A, name: 'Invariant A' } });
  const b = await prismaClient.tenant.create({ data: { key: KEY_B, name: 'Invariant B' } });
  tenantB = b.id;
  ctxA = { tenantId: a.id, actorId: null, traceId: 'trace-test-001' };
  ctxB = { tenantId: b.id, actorId: null };

  await prismaClient.user.create({
    data: { tenantId: a.id, email: 'inv-a@example.test', displayName: 'ผู้ใช้ A' },
  });
  await prismaClient.user.create({
    data: { tenantId: b.id, email: 'inv-b@example.test', displayName: 'ผู้ใช้ B' },
  });
});

afterAll(async () => {
  await purgeTenants([KEY_A, KEY_B]);
  await prismaClient.$disconnect();
});

describe('INVARIANT 1 · upsert', () => {
  it('upsert ที่สร้างใหม่ ได้ tenantId ของ scope อัตโนมัติ', async () => {
    const db = tenantScoped(ctxA);
    const created = await db.userGroup.upsert({
      where: { tenantId_name: { tenantId: ctxA.tenantId, name: 'กลุ่มทดสอบ upsert' } },
      // @ts-expect-error tenantId ถูก inject โดย extension — ตั้งใจไม่ส่ง
      create: { name: 'กลุ่มทดสอบ upsert' },
      update: {},
    });
    expect(created.tenantId).toBe(ctxA.tenantId);
  });

  it('upsert ที่ระบุ tenantId ของคนอื่นใน where ถูกปฏิเสธ', async () => {
    const db = tenantScoped(ctxA);
    await expect(
      db.userGroup.upsert({
        where: { tenantId_name: { tenantId: tenantB, name: 'ลอบเขียน' } },
        create: { tenantId: tenantB, name: 'ลอบเขียน' },
        update: {},
      }),
    ).rejects.toThrow(CrossTenantAccessError);
  });

  it('upsert ที่ระบุ tenantId ของคนอื่นใน create ถูกปฏิเสธ', async () => {
    const db = tenantScoped(ctxA);
    await expect(
      db.userGroup.upsert({
        where: { tenantId_name: { tenantId: ctxA.tenantId, name: 'ลอบเขียน 2' } },
        create: { tenantId: tenantB, name: 'ลอบเขียน 2' },
        update: {},
      }),
    ).rejects.toThrow(CrossTenantAccessError);
  });
});

describe('INVARIANT 1 · withSystemScope', () => {
  it('ปฏิเสธเมื่อไม่ระบุเหตุผล — บังคับให้เขียนไว้ให้ code review เห็น', async () => {
    await expect(withSystemScope('สั้น', async (db) => db.tenant.count())).rejects.toThrow(
      /เหตุผล/,
    );
  });

  it('ข้าม tenant scope ได้จริงเมื่อระบุเหตุผลครบ', async () => {
    // งานระดับระบบเท่านั้นที่ควรทำแบบนี้ — เช่นการนับ tenant ทั้งหมด
    const count = await withSystemScope(
      'ตรวจสอบจำนวน tenant ทั้งระบบสำหรับ health check',
      async (db) => db.user.count({ where: { email: { in: ['inv-a@example.test', 'inv-b@example.test'] } } }),
    );
    // เห็นผู้ใช้ของทั้งสอง tenant — ซึ่ง scope ปกติทำไม่ได้
    expect(count).toBe(2);

    const scoped = await tenantScoped(ctxA).user.count({
      where: { email: { in: ['inv-a@example.test', 'inv-b@example.test'] } },
    });
    expect(scoped, 'scope ปกติต้องเห็นแค่ของ tenant ตัวเอง').toBe(1);
  });
});

describe('INVARIANT 2 · audit_log สำหรับเหตุการณ์ระดับระบบ', () => {
  it('เหตุการณ์ระบบถูกเขียนลง audit_log พร้อม traceId', async () => {
    const before = await prismaClient.auditLog.count({ where: { tenantId: ctxA.tenantId } });

    await auditedTransaction(ctxA, 'permission.grant', async () => {
      const audit: AuditEntry[] = [
        {
          kind: 'system',
          action: 'permission.grant',
          entityType: 'user_group',
          entityId: '123',
          payload: { permission: 'BROWSE_PROJECT' },
        },
      ];
      return { result: 'ok', audit };
    });

    const rows = await prismaClient.auditLog.findMany({
      where: { tenantId: ctxA.tenantId },
      orderBy: { id: 'desc' },
      take: 1,
    });
    expect(await prismaClient.auditLog.count({ where: { tenantId: ctxA.tenantId } })).toBe(
      before + 1,
    );
    expect(rows[0]?.action).toBe('permission.grant');
    expect(rows[0]?.entityType).toBe('user_group');
    // traceId ต้องถูกส่งต่อ เพื่อให้ audit โยงกลับไป OpenTelemetry trace ได้
    expect(rows[0]?.traceId).toBe('trace-test-001');
    expect(rows[0]?.payload).toMatchObject({ permission: 'BROWSE_PROJECT' });
  });

  it('เหตุการณ์ระบบและการเปลี่ยนงานเขียนพร้อมกันได้ในทรานแซกชันเดียว', async () => {
    const project = await prismaClient.project.create({
      data: { tenantId: ctxA.tenantId, key: 'INV', name: 'โปรเจกต์ทดสอบ', type: 'SERVICE_DESK' },
    });
    const issueType = await prismaClient.issueType.create({
      data: { tenantId: ctxA.tenantId, name: 'ทดสอบ', iconKey: 'x' },
    });
    const wf = await prismaClient.workflow.create({
      data: { tenantId: ctxA.tenantId, name: 'wf ทดสอบ' },
    });
    const status = await prismaClient.workflowStatus.create({
      data: {
        tenantId: ctxA.tenantId,
        workflowId: wf.id,
        name: 'เริ่ม',
        category: 'TODO',
        position: 1,
        isInitial: true,
      },
    });
    const user = await prismaClient.user.findFirstOrThrow({ where: { tenantId: ctxA.tenantId } });
    const item = await prismaClient.workItem.create({
      data: {
        tenantId: ctxA.tenantId,
        itemKey: 'INV-1',
        projectId: project.id,
        issueTypeId: issueType.id,
        summary: 'งานทดสอบ audit ผสม',
        statusId: status.id,
        reporterId: user.id,
        rank: '0|i',
      },
    });

    const historyBefore = await prismaClient.workItemHistory.count({
      where: { workItemId: item.id },
    });
    const auditBefore = await prismaClient.auditLog.count({ where: { tenantId: ctxA.tenantId } });

    await auditedTransaction(ctxA, 'mixed', async () => ({
      result: null,
      audit: [
        { kind: 'work-item', workItemId: item.id, field: 'summary', oldValue: 'ก', newValue: 'ข' },
        { kind: 'system', action: 'item.bulk-edit', entityType: 'work_item', entityId: 'INV-1' },
      ] satisfies AuditEntry[],
    }));

    expect(await prismaClient.workItemHistory.count({ where: { workItemId: item.id } })).toBe(
      historyBefore + 1,
    );
    expect(await prismaClient.auditLog.count({ where: { tenantId: ctxA.tenantId } })).toBe(
      auditBefore + 1,
    );
  });

  it('เหตุการณ์ของ tenant หนึ่งไม่ปรากฏใน audit_log ของอีก tenant', async () => {
    await auditedTransaction(ctxB, 'tenant-b.event', async () => ({
      result: null,
      audit: [
        { kind: 'system', action: 'tenant-b.event', entityType: 'test', entityId: '1' },
      ] satisfies AuditEntry[],
    }));

    const seenFromA = await tenantScoped(ctxA).auditLog.count({
      where: { action: 'tenant-b.event' },
    });
    expect(seenFromA).toBe(0);
  });
});
