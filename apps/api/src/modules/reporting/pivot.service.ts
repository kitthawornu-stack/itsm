/**
 * รายงานตารางไขว้ — ต่อ `buildPivot` เข้ากับฐานข้อมูล
 *
 * **ดึงเฉพาะสองคอลัมน์ที่ใช้จัดกลุ่ม แล้วนับในหน่วยความจำ**
 *
 * ตั้งใจไม่ใช้ `groupBy` ของ Prisma เพราะมันรับ `by` เป็นอาร์เรย์ของค่าคงที่
 * เท่านั้น · มิติที่เลือกได้ตอนรันจึงต้อง cast ทั้งก้อนให้ผ่านชนิด ซึ่งเป็น
 * **การปิดปาก TypeScript ไม่ใช่การพิสูจน์ว่าถูก** — และบทเรียนใน CLAUDE.md
 * บอกไว้ว่าชนิดที่โกหกทำให้เครื่องมือตรวจโกหกตาม
 *
 * ราคาที่จ่าย: ดึง id สองคอลัมน์ต่อหนึ่งงานในช่วงเวลานั้น · **วัดแล้วบน
 * ข้อมูลจริง 10,000 ใบ** (ดู `pivot-db.spec.ts`) · ถ้าวันหนึ่งช้าเกินรับได้
 * ทางแก้คือ aggregate ฝั่งฐานข้อมูลด้วยชื่อคอลัมน์จาก allow-list เดียวกันนี้
 * ไม่ใช่ cast ให้ `groupBy` ยอมรับค่าที่หาไม่ได้ตอนคอมไพล์
 *
 * มิติที่เลือกได้เป็น **allow-list** เหมือน HQL — ปล่อยให้ระบุชื่อคอลัมน์
 * อะไรก็ได้ แปลว่าคนที่รู้ชื่อภายในจะจัดกลุ่มด้วยฟิลด์ที่ไม่ควรถูกจัดกลุ่ม
 * และรู้ได้ว่ามีข้อมูลอะไรอยู่จากจำนวนผลลัพธ์
 */
import type { TenantContext } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan } from '../permission';

import { buildPivot, type PivotFact, type PivotTable } from './pivot';
import type { ReportWindow } from './report-window';
import { NoReportAccessError, reportableProjectIds } from './report.service';

/** มิติที่จัดกลุ่มได้ */
export const PIVOT_DIMENSIONS = ['status', 'priority', 'assignee', 'type', 'project'] as const;
export type PivotDimension = (typeof PIVOT_DIMENSIONS)[number];

/** ป้ายภาษาไทยของแต่ละมิติ — ผู้ใช้เห็นชื่อนี้ ไม่ใช่ชื่อฟิลด์ */
export const PIVOT_DIMENSION_LABEL: Record<PivotDimension, string> = {
  status: 'สถานะ',
  priority: 'ระดับความสำคัญ',
  assignee: 'ผู้รับผิดชอบ',
  type: 'ประเภทงาน',
  project: 'โปรเจกต์',
};

/**
 * ข้อความปฏิเสธใช้ **ป้ายภาษาไทย ไม่ใช่คีย์ภายใน**
 *
 * §5 ของ CLAUDE.md: ข้อความที่ผู้ใช้เห็นเป็นภาษาคน ไม่ใช่ศัพท์ระบบ ·
 * รอบแรกเขียนว่า `จัดกลุ่มได้เฉพาะ status · priority · …` ซึ่งเป็นชื่อที่
 * ผู้ใช้ไม่เคยเห็นที่ไหนบนหน้าจอเลย — **เห็นตอนเปิดดูจริง ไม่ใช่ตอนอ่านโค้ด**
 */
const dimensionNames = (): string =>
  PIVOT_DIMENSIONS.map((d) => PIVOT_DIMENSION_LABEL[d]).join(' · ');

export class UnknownPivotDimensionError extends Error {
  constructor(name: string) {
    super(`ไม่รู้จักมิติ "${name}" — จัดกลุ่มได้เฉพาะ ${dimensionNames()}`);
  }
}

/**
 * แถวกับคอลัมน์เป็นมิติเดียวกัน
 *
 * ตารางแบบนั้นมีค่าเฉพาะแนวทแยง ช่องอื่นเป็น 0 หมด · ไม่ใช่ข้อมูลผิด
 * แต่เป็นคำถามที่ตอบตัวเอง จึงปฏิเสธพร้อมบอกว่าทำไม แทนที่จะให้ตารางที่
 * ดูเหมือนพัง
 */
