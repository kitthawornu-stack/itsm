/**
 * วิธีแก้จากปัญหาที่เป็นสาเหตุ (Known Error)
 *
 * ITIL เรียกปัญหาที่รู้สาเหตุและมีวิธีแก้ชั่วคราวแล้วว่า Known Error ·
 * **คุณค่าทั้งหมดของมันอยู่ที่คนรับเรื่องใบใหม่ได้เห็นวิธีแก้ทันที**
 * ไม่ใช่ที่การมีบทความเก็บไว้เฉย ๆ — คลังความรู้ที่ไม่มีใครเจอตอนต้องใช้
 * ก็เป็นแค่โฟลเดอร์เอกสาร
 *
 * ฟังก์ชันบริสุทธิ์ · การกรองบทความตามสิทธิ์ (ร่าง/เผยแพร่/ถูกลบ) ทำที่
 * `articlesOf` ในโมดูลคลังความรู้แล้ว ไฟล์นี้จึงรับมาแต่ของที่ผู้เรียกเห็นได้
 */

export interface WorkaroundArticle {
  id: string;
  title: string;
}

export interface CausingProblem {
  itemKey: string;
  summary: string;
  /** ปัญหาต้นทางปิดไปแล้วหรือยัง — ดูจากหมวดของสถานะ ไม่ใช่ `resolvedAt` */
  resolved: boolean;
  articles: readonly WorkaroundArticle[];
}

export interface Workaround {
  articleId: string;
  title: string;
  /** คนอ่านต้องรู้ว่าวิธีแก้นี้เป็นของปัญหาใบไหน ไม่ใช่ของตั๋วที่กำลังเปิดอยู่ */
  problemKey: string;
  problemSummary: string;
  /**
   * ปัญหาต้นทางปิดแล้ว
   *
   * **บอก ไม่ใช่ซ่อน** — ปัญหาที่ปิดแล้วอาจแปลว่ามีการแก้ถาวรไปแล้ว
   * ตั๋วใบนี้ที่ยังค้างอาจแค่ยังไม่ได้รับการแก้นั้น · การซ่อนทำให้คนรับเรื่อง
   * ไม่รู้ว่ามีคำตอบ ส่วนการแสดงโดยไม่บอก อาจพาไปทำวิธีแก้ชั่วคราว
   * ทั้งที่มีวิธีแก้ถาวรอยู่แล้ว
   */
  problemResolved: boolean;
}

/**
 * รวมวิธีแก้จากปัญหาที่เป็นสาเหตุทั้งหมด
 *
 * **ปัญหาที่ยังเปิดอยู่มาก่อน** — คนที่กำลังรับเรื่องต้องเห็นอันที่ยังเกี่ยวข้อง
 * ก่อน · บทความเดียวกันที่มาจากปัญหาสองใบ ยกให้ใบแรกที่พบตามลำดับนั้น
 * เพื่อให้หน้าจอไม่สลับไปมาระหว่างรีเฟรช
 */
export function workaroundsFrom(problems: readonly CausingProblem[]): Workaround[] {
  const ordered = [...problems].sort((a, b) => Number(a.resolved) - Number(b.resolved));

  const seen = new Set<string>();
  const out: Workaround[] = [];
  for (const p of ordered) {
    for (const a of p.articles) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({
        articleId: a.id,
        title: a.title,
        problemKey: p.itemKey,
        problemSummary: p.summary,
        problemResolved: p.resolved,
      });
    }
  }
  return out;
}
