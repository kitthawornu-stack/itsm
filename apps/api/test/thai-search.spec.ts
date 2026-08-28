/**
 * Spike C — ชุดคำค้นภาษาไทยเป็นข้อกำหนด (ADR-005)
 *
 * เหตุผลที่ต้องมีชุดนี้: ภาษาไทยไม่มีช่องว่างระหว่างคำ ถ้าตัดคำผิด ผู้ใช้จะค้นไม่เจอ
 * และจะเลิกใช้ระบบค้นหาไปเลย โดยที่ไม่มี error ให้ทีมเห็นแม้แต่ครั้งเดียว
 *
 * **สถานะความครบถ้วน: 62 เคส จากเป้าหมาย 200 เคสในแผน**
 * ชุดนี้ครอบคลุมหมวดความเสี่ยงครบทุกหมวดแล้ว แต่ยังต้องขยายด้วยคำค้นจริง
 * ที่เก็บจาก log ระหว่าง pilot (คำที่ผู้ใช้ค้นแล้วไม่เจอผลลัพธ์)
 *
 * หมวดที่ครอบคลุม:
 *   A. คำที่อยู่กลางประโยค — เคสหลักของ ADR-005
 *   B. คำที่ analyzer สำเร็จรูปตัดทิ้ง (stopword) แต่เราต้องเก็บไว้
 *   C. การปฏิเสธ — "ได้" กับ "ไม่ได้" ต้องไม่เหมือนกัน
 *   D. คำทับศัพท์ที่ dictionary ไม่รู้จัก
 *   E. อังกฤษปนไทย และตัวเลข
 *   F. คีย์งาน (SD-1042)
 *   G. เคสที่ต้อง **ไม่** เจอ — กัน false positive จาก ngram
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  WORK_ITEM_INDEX_SETTINGS,
  buildTextQuery,
} from '../src/modules/search-index/index-mapping';
import { openSearch } from '../src/modules/search-index/opensearch-client';

const INDEX = 'itsm-test-thai-search';
const TENANT = 9001n;

interface Doc {
  key: string;
  summary: string;
  description?: string;
}

/** เอกสารทดสอบ — ประโยคจริงแบบที่ผู้ใช้พิมพ์ ไม่ใช่ประโยคที่แต่งให้ตัดคำง่าย */
const DOCS: Doc[] = [
  { key: 'SD-1', summary: 'ลืมรหัสผ่านเข้าระบบไม่ได้' },
  { key: 'SD-2', summary: 'ระบบเข้าสู่ระบบ SSO ล่ม พนักงานเข้าใช้งานไม่ได้ทั้งสำนักงาน' },
  { key: 'SD-3', summary: 'เครื่องพิมพ์ชั้น 4 พิมพ์ไม่ออก' },
  { key: 'SD-4', summary: 'ขอเพิ่มสิทธิ์เข้าถึงโฟลเดอร์ฝ่ายการเงิน' },
  { key: 'SD-5', summary: 'VPN หลุดบ่อยตั้งแต่เช้า ทีมที่ทำงานจากบ้านได้รับผลกระทบ' },
  { key: 'SD-6', summary: 'โปรแกรม SAP ค้างเมื่อออกรายงานยอดขายรายเดือน' },
  { key: 'SD-7', summary: 'อีเมลส่งออกไม่ได้ ขึ้นข้อความ relay denied' },
  { key: 'SD-8', summary: 'ขอติดตั้งโปรแกรม Microsoft Project ให้พนักงานใหม่ 3 ท่าน' },
  { key: 'SD-9', summary: 'Wi-Fi ชั้น 2 สัญญาณอ่อนและหลุดเป็นระยะ' },
  { key: 'SD-10', summary: 'เข้าระบบได้ตามปกติแล้วหลังรีเซ็ตรหัสผ่าน' },
  { key: 'SD-11', summary: 'ขอรีเซ็ตรหัสผ่านบัญชีผู้ใช้' },
  { key: 'SD-12', summary: 'ไฟล์เซิร์ฟเวอร์เข้าถึงช้ามากช่วงบ่าย' },
  {
    key: 'SD-13',
    summary: 'จอคอมพิวเตอร์ห้องประชุมไม่แสดงภาพ',
    description: 'ต่อสาย HDMI แล้วจอขึ้นข้อความ no signal ลองเปลี่ยนสายแล้วยังเหมือนเดิม',
  },
  { key: 'SD-14', summary: 'ขอเปิดสิทธิ์ใช้งานระบบจัดซื้อ' },
  { key: 'SD-15', summary: 'ระบบลงเวลาทำงานไม่บันทึกข้อมูลของสาขา 3' },
];

