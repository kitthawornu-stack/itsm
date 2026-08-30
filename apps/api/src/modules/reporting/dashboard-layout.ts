/**
 * การจัดวางแดชบอร์ด — ฟังก์ชันบริสุทธิ์ทั้งไฟล์
 *
 * ## โครงร่างที่เก็บไว้คือ "ความตั้งใจ" ไม่ใช่ "สิ่งที่จะได้เห็น"
 *
 * สิ่งที่เก็บคือสิ่งที่เจ้าของอยากเห็นในวันที่เขาจัดหน้านี้ · สิ่งที่เรนเดอร์คือ
 * ส่วนที่ **ยังมีอยู่จริงวันนี้** และ **คนที่กำลังดูมีสิทธิ์ดู** · สองอย่างนี้
 * ต่างกันเสมอเมื่อเวลาผ่านไป — ฟีเจอร์ถูกถอด สิทธิ์ถูกเปลี่ยน โปรเจกต์ถูกปิด
 *
 * ช่องว่างระหว่างสองอย่างนั้นคือสิ่งที่ไฟล์นี้มีหน้าที่ **รายงาน** ไม่ใช่กลืน ·
 * แดชบอร์ดที่หายไปหนึ่งช่องเงียบ ๆ หน้าตาเหมือนแดชบอร์ดที่เจ้าของจัดไว้แบบนั้นเอง
 * ไม่มี error ไม่มีอะไรแดง มีแต่คนที่ตัดสินใจจากตัวเลขที่ไม่ครบ
 *
 * ## ไม่อ่านฐานข้อมูล ไม่อ่านนาฬิกา
 *
 * กติกาเดียวกับเอนจินอีกสี่ตัว · สิทธิ์และรายการชนิดที่รู้จักถูก **ส่งเข้ามา**
 * ทำให้เคส "ฟีเจอร์ถูกถอดหลังจากเจ้าของจัดหน้าไปแล้ว" ทดสอบได้โดยไม่ต้อง
 * ถอดฟีเจอร์จริง
 */

/**
 * ชนิดของการ์ดที่ระบบรู้จัก ณ วันนี้
 *
 * ทุกตัวตอบด้วยข้อมูลที่ `reportSummary` คืนอยู่แล้ว — ไม่มีคิวรีใหม่
 * · การ์ดที่ต้องยิงคิวรีของตัวเองคือการ์ดที่ทำให้หน้าเดียวยิงสิบคิวรี
 */
export const KNOWN_GADGET_KINDS = [
  /** ยอดรวม: เปิด · ปิด · ค้างอยู่ · เวลาปิดเฉลี่ย */
  'summary',
  /** แผนภูมิแท่งรายวัน เปิดเทียบปิด */
  'daily',
  /** แยกตามระดับความสำคัญ */
  'by-priority',
  /** แยกตามผู้รับผิดชอบ */
  'by-assignee',
  /**
   * ตัวเลขเดียวใหญ่ ๆ: หลุด SLA ในช่วงนี้กี่ใบ
   *
   * ซ้ำกับตัวเลขใน `summary` โดยตั้งใจ — แดชบอร์ดคือเรื่องของการเน้น
   * คนที่เฝ้าตัวเลขนี้ตัวเดียวไม่ควรต้องกวาดตาหาในกลุ่มตัวเลขสี่ตัว
   */
  'breached',
] as const;

export type GadgetKind = (typeof KNOWN_GADGET_KINDS)[number];

/** จำนวนการ์ดสูงสุดต่อหน้า — หนึ่งการ์ดคือการคำนวณหนึ่งชุด */
export const MAX_GADGETS = 12;

export interface GadgetSpec {
  /** ไม่ซ้ำกันภายในหน้าเดียว */
  id: string;
  /**
   * ประกาศเป็น `string` ไม่ใช่ union โดยตั้งใจ
   *
   * แถวที่เก็บไว้ถูกเขียนด้วยโค้ดรุ่นก่อน · ถ้าประกาศเป็น union
   * TypeScript จะยืนยันว่าเคส "ชนิดที่ไม่รู้จัก" เกิดไม่ได้ แล้วเราจะไม่เขียน
   * โค้ดรับมือ ทั้งที่มันเกิดจริงทุกครั้งที่ถอดฟีเจอร์ออกสักตัว
   */
  kind: string;
  /** เริ่มที่ 0 · ค่าที่เกินขอบถูกดึงกลับ ไม่ใช่ทำให้การ์ดหายไป */
  column: number;
  /** `null` = ทุกโปรเจกต์ที่คนดูเปิดดูได้ */
  projectId: string | null;
  /** ชื่อที่เจ้าของตั้งเอง — `null` = ใช้ชื่อประจำชนิด */
  title: string | null;
}

