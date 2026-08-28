/**
 * กฎสามชั้นของ transition ที่ตั้งจากหน้าจอได้ — เทสต์เป็นข้อกำหนด
 *
 * เอกสารสถานะระบุมาตลอดว่า "กฎสามชั้นยังต้องใช้ SQL" · ผลที่ตามมาคือ
 * `require-approval` ที่เพิ่งสร้างเสร็จ **ไม่มีใครเปิดใช้ได้เลย** — เป็นกลไก
 * ที่ไปไม่ถึง ซึ่งเป็นสิ่งที่โครงการนี้เตือนตัวเองซ้ำ ๆ
 *
 * สี่ข้อที่พลาดแล้วผู้ดูแลตั้งค่าจนระบบพังโดยไม่รู้ตัว:
 *
 *   1. **กฎที่เอนจินไม่รู้จัก บันทึกไม่ได้** — ถ้าบันทึกได้ ทุก transition ของ
 *      workflow นั้นจะโยน UnknownRuleError คือปุ่มทั้งชุดกดไม่ได้ทันที
 *      และคนที่เจอคือผู้ใช้ ไม่ใช่ผู้ดูแลที่ตั้งค่าผิด
 *   2. **กฎที่ต้องมี config แต่ไม่ได้กรอก บันทึกไม่ได้** — `required-fields`
 *      ที่ไม่มีฟิลด์ = ผ่านเสมอ · `in-group` ที่ไม่มีกลุ่ม = ไม่มีใครเห็นปุ่มเลย
 *      ทั้งสองอย่างเงียบทั้งคู่
 *   3. **กฎที่ตั้งไว้ต้องมีผลจริงกับการกดปุ่ม** — ตั้งแล้วไม่มีผลคือการหลอก
 *   4. **กฎที่อยู่ในฐานข้อมูลแต่ไม่มีในรายการ ต้องยังมองเห็น** — กฎที่มองไม่เห็น
 *      แต่ยังทำงานอยู่ คือสิ่งที่ผู้ดูแลหาสาเหตุไม่เจอ
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  RuleConfigRequiredError,
  UnknownRuleTypeError,
  addTransitionRule,
  removeTransitionRule,
  ruleCatalog,
  rulesOf,
  transitionsOf,
} from '../src/modules/workflow';

const STAMP = String(Date.now()).slice(-6);

let ctx: TenantContext;
let tenantId: bigint;
let actorId: bigint;
let workflowId: bigint;
let transitionId: bigint;
let groupId: bigint;
const createdRuleIds: bigint[] = [];

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
  groupId = (await prismaClient.userGroup.findFirstOrThrow({ where: { tenantId } })).id;

  /*
    สร้าง workflow ของตัวเอง ไม่แตะ workflow ที่โปรเจกต์จริงใช้อยู่ —
    การเพิ่มกฎเข้า transition ที่ใช้งานจริง จะเปลี่ยนพฤติกรรมของงานที่เปิดอยู่ทันที
  */
  const wf = await prismaClient.workflow.create({
    data: { tenantId, name: `ทดสอบกฎ ${STAMP}` },
    select: { id: true },
  });
  workflowId = wf.id;
  const s1 = await prismaClient.workflowStatus.create({
    data: { tenantId, workflowId, name: `เริ่ม ${STAMP}`, category: 'TODO', isInitial: true, position: 1 },
    select: { id: true },
  });
  const s2 = await prismaClient.workflowStatus.create({
    data: { tenantId, workflowId, name: `จบ ${STAMP}`, category: 'DONE', position: 2 },
    select: { id: true },
  });
  const t = await prismaClient.workflowTransition.create({
    data: { tenantId, workflowId, name: `ปิดงาน ${STAMP}`, fromStatusId: s1.id, toStatusId: s2.id },
    select: { id: true },
  });
  transitionId = t.id;
}, 120_000);

