/**
 * ตั้งค่ากฎอัตโนมัติจากหน้าจอ — เทสต์เป็นข้อกำหนด
 *
 * ห้าข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **กฎที่บันทึกแล้วไม่ทำงาน ต้องถูกปฏิเสธตั้งแต่ตอนบันทึก** — `conditions`
 *      กับ `actions` เก็บเป็น JSON ฐานข้อมูลตรวจให้ไม่ได้ · ถ้ายอมรับชนิดที่
 *      พิมพ์ผิด กฎจะถูกเก็บ แสดงบนหน้าจอเหมือนกฎปกติ และไม่ทำอะไรตลอดไป
 *      โดยไม่มี error สักบรรทัด แล้วผู้ดูแลจะสรุปว่าระบบอัตโนมัติใช้ไม่ได้
 *   2. **ปฏิเสธทั้งใบ ไม่ตัดข้อที่ผิดทิ้งเงียบ ๆ** — เงื่อนไขที่หายไปหนึ่งข้อ
 *      กลับความหมายของกฎได้ทั้งข้อ
 *   3. **กฎที่เพิ่งสร้างต้องปิดอยู่เสมอ** แม้ผู้เรียกจะส่ง `isEnabled: true` มา
 *   4. **ลบกฎแล้วประวัติต้องอยู่ต่อ** — การลบกฎไม่ใช่การลบหลักฐาน
 *   5. **คนที่ไม่ใช่ผู้ดูแล ทำอะไรไม่ได้เลย** ทุกทางเข้า ไม่ใช่แค่ที่ซ่อนปุ่มไว้
 *
 * ทุกอย่างสร้างของตัวเองแล้วลบทิ้ง ไม่แตะข้อมูล seed
 */
import type { TenantContext } from '@itsm/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  DuplicateRuleNameError,
  InvalidRuleError,
  RuleNotFoundError,
  createRule,
  deleteRule,
  listRules,
  listRuns,
  ruleVocabulary,
  setRuleEnabled,
  updateRule,
} from '../src/modules/automation';
import { ACTION_KINDS, CONDITION_FIELDS, TRIGGERS } from '../src/modules/automation';
import { PermissionDeniedError } from '../src/modules/permission';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let admin: TenantContext;
let outsider: TenantContext;
let adminId: bigint | undefined;
let outsiderId: bigint | undefined;
let groupId: bigint | undefined;
let schemeId: bigint | undefined;
const ruleNames: string[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

/** กฎที่ถูกต้องทุกอย่าง — เคสอื่นแก้ทีละจุดจากตัวนี้ */
function goodRule(name: string): Parameters<typeof createRule>[1] {
  ruleNames.push(`${name} ${STAMP}`);
  return {
    name: `${name} ${STAMP}`,
    trigger: 'item.created',
    conditions: [{ field: 'priority', op: 'is', value: '1' }],
    actions: [{ kind: 'comment', value: 'เรื่องด่วน — ทีมกำลังดูให้' }],
  };
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์กฎอัตโนมัติ ${STAMP}` },
    select: { id: true },
  });
  schemeId = scheme.id;

  const group = await prismaClient.userGroup.create({
    data: { tenantId, name: `aut-admin ${STAMP}` },
    select: { id: true },
  });
  groupId = group.id;

  const mkUser = async (n: string): Promise<bigint> =>
    (
      await prismaClient.user.create({
        data: { tenantId, email: `auta-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
        select: { id: true },
      })
    ).id;
  adminId = await mkUser('admin');
  outsiderId = await mkUser('outsider');

  await prismaClient.groupMember.create({
    data: { tenantId, groupId: group.id, userId: adminId },
  });
  /*
    ผู้ดูแลของเทสต์ได้ `ADMINISTER_TENANT` ผ่าน **กลุ่มของตัวเอง** ไม่ใช่ด้วย
    การยืมกลุ่มผู้ดูแลจริง · เทสต์ที่ยืมกลุ่มจริงแล้วล้มกลางทาง จะทิ้งสิทธิ์
    ที่ให้ไว้ค้างอยู่ หรือแย่กว่านั้นคือถอนของจริงออกไป (CLAUDE.md §9)
  */
  await prismaClient.permissionGrant.create({
    data: {
      tenantId,
      schemeId: scheme.id,
      permission: 'ADMINISTER_TENANT',
      groupId: group.id,
    } as never,
  });

  admin = { tenantId, actorId: adminId };
  outsider = { tenantId, actorId: outsiderId };
}, 180_000);

