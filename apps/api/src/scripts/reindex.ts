/**
 * สร้างดัชนีค้นหาใหม่จาก MySQL
 *
 * ADR-005 กำหนดว่าต้องมีคำสั่งนี้และต้องรันบน production ได้จริง
 * ปลอดภัยเสมอเพราะ MySQL คือแหล่งความจริง — OpenSearch สร้างใหม่ได้ตลอด
 *
 * รันด้วย: pnpm --filter @itsm/api reindex
 */
import { resolveOperatorContext } from './operator-context';
import { prismaClient } from '../infrastructure/prisma/client';
import { reindexAll } from '../modules/search-index';

async function main(): Promise<void> {
  const ctx = await resolveOperatorContext();
  const result = await reindexAll(ctx, {
    batchSize: 2_000,
    onProgress: (done, total) => {
      process.stdout.write(`\r  ${done}/${total}`);
    },
  });
  process.stdout.write('\n');
  console.log(
    `สร้างดัชนี ${result.index} เสร็จ — ${result.indexed} รายการ ใน ${result.elapsedMs} ms`,
  );
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prismaClient.$disconnect());
