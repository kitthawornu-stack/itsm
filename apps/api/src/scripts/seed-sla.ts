/**
 * ตั้งค่า SLA ให้ข้อมูล seed แล้วสร้างนาฬิกาให้งานที่ยังเปิดอยู่
 *
 * แยกจาก seed หลักเพราะ SLA เป็นงาน Phase 1 — รันซ้ำได้ ไม่สร้างซ้ำ
 * รันด้วย: pnpm --filter @itsm/api seed:sla
 */
/* eslint-disable @typescript-eslint/no-deprecated -- dev guard จนกว่าโมดูล identity จะพร้อม (ADR-003) */
import { systemClock } from '@itsm/types';

import { resolveDevTenantContext } from '../infrastructure/http/dev-tenant.guard';
import { prismaClient } from '../infrastructure/prisma/client';
import { defaultThaiHolidays } from '../modules/sla/thai-holidays';
import { startSlaFor } from '../modules/sla/sla.service';

const HOUR = 3_600_000;
const MIN = 60_000;

const OFFICE = [{ startMinute: 8 * 60 + 30, endMinute: 17 * 60 + 30 }];
/** index 0 = อาทิตย์ */
const WEEKLY_8X5 = [[], OFFICE, OFFICE, OFFICE, OFFICE, OFFICE, []];
const WEEKLY_24X7 = Array.from({ length: 7 }, () => [{ startMinute: 0, endMinute: 1440 }]);

async function main(): Promise<void> {
  const ctx = await resolveDevTenantContext();
  const tenantId = ctx.tenantId;

  // ---------- ปฏิทิน ----------
  // ปฏิทิน 24×7 เตรียมไว้ให้แอดมินเลือกใช้กับ policy ของ P1 ในภายหลัง
  await prismaClient.slaCalendar.upsert({
    where: { tenantId_name: { tenantId, name: '24×7' } },
    update: {},
    create: { tenantId, name: '24×7', timezone: 'Asia/Bangkok', weekly: WEEKLY_24X7, verified: true },
  });

  const cal8x5 = await prismaClient.slaCalendar.upsert({
    where: { tenantId_name: { tenantId, name: 'เวลาทำการ 8×5' } },
    update: {},
    create: {
      tenantId,
      name: 'เวลาทำการ 8×5',
      timezone: 'Asia/Bangkok',
      weekly: WEEKLY_8X5,
      // ⚠️ false โดยตั้งใจ — รายการวันหยุดยังไม่ได้ตรวจกับประกาศจริง
      verified: false,
    },
  });

  // วันหยุด — ยังขาดวันสำคัญทางพุทธศาสนาและวันหยุดที่ ครม. ประกาศ
  const holidays = defaultThaiHolidays(2026);
  for (const date of holidays.dates) {
    await prismaClient.slaHoliday.upsert({
      where: { calendarId_date: { calendarId: cal8x5.id, date } },
      update: {},
      create: { tenantId, calendarId: cal8x5.id, date, name: 'วันหยุดราชการ' },
    });
  }
  console.log(`ปฏิทิน: 24×7 (ตรวจแล้ว) · 8×5 (${holidays.dates.length} วันหยุด · ยังไม่ตรวจสอบ)`);

  // ---------- Policy + Goal ของ Service Desk ----------
  const sd = await prismaClient.project.findFirst({ where: { tenantId, key: 'SD' } });
  if (sd === null) throw new Error('ไม่พบโปรเจกต์ SD — รัน seed หลักก่อน');

  const policy = await prismaClient.slaPolicy.upsert({
    where: { tenantId_projectId_name: { tenantId, projectId: sd.id, name: 'SLA มาตรฐาน' } },
    update: {},
    // P1 ใช้ 24×7 ไม่ได้เพราะ policy ผูกปฏิทินเดียว — ทางแก้จริงคือแยก policy
    // ต่อความสำคัญ ซึ่งยังไม่จำเป็นตอนนี้ · ใช้ 8×5 เป็นค่าตั้งต้น
    create: { tenantId, projectId: sd.id, name: 'SLA มาตรฐาน', calendarId: cal8x5.id },
  });

  /** ไล่จาก position น้อยไปมาก ใช้ตัวแรกที่เข้าเงื่อนไข ตัวท้ายเป็น catch-all */
  const goals = [
    { key: 'time-to-resolve', name: 'แก้ไขให้เสร็จ · P1', targetMs: 2 * HOUR, position: 1, match: { priorityRanks: [1] } },
    { key: 'time-to-resolve', name: 'แก้ไขให้เสร็จ · P2', targetMs: 8 * HOUR, position: 2, match: { priorityRanks: [2] } },
    { key: 'time-to-resolve', name: 'แก้ไขให้เสร็จ · P3', targetMs: 24 * HOUR, position: 3, match: { priorityRanks: [3] } },
    { key: 'time-to-resolve', name: 'แก้ไขให้เสร็จ · ทั่วไป', targetMs: 45 * HOUR, position: 9, match: null },
  ];
  for (const g of goals) {
    await prismaClient.slaGoal.upsert({
      where: { policyId_key_position: { policyId: policy.id, key: g.key, position: g.position } },
      update: { targetMs: g.targetMs, name: g.name, match: g.match ?? undefined },
      create: {
        tenantId,
        policyId: policy.id,
        key: g.key,
        name: g.name,
        targetMs: g.targetMs,
        position: g.position,
        match: g.match ?? undefined,
      },
    });
  }
  console.log(`Policy "${policy.name}" · ${goals.length} goal`);

  // ---------- สร้างนาฬิกาให้งานที่ยังเปิดอยู่ ----------
  const open = await prismaClient.workItem.findMany({
    where: { tenantId, projectId: sd.id, resolvedAt: null },
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  });

  const now = systemClock.nowUtc();
  let made = 0;
  for (const w of open) {
    const r = await startSlaFor(ctx, w.id, now);
    if (r !== null) made += 1;
    if (made % 100 === 0 && made > 0) process.stdout.write(`\r  นาฬิกา ${made}/${open.length}`);
  }
  process.stdout.write('\n');

  const breached = await prismaClient.workItemSla.count({ where: { tenantId, isBreached: true } });
  const running = await prismaClient.workItemSla.count({ where: { tenantId, state: 'running' } });
  console.log(`สร้างนาฬิกา ${made} เรือน — กำลังเดิน ${running} · หลุดแล้ว ${breached}`);
  console.log(`หน่วยเป้าหมาย: P1 ${2 * HOUR / HOUR} ชม. · P2 8 ชม. · P3 24 ชม. (เวลาทำการ) · ${MIN / MIN} นาที = ${MIN} ms`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prismaClient.$disconnect());
