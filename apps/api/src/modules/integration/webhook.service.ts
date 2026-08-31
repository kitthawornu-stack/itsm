/**
 * Webhook — ทะเบียนปลายทาง และการส่งจริง
 *
 * ## จองก่อนทำ
 *
 * แถว `webhook_delivery` เกิด **ก่อน** ยิง HTTP เสมอ และเกิดในทรานแซกชัน
 * ของสิ่งที่ทำให้เกิดเหตุการณ์ · เครื่องที่ดับระหว่างรอปลายทางตอบ จะกลับมา
 * เห็นแถวที่ค้างเป็น `pending` แล้วรู้ว่าเคยพยายามแล้ว — ถ้าสร้างแถวหลังส่ง
 * สำเร็จ มันจะส่งซ้ำทั้งชุดโดยไม่มีอะไรจำได้ (กติกาเดียวกับ `notification_delivery`)
 *
 * ## ไม่ยิง HTTP ในทรานแซกชัน
 *
 * การถือล็อกฐานข้อมูลไว้รอปลายทางที่อาจไม่ตอบเป็นสิบวินาที คือการเอา
 * ความเร็วของทั้งระบบไปฝากไว้กับเซิร์ฟเวอร์ของคนอื่น · `queueWebhooks`
 * เขียนแถวอย่างเดียว ส่วน `dispatchDue` ยิงจริงนอกทรานแซกชัน
 *
 * ## ล้มทีละใบ ไม่ล้มทั้งรอบ
 *
 * ปลายทางที่ล่มหนึ่งราย ต้องไม่ทำให้อีกสิบรายไม่ได้รับ · กติกาเดียวกับ
 * ช่องทางแจ้งเตือน
 */
import { randomBytes } from 'node:crypto';

import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import {
  auditedTransaction,
  type TxClient,
} from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertTenantAdmin } from '../permission';
import {
  MAX_ATTEMPTS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  isSubscribed,
  nextAttemptAt,
  shouldRetry,
  signPayload,
} from './webhook-policy';

const NAME_MAX = 128;
const URL_MAX = 1000;
/** เวลารอปลายทางตอบ — นานกว่านี้คือปลายทางที่ใช้ไม่ได้ ไม่ใช่ปลายทางที่ช้า */
const TIMEOUT_MS = 10_000;
/** จำนวนใบที่ส่งต่อรอบ — กันไม่ให้รอบเดียวกินเวลานานจนตัวเรียกถัดไปซ้อน */
const BATCH = 20;

export class WebhookNameRequiredError extends Error {
  constructor() {
    super('ต้องตั้งชื่อปลายทาง');
    this.name = 'WebhookNameRequiredError';
  }
}

export class DuplicateWebhookNameError extends Error {
  constructor(readonly given: string) {
    super(`มีปลายทางชื่อ "${given}" อยู่แล้ว`);
    this.name = 'DuplicateWebhookNameError';
  }
}

export class WebhookNotFoundError extends Error {
  constructor(id: bigint) {
    super(`ไม่พบปลายทาง #${id.toString()}`);
    this.name = 'WebhookNotFoundError';
  }
}

export class InvalidWebhookUrlError extends Error {
  constructor(readonly given: string) {
    super(`ที่อยู่ปลายทางใช้ไม่ได้: "${given}" — ต้องขึ้นต้นด้วย http:// หรือ https://`);
    this.name = 'InvalidWebhookUrlError';
  }
}

export class UnknownWebhookEventError extends Error {
  constructor(readonly given: string) {
    super(`ไม่รู้จักเหตุการณ์ "${given}"`);
    this.name = 'UnknownWebhookEventError';
  }
}

export interface WebhookRow {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  /**
   * ยอดล่าสุด — มีไว้ให้ผู้ดูแลเห็นว่าปลายทางนี้ยังทำงานอยู่ไหม
   *
   * ทะเบียนที่ไม่บอกว่าส่งสำเร็จครั้งสุดท้ายเมื่อไร ทำให้ปลายทางที่ตายไปแล้ว
   * ดูเหมือนปลายทางที่ยังดีอยู่
   */
  lastSentAt: string | null;
  pending: number;
  failed: number;
}

/**
 * **ไม่มี `secret` ในนี้โดยตั้งใจ**
 *
 * ความลับออกจากเซิร์ฟเวอร์ครั้งเดียวตอนสร้างหรือตอนตั้งใหม่ · การส่งมันมา
 * พร้อมรายการทุกครั้ง แปลว่าใครที่เปิดหน้าตั้งค่าได้ ก็ปลอมคำขอเป็นระบบเราได้
 */
