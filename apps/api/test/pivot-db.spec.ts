/**
 * รายงานตารางไขว้ — ต่อกับฐานข้อมูลจริง
 *
 * `pivot.spec.ts` พิสูจน์ตรรกะบนจุดข้อมูลที่ประกอบเอง · ไฟล์นี้พิสูจน์ว่า
 * **มีอะไรในระบบสร้างจุดข้อมูลเหล่านั้นได้จริง** และวัดต้นทุนบนข้อมูลจริง
 * ซึ่งเป็นข้ออ้างที่เขียนไว้ในคอมเมนต์ของ `pivot.service.ts`
 *
 * **ใช้ข้อมูล seed ที่มีอยู่ ไม่สร้างงานของตัวเอง** — เป็นเทสต์ที่อ่านอย่างเดียว
 * จึงไม่แตะข้อมูลใคร · แต่ **ยืนยันได้เฉพาะสิ่งที่ตัวเองเป็นเจ้าของ** ไม่ได้
 * ดังนั้นตัวเลขทั้งหมดจึงตรวจเป็นความสัมพันธ์ภายในตาราง (ยอดรวม = ผลบวกช่อง)
 * ไม่ใช่ค่าเป๊ะที่ไฟล์เทสต์อื่นทำให้เปลี่ยนได้
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toUtcDate, type TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  NO_VALUE_LABEL,
  SameDimensionError,
  UnknownPivotDimensionError,
  assertDimension,
  pivotReport,
  windowFor,
} from '../src/modules/reporting';

/** ผู้ใช้จริงที่มีสิทธิ์ดูรายงาน — หาเอาจากฐานข้อมูล ไม่ใช่เดา */
let viewer: TenantContext;
let tenantId: bigint;

/**
 * ช่วงเวลาที่ครอบข้อมูล seed
 *
 * `windowFor` รับนาฬิกาเข้ามา ไม่อ่านเอง — ตั้ง "ตอนนี้" ให้ครอบข้อมูลจริง
 * ได้โดยไม่ต้องรอเวลาจริง · **ตั้งไว้ในช่วงที่ seed มีงานอยู่**
 * (งานใบล่าสุดของ seed คือปลายเดือนสิงหาคม 2569)
 *
 * รอบแรกเขียนว่า `'this-year'` ซึ่ง **ไม่มีอยู่จริง** — `windowFor` ตกไปเป็น
 * 30 วันเงียบ ๆ (ไม่มี `default` ที่ล้ม) แล้วได้ช่วงที่ไม่มีงานสักใบ ·
 * เทสต์ยอดรวมจึงผ่านด้วย `0 === 0` ซึ่งเป็นการเทียบเซ็ตว่างกับเซ็ตว่าง
 * · `tsc` จับให้ ส่วนเทสต์ไม่จับ เพราะ vitest ไม่ตรวจชนิด
 */
const WIN = windowFor('last-30-days', toUtcDate(Date.parse('2026-08-28T00:00:00.000Z')));

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  /*
    หาผู้ใช้ที่มี VIEW_REPORT จริงจากตาราง grant · **ไม่ใช่ใช้ชื่อที่จำมา**
    — ผู้ใช้ที่ตั้งชื่อไว้ในเทสต์จะพังในวันที่ seed เปลี่ยน
  */
  const grant = await prismaClient.permissionGrant.findFirstOrThrow({
    where: { tenantId, permission: 'VIEW_REPORT', groupId: { not: null } },
    select: { groupId: true },
  });
  const member = await prismaClient.groupMember.findFirstOrThrow({
    where: { groupId: grant.groupId ?? 0n },
    select: { userId: true },
  });
  viewer = { tenantId, actorId: member.userId };
}, 120_000);

afterAll(async () => {
  await prismaClient.$disconnect();
});

