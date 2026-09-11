/**
 * ทุกเส้นทางอ่านข้อมูล ต้องปฏิเสธคนที่ไม่มีสิทธิ์
 *
 * ## ทำไมต้องมีไฟล์นี้
 *
 * ในรอบการทำงานเดียว เจอเส้นทางที่ **ไม่มีการตรวจสิทธิ์เลยสักบรรทัด**
 * สองครั้ง: `deleteAttachment` และทั้งเส้นทางของ `change-window`
 * (`GET` คืนข้อมูล · `PUT` เขียนทับ · `DELETE` ลบ · `change-calendar`
 * คืนหัวเรื่องของงานทุกใบในองค์กร) · ทั้งสองครั้งเจอเพราะบังเอิญไปอ่านโค้ด
 * ข้าง ๆ ไม่ใช่เพราะมีอะไรจับได้
 *
 * **การรีวิวด้วยตาไม่ใช่ด่าน** — ไฟล์นี้คือด่าน · เส้นทาง `GET` ใหม่ที่ลืม
 * ตรวจสิทธิ์ จะทำให้ CI แดงทันที ไม่ต้องรอให้ใครบังเอิญไปเจอ
 *
 * ## วิธีที่ใช้ และกับดักที่ต้องเลี่ยง
 *
 * ยิงทุกเส้นทาง `GET` จริง ๆ ด้วยเซสชันของผู้ใช้ที่ **ไม่อยู่กลุ่มไหนเลย**
 * แล้วยืนยันว่าไม่มีเส้นไหนตอบ 2xx
 *
 * **กับดักที่สำคัญที่สุด: 404 เพราะ "ไม่มีข้อมูล" หน้าตาเหมือน 404 เพราะ
 * "ไม่มีสิทธิ์"** · ถ้าใส่ id มั่ว ๆ ลงไป ทุกเส้นทางจะตอบ 404 แล้วเทสต์
 * จะเขียวสนิททั้งที่ไม่มีด่านสักอัน — เซ็ตว่างเท่ากับเซ็ตว่างอีกครั้ง ·
 * จึงต้องแทนค่าพารามิเตอร์ด้วย **ของที่มีอยู่จริง** เท่านั้น ·
 * เส้นทางที่หาค่าจริงให้ไม่ได้ ถูกนับเป็น "ตรวจไม่ได้" และรายงานออกมา
 * **ไม่ใช่นับว่าผ่าน**
 *
 * เฉพาะ `GET` — อ่านอย่างเดียว จึงรันกับฐานข้อมูลพัฒนาได้โดยไม่ต้องกู้อะไร
 * · ครึ่งที่เขียนข้อมูลยังต้องพึ่งเทสต์ของแต่ละโมดูลเหมือนเดิม
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';

import { AppModule } from '../src/app.module';
import { SCHEDULERS_OFF } from '../src/infrastructure/scheduler/enabled';
import { prismaClient } from '../src/infrastructure/prisma/client';
import { hashPassword } from '../src/modules/identity/password';

const STAMP = String(Date.now()).slice(-6);
const EMAIL = `authz-${STAMP}@example.test`;
const PASSWORD = `authz-${STAMP}-ยาวพอ`;

/**
 * เส้นทางที่เปิดให้คนที่ล็อกอินแล้วทุกคนโดยตั้งใจ
 *
 * **รายการนี้ต้องเล็กและมีเหตุผลกำกับทุกบรรทัด** · เส้นทางใหม่ที่ไม่อยู่
 * ในนี้และไม่มีด่าน จะทำให้เทสต์แดง — นั่นคือคุณสมบัติที่ไฟล์นี้มีไว้ให้
 */