function toRow(r: {
  id: bigint;
  name: string;
  url: string;
  events: string;
  isActive: boolean;
  deliveries: { state: string; sentAt: Date | null }[];
}): WebhookRow {
  const sent = r.deliveries.filter((d) => d.sentAt !== null).map((d) => d.sentAt as Date);
  return {
    id: r.id.toString(),
    name: r.name,
    url: r.url,
    events: parseEvents(r.events),
    isActive: r.isActive,
    lastSentAt:
      sent.length === 0
        ? null
        : new Date(Math.max(...sent.map((d) => d.getTime()))).toISOString(),
    pending: r.deliveries.filter((d) => d.state === 'pending').length,
    failed: r.deliveries.filter((d) => d.state === 'giving-up').length,
  };
}

/** เก็บเป็นข้อความคั่นจุลภาค — รายการสั้นและอ่านได้ด้วยตาตอนไล่ปัญหา */
function parseEvents(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function cleanName(raw: unknown): string {
  const n = (typeof raw === 'string' ? raw : '').trim().slice(0, NAME_MAX);
  if (n === '') throw new WebhookNameRequiredError();
  return n;
}

/**
 * ที่อยู่ต้องเป็น http หรือ https เท่านั้น
 *
 * **อนุญาตที่อยู่ในวงแลนโดยตั้งใจ** — ระบบนี้ติดตั้งในองค์กร และปลายทาง
 * ที่มีประโยชน์ที่สุด (ตัวกลางที่ส่งต่อเข้า LINE) มักอยู่ในเครือข่ายเดียวกัน ·
 * การห้ามที่อยู่ภายในจะตัดกรณีใช้งานหลักทิ้ง · ด่านจริงคือ **เฉพาะผู้ดูแล
 * องค์กรเท่านั้นที่ตั้งปลายทางได้** ซึ่งบังคับที่ทุกฟังก์ชันในไฟล์นี้
 */
function cleanUrl(raw: unknown): string {
  const u = (typeof raw === 'string' ? raw : '').trim().slice(0, URL_MAX);
  if (!/^https?:\/\/.+/i.test(u)) throw new InvalidWebhookUrlError(u);
  return u;
}

function cleanEvents(raw: readonly string[], known: readonly string[]): string {
  for (const e of raw) {
    if (!known.includes(e)) throw new UnknownWebhookEventError(e);
  }
  return [...new Set(raw)].join(',');
}

export async function listWebhooks(ctx: TenantContext): Promise<WebhookRow[]> {
  await assertTenantAdmin(ctx);
  const rows = await tenantScoped(ctx).webhook.findMany({
    orderBy: { name: 'asc' },
    include: { deliveries: { select: { state: true, sentAt: true }, take: 200 } },
  });
  return rows.map(toRow);
}

export async function createWebhook(
  ctx: TenantContext,
  input: { name: string; url: string; events: readonly string[] },
  known: readonly string[],
): Promise<{ id: bigint; secret: string }> {
  await assertTenantAdmin(ctx);
  const name = cleanName(input.name);
  const url = cleanUrl(input.url);
  const events = cleanEvents(input.events, known);

  const db = tenantScoped(ctx);
  const clash = await db.webhook.findFirst({ where: { name }, select: { id: true } });
  if (clash !== null) throw new DuplicateWebhookNameError(name);

  // 32 ไบต์สุ่ม = 64 ตัวอักษรฐานสิบหก · ยาวพอที่การเดาไม่ใช่ทางเลือก
  const secret = randomBytes(32).toString('hex');
  return auditedTransaction(ctx, 'webhook.create', async (tx) => {
    const w = await tx.webhook.create({
      data: { tenantId: ctx.tenantId, name, url, secret, events },
      select: { id: true },
    });
    return {
      result: { id: w.id, secret },
      audit: [
        {
          kind: 'system' as const,
          action: 'webhook.create',
          entityType: 'webhook',
          entityId: w.id.toString(),
          // **ไม่มีความลับใน audit** — ร่องรอยที่เก็บความลับไว้ คือความลับที่รั่วช้า ๆ
          payload: { name, url, events },
        },
      ],
    };
  });
}

export async function updateWebhook(
  ctx: TenantContext,
  id: bigint,
  changes: { name?: string; url?: string; events?: readonly string[]; isActive?: boolean },
  known: readonly string[],
): Promise<void> {
  await assertTenantAdmin(ctx);
  const db = tenantScoped(ctx);
  const before = await db.webhook.findFirst({ where: { id }, select: { id: true, name: true } });
  if (before === null) throw new WebhookNotFoundError(id);

  const data: Record<string, unknown> = {};
  if (changes.name !== undefined) {
    const name = cleanName(changes.name);
    if (name !== before.name) {
      const clash = await db.webhook.findFirst({
        where: { name, NOT: { id } },
        select: { id: true },
      });
      if (clash !== null) throw new DuplicateWebhookNameError(name);
    }
    data['name'] = name;
  }
  if (changes.url !== undefined) data['url'] = cleanUrl(changes.url);
  if (changes.events !== undefined) data['events'] = cleanEvents(changes.events, known);
  if (changes.isActive !== undefined) data['isActive'] = changes.isActive;
  if (Object.keys(data).length === 0) return;

  await auditedTransaction(ctx, 'webhook.update', async (tx) => {
    await tx.webhook.update({ where: { id }, data });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'webhook.update',
          entityType: 'webhook',
          entityId: id.toString(),
          payload: data,
        },
      ],
    };
  });
}

