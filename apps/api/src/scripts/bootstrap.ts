/**
 * ตั้งค่าเริ่มต้นหลังติดตั้งใหม่ — สร้างองค์กรและผู้ดูแลระบบคนแรก
 *
 * **ทำไมต้องมี**: ฐานข้อมูลที่เพิ่ง migrate เสร็จไม่มีผู้ใช้เลยสักคน
 * ระบบปิดทุก endpoint เป็นค่าปริยาย (SessionGuard) จึงไม่มีใครล็อกอินได้
 * และไม่มีทางสร้างผู้ใช้คนแรกผ่านหน้าจอ — ติดตั้งเสร็จแล้วเข้าไม่ได้เลย
 *
 * เจอตอนยกสแตก production ขึ้นครั้งแรกจริง ๆ ไม่ใช่จากการอ่านโค้ด
 *
 * **สร้างโปรเจกต์เริ่มต้นด้วย** ไม่ใช่แค่ผู้ใช้
 *
 * ครั้งแรกที่ยกสแตกขึ้นแล้วล็อกอินสำเร็จ พบว่าหน้าจอว่างเปล่า: ไม่มีโปรเจกต์
 * ไม่มี workflow ไม่มีชนิดงาน จึงแจ้งเรื่องไม่ได้และคิวไม่มีอะไรให้ดู
 * ติดตั้งเสร็จแล้วเข้าได้ แต่ยังใช้ไม่ได้ — ซึ่งไม่ต่างจากใช้ไม่ได้เลย
 *
 * รันซ้ำได้ — ถ้ามีองค์กรหรือผู้ดูแลอยู่แล้วจะไม่แตะของเดิม
 *
 *   docker compose -f infra/compose/docker-compose.prod.yml run --rm \
 *     -e BOOTSTRAP_ADMIN_EMAIL=you@company.co.th \
 *     -e BOOTSTRAP_ADMIN_PASSWORD='ประโยคที่ยาวพอ' \
 *     api node dist/scripts/bootstrap.js
 */
import { prismaClient } from '../infrastructure/prisma/client';
import { hashPassword } from '../modules/identity/password';

/** สิทธิ์ที่ผู้ดูแลระบบต้องมีตั้งแต่วันแรก */
const ADMIN_PERMISSIONS = ['ADMINISTER_TENANT', 'BROWSE_PROJECT'] as const;

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === '') {
    throw new Error(
      `ต้องระบุ ${name} — ตัวอย่าง:\n` +
        "  -e BOOTSTRAP_ADMIN_EMAIL=you@company.co.th -e BOOTSTRAP_ADMIN_PASSWORD='ประโยคที่ยาวพอ'",
    );
  }
  return v.trim();
}

async function main(): Promise<void> {
  const tenantKey = process.env['DEFAULT_TENANT_KEY'] ?? 'default';
  const tenantName = process.env['BOOTSTRAP_TENANT_NAME'] ?? 'องค์กรของฉัน';
  const email = required('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const password = required('BOOTSTRAP_ADMIN_PASSWORD');
  const displayName = process.env['BOOTSTRAP_ADMIN_NAME'] ?? email;

  const tenant = await prismaClient.tenant.upsert({
    where: { key: tenantKey },
    create: { key: tenantKey, name: tenantName },
    update: {},
    select: { id: true, key: true },
  });
  process.stdout.write(`องค์กร: ${tenant.key}\n`);

  const existing = await prismaClient.user.findFirst({
    where: { tenantId: tenant.id, email },
    select: { id: true },
  });
  if (existing !== null) {
    // ไม่เขียนทับรหัสผ่านของบัญชีที่มีอยู่ — สคริปต์ตั้งค่าเริ่มต้น
    // ต้องไม่กลายเป็นเครื่องมือรีเซ็ตรหัสผ่านที่ใครก็รันได้
    process.stdout.write(`ผู้ใช้ ${email} มีอยู่แล้ว — ไม่แตะรหัสผ่านเดิม\n`);
    await prismaClient.$disconnect();
    return;
  }

  const group = await prismaClient.userGroup.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'ผู้ดูแลระบบ' } },
    create: { tenantId: tenant.id, name: 'ผู้ดูแลระบบ' },
    update: {},
    select: { id: true },
  });

  const scheme = await prismaClient.permissionScheme.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'ค่าเริ่มต้น' } },
    create: { tenantId: tenant.id, name: 'ค่าเริ่มต้น' },
    update: {},
    select: { id: true },
  });

  for (const permission of ADMIN_PERMISSIONS) {
    /**
     * ใช้ findFirst + create ไม่ใช่ upsert
     *
     * unique ของตารางนี้รวม `projectRole` ซึ่งเป็น null ได้ และ Prisma
     * ปฏิเสธ null ในคีย์ผสมของ `where` — ข้อความคือ
     * "Argument `projectRole` must not be null" ซึ่งอ่านแล้วไม่รู้ว่าต้องแก้ยังไง
     */
    const already = await prismaClient.permissionGrant.findFirst({
      where: { schemeId: scheme.id, permission, groupId: group.id },
      select: { id: true },
    });
    if (already === null) {
      await prismaClient.permissionGrant.create({
        data: { tenantId: tenant.id, schemeId: scheme.id, permission, groupId: group.id },
      });
    }
  }

  const user = await prismaClient.user.create({
    data: {
      tenantId: tenant.id,
      email,
      displayName,
      passwordHash: await hashPassword(password),
    },
    select: { id: true },
  });
  await prismaClient.groupMember.create({
    data: { tenantId: tenant.id, groupId: group.id, userId: user.id },
  });

  process.stdout.write(`สร้างผู้ดูแลระบบ: ${email}\n`);

  await ensureLookups(tenant.id);
  await ensureStarterProject(tenant.id, group.id, scheme.id);

  process.stdout.write('เข้าสู่ระบบแล้วเพิ่มผู้ใช้คนอื่นได้ที่หน้า "ผู้ใช้และสิทธิ์"\n');
  await prismaClient.$disconnect();
}

