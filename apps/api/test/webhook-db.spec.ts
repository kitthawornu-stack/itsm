/**
 * Webhook — ต่อของจริง
 *
 * `webhook-policy.spec.ts` พิสูจน์ว่ากติกาตัดสินถูกเมื่อค่าถูกส่งเข้าไป ·
 * ไฟล์นี้ถามคำถามที่กติกาตอบไม่ได้:
 *
 *   1. **มีอะไรจองแถวให้จริงไหม** — เอนจินไม่รู้ว่ามีใครเรียกมันหรือเปล่า
 *   2. **แถวจองเกิดก่อนยิง HTTP จริงไหม** — ถ้าเกิดหลัง เครื่องที่ดับระหว่างรอ
 *      จะส่งซ้ำทั้งชุดโดยไม่มีอะไรจำได้
 *   3. **ปลายทางที่ล่มหนึ่งราย ทำให้อีกรายไม่ได้รับหรือเปล่า**
 *   4. **ความลับหลุดออกทาง API ไหม** — ถ้าหลุด ใครเปิดหน้าตั้งค่าได้
 *      ก็ปลอมคำขอเป็นระบบเราได้
 *
 * ตัวส่งจริงถูกฉีดเข้ามา — ไม่มีเซิร์ฟเวอร์ปลอมและไม่มีการต่อเน็ตในเทสต์
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toUtcDate, type TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { tenantTransaction } from '../src/infrastructure/prisma/tenant-scope';
import { PermissionDeniedError } from '../src/modules/permission';
import {
  DuplicateWebhookNameError,
  InvalidWebhookUrlError,
  MAX_ATTEMPTS,
  UnknownWebhookEventError,
  createWebhook,
  deleteWebhook,
  dispatchDue,
  listWebhooks,
  queueWebhooks,
  rotateWebhookSecret,
  signPayload,
  updateWebhook,
} from '../src/modules/integration';

const STAMP = String(Date.now()).slice(-6);
const STARTED_AT = new Date();
const NAME = (tag: string): string => `QA ปลายทาง ${tag} ${STAMP}`;
const KNOWN = ['item.created', 'item.transitioned', 'comment.added', 'sla.breached', 'item.idle'];

let tenantId: bigint;
let ctx: TenantContext;
let outsiderCtx: TenantContext;
let outsiderId: bigint;
const madeIds: bigint[] = [];

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

async function hook(tag: string, events: string[] = ['item.created']): Promise<bigint> {
  const r = await createWebhook(
    ctx,
    { name: NAME(tag), url: `http://127.0.0.1:9/qa-${STAMP}-${tag}`, events },
    KNOWN,
  );
  madeIds.push(r.id);
  return r.id;
}

/** จองคิวหนึ่งเหตุการณ์ผ่านเส้นทางจริง */
async function queue(event: string): Promise<number> {
  return tenantTransaction(ctx, async (tx) =>
    queueWebhooks(ctx, tx, event, { event, itemKey: `SD-QA${STAMP}` }),
  );
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;
  const grant = await prismaClient.permissionGrant.findFirstOrThrow({
    where: { tenantId, permission: 'ADMINISTER_TENANT', groupId: { not: null } },
    select: { groupId: true },
  });
  const member = await prismaClient.groupMember.findFirstOrThrow({
    where: { groupId: grant.groupId ?? BigInt(0) },
    select: { userId: true },
  });
  ctx = { tenantId, actorId: member.userId };

  const outsider = await prismaClient.user.create({
    data: {
      tenantId,
      email: `qa-hook-${STAMP}@example.invalid`,
      displayName: `QA คนนอก ${STAMP}`,
    },
    select: { id: true },
  });
  outsiderId = outsider.id;
  outsiderCtx = { tenantId, actorId: outsider.id };
}, 120_000);