/**
 * ตั้งความลับใหม่ — คืนค่าครั้งเดียว
 *
 * มีไว้สำหรับวันที่สงสัยว่าความลับรั่ว · หลังตั้งใหม่ ปลายทางที่ยังใช้ค่าเก่า
 * จะตรวจลายเซ็นไม่ผ่าน ซึ่งเป็นสิ่งที่ต้องการ — การเปลี่ยนความลับที่ไม่ทำให้
 * ของเก่าใช้ไม่ได้ ไม่ได้แก้อะไรเลย
 */
export async function rotateWebhookSecret(
  ctx: TenantContext,
  id: bigint,
): Promise<{ secret: string }> {
  await assertTenantAdmin(ctx);
  const found = await tenantScoped(ctx).webhook.findFirst({ where: { id }, select: { id: true } });
  if (found === null) throw new WebhookNotFoundError(id);

  const secret = randomBytes(32).toString('hex');
  return auditedTransaction(ctx, 'webhook.rotate', async (tx) => {
    await tx.webhook.update({ where: { id }, data: { secret } });
    return {
      result: { secret },
      audit: [
        {
          kind: 'system' as const,
          action: 'webhook.rotate',
          entityType: 'webhook',
          entityId: id.toString(),
          payload: { rotated: true },
        },
      ],
    };
  });
}

export async function deleteWebhook(ctx: TenantContext, id: bigint): Promise<void> {
  await assertTenantAdmin(ctx);
  const found = await tenantScoped(ctx).webhook.findFirst({
    where: { id },
    select: { id: true, name: true },
  });
  if (found === null) throw new WebhookNotFoundError(id);

  await auditedTransaction(ctx, 'webhook.delete', async (tx) => {
    await tx.webhook.delete({ where: { id } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'webhook.delete',
          entityType: 'webhook',
          entityId: id.toString(),
          payload: { name: found.name },
        },
      ],
    };
  });
}

/**
 * จองการส่งไว้ — **เรียกหลังการเปลี่ยนแปลงคอมมิตแล้ว**
 *
 * เหตุการณ์ของสิ่งที่ถูกย้อนกลับต้องไม่ถูกส่งออกไป เพราะปลายทางเรียกคืนไม่ได้
 * · จุดเรียกจริงคือ `fireAutomation` ซึ่งทำงานหลังคำสั่งของผู้ใช้สำเร็จแล้ว
 * จึงได้ผลนั้นโดยไม่ต้องอยู่ในทรานแซกชันเดียวกัน
 *
 * รับ `tx` เพื่อให้แถวจองของเหตุการณ์เดียวกันเกิดครบหรือไม่เกิดเลย —
 * ปลายทางสามรายที่ควรได้รับ ต้องไม่ได้รับแค่สองเพราะเครื่องดับกลางทาง
 *
 * คืนจำนวนใบที่จอง — 0 เมื่อไม่มีปลายทางไหนสนใจ ซึ่งเป็นสถานะปกติ ไม่ใช่ error
 */
