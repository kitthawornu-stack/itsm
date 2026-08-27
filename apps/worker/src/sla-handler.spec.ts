/**
 * ตัวจัดการแจ้งเตือน SLA — เน้นเคสที่ **ต้องไม่ส่ง**
 *
 * job ถูกตั้งล่วงหน้าเป็นชั่วโมง สถานะจึงเปลี่ยนได้ระหว่างรอ
 * การส่งตามที่ตั้งไว้โดยไม่ตรวจซ้ำ จะได้ข้อความที่ขัดกับหน้าจอ
 * ซึ่งแย่กว่าการไม่ส่งเลย เพราะผู้ใช้จะเลิกเชื่อการแจ้งเตือนทั้งระบบ
 */
import { describe, expect, it, vi } from 'vitest';

import { createSlaHandler, type HandlerDeps } from './sla-handler';

const payload = {
  tenantId: '1',
  workItemId: '42',
  workItemSlaId: '7',
  threshold: 0.75,
  scheduledFor: '2026-08-25T05:00:00.000Z',
};

/**
 * mock ที่มีชนิดจริง
 *
 * เดิมเป็น `vi.fn().mockResolvedValue({...})` ซึ่ง TypeScript ไม่ตรวจอะไรเลย
 * ตอนเพิ่มฟิลด์ `trusted` เข้าไปในสัญญา mock ทุกตัวจึงคืน `undefined` เงียบ ๆ
 * แล้วเทสต์ทั้ง 54 ตัวก็ยังเขียว ทั้งที่วิ่งเข้ากิ่งตรงข้ามกับที่ตั้งใจ
 *
 * **mock ที่เป็น any คือ mock ที่ไม่มีวันแดงเมื่อสัญญาเปลี่ยน**
 */
type SlaState = Awaited<ReturnType<HandlerDeps['recompute']>>;
const state = (o: Partial<NonNullable<SlaState>> = {}): SlaState => ({
  state: 'running',
  ratio: 0.8,
  goalName: 'P2',
  trusted: true,
  ...o,
});

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  const create = vi.fn().mockResolvedValue({ id: 1n });
  return {
    prisma: {
      workItem: {
        findFirst: vi.fn().mockResolvedValue({
          itemKey: 'SD-42',
          summary: 'ระบบล่ม',
          assigneeId: 5n,
          reporterId: 9n,
        }),
      },
      notification: { create },
    } as unknown as HandlerDeps['prisma'],
    recompute: vi.fn<HandlerDeps['recompute']>().mockResolvedValue(state()),
    dedupeKey: (id, t) => `sla-threshold:${id.toString()}:${String(Math.round(t * 100))}`,
    text: (p) => ({
      title: `${p.itemKey} ${String(Math.round(p.threshold * 100))}%${p.trusted ? '' : ' (เชื่อไม่ได้)'}`,
      body: p.summary,
    }),
    ...overrides,
  };
}

describe('ส่งเมื่อเงื่อนไขครบ', () => {
  it('ส่งเมื่อนาฬิกายังเดินและข้ามเกณฑ์แล้ว', async () => {
    const d = deps();
    expect(await createSlaHandler(d)(payload)).toBe('sent');
    expect(d.prisma.notification.create).toHaveBeenCalledOnce();
  });

  it('ส่งถึงผู้รับผิดชอบ', async () => {
    const d = deps();
    await createSlaHandler(d)(payload);
    const arg = vi.mocked(d.prisma.notification.create).mock.calls[0]?.[0] as {
      data: { userId: bigint; dedupeKey: string };
    };
    expect(arg.data.userId).toBe(5n);
    expect(arg.data.dedupeKey).toBe('sla-threshold:7:75');
  });

  it('งานที่ยังไม่มีผู้รับผิดชอบ ส่งเป็นการแจ้งเตือนระดับทีม (userId = null)', async () => {
    const d = deps();
    vi.mocked(d.prisma.workItem.findFirst).mockResolvedValue({
      itemKey: 'SD-42',
      summary: 'x',
      assigneeId: null,
      reporterId: 9n,
    } as never);
    await createSlaHandler(d)(payload);
    const arg = vi.mocked(d.prisma.notification.create).mock.calls[0]?.[0] as {
      data: { userId: bigint | null };
    };
    expect(arg.data.userId).toBeNull();
  });

  it('เกณฑ์ 100% ที่หลุดไปแล้ว ยังต้องส่ง', async () => {
    const d = deps({
      recompute: vi.fn<HandlerDeps['recompute']>().mockResolvedValue(state({ state: 'breached', ratio: 1.4, goalName: 'P1' })),
    });
    expect(await createSlaHandler(d)({ ...payload, threshold: 1 })).toBe('sent');
  });
});