/**
 * ระดับความสำคัญและผลการแก้ไข
 *
 * สองตารางนี้เป็นตัวเลือกที่หน้าจอต้องมี ไม่ใช่ข้อมูลตัวอย่าง — ถ้าว่าง
 * ช่อง "ความสำคัญ" ในฟอร์มแจ้งปัญหาจะไม่มีอะไรให้เลือก และปิดงานแล้ว
 * ตอบไม่ได้ว่าจบอย่างไร ซึ่งทำให้รายงานทุกตัวที่แยกตามผลลัพธ์ใช้ไม่ได้
 *
 * สีเก็บเป็น **semantic token** ไม่ใช่ค่าสีดิบ (CLAUDE.md §6)
 */
async function ensureLookups(tenantId: bigint): Promise<void> {
  const priorities: Array<[string, number, string]> = [
    ['P1 วิกฤต', 1, 'status-critical'],
    ['P2 สูง', 2, 'status-warning'],
    ['P3 ปานกลาง', 3, 'status-info'],
    ['P4 ต่ำ', 4, 'status-neutral'],
    ['P5 เล็กน้อย', 5, 'status-neutral'],
  ];
  for (const [name, rank, colorToken] of priorities) {
    await prismaClient.priority.upsert({
      where: { tenantId_name: { tenantId, name } },
      create: { tenantId, name, rank, colorToken },
      update: {},
    });
  }

  const resolutions = ['แก้ไขแล้ว', 'ทำตามที่ขอแล้ว', 'ไม่พบปัญหา', 'ซ้ำกับเรื่องอื่น', 'ยกเลิก'];
  for (const name of resolutions) {
    await prismaClient.resolution.upsert({
      where: { tenantId_name: { tenantId, name } },
      create: { tenantId, name },
      update: {},
    });
  }

  process.stdout.write(
    `ตั้งค่าความสำคัญ ${String(priorities.length)} ระดับ · ผลการแก้ไข ${String(resolutions.length)} แบบ\n`,
  );
}

/**
 * โปรเจกต์ Service Desk ที่ใช้งานได้ทันที
 *
 * เล็กที่สุดเท่าที่ยังแจ้งเรื่องและปิดงานได้จริง — สามสถานะ สองปุ่ม
 * ไม่ใช่ workflow ตัวอย่างที่สวยแต่ต้องรื้อทิ้ง
 *
 * ทุกคนในองค์กรเปิดดูและแจ้งเรื่องได้ · ทีมผู้ดูแลแก้ไขและเปลี่ยนสถานะได้
 * เมื่อมีหน้าจอตั้งค่าโปรเจกต์แล้ว ส่วนนี้จะกลายเป็นค่าเริ่มต้นที่แก้ต่อได้
 */