export interface Layout {
  columns: number;
  gadgets: GadgetSpec[];
}

export type DropReason = 'unknown-kind' | 'no-access' | 'over-capacity';

export interface DroppedGadget {
  id: string;
  reason: DropReason;
  /**
   * ชื่อที่เจ้าของตั้งไว้ — **`null` เสมอเมื่อคนดูไม่ใช่เจ้าของ**
   *
   * ชื่ออย่าง "ค้างของฝ่ายการเงิน" บอกคนนอกว่ามีโปรเจกต์ชื่อนั้นอยู่จริง
   * ซึ่งเป็นข้อมูลที่เขาไม่มีสิทธิ์รู้ · เจ้าของต้องเห็นเพราะต้องไปแก้หน้าตัวเอง
   */
  title: string | null;
}

export interface ResolvedGadget extends GadgetSpec {
  /** แถวภายในคอลัมน์ของตัวเอง เริ่มที่ 0 */
  row: number;
}

export interface ResolvedLayout {
  columns: number;
  gadgets: ResolvedGadget[];
  dropped: DroppedGadget[];
}

export interface ResolveInput {
  layout: Layout;
  /** ชนิดที่ระบบรู้จัก **ตอนนี้** — ส่งเข้ามาเพื่อให้ทดสอบการถอดฟีเจอร์ได้ */
  knownKinds: readonly string[];
  /** โปรเจกต์ที่คนดูทั้งเปิดดูได้และมีสิทธิ์ดูรายงาน */
  visibleProjectIds: readonly string[];
  ownsLayout: boolean;
}

export class GadgetNotFoundError extends Error {
  constructor(readonly gadgetId: string) {
    super(`ไม่พบการ์ด "${gadgetId}" ในหน้านี้`);
    this.name = 'GadgetNotFoundError';
  }
}

/** จำนวนคอลัมน์ที่ใช้ได้จริง — ศูนย์คอลัมน์วางอะไรไม่ได้เลย */
function usableColumns(raw: number): number {
  return Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 1;
}

/**
 * ดึงคอลัมน์กลับเข้าขอบ แทนที่จะทิ้งการ์ด
 *
 * เจ้าของที่ย่อหน้าจากสามคอลัมน์เหลือสอง ไม่ได้ตั้งใจลบของในคอลัมน์ที่สาม
 * · การหายไปเงียบ ๆ ทำให้เขาสร้างใหม่ทับของเดิม แล้วได้สองใบที่เหมือนกัน
 */
function clampColumn(raw: number, columns: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.min(columns - 1, Math.max(0, Math.floor(raw)));
}

/**
 * เทียบความตั้งใจกับความจริง แล้วบอกว่าอะไรไม่ผ่านและเพราะอะไร
 *
 * ลำดับการตรวจ: ชนิด → สิทธิ์ → เพดาน · ตรวจชนิดก่อนเพราะการ์ดที่ระบบ
 * ไม่รู้จักแล้ว ตอบเรื่องสิทธิ์ไม่ได้เลย — มันไม่รู้ด้วยซ้ำว่าจะไปอ่านอะไร
 */
export function resolveLayout(inp: ResolveInput): ResolvedLayout {
  const columns = usableColumns(inp.layout.columns);
  const known = new Set(inp.knownKinds);
  const visible = new Set(inp.visibleProjectIds);

  const gadgets: ResolvedGadget[] = [];
  const dropped: DroppedGadget[] = [];
  const rowOf = new Map<number, number>();

  const drop = (gd: GadgetSpec, reason: DropReason): void => {
    dropped.push({ id: gd.id, reason, title: inp.ownsLayout ? gd.title : null });
  };

  for (const gd of inp.layout.gadgets) {
    if (!known.has(gd.kind)) {
      drop(gd, 'unknown-kind');
      continue;
    }
    /*
      ไม่มีโปรเจกต์ให้ดูสักโปรเจกต์ = การ์ดทุกใบไร้ความหมาย · ยอดศูนย์
      อ่านว่า "ไม่มีงานเลย" ซึ่งเป็นคนละเรื่องกับ "คุณดูไม่ได้"
    */
    const allowed = gd.projectId === null ? visible.size > 0 : visible.has(gd.projectId);
    if (!allowed) {
      drop(gd, 'no-access');
      continue;
    }
    // เพดานนับเฉพาะการ์ดที่จะได้เรนเดอร์จริง — ของที่ตายแล้วไม่กินโควตา
    if (gadgets.length >= MAX_GADGETS) {
      drop(gd, 'over-capacity');
      continue;
    }
    const column = clampColumn(gd.column, columns);
    const row = rowOf.get(column) ?? 0;
    rowOf.set(column, row + 1);
    gadgets.push({ ...gd, column, row });
  }

  return { columns, gadgets, dropped };
}