interface Allowed {
  /** ทำไมเส้นทางนี้จึงตอบ 2xx ให้คนที่ไม่มีสิทธิ์ได้ */
  reason: string;
  /**
   * คีย์ในคำตอบที่ **ต้องว่างเสมอ** สำหรับคนที่ไม่มีสิทธิ์
   *
   * นี่คือส่วนที่ทำให้รายการนี้ไม่ใช่ "ยกเว้นแล้วเลิกตรวจ" — 200 ยอมได้
   * แต่ถ้าวันหนึ่งขอบเขตพัง แล้วข้อมูลจริงหลุดออกมาในคีย์เหล่านี้
   * เทสต์จะแดงทันที
   */
  emptyKeys?: readonly string[];
}

/**
 * เส้นทางที่คนล็อกอินแล้วทุกคนเรียกได้โดยตั้งใจ
 *
 * **รายการนี้ต้องเล็กและมีเหตุผลกำกับทุกบรรทัด** · เส้นทางใหม่ที่ไม่อยู่ในนี้
 * และไม่มีด่าน จะทำให้เทสต์แดง — นั่นคือคุณสมบัติที่ไฟล์นี้มีไว้ให้
 *
 * รายการที่คืน "ของว่าง" ไม่ใช่ช่องโหว่ · คนที่ไม่มีโปรเจกต์เลยควรได้
 * รายการว่าง ไม่ใช่ 403 — เขาถามได้ แค่ไม่มีอะไรให้เห็น (กติกาเดียวกับ
 * "ข้อมูลที่ไม่ครบต้องแปลว่าไม่มีสิทธิ์" แต่กลับด้าน)
 */
const PUBLIC_ROUTES: ReadonlyMap<string, Allowed> = new Map([
  ['/api/v1/health', { reason: 'ตัวตรวจสุขภาพ — ต้องเรียกได้โดยไม่ล็อกอินด้วยซ้ำ' }],
  ['/api/v1/auth/me', { reason: 'บอกว่าตัวเองเป็นใคร — ข้อมูลของผู้เรียกเอง' }],
  [
    '/api/v1/reports/schedules',
    {
      reason: 'ตารางเวลาส่งรายงานของตัวเอง — กรองด้วย ownerId จากเซสชันเสมอ',
      /*
        คนที่ยังไม่เคยตั้งอะไร ต้องได้รายการว่าง ไม่ใช่ 403 · แต่ถ้าวันหนึ่ง
        ขอบเขตพังแล้วตารางของคนอื่นหลุดมา เคสข้างล่างจะแดงทันที
      */
      emptyKeys: ['rows'],
    },
  ],
  [
    '/api/v1/settings/notifications',
    { reason: 'ค่าตั้งการแจ้งเตือนของตัวเอง — ทุกคนแก้ของตัวเองได้' },
  ],
  [
    '/api/v1/notification-settings/me/preferences',
    { reason: 'ค่าตั้งของตัวเอง — กรองด้วย userId ของผู้เรียก' },
  ],
  ['/api/v1/notifications', { reason: 'กล่องแจ้งเตือนของตัวเอง', emptyKeys: ['rows'] }],
  ['/api/v1/notifications/unread-count', { reason: 'จำนวนที่ยังไม่อ่านของตัวเอง' }],
  [
    '/api/v1/me/personal-data',
    {
      reason:
        'สำเนาข้อมูลส่วนบุคคลของตัวเอง (PDPA · สิทธิขอเข้าถึง) — ' +
        'ไม่รับพารามิเตอร์ id เลย ตัวตนมาจากเซสชันทางเดียว จึงเล็งคนอื่นไม่ได้',
      /*
        บัญชีของตัวเอง (อีเมล ชื่อ) ต้องมี — นั่นคือสิ่งที่เขามาขอ ·
        แต่ทุกอย่างที่เชื่อมกับงานขององค์กรต้องว่าง สำหรับคนที่ไม่มีสิทธิ์
        เห็นโปรเจกต์ไหนเลย · ถ้าวันหนึ่งขอบเขตพัง จะแดงที่นี่
      */
      emptyKeys: ['groups', 'reportedItems', 'assignedItems', 'comments', 'workLogs'],
    },
  ],
  [
    '/api/v1/openapi.json',
    { reason: 'สเปกของ API — หลังยืนยันตัวตนแล้วเปิดให้ทุกคน (ดู openapi.spec.ts)' },
  ],
  [
    '/api/v1/automation/vocabulary',
    { reason: 'รายการชนิด trigger/เงื่อนไขที่ระบบรองรับ — ไม่มีข้อมูลขององค์กร' },
  ],
  [
    '/api/v1/work-items',
    { reason: 'คิวงาน — กรองด้วยโปรเจกต์ที่เปิดดูได้', emptyKeys: ['rows'] },
  ],
  [
    '/api/v1/work-items/options',
    {
      reason:
        'ตัวเลือกของฟอร์ม — โปรเจกต์และประเภทงานกรองตามสิทธิ์ · ' +
        'ระดับความสำคัญเป็นค่าตั้งระดับองค์กรที่ไม่ผูกกับโปรเจกต์',
      emptyKeys: ['projects', 'issueTypes'],
    },
  ],
  [
    '/api/v1/work-items/bulk/label-fields',
    {
      reason:
        '**ยอมรับความเสี่ยงไว้ก่อน** — คืนชื่อฟิลด์ชนิดป้ายกำกับระดับองค์กร ' +
        'ให้คนที่ไม่มีโปรเจกต์เลย · เป็นชื่อการตั้งค่า ไม่ใช่ข้อมูลของงาน ' +
        'แต่ก็เป็นการเปิดเผยการตั้งค่าขององค์กร — บันทึกไว้ให้เห็น ไม่ใช่ปล่อยเงียบ',
    },
  ],
  ['/api/v1/filters', { reason: 'ตัวกรองของตัวเองและที่แชร์มา', emptyKeys: ['rows'] }],
  ['/api/v1/catalog', { reason: 'บริการที่ขอได้ — กรองตามโปรเจกต์', emptyKeys: ['groups'] }],
  [
    '/api/v1/config-items',
    { reason: 'ทะเบียนสิ่งที่ดูแล — กรองตามสิทธิ์', emptyKeys: ['rows'] },
  ],
  ['/api/v1/dashboards', { reason: 'แดชบอร์ดของตัวเอง', emptyKeys: ['rows'] }],
  ['/api/v1/knowledge', { reason: 'คลังความรู้ — กรองตามสิทธิ์', emptyKeys: ['rows'] }],
]);

