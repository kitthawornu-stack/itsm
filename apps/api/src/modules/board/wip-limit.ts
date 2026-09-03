/**
 * เพดานงานที่ทำพร้อมกันของคอลัมน์บนกระดาน (WIP Limit)
 *
 * บอกทีมว่าคอลัมน์หนึ่งมีงานค้างเกินที่ตกลงกันไว้ · จุดประสงค์คือให้ปิดของเดิม
 * ก่อนหยิบของใหม่
 *
 * **เตือน ไม่ใช่ห้าม** — เพดานที่บล็อกการย้ายจะทำให้ทีมติดตาย: คอลัมน์ที่เต็ม
 * แปลว่าไม่มีใครดันงานไหนต่อได้เลย รวมถึงงานด่วนที่ต้องผ่านคอลัมน์นั้น ·
 * และคนที่ถูกบล็อกจะเปลี่ยนไปทำทางอื่น (แก้สถานะตรง ๆ · เปิดใบใหม่)
 * ซึ่งทำให้ตัวเลขบนกระดานเลิกตรงกับความจริง อันเป็นสิ่งเดียวที่เพดานนี้มีไว้วัด
 *
 * ฟังก์ชันบริสุทธิ์ทั้งไฟล์ · ไม่แตะฐานข้อมูล ไม่อ่านนาฬิกา
 */

/**
 * เพดานสูงสุดที่ตั้งได้
 *
 * เพดานที่ใหญ่กว่างานทั้งคอลัมน์จะมีจริงได้ ไม่ได้เตือนอะไรใครเลย —
 * มันแค่ทำให้หน้าตั้งค่าดูเหมือนตั้งไว้แล้ว ซึ่งแย่กว่าไม่ตั้ง
 */
export const WIP_LIMIT_MAX = 999;

/**
 * ค่าที่ตั้งเป็นเพดานได้หรือไม่
 *
 * **0 ตั้งไม่ได้** — ไม่ใช่เพราะคอลัมน์ที่ห้ามมีงานเลยไม่มีความหมาย
 * แต่เพราะ `0` กับ "ไม่ได้ตั้ง" ให้ผลเหมือนกันใน `if (!max)` · ถ้ายอมให้
 * เก็บ 0 ได้ วันหนึ่งจะมีคนเขียนเงื่อนไขแบบนั้น แล้วเพดานที่เข้มที่สุด
 * จะกลายเป็นไม่มีเพดานโดยไม่มีอะไรส่งเสียง
 */
export function isValidWipLimit(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= WIP_LIMIT_MAX;
}

/** เพดานของคอลัมน์หนึ่ง หลังยุบสถานะชื่อซ้ำเข้าด้วยกันแล้ว */
export type WipLimit =
  | { kind: 'none' }
  | { kind: 'limit'; max: number }
  /** สถานะที่ยุบเป็นคอลัมน์เดียวกัน ตั้งเพดานไว้ไม่ตรงกัน */
  | { kind: 'ambiguous'; values: number[] };

/** ผลการตัดสินของคอลัมน์หนึ่ง */
export type WipState =
  | { kind: 'no-limit'; count: number }
  | { kind: 'under'; count: number; max: number; remaining: number }
  | { kind: 'at'; count: number; max: number }
  | { kind: 'over'; count: number; max: number; excess: number }
  | { kind: 'ambiguous'; count: number; values: number[] };

/**
 * เพดานของคอลัมน์ที่ยุบมาจากหลายสถานะ
 *
 * กระดานยุบสถานะชื่อซ้ำจากหลาย workflow ให้เป็นคอลัมน์เดียว (ชนิดงานละเรือน
 * แต่ชื่อสถานะเดียวกัน) · ถ้าสถานะเหล่านั้นตั้งเพดานไม่ตรงกัน **ห้ามเลือก
 * มาอันหนึ่งเงียบ ๆ** เพราะครึ่งหนึ่งของทีมจะอ่านเพดานที่ไม่ได้ใช้จริง
 * — กติกาเดียวกับขอบเขตของ Scrum ที่มีหลายรอบเปิดพร้อมกัน
 */
export function wipLimitOf(statusIds: readonly string[], limits: ReadonlyMap<string, number>): WipLimit {
  const found: number[] = [];
  for (const id of statusIds) {
    const v = limits.get(id);
    if (v !== undefined) found.push(v);
  }
  if (found.length === 0) return { kind: 'none' };
  const distinct = [...new Set(found)].sort((a, b) => a - b);
  const only = distinct[0];
  if (distinct.length === 1 && only !== undefined) return { kind: 'limit', max: only };
  return { kind: 'ambiguous', values: distinct };
}

/**
 * ตัดสินว่าคอลัมน์เกินเพดานหรือยัง
 *
 * **`count` ต้องเป็นจำนวนจริงในคอลัมน์ ไม่ใช่จำนวนการ์ดที่กระดานแสดง** ·
 * กระดานดึงมาคอลัมน์ละไม่เกิน 100 ใบ · คอลัมน์ที่มีงานจริง 150 ใบจะรายงาน
 * ว่า 100 แล้วเพดาน 120 จะดูเหมือนยังไม่เต็มทั้งที่เกินไปแล้ว 30 ใบ ·
 * ฟังก์ชันนี้จึงรับตัวเลข ไม่รับรายการการ์ด เพื่อไม่ให้มีทางส่งของที่ถูกตัดมา
 *
 * **"เต็มพอดี" ไม่ใช่ "เกิน"** — เพดาน 5 ที่มีงาน 5 ใบคือสิ่งที่ตกลงกันไว้
 * ไม่ใช่การละเมิด · เตือนตรงนั้นแล้วคนจะเห็นคำเตือนตลอดเวลาและเลิกอ่าน
 */
export function evaluateWip(count: number, limit: WipLimit): WipState {
  switch (limit.kind) {
    case 'none':
      return { kind: 'no-limit', count };
    case 'ambiguous':
      return { kind: 'ambiguous', count, values: limit.values };
    case 'limit': {
      /*
        เทียบด้วย `>` และ `<` ตรง ๆ ไม่ใช่ `if (!limit.max)` — ค่า 0 ที่หลุด
        เข้ามาจากข้อมูลเก่าหรือการแก้ฐานข้อมูลตรง ๆ ต้องอ่านว่าเป็นเพดาน 0
        ไม่ใช่ "ไม่มีเพดาน"
      */
      if (count > limit.max) {
        return { kind: 'over', count, max: limit.max, excess: count - limit.max };
      }
      if (count === limit.max) return { kind: 'at', count, max: limit.max };
      return { kind: 'under', count, max: limit.max, remaining: limit.max - count };
    }
  }
}
