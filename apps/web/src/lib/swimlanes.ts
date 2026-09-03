/**
 * แบ่งการ์ดบนกระดานออกเป็นเลน
 *
 * เลนคือการจัดกลุ่มตามผู้รับผิดชอบหรือระดับความสำคัญ · ทีมเล็กใช้ดูว่าใคร
 * ถืออะไรอยู่ โดยไม่ต้องกรองทีละคน
 *
 * **แบ่งที่หน้าจอ ไม่ใช่ที่เซิร์ฟเวอร์** — การ์ดถูกดึงมาหมดแล้ว การแบ่งเป็น
 * เรื่องของการนำเสนอล้วน · ทำที่เซิร์ฟเวอร์จะเปลี่ยนรูปคำตอบของทุกคนที่เรียก
 * กระดาน เพื่อสิ่งที่คำนวณซ้ำได้ฟรีที่ปลายทาง
 *
 * ฟังก์ชันบริสุทธิ์ · ไม่แตะเครือข่าย ไม่อ่านนาฬิกา
 */

export interface LaneCard {
  itemKey: string;
  summary: string;
  assignee: string | null;
  priority: { rank: number; name: string } | null;
  rank: string;
}

export interface LaneColumn {
  statusId: string;
  name: string;
  category: string;
  cards: LaneCard[];
  /**
   * จำนวนงานจริงในคอลัมน์ · ตอนแบ่งเลนจะถูกเขียนใหม่เป็นจำนวนของเลนนั้น
   *
   * **จำนวนของทั้งคอลัมน์ตอบคำถามคนละข้อกับจำนวนในเลน** · หัวคอลัมน์ในเลน
   * ต้องบอกจำนวนที่อยู่ในเลนนั้น มิฉะนั้นห้าเลนจะขึ้นเลขเดียวกันหมด
   * และไม่มีเลนไหนตรงกับการ์ดที่เห็น
   */
  count: number;
}

/**
 * เลนหนึ่ง · **คงชนิดคอลัมน์ของผู้เรียกไว้**
 *
 * ผู้เรียกส่ง `BoardColumn` ซึ่งมีฟิลด์มากกว่าที่นี่ต้องใช้ (เช่น `wip`) ·
 * ถ้าคืนเป็น `LaneColumn` เฉย ๆ ฟิลด์เหล่านั้นจะหายไปจากชนิด ทั้งที่ค่ายัง
 * อยู่จริง แล้วผู้เรียกต้องแปลงชนิดเอง ซึ่งเป็นจุดที่ข้อผิดพลาดเข้ามาได้
 */
export interface Lane<T extends LaneColumn = LaneColumn> {
  /** คีย์ที่ไม่ซ้ำ ใช้เป็น `key` ของ React */
  key: string;
  label: string;
  columns: T[];
}

export type LaneMode = 'none' | 'assignee' | 'priority';

/**
 * ชื่อของเลนที่ **ไม่มีค่าให้จัดกลุ่ม**
 *
 * ต้องมีชื่อจริง ไม่ใช่ช่องว่าง — งานที่ยังไม่มีผู้รับผิดชอบคือกองที่สำคัญ
 * ที่สุดในศูนย์บริการ และคนต้องอ่านออกว่ามันคืออะไร
 */
export const NO_LANE_LABEL: Record<Exclude<LaneMode, 'none'>, string> = {
  assignee: 'ยังไม่มีผู้รับผิดชอบ',
  priority: 'ยังไม่ได้จัดระดับความสำคัญ',
};

/** ค่าที่ใช้จัดกลุ่มการ์ดหนึ่งใบ · `null` = ไม่มีค่า */
function laneKeyOf(card: LaneCard, mode: Exclude<LaneMode, 'none'>): string | null {
  if (mode === 'assignee') return card.assignee;
  return card.priority === null ? null : card.priority.name;
}

/** อันดับสำหรับเรียงเลน — ความสำคัญเรียงจากด่วนสุด ไม่ใช่ตามตัวอักษร */
function sortKeyOf(card: LaneCard, mode: Exclude<LaneMode, 'none'>): number {
  return mode === 'priority' ? (card.priority?.rank ?? Number.MAX_SAFE_INTEGER) : 0;
}

/**
 * แบ่งคอลัมน์ออกเป็นเลน
 *
 * **การ์ดทุกใบต้องอยู่ในเลนใดเลนหนึ่งเสมอ** · ใบที่ไม่มีค่าให้จัดกลุ่ม
 * ไปอยู่เลนของตัวเองที่มีชื่อ ไม่ใช่หายไป — การหายไปทำให้กระดานดูโล่ง
 * และไม่มีใครรู้ว่ามีงานรออยู่
 */
export function splitLanes<T extends LaneColumn>(columns: readonly T[], mode: LaneMode): Lane<T>[] {
  if (columns.length === 0) return [];
  if (mode === 'none') {
    return [{ key: 'all', label: '', columns: columns.map((c) => ({ ...c, cards: [...c.cards] })) }];
  }

  const noLabel = NO_LANE_LABEL[mode];
  /** ชื่อเลน → อันดับสำหรับเรียง (ใช้ค่าที่เล็กที่สุดที่เจอ) */
  const order = new Map<string, number>();
  const seen = new Set<string>();
  for (const col of columns) {
    for (const c of col.cards) {
      const label = laneKeyOf(c, mode) ?? noLabel;
      seen.add(label);
      const k = sortKeyOf(c, mode);
      order.set(label, Math.min(order.get(label) ?? Number.MAX_SAFE_INTEGER, k));
    }
  }

  const labels = [...seen].sort((a, b) => {
    /*
      **เลนที่ยังไม่มีเจ้าของอยู่บนสุดเสมอ** — เป็นกองที่ต้องมีคนหยิบ ·
      การเรียงตามตัวอักษรจะทำให้มันไปอยู่กลาง ๆ แล้วคนเลื่อนผ่าน
    */
    if (a === noLabel) return -1;
    if (b === noLabel) return 1;
    const byOrder = (order.get(a) ?? 0) - (order.get(b) ?? 0);
    return byOrder !== 0 ? byOrder : a.localeCompare(b, 'th');
  });

  return labels.map((label) => ({
    key: label,
    label,
    /*
      **ทุกเลนมีคอลัมน์ครบเท่ากัน แม้คอลัมน์นั้นจะว่างในเลนนี้** ·
      ถ้าซ่อนคอลัมน์ว่าง เลนแต่ละเลนจะกว้างไม่เท่ากัน แล้วอ่านเทียบกันไม่ได้
    */
    columns: columns.map((col) => {
      const cards = col.cards.filter((c) => (laneKeyOf(c, mode) ?? noLabel) === label);
      /*
        `count` ของเลนคือจำนวนการ์ดในเลนนั้น ไม่ใช่ของทั้งคอลัมน์ ·
        นี่เป็นจำนวน *ที่แสดง* จริง ๆ เพราะการแบ่งเลนทำจากการ์ดที่ถูกดึงมาแล้ว
        (ไม่เกิน 100 ใบต่อคอลัมน์) — ต่างจาก `count` ของคอลัมน์ทั้งใบ
        ที่มาจากคิวรีนับของเซิร์ฟเวอร์
      */
      return { ...col, cards, count: cards.length };
    }),
  }));
}
