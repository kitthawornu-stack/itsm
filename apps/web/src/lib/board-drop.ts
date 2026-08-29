/**
 * ตำแหน่งที่การ์ดจะไปอยู่ เมื่อปล่อยเมาส์
 *
 * แยกออกจากคอมโพเนนต์เป็นฟังก์ชันบริสุทธิ์ เพราะมันคำนวณ **เพื่อนบ้านสองข้าง**
 * ซึ่งผิดได้แบบเงียบที่สุด: หน้าจอยังทำงาน การ์ดยังขยับ แค่ไปผิดที่หนึ่งช่อง
 * และไม่มี error ที่ไหนเลย · ในคอมโพเนนต์จะทดสอบได้เฉพาะผ่านการลากจริง
 *
 * ## กับดักที่ต้องกันตั้งแต่แรก
 *
 * **ต้องตัดการ์ดที่กำลังลากออกจากรายการก่อนหาเพื่อนบ้าน** — ถ้าไม่ตัด
 * การลากลงข้างล่างในคอลัมน์เดิมจะได้เพื่อนบ้านผิดไปหนึ่งช่อง เพราะตัวมันเอง
 * ยังนับอยู่ · บั๊กนี้ไม่โผล่ตอนลากขึ้นข้างบน หรือลากข้ามคอลัมน์ จึงผ่าน
 * การลองด้วยมือได้สบาย
 *
 * **ปล่อยที่เดิมต้องไม่เขียนอะไร** — "ประวัติที่รกเท่ากับไม่มีประวัติ"
 * (กติกาเดียวกับที่ `board.service.ts` บังคับฝั่งเซิร์ฟเวอร์)
 */

export interface DropCard {
  itemKey: string;
}

export interface DropColumn {
  statusId: string;
  name: string;
  cards: readonly DropCard[];
}

export interface DropMove {
  toColumn?: string;
  afterKey?: string;
  beforeKey?: string;
}

export interface DropPlan {
  move: DropMove;
  /** ข้อความประกาศผ่าน `aria-live` — คนที่ไม่เห็นหน้าจอต้องรู้ว่าเกิดอะไร */
  say: string;
}

/**
 * วางแผนการย้ายจากการปล่อยเมาส์หนึ่งครั้ง
 *
 * @param beforeKey การ์ดที่จะไปแทรกอยู่ **ข้างบน** ของมัน · `null` = ต่อท้ายคอลัมน์
 * @returns `null` เมื่อไม่ต้องทำอะไร (ปล่อยที่เดิม หรือเป้าหมายไม่มีจริง)
 */
export function planDrop(
  columns: readonly DropColumn[],
  dragKey: string,
  colIdx: number,
  beforeKey: string | null,
): DropPlan | null {
  const target = columns[colIdx];
  if (target === undefined) return null;

  const from = columns.find((c) => c.cards.some((x) => x.itemKey === dragKey));
  if (from === undefined) return null;
  const sameColumn = from.statusId === target.statusId;

  // ตัดตัวเองออกก่อนเสมอ — ดูหัวไฟล์
  const rest = target.cards.filter((c) => c.itemKey !== dragKey);
  const at = beforeKey === null ? rest.length : rest.findIndex((c) => c.itemKey === beforeKey);
  if (at < 0) return null;

  /*
    ปล่อยที่เดิม

    เทียบใน **พิกัดของรายการที่ตัดตัวเองออกแล้ว** · ตำแหน่งเดิมของการ์ดใน
    พิกัดนั้นเท่ากับดัชนีเดิมพอดี (เพราะใบที่ถูกตัดคือตัวมันเอง ใบข้างบน
    จึงไม่ขยับ) การแทรกที่ดัชนีเดียวกันจึงคืนที่เดิมเป๊ะ

    เคยเขียนเป็น `at || at - 1` โดยคิดว่า "ปล่อยบนใบถัดไปหนึ่ง" เป็นที่เดิมด้วย
    — **มันเป็นการย้ายจริง** และเงื่อนไขนั้นกินการลากลงล่างหนึ่งช่องทิ้งทั้งหมด
    เทสต์จับได้ทันทีที่รันครั้งแรก
  */
  const currentIndex = target.cards.findIndex((c) => c.itemKey === dragKey);
  if (sameColumn && currentIndex === at) return null;

  const above = rest[at - 1];
  const below = rest[at];

  return {
    move: {
      ...(sameColumn ? {} : { toColumn: target.name }),
      ...(above === undefined ? {} : { afterKey: above.itemKey }),
      ...(below === undefined ? {} : { beforeKey: below.itemKey }),
    },
    say: sameColumn
      ? `ย้าย ${dragKey} ไปอันดับ ${String(at + 1)} ในคอลัมน์ ${target.name}`
      : `ย้าย ${dragKey} ไป ${target.name}`,
  };
}