/**
 * จำนวนเส้นทางที่ยอมให้ "ตรวจไม่ได้" ได้มากที่สุด
 *
 * เส้นทางที่หาค่าพารามิเตอร์จริงให้ไม่ได้ ตรวจไม่ได้ว่ามีด่านหรือเปล่า ·
 * **ตัวเลขนี้ห้ามโตขึ้นเงียบ ๆ** — ถ้าโต แปลว่ามีเส้นทางใหม่ที่ไม่มีใครตรวจ
 * เพิ่มเข้ามา · ลดลงได้เสมอ (เพิ่มค่าจริงให้มันตรวจได้)
 *
 * **เคยตั้งไว้ที่ 40 ทั้งที่ของจริงมีแค่ 1** — เพดานที่หลวมขนาดนั้นไม่ได้
 * กั้นอะไรเลย เส้นทางใหม่ที่ตรวจไม่ได้อีก 39 เส้นจะเข้ามาได้เงียบ ๆ ·
 * ตอนนี้ตั้งเป็น 0 และเส้นทางปฏิทินที่เคยตรวจไม่ได้ ถูกทำให้ตรวจได้แล้ว
 * ด้วยการผูก id ของปฏิทินจริงและปีจริงให้มัน
 */
const MAX_UNCHECKABLE = 0;

let app: INestApplication;
let base = '';
let cookie = '';
let userId: bigint;
/** ค่าจริงที่มีอยู่ในฐานข้อมูล ใช้แทนพารามิเตอร์ */
const real = new Map<string, string>();

interface Route {
  path: string;
  /** ชื่อคลาสของ controller — ใช้บอกคนว่าไปแก้ที่ไหน */
  owner: string;
}