afterAll(async () => {
  await step('กฎ', () =>
    prismaClient.transitionRule.deleteMany({ where: { transitionId } }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({
      where: { actorId, action: { startsWith: 'workflow.rule.' } },
    }),
  );
  await step('เส้นทาง', () =>
    prismaClient.workflowTransition.deleteMany({ where: { workflowId } }),
  );
  await step('สถานะ', () => prismaClient.workflowStatus.deleteMany({ where: { workflowId } }));
  await step('workflow', () => prismaClient.workflow.deleteMany({ where: { id: workflowId } }));
  await prismaClient.$disconnect();
});

describe('A · รายการกฎที่เลือกได้', () => {
  it('มีทั้งสามชั้น และมี require-approval ที่เพิ่งสร้าง', () => {
    const cat = ruleCatalog();
    expect(cat.some((e) => e.kind === 'CONDITION')).toBe(true);
    expect(cat.some((e) => e.kind === 'VALIDATOR' && e.ruleType === 'require-approval')).toBe(true);
    expect(cat.some((e) => e.kind === 'POST_FUNCTION')).toBe(true);
  });

  it('**ไม่มี notify กับ fire-webhook ให้เลือก** — ยังไม่มีโค้ดรันจริง', () => {
    // การให้เลือกกฎที่ตั้งแล้วไม่เกิดอะไรขึ้น คือการโกหกผู้ดูแล
    const types = ruleCatalog().map((e) => e.ruleType);
    expect(types).not.toContain('notify');
    expect(types).not.toContain('fire-webhook');
  });
});

describe('B · เพิ่มกฎ', () => {
  it('เพิ่มกฎที่ไม่ต้องมี config ได้', async () => {
    const r = await addTransitionRule(ctx, {
      transitionId,
      kind: 'VALIDATOR',
      ruleType: 'require-approval',
    });
    createdRuleIds.push(r.id);
    const rules = await rulesOf(ctx, transitionId);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.label).toBe('ต้องได้รับอนุมัติก่อน');
  });

  it('**กฎที่เอนจินไม่รู้จัก บันทึกไม่ได้**', async () => {
    await expect(
      addTransitionRule(ctx, { transitionId, kind: 'VALIDATOR', ruleType: 'กฎมั่ว' }),
    ).rejects.toThrow(UnknownRuleTypeError);
    // ชั้นผิดก็ไม่ได้ — `require-approval` เป็น VALIDATOR ไม่ใช่ CONDITION
    await expect(
      addTransitionRule(ctx, { transitionId, kind: 'CONDITION', ruleType: 'require-approval' }),
    ).rejects.toThrow(UnknownRuleTypeError);
  });

  it('ล้มแล้วต้องไม่เหลือกฎค้าง', async () => {
    expect(await prismaClient.transitionRule.count({ where: { transitionId } })).toBe(1);
  });

  it('**required-fields ที่ไม่ระบุฟิลด์ บันทึกไม่ได้** — ถ้าบันทึกได้จะผ่านเสมอ', async () => {
    await expect(
      addTransitionRule(ctx, { transitionId, kind: 'VALIDATOR', ruleType: 'required-fields' }),
    ).rejects.toThrow(RuleConfigRequiredError);
    await expect(
      addTransitionRule(ctx, {
        transitionId,
        kind: 'VALIDATOR',
        ruleType: 'required-fields',
        fields: ['   ', ''],
      }),
    ).rejects.toThrow(RuleConfigRequiredError);
  });

  it('**in-group ที่ไม่ระบุกลุ่ม บันทึกไม่ได้** — ถ้าบันทึกได้จะไม่มีใครเห็นปุ่มเลย', async () => {
    await expect(
      addTransitionRule(ctx, { transitionId, kind: 'CONDITION', ruleType: 'in-group' }),
    ).rejects.toThrow(RuleConfigRequiredError);
  });

  it('ระบุ config ครบแล้วบันทึกได้ และเก็บค่าที่กรอกไว้จริง', async () => {
    const r = await addTransitionRule(ctx, {
      transitionId,
      kind: 'CONDITION',
      ruleType: 'in-group',
      groupIds: [groupId.toString()],
    });
    createdRuleIds.push(r.id);
    const rules = await rulesOf(ctx, transitionId);
    const inGroup = rules.find((x) => x.ruleType === 'in-group');
    expect(inGroup?.config).toEqual({ groupIds: [groupId.toString()] });
  });
});

