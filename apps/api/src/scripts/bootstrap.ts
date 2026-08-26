/**
 * ตั้งค่าเริ่มต้นหลังติดตั้งใหม่ — สร้างองค์กรและผู้ดูแลระบบคนแรก
 *
 * **ทำไมต้องมี**: ฐานข้อมูลที่เพิ่ง migrate เสร็จไม่มีผู้ใช้เลยสักคน
 * ระบบปิดทุก endpoint เป็นค่าปริยาย (SessionGuard) จึงไม่มีใครล็อกอินได้
 * และไม่มีทางสร้างผู้ใช้คนแรกผ่านหน้าจอ — ติดตั้งเสร็จแล้วเข้าไม่ได้เลย
 *
 * เจอตอนยกสแตก production ขึ้นครั้งแรกจริง ๆ ไม่ใช่จากการอ่านโค้ด
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
  process.stdout.write('เข้าสู่ระบบแล้วเพิ่มผู้ใช้คนอื่นได้ที่หน้า "ผู้ใช้และสิทธิ์"\n');
  await prismaClient.$disconnect();
}

void main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
