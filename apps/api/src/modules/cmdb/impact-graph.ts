/**
 * การไล่ผลกระทบใน CMDB
 *
 * คำถามที่ CMDB มีไว้ตอบคือ **"ถ้าเครื่องนี้ล่ม อะไรพังตามบ้าง"**
 *
 * ## ทิศทางกลับหัวได้ง่ายมาก
 *
 * ความสัมพันธ์เก็บเป็น "A พึ่งพา B" · คำถามผลกระทบคือ **ไล่ขึ้น** จาก B
 * ไปหาทุกตัวที่พึ่งพามัน — ตรงข้ามกับทิศที่เก็บ · ตอบผิดทิศแปลว่า
 * ประกาศดับผิดกลุ่มคน ซึ่งดูเหมือนทำงานปกติทุกอย่าง
 *
 * ## วงจรเกิดขึ้นจริง
 *
 * A พึ่ง B, B พึ่ง C, C พึ่ง A เกิดได้จากการกรอกผิดทางเพียงเส้นเดียว ·
 * ถ้าไม่กันไว้ ผลไม่ใช่คำตอบผิด แต่คือ **API ค้างโดยไม่มี error ให้เห็น**
 *
 * ทั้งไฟล์เป็นฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล
 */

/** "ตัวที่พึ่งพา" พึ่ง "ตัวที่ถูกพึ่งพา" — ตัวหลังล่ม ตัวแรกพัง */
export interface CiEdge {
  dependentId: string;
  dependsOnId: string;
}

export interface AffectedCi {
  id: string;
  /** ห่างจากต้นเหตุกี่ชั้น — ใช้เรียงว่าจะแจ้งใครก่อน */
  distance: number;
}

export interface ImpactResult {
  /** เรียงจากใกล้ไปไกล แล้วตามชื่อเมื่อระยะเท่ากัน */
  affected: AffectedCi[];
  /** จำนวนตัวที่ไล่ไม่ถึงเพราะชนเพดานความลึก */
  truncated: number;
  /** เจอวงจรระหว่างไล่ — ข้อมูลผิด ผู้ดูแลต้องรู้ */
  hasCycle: boolean;
}

/**
 * เพดานความลึกของการไล่
 *
 * สายพึ่งพาที่ยาวเกินสิบชั้นในองค์กรขนาดนี้แปลว่าข้อมูลผิด ไม่ใช่ระบบซับซ้อน ·
 * **แต่การตัดต้องบอกจำนวน** — คำตอบที่ตัดเงียบ ๆ อ่านเหมือน "ไม่มีอะไรพังต่อ"
 * ซึ่งกลับความหมายของสิ่งที่ผู้อ่านกำลังตัดสินใจ
 */
export const MAX_DEPTH = 10;

/**
 * อะไรพังตามถ้า `rootId` ล่ม
 *
 * ไล่แบบกว้างก่อน (BFS) เพื่อให้ **ระยะที่รายงานเป็นระยะสั้นที่สุดเสมอ** ·
 * ไล่แบบลึกก่อนจะรายงานทางที่บังเอิญเจอก่อน ซึ่งอาจยาวกว่า แล้วระบบที่พัง
 * ทันทีจะถูกจัดว่าอยู่ไกล
 */
export function impactOf(rootId: string, edges: readonly CiEdge[]): ImpactResult {
  /*
    ดัชนีจาก "ตัวที่ถูกพึ่งพา" → "ตัวที่พึ่งมัน" — สร้างครั้งเดียวก่อนไล่
    การกวาดทั้งรายการทุกชั้นทำให้เวลาเป็น O(ชั้น × เส้น) ซึ่งช้าโดยไม่จำเป็น
  */
  const dependents = new Map<string, string[]>();
  let hasCycle = false;
  for (const e of edges) {
    /*
      **เส้นที่ชี้หาตัวเองคือวงจรที่สั้นที่สุด ไม่ใช่ข้อมูลที่ข้ามไปเงียบ ๆ**

      ตอนแรกเขียนเป็น `continue` เฉย ๆ แล้วพบตอนลบทีละบรรทัดว่าลบทิ้งก็ยังเขียว
      — เพราะด่านวงจรกับด่านกันไล่ซ้ำบังผลไว้ทั้งสองทาง · แต่การเงียบก็ผิดอยู่ดี
      ผู้ดูแลที่กรอก "เครื่อง A พึ่งพาเครื่อง A" ต้องรู้ว่ากรอกผิด
      ไม่ใช่เห็นผลลัพธ์ที่ดูปกติ
    */
    if (e.dependentId === e.dependsOnId) {
      hasCycle = true;
      continue;
    }
    const list = dependents.get(e.dependsOnId) ?? [];
    list.push(e.dependentId);
    dependents.set(e.dependsOnId, list);
  }

  const seen = new Map<string, number>();
  let truncated = 0;
  let frontier = [rootId];

  for (let depth = 1; depth <= MAX_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const up of dependents.get(id) ?? []) {
        /*
          **ตัวเริ่มต้นที่ถูกไล่กลับมาเจอ คือวงจรจริง** — ต่างจากตัวที่เคยเห็น
          แล้ว ซึ่งอาจเป็นแค่กราฟรูปเพชร (ถึงได้สองทาง) · การรายงานว่ามีวงจร
          ทุกครั้งที่เจอตัวซ้ำ ทำให้ธงนี้ขึ้นตลอดเวลาแล้วไม่มีใครเชื่อมันอีก
        */
        if (up === rootId) {
          hasCycle = true;
          continue;
        }
        if (seen.has(up)) continue;
        seen.set(up, depth);
        next.push(up);
      }
    }
    frontier = next;
  }

  /*
    นับตัวที่ไล่ไม่ถึงเพราะชนเพดาน — ต้องนับ **ตัวที่ยังไม่เคยเห็น** เท่านั้น
    มิฉะนั้นตัวที่ถึงได้หลายทางจะถูกนับซ้ำ แล้วตัวเลข "ตัดไป N" สูงกว่าความจริง
  */
  if (frontier.length > 0) {
    const rest = new Set<string>();
    let level = frontier;
    for (let guard = 0; guard < MAX_DEPTH * 10 && level.length > 0; guard += 1) {
      const next: string[] = [];
      for (const id of level) {
        for (const up of dependents.get(id) ?? []) {
          if (up === rootId) {
            hasCycle = true;
            continue;
          }
          if (seen.has(up) || rest.has(up)) continue;
          rest.add(up);
          next.push(up);
        }
      }
      level = next;
    }
    truncated = rest.size;
  }

  const affected = [...seen.entries()]
    .map(([id, distance]) => ({ id, distance }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));

  return { affected, truncated, hasCycle };
}