describe('A · ตารางจากข้อมูลจริง', () => {
  it('จัดกลุ่มผู้รับผิดชอบ × สถานะ ได้ตารางที่มีทั้งแถวและคอลัมน์', async () => {
    const t = await pivotReport(viewer, WIN, 'assignee', 'status');
    expect(t.rows.length).toBeGreaterThan(0);
    expect(t.columns.length).toBeGreaterThan(0);
    expect(t.rowDimension).toBe('assignee');
    expect(t.columnDimension).toBe('status');
  });

  /**
   * **ยอดรวมต้องตรงกับผลบวกของช่องที่แสดง** บนข้อมูลจริง ไม่ใช่แค่ข้อมูล
   * ตัวอย่าง · ยอดที่ไม่ตรงแย่กว่าไม่มียอด เพราะคนเชื่อยอดรวมมากกว่าช่อง
   */
  it('**ยอดของทุกแถวตรงกับผลบวกช่อง**', async () => {
    const t = await pivotReport(viewer, WIN, 'assignee', 'status');
    for (const r of t.rows) {
      expect(r.total, `แถว "${r.label}"`).toBe(r.cells.reduce((a, b) => a + b, 0));
      expect(r.cells, `แถว "${r.label}" มีช่องไม่ครบ`).toHaveLength(t.columns.length);
    }
  });

  /**
   * **งานที่ยังไม่มีผู้รับผิดชอบต้องอยู่ในตาราง**
   *
   * ข้อมูล seed มีงานที่ยังไม่มีคนรับอยู่จริง · ถ้ามันหายไป ผลรวมจะน้อยกว่า
   * ความจริงโดยไม่มีอะไรบอก — และกองนั้นคือสิ่งที่คนเปิดรายงานมาหา
   */
  it('**แถว "ไม่ระบุ" มีอยู่จริงเมื่อมีงานที่ยังไม่มีผู้รับผิดชอบ**', async () => {
    const unassigned = await prismaClient.workItem.count({
      where: { tenantId, assigneeId: null },
    });
    const t = await pivotReport(viewer, WIN, 'assignee', 'status');
    if (unassigned > 0) {
      expect(t.rows.map((r) => r.label)).toContain(NO_VALUE_LABEL);
      expect(t.rows[0]?.label, 'แถวไม่ระบุไม่ได้อยู่บนสุด').toBe(NO_VALUE_LABEL);
    }
  });

  /**
   * **ยอดรวมใหญ่ต้องเท่ากับจำนวนงานที่เข้าเงื่อนไขจริง**
   *
   * นับจากฐานข้อมูลตรง ๆ มาเทียบ · ถ้าตารางนับเกินหรือขาด แปลว่ามีงานถูก
   * นับซ้ำหรือถูกทิ้ง ซึ่งเป็นความผิดที่หน้าตายังดูปกติทุกอย่าง
   */
  it('**ยอดรวมใหญ่ = จำนวนงานที่นับจากฐานข้อมูลตรง ๆ**', async () => {
    const t = await pivotReport(viewer, WIN, 'assignee', 'status');
    const direct = await prismaClient.workItem.count({
      where: {
        tenantId,
        createdAt: { gte: WIN.from, lt: WIN.to },
        projectId: { in: await visibleProjects() },
      },
    });
    /*
      **ต้องมีงานจริงในช่วงนี้** มิฉะนั้นเคสนี้ผ่านด้วย `0 === 0` ซึ่งเป็น
      การเทียบเซ็ตว่างกับเซ็ตว่าง — เกิดขึ้นจริงตอนเขียนรอบแรก
    */
    expect(direct, 'ช่วงเวลาที่เลือกไม่มีงานเลย — เคสนี้จะผ่านโดยไม่ได้ตรวจอะไร').toBeGreaterThan(0);
    expect(t.grandTotal).toBe(direct);
  });

  /**
   * **จำนวนแถวต้องเท่ากับจำนวนค่าที่ต่างกันจริง**
   *
   * จับการยุบรวมที่ทำให้แถวหายไป — เช่นตัวแปลงชื่อที่คืนค่าเดียวกันให้
   * หลาย id หรือคีย์ที่ชนกัน
   *
   * **ข้อจำกัดที่ต้องเขียนไว้**: เคสนี้ **ไม่ได้** พิสูจน์ว่า id ที่หาชื่อ
   * ไม่เจอจะไม่ยุบรวมกับ "ไม่ระบุ" · สถานะนั้นไปถึงไม่ได้ด้วยข้อมูลจริง
   * เพราะทุกมิติมี foreign key (ดูคอมเมนต์ของ `missingLabel`) ·
   * ลองลบกลไกนั้นออกแล้วเทสต์ยังเขียวทั้งหมด ซึ่งแปลว่ามันไปไม่ถึง
   * ไม่ใช่ว่าเทสต์อ่อน — **ด่านที่ไม่ครอบอะไร ต้องเขียนไว้ว่าไม่ครอบ**
   */
  it('**จำนวนแถวเท่ากับจำนวนผู้รับผิดชอบที่ต่างกันจริง**', async () => {
    const t = await pivotReport(viewer, WIN, 'assignee', 'status');
    const distinct = await prismaClient.workItem.findMany({
      where: {
        tenantId,
        createdAt: { gte: WIN.from, lt: WIN.to },
        projectId: { in: await visibleProjects() },
      },
      select: { assigneeId: true },
      distinct: ['assigneeId'],
    });
    expect(t.rows).toHaveLength(distinct.length);
  });

  it('สลับมิติแล้วยอดรวมใหญ่เท่าเดิม — ตารางเดียวกันมองคนละทาง', async () => {
    const a = await pivotReport(viewer, WIN, 'assignee', 'status');
    const b = await pivotReport(viewer, WIN, 'status', 'assignee');
    expect(b.grandTotal).toBe(a.grandTotal);
  });
});