async function ensureStarterProject(
  tenantId: bigint,
  adminGroupId: bigint,
  schemeId: bigint,
): Promise<void> {
  const existing = await prismaClient.project.findFirst({ where: { tenantId }, select: { id: true } });
  if (existing !== null) {
    process.stdout.write('มีโปรเจกต์อยู่แล้ว — ไม่สร้างเพิ่ม\n');
    return;
  }

  // กลุ่มที่ทุกคนอยู่ — ผู้แจ้งต้องเปิดดูและสร้างงานได้
  const everyone = await prismaClient.userGroup.upsert({
    where: { tenantId_name: { tenantId, name: 'พนักงานทั้งหมด' } },
    create: { tenantId, name: 'พนักงานทั้งหมด' },
    update: {},
    select: { id: true },
  });

  const workflow = await prismaClient.workflow.create({
    data: { tenantId, name: 'Service Desk', version: 1, isActive: true },
    select: { id: true },
  });

  const mkStatus = async (
    name: string,
    category: 'TODO' | 'IN_PROGRESS' | 'DONE',
    position: number,
    isInitial = false,
    pausesSla = false,
  ): Promise<bigint> => {
    const r = await prismaClient.workflowStatus.create({
      data: { tenantId, workflowId: workflow.id, name, category, position, isInitial, pausesSla },
      select: { id: true },
    });
    return r.id;
  };

  const isNew = await mkStatus('รับเรื่องแล้ว', 'TODO', 1, true);
  const doing = await mkStatus('กำลังดำเนินการ', 'IN_PROGRESS', 2);
  const done = await mkStatus('เสร็จแล้ว', 'DONE', 3);

  await prismaClient.workflowTransition.createMany({
    data: [
      { tenantId, workflowId: workflow.id, name: 'เริ่มดำเนินการ', fromStatusId: isNew, toStatusId: doing, position: 1 },
      { tenantId, workflowId: workflow.id, name: 'ปิดงาน', fromStatusId: doing, toStatusId: done, position: 2 },
    ],
  });

  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: 'SD',
      name: 'ศูนย์บริการไอที',
      type: 'SERVICE_DESK',
      permissionSchemeId: schemeId,
      notifyGroupId: adminGroupId,
    },
    select: { id: true },
  });
  // ตัวนับคีย์ต้องมีตั้งแต่แรก — ไม่งั้นงานใบแรกสร้างไม่ได้
  await prismaClient.projectCounter.create({ data: { tenantId, projectId: project.id, lastValue: 0 } });

  const issueType = await prismaClient.issueType.create({
    data: { tenantId, name: 'Incident', iconKey: 'incident', isSubtask: false },
    select: { id: true },
  });
  await prismaClient.workflowScheme.create({
    data: { tenantId, projectId: project.id, issueTypeId: issueType.id, workflowId: workflow.id },
  });

  // สิทธิ์: ทุกคนแจ้งและคุยได้ · ผู้ดูแลจัดการงานได้
  const grants: Array<[string, bigint]> = [
    ['BROWSE_PROJECT', everyone.id],
    ['CREATE_ITEM', everyone.id],
    ['ADD_COMMENT', everyone.id],
    ['EDIT_ITEM', adminGroupId],
    ['ASSIGN_ITEM', adminGroupId],
    ['TRANSITION_ITEM', adminGroupId],
    ['MANAGE_ATTACHMENT', adminGroupId],
    ['VIEW_INTERNAL_COMMENT', adminGroupId],
  ];
  for (const [permission, groupId] of grants) {
    const already = await prismaClient.permissionGrant.findFirst({
      where: { schemeId, permission: permission as never, groupId },
      select: { id: true },
    });
    if (already === null) {
      await prismaClient.permissionGrant.create({
        data: { tenantId, schemeId, permission: permission as never, groupId },
      });
    }
  }

  // ผู้ดูแลต้องอยู่กลุ่มพนักงานทั้งหมดด้วย ไม่งั้นเปิดดูโปรเจกต์ตัวเองไม่ได้
  const admins = await prismaClient.groupMember.findMany({
    where: { groupId: adminGroupId },
    select: { userId: true },
  });
  for (const a of admins) {
    // คีย์หลักของตารางนี้คือ (groupId, userId) จึงใช้ upsert ได้ตรง ๆ
    await prismaClient.groupMember.upsert({
      where: { groupId_userId: { groupId: everyone.id, userId: a.userId } },
      create: { tenantId, groupId: everyone.id, userId: a.userId },
      update: {},
    });
  }

  process.stdout.write('สร้างโปรเจกต์ SD · ศูนย์บริการไอที (3 สถานะ · 2 ปุ่ม)\n');
}

void main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