afterAll(async () => {
  /*
    ลบกฎด้วย **ชื่อที่ขึ้นต้นด้วย stamp** ไม่ใช่ด้วย id ที่จำไว้ — ตอนกลไก
    ตรวจความถูกต้องถูกลบเพื่อพิสูจน์ว่าแดงได้ เคสที่ "ไม่ควรสร้างอะไร"
    จะสร้างแถวจริง และแถวเหล่านั้นไม่มี id อยู่ในตัวแปรไหนเลย
  */
  await step('ประวัติกฎ', () =>
    prismaClient.automationRun.deleteMany({ where: { ruleName: { contains: STAMP } } }),
  );
  await step('กฎ', () =>
    prismaClient.automationRule.deleteMany({ where: { name: { contains: STAMP } } }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({
      where: { actorId: { in: [adminId, outsiderId].filter((v): v is bigint => v !== undefined) } },
    }),
  );
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { groupId: groupId ?? 0n } }),
  );
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({ where: { schemeId: schemeId ?? 0n } }),
  );
  await step('กลุ่ม', () => prismaClient.userGroup.deleteMany({ where: { id: groupId ?? 0n } }));
  await step('ผู้ใช้', () =>
    prismaClient.user.deleteMany({ where: { email: { contains: `-${STAMP}@example.test` } } }),
  );
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { id: schemeId ?? 0n } }),
  );

  // นับซ้ำหลังเก็บกวาด — ลูปที่ล้มกลางทางเงียบ ๆ จะทิ้งของไว้โดยไม่มีใครรู้
  const left = await prismaClient.automationRule.count({ where: { name: { contains: STAMP } } });
  if (left > 0) console.error(`**เหลือกฎของเทสต์ค้างอยู่ ${String(left)} ข้อ**`);

  await prismaClient.$disconnect();
}, 180_000);

describe('A · รายการตัวเลือกมาจากเอนจิน', () => {
  it('**หน้าจอได้รายการเดียวกับที่เอนจินรู้จัก ไม่ใช่รายการที่พิมพ์ซ้ำ**', () => {
    /*
      ถ้าหน้าจอมีรายการของตัวเอง มันจะไม่ตรงกับเอนจินในวันที่มีคนเพิ่มชนิดใหม่
      แล้วผู้ดูแลจะเลือกอะไรที่ระบบไม่รู้จักได้จากหน้าจอของเราเอง
    */
    const v = ruleVocabulary();
    expect(v.triggers).toEqual(TRIGGERS);
    expect(v.fields).toEqual(CONDITION_FIELDS);
    expect(v.actions).toEqual(ACTION_KINDS);
    expect(v.maxDepth).toBeGreaterThan(0);
  });
});