afterAll(async () => {
  /*
    ลบทุกแถวที่เกิดในช่วงเทสต์ ไม่ใช่เฉพาะที่จำ id ไว้ — เคส "ชื่อว่างถูกปฏิเสธ"
    ไม่ควรสร้างอะไร แต่ตอนถอดกลไกเพื่อพิสูจน์ว่าแดงได้ มันจะสร้างจริง
  */
  await step('ใบส่งของเทสต์', () =>
    prismaClient.webhookDelivery.deleteMany({
      where: { OR: [{ webhookId: { in: madeIds } }, { createdAt: { gte: STARTED_AT } }] },
    }),
  );
  await step('ปลายทางของเทสต์', () =>
    prismaClient.webhook.deleteMany({
      where: { OR: [{ name: { contains: STAMP } }, { createdAt: { gte: STARTED_AT } }] },
    }),
  );
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({
      where: { entityType: 'webhook', createdAt: { gte: STARTED_AT } },
    }),
  );
  await step('ผู้ใช้ของเทสต์', () => prismaClient.user.deleteMany({ where: { id: outsiderId } }));

  const left = await prismaClient.webhook.count({
    where: { OR: [{ name: { contains: STAMP } }, { createdAt: { gte: STARTED_AT } }] },
  });
  if (left > 0) console.error(`เหลือปลายทางของเทสต์ค้างอยู่ ${String(left)} รายการ`);
  await prismaClient.$disconnect();
});

// ============================================================

