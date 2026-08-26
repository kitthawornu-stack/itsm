import { prismaClient } from '../infrastructure/prisma/client';
import { hashPassword } from '../modules/identity/password';

async function main(): Promise<void> {
  const hash = await hashPassword('helix-dev-2569-ปลาทู');
  const r = await prismaClient.user.updateMany({
    where: { isSystem: false, passwordHash: null },
    data: { passwordHash: hash },
  });
  process.stdout.write(`ตั้งรหัสผ่านให้ ${String(r.count)} คน\n`);
  await prismaClient.$disconnect();
}
void main();