describe('B · กฎที่จะไม่ทำงาน ต้องไม่ถูกบันทึก', () => {
  it('**ชนิดการกระทำที่พิมพ์ผิด ถูกปฏิเสธพร้อมบอกว่ามีอะไรให้เลือก**', async () => {
    const bad = { ...goodRule('พิมพ์ผิด'), actions: [{ kind: 'assgin', value: '1' }] };
    await expect(createRule(admin, bad)).rejects.toThrow(InvalidRuleError);
    await expect(createRule(admin, bad)).rejects.toThrow(/assgin/);
    // และไม่มีแถวไหนถูกสร้างขึ้น — ปฏิเสธทั้งใบ ไม่ใช่เก็บส่วนที่ถูก
    expect(
      await prismaClient.automationRule.count({ where: { name: bad.name } }),
    ).toBe(0);
  }, 60_000);

  it('เหตุการณ์ที่ไม่รู้จัก ถูกปฏิเสธ', async () => {
    await expect(
      createRule(admin, { ...goodRule('เหตุการณ์ผิด'), trigger: 'item.exploded' }),
    ).rejects.toThrow(/item.exploded/);
  }, 60_000);

  it('ฟิลด์เงื่อนไขที่ไม่รู้จัก ถูกปฏิเสธและบอกว่าข้อที่เท่าไร', async () => {
    await expect(
      createRule(admin, {
        ...goodRule('ฟิลด์ผิด'),
        conditions: [
          { field: 'priority', op: 'is', value: '1' },
          { field: 'ดวงจันทร์', op: 'is', value: 'เต็มดวง' },
        ],
      }),
    ).rejects.toThrow(/ข้อที่ 2/);
  }, 60_000);

  it('**กฎที่ไม่มีการกระทำเลย ถูกปฏิเสธ**', async () => {
    // มันจะเข้าเงื่อนไขทุกครั้งแล้วไม่เกิดอะไรขึ้น ซึ่งอ่านบนหน้าจอเหมือนกฎที่ใช้ได้
    await expect(createRule(admin, { ...goodRule('ไม่มีการกระทำ'), actions: [] })).rejects.toThrow(
      InvalidRuleError,
    );
  }, 60_000);

  it('ค่าเงื่อนไขที่เป็นช่องว่างล้วน ถูกปฏิเสธ', async () => {
    await expect(
      createRule(admin, {
        ...goodRule('ค่าว่าง'),
        conditions: [{ field: 'priority', op: 'is', value: '   ' }],
      }),
    ).rejects.toThrow(InvalidRuleError);
  }, 60_000);

  it('**เกณฑ์ของ "อย่างน้อย" ที่ไม่ใช่ตัวเลข ถูกปฏิเสธ**', async () => {
    /*
      เงื่อนไขที่เทียบตัวเลขไม่ได้ จะเป็นเท็จตลอดกาล · กฎถูกบันทึก แสดงบนหน้าจอ
      เหมือนกฎปกติ แล้วเงียบตลอดไป — เหมือนชนิดการกระทำที่พิมพ์ผิดทุกประการ
    */
    await expect(
      createRule(admin, {
        ...goodRule('อย่างน้อยไม่ใช่ตัวเลข'),
        trigger: 'item.idle',
        conditions: [{ field: 'idleDays', op: 'at-least', value: 'สองวัน' }],
      }),
    ).rejects.toThrow(/ไม่ใช่ตัวเลข/);
  }, 60_000);

  it('เกณฑ์ที่เป็นตัวเลข ผ่าน', async () => {
    // ต้องมีเคสนี้ด้วย — เคสปฏิเสธอย่างเดียวยังเขียวได้ถ้าโค้ดปฏิเสธทุกอย่าง
    const { id } = await createRule(admin, {
      ...goodRule('อย่างน้อยเป็นตัวเลข'),
      trigger: 'item.idle',
      conditions: [{ field: 'idleDays', op: 'at-least', value: '2' }],
    });
    expect(BigInt(id)).toBeGreaterThan(0n);
  }, 60_000);

  it('**ค่าที่ไม่ใช่สตริง ต้องไม่กลายเป็น "[object Object]"**', async () => {
    /*
      `String({})` ผ่านการตรวจ "ไม่ว่าง" ไปได้ แล้วกฎจะถูกบันทึกด้วยค่าที่
      ผู้ใช้ไม่เคยส่งมา · ข้อความปฏิเสธต้องพูดถึงฟิลด์ ไม่ใช่ถึงค่าประหลาดนั้น
    */
    const bad = { ...goodRule('ค่าเป็นวัตถุ'), conditions: [{ field: { a: 1 }, op: 'is', value: 'x' }] };
    await expect(createRule(admin, bad)).rejects.toThrow(InvalidRuleError);
    // ข้อความต้องพูดถึงฟิลด์ที่ผิด ไม่ใช่ถึงค่าที่ JavaScript แปลงให้เอง
    const err = await createRule(admin, bad).catch((e: unknown) => e);
    expect(String(err)).not.toContain('[object Object]');
    expect(String(err)).toContain('เงื่อนไขข้อที่ 1');
  }, 60_000);
});

