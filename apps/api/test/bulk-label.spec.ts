/**
 * ติดและถอดป้ายหลายเรื่องพร้อมกัน — เทสต์เป็นข้อกำหนด
 *
 * ห้าข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **เพิ่ม/เอาออก ไม่ใช่เขียนทับ** — คนที่เลือก 30 ใบแล้วพิมพ์ป้าย "ด่วน"
 *      ตั้งใจจะ *เพิ่ม* ไม่ได้ตั้งใจลบป้ายเดิมของทั้ง 30 ใบทิ้ง
 *      และเขาจะไม่รู้ว่าลบไปแล้วจนกว่าจะมีคนมาถามหาป้ายเก่า
 *   2. **อ่านจาก EAV ไม่ใช่ snapshot** — ค่าที่จะเอาไปเขียนต่อต้องมาจาก
 *      แหล่งความจริง (ADR-001)
 *   3. **ฟิลด์ที่เลือกต้องเป็นชนิด LABELS จริง** — ฟิลด์ค่าเดี่ยวจะเก็บได้
 *      แค่ค่าแรก ที่เหลือหายเงียบ ๆ
 *   4. **โปรเจกต์ต้องใช้ฟิลด์นั้นจริง** — เขียนลงฟิลด์ที่ไม่มีหน้าจอไหนแสดง
 *      ทำให้คนติดป้ายแล้วเปิดดูไม่เห็น จึงติดซ้ำอีกรอบ
 *   5. **ประวัติต้องถูกเขียน** — `setFieldValues` ไม่เขียนให้ (ช่องโหว่ของ
 *      INVARIANT 2 ที่มีมาก่อนไฟล์นี้) เส้นทางใหม่ต้องไม่สืบทอดมันต่อ
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import { readFieldValues, setFieldValues } from '../src/modules/field';
import {
  NotALabelFieldError,
  NothingSelectedError,
  bulkEditLabels,
  labelFields,
} from '../src/modules/workitem';

const STAMP = String(Date.now()).slice(-6);

let tenantId: bigint;
let projectId: bigint;
let issueTypeId: bigint;
/** มี BULK_EDIT + EDIT_ITEM */
let staff: TenantContext;
/** เห็นงานได้ แต่แก้เป็นชุดไม่ได้ */
let viewer: TenantContext;
let staffId: bigint | undefined;
let viewerId: bigint | undefined;
let staffGroupId: bigint | undefined;
let viewerGroupId: bigint | undefined;

let labelFieldId: bigint | undefined;
let textFieldId: bigint | undefined;
/** ฟิลด์ป้ายที่ **ไม่ได้** ผูกกับโปรเจกต์นี้ */
let strayFieldId: bigint | undefined;

const keys: string[] = [];
const ids: bigint[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

const labelsOf = async (id: bigint): Promise<string[]> => {
  const v = await readFieldValues(staff, id);
  const raw = v[`lbl${STAMP}`];
  return (Array.isArray(raw) ? raw : []).filter((x): x is string => typeof x === 'string').sort();
};

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์ป้ายชุด ${STAMP}` },
    select: { id: true },
  });
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: `BLB${STAMP}`,
      name: `โปรเจกต์ทดสอบป้ายชุด ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = project.id;

  const mkGroup = async (n: string): Promise<bigint> =>
    (
      await prismaClient.userGroup.create({
        data: { tenantId, name: `blb-${n} ${STAMP}` },
        select: { id: true },
      })
    ).id;
  staffGroupId = await mkGroup('staff');
  viewerGroupId = await mkGroup('viewer');

  const mkUser = async (n: string, groupId: bigint): Promise<bigint> => {
    const u = await prismaClient.user.create({
      data: { tenantId, email: `blb-${n}-${STAMP}@example.test`, displayName: `ผู้ใช้ ${n}` },
      select: { id: true },
    });
    await prismaClient.groupMember.create({ data: { tenantId, groupId, userId: u.id } });
    return u.id;
  };
  staffId = await mkUser('staff', staffGroupId);
  viewerId = await mkUser('viewer', viewerGroupId);

  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: staffGroupId },
      { tenantId, schemeId: scheme.id, permission: 'EDIT_ITEM', groupId: staffGroupId },
      { tenantId, schemeId: scheme.id, permission: 'BULK_EDIT', groupId: staffGroupId },
      // เห็นงานและแก้ทีละใบได้ แต่ไม่มี BULK_EDIT
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: viewerGroupId },
      { tenantId, schemeId: scheme.id, permission: 'EDIT_ITEM', groupId: viewerGroupId },
    ] as never,
  });
  staff = { tenantId, actorId: staffId };
  viewer = { tenantId, actorId: viewerId };

  const mkField = async (key: string, name: string, type: string): Promise<bigint> =>
    (
      await prismaClient.fieldDefinition.create({
        data: { tenantId, key, name: `${name} ${STAMP}`, type: type as never },
        select: { id: true },
      })
    ).id;
  labelFieldId = await mkField(`lbl${STAMP}`, 'ป้ายทดสอบ', 'LABELS');
  textFieldId = await mkField(`txt${STAMP}`, 'ข้อความทดสอบ', 'TEXT');
  strayFieldId = await mkField(`stray${STAMP}`, 'ป้ายที่ไม่ได้ผูก', 'LABELS');

  const template = await prismaClient.workItem.findFirstOrThrow({
    select: { issueTypeId: true, statusId: true, reporterId: true },
  });
  issueTypeId = template.issueTypeId;

  // ผูกฟิลด์ป้ายกับโปรเจกต์นี้ — `strayFieldId` ไม่ผูกโดยตั้งใจ
  await prismaClient.fieldConfig.createMany({
    data: [
      { tenantId, projectId, issueTypeId, fieldId: labelFieldId, position: 1 },
      { tenantId, projectId, issueTypeId, fieldId: textFieldId, position: 2 },
    ],
  });

  const mk = async (suffix: string): Promise<bigint> => {
    const w = await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey: `BLB${STAMP}-${suffix}`,
        issueTypeId,
        statusId: template.statusId,
        reporterId: template.reporterId,
        summary: `งานทดสอบป้ายชุด ${suffix} ${STAMP}`,
        rank: `zzp${STAMP}${suffix}`,
      },
      select: { id: true, itemKey: true },
    });
    keys.push(w.itemKey);
    ids.push(w.id);
    return w.id;
  };
  const a = await mk('A');
  const b = await mk('B');
  await mk('C');

  // ป้ายเดิมที่ต้องไม่ถูกลบทิ้งตอนเพิ่มป้ายใหม่
  await setFieldValues(staff, a, [
    { fieldId: labelFieldId, type: 'LABELS', value: ['เดิมของA'] },
  ]);
  await setFieldValues(staff, b, [
    { fieldId: labelFieldId, type: 'LABELS', value: ['เดิมของB', 'ร่วม'] },
  ]);
}, 180_000);

