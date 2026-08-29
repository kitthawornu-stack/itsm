/**
 * ป้ายกำกับ — ค้นหาได้จริง
 *
 * `LABELS` ประกาศไว้ **สามที่** มาตั้งแต่ Phase 0: `FieldType` ในสคีมา ·
 * `labels: { type: 'keyword' }` ใน mapping ของดัชนี · และตัวจัดการชนิดใน
 * `field.service.ts` · **แต่ไม่มีอะไรเขียนค่าลงดัชนี และ HQL ไม่รู้จักคำว่า
 * `label` เลย** — ป้ายจึงกรอกได้แต่ค้นไม่เจอ ซึ่งเป็นรูปแบบที่โครงการนี้
 * เจอซ้ำที่สุด
 *
 * สามข้อที่ต้องพิสูจน์:
 *
 *   1. **ค่าที่กรอกต้องไปถึงดัชนีจริง** — ไม่ใช่แค่ประกอบ document ถูก
 *      ต้องยิงคิวรีเข้า OpenSearch แล้วเจอ
 *   2. **`keyword` ต้องตรงทั้งคำ** — `label = "เครือข่าย"` ต้องไม่ไปเจอ
 *      "เครือข่ายภายใน" ซึ่งเป็นคนละป้ายที่คนตั้งใจให้ต่างกัน
 *   3. **ค่าว่างต้องไม่เข้าดัชนี** — ป้ายว่างทำให้ตัวกรองนับใบที่ไม่มีป้าย
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { setFieldValues } from '../src/modules/field';
import {
  ensureIndex,
  indexWorkItem,
  searchByHql,
} from '../src/modules/search-index/indexer.service';
import { workItemIndexName } from '../src/modules/search-index/index-mapping';
import { openSearch } from '../src/modules/search-index/opensearch-client';

const STAMP = String(Date.now()).slice(-6);
/** ป้ายที่ไม่มีทางชนกับข้อมูลจริง */
const NET = `เครือข่าย${STAMP}`;
const NET_INNER = `เครือข่ายภายใน${STAMP}`;

