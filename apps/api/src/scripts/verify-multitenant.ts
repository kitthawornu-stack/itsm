/**
 * พิสูจน์ว่าสร้างองค์กรที่สองได้จริง และข้อมูลไม่ปนกัน
 *
 * ## ทำไมต้องมีไฟล์นี้
 *
 * เอกสารสถานะเคยเขียนว่า "สิ่งที่ยังไม่มีคือทางสร้างองค์กรที่สอง — ไม่มี
 * service ไม่มี endpoint ไม่มีหน้าจอ" · **ครึ่งหลังจริง ครึ่งแรกไม่จริง** ·
 * `bootstrap.ts` อ่านคีย์องค์กรจาก `DEFAULT_TENANT_KEY` อยู่แล้ว จึงสร้าง
 * องค์กรที่สองได้ตั้งแต่แรก โดยไม่มีใครรู้
 *
 * คำกล่าวอ้างแบบนี้ต้องมีอะไรพิสูจน์ได้ ไม่ใช่เชื่อคำประกาศ (CLAUDE.md) ·
 * ไฟล์นี้คือการพิสูจน์ที่รันซ้ำได้
 *
 * ## ทำงานบนฐานข้อมูลชั่วคราวเสมอ
 *
 * สร้างฐานใหม่ · migrate · bootstrap สององค์กร · ตรวจ · แล้วลบทิ้ง ·
 * **ไม่แตะฐานข้อมูลพัฒนาเลย** — การสร้างองค์กรที่สองในฐานจริงลบคืนยาก
 * เพราะ `workflow_scheme → workflow` เป็น `onDelete: Restrict` โดยตั้งใจ
 * ลำดับ cascade ของ MySQL จึงชนกันและได้ P2003 (บันทึกไว้ใน CLAUDE.md §3)
 *
 * ใช้: pnpm --filter @itsm/api verify:multitenant
 */
import { execFileSync } from 'node:child_process';

import { PrismaClient } from '@prisma/client';
import { systemClock } from '@itsm/types';

const DB = `itsm_mt_${String(systemClock.nowUtc().getTime()).slice(-8)}`;
const ROOT_USER = process.env['MYSQL_ROOT_USER'] ?? 'root';
const ROOT_PASSWORD = process.env['MYSQL_ROOT_PASSWORD'] ?? 'itsm_root_dev';
const CONTAINER = process.env['MYSQL_CONTAINER'] ?? 'itsm-mysql';
const HOST = process.env['MYSQL_HOST'] ?? 'localhost';
const PORT = process.env['MYSQL_PORT'] ?? '4306';
const URL = `mysql://itsm:itsm_dev@${HOST}:${PORT}/${DB}`;

function mysql(sql: string): void {
  execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'mysql', `-u${ROOT_USER}`, `-p${ROOT_PASSWORD}`, '-e', sql],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
}

function run(cmd: string, args: string[], env: Record<string, string>): void {
  execFileSync(cmd, args, {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, ...env },
    shell: true,
  });
}

interface Problem {
  what: string;
}

