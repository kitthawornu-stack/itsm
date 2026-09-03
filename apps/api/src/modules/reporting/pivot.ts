/**
 * ตารางไขว้ (pivot)
 *
 * ตอบคำถามแบบ "งานค้างของแต่ละคน แยกตามสถานะ" ในตารางเดียว ·
 * ผู้ดูแลใช้หาว่ากองไหนใหญ่ผิดปกติ
 *
 * ฟังก์ชันบริสุทธิ์ · ไม่แตะฐานข้อมูล ไม่อ่านนาฬิกา — ผู้เรียกนับมาให้แล้ว
 * ด้วย `groupBy` ที่นับฝั่งฐานข้อมูล ซึ่งเร็วกว่าดึงแถวมานับเองมาก
 */

/**
 * ชื่อของแถว/คอลัมน์ที่ **ไม่มีค่า**
 *
 * ต้องมีชื่อจริง ไม่ใช่ช่องว่าง — กติกาเดียวกับเลนบนกระดาน · งานที่ยัง
 * ไม่มีผู้รับผิดชอบคือกองที่สำคัญที่สุดในศูนย์บริการ ถ้าหายไปผลรวม
 * จะน้อยกว่าความจริงโดยไม่มีอะไรบอก
 */
export const NO_VALUE_LABEL = 'ไม่ระบุ';

/**
 * จำนวนคอลัมน์สูงสุดที่แสดง
 *
 * ตารางที่กว้างกว่านี้อ่านไม่ได้บนจอไหนเลย · **ตัดแล้วต้องบอกว่าตัด**
 * มิฉะนั้นคนจะเชื่อว่านั่นคือทั้งหมดแล้วสรุปผิด
 */
export const MAX_PIVOT_COLUMNS = 25;

/** หนึ่งจุดข้อมูลที่นับมาแล้ว · `null` = ไม่มีค่าในมิตินั้น */
export interface PivotFact {
  row: string | null;
  col: string | null;
  n: number;
}

export interface PivotRow {
  label: string;
  /** ค่าเรียงตาม `columns` · ยาวเท่ากับ `columns` เสมอ */
  cells: number[];
  /** ผลบวกของ `cells` — คำนวณจากช่องเดียวกับที่แสดง */
  total: number;
}

export interface PivotTable {
  columns: string[];
  rows: PivotRow[];
  /** ผลบวกของแต่ละคอลัมน์ เรียงตาม `columns` */
  columnTotals: number[];
  /**
   * ผลบวกของ **ทุกจุดข้อมูล** รวมคอลัมน์ที่ถูกตัดออกไปด้วย
   *
   * ถ้านับแต่คอลัมน์ที่เหลือ ตัวเลขจะขัดกับยอดที่หน้าอื่นรายงาน
   * แล้วไม่มีใครรู้ว่าอันไหนถูก
   */
  grandTotal: number;
  /** จำนวนคอลัมน์ที่ถูกตัดเพราะเกินเพดาน · 0 = ไม่ได้ตัด */
  truncatedColumns: number;
}

/** เรียงชื่อ โดยให้ "ไม่ระบุ" อยู่บนสุดเสมอ */
function byLabel(a: string, b: string): number {
  if (a === NO_VALUE_LABEL) return -1;
  if (b === NO_VALUE_LABEL) return 1;
  return a.localeCompare(b, 'th');
}

/**
 * ประกอบตารางไขว้จากจุดข้อมูลที่นับมาแล้ว
 *
 * **ทุกแถวมีช่องครบทุกคอลัมน์เสมอ** · ช่องที่ไม่มีข้อมูลเป็น 0 ไม่ใช่หายไป —
 * ตารางที่แถวยาวไม่เท่ากันทำให้คอลัมน์เลื่อน แล้วคนอ่านตัวเลขผิดช่อง
 * โดยที่หน้าตายังดูปกติทุกอย่าง
 *
 * **ยอดรวมทุกตัวคำนวณจากช่องเดียวกับที่แสดง** ไม่ใช่จากคิวรีแยก ·
 * ยอดที่ไม่เท่ากับผลบวกของแถวตัวเอง แย่กว่าไม่มียอดรวม เพราะคนเชื่อ
 * ยอดรวมมากกว่าช่อง
 */
export function buildPivot(facts: readonly PivotFact[]): PivotTable {
  /** (แถว, คอลัมน์) → จำนวน · รวมค่าที่ซ้ำคู่กันเข้าด้วยกัน */
  const cells = new Map<string, Map<string, number>>();
  const colTotalAll = new Map<string, number>();
  let grandTotal = 0;

  for (const f of facts) {
    const row = f.row ?? NO_VALUE_LABEL;
    const col = f.col ?? NO_VALUE_LABEL;
    const byCol = cells.get(row) ?? new Map<string, number>();
    byCol.set(col, (byCol.get(col) ?? 0) + f.n);
    cells.set(row, byCol);
    colTotalAll.set(col, (colTotalAll.get(col) ?? 0) + f.n);
    grandTotal += f.n;
  }

  /*
    เลือกคอลัมน์ที่จะแสดง **จากยอดมากไปน้อย** แล้วค่อยเรียงตามชื่อ ·
    ถ้าตัดตามตัวอักษร คอลัมน์ที่มีงานเยอะที่สุดอาจหายไปเพราะชื่อขึ้นต้น
    ด้วยตัวท้าย ๆ ซึ่งเป็นการซ่อนสิ่งที่คนเปิดรายงานมาหา
  */
  const ranked = [...colTotalAll.entries()].sort(
    (a, b) => b[1] - a[1] || byLabel(a[0], b[0]),
  );
  const kept = ranked.slice(0, MAX_PIVOT_COLUMNS).map(([name]) => name);
  const columns = [...kept].sort(byLabel);
  const truncatedColumns = ranked.length - kept.length;

  const rows: PivotRow[] = [...cells.keys()].sort(byLabel).map((label) => {
    const byCol = cells.get(label);
    const cs = columns.map((c) => byCol?.get(c) ?? 0);
    return { label, cells: cs, total: cs.reduce((a, b) => a + b, 0) };
  });

  const columnTotals = columns.map((_, i) => rows.reduce((a, r) => a + (r.cells[i] ?? 0), 0));

  return { columns, rows, columnTotals, grandTotal, truncatedColumns };
}