let ctx: TenantContext;
let tenantId: bigint;
let projectId: bigint;
let fieldId: bigint | undefined;
/** ฟิลด์ข้อความธรรมดา — ค่าของมันต้องไม่รั่วไปอยู่ในป้าย */
let textFieldId: bigint | undefined;
const keys: string[] = [];
/** ค่าของฟิลด์ข้อความ ที่ต้องไม่ถูกค้นเจอด้วย `label =` */
const NOT_A_LABEL = `ข้อความธรรมดา${STAMP}`;

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  tenantId = tenant.id;
  ctx = { tenantId, actorId: null };

  const project = await prismaClient.project.findFirstOrThrow({ where: { key: 'SD' } });
  projectId = project.id;

  /*
    ฟิลด์ชนิด LABELS ของตัวเอง — ไม่ยืมฟิลด์ "ส่วนประกอบ" ที่มีอยู่
    เพราะการเขียนค่าลงฟิลด์ของ seed จะไปโผล่บนงานจริง
  */
  const f = await prismaClient.fieldDefinition.create({
    data: { tenantId, key: `lbl${STAMP}`, name: `ป้ายทดสอบ ${STAMP}`, type: 'LABELS' },
    select: { id: true },
  });
  fieldId = f.id;

  /*
    ฟิลด์ชนิด TEXT — มีไว้พิสูจน์ว่าตัวดึงป้ายเลือกเฉพาะฟิลด์ชนิด LABELS

    ถ้าไม่มีฟิลด์ชนิดอื่นในงานทดสอบเลย การลบตัวกรองชนิดออกจะไม่เปลี่ยนอะไร
    และเทสต์จะเขียวทั้งที่กลไกหายไป (พิสูจน์แล้วในรอบลบทีละบรรทัด)
  */
  const tf = await prismaClient.fieldDefinition.create({
    data: { tenantId, key: `txt${STAMP}`, name: `ข้อความทดสอบ ${STAMP}`, type: 'TEXT' },
    select: { id: true },
  });
  textFieldId = tf.id;

  const template = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId },
    select: { issueTypeId: true, statusId: true, reporterId: true },
  });
  const mk = async (suffix: string): Promise<bigint> => {
    const w = await prismaClient.workItem.create({
      data: {
        tenantId,
        projectId,
        itemKey: `SD-LBL${STAMP}${suffix}`,
        issueTypeId: template.issueTypeId,
        statusId: template.statusId,
        reporterId: template.reporterId,
        summary: `งานทดสอบป้าย ${suffix} ${STAMP}`,
        rank: `zzq${STAMP}${suffix}`,
      },
      select: { id: true, itemKey: true },
    });
    keys.push(w.itemKey);
    return w.id;
  };

  const a = await mk('A');
  const b = await mk('B');
  const c = await mk('C');

  /*
    ดัชนีต้องมีอยู่ก่อน — **ไฟล์นี้สร้างเอง ไม่หวังว่าจะมีคนสร้างไว้ให้**

    `search-indexer.spec.ts` ลบดัชนีทิ้งใน `afterAll` · ไฟล์ที่รันทีหลัง
    จึงไม่มีดัชนีให้ใช้ และเคยทำให้ทั้งไฟล์เขียวโดยไม่ได้ยิงคิวรีสักครั้ง
    (CLAUDE.md §9 — เทสต์ที่ตรวจไม่ได้ต้องแดงหรือ skip ห้ามเขียว)
  */
  await ensureIndex(tenantId);

  await setFieldValues(ctx, a, [
    { fieldId: f.id, type: 'LABELS', value: [NET, 'ด่วน'] },
    // ค่าของฟิลด์ข้อความบนใบเดียวกัน — ต้องไม่รั่วไปเป็นป้าย
    { fieldId: tf.id, type: 'TEXT', value: NOT_A_LABEL },
  ]);
  await setFieldValues(ctx, b, [{ fieldId: f.id, type: 'LABELS', value: [NET_INNER] }]);
  /*
    ใบที่สาม: ค่าว่างล้วน กับค่าที่มีช่องว่างหัวท้าย

    ค่าที่สองพิสูจน์การ trim ได้จริง · เดิมทดสอบด้วยการค้นหา `label = " "`
    ซึ่งไม่พิสูจน์อะไรเลย เพราะ `"   ".trim()` ได้ `""` ไม่ใช่ `" "`
    — ลบการ trim ทิ้งแล้วเทสต์ก็ยังเขียว
  */
  await setFieldValues(ctx, c, [
    { fieldId: f.id, type: 'LABELS', value: ['   ', '', `  มีช่องว่าง${STAMP}  `] },
  ]);

  for (const id of [a, b, c]) await indexWorkItem(ctx, id);
}, 300_000);

afterAll(async () => {
  await step('ค่าฟิลด์', () =>
    prismaClient.workItemFieldValue.deleteMany({
      where: { fieldId: { in: [fieldId, textFieldId].filter((v) => v !== undefined) } },
    }),
  );
  await step('งานทดสอบ', () => prismaClient.workItem.deleteMany({ where: { itemKey: { in: keys } } }));
  await step('ฟิลด์', () =>
    prismaClient.fieldDefinition.deleteMany({
      where: { id: { in: [fieldId, textFieldId].filter((v) => v !== undefined) } },
    }),
  );
  await prismaClient.$disconnect();
});

describe('A · ค่าที่กรอกไปถึงดัชนีจริง', () => {
  it('**ค้นด้วย `label = ...` แล้วเจอใบที่ติดป้ายนั้น**', async () => {
    /*
      เคสที่ทั้งไฟล์นี้มีไว้เพื่อพิสูจน์ · ยิงเข้า OpenSearch จริง ไม่ใช่ตรวจว่า
      ประกอบ document ถูก — คิวรีที่ชี้ไปฟิลด์ที่ไม่มีในดัชนีไม่ใช่ error
      มันแค่คืนศูนย์ผลลัพธ์ ซึ่งดูเหมือน "ไม่มีข้อมูลตรงเงื่อนไข"
    */
    const r = await searchByHql(ctx, `label = "${NET}"`, [projectId], 20);
    expect(r.hits.map((x) => x.itemKey)).toEqual([`SD-LBL${STAMP}A`]);
  });

  it('ป้ายที่สองของใบเดียวกันก็ค้นเจอ', async () => {
    const r = await searchByHql(ctx, `label = "ด่วน"`, [projectId], 20);
    expect(r.hits.some((x) => x.itemKey === `SD-LBL${STAMP}A`)).toBe(true);
  });
});