export class SameDimensionError extends Error {
  constructor(dim: PivotDimension) {
    super(
      `แถวกับคอลัมน์เป็น "${PIVOT_DIMENSION_LABEL[dim]}" เหมือนกัน` +
        ' — ตารางจะมีค่าเฉพาะแนวทแยง · เลือกคนละมิติ',
    );
  }
}

export function assertDimension(name: string): PivotDimension {
  const known: readonly string[] = PIVOT_DIMENSIONS;
  if (!known.includes(name)) throw new UnknownPivotDimensionError(name);
  return name as PivotDimension;
}

/**
 * คอลัมน์ที่ต้อง `select` สำหรับมิติหนึ่ง
 *
 * เขียนเป็น `switch` ที่คืนค่าคงที่ **ไม่ใช่ประกอบชื่อคอลัมน์เป็นสตริง
 * แล้ว cast** · การ cast ทำให้ TypeScript เลิกตรวจทั้งก้อน แล้วชื่อคอลัมน์
 * ที่พิมพ์ผิดจะกลายเป็น `undefined` ตอนรัน ซึ่งอ่านเหมือนงานทุกใบไม่มีค่า
 * ในมิตินั้น — ตารางจะขึ้นว่า "ไม่ระบุ" ทั้งคอลัมน์โดยไม่มี error
 */
function selectFor(d: PivotDimension): Record<string, true> {
  switch (d) {
    case 'status':
      return { statusId: true };
    case 'priority':
      return { priorityId: true };
    case 'assignee':
      return { assigneeId: true };
    case 'type':
      return { issueTypeId: true };
    case 'project':
      return { projectId: true };
  }
}

/** แถวที่ดึงมา — มีเฉพาะสองคอลัมน์ที่ขอ ที่เหลือเป็น `undefined` */
interface PivotRowShape {
  statusId?: bigint;
  priorityId?: number | null;
  assigneeId?: bigint | null;
  issueTypeId?: bigint;
  projectId?: bigint;
}

/** ค่าของมิติหนึ่งในแถวหนึ่ง · `null` = ไม่มีค่า (เช่นยังไม่มีผู้รับผิดชอบ) */
function valueOf(r: PivotRowShape, d: PivotDimension): bigint | number | null {
  switch (d) {
    case 'status':
      return r.statusId ?? null;
    case 'priority':
      return r.priorityId ?? null;
    case 'assignee':
      return r.assigneeId ?? null;
    case 'type':
      return r.issueTypeId ?? null;
    case 'project':
      return r.projectId ?? null;
  }
}

export interface PivotResult extends PivotTable {
  rowDimension: PivotDimension;
  columnDimension: PivotDimension;
}

/**
 * ตารางไขว้ของงานที่ **สร้างในช่วงเวลาที่ระบุ**
 *
 * ขอบเขตคือโปรเจกต์ที่ผู้ใช้ดูรายงานได้เท่านั้น · **รายการว่าง = ปฏิเสธ
 * ไม่ใช่คืนตารางเปล่า** — ตารางเปล่าอ่านว่า "ช่วงนี้ไม่มีงานเลย" ซึ่งเป็น
 * คำตอบที่ผิดคนละเรื่องกับ "คุณไม่มีสิทธิ์ดู"
 *
 * `projectId` ที่ระบุมาต้องผ่าน `assertCan` ตรง ๆ ไม่ใช่แค่ถูกกรองออกเงียบ ๆ
 */
