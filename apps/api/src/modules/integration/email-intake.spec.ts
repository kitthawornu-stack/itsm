/**
 * อีเมลขาเข้า → ตั๋ว หรือความเห็น — เทสต์เป็นข้อกำหนด
 *
 * ห้าข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **จดหมายของตัวเองต้องไม่กลายเป็นตั๋ว** — ระบบส่งแจ้งเตือน ปลายทางตอบ
 *      อัตโนมัติ คำตอบเข้ามาเป็นตั๋วใหม่ ตั๋วใหม่ส่งแจ้งเตือนอีก · **วนไม่จบ
 *      ภายในไม่กี่นาที** และแต่ละรอบสร้างตั๋วจริงที่คนต้องมาไล่ปิด
 *   2. **`Re:` ต้องไม่ถูกตัดทิ้งว่าเป็นการตอบอัตโนมัติ** — คนตอบกลับจดหมายจริง
 *      ก็ใช้ `Re:` เหมือนกัน · ตัดทิ้งแล้วความเห็นของคนหายทั้งหมด
 *   3. **ผู้ส่งที่ไม่รู้จักถูกปฏิเสธ แต่ต้องมีเหตุผลติดไปด้วย** — กล่องนี้เปิดรับ
 *      จากอินเทอร์เน็ตได้ · แต่จดหมายที่หายไปเงียบ ๆ คือคนที่ไม่มีวันรู้ว่า
 *      ไม่มีใครเห็นคำขอเขา
 *   4. **ตัดข้อความที่ยกมาแบบระมัดระวัง** — ตัดเกินแปลว่าข้อความของคนหายไป
 *      ซึ่งแย่กว่าเหลือข้อความเก่าติดมา
 *   5. **หาเรื่องเดิมจากหัวจดหมายก่อน แล้วค่อยดูหัวเรื่อง** — หัวเรื่องถูกแก้
 *      ถูกแปล ถูกตัดได้ตลอด แต่เป็นทางเดียวที่ใช้ได้เมื่อมีคนส่งต่อเข้ามา
 */
import { describe, expect, it } from 'vitest';

import { bracket, parseReferences } from './mail-source';
import {
  REJECT,
  cleanSubject,
  decideIntake,
  itemKeyInSubject,
  stripQuoted,
  type IncomingMail,
  type IntakeContext,
} from './email-intake';

const SYSTEM = 'no-reply@itsm.local';

function mail(over: Partial<IncomingMail> = {}): IncomingMail {
  return {
    mailboxId: 'm1',
    messageId: '<abc@example.co.th>',
    from: 'somchai@example.co.th',
    subject: 'เครื่องพิมพ์ชั้น 3 ใช้ไม่ได้',
    text: 'กดพิมพ์แล้วไฟกะพริบ ไม่มีกระดาษออกมาเลยครับ',
    inReplyTo: [],
    headers: {},
    ...over,
  };
}

function ctx(over: Partial<IntakeContext> = {}): IntakeContext {
  return { systemAddress: SYSTEM, threadItemKey: null, senderIsKnown: true, ...over };
}

describe('A · วนไม่จบ', () => {
  it('**จดหมายจากที่อยู่ของระบบเอง ถูกตัดทิ้ง**', () => {
    /*
      เคสที่ทำให้ระบบสร้างตั๋วเป็นร้อยใบในคืนเดียว · ไม่มี error ไม่มีอะไรพัง
      แค่ตั๋วเพิ่มขึ้นเรื่อย ๆ และการแจ้งเตือนถล่มทุกคน
    */
    const d = decideIntake(mail({ from: SYSTEM }), ctx());
    expect(d).toEqual({ action: 'reject', reason: REJECT.loop });
  });

  it('เทียบที่อยู่แบบไม่สนใจชื่อและตัวพิมพ์', () => {
    // `Helix Service Desk <No-Reply@ITSM.local>` คือที่อยู่เดียวกัน
    const d = decideIntake(mail({ from: 'Helix Service Desk <No-Reply@ITSM.local>' }), ctx());
    expect(d).toMatchObject({ action: 'reject', reason: REJECT.loop });
  });

  it('**ตรวจก่อนทุกอย่าง** — จดหมายที่วนกลับมาเองไม่ต้องรู้ว่าผู้ส่งมีบัญชีไหม', () => {
    /*
      ลำดับสำคัญ · ถ้าตรวจ "ผู้ส่งไม่รู้จัก" ก่อน เหตุผลที่บันทึกจะเป็น
      "ยังไม่มีบัญชี" ซึ่งพาผู้ดูแลไปเพิ่มบัญชีให้ที่อยู่ของระบบเอง
    */
    const d = decideIntake(mail({ from: SYSTEM }), ctx({ senderIsKnown: false }));
    expect(d).toMatchObject({ reason: REJECT.loop });
  });
});

