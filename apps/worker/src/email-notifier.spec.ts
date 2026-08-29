/**
 * ตัวส่งอีเมล — เทสต์เป็นข้อกำหนด
 *
 * เคสส่วนใหญ่ที่นี่คือ **เหตุผลที่จะไม่ส่ง** เพราะการส่งผิดหรือส่งซ้ำ
 * ทำให้คนเลิกเชื่อการแจ้งเตือนทั้งระบบ ซึ่งแพงกว่าการไม่ส่งหนึ่งครั้ง
 */
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  decide,
  renderEmail,
  runEmailDelivery,
  type DeliveryDeps,
  type PendingNotification,
} from './email-notifier';

const base: PendingNotification = {
  id: 1n,
  tenantId: 1n,
  title: 'SD-1042 หลุด SLA แล้ว',
  body: 'ระบบล่ม\nเป้าหมาย: แก้ไขให้เสร็จ · P1',
  itemKey: 'SD-1042',
  recipientEmail: 'agent1@example.test',
  recipientName: 'สมชาย',
  readAt: null,
  emailSuppressed: false,
};

const n = (over: Partial<PendingNotification> = {}): PendingNotification => ({ ...base, ...over });

describe('decide', () => {
  it('มีผู้รับและยังไม่อ่าน = ส่ง', () => {
    expect(decide(n())).toEqual({ send: true, to: 'agent1@example.test' });
  });

  it('**ผู้รับปิดอีเมลของชนิดนี้ไว้ = ไม่ส่ง**', () => {
    /*
      คำตอบนี้ตัดสินไปแล้วตั้งแต่ตอนสร้างแถวฝั่ง api · worker คำนวณนโยบายเองไม่ได้
      (เรียกโค้ดของ api ไม่ได้) และไม่ควรคำนวณด้วย — นโยบายสองชุดที่เขียนคนละที่
      จะเริ่มตอบต่างกันวันหนึ่งโดยไม่มีใครรู้
    */
    const d = decide(n({ emailSuppressed: true }));
    expect(d.send).toBe(false);
    expect(d).toMatchObject({ state: 'skipped' });
    expect('reason' in d ? d.reason : '').toContain('ปิดอีเมล');
  });

  it('**เหตุผลที่บันทึกต้องเป็น "เขาปิดไว้" ไม่ใช่เหตุผลรอง**', () => {
    /*
      ผู้รับที่ปิดอีเมลไว้ ไม่ต้องรู้ด้วยซ้ำว่าอีเมลของเขาถูกรูปแบบไหม ·
      เหตุผลที่ผู้ดูแลเอาไปทำอะไรได้คือ "เขาปิดไว้" ส่วน "อีเมลผิดรูปแบบ"
      จะพาไปแก้ผิดที่ · ลำดับการตรวจจึงสำคัญ ไม่ใช่แค่ผลลัพธ์
    */
    const d = decide(n({ emailSuppressed: true, recipientEmail: 'ไม่ใช่อีเมล' }));
    expect('reason' in d ? d.reason : '').toContain('ปิดอีเมล');
  });

  it('**อ่านบนหน้าเว็บไปแล้ว = ไม่ส่ง** — อีเมลซ้ำสิ่งที่เห็นแล้วมีแต่กวน', () => {
    const d = decide(n({ readAt: new Date('2026-08-25T10:00:00Z') }));
    expect(d.send).toBe(false);
    expect(d).toMatchObject({ state: 'skipped' });
  });

  it('การแจ้งเตือนระดับทีมที่โปรเจกต์ยังไม่ตั้งกลุ่ม = ข้าม พร้อมเหตุผลที่ชี้ทางแก้', () => {
    const d = decide(n({ recipientEmail: null }));
    expect(d).toMatchObject({ send: false, state: 'skipped' });
    // เหตุผลต้องบอกว่าต้องไปแก้ที่ไหน ไม่ใช่แค่ว่าส่งไม่ได้
    if (!d.send) expect(d.reason).toContain('notifyGroupId');
  });

  it('**การแจ้งเตือนระดับทีมส่งถึงทุกคนในกลุ่ม ฉบับเดียว**', () => {
    // ฉบับเดียวถึงทุกคน ไม่ใช่คนละฉบับ — การตอบกลับจะได้อยู่ที่เดียวกัน
    const d = decide(
      n({ recipientEmail: null, teamEmails: ['a@x.test', 'b@x.test'], teamName: 'IT Support' }),
    );
    expect(d).toEqual({ send: true, to: 'a@x.test, b@x.test' });
  });

  it('กลุ่มที่มีแต่อีเมลผิดรูปแบบ = ข้าม ไม่ใช่ส่งไปที่ขยะ', () => {
    const d = decide(n({ recipientEmail: null, teamEmails: ['ไม่ใช่อีเมล', '  '] }));
    expect(d).toMatchObject({ send: false, state: 'skipped' });
  });

  it('กลุ่มที่มีอีเมลถูกบ้างผิดบ้าง = ส่งเฉพาะที่ถูก', () => {
    const d = decide(n({ recipientEmail: null, teamEmails: ['ok@x.test', 'พัง'] }));
    expect(d).toEqual({ send: true, to: 'ok@x.test' });
  });

  it('แจ้งระดับทีมที่มีคนอ่านบนเว็บแล้ว = ไม่ส่ง แม้จะมีปลายทาง', () => {
    const d = decide(
      n({ recipientEmail: null, teamEmails: ['a@x.test'], readAt: new Date('2026-08-25T10:00:00Z') }),
    );
    expect(d).toMatchObject({ send: false, state: 'skipped' });
  });

  it('อีเมลว่างเปล่า (สตริงว่าง) นับเป็นไม่มีผู้รับ ไม่ใช่พยายามส่งไปที่ว่าง', () => {
    expect(decide(n({ recipientEmail: '   ' }))).toMatchObject({ send: false, state: 'skipped' });
  });

  it('อีเมลผิดรูปแบบ = ข้าม และบอกค่าที่ผิดในเหตุผล', () => {
    const d = decide(n({ recipientEmail: 'ไม่ใช่อีเมล' }));
    expect(d).toMatchObject({ send: false, state: 'skipped' });
    if (!d.send) expect(d.reason).toContain('ไม่ใช่อีเมล');
  });
});