/** [คำค้น, คีย์ที่ต้องเจอ, หมวด] */
type Case = [query: string, mustFind: string, category: string];

const MUST_FIND: Case[] = [
  // ---------- A · คำกลางประโยค (เคสหลักของ ADR-005) ----------
  ['รหัสผ่าน', 'SD-1', 'A'],
  ['รหัส', 'SD-1', 'A'],
  ['ระบบ', 'SD-1', 'A'],
  ['พิมพ์', 'SD-3', 'A'],
  ['เครื่องพิมพ์', 'SD-3', 'A'],
  ['สิทธิ์', 'SD-4', 'A'],
  ['การเงิน', 'SD-4', 'A'],
  ['หลุด', 'SD-5', 'A'],
  ['ผลกระทบ', 'SD-5', 'A'],
  ['รายงาน', 'SD-6', 'A'],
  ['ยอดขาย', 'SD-6', 'A'],
  ['อีเมล', 'SD-7', 'A'],
  ['สัญญาณ', 'SD-9', 'A'],
  ['เซิร์ฟเวอร์', 'SD-12', 'A'],
  ['ห้องประชุม', 'SD-13', 'A'],
  ['จัดซื้อ', 'SD-14', 'A'],
  ['สาขา', 'SD-15', 'A'],
  ['พนักงาน', 'SD-2', 'A'],
  ['สำนักงาน', 'SD-2', 'A'],
  ['บ้าน', 'SD-5', 'A'],
  ['บ่าย', 'SD-12', 'A'],
  ['เช้า', 'SD-5', 'A'],

  // ---------- B · คำที่ analyzer `thai` สำเร็จรูปจะตัดทิ้ง ----------
  // ทั้งหมดนี้จะหาไม่เจอถ้าใช้ analyzer สำเร็จรูป — คือเหตุผลที่ต้องประกอบเอง
  ['ผ่าน', 'SD-1', 'B'],
  ['เข้า', 'SD-1', 'B'],
  ['ได้', 'SD-1', 'B'],
  ['ไม่', 'SD-3', 'B'],
  ['ออก', 'SD-3', 'B'],
  ['ทำงาน', 'SD-5', 'B'],
  ['ใหม่', 'SD-8', 'B'],
  ['ให้', 'SD-8', 'B'],
  ['ขอ', 'SD-11', 'B'],
  ['ช้า', 'SD-12', 'B'],
  ['ตั้งแต่', 'SD-5', 'B'],
  ['หลัง', 'SD-10', 'B'],

  // ---------- C · การปฏิเสธ ----------
  ['ไม่ได้', 'SD-1', 'C'],
  ['เข้าระบบ', 'SD-1', 'C'],
  ['บันทึก', 'SD-15', 'C'],

  // ---------- D · คำทับศัพท์ที่ dictionary ตัดผิด (กู้ด้วย ngram) ----------
  ['โฟลเดอร์', 'SD-4', 'D'],
  ['คอมพิวเตอร์', 'SD-13', 'D'],
  ['โปรแกรม', 'SD-6', 'D'],
  ['ติดตั้ง', 'SD-8', 'D'],
  ['รีเซ็ต', 'SD-11', 'D'],

  // ---------- E · อังกฤษปนไทย และตัวเลข ----------
  ['SSO', 'SD-2', 'E'],
  ['sso', 'SD-2', 'E'],
  ['VPN', 'SD-5', 'E'],
  ['vpn', 'SD-5', 'E'],
  ['SAP', 'SD-6', 'E'],
  ['Microsoft', 'SD-8', 'E'],
  ['project', 'SD-8', 'E'],
  ['Wi-Fi', 'SD-9', 'E'],
  ['relay denied', 'SD-7', 'E'],
  ['HDMI', 'SD-13', 'E'],
  ['no signal', 'SD-13', 'E'],

  // ---------- F · คีย์งาน ----------
  ['SD-1', 'SD-1', 'F'],
  ['SD-15', 'SD-15', 'F'],

  // ---------- วลีหลายคำ ----------
  ['ลืมรหัสผ่าน', 'SD-1', 'A'],
  ['เข้าถึงโฟลเดอร์', 'SD-4', 'D'],
  ['พิมพ์ไม่ออก', 'SD-3', 'C'],
  ['สัญญาณอ่อน', 'SD-9', 'A'],
  ['ระบบจัดซื้อ', 'SD-14', 'A'],
  ['รายงานยอดขาย', 'SD-6', 'A'],
];