describe('B · ตรงทั้งคำ ไม่ใช่ตรงบางส่วน', () => {
  it('**`เครือข่าย` ต้องไม่ไปเจอ `เครือข่ายภายใน`**', async () => {
    /*
      ป้ายเป็นคำที่คนเลือกใช้ซ้ำ ๆ ไม่ใช่ประโยค · คนตั้งชื่อสองป้ายนี้
      ตั้งใจให้ต่างกัน · ถ้าตรงบางส่วน ตัวกรองจะรวมสองกลุ่มเข้าด้วยกัน
      แล้วคนอ่านจะไม่รู้เลยว่าตัวเลขที่เห็นนับอะไรบ้าง
    */
    const r = await searchByHql(ctx, `label = "${NET}"`, [projectId], 20);
    expect(r.hits.some((x) => x.itemKey === `SD-LBL${STAMP}B`)).toBe(false);

    const inner = await searchByHql(ctx, `label = "${NET_INNER}"`, [projectId], 20);
    expect(inner.hits.map((x) => x.itemKey)).toEqual([`SD-LBL${STAMP}B`]);
  });
});

describe('C · ตัดช่องว่างและทิ้งค่าว่าง', () => {
  it('**ค่าที่มีช่องว่างหัวท้าย ต้องค้นเจอด้วยชื่อที่ตัดแล้ว**', async () => {
    /*
      พิสูจน์การ trim ตรง ๆ · เดิมทดสอบด้วย `label = " "` ซึ่งไม่พิสูจน์อะไรเลย
      เพราะ `"   ".trim()` ได้ `""` ไม่ใช่ `" "` — ลบการ trim ทิ้งแล้วก็ยังเขียว
    */
    const r = await searchByHql(ctx, `label = "มีช่องว่าง${STAMP}"`, [projectId], 20);
    expect(r.hits.map((x) => x.itemKey)).toEqual([`SD-LBL${STAMP}C`]);
  });

  it('**ค่าว่างไม่เข้าดัชนีเลย — อ่านจากเอกสารในดัชนีตรง ๆ**', async () => {
    /*
      ถามดัชนีว่าเก็บป้ายไว้กี่ค่า แทนที่จะถามผ่าน HQL

      รอบแรกเขียนว่า `label = ""` แล้วคาดว่าไม่เจอ · แต่มันเจอใบนั้น เพราะ
      HQL แปล `= ""` เป็นเงื่อนไขคนละอย่าง (มี node ชนิด `empty` แยกอยู่แล้ว)
      — เทสต์นั้นจึงวัดพฤติกรรมของภาษาคิวรี ไม่ได้วัดตัวจัดดัชนีที่กำลังพิสูจน์

      ป้ายว่างในดัชนีทำให้ตัวกรอง "มีป้าย" นับใบที่ไม่มีป้าย และการนับที่เกินจริง
      ในรายงานอ่านเหมือนข้อเท็จจริง โดยไม่มีอะไรบอกว่าผิด
    */
    const res = await openSearch.search<{ labels?: string[] }>(
      workItemIndexName(tenantId),
      // `search` ส่ง body ทั้งก้อน ไม่ได้ห่อ `query` ให้ — ต้องใส่เอง
      { query: { term: { itemKey: `SD-LBL${STAMP}C` } } },
      5,
    );
    const doc = res.hits[0]?.source;
    // สามค่าที่กรอกไป: "   " · "" · "  มีช่องว่าง…  " — เหลือค่าเดียวหลังตัดและทิ้งว่าง
    expect(doc?.labels).toEqual([`มีช่องว่าง${STAMP}`]);
  });
});

describe('D · เอาเฉพาะฟิลด์ชนิด LABELS', () => {
  it('**ค่าของฟิลด์ข้อความ ต้องไม่กลายเป็นป้าย**', async () => {
    /*
      ตัวดึงป้ายอ่านจาก `fieldSnapshot` ซึ่งมีค่าของ **ทุกฟิลด์** ของงานใบนั้น ·
      ถ้าไม่กรองด้วยชนิด ค่าของฟิลด์ข้อความจะกลายเป็นป้ายไปด้วย แล้วตัวกรอง
      ป้ายจะเจอสิ่งที่ไม่มีใครติดป้ายไว้ — และไม่มีอะไรบอกว่ามันผิด
    */
    const r = await searchByHql(ctx, `label = "${NOT_A_LABEL}"`, [projectId], 20);
    expect(r.hits).toHaveLength(0);
  });
});
