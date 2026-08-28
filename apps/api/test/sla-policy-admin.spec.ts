/**
 * ตั้ง SLA Policy และ Goal จากหน้าจอ — เทสต์เป็นข้อกำหนด
 *
 * เอกสารสถานะระบุมาตลอดว่า "SLA Policy และ Goal ยังต้องใช้ SQL"
 *
 * ส่วนนี้อันตรายกว่าที่อื่นเพราะ **ความผิดพลาดไม่ทำให้ระบบพัง แต่ทำให้ระบบ
 * ตอบผิดอย่างเงียบ ๆ** — ตัวเลขบนหน้าคิวยังขึ้นเหมือนเดิม แค่ผิด
 *
 *   1. **หนึ่งโปรเจกต์หนึ่งนโยบาย** — `describeSlaPolicy` ใช้ `findFirst`
 *      ใบที่สองจึงถูกมองข้ามเงียบ ๆ · ผู้ดูแลจะแก้ใบที่ระบบไม่ได้ใช้
 *      แล้วงงว่าทำไมไม่มีอะไรเปลี่ยน
 *   2. **เป้าที่ไม่มีเงื่อนไข (catch-all) ต้องอยู่ท้ายสุด** — เอนจินใช้
 *      ตัวแรกที่เข้าเงื่อนไข · วางไว้หน้า เป้าที่เหลือกลายเป็นโค้ดที่ไปไม่ถึง
 *   3. **ลบเป้าที่มีนาฬิกาเดินอยู่ไม่ได้** — และต้องบอกจำนวน
 *   4. **แก้เป้าหมายเวลา ต้องเตือนว่ากระทบงานที่เปิดอยู่ย้อนหลัง**
 *      เอนจินคำนวณใหม่จากรายการเหตุการณ์ทุกครั้ง เป้าใหม่จึงเปลี่ยนผลของอดีต
 *   5. **เวลาเป็นศูนย์หรือติดลบ รับไม่ได้** — เป้า 0 นาทีทำให้ทุกใบหลุดทันที
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  CatchAllMustBeLastError,
  GoalInUseError,
  InvalidTargetError,
  PolicyAlreadyExistsError,
  addSlaGoal,
  createSlaPolicy,
  describeSlaPolicy,
  moveSlaGoal,
  removeSlaGoal,
  updateSlaGoalTarget,
} from '../src/modules/sla';

const STAMP = String(Date.now()).slice(-6);

let ctx: TenantContext;
let tenantId: bigint;
let actorId: bigint;
let projectId: bigint;
let calendarId: bigint;
let policyId: bigint;
let specificGoalId: bigint;
let catchAllGoalId: bigint;

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
  calendarId = (await prismaClient.slaCalendar.findFirstOrThrow({ where: { tenantId } })).id;

  /*
    สร้างโปรเจกต์ของตัวเอง ไม่แตะโปรเจกต์จริง — การเพิ่มหรือแก้เป้า SLA
    ของโปรเจกต์ที่ใช้งานอยู่ เปลี่ยนตัวเลขบนหน้าคิวของงานที่เปิดอยู่ทันที
  */
  const scheme = await prismaClient.permissionScheme.findFirstOrThrow({ where: { tenantId } });
  const p = await prismaClient.project.create({
    data: {
      tenantId,
      key: `SLA${STAMP}`,
      name: `โปรเจกต์ทดสอบ SLA ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = p.id;
}, 120_000);

afterAll(async () => {
  await step('เป้า', () => prismaClient.slaGoal.deleteMany({ where: { policy: { projectId } } }));
  await step('นโยบาย', () => prismaClient.slaPolicy.deleteMany({ where: { projectId } }));
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({ where: { actorId, action: { startsWith: 'sla.' } } }),
  );
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { id: projectId } }));
  await prismaClient.$disconnect();
});

describe('A · สร้างนโยบาย', () => {
  it('สร้างแล้วอ่านกลับได้', async () => {
    const r = await createSlaPolicy(ctx, projectId, `นโยบาย ${STAMP}`, calendarId);
    policyId = r.id;
    const d = await describeSlaPolicy(ctx, projectId);
    expect(d?.name).toContain('นโยบาย');
    expect(d?.goals).toHaveLength(0);
  });

  it('**หนึ่งโปรเจกต์หนึ่งนโยบาย** — ใบที่สองสร้างไม่ได้', async () => {
    /*
      `describeSlaPolicy` ใช้ `findFirst` · ถ้าปล่อยให้มีสองใบ ใบที่สอง
      จะถูกมองข้ามเงียบ ๆ ผู้ดูแลจะแก้ใบที่ระบบไม่ได้ใช้ แล้วงงว่าทำไม
      ไม่มีอะไรเปลี่ยน — ไม่มี error ให้เห็นสักบรรทัด
    */
    await expect(
      createSlaPolicy(ctx, projectId, `นโยบายซ้อน ${STAMP}`, calendarId),
    ).rejects.toThrow(PolicyAlreadyExistsError);
  });

  it('ล้มแล้วต้องไม่เหลือใบที่สองค้าง', async () => {
    expect(await prismaClient.slaPolicy.count({ where: { projectId } })).toBe(1);
  });
});

describe('B · เพิ่มเป้า', () => {
  it('เป้าที่มีเงื่อนไขเพิ่มได้', async () => {
    const g = await addSlaGoal(ctx, policyId, {
      key: 'time-to-resolve',
      name: 'แก้เสร็จภายใน (P1)',
      targetMinutes: 240,
      priorityRanks: [1],
    });
    specificGoalId = g.id;
    const d = await describeSlaPolicy(ctx, projectId);
    expect(d?.goals).toHaveLength(1);
    expect(d?.goals[0]?.targetMs).toBe(240 * 60_000);
  });

  it('**เป้าหมายเวลาเป็นศูนย์หรือติดลบ รับไม่ได้**', async () => {
    // เป้า 0 นาที = ทุกใบหลุดทันทีที่เปิด และไม่มีอะไรบนหน้าจอบอกว่าทำไม
    for (const bad of [0, -5, 0.5]) {
      await expect(
        addSlaGoal(ctx, policyId, {
          key: 'time-to-resolve',
          name: `เป้าพัง ${String(bad)}`,
          targetMinutes: bad,
        }),
      ).rejects.toThrow(InvalidTargetError);
    }
  });

  it('เป้าที่ไม่มีเงื่อนไข (catch-all) เพิ่มต่อท้ายได้', async () => {
    const g = await addSlaGoal(ctx, policyId, {
      key: 'time-to-resolve',
      name: 'แก้เสร็จภายใน (ทั่วไป)',
      targetMinutes: 2_880,
    });
    catchAllGoalId = g.id;
    const d = await describeSlaPolicy(ctx, projectId);
    expect(d?.goals).toHaveLength(2);
    // ตัวที่มีเงื่อนไขต้องมาก่อน ไม่งั้นมันไม่มีวันถูกใช้
    expect(d?.goals[0]?.match).not.toBeNull();
    expect(d?.goals[1]?.match).toBeNull();
  });

  it('**เพิ่มเป้าที่มีเงื่อนไข หลังจากมี catch-all แล้ว ต้องแทรกก่อน catch-all**', async () => {
    /*
      ถ้าต่อท้ายเฉย ๆ เป้าใหม่จะอยู่หลัง catch-all แล้วไม่มีวันถูกใช้
      — เป็นเป้าที่ตั้งไว้แล้วไม่มีผล ซึ่งอ่านบนหน้าจอเหมือนตั้งค่าเรียบร้อยแล้ว
    */
    await addSlaGoal(ctx, policyId, {
      key: 'time-to-resolve',
      name: 'แก้เสร็จภายใน (P2)',
      targetMinutes: 480,
      priorityRanks: [2],
    });
    const d = await describeSlaPolicy(ctx, projectId);
    const names = (d?.goals ?? []).map((g) => g.name);
    expect(names[names.length - 1]).toContain('ทั่วไป');
    expect(names).toHaveLength(3);
  });
});

describe('C · ลำดับของเป้า', () => {
  it('**ย้าย catch-all ขึ้นไปหน้าไม่ได้** — เป้าที่เหลือจะกลายเป็นโค้ดที่ไปไม่ถึง', async () => {
    /*
      เอนจินใช้ **ตัวแรกที่เข้าเงื่อนไข** · catch-all เข้าเงื่อนไขเสมอ
      วางไว้หน้าเมื่อไร เป้าที่เหลือทั้งหมดตายทันที และตัวเลข SLA ของ P1
      จะกลายเป็นของเป้าทั่วไปโดยไม่มีอะไรบอก
    */
    await expect(moveSlaGoal(ctx, catchAllGoalId, 'up')).rejects.toThrow(CatchAllMustBeLastError);
  });

  it('ย้ายเป้าที่มีเงื่อนไขสลับกันได้', async () => {
    const before = (await describeSlaPolicy(ctx, projectId))?.goals.map((g) => g.name) ?? [];
    await moveSlaGoal(ctx, specificGoalId, 'down');
    const after = (await describeSlaPolicy(ctx, projectId))?.goals.map((g) => g.name) ?? [];
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    // catch-all ยังอยู่ท้ายสุดเสมอ
    expect(after[2]).toContain('ทั่วไป');
  });
});

describe('D · แก้เป้าหมายเวลา', () => {
  it('แก้ได้ และบอกว่ากระทบงานที่เปิดอยู่กี่ใบ', async () => {
    /*
      เอนจินคำนวณใหม่จากรายการเหตุการณ์ทุกครั้ง เป้าใหม่จึงเปลี่ยนผลของอดีต
      งานที่เคยอยู่ในเกณฑ์อาจกลายเป็นหลุดทันทีที่กดบันทึก · ผู้ดูแลต้องรู้ก่อน
    */
    const r = await updateSlaGoalTarget(ctx, specificGoalId, 120);
    expect(r.affectedOpenItems).toBeGreaterThanOrEqual(0);
    const d = await describeSlaPolicy(ctx, projectId);
    expect(d?.goals.find((g) => g.name.includes('P1'))?.targetMs).toBe(120 * 60_000);
  });

  it('ค่าที่ใช้ไม่ได้ ต้องไม่แตะค่าเดิม', async () => {
    await expect(updateSlaGoalTarget(ctx, specificGoalId, 0)).rejects.toThrow(InvalidTargetError);
    const d = await describeSlaPolicy(ctx, projectId);
    expect(d?.goals.find((g) => g.name.includes('P1'))?.targetMs).toBe(120 * 60_000);
  });
});

describe('E · ลบเป้า', () => {
  it('เป้าที่ไม่มีนาฬิกาผูกอยู่ ลบได้', async () => {
    const before = (await describeSlaPolicy(ctx, projectId))?.goals.length ?? 0;
    await removeSlaGoal(ctx, specificGoalId);
    const after = (await describeSlaPolicy(ctx, projectId))?.goals.length ?? 0;
    expect(after).toBe(before - 1);
  });

  it('**เป้าที่มีนาฬิกาเดินอยู่ ลบไม่ได้ — และบอกจำนวน**', async () => {
    /*
      ฐานข้อมูลกันไว้ด้วย `onDelete: Restrict` อยู่แล้ว แต่ error ของ FK
      อ่านไม่ออกและไม่บอกว่ามีกี่ใบ ซึ่งเป็นสิ่งเดียวที่ผู้ดูแลต้องรู้
      เพื่อตัดสินใจว่าจะย้ายนาฬิกาไปเป้าอื่นหรือปล่อยไว้
    */
    const used = await prismaClient.workItemSla.findFirst({ select: { goalId: true } });
    expect(used, 'ข้อมูลทดสอบไม่มีนาฬิกาที่ผูกกับเป้าเลย — เคสนี้พิสูจน์อะไรไม่ได้').not.toBeNull();
    await expect(removeSlaGoal(ctx, (used as { goalId: bigint }).goalId)).rejects.toThrow(
      GoalInUseError,
    );
  });
});
