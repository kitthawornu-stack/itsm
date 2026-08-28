/**
 * ใครได้รับแจ้งเตือนเมื่อมีความเห็น — เทสต์เป็นข้อกำหนด
 *
 * เคสส่วนใหญ่คือ **ใครต้องไม่ได้รับ** เพราะพลาดแล้วเงียบทั้งสองทาง:
 * ส่งเกินทำให้คนเลิกอ่าน · ส่งขาดทำให้ผู้แจ้งถามแล้วไม่มีใครมาตอบ
 */
import { describe, expect, it } from 'vitest';

import {
  commentAudience,
  commentDedupeKey,
  commentNotificationText,
  type CommentContext,
} from './comment-audience';

const REPORTER = 10n;
const ASSIGNEE = 20n;
const OTHER_AGENT = 30n;

const c = (over: Partial<CommentContext> = {}): CommentContext => ({
  authorId: OTHER_AGENT,
  reporterId: REPORTER,
  assigneeId: ASSIGNEE,
  isInternal: false,
  ...over,
});

const ids = (ctx: CommentContext) => commentAudience(ctx).map((r) => r.userId);

describe('commentAudience', () => {
  it('ทีมตอบ → ผู้แจ้งและผู้รับผิดชอบได้รับ', () => {
    expect(ids(c())).toEqual([REPORTER, ASSIGNEE]);
  });

  it('**ไม่แจ้งคนที่เขียนเอง** — ไม่มีใครอยากได้อีเมลบอกว่าตัวเองเพิ่งพิมพ์อะไร', () => {
    expect(ids(c({ authorId: ASSIGNEE }))).toEqual([REPORTER]);
  });

  it('ผู้แจ้งตอบกลับ → ผู้รับผิดชอบได้รับ ผู้แจ้งไม่ได้รับของตัวเอง', () => {
    expect(ids(c({ authorId: REPORTER }))).toEqual([ASSIGNEE]);
  });

  it('ผู้แจ้งตอบแต่งานยังไม่มีผู้รับผิดชอบ → แจ้งระดับทีม ไม่ใช่ไม่แจ้งใครเลย', () => {
    // คำถามของผู้แจ้งที่ไม่มีใครเห็น คือความเงียบที่แย่ที่สุดของศูนย์บริการ
    const r = commentAudience(c({ authorId: REPORTER, assigneeId: null }));
    expect(r).toEqual([{ userId: null, reason: 'team' }]);
  });

  it('**ความเห็นภายในไม่ถึงผู้แจ้งเด็ดขาด** — ทั้งบนหน้าจอและในกล่องจดหมาย', () => {
    const r = ids(c({ isInternal: true }));
    expect(r).not.toContain(REPORTER);
    expect(r).toEqual([ASSIGNEE]);
  });

  it('บันทึกภายในที่ผู้รับผิดชอบเขียนเอง → ไม่แจ้งใครเลย', () => {
    expect(commentAudience(c({ isInternal: true, authorId: ASSIGNEE }))).toEqual([]);
  });

  it('บันทึกภายในบนงานที่ไม่มีผู้รับผิดชอบ → ไม่แจ้งระดับทีม (ทีมรวมผู้แจ้งไม่ได้)', () => {
    expect(commentAudience(c({ isInternal: true, assigneeId: null }))).toEqual([]);
  });

  it('ผู้แจ้งเป็นผู้รับผิดชอบเอง → ได้รับครั้งเดียว ไม่ใช่สองครั้ง', () => {
    expect(ids(c({ reporterId: REPORTER, assigneeId: REPORTER }))).toEqual([REPORTER]);
  });

  it('ไม่มีผู้รับซ้ำกันในรายการเดียว', () => {
    for (const ctx of [c(), c({ authorId: REPORTER }), c({ isInternal: true })]) {
      const r = ids(ctx);
      expect(new Set(r.map(String)).size).toBe(r.length);
    }
  });
});

describe('commentDedupeKey', () => {
  it('ความเห็นเดียวกันกับผู้รับเดียวกัน ได้คีย์เดียวกัน', () => {
    expect(commentDedupeKey(5n, 10n)).toBe(commentDedupeKey(5n, 10n));
  });

  it('ผู้รับต่างกันได้คีย์ต่างกัน — คนละคนต้องได้รับคนละใบ', () => {
    expect(commentDedupeKey(5n, 10n)).not.toBe(commentDedupeKey(5n, 20n));
  });

  it('ระดับทีมมีคีย์ของตัวเอง ไม่ชนกับผู้ใช้ id ใด', () => {
    expect(commentDedupeKey(5n, null)).toBe('comment:5:team');
  });

  it('ยาวไม่เกิน 191 อักขระ (ข้อจำกัด unique index ของ MySQL utf8mb4)', () => {
    expect(commentDedupeKey(9_223_372_036_854_775_807n, 9_223_372_036_854_775_807n).length)
      .toBeLessThanOrEqual(191);
  });
});

