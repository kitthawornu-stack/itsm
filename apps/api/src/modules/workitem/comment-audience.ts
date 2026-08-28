/**
 * ใครควรได้รับแจ้งเตือนเมื่อมีความเห็นใหม่
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์ เพราะกฎที่นี่ตัดสินว่า **ใครจะไม่ได้รับ**
 * ซึ่งพลาดแล้วเงียบทั้งสองทาง: ส่งเกิน = คนเลิกอ่านการแจ้งเตือน
 * ส่งขาด = ผู้แจ้งถามแล้วไม่มีใครมาตอบ
 */

export interface CommentContext {
  authorId: bigint;
  reporterId: bigint;
  assigneeId: bigint | null;
  isInternal: boolean;
  /**
   * ผู้เฝ้าดูที่ **มีสิทธิ์เห็นความเห็นใบนี้แล้ว**
   *
   * ผู้เรียกเป็นคนกรองสิทธิ์มาก่อน (เปิดดูโปรเจกต์ได้ · เห็นบันทึกภายในได้)
   * ฟังก์ชันนี้ตัดสินแค่ "ใครซ้ำ ใครคือคนเขียนเอง" ซึ่งเป็นตรรกะบริสุทธิ์ ·
   * ถ้าเอาการตรวจสิทธิ์มาไว้ที่นี่ด้วย จะทดสอบเคส "เมื่อไรจะไม่ส่ง" ไม่ได้เลย
   */
  watcherIds?: readonly bigint[];
}

export interface Recipient {
  /** null = ระดับทีม ยังไม่ระบุตัวบุคคล */
  userId: bigint | null;
  reason: 'reporter' | 'assignee' | 'team' | 'watcher';
}

/**
 * กฎสามข้อ เรียงตามลำดับความสำคัญ
 *
 *   1. **ไม่แจ้งคนที่เขียนเอง** — ไม่มีใครอยากได้อีเมลบอกว่าตัวเองเพิ่งพิมพ์อะไร
 *   2. **ความเห็นภายในไม่ถึงผู้แจ้งเด็ดขาด** ทั้งบนหน้าจอและในกล่องจดหมาย
 *      การกรองที่ `listComments` อย่างเดียวไม่พอ ถ้าอีเมลยังส่งเนื้อความออกไป
 *   3. งานที่ยังไม่มีผู้รับผิดชอบ ให้เป็นการแจ้งระดับทีม ไม่ใช่ไม่แจ้งใครเลย
 *      — คำถามของผู้แจ้งที่ไม่มีใครเห็น คือความเงียบที่แย่ที่สุดของศูนย์บริการ
 */
export function commentAudience(c: CommentContext): Recipient[] {
  return withWatchers(baseAudience(c), c);
}

/**
 * เติมผู้เฝ้าดูเข้าไปในรายชื่อ
 *
 * **คนที่อยู่ในรายชื่ออยู่แล้วต้องไม่ถูกเติมซ้ำ** — ผู้รับผิดชอบที่กดเฝ้าดูด้วย
 * ต้องได้แจ้งเตือนใบเดียว ไม่ใช่สองใบ · `dedupeKey` บน unique index เป็นด่าน
 * สุดท้าย แต่การพึ่งมันแปลว่าเราตั้งใจเขียนของซ้ำแล้วหวังให้ฐานข้อมูลปฏิเสธ
 * ซึ่งกลบเจตนาและทำให้ `skipDuplicates` ซ่อนบั๊กอื่นไปด้วย
 */
function withWatchers(base: Recipient[], c: CommentContext): Recipient[] {
  const seen = new Set(base.map((r) => (r.userId === null ? 'team' : r.userId.toString())));
  const out = [...base];
  for (const id of c.watcherIds ?? []) {
    // ไม่แจ้งคนที่เขียนเอง แม้เขาจะกดเฝ้าดูไว้ — กฎข้อ 1 ใช้กับผู้เฝ้าดูด้วย
    if (id === c.authorId) continue;
    const key = id.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ userId: id, reason: 'watcher' });
  }
  return out;
}

function baseAudience(c: CommentContext): Recipient[] {
  const out: Recipient[] = [];
  const authoredByReporter = c.authorId === c.reporterId;

  if (c.isInternal) {
    // ภายใน: ถึงได้เฉพาะผู้รับผิดชอบ และเฉพาะเมื่อไม่ใช่คนเขียนเอง
    if (c.assigneeId !== null && c.assigneeId !== c.authorId) {
      out.push({ userId: c.assigneeId, reason: 'assignee' });
    }
    return out;
  }

  if (authoredByReporter) {
    // ผู้แจ้งตอบกลับ → ทีมต้องรู้
    if (c.assigneeId === null) out.push({ userId: null, reason: 'team' });
    else if (c.assigneeId !== c.authorId) out.push({ userId: c.assigneeId, reason: 'assignee' });
    return out;
  }

  // ทีมตอบ → ผู้แจ้งต้องรู้
  out.push({ userId: c.reporterId, reason: 'reporter' });
  // ผู้รับผิดชอบก็ควรรู้ ถ้าไม่ใช่คนเขียนและไม่ใช่ผู้แจ้งเอง
  if (c.assigneeId !== null && c.assigneeId !== c.authorId && c.assigneeId !== c.reporterId) {
    out.push({ userId: c.assigneeId, reason: 'assignee' });
  }
  return out;
}

/** คีย์กันส่งซ้ำ — ความเห็นหนึ่งใบต่อผู้รับหนึ่งคน ได้แจ้งเตือนครั้งเดียว */
export function commentDedupeKey(commentId: bigint, userId: bigint | null): string {
  return `comment:${commentId.toString()}:${userId === null ? 'team' : userId.toString()}`;
}

/** ข้อความแจ้งเตือน — ภาษาคน ไม่ใช่ศัพท์ระบบ (CLAUDE.md §5) */
export function commentNotificationText(params: {
  itemKey: string;
  summary: string;
  authorName: string;
  body: string;
  isInternal: boolean;
}): { title: string; body: string } {
  const title = params.isInternal
    ? `${params.itemKey} มีบันทึกภายในจาก ${params.authorName}`
    : `${params.itemKey} ${params.authorName} แสดงความเห็น`;

  // ตัดข้อความยาวในตัวแจ้งเตือน — คนต้องกดเข้าไปอ่านฉบับเต็มที่หน้างาน
  const excerpt = params.body.length > 300 ? `${params.body.slice(0, 300)}…` : params.body;
  return { title, body: `${params.summary}\n\n${excerpt}` };
}
