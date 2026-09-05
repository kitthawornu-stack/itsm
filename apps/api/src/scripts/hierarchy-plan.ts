/**
 * แผนการผูกลำดับชั้น Epic → เรื่องหลัก → งานย่อย — ฟังก์ชันบริสุทธิ์
 *
 * ข้อมูลตั้งต้นเดิม **ไม่มีงานที่มีแม่สักใบ** (0 จาก 10,000 แถว) ทั้งที่มี
 * ชนิดงาน Epic 616 ใบและ Sub-task 647 ใบอยู่จริง · ผลคือทุกฟีเจอร์ที่อ่าน
 * สายแม่-ลูก — เลน Epic · ความคืบหน้าของเรื่องหลัก · validator `children-done`
 * — ดูว่างเปล่าเสมอโดยไม่มีอะไรผิดสักอย่าง
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพราะผลของมันคือ *ข้อมูล* ที่ฟีเจอร์อื่นอ่านต่อ
 * ผิดแล้วไม่มีอะไรพัง แค่ตอบผิดเงียบ ๆ — เป็นชนิดเดียวกับเอนจินสี่ตัวใน §4
 *
 * **มีตัวสุ่มของตัวเอง ไม่ใช้สายเดียวกับ `seed.ts`** สองเหตุผล:
 *   1. ผลไม่ขึ้นกับว่ามีใครเรียก `rnd()` ไปกี่ครั้งก่อนหน้า — การเพิ่มขั้นตอน
 *      ที่อื่นใน seed จึงไม่ทำให้ลำดับชั้นเปลี่ยนทั้งชุด
 *   2. สคริปต์เติมย้อนหลังรันนอก seed แล้วต้องได้ผลเดียวกันเป๊ะ
 */

/** mulberry32 — ไม่ใช่ LCG ที่เกิน 53 บิตแล้วสูญเสียบิตล่าง (ดู CLAUDE.md §3) */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260905;

/**
 * สัดส่วนเรื่องหลักที่อยู่ใต้ Epic — ที่เหลือคือกอง "ไม่ได้อยู่ใต้ Epic ใด"
 * ซึ่ง **ต้องมีของจริง** มิฉะนั้นเลนนั้นว่างและไม่มีใครรู้ว่ามันทำงานหรือไม่
 */
const UNDER_EPIC = 0.65;

/**
 * จำนวน Epic ที่รับลูกจริงต่อโปรเจกต์
 *
 * **ตัวเลขนี้มาจากการเปิดดูคำตอบจริง ไม่ใช่จากเทสต์** · รอบแรกใช้สัดส่วน
 * 40% ของ Epic ทั้งหมด ซึ่งเทสต์ผ่านหมดทุกข้อ แต่ข้อมูล seed มีชนิดงาน Epic
 * ถึง 616 ใบ (สุ่มมาเท่า ๆ กับชนิดอื่น) ผลคือกระดานเดียวได้ **197 เลน**
 * ซึ่งอ่านไม่ได้เลย · กระดานจริงมี Epic ที่กำลังทำอยู่ไม่กี่ใบ ที่เหลือ
 * เป็นใบที่ยังไม่มีใครแตกงาน
 */
const ACTIVE_EPICS = 12;

export interface HierarchyItem {
  readonly id: string;
  /** ชั้นของชนิดงาน — 1 = Epic · 0 = เรื่องหลัก · -1 = งานย่อย */
  readonly level: number;
}

export interface HierarchyPlan {
  /** id ลูก → id แม่ */
  readonly links: ReadonlyMap<string, string>;
  readonly epicsWithChildren: number;
  /** เรื่องหลักที่ตั้งใจไม่ให้อยู่ใต้ Epic ใด */
  readonly topLevelWithoutEpic: number;
}

/**
 * ผู้เรียกต้องส่งรายการของ **โปรเจกต์เดียว** เข้ามา — แม่กับลูกต้องอยู่
 * โปรเจกต์เดียวกัน และฟังก์ชันนี้ไม่รู้จักโปรเจกต์ จึงกันให้เองไม่ได้
 */
export function planHierarchy(items: readonly HierarchyItem[]): HierarchyPlan {
  const rnd = mulberry32(SEED);
  const epics = items.filter((i) => i.level === 1).map((i) => i.id);
  const tops = items.filter((i) => i.level === 0).map((i) => i.id);
  const subs = items.filter((i) => i.level === -1).map((i) => i.id);

  const links = new Map<string, string>();
  const used = epics.slice(0, ACTIVE_EPICS);

  if (used.length > 0)
    for (const id of tops) {
      if (rnd() >= UNDER_EPIC) continue;
      links.set(id, used[Math.floor(rnd() * used.length)] as string);
    }

  /*
    งานย่อยได้แม่ **ทุกใบ** — งานย่อยที่ไม่มีแม่ไม่ใช่ข้อมูลที่มีความหมาย
    · แม่ถูกสุ่มจากเรื่องหลักทั้งหมด ไม่ใช่เฉพาะที่อยู่ใต้ Epic งานย่อย
    ส่วนหนึ่งจึงไต่ขึ้นไปถึง Epic (ลึก 3 ชั้น) และอีกส่วนไม่ถึง
    — ทั้งสองแบบต้องมีจริง เพราะเลน Epic แยกสองกรณีนี้คนละเลน
  */
  if (tops.length > 0)
    for (const id of subs) links.set(id, tops[Math.floor(rnd() * tops.length)] as string);

  const epicSet = new Set(epics);
  return {
    links,
    epicsWithChildren: new Set([...links.values()].filter((v) => epicSet.has(v))).size,
    topLevelWithoutEpic: tops.filter((t) => !links.has(t)).length,
  };
}