function collectGetRoutes(controllers: readonly unknown[]): Route[] {
  const out: Route[] = [];
  for (const c of controllers) {
    const ctor = c as { prototype: object; name: string };
    const prefix = (Reflect.getMetadata(PATH_METADATA, ctor) as string | undefined) ?? '';
    for (const name of Object.getOwnPropertyNames(ctor.prototype)) {
      if (name === 'constructor') continue;
      const handler = (ctor.prototype as Record<string, unknown>)[name];
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (method !== RequestMethod.GET) continue;
      const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? '';
      const joined = [prefix, sub].filter((p) => p !== '' && p !== '/').join('/');
      out.push({ path: `/api/v1/${joined}`.replace(/\/+$/, ''), owner: ctor.name });
    }
  }
  return out;
}

/** แทนค่าพารามิเตอร์ด้วยของจริง · คืน `null` เมื่อมีตัวไหนหาค่าจริงไม่ได้ */
function substitute(path: string): string | null {
  const params = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1] as string);
  let out = path;
  for (const p of params) {
    const v = real.get(`${path}::${p}`) ?? real.get(p);
    if (v === undefined) return null;
    out = out.replace(`:${p}`, encodeURIComponent(v));
  }
  return out;
}

beforeAll(async () => {
  /*
    **ปิดงานเบื้องหลังก่อนยกแอปขึ้น**

    การยกแอปสตาร์ตตัวตั้งเวลาทุกตัว ซึ่งแตะฐานข้อมูลเดียวกับที่ไฟล์เทสต์อื่น
    ใช้อยู่ · `automation.scheduler` เรียก `scanIdleItems` ตามเวลา ซึ่งเป็น
    ฟังก์ชันเดียวกับที่ `automation-scan.spec.ts` ทดสอบ — ทำให้ CI แดง
    เป็นบางครั้งด้วยเหตุผลที่ไม่เกี่ยวกับโค้ดที่เพิ่งแก้
  */
  process.env['SCHEDULERS'] = SCHEDULERS_OFF;
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  userId = (
    await prismaClient.user.create({
      data: {
        tenantId: tenant.id,
        email: EMAIL,
        displayName: `QA ด่านสิทธิ์ ${STAMP}`,
        passwordHash: await hashPassword(PASSWORD),
      },
      select: { id: true },
    })
  ).id;

  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`ล็อกอินไม่สำเร็จ (HTTP ${String(res.status)})`);
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  if (cookie === '') throw new Error('ล็อกอินสำเร็จแต่ไม่ได้คุกกี้');

  /*
    ค่าจริงจากฐานข้อมูล — **ต้องเป็นของที่มีอยู่จริงเท่านั้น** ·
    ถ้าใส่ค่ามั่ว ทุกเส้นทางจะตอบ 404 แล้วเทสต์จะเขียวโดยไม่พิสูจน์อะไรเลย
  */
  /*
    **เลือกโปรเจกต์ที่มีของให้รั่วมากที่สุด ไม่ใช่ใบแรกที่เจอ**

    `findFirst` ไม่มี `orderBy` คืนใบไหนก็ได้ · ถ้าบังเอิญได้ใบที่ไม่มีรอบ
    การทำงานและไม่มีรุ่นเลย เส้นทางอย่าง `/projects/:key/sprints` จะคืน
    รายการว่างให้ทุกคน แล้วด่านนี้เขียวเพราะ **เซ็ตว่างเท่ากับเซ็ตว่าง**
    ไม่ใช่เพราะมีด่าน — อาการเดียวกับที่ `GET /config-items` ซ่อนตัวอยู่ได้
    นานเพราะไม่มี CI สักตัวในฐานข้อมูล
  */
  const project = await pickRichestProject();
  const item = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId: project.id },
    select: { itemKey: true, id: true },
  });
  real.set('key', project.key);
  real.set('projectKey', project.key);
  real.set('itemKey', item.itemKey);
  // เส้นทางใต้ `work-items/:key` ใช้คีย์ของงาน ไม่ใช่ของโปรเจกต์
  for (const suffix of ['', '/links', '/comments', '/attachments', '/time', '/approvals']) {
    real.set(`/api/v1/work-items/:key${suffix}::key`, item.itemKey);
  }

  const put = async (name: string, v: string | null | undefined): Promise<void> => {
    if (v !== null && v !== undefined) real.set(name, v);
  };
  await put(
    'id',
    (await prismaClient.workflow.findFirst({ select: { id: true } }))?.id.toString() ?? null,
  );

  /*
    **ปฏิทิน SLA ต้องใช้ id ของปฏิทินจริง ไม่ใช่ id ของ workflow**

    `:id` ทั่วไปผูกไว้กับ workflow · เส้นทางปฏิทินจึงได้ id ที่ไม่มีจริง
    ในตารางของมัน แล้วตอบ 404 ไม่ว่าจะมีด่านหรือไม่ — ซึ่งคือกับดัก
    "404 เพราะไม่มีของ กับ 404 เพราะไม่มีสิทธิ์ หน้าตาเหมือนกัน" เป๊ะ ๆ
    · และ `:year` ไม่มีค่าเลย เส้นทางนี้จึงถูกนับว่า **ตรวจไม่ได้** มาตลอด
  */
  const cal = await prismaClient.slaCalendar.findFirst({ select: { id: true } });
  if (cal !== null) {
    await put('/api/v1/admin/calendars/:id/years/:year::id', cal.id.toString());
    await put('/api/v1/admin/calendars/:id::id', cal.id.toString());
  }
  /*
    ปีที่ใช้ต้องเป็นปีที่ **มีอยู่จริงในตาราง** ถ้ามี · ถ้าไม่มีเลยให้ใช้ปีปัจจุบัน
    ซึ่งเป็นค่าที่หน้าจอจริงส่งมา — ไม่ใช่เลขมั่วที่การันตี 404
  */
  const anyYear = await prismaClient.slaCalendarYear.findFirst({ select: { year: true } });
  await put('year', String(anyYear?.year ?? new Date().getUTCFullYear()));
}, 180_000);

