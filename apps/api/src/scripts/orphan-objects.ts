/**
 * ตรวจไบต์กำพร้าในที่เก็บไฟล์ — **รายงานอย่างเดียว จนกว่าจะสั่งลบ**
 *
 * วัดจริงในฐานข้อมูลพัฒนา: 849 วัตถุใน MinIO แต่มีแถวไฟล์แนบเพียง 5 แถว ·
 * ไบต์ที่ไม่มีอะไรชี้ถึงสะสมจากเทสต์ที่ลบแถวตรง ๆ โดยไม่ผ่าน `deleteAttachment`
 * และจากการลบไฟล์ที่ล้มแล้วถูกกลืนไว้โดยตั้งใจ (ดูคอมเมนต์ใน `attachment.service`)
 *
 * ผลเสียสองอย่าง: ดิสก์โตโดยไม่มีใครเห็น และ **PDPA — "ลบแล้ว" ที่ไฟล์ยังอยู่
 * ไม่ใช่การลบ**
 *
 * ## ค่าปริยายคือไม่ลบ
 *
 * เครื่องมือที่ลบโดยปริยาย จะถูกรันโดยคนที่แค่อยากดูว่ามีอะไรบ้าง ·
 * ต้องพิมพ์ `--delete` เอง และตัวเลขที่จะหายไปถูกแสดงก่อนเสมอ
 *
 * ใช้: pnpm --filter @itsm/api orphans [--delete]
 */
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@itsm/types';

import { deleteObject, listObjects } from '../infrastructure/storage/object-store';
import { MIN_AGE_MS, planOrphanCleanup } from '../modules/workitem/orphan-objects';

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const wantDelete = process.argv.includes('--delete');
  const db = new PrismaClient();
  try {
    const objects = await listObjects();
    /*
      อ่านคีย์ **ทุกแถวของทุกองค์กร** โดยตั้งใจ — ที่เก็บไฟล์ไม่ได้แบ่งตาม
      องค์กร การเทียบด้วยเซ็ตของ tenant เดียวจะทำให้ไฟล์ขององค์กรอื่น
      ดูเหมือนกำพร้าทั้งหมด · นี่คือสคริปต์ระดับระบบ ไม่ใช่ระดับผู้ใช้
    */
    const rows = await db.workItemAttachment.findMany({ select: { storageKey: true } });
    const known = new Set(rows.map((r) => r.storageKey).filter((k) => k !== ''));

    const plan = planOrphanCleanup(objects, known, systemClock.nowUtc());

    process.stdout.write(`${'='.repeat(72)}\n`);
    process.stdout.write(
      `วัตถุในที่เก็บไฟล์ ${String(objects.length)} · แถวในฐานข้อมูล ${String(rows.length)}\n`,
    );
    process.stdout.write(
      `มีแถวชี้ถึง ${String(plan.matched)} · ` +
        `ยังใหม่เกินกว่าจะตัดสิน ${String(plan.tooYoung)} · ` +
        `ไม่รู้เวลาที่เขียน ${String(plan.unknownAge)}\n`,
    );
    process.stdout.write(
      `**กำพร้า ${String(plan.orphans.length)} รายการ · ${mb(plan.orphanBytes)}**\n`,
    );
    process.stdout.write(
      `(นับว่ากำพร้าเมื่อไม่มีแถวชี้ถึง และเขียนไว้นานกว่า ${String(MIN_AGE_MS / 3_600_000)} ชั่วโมง)\n`,
    );
    process.stdout.write(`${'='.repeat(72)}\n`);

    for (const o of plan.orphans.slice(0, 10)) {
      process.stdout.write(`  ${o.key}  (${String(o.sizeBytes)} ไบต์)\n`);
    }
    if (plan.orphans.length > 10) {
      process.stdout.write(`  … และอีก ${String(plan.orphans.length - 10)} รายการ\n`);
    }

    if (plan.refusedReason !== null) {
      process.stdout.write(`\n**ไม่ลบอะไรทั้งสิ้น**: ${plan.refusedReason}\n`);
      return;
    }
    if (!wantDelete) {
      process.stdout.write('\nยังไม่ลบอะไร — เติม `--delete` ถ้าต้องการลบจริง\n');
      return;
    }
    if (plan.orphans.length === 0) {
      process.stdout.write('\nไม่มีอะไรให้ลบ\n');
      return;
    }

    let removed = 0;
    const failed: string[] = [];
    for (const o of plan.orphans) {
      try {
        await deleteObject(o.key);
        removed += 1;
      } catch (e) {
        failed.push(`${o.key} — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    process.stdout.write(`\nลบแล้ว ${String(removed)} รายการ · คืนพื้นที่ ${mb(plan.orphanBytes)}\n`);
    if (failed.length > 0) {
      /*
        **บอกทีละรายการที่ล้ม ไม่ใช่แค่จำนวน** — ไฟล์ที่ลบไม่ได้จะยังอยู่
        และรอบหน้าจะเจอมันอีก · ถ้าไม่รู้ว่าอันไหน ก็ไล่หาสาเหตุไม่ได้
      */
      process.stdout.write(`\nลบไม่สำเร็จ ${String(failed.length)} รายการ:\n`);
      for (const f of failed.slice(0, 10)) process.stdout.write(`  ${f}\n`);
    }

    // นับใหม่หลังลบ เพื่อยืนยันแทนที่จะเชื่อว่าคำสั่งทำงาน
    const after = await listObjects();
    process.stdout.write(
      `\nวัตถุที่เหลือ ${String(after.length)} ` +
        `(คาดไว้ ${String(objects.length - removed)})` +
        (after.length === objects.length - removed ? ' — ตรงกัน\n' : ' — **ไม่ตรง**\n'),
    );
  } finally {
    await db.$disconnect();
  }
}

void main().catch((e: unknown) => {
  process.stderr.write(`ตรวจไบต์กำพร้าล้ม: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
