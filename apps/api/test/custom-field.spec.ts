/**
 * Spike B — Custom Field แบบ EAV + JSON snapshot (ADR-001)
 *
 * ADR-001 เลือกเก็บแหล่งความจริงเป็น EAV และมีสำเนาอ่านอย่างเดียวเป็น JSON
 * เทสต์ชุดนี้มีหน้าที่ **พิสูจน์หรือหักล้าง** การตัดสินใจนั้นด้วยตัวเลข ไม่ใช่ด้วยเหตุผล
 *
 * ข้อกำหนดที่ต้องผ่าน:
 *   1. เก็บและอ่านได้ครบทุกชนิดฟิลด์ ด้วยชนิดข้อมูลที่ถูกต้อง (ไม่ใช่ยัดเป็น string หมด)
 *   2. ฟิลด์หลายค่า (multi-select, labels, multi-user) เก็บหลายแถวและรักษาลำดับ
 *   3. snapshot ตรงกับ EAV เสมอ — เขียนในทรานแซกชันเดียวกัน
 *   4. เขียนล้มกลางทาง → ทั้ง EAV และ snapshot ต้องไม่เปลี่ยน
 *   5. ตัวตรวจสอบความสอดคล้องจับได้เมื่อ snapshot เพี้ยน และ rebuild ได้
 *   6. **ตัวเลขที่ตัดสิน ADR-001**: อ่านลิสต์ 50 แถวที่มี 12 custom field
 *      จาก snapshot ต้องเร็วกว่าการ JOIN EAV อย่างมีนัยสำคัญ
 *      ถ้าไม่ต่างจริง แปลว่า ADR-001 ซับซ้อนเกินความจำเป็นและต้องทบทวน
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  checkSnapshotConsistency,
  readFieldValues,
  rebuildSnapshot,
  setFieldValues,
  type FieldValueInput,
} from '../src/modules/field/field.service';
import type { TenantContext } from '@itsm/types';

let ctx: TenantContext;
let projectId: bigint;
let issueTypeId: bigint;
let statusId: bigint;
let reporterId: bigint;
let userAId: bigint;
let userBId: bigint;
const fieldIds = new Map<string, bigint>();
const itemIds: bigint[] = [];

const KEY_PREFIX = 'SPIKEB';

async function makeItem(rank: string): Promise<bigint> {
  const item = await prismaClient.workItem.create({
    data: {
      tenantId: ctx.tenantId,
      itemKey: `${KEY_PREFIX}-${rank}`,
      projectId,
      issueTypeId,
      summary: `งานทดสอบ custom field ${rank}`,
      statusId,
      reporterId,
      rank: `0|${rank}`,
    },
  });
  itemIds.push(item.id);
  return item.id;
}

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirst({ where: { key: 'default' } });
  if (tenant === null) throw new Error('ยังไม่มีข้อมูล seed — รัน seed ก่อน');
  ctx = { tenantId: tenant.id, actorId: null };

  const project = await prismaClient.project.findFirstOrThrow({
    where: { tenantId: tenant.id, key: 'SD' },
  });
  projectId = project.id;
  const it = await prismaClient.issueType.findFirstOrThrow({
    where: { tenantId: tenant.id, name: 'Incident' },
  });
  issueTypeId = it.id;
  const st = await prismaClient.workflowStatus.findFirstOrThrow({
    where: { tenantId: tenant.id, name: 'New' },
  });
  statusId = st.id;
  const users = await prismaClient.user.findMany({ where: { tenantId: tenant.id }, take: 3 });
  reporterId = users[0]!.id;
  userAId = users[1]!.id;
  userBId = users[2]!.id;

  // ฟิลด์ครบทุกชนิดที่ระบบรองรับ
  const specs: Array<[key: string, type: string]> = [
    ['spike_text', 'TEXT'],
    ['spike_textarea', 'TEXTAREA'],
    ['spike_richtext', 'RICH_TEXT'],
    ['spike_number', 'NUMBER'],
    ['spike_decimal', 'DECIMAL'],
    ['spike_date', 'DATE'],
    ['spike_datetime', 'DATETIME'],
    ['spike_checkbox', 'CHECKBOX'],
    ['spike_select', 'SELECT'],
    ['spike_multiselect', 'MULTI_SELECT'],
    ['spike_user', 'USER'],
    ['spike_multiuser', 'MULTI_USER'],
    ['spike_labels', 'LABELS'],
    ['spike_url', 'URL'],
  ];
  for (const [key, type] of specs) {
    const f = await prismaClient.fieldDefinition.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key } },
      update: {},
      create: { tenantId: tenant.id, key, name: `ทดสอบ ${key}`, type: type as never },
    });
    fieldIds.set(key, f.id);
  }
}, 120_000);

afterAll(async () => {
  await prismaClient.workItemFieldValue.deleteMany({ where: { workItemId: { in: itemIds } } });
  await prismaClient.workItem.deleteMany({ where: { itemKey: { startsWith: `${KEY_PREFIX}-` } } });
  await prismaClient.fieldDefinition.deleteMany({
    where: { tenantId: ctx.tenantId, key: { startsWith: 'spike_' } },
  });
  await prismaClient.$disconnect();
});

const f = (key: string): bigint => fieldIds.get(key)!;

describe('Spike B · 1 · เก็บค่าได้ครบทุกชนิดด้วยชนิดข้อมูลที่ถูกต้อง', () => {
  it('เขียนแล้วอ่านกลับได้ค่าเดิมทุกชนิด', async () => {
    const id = await makeItem('t1');
    const input: FieldValueInput[] = [
      { fieldId: f('spike_text'), type: 'TEXT', value: 'ข้อความไทยผสม English' },
      { fieldId: f('spike_textarea'), type: 'TEXTAREA', value: 'บรรทัดแรก\nบรรทัดสอง' },
      { fieldId: f('spike_richtext'), type: 'RICH_TEXT', value: '<p>เนื้อหา</p>' },
      { fieldId: f('spike_number'), type: 'NUMBER', value: 42 },
      { fieldId: f('spike_decimal'), type: 'DECIMAL', value: 1234.56 },
      { fieldId: f('spike_date'), type: 'DATE', value: '2026-08-24' },
      { fieldId: f('spike_datetime'), type: 'DATETIME', value: '2026-08-24T09:30:00.000Z' },
      { fieldId: f('spike_checkbox'), type: 'CHECKBOX', value: true },
      { fieldId: f('spike_select'), type: 'SELECT', value: 'ทั้งองค์กร' },
      { fieldId: f('spike_user'), type: 'USER', value: userAId },
      { fieldId: f('spike_url'), type: 'URL', value: 'https://example.test/a' },
    ];
    await setFieldValues(ctx, id, input);

    const read = await readFieldValues(ctx, id);
    expect(read['spike_text']).toBe('ข้อความไทยผสม English');
    expect(read['spike_number']).toBe(42);
    expect(read['spike_decimal']).toBe(1234.56);
    expect(read['spike_checkbox']).toBe(true);
    expect(read['spike_user']).toBe(userAId.toString());
    expect(read['spike_url']).toBe('https://example.test/a');
  });

  it('ตัวเลขเก็บในคอลัมน์ตัวเลขจริง ไม่ใช่ยัดเป็นข้อความ — จึงเรียงและเทียบค่าได้', async () => {
    const rows = await prismaClient.workItemFieldValue.findMany({
      where: { fieldId: f('spike_number'), workItemId: { in: itemIds } },
    });
    expect(rows[0]?.valueNumber).not.toBeNull();
    expect(rows[0]?.valueText).toBeNull();

    // เรียงด้วยคอลัมน์ตัวเลขต้องได้ลำดับเลข ไม่ใช่ลำดับพจนานุกรม
    const id2 = await makeItem('t2');
    await setFieldValues(ctx, id2, [{ fieldId: f('spike_number'), type: 'NUMBER', value: 9 }]);
    const sorted = await prismaClient.workItemFieldValue.findMany({
      where: { fieldId: f('spike_number'), workItemId: { in: itemIds } },
      orderBy: { valueNumber: 'asc' },
    });
    expect(sorted.map((r) => Number(r.valueNumber))).toEqual([9, 42]);
  });

  it('CHECKBOX ที่เป็น false ต้องเก็บได้ ไม่ใช่ถูกมองว่าไม่มีค่า', async () => {
    const id = await makeItem('t3');
    await setFieldValues(ctx, id, [{ fieldId: f('spike_checkbox'), type: 'CHECKBOX', value: false }]);
    const read = await readFieldValues(ctx, id);
    expect(read['spike_checkbox']).toBe(false);
  });

  it('NUMBER ที่เป็น 0 ต้องเก็บได้', async () => {
    const id = await makeItem('t4');
    await setFieldValues(ctx, id, [{ fieldId: f('spike_number'), type: 'NUMBER', value: 0 }]);
    expect((await readFieldValues(ctx, id))['spike_number']).toBe(0);
  });
});

describe('Spike B · 2 · ฟิลด์หลายค่า', () => {
  it('MULTI_SELECT เก็บหลายค่าและรักษาลำดับ', async () => {
    const id = await makeItem('m1');
    await setFieldValues(ctx, id, [
      { fieldId: f('spike_multiselect'), type: 'MULTI_SELECT', value: ['เครือข่าย', 'อีเมล', 'เครื่องพิมพ์'] },
    ]);
    expect((await readFieldValues(ctx, id))['spike_multiselect']).toEqual([
      'เครือข่าย',
      'อีเมล',
      'เครื่องพิมพ์',
    ]);
  });

  it('MULTI_USER เก็บหลายผู้ใช้', async () => {
    const id = await makeItem('m2');
    await setFieldValues(ctx, id, [
      { fieldId: f('spike_multiuser'), type: 'MULTI_USER', value: [userAId, userBId] },
    ]);
    expect((await readFieldValues(ctx, id))['spike_multiuser']).toEqual([
      userAId.toString(),
      userBId.toString(),
    ]);
  });

  it('เขียนทับด้วยค่าใหม่ต้องลบค่าเก่าทิ้ง ไม่ใช่เพิ่มต่อท้าย', async () => {
    const id = await makeItem('m3');
    await setFieldValues(ctx, id, [
      { fieldId: f('spike_labels'), type: 'LABELS', value: ['a', 'b', 'c'] },
    ]);
    await setFieldValues(ctx, id, [{ fieldId: f('spike_labels'), type: 'LABELS', value: ['x'] }]);
    expect((await readFieldValues(ctx, id))['spike_labels']).toEqual(['x']);

    const rows = await prismaClient.workItemFieldValue.count({
      where: { workItemId: id, fieldId: f('spike_labels') },
    });
    expect(rows, 'ต้องเหลือแถวเดียว ไม่ใช่ 4 แถว').toBe(1);
  });

  it('ตั้งค่าเป็นรายการว่างต้องลบทุกแถวของฟิลด์นั้น', async () => {
    const id = await makeItem('m4');
    await setFieldValues(ctx, id, [{ fieldId: f('spike_labels'), type: 'LABELS', value: ['a', 'b'] }]);
    await setFieldValues(ctx, id, [{ fieldId: f('spike_labels'), type: 'LABELS', value: [] }]);
    expect((await readFieldValues(ctx, id))['spike_labels']).toBeUndefined();
  });
});

describe('Spike B · 3 · ความสอดคล้องของ snapshot (หัวใจของ ADR-001)', () => {
  it('snapshot ตรงกับ EAV ทันทีหลังเขียน', async () => {
    const id = await makeItem('s1');
    await setFieldValues(ctx, id, [
      { fieldId: f('spike_text'), type: 'TEXT', value: 'ค่าเริ่มต้น' },
      { fieldId: f('spike_number'), type: 'NUMBER', value: 7 },
    ]);
    const item = await prismaClient.workItem.findUniqueOrThrow({ where: { id } });
    expect(item.fieldSnapshot).toMatchObject({ spike_text: 'ค่าเริ่มต้น', spike_number: 7 });
  });

  it('ตัวตรวจสอบรายงานว่าสอดคล้องเมื่อไม่มีใครไปแก้ snapshot', async () => {
    const id = await makeItem('s2');
    await setFieldValues(ctx, id, [{ fieldId: f('spike_text'), type: 'TEXT', value: 'ปกติ' }]);
    const report = await checkSnapshotConsistency(ctx, [id]);
    expect(report.mismatched).toEqual([]);
  });

  it('ตัวตรวจสอบจับได้เมื่อ snapshot เพี้ยนจาก EAV', async () => {
    const id = await makeItem('s3');
    await setFieldValues(ctx, id, [{ fieldId: f('spike_text'), type: 'TEXT', value: 'ค่าจริง' }]);

    // จำลองความเสียหาย — เขียน snapshot ตรง ๆ โดยไม่ผ่าน service
    await prismaClient.workItem.update({
      where: { id },
      data: { fieldSnapshot: { spike_text: 'ค่าที่เพี้ยน' } },
    });

    const report = await checkSnapshotConsistency(ctx, [id]);
    expect(report.mismatched).toContain(id.toString());
  });

  it('rebuild snapshot จาก EAV ได้ — EAV คือแหล่งความจริงเสมอ', async () => {
    const id = await makeItem('s4');
    await setFieldValues(ctx, id, [{ fieldId: f('spike_text'), type: 'TEXT', value: 'ของแท้' }]);
    await prismaClient.workItem.update({ where: { id }, data: { fieldSnapshot: { spike_text: 'ขยะ' } } });

    await rebuildSnapshot(ctx, [id]);

    const item = await prismaClient.workItem.findUniqueOrThrow({ where: { id } });
    expect(item.fieldSnapshot).toMatchObject({ spike_text: 'ของแท้' });
    expect((await checkSnapshotConsistency(ctx, [id])).mismatched).toEqual([]);
  });

  it('เขียนล้มกลางทาง → ทั้ง EAV และ snapshot ต้องไม่เปลี่ยน', async () => {
    const id = await makeItem('s5');
    await setFieldValues(ctx, id, [{ fieldId: f('spike_text'), type: 'TEXT', value: 'ก่อนล้ม' }]);

    await expect(
      setFieldValues(ctx, id, [
        { fieldId: f('spike_text'), type: 'TEXT', value: 'หลังล้ม' },
        // fieldId ที่ไม่มีจริง — ทำให้ทรานแซกชันล้ม
        { fieldId: 999_999_999n, type: 'TEXT', value: 'พัง' },
      ]),
    ).rejects.toThrow();

    expect((await readFieldValues(ctx, id))['spike_text']).toBe('ก่อนล้ม');
    const item = await prismaClient.workItem.findUniqueOrThrow({ where: { id } });
    expect(item.fieldSnapshot).toMatchObject({ spike_text: 'ก่อนล้ม' });
  });
});

describe('Spike B · 4 · ตัวเลขที่ตัดสิน ADR-001', () => {
  it('อ่านลิสต์ 50 แถว × 12 ฟิลด์: snapshot ต้องเร็วกว่า JOIN EAV อย่างมีนัยสำคัญ', async () => {
    const FIELDS = [
      'spike_text', 'spike_textarea', 'spike_richtext', 'spike_number',
      'spike_decimal', 'spike_date', 'spike_datetime', 'spike_checkbox',
      'spike_select', 'spike_user', 'spike_url', 'spike_labels',
    ];

    const ids: bigint[] = [];
    for (let i = 0; i < 50; i += 1) {
      const id = await makeItem(`p${String(i).padStart(3, '0')}`);
      ids.push(id);
      await setFieldValues(
        ctx,
        id,
        FIELDS.map((key): FieldValueInput => {
          const fid = f(key);
          if (key === 'spike_number') return { fieldId: fid, type: 'NUMBER', value: i };
          if (key === 'spike_decimal') return { fieldId: fid, type: 'DECIMAL', value: i + 0.5 };
          if (key === 'spike_checkbox') return { fieldId: fid, type: 'CHECKBOX', value: i % 2 === 0 };
          if (key === 'spike_date') return { fieldId: fid, type: 'DATE', value: '2026-08-24' };
          if (key === 'spike_datetime')
            return { fieldId: fid, type: 'DATETIME', value: '2026-08-24T09:30:00.000Z' };
          if (key === 'spike_user') return { fieldId: fid, type: 'USER', value: userAId };
          if (key === 'spike_labels')
            return { fieldId: fid, type: 'LABELS', value: ['หนึ่ง', 'สอง'] };
          return { fieldId: fid, type: 'TEXT', value: `ค่าของ ${key} แถวที่ ${i}` };
        }),
      );
    }

    const time = async (fn: () => Promise<unknown>): Promise<number> => {
      await fn(); // warm up
      const t0 = performance.now();
      for (let r = 0; r < 5; r += 1) await fn();
      return (performance.now() - t0) / 5;
    };

    const viaSnapshot = await time(async () => {
      await prismaClient.workItem.findMany({
        where: { id: { in: ids } },
        select: { id: true, itemKey: true, summary: true, fieldSnapshot: true },
      });
    });

    const viaEav = await time(async () => {
      const rows = await prismaClient.workItem.findMany({
        where: { id: { in: ids } },
        select: { id: true, itemKey: true, summary: true },
      });
      const values = await prismaClient.workItemFieldValue.findMany({
        where: { workItemId: { in: ids } },
        include: { field: { select: { key: true, type: true } } },
      });
      // ประกอบกลับเป็นรูปเดียวกับ snapshot
      const grouped = new Map<string, Record<string, unknown>>();
      for (const v of values) {
        const bucket = grouped.get(v.workItemId.toString()) ?? {};
        bucket[v.field.key] = v.valueText ?? v.valueNumber ?? v.valueBool ?? v.valueDate;
        grouped.set(v.workItemId.toString(), bucket);
      }
      return rows.map((r) => ({ ...r, fields: grouped.get(r.id.toString()) ?? {} }));
    });

    const eavRows = await prismaClient.workItemFieldValue.count({
      where: { workItemId: { in: ids } },
    });

    // eslint-disable-next-line no-console -- ตัวเลขนี้คือสิ่งที่ตัดสิน ADR-001 ต้องเห็นใน CI
    console.log(
      `    ADR-001: snapshot ${viaSnapshot.toFixed(1)} ms · EAV ${viaEav.toFixed(1)} ms · ` +
        `เร็วกว่า ${(viaEav / viaSnapshot).toFixed(1)}x · EAV ${eavRows} แถวสำหรับ 50 งาน`,
    );

    expect(viaSnapshot).toBeLessThan(viaEav);
    // ถ้าต่างน้อยกว่า 1.5 เท่า ความซับซ้อนของการดูแลสองที่ไม่คุ้ม — ADR-001 ต้องทบทวน
    expect(
      viaEav / viaSnapshot,
      'snapshot เร็วกว่าไม่ถึง 1.5 เท่า — ADR-001 อาจซับซ้อนเกินความจำเป็น',
    ).toBeGreaterThan(1.5);
  }, 300_000);
});