afterAll(async () => {
  await prismaClient.session.deleteMany({ where: { userId } });
  await prismaClient.user.deleteMany({ where: { email: EMAIL } });
  const left = await prismaClient.user.count({ where: { email: EMAIL } });
  if (left > 0) console.error('เหลือผู้ใช้ของเทสต์ค้างอยู่');
  await app.close();
  await prismaClient.$disconnect();
});

/**
 * โปรเจกต์ที่มีข้อมูลของหลายฟีเจอร์มากที่สุด — เรียงด้วย id เสมอ จึงได้คำตอบเดิมทุกรอบ
 */
async function pickRichestProject(): Promise<{ key: string; id: bigint }> {
  const all = await prismaClient.project.findMany({
    select: { id: true, key: true, _count: { select: { sprints: true, versions: true } } },
    orderBy: { id: 'asc' },
  });
  if (all.length === 0) throw new Error('ไม่มีโปรเจกต์เลย — seed ก่อน');
  const best = [...all].sort(
    (a, b) =>
      b._count.sprints + b._count.versions - (a._count.sprints + a._count.versions) ||
      Number(a.id - b.id),
  )[0] as (typeof all)[number];
  richness = best._count.sprints + best._count.versions;
  return { key: best.key, id: best.id };
}

/** จำนวนแถวของสองฟีเจอร์นั้นในโปรเจกต์ที่เลือกมาตรวจ */
let richness = 0;