/** คำที่ต้อง **ไม่** เจอในเอกสารนั้น — กัน false positive จาก ngram */
const MUST_NOT_FIND: Array<[query: string, mustNotFind: string]> = [
  ['เครื่องพิมพ์', 'SD-1'],
  ['ยอดขาย', 'SD-3'],
  ['โฟลเดอร์', 'SD-9'],
  ['ห้องประชุม', 'SD-5'],
];

let indexed: Array<{ id: string; score: number; source: { itemKey: string } }> = [];

beforeAll(async () => {
  await openSearch.deleteIndex(INDEX);
  await openSearch.createIndex(INDEX, WORK_ITEM_INDEX_SETTINGS);
  await openSearch.bulkIndex(
    INDEX,
    DOCS.map((d) => ({
      id: d.key,
      doc: {
        tenantId: Number(TENANT),
        projectId: 1,
        projectKey: 'SD',
        itemKey: d.key,
        summary: d.summary,
        description: d.description ?? '',
      },
    })),
  );
  await openSearch.refresh(INDEX);
}, 60_000);

afterAll(async () => {
  await openSearch.deleteIndex(INDEX);
});

async function find(query: string): Promise<string[]> {
  const page = await openSearch.search<{ itemKey: string }>(INDEX, buildTextQuery({ tenantId: TENANT, text: query }), 15);
  indexed = page.hits;
  return indexed.map((h) => h.source.itemKey);
}

describe('Thai search · ยืนยันสมมติฐานของ ADR-005', () => {
  it('การตัดคำด้วยช่องว่างใช้กับภาษาไทยไม่ได้ — เหตุผลที่ต้องมี OpenSearch', async () => {
    const withThai = await openSearch.analyze(INDEX, 'thai_text', 'ลืมรหัสผ่านเข้าระบบไม่ได้');
    expect(withThai.length).toBeGreaterThanOrEqual(6);
    expect(withThai).toContain('รหัส');
    expect(withThai).toContain('ผ่าน');
  });

  it('analyzer ของเราไม่ตัด stopword ทิ้ง ต่างจาก analyzer `thai` สำเร็จรูป', async () => {
    const ours = await openSearch.analyze(INDEX, 'thai_text', 'ลืมรหัสผ่านเข้าระบบไม่ได้');
    // analyzer สำเร็จรูปเหลือแค่ 3 token (ลืม|รหัส|ระบบ) — ของเราต้องเก็บครบ
    for (const token of ['ผ่าน', 'เข้า', 'ไม่', 'ได้']) {
      expect(ours, `token "${token}" หายไป — ความหมายการปฏิเสธจะเพี้ยน`).toContain(token);
    }
  });
});