describe('C · สร้าง แก้ เปิด ลบ', () => {
  it('**กฎที่เพิ่งสร้าง ต้องปิดอยู่เสมอ**', async () => {
    /*
      แม้ผู้เรียกจะส่ง `isEnabled: true` มา · กฎที่เพิ่งพิมพ์เสร็จยังไม่มีใคร
      อ่านทวน การเปิดพร้อมสร้างแปลว่ากฎที่ผิดเริ่มแตะตั๋วจริงในวินาทีเดียวกับ
      ที่พิมพ์ผิด
    */
    const { id } = await createRule(admin, { ...goodRule('สร้างแล้วต้องปิด'), isEnabled: true });
    const row = await prismaClient.automationRule.findUniqueOrThrow({
      where: { id: BigInt(id) },
      select: { isEnabled: true },
    });
    expect(row.isEnabled).toBe(false);
  }, 60_000);

  it('เปิดกฎเป็นการกระทำแยกที่มี audit ของตัวเอง', async () => {
    const { id } = await createRule(admin, goodRule('เปิดทีหลัง'));
    await setRuleEnabled(admin, BigInt(id), true);

    const log = await prismaClient.auditLog.findFirst({
      where: { entityType: 'automation_rule', entityId: id, action: 'automation.rule.enable' },
      select: { actorId: true, actorName: true },
    });
    // ตอบได้ว่า "ใครเป็นคนเปิด" ไม่ใช่แค่ว่ามันเปิดอยู่
    expect(log?.actorId).toBe(adminId);
    expect(log?.actorName).not.toBeNull();
  }, 60_000);

  it('ชื่อซ้ำถูกปฏิเสธ', async () => {
    const r = goodRule('ชื่อซ้ำ');
    await createRule(admin, r);
    await expect(createRule(admin, { ...r })).rejects.toThrow(DuplicateRuleNameError);
  }, 60_000);

  it('แก้กฎแล้ว audit เก็บทั้งค่าก่อนและหลัง', async () => {
    // "แก้อะไรไป" ตอบไม่ได้ถ้าเก็บแต่ค่าใหม่ — และนั่นคือคำถามที่มีคนถามจริง
    const { id } = await createRule(admin, goodRule('แก้แล้วดู'));
    await updateRule(admin, BigInt(id), {
      ...goodRule('แก้แล้วดู (ใหม่)'),
      actions: [{ kind: 'add-label', value: 'ด่วน' }],
    });
    const log = await prismaClient.auditLog.findFirstOrThrow({
      where: { entityType: 'automation_rule', entityId: id, action: 'automation.rule.update' },
      select: { payload: true },
    });
    const payload = log.payload as { before?: unknown; after?: unknown };
    expect(payload.before).toBeDefined();
    expect(payload.after).toBeDefined();
  }, 60_000);

  it('**ลบกฎแล้ว ประวัติที่มันเคยทำต้องอยู่ต่อ**', async () => {
    /*
      "ตั๋วใบนี้ถูกกฎอะไรแตะ" ต้องตอบได้แม้กฎจะถูกลบไปแล้ว มิฉะนั้นการลบกฎ
      กลายเป็นการลบหลักฐาน — และคนที่ลบคือคนที่มีเหตุผลจะลบหลักฐานที่สุด
    */
    const { id } = await createRule(admin, goodRule('ลบแล้วประวัติอยู่'));
    await prismaClient.automationRun.create({
      data: {
        tenantId,
        ruleId: BigInt(id),
        ruleName: `ลบแล้วประวัติอยู่ ${STAMP}`,
        trigger: 'item.created',
        actionKind: 'comment',
        actionValue: 'x',
        outcome: 'applied',
        traceId: `auto-test-${STAMP}`,
      },
    });

    await deleteRule(admin, BigInt(id));

    const left = await prismaClient.automationRun.findFirstOrThrow({
      where: { traceId: `auto-test-${STAMP}` },
      select: { ruleId: true, ruleName: true },
    });
    expect(left.ruleId).toBeNull();
    // ชื่อยังอยู่ในแถว จึงยังอ่านได้ว่ากฎชื่ออะไรสั่ง
    expect(left.ruleName).toContain('ลบแล้วประวัติอยู่');
  }, 60_000);

  it('ลบกฎที่ไม่มีอยู่ ได้ error ที่บอกว่าไม่พบ ไม่ใช่เงียบ', async () => {
    await expect(deleteRule(admin, 999_999_999n)).rejects.toThrow(RuleNotFoundError);
  }, 60_000);
});