afterAll(async () => {
  const owners = [staffId, viewerId].filter((v): v is bigint => v !== undefined);
  const fields = [labelFieldId, textFieldId, strayFieldId].filter((v) => v !== undefined);
  await step('ค่าฟิลด์', () =>
    prismaClient.workItemFieldValue.deleteMany({ where: { fieldId: { in: fields } } }),
  );
  await step('ผังฟิลด์', () => prismaClient.fieldConfig.deleteMany({ where: { projectId } }));
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { actorId: { in: owners } } }),
  );
  await step('audit', () => prismaClient.auditLog.deleteMany({ where: { actorId: { in: owners } } }));
  await step('งานทดสอบ', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
  await step('ฟิลด์', () =>
    prismaClient.fieldDefinition.deleteMany({ where: { id: { in: fields } } }),
  );
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: `BLB${STAMP}` } }));
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

describe('A · สิทธิ์และคำขอที่ผิดทั้งชุด', () => {
  it('**ไม่มี BULK_EDIT = ทำไม่ได้ แม้จะแก้ทีละใบได้**', async () => {
    await expect(
      bulkEditLabels(viewer, keys, { fieldId: labelFieldId as bigint, add: ['ด่วน'] }),
    ).rejects.toThrow(PermissionDeniedError);
    expect(await labelsOf(ids[0] as bigint)).toEqual(['เดิมของA']);
  });

  it('ไม่ได้ระบุป้ายที่จะเพิ่มหรือเอาออก = ปฏิเสธก่อนแตะใบไหน', async () => {
    await expect(
      bulkEditLabels(staff, keys, { fieldId: labelFieldId as bigint }),
    ).rejects.toThrow(NothingSelectedError);
    // ป้ายว่างล้วนก็เท่ากับไม่ได้ระบุ
    await expect(
      bulkEditLabels(staff, keys, { fieldId: labelFieldId as bigint, add: ['  ', ''] }),
    ).rejects.toThrow(NothingSelectedError);
  });

  it('**ฟิลด์ที่ไม่ใช่ชนิดป้าย ถูกปฏิเสธ**', async () => {
    /*
      ฟิลด์ค่าเดี่ยวจะเก็บได้แค่ค่าแรก ที่เหลือหายเงียบ ๆ · ผู้ใช้ที่ติดป้าย
      สามอันแล้วเห็นอันเดียว จะคิดว่าตัวเองกดผิด ไม่ใช่ว่าระบบทิ้งของ
    */
    await expect(
      bulkEditLabels(staff, keys, { fieldId: textFieldId as bigint, add: ['ด่วน'] }),
    ).rejects.toThrow(NotALabelFieldError);
  });
});