describe('B · การตอบอัตโนมัติ', () => {
  it('หัวจดหมาย `Auto-Submitted` ที่ไม่ใช่ `no` = ตอบอัตโนมัติ', () => {
    const d = decideIntake(mail({ headers: { 'auto-submitted': 'auto-replied' } }), ctx());
    expect(d).toMatchObject({ action: 'reject', reason: REJECT.auto });
  });

  it('`Auto-Submitted: no` เป็นจดหมายของคนจริง', () => {
    // RFC บอกว่า `no` แปลว่าคนเขียน · ตัดทิ้งจะเสียจดหมายจริงไป
    expect(decideIntake(mail({ headers: { 'auto-submitted': 'no' } }), ctx())).toMatchObject({
      action: 'create',
    });
  });

  it('`Precedence: bulk` = จดหมายหมู่ ไม่ใช่คำขอ', () => {
    expect(decideIntake(mail({ headers: { precedence: 'bulk' } }), ctx())).toMatchObject({
      reason: REJECT.auto,
    });
  });

  it('หัวเรื่องแบบตอบอัตโนมัติ ทั้งไทยและอังกฤษ', () => {
    for (const s of ['Out of Office: กลับ 5 ก.ย.', 'Automatic reply', 'ตอบกลับอัตโนมัติ']) {
      expect(decideIntake(mail({ subject: s }), ctx()), s).toMatchObject({ reason: REJECT.auto });
    }
  });

  it('**`Re:` ต้องไม่ถูกนับว่าตอบอัตโนมัติ**', () => {
    /*
      คนตอบกลับจดหมายจริงก็ใช้ `Re:` เหมือนกัน · การตัดทิ้งจะทำให้ความเห็น
      ของคนหายไปทั้งหมด ซึ่งแย่กว่าการรับจดหมายอัตโนมัติบางฉบับ
    */
    const d = decideIntake(mail({ subject: 'Re: เครื่องพิมพ์ยังไม่หาย' }), ctx());
    expect(d).toMatchObject({ action: 'create' });
  });
});

describe('C · ผู้ส่งที่ไม่รู้จัก', () => {
  it('**ถูกปฏิเสธพร้อมเหตุผลที่บอกว่าต้องทำอะไรต่อ**', () => {
    const d = decideIntake(mail(), ctx({ senderIsKnown: false }));
    expect(d).toEqual({ action: 'reject', reason: REJECT.unknown });
    expect(REJECT.unknown).toContain('เพิ่มผู้ใช้');
  });
});

describe('D · ตัดข้อความที่ยกมา', () => {
  it('ตัดที่บรรทัด `On … wrote:`', () => {
    const body = stripQuoted(
      'ลองรีสตาร์ตแล้วยังไม่หายครับ\n\nOn Mon, 1 Sep 2026 at 10:00, Helix wrote:\n> ลองรีสตาร์ตดูไหมครับ',
    );
    expect(body).toBe('ลองรีสตาร์ตแล้วยังไม่หายครับ');
  });

  it('ตัดที่บรรทัดภาษาไทย', () => {
    const body = stripQuoted('ยังไม่หายครับ\n\nเมื่อ 1 ก.ย. 2569 Helix เขียนว่า:\n> ลองดูไหม');
    expect(body).toBe('ยังไม่หายครับ');
  });

  it('**ตัดแล้วไม่เหลืออะไร = เดาผิด ต้องคืนของเดิม**', () => {
    /*
      จดหมายที่ขึ้นต้นด้วย `From:` ทันที (คนส่งต่อโดยไม่พิมพ์อะไรเพิ่ม)
      ถ้าตัดตามกฎจะเหลือค่าว่าง แล้วคำขอทั้งฉบับหายไปโดยไม่มีอะไรฟ้อง
    */
    const raw = 'From: somchai@example.co.th\nเครื่องพิมพ์เสียครับ';
    expect(stripQuoted(raw)).toBe(raw);
  });

  it('ไม่มีอะไรให้ตัด ก็คืนข้อความเดิม', () => {
    expect(stripQuoted('  สั้น ๆ  ')).toBe('สั้น ๆ');
  });
});