describe('renderEmail', () => {
  const WEB = 'https://helix.example';

  it('หัวเรื่องขึ้นต้นด้วยคีย์งาน — กล่องจดหมายจะจัดกลุ่มและค้นหาได้', () => {
    expect(renderEmail(n({ title: 'มีคนมอบหมายงานให้คุณ' }), WEB).subject).toBe(
      '[SD-1042] มีคนมอบหมายงานให้คุณ',
    );
  });

  it('**ไม่เติมคีย์ซ้ำ** เมื่อหัวข้อขึ้นต้นด้วยคีย์นั้นอยู่แล้ว', () => {
    // ข้อความ SLA ขึ้นต้นด้วยคีย์งานเป็นปกติ ถ้าเติมอีกจะได้
    // "[SD-1042] SD-1042 หลุด SLA แล้ว" ซึ่งกินที่ preview บนมือถือฟรี ๆ
    expect(renderEmail(n(), WEB).subject).toBe('SD-1042 หลุด SLA แล้ว');
  });

  it('ไม่มีคีย์งานก็ยังมีหัวเรื่อง ไม่ใช่วงเล็บเปล่า', () => {
    expect(renderEmail(n({ itemKey: null }), WEB).subject).toBe('SD-1042 หลุด SLA แล้ว');
  });

  it('มีลิงก์เปิดงานที่กดได้จริง', () => {
    expect(renderEmail(n(), WEB).text).toContain('https://helix.example/browse/SD-1042');
  });

  it('ไม่มีคีย์งาน = ไม่มีลิงก์ที่พาไปหน้าที่ไม่มีอยู่', () => {
    expect(renderEmail(n({ itemKey: null }), WEB).text).not.toContain('/browse/');
  });

  it('ทักด้วยชื่อผู้รับเมื่อรู้ชื่อ', () => {
    expect(renderEmail(n(), WEB).text).toContain('เรียน สมชาย');
  });

  it('ไม่รู้ชื่อและไม่มีทีม ก็ไม่ทักลอย ๆ ว่า "เรียน "', () => {
    expect(renderEmail(n({ recipientName: null }), WEB).text).not.toContain('เรียน ');
  });

  it('อีเมลถึงทีมบอกชื่อทีม และบอกว่าทำไมถึงได้รับ', () => {
    const t = renderEmail(
      n({ recipientName: null, recipientEmail: null, teamName: 'IT Support' }),
      WEB,
    ).text;
    expect(t).toContain('เรียนทีม IT Support');
    // ทีมต้องรู้ว่าได้รับเพราะงานยังไม่มีเจ้าของ ไม่ใช่งงว่าทำไมถึงมาถึงตัวเอง
    expect(t).toContain('ยังไม่มีผู้รับผิดชอบ');
    // เว้นบรรทัดก่อนหัวข้อ เหมือนอีเมลที่ส่งถึงตัวบุคคล
    expect(t.split('\n\n')[1]).toBe('งานใบนี้ยังไม่มีผู้รับผิดชอบ');
  });

  it('รายละเอียดว่างไม่ทิ้งบรรทัดว่างซ้อนกัน', () => {
    const t = renderEmail(n({ body: '   ' }), WEB).text;
    expect(t).not.toMatch(/\n\n\n/);
  });

  it('บอกว่าเป็นอีเมลอัตโนมัติ — คนจะได้ไม่ตอบกลับแล้วรอคำตอบ', () => {
    expect(renderEmail(n(), WEB).text).toContain('ไม่ต้องตอบกลับ');
  });

  it('เป็นข้อความล้วน ไม่มีแท็ก HTML หลุดเข้ามา', () => {
    expect(renderEmail(n(), WEB).text).not.toMatch(/<[a-z]/i);
  });
});