export async function queueWebhooks(
  ctx: TenantContext,
  tx: TxClient,
  event: string,
  payload: unknown,
): Promise<number> {
  const hooks = await tx.webhook.findMany({
    where: { tenantId: ctx.tenantId, isActive: true },
    select: { id: true, events: true },
  });
  const wanted = hooks.filter((h: { id: bigint; events: string }) =>
    isSubscribed(parseEvents(h.events), event),
  );
  if (wanted.length === 0) return 0;

  const body = JSON.stringify(payload);
  await tx.webhookDelivery.createMany({
    data: wanted.map((h: { id: bigint }) => ({
      tenantId: ctx.tenantId,
      webhookId: h.id,
      event,
      payload: body,
      state: 'pending',
      // ครั้งแรกส่งทันที ไม่ต้องรอ
      nextAttemptAt: new Date(0),
    })),
  });
  return wanted.length;
}

export interface DispatchResult {
  attempted: number;
  sent: number;
  retrying: number;
  gaveUp: number;
}

/**
 * ส่งใบที่ถึงเวลาแล้ว — **นอกทรานแซกชัน**
 *
 * `now` ส่งเข้ามาได้เพื่อให้ทดสอบเคส "ปลายทางล่มสามวัน" ได้โดยไม่ต้องรอจริง
 *
 * **ล้มทีละใบ ไม่ล้มทั้งรอบ** — `try` ครอบรายใบ · ปลายทางที่ล่มหนึ่งราย
 * ต้องไม่ทำให้อีกสิบรายไม่ได้รับ
 */
export async function dispatchDue(
  ctx: TenantContext,
  now: UtcDate = systemClock.nowUtc(),
  send: typeof sendOnce = sendOnce,
): Promise<DispatchResult> {
  const db = tenantScoped(ctx);
  const due = await db.webhookDelivery.findMany({
    where: { state: 'pending', nextAttemptAt: { lte: now } },
    orderBy: { id: 'asc' },
    take: BATCH,
    include: { webhook: { select: { url: true, secret: true, isActive: true } } },
  });

  const out: DispatchResult = { attempted: 0, sent: 0, retrying: 0, gaveUp: 0 };
  for (const d of due) {
    out.attempted += 1;
    /*
      ปลายทางที่ถูกปิดหลังจากจองไว้แล้ว — เลิกส่ง แต่บันทึกเหตุผล
      แถวที่ค้างเป็น pending โดยไม่มีเหตุผล คือความเงียบที่ไม่มีใครสืบต่อได้
    */
    if (!d.webhook.isActive) {
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: {
          state: 'giving-up',
          lastError: 'ปลายทางถูกปิดหลังจากจองคิวไว้แล้ว',
          nextAttemptAt: null,
        },
      });
      out.gaveUp += 1;
      continue;
    }

    const attempts = d.attempts + 1;
    const at = now.getTime();
    let status: number | null = null;
    let error: string | null = null;
    try {
      status = await send(d.webhook.url, d.payload, d.webhook.secret, at);
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 500) : 'ต่อปลายทางไม่ได้';
    }

    if (status !== null && status >= 200 && status < 300) {
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: { state: 'sent', attempts, lastStatus: status, sentAt: now, nextAttemptAt: null },
      });
      out.sent += 1;
      continue;
    }

    const next = shouldRetry(status) ? nextAttemptAt(attempts, now) : null;
    await db.webhookDelivery.update({
      where: { id: d.id },
      data: {
        state: next === null ? 'giving-up' : 'pending',
        attempts,
        lastStatus: status,
        lastError:
          error ??
          (status === null ? 'ต่อปลายทางไม่ได้' : `ปลายทางตอบ ${String(status)}`),
        nextAttemptAt: next,
      },
    });
    if (next === null) out.gaveUp += 1;
    else out.retrying += 1;
  }
  return out;
}

/**
 * ยิงจริงหนึ่งครั้ง — แยกออกมาให้ฉีดของปลอมเข้ามาได้
 *
 * ตรรกะ "ส่งหรือไม่ส่ง" ต้องทดสอบได้โดยไม่ต้องมีเซิร์ฟเวอร์จริง ซึ่งเป็น
 * กติกาเดียวกับช่องทางแจ้งเตือน · คืนรหัสสถานะ หรือโยนเมื่อต่อไม่ติด
 */
export async function sendOnce(
  url: string,
  body: string,
  secret: string,
  timestampMs: number,
): Promise<number> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [TIMESTAMP_HEADER]: String(timestampMs),
      [SIGNATURE_HEADER]: signPayload(secret, timestampMs, body),
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res.status;
}

export { MAX_ATTEMPTS };