describe('C2 · คำเตือน — บอก ไม่ห้าม', () => {
  it('**กฎที่ปลุกตามเวลาแต่ไม่ระบุจำนวนวัน ต้องมีคำเตือน**', async () => {
    /*
      กฎที่ปลุกตามเวลาต่างจากกฎอื่นตรงที่ไม่มีใครเป็นคนจุดชนวน · กฎที่ไม่ระบุ
      จำนวนวันจะทำงานกับทุกเรื่องที่ยังเปิดอยู่ในรอบกวาดรอบเดียว ซึ่งอาจเป็นพันใบ
      และผู้ดูแลจะไม่ได้เห็นมันมาก่อนเลย · เตือน ไม่ห้าม เพราะอาจตั้งใจจริง
    */
    const { id } = await createRule(admin, {
      ...goodRule('ปลุกตามเวลาไม่ระบุวัน'),
      trigger: 'item.idle',
      conditions: [{ field: 'project', op: 'is', value: 'SD' }],
    });
    const listed = (await listRules(admin)).find((r) => r.id === id);
    expect(listed?.warnings.some((w) => w.includes('จำนวนวัน'))).toBe(true);
  }, 60_000);

  it('ระบุจำนวนวันแล้ว ไม่มีคำเตือนนั้น', async () => {
    const { id } = await createRule(admin, {
      ...goodRule('ปลุกตามเวลาระบุวัน'),
      trigger: 'item.idle',
      conditions: [{ field: 'idleDays', op: 'at-least', value: '2' }],
    });
    const listed = (await listRules(admin)).find((r) => r.id === id);
    expect(listed?.warnings.some((w) => w.includes('จำนวนวัน'))).toBe(false);
  }, 60_000);
});

describe('D · คนที่ไม่ใช่ผู้ดูแล', () => {
  it('**ทุกทางเข้าปฏิเสธ ไม่ใช่แค่ที่ซ่อนปุ่มไว้**', async () => {
    // การซ่อนเมนูบนหน้าจอไม่ใช่การป้องกัน — เซิร์ฟเวอร์ต้องปฏิเสธเองทุกครั้ง
    await expect(listRules(outsider)).rejects.toThrow(PermissionDeniedError);
    await expect(createRule(outsider, goodRule('คนนอกสร้าง'))).rejects.toThrow(
      PermissionDeniedError,
    );
    await expect(setRuleEnabled(outsider, 1n, true)).rejects.toThrow(PermissionDeniedError);
    await expect(deleteRule(outsider, 1n)).rejects.toThrow(PermissionDeniedError);
    await expect(listRuns(outsider)).rejects.toThrow(PermissionDeniedError);
  }, 60_000);

  it('คนนอกถูกปฏิเสธ **ก่อน** แตะฐานข้อมูล', async () => {
    /*
      ปฏิเสธหลังสร้างแถวแล้ว ก็ยังตอบ 403 เหมือนกันจากฝั่งผู้ใช้ · ต่างกันตรงที่
      แถวนั้นค้างอยู่จริง · เคสนี้จึงนับแถวก่อน–หลัง ไม่ใช่ดูแค่ว่าโยน error
    */
    const r = goodRule('คนนอกสร้างไม่ได้');
    const before = await prismaClient.automationRule.count();
    await expect(createRule(outsider, r)).rejects.toThrow(PermissionDeniedError);
    expect(await prismaClient.automationRule.count()).toBe(before);
  }, 60_000);
});
