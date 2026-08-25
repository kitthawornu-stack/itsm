/**
 * ตัวส่งอีเมล — เทสต์เป็นข้อกำหนด
 *
 * เคสส่วนใหญ่ที่นี่คือ **เหตุผลที่จะไม่ส่ง** เพราะการส่งผิดหรือส่งซ้ำ
 * ทำให้คนเลิกเชื่อการแจ้งเตือนทั้งระบบ ซึ่งแพงกว่าการไม่ส่งหนึ่งครั้ง
 */
import { describe, expect, it } from 'vitest';

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
};

const n = (over: Partial<PendingNotification> = {}): PendingNotification => ({ ...base, ...over });

describe('decide', () => {
  it('มีผู้รับและยังไม่อ่าน = ส่ง', () => {
    expect(decide(n())).toEqual({ send: true, to: 'agent1@example.test' });
  });

  it('**อ่านบนหน้าเว็บไปแล้ว = ไม่ส่ง** — อีเมลซ้ำสิ่งที่เห็นแล้วมีแต่กวน', () => {
    const d = decide(n({ readAt: new Date('2026-08-25T10:00:00Z') }));
    expect(d.send).toBe(false);
    expect(d).toMatchObject({ state: 'skipped' });
  });

  it('การแจ้งเตือนระดับทีมที่ไม่มีผู้รับ = ข้าม พร้อมเหตุผล ไม่ใช่ค้างเป็น pending', () => {
    const d = decide(n({ recipientEmail: null }));
    expect(d).toMatchObject({ send: false, state: 'skipped' });
    // เหตุผลต้องอ่านรู้เรื่องโดยไม่ต้องเปิด log — แถวที่ค้างโดยไม่มีเหตุผลสืบต่อไม่ได้
    if (!d.send) expect(d.reason.length).toBeGreaterThan(10);
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

  it('ไม่รู้ชื่อก็ไม่ทักลอย ๆ ว่า "เรียน "', () => {
    expect(renderEmail(n({ recipientName: null }), WEB).text).not.toContain('เรียน ');
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
