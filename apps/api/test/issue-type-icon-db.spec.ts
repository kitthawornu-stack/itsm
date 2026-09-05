/**
 * ไอคอนของประเภทงาน — ต่อกับฐานข้อมูลจริง
 *
 * `icon_key` เคยเป็นสตริงอิสระที่สี่ทางเข้าเขียนคนละแบบ · การเปิดให้ผู้ดูแล
 * กรอกโดยไม่แปล คือการเพิ่มทางเข้าที่ห้าให้ปัญหาเดิม — เคสที่สำคัญที่สุด
 * ในไฟล์นี้จึงเป็น "ส่งค่าที่ไม่รู้จักเข้าไปแล้วต้องได้ `generic`"
 * ไม่ใช่ "ส่งค่าที่ถูกแล้วได้ค่านั้น"
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  createIssueType,
  listIssueTypes,
  setIssueTypeIcon,
} from '../src/modules/field/issue-type.service';

const STAMP = String(Date.now()).slice(-6);
let ctx: TenantContext;
let userId: bigint | undefined;
const made: bigint[] = [];

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  const u = await prismaClient.user.create({
    data: {
      tenantId: tenant.id,
      email: `icon-${STAMP}@example.test`,
      displayName: `ผู้ดูแลทดสอบ ${STAMP}`,
    },
    select: { id: true },
  });
  userId = u.id;
  ctx = { tenantId: tenant.id, actorId: u.id };
}, 120_000);

afterAll(async () => {
  /*
    ถามจาก audit_log ว่าผู้ใช้ของเทสต์แตะอะไรไปบ้าง ไม่ใช่จากตัวแปรที่จำไว้
    — ตอนกลไกหายไป เคสที่ "ไม่ควรสร้างอะไร" จะสร้างแถวจริง
  */
  const touched = await prismaClient.auditLog.findMany({
    where: { actorId: userId ?? 0n, entityType: 'issue_type' },
    select: { entityId: true },
  });
  const ids = [...new Set([...made.map((m) => m.toString()), ...touched.map((t) => t.entityId)])]
    // `entity_id` เป็นสตริงอิสระในสคีมา — กรองให้เหลือเลขล้วนก่อนแปลง
    .filter((v) => /^\d+$/.test(v))
    .map((v) => BigInt(v));
  await prismaClient.workflowScheme.deleteMany({ where: { issueTypeId: { in: ids } } });
  await prismaClient.issueType.deleteMany({ where: { id: { in: ids }, name: { contains: STAMP } } });
  await prismaClient.auditLog.deleteMany({ where: { actorId: userId ?? 0n } });
  await prismaClient.user.deleteMany({ where: { id: userId ?? 0n } });
  await prismaClient.$disconnect();
});

async function iconOf(id: bigint): Promise<string> {
  const rows = await listIssueTypes(ctx);
  return rows.find((r) => r.id === id.toString())?.icon ?? 'ไม่พบ';
}

describe('ไอคอนของประเภทงาน', () => {
  it('สร้างพร้อมไอคอนที่เลือกได้', async () => {
    const t = await createIssueType(ctx, `ขออนุมัติ ${STAMP}`, false, 'change');
    made.push(t.id);
    expect(await iconOf(t.id)).toBe('change');
  });

  /** **หัวใจ** — ทางเข้าใหม่ต้องไม่กลายเป็นทางเข้าที่ห้าของค่าดิบ */
  it('**ค่าที่ไม่รู้จักกลายเป็น generic ไม่ใช่ถูกเก็บดิบ ๆ**', async () => {
    const t = await createIssueType(ctx, `ค่าประหลาด ${STAMP}`, false, 'lucide:flame');
    made.push(t.id);
    expect(await iconOf(t.id)).toBe('generic');
    const raw = await prismaClient.issueType.findFirstOrThrow({
      where: { id: t.id },
      select: { iconKey: true },
    });
    expect(raw.iconKey, 'ค่าดิบถูกเก็บลงฐานข้อมูล — แปลแค่ตอนอ่านไม่พอ').toBe('generic');
  });

  it('ไม่ส่งไอคอนมาเลย ได้ generic', async () => {
    const t = await createIssueType(ctx, `ไม่ระบุไอคอน ${STAMP}`);
    made.push(t.id);
    expect(await iconOf(t.id)).toBe('generic');
  });

  it('เปลี่ยนไอคอนของประเภทที่มีอยู่แล้วได้ · และค่าเดิมอยู่ใน audit', async () => {
    const t = await createIssueType(ctx, `เปลี่ยนไอคอน ${STAMP}`, false, 'task');
    made.push(t.id);
    expect(await setIssueTypeIcon(ctx, t.id, 'bug')).toBe('bug');
    expect(await iconOf(t.id)).toBe('bug');

    const log = await prismaClient.auditLog.findFirstOrThrow({
      where: { actorId: userId ?? 0n, action: 'issuetype.icon', entityId: t.id.toString() },
      select: { payload: true },
      orderBy: { id: 'desc' },
    });
    // "เปลี่ยนเป็นอะไร" ตอบได้ครึ่งเดียวว่าเกิดอะไรขึ้น
    expect(log.payload).toMatchObject({ from: 'task', to: 'bug' });
  });

  it('แถวเก่าที่ถือค่าดิบ ถูกแปลตอนอ่าน — ไม่ต้อง migration', async () => {
    const t = await createIssueType(ctx, `ค่าดิบเก่า ${STAMP}`);
    made.push(t.id);
    // จำลองแถวที่ seed เขียนไว้ก่อนมีคำศัพท์
    await prismaClient.issueType.update({ where: { id: t.id }, data: { iconKey: 'alert-triangle' } });
    expect(await iconOf(t.id)).toBe('incident');
  });
});
