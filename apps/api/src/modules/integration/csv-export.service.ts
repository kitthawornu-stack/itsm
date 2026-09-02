/**
 * ส่งออกงานของโปรเจกต์เป็น CSV
 *
 * เอกสารสถานะเขียนไว้เองว่าเครื่องมือย้ายข้อมูล "ยังเหลือการส่งออกทั้งองค์กร" ·
 * องค์กรที่เอาข้อมูลของตัวเองออกไม่ได้ คือองค์กรที่ถูกจับเป็นตัวประกัน
 *
 * **ไฟล์ที่ออกจากที่นี่ นำเข้ากลับได้ด้วยตัวอ่านตัวเดียวกับทางนำเข้า**
 * — พิสูจน์ไว้ใน `csv-export.spec.ts` ด้วย `parseCsv` และ `planImport` ตัวจริง
 */
import type { TenantContext } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan } from '../permission';

import { toCsv, type ExportRow } from './csv-export';

export class ProjectNotFoundForExportError extends Error {
  constructor(readonly key: string) {
    super(`ไม่พบโปรเจกต์ ${key}`);
    this.name = 'ProjectNotFoundForExportError';
  }
}

/**
 * จำนวนแถวที่อ่านต่อรอบ
 *
 * โปรเจกต์จริงในฐานข้อมูลพัฒนามีเกือบหมื่นใบ · การอ่านทีเดียวทั้งก้อน
 * ทำได้ แต่จะกลายเป็นจุดที่พังตอนลูกค้ามีข้อมูลมากกว่านี้ โดยไม่มีอะไรเตือน
 */
const PAGE = 1000;

/** จำนวนสูงสุดที่ยอมส่งออกในครั้งเดียว — เกินกว่านี้ต้องบอกคน ไม่ใช่ค้างเงียบ ๆ */
export const EXPORT_LIMIT = 50_000;

export class TooManyToExportError extends Error {
  constructor(readonly total: number) {
    super(
      `โปรเจกต์นี้มีงาน ${total.toLocaleString('th-TH')} เรื่อง ` +
        `ซึ่งเกินขีดจำกัด ${EXPORT_LIMIT.toLocaleString('th-TH')} เรื่องต่อครั้ง`,
    );
    this.name = 'TooManyToExportError';
  }
}

export interface ExportResult {
  csv: string;
  /** ชื่อไฟล์ที่แนะนำ — คนดาวน์โหลดหลายโปรเจกต์ต้องแยกออกว่าไฟล์ไหนของอะไร */
  filename: string;
  rows: number;
}

/**
 * ส่งออกงานทั้งโปรเจกต์
 *
 * ต้องมีสิทธิ์ `BROWSE_PROJECT` — การส่งออกคือการอ่านทุกใบพร้อมกัน
 * จึงไม่ควรง่ายกว่าการเปิดดูทีละใบ
 *
 * **บันทึก audit ทุกครั้ง** แม้จะไม่ใช่การแก้ข้อมูล · การที่ใครสักคนดึงงาน
 * ทั้งโปรเจกต์ออกไปเป็นไฟล์ คือเหตุการณ์ที่ต้องตอบได้ภายหลังว่าใครทำเมื่อไร
 * — ถ้าไม่บันทึก จะไม่มีร่องรอยเลยว่าข้อมูลออกจากระบบไปแล้ว
 */
export async function exportProjectCsv(
  ctx: TenantContext,
  projectKey: string,
  now: Date,
): Promise<ExportResult> {
  const db = tenantScoped(ctx);
  const project = await db.project.findFirst({
    where: { key: projectKey },
    select: { id: true, key: true },
  });
  if (project === null) throw new ProjectNotFoundForExportError(projectKey);
  await assertCan(ctx, project.id, 'BROWSE_PROJECT');

  /*
    นับก่อนอ่าน — เพื่อบอกคนได้ว่ามันใหญ่เกินไป **ก่อน** ที่จะใช้เวลาอ่าน
    ทั้งหมดแล้วค่อยล้ม · ข้อความที่บอกจำนวนจริงทำให้คนตัดสินใจต่อได้เอง
  */
  const total = await db.workItem.count({ where: { projectId: project.id } });
  if (total > EXPORT_LIMIT) throw new TooManyToExportError(total);

  const rows: ExportRow[] = [];
  let cursor: bigint | null = null;
  for (;;) {
    /*
      เดินด้วย cursor ไม่ใช่ `skip` — `skip` ที่หน้าลึก ๆ ทำให้ MySQL
      อ่านแถวที่ข้ามทิ้งทุกครั้ง และช้าลงเรื่อย ๆ ตามความลึก
    */
    const page: Array<{
      id: bigint;
      itemKey: string;
      summary: string;
      status: { name: string };
      priority: { name: string } | null;
      reporter: { email: string };
    }> = await db.workItem.findMany({
      where: { projectId: project.id, ...(cursor === null ? {} : { id: { gt: cursor } }) },
      select: {
        id: true,
        itemKey: true,
        summary: true,
        status: { select: { name: true } },
        priority: { select: { name: true } },
        reporter: { select: { email: true } },
      },
      orderBy: { id: 'asc' },
      take: PAGE,
    });
    if (page.length === 0) break;
    for (const w of page) {
      rows.push({
        externalKey: w.itemKey,
        summary: w.summary,
        status: w.status.name,
        // งานที่ยังไม่ได้ตั้งระดับความสำคัญมีจริง — ช่องว่าง ไม่ใช่คำว่า null
        priority: w.priority?.name ?? '',
        reporterEmail: w.reporter.email,
      });
    }
    cursor = page[page.length - 1]?.id ?? null;
    if (page.length < PAGE) break;
  }

  const stamp = now.toISOString().slice(0, 10);
  const filename = `${project.key}-${stamp}.csv`;

  await auditedTransaction(ctx, 'integration.export.csv', () =>
    Promise.resolve({
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'integration.export.csv',
          entityType: 'project',
          entityId: project.id.toString(),
          // ไม่เก็บเนื้อไฟล์ — เก็บว่าใครดึงอะไรออกไปเท่าไร เมื่อไร
          payload: { projectKey: project.key, rows: rows.length, filename },
        },
      ],
    }),
  );

  return { csv: toCsv(rows), filename, rows: rows.length };
}
