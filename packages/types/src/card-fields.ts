/**
 * ฟิลด์ที่การ์ดบนกระดานแสดงได้
 *
 * การ์ดแสดงอะไรได้ไม่กี่อย่างก่อนจะอ่านไม่ทัน · ทีมที่ทำงานตามผู้รับผิดชอบ
 * กับทีมที่ทำงานตามความเร่งด่วน ต้องการคนละอย่าง จึงให้ผู้ใช้เลือกเอง
 *
 * อยู่ใน `packages/types` เพราะทั้ง api และ web ต้องใช้ชุดเดียวกัน —
 * รายการที่เขียนไว้สองที่คือรายการที่จะไม่ตรงกันในวันที่มีคนแก้แค่ที่เดียว
 *
 * ฟังก์ชันบริสุทธิ์ทั้งไฟล์ · ไม่แตะฐานข้อมูล ไม่อ่านนาฬิกา
 */

/**
 * ฟิลด์ที่เลือกเปิดปิดได้
 *
 * **คีย์งานกับหัวข้อไม่อยู่ในนี้** — การ์ดที่ไม่มีคีย์พูดถึงกับคนอื่นไม่ได้
 * และการ์ดที่ไม่มีหัวข้อไม่มีใครรู้ว่าคือเรื่องอะไร · สองอย่างนั้นแสดงเสมอ
 * จึงไม่อยู่ในรายการเลย ไม่ใช่อยู่แล้วปิดไม่ได้ — ตัวเลือกที่กดไม่ได้
 * คือหน้าจอที่หลอกคน
 */
export const ALL_CARD_FIELDS = ['priority', 'assignee', 'type', 'sprint', 'updated'] as const;

export type CardField = (typeof ALL_CARD_FIELDS)[number];

/** ป้ายที่ผู้ใช้เห็น — ภาษาคน ไม่ใช่ชื่อฟิลด์ */
export const CARD_FIELD_LABEL: Record<CardField, string> = {
  priority: 'ระดับความสำคัญ',
  assignee: 'ผู้รับผิดชอบ',
  type: 'ประเภทงาน',
  sprint: 'รอบที่อยู่',
  updated: 'แก้ไขล่าสุด',
};

/**
 * ค่าที่ใช้เมื่อ **ยังไม่เคยตั้ง**
 *
 * ตรงกับสิ่งที่การ์ดเคยแสดงมาตลอด — ค่าปริยายที่เปลี่ยนหน้าตาให้คนที่
 * ไม่ได้ขออะไร คือการเปลี่ยนแปลงที่ไม่มีใครสั่ง
 */
export const DEFAULT_CARD_FIELDS: readonly CardField[] = ['priority', 'assignee'] as const;

const KNOWN = new Set<string>(ALL_CARD_FIELDS);

export interface ParsedCardFields {
  fields: CardField[];
  /** ชื่อที่เก็บไว้แต่ไม่รู้จักแล้ว — ผู้เรียกเลือกได้ว่าจะบอกหรือเก็บกวาด */
  unknown: string[];
}

/**
 * อ่านค่าที่เก็บไว้
 *
 * **`null` กับ `''` ต่างกันให้ขาด** · `null` = ยังไม่เคยตั้ง จึงได้ค่าปริยาย ·
 * `''` = ตั้งใจปิดทุกอย่าง จึงได้รายการว่าง · ถ้าสองอย่างนี้ให้ผลเหมือนกัน
 * ผู้ใช้ที่ปิดทุกอย่างจะได้ค่าปริยายกลับมา แล้วเชื่อว่าปุ่มบันทึกพัง
 * — กติกาเดียวกับ "ไม่มีแถว = เก็บตลอดไป" ของนโยบายระยะเวลาเก็บข้อมูล
 *
 * ชื่อที่ไม่รู้จัก **ถูกแยกออกมารายงาน ไม่ใช่ทิ้งเงียบ** — ข้อมูลเก่าหรือ
 * ฟิลด์ที่ถูกลบ ทำให้การตั้งค่าหายไปทีละอย่างโดยไม่มีใครรู้
 */
export function parseCardFields(raw: string | null): ParsedCardFields {
  if (raw === null) return { fields: [...DEFAULT_CARD_FIELDS], unknown: [] };

  const fields: CardField[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (name === '') continue;
    if (seen.has(name)) continue;
    seen.add(name);
    if (KNOWN.has(name)) fields.push(name as CardField);
    else unknown.push(name);
  }
  return { fields, unknown };
}

/**
 * เขียนค่าเพื่อเก็บ
 *
 * **รายการว่างได้สตริงว่าง ไม่ใช่ `null`** — `null` แปลว่ายังไม่เคยตั้ง
 * ซึ่งเป็นคนละเรื่องกับตั้งใจปิดทุกอย่าง
 */
export function formatCardFields(fields: readonly CardField[]): string {
  for (const f of fields) {
    if (!KNOWN.has(f)) throw new Error(`ไม่รู้จักฟิลด์ "${f}"`);
  }
  return [...new Set(fields)].join(',');
}