describe('webhook(จริง) · A · ทะเบียนปลายทาง', () => {
  it('สร้างแล้วอ่านกลับได้', async () => {
    await hook('สร้าง');
    const rows = (await listWebhooks(ctx)).filter((r) => r.name.includes(STAMP));
    expect(rows.map((r) => r.name)).toContain(NAME('สร้าง'));
  });

  /**
   * **ความลับต้องไม่ออกมาทางรายการ**
   *
   * ถ้าออกมา ใครที่เปิดหน้าตั้งค่าได้ก็ปลอมคำขอเป็นระบบเราไปหาปลายทางได้
   * · ค่านี้ออกจากเซิร์ฟเวอร์ครั้งเดียวตอนสร้างหรือตอนตั้งใหม่เท่านั้น
   */
  it('รายการไม่มีความลับติดมาด้วย', async () => {
    const rows = await listWebhooks(ctx);
    for (const r of rows) {
      expect(Object.keys(r)).not.toContain('secret');
      expect(JSON.stringify(r)).not.toMatch(/[0-9a-f]{64}/);
    }
  });

  it('ตอนสร้างได้ความลับมาครั้งเดียว และยาวพอ', async () => {
    const r = await createWebhook(
      ctx,
      { name: NAME('ความลับ'), url: 'https://example.invalid/hook', events: ['item.created'] },
      KNOWN,
    );
    madeIds.push(r.id);
    expect(r.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ตั้งความลับใหม่ได้ค่าใหม่ ไม่ใช่ค่าเดิม', async () => {
    const id = await hook('หมุนกุญแจ');
    const a = await rotateWebhookSecret(ctx, id);
    const b = await rotateWebhookSecret(ctx, id);
    expect(a.secret).not.toBe(b.secret);
  });

  it('ชื่อซ้ำถูกปฏิเสธ', async () => {
    await hook('ชื่อซ้ำ');
    await expect(
      createWebhook(
        ctx,
        { name: NAME('ชื่อซ้ำ'), url: 'https://example.invalid/x', events: [] },
        KNOWN,
      ),
    ).rejects.toThrow(DuplicateWebhookNameError);
  });

  it('ที่อยู่ที่ไม่ใช่ http/https ถูกปฏิเสธ ไม่ใช่เก็บไว้แล้วล้มตอนส่ง', async () => {
    for (const bad of ['ftp://x/y', 'javascript:alert(1)', 'ไม่ใช่ที่อยู่', '']) {
      await expect(
        createWebhook(ctx, { name: NAME(`ผิด${bad}`), url: bad, events: [] }, KNOWN),
        bad,
      ).rejects.toThrow(InvalidWebhookUrlError);
    }
  });

  it('เหตุการณ์ที่ระบบไม่รู้จักถูกปฏิเสธ', async () => {
    await expect(
      createWebhook(
        ctx,
        { name: NAME('ชนิดมั่ว'), url: 'https://example.invalid/x', events: ['ไม่มีจริง'] },
        KNOWN,
      ),
    ).rejects.toThrow(UnknownWebhookEventError);
  });

  it('คนที่ไม่ใช่ผู้ดูแลองค์กร แตะทะเบียนไม่ได้เลย', async () => {
    await expect(listWebhooks(outsiderCtx)).rejects.toThrow(PermissionDeniedError);
    await expect(
      createWebhook(
        outsiderCtx,
        { name: NAME('คนนอก'), url: 'https://example.invalid/x', events: [] },
        KNOWN,
      ),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('ลบแล้วใบส่งหายตาม ไม่เหลือแถวกำพร้า', async () => {
    const id = await hook('ลบ');
    await queue('item.created');
    await deleteWebhook(ctx, id);
    expect(await prismaClient.webhookDelivery.count({ where: { webhookId: id } })).toBe(0);
  });
});

// ============================================================

describe('webhook(จริง) · B · การจองคิว', () => {
  it('ปลายทางที่สนใจเหตุการณ์ ได้ใบจอง', async () => {
    const id = await hook('จอง', ['item.created']);
    const n = await queue('item.created');
    expect(n).toBeGreaterThan(0);
    expect(
      await prismaClient.webhookDelivery.count({ where: { webhookId: id, state: 'pending' } }),
    ).toBe(1);
  });

  it('ปลายทางที่ไม่ได้สนใจเหตุการณ์นั้น ไม่ได้ใบจอง', async () => {
    const id = await hook('ไม่สน', ['comment.added']);
    await queue('sla.breached');
    expect(await prismaClient.webhookDelivery.count({ where: { webhookId: id } })).toBe(0);
  });

  /** รายการว่าง = ไม่รับอะไรเลย — ผ่านเส้นทางจริง ไม่ใช่แค่ในเอนจิน */
  it('ปลายทางที่ยังไม่เลือกเหตุการณ์เลย ไม่ได้ใบจอง', async () => {
    const id = await hook('ว่าง', []);
    await queue('item.created');
    expect(await prismaClient.webhookDelivery.count({ where: { webhookId: id } })).toBe(0);
  });

  it('ปลายทางที่ปิดอยู่ ไม่ได้ใบจอง', async () => {
    const id = await hook('ปิดอยู่');
    await updateWebhook(ctx, id, { isActive: false }, KNOWN);
    await queue('item.created');
    expect(await prismaClient.webhookDelivery.count({ where: { webhookId: id } })).toBe(0);
  });

  /**
   * **แถวจองเกิดก่อนยิง HTTP**
   *
   * พิสูจน์ด้วยการจองแล้วยังไม่เรียกตัวส่งเลย — ต้องมีแถวรออยู่แล้ว
   * ถ้าแถวเกิดหลังส่งสำเร็จ เครื่องที่ดับระหว่างรอปลายทางตอบจะกลับมาส่งซ้ำ
   * ทั้งชุดโดยไม่มีอะไรจำได้ (กติกา "จองก่อนทำ")
   */
  it('จองแล้วมีแถวรออยู่ก่อนที่ตัวส่งจะถูกเรียกสักครั้ง', async () => {
    const id = await hook('จองก่อนส่ง');
    await queue('item.created');
    const row = await prismaClient.webhookDelivery.findFirstOrThrow({
      where: { webhookId: id },
      select: { state: true, attempts: true, sentAt: true, payload: true },
    });
    expect(row.state).toBe('pending');
    expect(row.attempts).toBe(0);
    expect(row.sentAt).toBeNull();
    expect(row.payload).toContain(`SD-QA${STAMP}`);
  });
});

// ============================================================

describe('webhook(จริง) · C · การส่งจริง', () => {
  const now = toUtcDate(new Date());

  /*
    ล้างใบที่ค้างจากหมวดก่อนหน้าก่อนทุกเคส

    `dispatchDue` หยิบทีละชุดตามเพดาน (ซึ่งถูกต้อง — รอบเดียวต้องไม่กินเวลา
    จนตัวเรียกถัดไปซ้อน) · เทสต์ที่ปล่อยให้ใบค้างสะสม จะพึ่งว่าใบของตัวเอง
    บังเอิญอยู่ในชุดแรก แล้วแดงแบบสุ่มเมื่อมีคนเพิ่มเคสข้างบน
  */
  beforeEach(async () => {
    await prismaClient.webhookDelivery.deleteMany({ where: { webhookId: { in: madeIds } } });
  });

  it('ปลายทางตอบ 200 → ใบเปลี่ยนเป็นส่งแล้ว', async () => {
    const id = await hook('ตอบ200');
    await queue('item.created');
    const r = await dispatchDue(ctx, now, async () => Promise.resolve(200));
    expect(r.sent).toBeGreaterThan(0);
    const row = await prismaClient.webhookDelivery.findFirstOrThrow({ where: { webhookId: id } });
    expect(row.state).toBe('sent');
    expect(row.sentAt).not.toBeNull();
  });

  it('ปลายทางตอบ 500 → รอลองใหม่ พร้อมเวลาที่จะลอง', async () => {
    const id = await hook('ตอบ500');
    await queue('item.created');
    await dispatchDue(ctx, now, async () => Promise.resolve(500));
    const row = await prismaClient.webhookDelivery.findFirstOrThrow({ where: { webhookId: id } });
    expect(row.state).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt).not.toBeNull();
  });

  /** 4xx คือปลายทางปฏิเสธ — เลิกทันที ไม่ยิงซ้ำห้าครั้งที่รู้ว่าจะล้ม */
  it('ปลายทางตอบ 400 → เลิกทันที ไม่รอลองใหม่', async () => {
    const id = await hook('ตอบ400');
    await queue('item.created');
    await dispatchDue(ctx, now, async () => Promise.resolve(400));
    const row = await prismaClient.webhookDelivery.findFirstOrThrow({ where: { webhookId: id } });
    expect(row.state).toBe('giving-up');
    expect(row.nextAttemptAt).toBeNull();
    expect(row.lastError).toContain('400');
  });

  it('ต่อไม่ติด → รอลองใหม่ และบันทึกเหตุผลที่อ่านเข้าใจ', async () => {
    const id = await hook('ต่อไม่ติด');
    await queue('item.created');
    await dispatchDue(ctx, now, () => {
      throw new Error('ต่อปลายทางไม่ได้: ECONNREFUSED');
    });
    const row = await prismaClient.webhookDelivery.findFirstOrThrow({ where: { webhookId: id } });
    expect(row.state).toBe('pending');
    expect(row.lastStatus).toBeNull();
    expect(row.lastError).toContain('ECONNREFUSED');
  });

  it('ล้มครบเพดานแล้วเลิก ไม่ลองต่อไปเรื่อย ๆ', async () => {
    const id = await hook('ครบเพดาน');
    await queue('item.created');
    let at = toUtcDate(now);
    for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) {
      await dispatchDue(ctx, at, async () => Promise.resolve(503));
      at = toUtcDate(at.getTime() + 86_400_000);
    }
    const row = await prismaClient.webhookDelivery.findFirstOrThrow({ where: { webhookId: id } });
    expect(row.state).toBe('giving-up');
    expect(row.attempts).toBe(MAX_ATTEMPTS);
  });

  /**
   * **ล้มทีละใบ ไม่ล้มทั้งรอบ**
   *
   * ปลายทางที่ล่มหนึ่งราย ต้องไม่ทำให้อีกรายไม่ได้รับ · ถ้ารอบเดียว
   * โยน error ออกไป ใบที่เหลือจะไม่ถูกแตะเลยและไม่มีใครรู้ว่าค้างอยู่
   */
  it('ปลายทางหนึ่งพัง อีกปลายทางยังได้รับ', async () => {
    const bad = await hook('พัง');
    const good = await hook('ดี');
    await queue('item.created');
    await dispatchDue(ctx, now, async (url) => {
      if (url.includes('พัง')) throw new Error('ระเบิด');
      return Promise.resolve(200);
    });
    const b = await prismaClient.webhookDelivery.findFirstOrThrow({ where: { webhookId: bad } });
    const g = await prismaClient.webhookDelivery.findFirstOrThrow({ where: { webhookId: good } });
    expect(b.state).toBe('pending');
    expect(g.state).toBe('sent');
  });

  it('ใบที่ยังไม่ถึงเวลา ไม่ถูกหยิบมาส่ง', async () => {
    const id = await hook('ยังไม่ถึงเวลา');
    await queue('item.created');
    await dispatchDue(ctx, now, async () => Promise.resolve(500));
    const before = await prismaClient.webhookDelivery.findFirstOrThrow({ where: { webhookId: id } });
    await dispatchDue(ctx, now, async () => Promise.resolve(200));
    const after = await prismaClient.webhookDelivery.findFirstOrThrow({ where: { webhookId: id } });
    expect(after.attempts).toBe(before.attempts);
  });

  /** ลายเซ็นที่ปลายทางได้รับ ต้องตรวจกลับได้ด้วยความลับที่เราให้ไป */
  it('คำขอที่ส่งออกไป เซ็นด้วยความลับของปลายทางนั้น', async () => {
    const r = await createWebhook(
      ctx,
      { name: NAME('ลายเซ็น'), url: 'https://example.invalid/sig', events: ['item.created'] },
      KNOWN,
    );
    madeIds.push(r.id);
    await queue('item.created');
    let seen = '';
    let body = '';
    await dispatchDue(ctx, now, async (_url, b, secret, ts) => {
      body = b;
      seen = signPayload(secret, ts, b);
      return Promise.resolve(200);
    });
    expect(seen).toBe(signPayload(r.secret, now.getTime(), body));
  });
});
