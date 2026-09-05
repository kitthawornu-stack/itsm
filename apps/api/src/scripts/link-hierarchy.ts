/**
 * เติมลำดับชั้นให้ฐานข้อมูลที่ seed ไปแล้ว — ตรรกะอยู่ใน `hierarchy-apply.ts`
 * ซึ่ง `seed.ts` เรียกตัวเดียวกัน ผลจึงตรงกันเสมอ
 *
 * รันด้วย: pnpm --filter @itsm/api link-hierarchy
 */
import { PrismaClient } from '@prisma/client';

import { applyHierarchy } from './hierarchy-apply';

const prisma = new PrismaClient();

applyHierarchy(prisma)
  .then((n) => {
    console.log(`เติมลำดับชั้นรวม ${String(n)} แถว`);
  })
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