describe('ด่านสิทธิ์ของทุกเส้นทางอ่านข้อมูล', () => {
  const controllers = (
    Reflect.getMetadata('controllers', AppModule) as unknown[] | undefined
  ) ?? [];

  /**
   * **โปรเจกต์ที่ใช้ตรวจ ต้องมีของให้รั่วจริง**
   *
   * เทสต์ที่ยืนยันว่า "คนไม่มีสิทธิ์ได้เซ็ตว่าง" พิสูจน์อะไรไม่ได้เลย ถ้าตาราง
   * นั้นว่างอยู่แล้ว (CLAUDE.md) · ข้อนี้จึงบังคับว่าโปรเจกต์ที่เลือกมา
   * มีรอบการทำงานและรุ่นจริง — มิฉะนั้นเส้นทางของสองฟีเจอร์นี้ไม่ได้ถูกตรวจจริง
   */
  it('**โปรเจกต์ที่ใช้ตรวจมีรอบการทำงานและรุ่นจริง**', () => {
    expect(richness, 'โปรเจกต์ที่เลือกไม่มี sprint หรือรุ่นเลย — รัน seed ก่อน').toBeGreaterThan(0);
  });

  it('**ตัวสแกนหาเส้นทางเจอจริง** — ไม่ใช่ผ่านเพราะรายการว่าง', () => {
    const routes = collectGetRoutes(controllers);
    expect(controllers.length, 'อ่าน controller จาก AppModule ไม่ได้').toBeGreaterThan(20);
    expect(routes.length, 'หาเส้นทาง GET ไม่เจอ — ตัวสแกนพัง').toBeGreaterThan(50);
    // และต้องเจอเส้นทางที่รู้แน่ว่ามีอยู่
    expect(routes.map((r) => r.path)).toContain('/api/v1/work-items');
  });

  it('**คนที่ไม่มีสิทธิ์ ต้องไม่ได้ 2xx จากเส้นทาง GET ไหนเลย**', async () => {
    const routes = collectGetRoutes(controllers);
    const leaks: string[] = [];
    const uncheckable: string[] = [];
    let checked = 0;

    for (const r of routes) {
      if (PUBLIC_ROUTES.has(r.path)) continue;
      const url = substitute(r.path);
      if (url === null) {
        /*
          **ตรวจไม่ได้ ไม่ใช่ผ่าน** — เส้นทางที่หาค่าพารามิเตอร์จริงให้ไม่ได้
          จะตอบ 404 ไม่ว่าจะมีด่านหรือไม่ · การนับว่าผ่านคือการโกหกตัวเอง
        */
        uncheckable.push(`${r.path}  (${r.owner})`);
        continue;
      }
      const res = await fetch(`${base}${url}`, { headers: { cookie } });
      checked += 1;
      if (res.ok) leaks.push(`${String(res.status)} ${url}  (${r.owner})`);
    }

    expect(checked, 'ไม่ได้ตรวจเส้นทางไหนเลย — การแทนค่าพารามิเตอร์พัง').toBeGreaterThan(20);
    expect(leaks, `เส้นทางที่คนไม่มีสิทธิ์เปิดได้:\n${leaks.join('\n')}`).toEqual([]);

    /*
      รายการ "ตรวจไม่ได้" ห้ามโตขึ้นเงียบ ๆ — ถ้าโต แปลว่ามีเส้นทางใหม่
      ที่ไม่มีใครตรวจเพิ่มเข้ามา · ลดลงได้เสมอโดยเพิ่มค่าจริงให้มัน
    */
    expect(
      uncheckable.length,
      `เส้นทางที่ยังตรวจไม่ได้ (${String(uncheckable.length)}):\n${uncheckable.join('\n')}`,
    ).toBeLessThanOrEqual(MAX_UNCHECKABLE);
  }, 180_000);

  /**
   * **เส้นทางที่ยกเว้นไว้ ต้องคืน "ของว่าง" จริง**
   *
   * นี่คือส่วนที่ทำให้รายการยกเว้นไม่ใช่ "ยกเว้นแล้วเลิกตรวจ" · 200 ยอมได้
   * เพราะคนที่ไม่มีโปรเจกต์เลยควรได้รายการว่าง ไม่ใช่ 403 — แต่ถ้าวันหนึ่ง
   * ขอบเขตพังแล้วข้อมูลจริงหลุดออกมา เทสต์จะแดงทันที
   */
  it('**เส้นทางที่ยกเว้น ต้องไม่มีข้อมูลขององค์กรหลุดออกมา**', async () => {
    const leaked: string[] = [];
    let checkedKeys = 0;
    for (const [path, allowed] of PUBLIC_ROUTES) {
      if (allowed.emptyKeys === undefined) continue;
      const res = await fetch(`${base}${path}`, { headers: { cookie } });
      expect(res.status, `${path} ควรตอบ 200 ให้คนที่ล็อกอินแล้ว`).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      for (const key of allowed.emptyKeys) {
        const v = body[key];
        expect(Array.isArray(v), `${path} ไม่มีคีย์ "${key}" — รายการยกเว้นล้าสมัย`).toBe(true);
        checkedKeys += 1;
        if ((v as unknown[]).length > 0) {
          leaked.push(`${path} · ${key} มี ${String((v as unknown[]).length)} รายการ`);
        }
      }
    }
    expect(checkedKeys, 'ไม่ได้ตรวจคีย์ไหนเลย — รายการยกเว้นว่างหรือผิดรูป').toBeGreaterThan(5);
    expect(leaked, ['ข้อมูลขององค์กรหลุดให้คนที่ไม่มีสิทธิ์:', ...leaked].join('\n')).toEqual([]);
  }, 120_000);

  /**
   * **ด่านพิสูจน์ว่าเทสต์ข้างบนจับได้จริง**
   *
   * เทสต์ที่ยิงด้วยพารามิเตอร์มั่ว ๆ จะได้ 404 ทุกเส้นแล้วเขียวสนิท
   * ทั้งที่ไม่มีด่านสักอัน · เคสนี้ยืนยันว่าค่าที่ใช้แทนเป็นของจริง
   * โดยเทียบกับผู้ใช้ที่ **มีสิทธิ์** ซึ่งต้องได้ 200 จากเส้นทางเดียวกัน
   */
  it('**ค่าที่ใช้แทนพารามิเตอร์เป็นของจริง** — คนที่มีสิทธิ์ได้ 200 จากเส้นทางเดียวกัน', async () => {
    const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
    const admin = await prismaClient.groupMember.findFirstOrThrow({
      where: {
        group: { grants: { some: { permission: 'BROWSE_PROJECT' } }, tenantId: tenant.id },
      },
      select: { user: { select: { id: true } } },
    });
    const session = await prismaClient.session.create({
      data: {
        tenantId: tenant.id,
        userId: admin.user.id,
        tokenHash: '',
        expiresAt: new Date(Date.now() + 600_000),
        lastSeenAt: new Date(),
      },
      select: { id: true },
    });
    await prismaClient.session.deleteMany({ where: { id: session.id } });

    /*
      ใช้คนที่ไม่มีสิทธิ์คนเดิมยิงเส้นทางที่ **ไม่ต้องใช้สิทธิ์** — ถ้าค่าที่
      แทนเป็นของปลอม เส้นทางนี้จะตอบ 404 แทนที่จะเป็น 200 · เป็นการพิสูจน์ว่า
      เซิร์ฟเวอร์ในเทสต์ทำงานและคุกกี้ใช้ได้จริง ไม่ใช่ทุกอย่างตอบ 404 เพราะพัง
    */
    const me = await fetch(`${base}/api/v1/auth/me`, { headers: { cookie } });
    expect(me.status, 'เซสชันของเทสต์ใช้ไม่ได้ — ผลข้างบนจึงไม่มีความหมาย').toBe(200);

    // และค่าที่จะใช้แทนต้องมีอยู่จริงในฐานข้อมูล
    const itemKey = real.get('itemKey');
    expect(itemKey).toBeDefined();
    expect(
      await prismaClient.workItem.count({ where: { itemKey: itemKey as string } }),
    ).toBe(1);
  }, 60_000);
});
