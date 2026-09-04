/**
 * ยิงตัวส่งรายงานจริงหนึ่งรอบ กับ Mailpit จริง
 *
 * สร้างตารางเวลาของตัวเองที่ **ถึงรอบแล้ว** ให้ผู้ใช้จริงคนหนึ่งที่มีสิทธิ์
 * ดูรายงานอยู่แล้ว แล้วเรียก `runReportSender` ตรง ๆ · ตรวจว่ามีอีเมล
 * เพิ่มขึ้นใน Mailpit และมีไฟล์แนบจริง
 *
 * เก็บกวาดทุกอย่างที่สร้างเมื่อจบ — ตารางเวลาที่ค้างไว้จะส่งอีเมลทุกวัน
 * โดยไม่มีใครรู้ว่ามาจากไหน
 */
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@itsm/types';

import { buildProjectCsv } from './report-build';
import {
  runReportSender,
  type ScheduleRowRaw,
} from './report-sender';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { key: 'default' } });
  // ผู้ใช้จริงที่มี VIEW_REPORT — หาจาก grant ไม่ใช่เดาชื่อ
  const grant = await prisma.permissionGrant.findFirstOrThrow({
    where: { tenantId: tenant.id, permission: 'VIEW_REPORT', groupId: { not: null } },
    select: { groupId: true, schemeId: true },
  });
  const member = await prisma.groupMember.findFirstOrThrow({
    where: { groupId: grant.groupId ?? 0n },
    select: { userId: true },
  });
  const owner = await prisma.user.findFirstOrThrow({
    where: { id: member.userId },
    select: { id: true, email: true },
  });
  const project = await prisma.project.findFirstOrThrow({
    where: { permissionSchemeId: grant.schemeId },
    select: { id: true, key: true },
  });

  const now = systemClock.nowUtc();
  const stamp = String(now.getTime()).slice(-6);
  const created = await prisma.reportSchedule.create({
    data: {
      tenantId: tenant.id,
      ownerId: owner.id,
      projectId: project.id,
      name: `smoke ${stamp}`,
      kind: 'daily',
      hour: 8,
      minute: 0,
      // ส่งไปแล้วเมื่อสองวันก่อน → ถึงรอบแน่นอน
      lastRunAt: new Date(now.getTime() - 2 * 86_400_000),
    },
    select: { id: true },
  });
  console.log(JSON.stringify({ step: 'created', id: created.id.toString(), to: owner.email }));

  try {
    const deps = {
      async loadEnabled(): Promise<ScheduleRowRaw[]> {
        const r = await prisma.reportSchedule.findUniqueOrThrow({
          where: { id: created.id },
          select: {
            id: true,
            tenantId: true,
            name: true,
            isEnabled: true,
            lastRunAt: true,
            project: { select: { key: true } },
            owner: { select: { email: true } },
          },
        });
        return [
          {
            id: r.id,
            tenantId: r.tenantId,
            name: r.name,
            projectKey: r.project.key,
            ownerEmail: r.owner.email,
            schedule: { kind: 'daily' as const, hour: 8, minute: 0 },
            isEnabled: r.isEnabled,
            lastRunAt: r.lastRunAt,
          },
        ];
      },
      async claim(id: bigint, at: Date): Promise<boolean> {
        const before = await prisma.reportSchedule.findUnique({
          where: { id },
          select: { lastRunAt: true },
        });
        if (before === null) return false;
        const changed = await prisma.reportSchedule.updateMany({
          where: { id, lastRunAt: before.lastRunAt },
          data: { lastRunAt: at },
        });
        return changed.count === 1;
      },
      buildCsv: (row: ScheduleRowRaw) =>
        buildProjectCsv(prisma, {
          ownerId: owner.id,
          ownerEmail: row.ownerEmail,
          projectId: project.id,
          projectKey: row.projectKey,
        }),
      async markError(id: bigint, error: string): Promise<void> {
        await prisma.reportSchedule.update({ where: { id }, data: { lastError: error.slice(0, 500) } });
      },
      async clearError(id: bigint): Promise<void> {
        await prisma.reportSchedule.update({ where: { id }, data: { lastError: null } });
      },
      mailer: (await import('./mailer')).createMailer(),
      webBaseUrl: 'http://localhost:4300',
    };

    const report = await runReportSender(deps, systemClock.nowUtc());
    console.log(JSON.stringify({ step: 'sent', ...report }));
    deps.mailer.close();

    const after = await prisma.reportSchedule.findUniqueOrThrow({
      where: { id: created.id },
      select: { lastRunAt: true, lastError: true },
    });
    console.log(
      JSON.stringify({
        step: 'row',
        lastRunAt: after.lastRunAt?.toISOString() ?? null,
        lastError: after.lastError,
      }),
    );
  } finally {
    await prisma.reportSchedule.delete({ where: { id: created.id } });
    console.log(JSON.stringify({ step: 'cleaned' }));
    await prisma.$disconnect();
  }
}

void main();