describe('ต้องไม่ส่ง', () => {
  it('ตั๋วถูกปิดไปแล้วระหว่างรอ', async () => {
    const d = deps({ recompute: vi.fn<HandlerDeps['recompute']>().mockResolvedValue(state({ state: 'met', ratio: 0.9 })) });
    expect(await createSlaHandler(d)(payload)).toBe('skipped');
    expect(d.prisma.notification.create).not.toHaveBeenCalled();
  });

  it('ตั๋วถูกพักไปแล้วระหว่างรอ', async () => {
    const d = deps({ recompute: vi.fn<HandlerDeps['recompute']>().mockResolvedValue(state({ state: 'paused', ratio: 0.9 })) });
    expect(await createSlaHandler(d)(payload)).toBe('skipped');
  });

  it('เป้าถูกขยายจนยังไม่ถึงเกณฑ์แล้ว', async () => {
    // ตั๋วถูกลดความสำคัญ เป้าจึงยาวขึ้น ratio ตกกลับมาต่ำกว่าเกณฑ์
    const d = deps({ recompute: vi.fn<HandlerDeps['recompute']>().mockResolvedValue(state({ ratio: 0.3, goalName: 'P4' })) });
    expect(await createSlaHandler(d)(payload)).toBe('skipped');
    expect(d.prisma.notification.create).not.toHaveBeenCalled();
  });

  it('นาฬิกาหายไปแล้ว (ตั๋วถูกลบ หรือ policy ถูกถอด)', async () => {
    const d = deps({ recompute: vi.fn<HandlerDeps['recompute']>().mockResolvedValue(null) });
    expect(await createSlaHandler(d)(payload)).toBe('skipped');
  });

  it('หางานไม่เจอ', async () => {
    const d = deps();
    vi.mocked(d.prisma.workItem.findFirst).mockResolvedValue(null as never);
    expect(await createSlaHandler(d)(payload)).toBe('skipped');
  });

  it('ratio เท่าเกณฑ์พอดี ถือว่าถึงแล้ว ต้องส่ง', async () => {
    const d = deps({ recompute: vi.fn<HandlerDeps['recompute']>().mockResolvedValue(state({ ratio: 0.75 })) });
    expect(await createSlaHandler(d)(payload)).toBe('sent');
  });
});

describe('กันส่งซ้ำ', () => {
  it('unique violation ถือเป็น duplicate ไม่ใช่ error', async () => {
    const d = deps();
    vi.mocked(d.prisma.notification.create).mockRejectedValue({ code: 'P2002' } as never);
    expect(await createSlaHandler(d)(payload)).toBe('duplicate');
  });

  it('error อื่นต้องโยนต่อ เพื่อให้ BullMQ ลองใหม่', async () => {
    const d = deps();
    vi.mocked(d.prisma.notification.create).mockRejectedValue(new Error('เชื่อมต่อฐานข้อมูลไม่ได้') as never);
    await expect(createSlaHandler(d)(payload)).rejects.toThrow('เชื่อมต่อฐานข้อมูลไม่ได้');
  });
});

/**
 * ตัวเลขที่คำนวณจากปฏิทินที่ยังไม่มีใครยืนยัน
 *
 * ทางเลือกมีสองทางและทั้งคู่มีราคา: เงียบไปเลยแปลว่าคนที่หลุดจริงไม่มีใครเตือน ·
 * ส่งแบบยืนยันหนักแน่นแปลว่าอาจบอกคนว่าเขาทำงานช้าในวันที่เขาไม่ได้มาทำงาน
 * ซึ่ง CLAUDE.md บันทึกไว้ว่าเป็นความผิดพลาดที่ทำให้เลิกเชื่อตัวเลข SLA ทั้งระบบ
 *
 * ทางที่เลือกคือ **ส่ง แต่ไม่กล่าวหา** — บอกความจริงว่าตัวเลขนี้เชื่อไม่ได้
 */
describe('ปฏิทินที่ยังไม่ได้ยืนยัน', () => {
  const untrusted = (): HandlerDeps =>
    deps({ recompute: vi.fn<HandlerDeps['recompute']>().mockResolvedValue(state({ trusted: false })) });

  it('**ยังส่งอยู่** — เงียบไปแปลว่าคนที่หลุดจริงไม่มีใครเตือน', async () => {
    const d = untrusted();
    expect(await createSlaHandler(d)(payload)).toBe('sent');
  });

  it('**แต่ไม่ใช้คำที่ยืนยัน** — ข้อความต้องบอกว่าตัวเลขเชื่อไม่ได้', async () => {
    const d = untrusted();
    await createSlaHandler(d)(payload);
    const arg = vi.mocked(d.prisma.notification.create).mock.calls[0]?.[0] as {
      data: { title: string };
    };
    expect(arg.data.title).toContain('เชื่อไม่ได้');
  });

  it('แยก kind ออก เพื่อให้นับย้อนหลังได้ว่าเตือนบนตัวเลขที่เชื่อไม่ได้กี่ครั้ง', async () => {
    const d = untrusted();
    await createSlaHandler(d)(payload);
    const arg = vi.mocked(d.prisma.notification.create).mock.calls[0]?.[0] as unknown as {
      data: { kind: string; payload: { calendarTrusted: boolean } };
    };
    expect(arg.data.kind).toBe('sla.threshold.untrusted');
    expect(arg.data.payload.calendarTrusted).toBe(false);
  });

  it('ปฏิทินที่ยืนยันแล้วใช้คำเดิมและ kind เดิม', async () => {
    const d = deps();
    await createSlaHandler(d)(payload);
    const arg = vi.mocked(d.prisma.notification.create).mock.calls[0]?.[0] as {
      data: { kind: string; title: string };
    };
    expect(arg.data.kind).toBe('sla.threshold');
    expect(arg.data.title).not.toContain('เชื่อไม่ได้');
  });
});