export async function pivotReport(
  ctx: TenantContext,
  win: ReportWindow,
  rowDimension: PivotDimension,
  columnDimension: PivotDimension,
  projectId?: bigint,
): Promise<PivotResult> {
  if (rowDimension === columnDimension) throw new SameDimensionError(rowDimension);
  if (projectId !== undefined) await assertCan(ctx, projectId, 'VIEW_REPORT');

  const allowed = projectId === undefined ? await reportableProjectIds(ctx) : [projectId];
  if (allowed.length === 0) throw new NoReportAccessError();

  const cells: PivotRowShape[] = await tenantScoped(ctx).workItem.findMany({
    where: { projectId: { in: allowed }, createdAt: { gte: win.from, lt: win.to } },
    select: { ...selectFor(rowDimension), ...selectFor(columnDimension) },
  });

  /* แปลง id เป็นชื่อด้วยคิวรีเดียวต่อมิติ */
  const ids = (d: PivotDimension): bigint[] => [
    ...new Set(
      cells
        .map((r) => valueOf(r, d))
        .filter((v): v is bigint | number => v !== null)
        .map((v) => BigInt(v)),
    ),
  ];
  const labels = await labelMap(ctx, rowDimension, ids(rowDimension));
  const colLabels = await labelMap(ctx, columnDimension, ids(columnDimension));

  /*
    หนึ่งงาน = หนึ่งจุดข้อมูลที่นับ 1 · `buildPivot` รวมค่าที่ซ้ำคู่กันเอง
    (มีเคสคุมไว้) จึงไม่ต้องนับซ้ำที่นี่
  */
  const facts: PivotFact[] = cells.map((r) => {
    const rv = valueOf(r, rowDimension);
    const cv = valueOf(r, columnDimension);
    return {
      /*
        **ค่าที่หาชื่อไม่เจอ ต้องไม่กลายเป็น "ไม่ระบุ"** — ของเดิมตกเป็น `null`
        แล้วไปรวมกับกองที่ไม่มีค่าเลย · เจอตอนพิสูจน์ว่าเทสต์แดงได้:
        ทำให้ตัวแปลงชื่อหาไม่ครบแล้ว **เทสต์ยังเขียวทั้งสิบเคส**
      */
      row: rv === null ? null : (labels.get(String(rv)) ?? missingLabel(String(rv))),
      col: cv === null ? null : (colLabels.get(String(cv)) ?? missingLabel(String(cv))),
      n: 1,
    };
  });

  return { ...buildPivot(facts), rowDimension, columnDimension };
}

/**
 * ชื่อที่ใช้เมื่อ **มีค่าอยู่ แต่หาชื่อไม่เจอ**
 *
 * ต่างจาก "ไม่ระบุ" ซึ่งแปลว่าไม่มีค่าเลย · ถ้ายุบรวมกัน กองงานที่ยังไม่มี
 * คนรับจะดูใหญ่กว่าความจริง ซึ่งเป็นตัวเลขที่คนเปิดรายงานมาหาโดยตรง
 *
 * **สถานะนี้ไปถึงไม่ได้จากทางเข้าปกติของระบบ และไม่มีเทสต์คุ้ม** — ทุกมิติ
 * มี foreign key: `project` `issueType` `status` เป็น `Restrict` (ลบไม่ได้
 * ขณะที่ยังมีงานอ้างถึง) · `priority` กับ `assignee` เป็น `SetNull`
 * (id กลายเป็น null ซึ่งคือ "ไม่ระบุ" จริง ๆ) · id ที่ไม่ null จึงหาชื่อเจอเสมอ
 *
 * ทางเดียวที่เหลือคือ id ที่ชี้ไปยังแถวของ **องค์กรอื่น** ซึ่ง `tenantScoped`
 * กรองออก · ไม่มี foreign key ไหนกันข้อนั้น แต่ก็สร้างจากทางเข้าปกติไม่ได้
 * เช่นกัน · เก็บไว้เพราะราคาถูกและปลอดภัยกว่าการยุบรวม —
 * **ไม่ใช่เพราะพิสูจน์แล้วว่าจำเป็น** (ลองลบออกแล้วเทสต์ยังเขียวทั้งหมด
 * ซึ่งเป็นสัญญาณว่าไปไม่ถึง ไม่ใช่ว่าไม่สำคัญ)
 */
export const missingLabel = (id: string): string => `ไม่พบชื่อ #${id}`;

/** id → ชื่อที่ผู้ใช้อ่าน */
async function labelMap(
  ctx: TenantContext,
  dim: PivotDimension,
  ids: readonly bigint[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const db = tenantScoped(ctx);
  const put = (rows: Array<{ id: bigint | number; name: string }>): void => {
    for (const r of rows) out.set(String(r.id), r.name);
  };
  switch (dim) {
    case 'status':
      put(await db.workflowStatus.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }));
      break;
    case 'priority':
      put(
        await db.priority.findMany({
          where: { id: { in: ids.map((i) => Number(i)) } },
          select: { id: true, name: true },
        }),
      );
      break;
    case 'assignee':
      put(
        (
          await db.user.findMany({
            where: { id: { in: [...ids] } },
            select: { id: true, displayName: true },
          })
        ).map((u) => ({ id: u.id, name: u.displayName })),
      );
      break;
    case 'type':
      put(await db.issueType.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }));
      break;
    case 'project':
      put(
        (
          await db.project.findMany({ where: { id: { in: [...ids] } }, select: { id: true, key: true } })
        ).map((p) => ({ id: p.id, name: p.key })),
      );
      break;
  }
  return out;
}
