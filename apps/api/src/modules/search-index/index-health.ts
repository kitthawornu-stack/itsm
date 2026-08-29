/**
 * ดัชนีค้นหายังใช้ได้อยู่ไหม
 *
 * ## เหตุการณ์ที่ทำให้ต้องมีไฟล์นี้
 *
 * ระหว่าง QA ดัชนีหายไปหลัง Docker รีสตาร์ต · ทุกการค้นหาตอบ 503 · แต่
 * `/health` ยังตอบ `ok` ตลอด **เพราะมันเช็คคลัสเตอร์ ไม่ใช่ดัชนี** — และ
 * คลัสเตอร์ตอนนั้นปกติดีทุกอย่าง
 *
 * ตัวตรวจที่เช็คสิ่งที่ไม่พัง แล้วรายงานว่าปกติ อันตรายกว่าไม่มีตัวตรวจ
 * เพราะมันสร้างความมั่นใจที่ไม่มีมูล · คนแรกที่รู้ว่าค้นหาพังจึงเป็นผู้ใช้
 *
 * ## ทำไมเป็นฟังก์ชันบริสุทธิ์
 *
 * "ดัชนีหาย" กับ "ดัชนีว่างเพราะเพิ่งติดตั้ง" ต่างกันแค่ตัวเลขในฐานข้อมูล
 * ซึ่งเป็นการตัดสินใจที่ทดสอบได้โดยไม่ต้องมี OpenSearch จริง · การผูกมันไว้
 * กับการเรียกเครือข่าย แปลว่าเคสที่สำคัญที่สุดจะไม่มีใครทดสอบ
 */

export type IndexHealthState = 'up' | 'missing' | 'stale' | 'unreachable';

export interface IndexHealthInput {
  /** คลัสเตอร์ตอบไหม — `false` แปลว่าถามเรื่องดัชนีต่อไม่ได้ */
  clusterUp: boolean;
  /** ดัชนีของ tenant นี้มีอยู่ไหม — `null` เมื่อถามไม่ได้ */
  indexExists: boolean | null;
  /** จำนวนเอกสารในดัชนี — `null` เมื่อถามไม่ได้ */
  indexedDocs: number | null;
  /** จำนวนงานในฐานข้อมูล — แหล่งความจริง */
  itemsInDatabase: number;
}

export interface IndexHealth {
  state: IndexHealthState;
  /** ข้อความที่บอกว่าต้องทำอะไรต่อ ไม่ใช่แค่ว่าเกิดอะไรขึ้น */
  detail: string;
}

/** คำสั่งกู้คืน — เขียนไว้ที่เดียว เพื่อไม่ให้ข้อความในสองที่ต่างกัน */
export const REINDEX_HINT = 'กู้ด้วย `pnpm --filter @itsm/api reindex`';

/**
 * ตัดสินสถานะของดัชนี
 *
 * **"ว่างเพราะเพิ่งติดตั้ง" ต้องไม่ถูกรายงานว่าพัง** — ระบบที่เพิ่งขึ้นและยังไม่มี
 * งานสักใบ มีดัชนีว่างเป็นเรื่องถูกต้อง · การเตือนตรงนั้นทำให้คนเรียนรู้ว่า
 * คำเตือนนี้ไม่ต้องสนใจ แล้ววันที่มันเตือนจริงก็ไม่มีใครสนใจเหมือนกัน
 *
 * เกณฑ์จึงเทียบกับฐานข้อมูลเสมอ ไม่ใช่กับศูนย์
 */
export function judgeIndexHealth(input: IndexHealthInput): IndexHealth {
  if (!input.clusterUp) {
    return { state: 'unreachable', detail: 'ต่อ OpenSearch ไม่ได้ — การค้นหาทั้งหมดจะล้ม' };
  }
  if (input.indexExists !== true) {
    return {
      state: 'missing',
      detail: `ไม่มีดัชนีของงาน — การค้นหาทั้งหมดจะล้ม · ${REINDEX_HINT}`,
    };
  }

  const docs = input.indexedDocs ?? 0;
  if (input.itemsInDatabase === 0) {
    // ยังไม่มีงานสักใบ · ดัชนีว่างคือสิ่งที่ถูกต้อง ไม่ใช่ปัญหา
    return { state: 'up', detail: 'ยังไม่มีงานในระบบ' };
  }
  if (docs === 0) {
    return {
      state: 'missing',
      detail: `ดัชนีว่างเปล่าทั้งที่มีงาน ${String(input.itemsInDatabase)} ใบในฐานข้อมูล · ${REINDEX_HINT}`,
    };
  }

  /*
    ต่างกันเกินหนึ่งในสิบ = มีอะไรหลุด · เกณฑ์ไม่ใช่ศูนย์เพราะดัชนีตามหลัง
    ฐานข้อมูลได้เสมอเป็นเรื่องปกติ (งานที่เพิ่งสร้างยังไม่ถึงตัว indexer)
    การเตือนทุกครั้งที่ต่างกันหนึ่งใบ คือคำเตือนที่ไม่มีใครอ่าน
  */
  const gap = Math.abs(input.itemsInDatabase - docs);
  if (gap > Math.max(10, input.itemsInDatabase * 0.1)) {
    return {
      state: 'stale',
      detail:
        `ดัชนีมี ${String(docs)} รายการ แต่ฐานข้อมูลมี ${String(input.itemsInDatabase)} ใบ ` +
        `— ต่างกัน ${String(gap)} · ${REINDEX_HINT}`,
    };
  }

  return { state: 'up', detail: `ดัชนี ${String(docs)} รายการ` };
}

/** สถานะที่ต้องมีคนไปทำอะไรสักอย่าง — ใช้ตัดสินว่าจะบันทึกเป็นคำเตือนไหม */
export function needsAttention(state: IndexHealthState): boolean {
  return state !== 'up';
}