describe('E · หาเรื่องเดิม', () => {
  it('**หัวจดหมายมาก่อนหัวเรื่อง**', () => {
    /*
      ถ้าสองทางชี้คนละเรื่อง ต้องเชื่อหัวจดหมาย เพราะโปรแกรมเมลไม่แก้มัน
      ส่วนหัวเรื่องคนแก้เองได้ และมักแก้
    */
    const d = decideIntake(
      mail({ subject: 'Re: [SD-9999] เรื่องเก่า', text: 'ยังไม่หายครับ' }),
      ctx({ threadItemKey: 'SD-1042' }),
    );
    expect(d).toEqual({ action: 'comment', itemKey: 'SD-1042', body: 'ยังไม่หายครับ' });
  });

  it('ไม่มีหัวจดหมาย ใช้คีย์ในหัวเรื่องแทน — ทางที่คนส่งต่อใช้จริง', () => {
    const d = decideIntake(
      mail({ subject: 'Fwd: [SD-1042] เครื่องพิมพ์', text: 'ฝากดูให้หน่อย' }),
      ctx(),
    );
    expect(d).toMatchObject({ action: 'comment', itemKey: 'SD-1042' });
  });

  it('**ความเห็นที่ไม่มีเนื้อความ ไม่ใช่ความเห็น**', () => {
    // หัวเรื่องอย่างเดียวไม่พอ · ความเห็นเปล่าทำให้กระทู้รกโดยไม่บอกอะไร
    const d = decideIntake(mail({ text: '' }), ctx({ threadItemKey: 'SD-1042' }));
    expect(d).toMatchObject({ action: 'reject', reason: REJECT.empty });
  });

  it('คีย์ที่หน้าตาไม่ใช่คีย์ ต้องไม่ถูกจับ', () => {
    // `[URGENT]` กับ `[2026-09]` ไม่ใช่คีย์เรื่อง
    for (const s of ['[URGENT] ด่วน', '[2026-09] สรุป', 'ไม่มีวงเล็บเลย']) {
      expect(itemKeyInSubject(s), s).toBeNull();
    }
    expect(itemKeyInSubject('[SD-1042] มี')).toBe('SD-1042');
  });
});

describe('F · สร้างเรื่องใหม่', () => {
  it('หัวเรื่องกลายเป็นชื่อเรื่อง เนื้อความกลายเป็นรายละเอียด', () => {
    const d = decideIntake(mail(), ctx());
    expect(d).toEqual({
      action: 'create',
      summary: 'เครื่องพิมพ์ชั้น 3 ใช้ไม่ได้',
      description: 'กดพิมพ์แล้วไฟกะพริบ ไม่มีกระดาษออกมาเลยครับ',
    });
  });

  it('ตัด `Re:` `Fwd:` ออกจากชื่อเรื่อง', () => {
    expect(cleanSubject('Re: Fwd: [SD-1] เครื่องพิมพ์')).toBe('เครื่องพิมพ์');
    expect(cleanSubject('ตอบกลับ: ขอสิทธิ์')).toBe('ขอสิทธิ์');
  });

  it('**หัวเรื่องว่างแต่มีเนื้อความ ยังเป็นคำขอที่ใช้ได้**', () => {
    /*
      คนพิมพ์เนื้อความแล้วลืมใส่หัวเรื่อง เป็นเรื่องปกติ · การปฏิเสธทั้งฉบับ
      ทำให้คำขอจริงหายไป จึงตั้งชื่อจากบรรทัดแรกให้แทน
    */
    const d = decideIntake(mail({ subject: '', text: 'ขอติดตั้งโปรแกรมหน่อยครับ\nด่วนด้วย' }), ctx());
    expect(d).toMatchObject({ action: 'create', summary: 'ขอติดตั้งโปรแกรมหน่อยครับ' });
  });

  it('ไม่มีทั้งหัวเรื่องและเนื้อความ = ไม่มีอะไรให้บันทึก', () => {
    expect(decideIntake(mail({ subject: '', text: '   ' }), ctx())).toMatchObject({
      reason: REJECT.empty,
    });
  });
});

describe('G · อ่านหัวจดหมายอ้างอิง', () => {
  it('**ทำให้ Message-ID อยู่ในรูปเดียวกันเสมอ**', () => {
    // สองรูปแบบทำให้เทียบกันไม่ตรง แล้วตอบกลับกลายเป็นตั๋วใบใหม่ทุกครั้ง
    expect(bracket('abc@x.local')).toBe('<abc@x.local>');
    expect(bracket('<abc@x.local>')).toBe('<abc@x.local>');
    expect(bracket('   ')).toBeNull();
    expect(bracket(null)).toBeNull();
  });

  it('**อ่านทั้ง In-Reply-To และ References**', () => {
    /*
      โปรแกรมเมลบางตัวตัด `In-Reply-To` ทิ้งแต่ยังเก็บ `References` ไว้ครบ ·
      อ่านแค่ตัวแรกแปลว่ากระทู้ที่มาจากโปรแกรมนั้นจะขาดตอนทุกครั้ง
    */
    const ids = parseReferences('<a@x>', '<a@x> <b@x> <c@x>');
    expect(ids).toEqual(['<a@x>', '<b@x>', '<c@x>']);
  });

  it('ไม่มีหัวจดหมายเลย ได้รายการว่าง ไม่ใช่ค่าที่ใช้ไม่ได้', () => {
    expect(parseReferences(undefined, undefined)).toEqual([]);
  });
});