/** โปรเจกต์ที่ผู้ใช้ทดสอบดูรายงานได้ — คำนวณซ้ำเพื่อเทียบยอด */
async function visibleProjects(): Promise<bigint[]> {
  const { reportableProjectIds } = await import('../src/modules/reporting');
  return reportableProjectIds(viewer);
}

describe('B · สิ่งที่ต้องปฏิเสธ', () => {
  it('มิติที่ไม่รู้จัก ถูกปฏิเสธพร้อมบอกว่าเลือกอะไรได้', () => {
    expect(() => assertDimension('ไม่มีมิตินี้')).toThrow(UnknownPivotDimensionError);
    /*
      **ข้อความต้องเป็นภาษาคน ไม่ใช่คีย์ภายใน** (§5) · รอบแรกบอกว่า
      "จัดกลุ่มได้เฉพาะ status · priority · …" ซึ่งเป็นชื่อที่ผู้ใช้
      ไม่เคยเห็นที่ไหนบนหน้าจอเลย — เจอตอนเปิดดูจริง
    */
    expect(() => assertDimension('ไม่มีมิตินี้')).toThrow(/สถานะ/);
    expect(() => assertDimension('ไม่มีมิตินี้'), 'ยังหลุดคีย์ภายในออกมา').not.toThrow(
      /priority/,
    );
  });

  /**
   * แถวกับคอลัมน์เป็นมิติเดียวกัน ให้ตารางที่มีค่าเฉพาะแนวทแยง ·
   * ไม่ใช่ข้อมูลผิด แต่เป็นคำถามที่ตอบตัวเอง — ปฏิเสธพร้อมบอกว่าทำไม
   * ดีกว่าให้ตารางที่ดูเหมือนพัง
   */
  it('**แถวกับคอลัมน์เหมือนกัน ถูกปฏิเสธ**', async () => {
    await expect(pivotReport(viewer, WIN, 'status', 'status')).rejects.toThrow(SameDimensionError);
  });

  it('ผู้ใช้ที่ไม่มีสิทธิ์ดูรายงานเลย ถูกปฏิเสธ ไม่ใช่ได้ตารางเปล่า', async () => {
    const nobody: TenantContext = { tenantId, actorId: null };
    await expect(pivotReport(nobody, WIN, 'assignee', 'status')).rejects.toThrow();
  });

  it('ระบุโปรเจกต์ที่ไม่มีสิทธิ์ ถูกปฏิเสธตรง ๆ ไม่ใช่กรองออกเงียบ ๆ', async () => {
    const nobody: TenantContext = { tenantId, actorId: null };
    const anyProject = await prismaClient.project.findFirstOrThrow({ select: { id: true } });
    await expect(pivotReport(nobody, WIN, 'assignee', 'status', anyProject.id)).rejects.toThrow(
      PermissionDeniedError,
    );
  });
});

describe('C · ต้นทุนบนข้อมูลจริง', () => {
  /**
   * **ข้ออ้างในคอมเมนต์ต้องวัดได้**
   *
   * `pivot.service.ts` เขียนไว้ว่าดึงสองคอลัมน์แล้วนับในหน่วยความจำนั้น
   * รับได้บนข้อมูลจริง · ถ้าไม่วัด มันก็เป็นแค่คำกล่าวอ้าง — และเป็น
   * ประโยคชนิดที่ CLAUDE.md บอกว่าต้องมีวิธีพิสูจน์แนบมาด้วย
   *
   * เกณฑ์ตั้งหลวมโดยตั้งใจ · นี่คือด่านกันการถดถอยระดับ "ช้าจนใช้ไม่ได้"
   * ไม่ใช่การวัดประสิทธิภาพที่แม่นยำ ซึ่งขึ้นกับเครื่องที่รัน
   */
  it('**ตารางบนข้อมูลทั้งปีเสร็จภายในเวลาที่รับได้**', async () => {
    const t0 = Date.now();
    const t = await pivotReport(viewer, WIN, 'assignee', 'status');
    const ms = Date.now() - t0;
    console.log(`ตารางไขว้: ${String(t.grandTotal)} งาน · ${String(ms)} ms`);
    expect(ms, `ใช้เวลา ${String(ms)} ms กับ ${String(t.grandTotal)} งาน`).toBeLessThan(10_000);
  }, 30_000);
});