describe('runEmailDelivery', () => {
  const mk = (rows: PendingNotification[], over: Partial<DeliveryDeps> = {}) => {
    const log = { claimed: [] as bigint[], sent: [] as string[], skipped: [] as string[], failed: [] as string[] };
    const deps: DeliveryDeps = {
      loadUndelivered: async () => rows,
      claim: async (id) => {
        log.claimed.push(id);
        return true;
      },
      markSent: async () => undefined,
      markFailed: async (_id, e) => {
        log.failed.push(e);
      },
      markSkipped: async (_id, r) => {
        log.skipped.push(r);
      },
      mailer: {
        send: async (m) => {
          log.sent.push(m.to);
        },
      },
      webBaseUrl: 'https://helix.example',
      ...over,
    };
    return { deps, log };
  };

  it('ส่งใบที่ควรส่ง และรายงานจำนวนตรง', async () => {
    const { deps, log } = mk([n({ id: 1n }), n({ id: 2n, recipientEmail: 'b@example.test' })]);
    expect(await runEmailDelivery(deps)).toEqual({ scanned: 2, sent: 2, skipped: 0, failed: 0 });
    expect(log.sent).toEqual(['agent1@example.test', 'b@example.test']);
  });

  it('**จองก่อนส่งเสมอ** — ไม่งั้นเครื่องดับกลางทางจะส่งซ้ำทั้งชุดตอนกลับมา', async () => {
    const order: string[] = [];
    const { deps } = mk([n()], {
      claim: async () => {
        order.push('claim');
        return true;
      },
      mailer: {
        send: async () => {
          order.push('send');
        },
      },
    });
    await runEmailDelivery(deps);
    expect(order).toEqual(['claim', 'send']);
  });

  it('จองไม่ได้ (มีคนจองไปแล้ว) = ไม่ส่ง ไม่นับ', async () => {
    const { deps, log } = mk([n()], { claim: async () => false });
    expect(await runEmailDelivery(deps)).toEqual({ scanned: 1, sent: 0, skipped: 0, failed: 0 });
    expect(log.sent).toEqual([]);
  });

  it('ใบที่ข้ามก็ต้องจองด้วย — รอบหน้าจะได้ไม่มาตัดสินใจเรื่องเดิมซ้ำ', async () => {
    const { deps, log } = mk([n({ recipientEmail: null })]);
    const r = await runEmailDelivery(deps);
    expect(r.skipped).toBe(1);
    expect(log.claimed).toEqual([1n]);
    expect(log.skipped[0]).toBeTruthy();
  });

  it('**ใบหนึ่งล้มไม่ทำให้ใบอื่นไม่ได้รับ**', async () => {
    let calls = 0;
    const { deps, log } = mk([n({ id: 1n }), n({ id: 2n }), n({ id: 3n })], {
      mailer: {
        send: async (m) => {
          calls += 1;
          if (calls === 2) throw new Error('SMTP ปฏิเสธผู้รับ');
          log.sent.push(m.to);
        },
      },
    });
    const r = await runEmailDelivery(deps);
    expect(r).toEqual({ scanned: 3, sent: 2, skipped: 0, failed: 1 });
    expect(log.failed[0]).toContain('SMTP');
  });

  it('ไม่มีอะไรค้าง = ไม่ติดต่อ SMTP เลย', async () => {
    let touched = false;
    const { deps } = mk([], {
      mailer: {
        send: async () => {
          touched = true;
        },
      },
    });
    expect(await runEmailDelivery(deps)).toEqual({ scanned: 0, sent: 0, skipped: 0, failed: 0 });
    expect(touched).toBe(false);
  });

  it('ส่ง limit ต่อไปให้ตัวโหลด', async () => {
    let got = -1;
    const { deps } = mk([], {
      loadUndelivered: async (l: number) => {
        got = l;
        return [];
      },
    });
    await runEmailDelivery(deps, 7);
    expect(got).toBe(7);
  });
});

describe('สายต่อใน main.ts', () => {
  /*
    `decide()` ตัดสินถูกไม่ได้แปลว่าค่าเดินทางมาถึงมัน · `main.ts` เป็นชั้น
    ประกอบร่างที่ไม่มีเทสต์ไหนแตะ — ตอนลบกลไกทีละบรรทัด การเปลี่ยน mapping
    ให้ส่ง `false` ตายตัว ยังเขียวทั้ง 60 เคส · เทสต์นี้ปิดช่องนั้น

    สแกนซอร์สจริง ไม่ใช่เชื่อว่าเขียนไว้แล้ว
  */
  const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');

  it('ตัวสแกนอ่านไฟล์เจอจริง', () => {
    expect(main).toContain('loadUndelivered');
    expect(main).not.toContain('ข้อความที่ไม่มีอยู่จริงในไฟล์นี้');
  });

  it('**เลือกคอลัมน์ emailSuppressed มาจากฐานข้อมูล**', () => {
    expect(main).toContain('emailSuppressed: true');
  });

  it('**ส่งต่อค่าจริง ไม่ใช่ค่าตายตัว**', () => {
    expect(main).toContain('emailSuppressed: r.emailSuppressed');
    expect(main).not.toContain('emailSuppressed: false');
  });
});
