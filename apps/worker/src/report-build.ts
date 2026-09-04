/**
 * ประกอบไฟล์รายงานใน worker
 *
 * **ตรวจสิทธิ์ทุกรอบ ไม่ใช่เชื่อว่าตรวจตอนตั้งแล้วพอ** · ตารางที่ตั้งไว้ตอน
 * ยังมีสิทธิ์ ต้องหยุดส่งเมื่อสิทธิ์ถูกถอน — มิฉะนั้นการถอนสิทธิ์จะไม่มีผล
 * กับสิ่งที่ตั้งไว้แล้ว ซึ่งเป็นช่องที่ไม่มีใครนึกถึงเวลาถอนสิทธิ์ใครสักคน
 *
 * **กติกาการรวมสิทธิ์มาจาก `@itsm/types`** ตัวเดียวกับที่ api ใช้ ·
 * คิวรีอยู่ที่นี่เพราะ worker มี Prisma client ของตัวเอง แต่ **กติกา
 * ห้ามเขียนซ้ำ** — สองคำตอบเรื่องสิทธิ์คือที่ที่ผิดแล้วไม่มีทางเห็น
 * จนกว่าจะมีคนได้ข้อมูลที่ไม่ควรได้
 */
import type { PrismaClient } from '@prisma/client';
import { resolveGrants, toCsv, type ExportRow } from '@itsm/types';

/** เพดานแถวต่อไฟล์ · ไฟล์ที่ใหญ่กว่านี้ส่งทางอีเมลไม่ไหวอยู่แล้ว */
export const MAX_REPORT_ROWS = 5000;

export class ReportPermissionRevokedError extends Error {
  constructor(email: string, projectKey: string) {
    super(`${email} ไม่มีสิทธิ์ดูรายงานของ ${projectKey} แล้ว — ตารางนี้จะไม่ถูกส่งจนกว่าจะได้สิทธิ์คืน`);
  }
}

export class ReportProjectGoneError extends Error {
  constructor(projectKey: string) {
    super(`ไม่พบโปรเจกต์ ${projectKey} แล้ว`);
  }
}

/**
 * สิทธิ์ที่ผู้ใช้คนหนึ่งมีในโปรเจกต์หนึ่ง — **คิวรีเดียวกับที่ api ทำ**
 *
 * `permissionsFor` ฝั่ง api อ่าน grant ของชุดสิทธิ์ที่โปรเจกต์ผูกไว้
 * แล้วตัดกับกลุ่มที่ผู้ใช้อยู่ · ที่นี่ทำแบบเดียวกัน และส่งผลให้
 * `resolveGrants` ตัวเดียวกันตัดสิน · มีเทสต์ที่เทียบคำตอบสองฝั่ง
 * บนข้อมูลจริง เพื่อจับวันที่สองที่เริ่มไม่ตรงกัน
 */
export async function permissionsInProject(
  prisma: PrismaClient,
  userId: bigint,
  projectId: bigint,
): Promise<Set<string>> {
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: { permissionSchemeId: true },
  });
  /*
    โปรเจกต์ที่ไม่มีชุดสิทธิ์ = ไม่มีใครมีสิทธิ์อะไรเลย ไม่ใช่ทุกคนมีทุกอย่าง
    · ข้อมูลที่ไม่ครบต้องแปลว่าไม่มีสิทธิ์ (CLAUDE.md)
  */
  if (project === null || project.permissionSchemeId === null) return new Set();

  const [grants, memberships] = await Promise.all([
    prisma.permissionGrant.findMany({
      where: { schemeId: project.permissionSchemeId },
      select: { permission: true, groupId: true },
    }),
    prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } }),
  ]);
  return resolveGrants(
    grants,
    memberships.map((m) => m.groupId),
  );
}

/**
 * ประกอบไฟล์ CSV ของโปรเจกต์หนึ่ง ด้วยสิทธิ์ของเจ้าของตาราง
 *
 * โยน error เมื่อสิทธิ์ถูกถอนหรือโปรเจกต์หายไป · ผู้เรียก (`runReportSender`)
 * บันทึกเหตุผลลงแถวให้เจ้าของเห็น แทนที่จะเงียบ
 */
export interface BuiltReport {
  csv: string;
  filename: string;
  /** จำนวนแถวในไฟล์ · เท่ากับ `total` เมื่อไม่ถูกตัด */
  rows: number;
  /** จำนวนงานทั้งหมดที่เข้าเงื่อนไข **ก่อน**ตัด */
  total: number;
}

export async function buildProjectCsv(
  prisma: PrismaClient,
  input: { ownerId: bigint; ownerEmail: string; projectId: bigint; projectKey: string },
): Promise<BuiltReport> {
  const perms = await permissionsInProject(prisma, input.ownerId, input.projectId);
  /*
    ต้องมีทั้งสองอย่าง — เห็นโปรเจกต์ **และ** ดูรายงานได้ · เหมือนกับ
    เงื่อนไขที่ api ใช้ตอนคนกดดาวน์โหลดเอง
  */
  if (!perms.has('BROWSE_PROJECT') || !perms.has('VIEW_REPORT')) {
    throw new ReportPermissionRevokedError(input.ownerEmail, input.projectKey);
  }

  /*
    **นับทั้งหมดก่อนตัด** · ไฟล์ที่ถูกตัดแล้วบอกแค่จำนวนแถวในไฟล์
    ทำให้ผู้รับอ่านว่า "โปรเจกต์นี้มีงานเท่านี้" ซึ่งน้อยกว่าความจริง ·
    เป็นความผิดชนิดเดียวกับตารางไขว้ที่ตัดคอลัมน์เงียบ ๆ
  */
  const total = await prisma.workItem.count({ where: { projectId: input.projectId } });

  const rows = await prisma.workItem.findMany({
    where: { projectId: input.projectId },
    orderBy: { id: 'asc' },
    take: MAX_REPORT_ROWS,
    select: {
      itemKey: true,
      summary: true,
      status: { select: { name: true } },
      priority: { select: { name: true } },
      reporter: { select: { email: true } },
    },
  });

  const data: ExportRow[] = rows.map((r) => ({
    externalKey: r.itemKey,
    summary: r.summary,
    status: r.status.name,
    priority: r.priority?.name ?? '',
    reporterEmail: r.reporter.email,
  }));

  return {
    csv: toCsv(data),
    filename: `${input.projectKey}.csv`,
    rows: data.length,
    total,
  };
}