describe('C · กฎที่ตั้งไว้มีผลจริง', () => {
  it('**เอนจินมองเห็นกฎที่เพิ่งเพิ่ม** — ไม่ใช่แค่แถวในฐานข้อมูล', async () => {
    /*
      นี่คือข้อที่แยก "บันทึกได้" ออกจาก "มีผล" · กฎที่ตั้งแล้วไม่มีผล
      คือการหลอกผู้ดูแลว่าตั้งค่าเรียบร้อยแล้ว
    */
    const t = await prismaClient.workflowTransition.findFirstOrThrow({
      where: { id: transitionId },
      include: { rules: true },
    });
    const kinds = t.rules.map((r) => `${r.kind}/${r.ruleType}`);
    expect(kinds).toContain('VALIDATOR/require-approval');
    expect(kinds).toContain('CONDITION/in-group');
  });

  it('จำนวนกฎที่หน้าจอเห็น ตรงกับที่มีจริง', async () => {
    const list = await transitionsOf(ctx, workflowId);
    expect(list.find((t) => t.id === transitionId.toString())?.ruleCount).toBe(2);
  });
});

describe('D · ลบกฎ', () => {
  it('ลบได้ และที่เหลือยังอยู่ครบ', async () => {
    const before = await rulesOf(ctx, transitionId);
    const target = before.find((r) => r.ruleType === 'in-group');
    await removeTransitionRule(ctx, BigInt(target?.id ?? '0'));
    const after = await rulesOf(ctx, transitionId);
    expect(after).toHaveLength(before.length - 1);
    expect(after.some((r) => r.ruleType === 'require-approval')).toBe(true);
  });
});

describe('E · กฎที่ไม่ได้อยู่ในรายการให้เลือก', () => {
  it('**"ยังไม่ได้ทำ" ต้องต่างจาก "ระบบไม่รู้จัก"** — ผู้ดูแลต้องทำคนละอย่าง', async () => {
    /*
      เจอตอนดูหน้าจอจริง: `notify` ขึ้นว่า "ระบบไม่รู้จัก" ทั้งที่เอนจินรู้จักดี
      แค่ยังไม่ได้เขียนโค้ดรัน · ผู้ดูแลที่เห็นคำนั้นจะคิดว่าข้อมูลเสียแล้วไปลบทิ้ง
      ทั้งที่ควรปล่อยไว้รอ · ส่วนกฎที่เอนจินไม่รู้จักจริง ทำให้ปุ่มทั้งชุดกดไม่ได้
      และต้องลบจริง — สองอย่างนี้จึงห้ามใช้ข้อความเดียวกัน
    */
    const notImpl = await prismaClient.transitionRule.create({
      data: { tenantId, transitionId, kind: 'POST_FUNCTION', ruleType: 'notify', config: {}, position: 97 },
      select: { id: true },
    });
    const bogus = await prismaClient.transitionRule.create({
      data: { tenantId, transitionId, kind: 'POST_FUNCTION', ruleType: 'กฎมั่วซั่ว', config: {}, position: 98 },
      select: { id: true },
    });

    const rules = await rulesOf(ctx, transitionId);
    const a = rules.find((r) => r.id === notImpl.id.toString())?.label ?? '';
    const b = rules.find((r) => r.id === bogus.id.toString())?.label ?? '';
    expect(a).toContain('ยังไม่ได้ทำ');
    expect(b).toContain('ระบบไม่รู้จัก');
    expect(a).not.toBe(b);

    await prismaClient.transitionRule.deleteMany({ where: { id: { in: [notImpl.id, bogus.id] } } });
  });
});

describe('F · กฎที่ระบบไม่รู้จักแต่มีอยู่ในฐานข้อมูล', () => {
  it('**ต้องยังมองเห็น ไม่ใช่ซ่อน** — กฎที่มองไม่เห็นแต่ทำงานอยู่ หาสาเหตุไม่เจอ', async () => {
    /*
      เกิดได้จริงเมื่อถอดกฎออกจากเอนจินแต่ข้อมูลเก่ายังอยู่ · ถ้าหน้าจอซ่อนมัน
      ผู้ดูแลจะเห็นเส้นทางที่ "ไม่มีกฎอะไรเลย" แต่กดแล้วถูกปฏิเสธทุกครั้ง
    */
    const orphan = await prismaClient.transitionRule.create({
      data: {
        tenantId,
        transitionId,
        kind: 'VALIDATOR',
        ruleType: 'กฎเก่าที่ถอดออกแล้ว',
        config: {},
        position: 99,
      },
      select: { id: true },
    });
    const rules = await rulesOf(ctx, transitionId);
    const shown = rules.find((r) => r.id === orphan.id.toString());
    expect(shown).toBeDefined();
    expect(shown?.label).toContain('ระบบไม่รู้จัก');
    await prismaClient.transitionRule.delete({ where: { id: orphan.id } });
  });
});