describe('B · เพิ่มโดยไม่ลบของเดิม', () => {
  it('**เพิ่มป้ายแล้วป้ายเดิมต้องอยู่ครบ**', async () => {
    /*
      เคสที่ทั้งไฟล์นี้มีไว้เพื่อดัก · `setFieldValues` เขียนทับทั้งชุดโดยตั้งใจ
      ถ้าเรียกมันตรง ๆ ป้ายเดิมของทุกใบจะหายไปพร้อมกัน และไม่มีใครรู้
      จนกว่าจะมีคนมาถามหาป้ายเก่า
    */
    const r = await bulkEditLabels(staff, keys, {
      fieldId: labelFieldId as bigint,
      add: ['ด่วน'],
    });
    expect(r.changed).toBe(3);
    expect(await labelsOf(ids[0] as bigint)).toEqual(['ด่วน', 'เดิมของA'].sort());
    expect(await labelsOf(ids[1] as bigint)).toEqual(['ด่วน', 'ร่วม', 'เดิมของB'].sort());
    // ใบที่ยังไม่มีป้ายเลย ก็ได้ป้ายใหม่
    expect(await labelsOf(ids[2] as bigint)).toEqual(['ด่วน']);
  });

  it('เพิ่มป้ายที่มีอยู่แล้ว = ไม่มีอะไรเปลี่ยน และไม่เขียนประวัติเพิ่ม', async () => {
    const before = await prismaClient.workItemHistory.count({
      where: { workItemId: ids[0] as bigint, field: `lbl${STAMP}` },
    });
    const r = await bulkEditLabels(staff, keys, {
      fieldId: labelFieldId as bigint,
      add: ['ด่วน'],
    });
    expect(r.unchanged).toBe(3);
    expect(r.changed).toBe(0);
    const after = await prismaClient.workItemHistory.count({
      where: { workItemId: ids[0] as bigint, field: `lbl${STAMP}` },
    });
    expect(after).toBe(before);
  });
});

describe('C · เอาออกโดยไม่แตะป้ายอื่น', () => {
  it('**เอาป้ายหนึ่งออก ป้ายอื่นต้องอยู่ครบ**', async () => {
    const r = await bulkEditLabels(staff, keys, {
      fieldId: labelFieldId as bigint,
      remove: ['ด่วน'],
    });
    expect(r.changed).toBe(3);
    expect(await labelsOf(ids[1] as bigint)).toEqual(['ร่วม', 'เดิมของB'].sort());
  });

  it('เอาป้ายที่ไม่มีออก = ไม่มีอะไรเปลี่ยน', async () => {
    const r = await bulkEditLabels(staff, keys, {
      fieldId: labelFieldId as bigint,
      remove: [`ไม่มีป้ายนี้${STAMP}`],
    });
    expect(r.unchanged).toBe(3);
  });

  it('**ป้ายเดียวกันอยู่ทั้งสองฝั่ง = ให้มันอยู่**', async () => {
    /*
      ผู้ใช้ที่พิมพ์ผิดสองช่องควรได้ผลที่คาดเดาได้ ไม่ใช่ผลที่ขึ้นกับลำดับ
      ในโค้ด · "เอาออกก่อน แล้วค่อยเพิ่ม" อ่านแล้วเดาผลได้จากเจตนา
    */
    const r = await bulkEditLabels(staff, keys, {
      fieldId: labelFieldId as bigint,
      add: ['ทั้งสองฝั่ง'],
      remove: ['ทั้งสองฝั่ง'],
    });
    expect(r.changed).toBe(3);
    expect(await labelsOf(ids[2] as bigint)).toEqual(['ทั้งสองฝั่ง']);
  });
});

describe('D · ประวัติ และฟิลด์ที่โปรเจกต์ไม่ได้ใช้', () => {
  it('**ประวัติถูกเขียน แม้ `setFieldValues` จะไม่เขียนให้**', async () => {
    /*
      `setFieldValues` ใช้ `tenantTransaction` ไม่ใช่ `auditedTransaction`
      ผลคือการแก้ค่าฟิลด์เพิ่มเติมไม่เคยปรากฏในไทม์ไลน์เลย — ช่องโหว่ของ
      INVARIANT 2 ที่มีมาก่อนไฟล์นี้ · เส้นทางใหม่ต้องไม่สืบทอดมันต่อ
    */
    const rows = await prismaClient.workItemHistory.findMany({
      where: { workItemId: ids[0] as bigint, field: `lbl${STAMP}` },
      select: { oldValue: true, newValue: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => (r.newValue ?? '').includes('ด่วน'))).toBe(true);
  });

  it('**ฟิลด์ป้ายที่โปรเจกต์ไม่ได้ใช้ ถูกปฏิเสธรายใบ**', async () => {
    /*
      เขียนค่าลงฟิลด์ที่ไม่มีหน้าจอไหนแสดง ทำให้คนติดป้ายแล้วเปิดดูไม่เห็น
      จึงติดซ้ำอีกรอบ — และข้อมูลที่ไม่มีใครเห็นก็ไม่มีใครมาลบด้วย
    */
    const r = await bulkEditLabels(staff, keys, {
      fieldId: strayFieldId as bigint,
      add: ['ไม่ควรถูกเขียน'],
    });
    expect(r.changed).toBe(0);
    expect(r.failed).toBe(3);
    const wrote = await prismaClient.workItemFieldValue.count({
      where: { fieldId: strayFieldId as bigint },
    });
    expect(wrote).toBe(0);
  });

  it('รายการฟิลด์ป้ายให้หน้าจอเลือก มีของจริง', async () => {
    const list = await labelFields(staff);
    expect(list.some((f) => f.id === String(labelFieldId))).toBe(true);
    expect(list.some((f) => f.id === String(textFieldId))).toBe(false);
  });
});