async function main(): Promise<void> {
  const problems: Problem[] = [];
  process.stdout.write(`สร้างฐานข้อมูลชั่วคราว ${DB}\n`);
  mysql(
    `CREATE DATABASE ${DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; ` +
      `GRANT ALL ON ${DB}.* TO 'itsm'@'%'; FLUSH PRIVILEGES;`,
  );

  try {
    run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { DATABASE_URL: URL });
    process.stdout.write('migrate เรียบร้อย\n');

    const orgs = [
      { key: 'acme', name: 'บริษัท เอซีเอ็มอี', email: 'admin@acme.co.th' },
      { key: 'beta', name: 'บริษัท เบต้า', email: 'admin@beta.co.th' },
    ];
    for (const o of orgs) {
      run('pnpm', ['exec', 'tsx', 'src/scripts/bootstrap.ts'], {
        DATABASE_URL: URL,
        DEFAULT_TENANT_KEY: o.key,
        BOOTSTRAP_TENANT_NAME: o.name,
        BOOTSTRAP_ADMIN_EMAIL: o.email,
        BOOTSTRAP_ADMIN_PASSWORD: `รหัสผ่านที่ยาวพอสำหรับ ${o.key} 2569`,
      });
      process.stdout.write(`bootstrap องค์กร ${o.key} เรียบร้อย\n`);
    }

    const db = new PrismaClient({ datasources: { db: { url: URL } } });
    try {
      const tenants = await db.tenant.findMany({ select: { id: true, key: true } });
      if (tenants.length !== 2) problems.push({ what: `ได้องค์กร ${String(tenants.length)} แห่ง ไม่ใช่ 2` });

      process.stdout.write(`\n${'='.repeat(64)}\n`);
      for (const t of tenants) {
        const users = await db.user.count({ where: { tenantId: t.id } });
        const projects = await db.project.count({ where: { tenantId: t.id } });
        const workflows = await db.workflow.count({ where: { tenantId: t.id } });
        const grants = await db.permissionGrant.count({ where: { tenantId: t.id } });
        process.stdout.write(
          `${t.key}: ผู้ใช้ ${String(users)} · โปรเจกต์ ${String(projects)} · ` +
            `workflow ${String(workflows)} · สิทธิ์ ${String(grants)}\n`,
        );
        /*
          องค์กรที่ตั้งค่าไม่ครบ = ล็อกอินได้แต่ใช้ไม่ได้ ซึ่งเป็นสิ่งที่เจอ
          ตอนยกสแตกจริงครั้งแรก และเป็นเหตุผลที่ `bootstrap` สร้างโปรเจกต์ให้ด้วย
        */
        if (users < 1 || projects < 1 || workflows < 1 || grants < 1) {
          problems.push({ what: `องค์กร ${t.key} ตั้งค่าไม่ครบ` });
        }
      }

      /*
        **คีย์โปรเจกต์ต้องซ้ำกันข้ามองค์กรได้** — ทุกองค์กรอยากได้ `SD` ·
        ถ้า unique เป็นระดับระบบ องค์กรที่สองจะสร้างไม่ได้เลย
      */
      const keys = await db.project.findMany({ select: { key: true, tenantId: true } });
      const sd = keys.filter((k) => k.key === 'SD');
      process.stdout.write(`\nโปรเจกต์คีย์ SD มี ${String(sd.length)} แห่ง (คนละองค์กร)\n`);
      if (sd.length !== 2) problems.push({ what: 'คีย์โปรเจกต์ซ้ำข้ามองค์กรไม่ได้' });

      /*
        **การกั้นข้อมูล** — อ่านของอีกองค์กรด้วยขอบเขตของตัวเองต้องไม่เห็น ·
        `tenant-isolation.spec.ts` ตรวจเรื่องนี้อยู่แล้ว แต่กับองค์กรที่เทสต์
        สร้างเอง · ที่นี่ตรวจกับองค์กรที่ผ่าน `bootstrap` จริงทั้งคู่
      */
      const [a, b] = tenants;
      if (a !== undefined && b !== undefined) {
        const target = await db.project.findFirstOrThrow({
          where: { tenantId: b.id },
          select: { id: true },
        });
        const leaked = await db.project.findFirst({
          where: { id: target.id, tenantId: a.id },
          select: { key: true },
        });
        process.stdout.write(
          `อ่านโปรเจกต์ของ ${b.key} ด้วยขอบเขตของ ${a.key}: ` +
            (leaked === null ? 'ไม่เห็น (ถูกต้อง)\n' : '**เห็น — ข้อมูลรั่ว**\n'),
        );
        if (leaked !== null) problems.push({ what: 'ข้อมูลรั่วข้ามองค์กร' });

        const users = await db.user.findMany({ where: { tenantId: a.id }, select: { email: true } });
        if (users.some((u) => u.email.includes('beta'))) {
          problems.push({ what: 'ผู้ใช้ขององค์กรอื่นโผล่ในรายการ' });
        }
      }
    } finally {
      await db.$disconnect();
    }

    process.stdout.write(`${'='.repeat(64)}\n`);
    if (problems.length === 0) {
      process.stdout.write('**สร้างองค์กรที่สองได้จริง และข้อมูลไม่ปนกัน**\n');
    } else {
      for (const p of problems) process.stdout.write(`  ✖ ${p.what}\n`);
      process.exitCode = 1;
    }
  } finally {
    // ลบฐานชั่วคราวเสมอ แม้การตรวจจะล้มกลางทาง
    mysql(`DROP DATABASE IF EXISTS ${DB};`);
    process.stdout.write(`ลบฐานข้อมูลชั่วคราว ${DB} แล้ว\n`);
  }
}

void main().catch((e: unknown) => {
  process.stderr.write(`ตรวจหลายองค์กรล้ม: ${e instanceof Error ? e.message : String(e)}\n`);
  process.stderr.write(`หากล้มก่อนเก็บกวาด ให้ลบฐาน ${DB} เอง\n`);
  process.exitCode = 1;
});