/**
 * ย้ายการ์ดหนึ่งใบไปทิศเดียว — คืนโครงร่างใหม่เสมอ
 *
 * ขึ้น/ลง สลับกับ **เพื่อนบ้านในคอลัมน์เดียวกัน** เท่านั้น · การ์ดคนละคอลัมน์
 * ไม่ใช่เพื่อนบ้าน แม้จะอยู่แถวติดกันบนหน้าจอ
 *
 * ซ้าย/ขวา ไปอยู่ **ท้ายคอลัมน์ปลายทางเสมอ** — ตำแหน่งที่คาดเดาได้สำคัญกว่า
 * ตำแหน่งที่ "ใกล้เคียงของเดิม" เพราะคนกดปุ่มซ้ำหลายครั้งติดกัน
 * และต้องรู้ล่วงหน้าว่าจะไปไหน
 *
 * มีไว้ให้ปุ่มบนหน้าจอเรียก — Board ต้องย้ายด้วยคีย์บอร์ดได้ตาม WCAG
 * แดชบอร์ดก็เหมือนกัน · การลากด้วยเมาส์อย่างเดียวไม่ผ่าน
 */
export function moveGadget(
  layout: Layout,
  gadgetId: string,
  direction: 'up' | 'down' | 'left' | 'right',
): Layout {
  const columns = usableColumns(layout.columns);
  const list = layout.gadgets.map((x) => ({ ...x }));
  /*
    หาจากตัวสำเนา แล้วค่อยหาตำแหน่งจากตัวที่เจอ — ไม่ใช่หาตำแหน่งก่อนแล้ว
    ค่อยอ่านด้วยดัชนี · ทางหลังบังคับให้มีด่านตรวจ `undefined` อีกชั้นที่
    ไปถึงไม่ได้จริง แล้วด่านนั้นจะบัง `GadgetNotFoundError` ไว้
    ทำให้ลบด่านจริงทิ้งแล้วเทสต์ยังเขียว
  */
  const me = list.find((x) => x.id === gadgetId);
  if (me === undefined) throw new GadgetNotFoundError(gadgetId);
  const at = list.indexOf(me);
  const unchanged = (): Layout => ({ columns: layout.columns, gadgets: list });

  if (direction === 'up' || direction === 'down') {
    const step = direction === 'up' ? -1 : 1;
    let swapAt = -1;
    let other: GadgetSpec | undefined;
    for (let i = at + step; i >= 0 && i < list.length; i += step) {
      const cand = list[i];
      if (cand !== undefined && cand.column === me.column) {
        swapAt = i;
        other = cand;
        break;
      }
    }
    // บนสุด/ล่างสุดของคอลัมน์ตัวเองแล้ว — ไม่เปลี่ยนอะไร ไม่วนไปอีกฝั่ง
    if (other === undefined) return unchanged();
    list[at] = other;
    list[swapAt] = me;
    return { columns: layout.columns, gadgets: list };
  }

  const target = me.column + (direction === 'left' ? -1 : 1);
  if (target < 0 || target > columns - 1) return unchanged();
  me.column = target;
  list.splice(at, 1);
  list.push(me);
  return { columns: layout.columns, gadgets: list };
}

/**
 * หน้าที่ผู้ใช้ใหม่ได้เห็นก่อนจัดเอง
 *
 * ต้องไม่ว่างเปล่า — หน้าว่างในวันแรกอ่านว่า "ระบบนี้ไม่มีอะไร" ไม่ใช่
 * "หน้านี้ยังไม่ได้ตั้งค่า" · และต้อง **ไม่ผูกโปรเจกต์ใดโปรเจกต์หนึ่ง**
 * เพราะคนที่เพิ่งเริ่มยังไม่รู้ว่ามีโปรเจกต์อะไรบ้าง
 */
export function defaultLayout(): Layout {
  return {
    columns: 2,
    gadgets: [
      { id: 'd-summary', kind: 'summary', column: 0, projectId: null, title: null },
      { id: 'd-daily', kind: 'daily', column: 0, projectId: null, title: null },
      { id: 'd-priority', kind: 'by-priority', column: 1, projectId: null, title: null },
      { id: 'd-assignee', kind: 'by-assignee', column: 1, projectId: null, title: null },
    ],
  };
}