describe('ข้อความแจ้งเตือน', () => {
  const p = {
    itemKey: 'SD-1042',
    summary: 'เน็ตห้องบัญชีหลุด',
    authorName: 'สมชาย',
    body: 'ลองเปลี่ยนสายแล้วครับ',
    isInternal: false,
  };

  it('บอกว่าใครเขียน — ไม่ใช่ "มีความเห็นใหม่" ลอย ๆ', () => {
    expect(commentNotificationText(p).title).toContain('สมชาย');
    expect(commentNotificationText(p).title).toContain('SD-1042');
  });

  it('บันทึกภายในบอกชัดว่าเป็นภายใน', () => {
    expect(commentNotificationText({ ...p, isInternal: true }).title).toContain('บันทึกภายใน');
  });

  it('ข้อความยาวถูกตัด — ให้กดเข้าไปอ่านฉบับเต็มที่หน้างาน', () => {
    const t = commentNotificationText({ ...p, body: 'ก'.repeat(900) });
    expect(t.body.length).toBeLessThan(400);
    expect(t.body).toContain('…');
  });

  it('ข้อความสั้นไม่ถูกตัดและไม่มีจุดไข่ปลาเกินมา', () => {
    expect(commentNotificationText(p).body).not.toContain('…');
  });

  it('เนื้อหามีหัวข้องาน เพื่อให้อ่านจากกล่องจดหมายรู้เรื่อง', () => {
    expect(commentNotificationText(p).body).toContain('เน็ตห้องบัญชีหลุด');
  });
});

describe('E · ผู้เฝ้าดู', () => {
  /*
    ผู้เฝ้าดูเป็นเหตุผลเดียวที่ตาราง `work_item_watcher` มีอยู่ · ถ้ากดเฝ้าดูแล้ว
    ไม่ได้รับอะไรเลย ปุ่มนั้นก็เป็นแค่แถวในฐานข้อมูลที่ไม่มีใครอ่าน
    — รูปแบบเดียวกับกลไกที่ไม่มีอะไรเรียกใช้

    การตรวจสิทธิ์ไม่ได้อยู่ที่นี่โดยตั้งใจ · ผู้เรียกกรองมาก่อนแล้วว่าใครเห็น
    ความเห็นใบนี้ได้ ฟังก์ชันนี้จึงทดสอบเคส "เมื่อไรจะไม่ส่ง" ได้ครบ
    โดยไม่ต้องมีฐานข้อมูล
  */
  const base = { authorId: 1n, reporterId: 2n, assigneeId: 3n, isInternal: false };

  it('**ผู้เฝ้าดูได้รับด้วย นอกเหนือจากผู้แจ้งและผู้รับผิดชอบ**', () => {
    const out = commentAudience({ ...base, watcherIds: [9n] });
    expect(out.map((r) => r.userId)).toContain(9n);
    expect(out.find((r) => r.userId === 9n)?.reason).toBe('watcher');
  });

  it('**คนที่อยู่ในรายชื่ออยู่แล้ว ต้องไม่ถูกเติมซ้ำ**', () => {
    /*
      ผู้รับผิดชอบที่กดเฝ้าดูด้วย ต้องได้แจ้งเตือนใบเดียว ไม่ใช่สองใบ ·
      การพึ่ง unique index ให้ปฏิเสธ แปลว่าเราตั้งใจเขียนของซ้ำแล้วหวังให้
      ฐานข้อมูลจัดการ ซึ่งกลบเจตนาและทำให้ `skipDuplicates` ซ่อนบั๊กอื่นไปด้วย
    */
    const out = commentAudience({ ...base, watcherIds: [3n, 2n] });
    const ids = out.map((r) => r.userId?.toString() ?? 'team');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ผู้เฝ้าดูคนเดียวกันส่งมาซ้ำ ก็ยังได้ใบเดียว', () => {
    const out = commentAudience({ ...base, watcherIds: [9n, 9n, 9n] });
    expect(out.filter((r) => r.userId === 9n)).toHaveLength(1);
  });

  it('**ไม่แจ้งคนเขียนเอง แม้เขาจะกดเฝ้าดูไว้**', () => {
    // กฎข้อ 1 ใช้กับผู้เฝ้าดูด้วย — ไม่มีใครอยากได้อีเมลบอกว่าตัวเองเพิ่งพิมพ์อะไร
    const out = commentAudience({ ...base, watcherIds: [1n] });
    expect(out.some((r) => r.userId === 1n)).toBe(false);
  });

  it('ความเห็นภายใน: ผู้เฝ้าดูที่ผู้เรียกกรองมาแล้ว ได้รับ', () => {
    /*
      ผู้เรียกส่งมาเฉพาะผู้เฝ้าดูที่เห็นบันทึกภายในได้ · ที่นี่จึงต้องส่งให้
      — ถ้าตัดทิ้งเพราะ `isInternal` ทีมที่กดเฝ้าดูจะไม่มีวันรู้ว่ามีอะไรคุยกัน
    */
    const out = commentAudience({ ...base, isInternal: true, watcherIds: [9n] });
    expect(out.some((r) => r.userId === 9n)).toBe(true);
    // และผู้แจ้งยังต้องไม่ได้รับเด็ดขาด
    expect(out.some((r) => r.userId === 2n)).toBe(false);
  });

  it('ไม่ส่ง watcherIds มาเลย = พฤติกรรมเดิมทุกประการ', () => {
    // ผู้เรียกเดิมที่ยังไม่ได้แก้ ต้องได้ผลเหมือนก่อนมีฟีเจอร์นี้
    expect(commentAudience(base)).toEqual(commentAudience({ ...base, watcherIds: [] }));
  });
});