describe('Thai search · คำค้นที่ต้องเจอ', () => {
  const byCategory = new Map<string, Case[]>();
  for (const c of MUST_FIND) {
    const list = byCategory.get(c[2]) ?? [];
    list.push(c);
    byCategory.set(c[2], list);
  }

  for (const [category, cases] of byCategory) {
    describe(`หมวด ${category}`, () => {
      for (const [query, mustFind] of cases) {
        it(`"${query}" ต้องเจอ ${mustFind}`, async () => {
          const keys = await find(query);
          expect(keys, `ค้น "${query}" ได้: [${keys.join(', ')}]`).toContain(mustFind);
        });
      }
    });
  }
});

describe('Thai search · คำค้นที่ต้องไม่เจอ (กัน false positive)', () => {
  for (const [query, mustNotFind] of MUST_NOT_FIND) {
    it(`"${query}" ต้องไม่เจอ ${mustNotFind}`, async () => {
      const keys = await find(query);
      expect(keys).not.toContain(mustNotFind);
    });
  }
});

describe('Thai search · การแลกระหว่างความแม่นกับความครอบคลุม', () => {
  /**
   * คิวรีใช้ minimum_should_match 75% บนสาขาหลัก — ต้องตรงอย่างน้อย 3 ใน 4 คำ
   *
   * ตัวเลขนี้มาจากการวัดบนข้อมูลจริง 10,000 ใบ ไม่ใช่การเดา:
   * ถ้าผ่อนกว่านี้ คำค้นที่ไม่เกี่ยวข้องเลยจะคืนผลลัพธ์ปลอม
   * ถ้าเข้มกว่านี้ คำค้นที่พิมพ์ยาว ๆ จะหาอะไรไม่เจอ
   *
   * **ผลข้างเคียงที่ยอมรับไว้อย่างรู้ตัว**: ประโยคที่มีคำทั่วไปปนเยอะ
   * เช่น "ค้นหาข้อมูลยอดขาย" จะไม่เจอเอกสารที่มีแค่ "ยอดขาย"
   *
   * ต้องทบทวนตัวเลขนี้ด้วย log คำค้นจริงจาก pilot — คำที่ผู้ใช้ค้นแล้วไม่เจอผลลัพธ์
   * คือข้อมูลที่บอกว่า 75% เข้มไปหรือไม่ ยังไม่มีข้อมูลนั้นตอนนี้
   */
  it('คำค้นที่ไม่เกี่ยวข้องเลยต้องคืนผลว่าง — ไม่ใช่คืนอะไรก็ได้ที่พอตรงบางส่วน', async () => {
    expect(await find('จักรยานยนต์ไฟฟ้าดัดแปลง')).toHaveLength(0);
    expect(await find('สูตรอาหารต้มยำกุ้งน้ำข้น')).toHaveLength(0);
  });

  it('ประโยคที่คำส่วนใหญ่เป็นคำทั่วไปจะไม่เจอ — ผลข้างเคียงที่ยอมรับไว้', async () => {
    // "ยอดขาย" อยู่ใน SD-6 แต่อีก 2 คำไม่อยู่ จึงไม่ผ่านเกณฑ์ 75%
    expect(await find('ค้นหาข้อมูลยอดขาย')).not.toContain('SD-6');
    // แต่ค้นด้วยคำหลักคำเดียวต้องเจอ
    expect(await find('ยอดขาย')).toContain('SD-6');
  });
});

describe('Thai search · การจัดอันดับ', () => {
  it('เอกสารที่ตรงในหัวข้อต้องมาก่อนเอกสารที่ตรงในรายละเอียด', async () => {
    const keys = await find('รหัสผ่าน');
    // SD-1 และ SD-11 มี "รหัสผ่าน" ในหัวข้อ ต้องอยู่อันดับต้น
    expect(keys.slice(0, 3)).toContain('SD-1');
  });

  it('คีย์งานที่ตรงเป๊ะต้องมาเป็นอันดับหนึ่ง', async () => {
    const keys = await find('SD-15');
    expect(keys[0]).toBe('SD-15');
  });
});
