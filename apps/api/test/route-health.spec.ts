/**
 * ไม่มีเส้นทางอ่านข้อมูลไหนพังเป็น 500 เมื่อคนที่มีสิทธิ์เรียก
 *
 * ## ทำไมต้องมีไฟล์นี้ ทั้งที่มี `authz-smoke.spec.ts` แล้ว
 *
 * `authz-smoke` ยิงด้วยผู้ใช้ที่**ไม่มีสิทธิ์อะไรเลย** แล้วยืนยันว่าไม่ได้ 2xx ·
 * คำตอบที่มันเห็นจึงเป็นรายการว่างและ 403 เกือบทั้งหมด — **ไม่เคยผ่านการ
 * แปลงข้อมูลจริงเป็น JSON เลยสักครั้ง**
 *
 * ไฟล์นี้ยิงเส้นเดียวกันด้วยผู้ใช้ที่**มีสิทธิ์** แล้วยืนยันว่าไม่มีเส้นไหน
 * ตอบ 5xx · สองไฟล์ถามคนละคำถามและจับคนละบั๊ก
 *
 * ## บั๊กที่ทำให้ไฟล์นี้เกิดขึ้น
 *
 * กระดานแบบ Scrum คืน `scope.sprintId` เป็น `bigint` · `JSON.stringify`
 * **โยน TypeError กับ BigInt** ซึ่งกลายเป็น **HTTP 500 ที่ไม่มีข้อความอะไรเลย**
 *
 * เทสต์ของกระดานหกเคสเขียวหมด เพราะเรียก service ตรง ๆ จึงไม่เคยผ่าน
 * ชั้น serialise — **มันวัดคนละชั้นกับที่ผู้ใช้เจอ** · เจอเพราะกดจริง
 * ในเบราว์เซอร์เท่านั้น
 *
 * ทุก id ในโปรเจกต์นี้เป็น `string` ตอนออกจากชั้น service ด้วยเหตุผลนี้ ·
 * แต่กติกาที่ไม่มีอะไรบังคับ คือกติกาที่จะถูกลืมในวันที่มีคนเพิ่มฟิลด์ใหม่
 *
 * ## ข้อจำกัดที่ต้องรู้
 *
 * ผู้ใช้ที่ใช้ยิงเป็นสมาชิกกลุ่มของเทสต์เอง ซึ่งได้สิทธิ์เฉพาะโปรเจกต์ที่
 * scheme นั้นครอบ · เส้นทางของโปรเจกต์อื่นจึงยังตอบ 403/404 และไม่ได้ถูก
 * แปลงเป็น JSON จริง — **นับเป็น "ตรวจไม่ได้" และรายงานออกมา ไม่ใช่นับว่าผ่าน**
 *
 * **ยิงโดยไม่ใส่ query parameter เลย** · เส้นทางที่เปลี่ยนพฤติกรรมตาม query
 * (เช่น `/boards/:key?mode=scrum`) จึงถูกตรวจเฉพาะทางที่เป็นค่าปริยาย ·
 * **บั๊ก BigInt ที่ทำให้ไฟล์นี้เกิดขึ้น อยู่บนทาง `?mode=scrum` ซึ่งไฟล์นี้
 * ไม่ได้ยิง** — มันถูกคุมด้วยเคสใน `scrum-board-db.spec.ts` แทน
 *
 * เขียนไว้ตรง ๆ เพราะด่านที่ไม่บอกว่าตัวเองไม่ครอบอะไร ทำให้คนเชื่อว่าครอบหมด ·
 * การเพิ่มรายการ query ที่ต้องยิงจะกลายเป็นรายการที่คนดูแลด้วยมือ ซึ่งลืมเส้นทาง
 * ใหม่เสมอ — จึงเลือกให้แต่ละฟีเจอร์คุมทางของตัวเองด้วยเคสที่แปลงเป็น JSON
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';

import { AppModule } from '../src/app.module';
import { prismaClient } from '../src/infrastructure/prisma/client';
import { hashPassword } from '../src/modules/identity/password';
import type { PermissionKey } from '../src/modules/permission';

const STAMP = String(Date.now()).slice(-6);
const EMAIL = `health-${STAMP}@example.test`;
const PASSWORD = `health-${STAMP}-ยาวพอ`;

/**
 * สิทธิ์ที่ให้ผู้ใช้ของเทสต์ — กว้างพอให้เส้นทางส่วนใหญ่คืนข้อมูลจริง
 *
 * ไม่ใช่ผู้ใช้ของ seed เพราะเทสต์ต้องสร้างของตัวเองแล้วลบทิ้ง (CLAUDE.md)
 */
const PERMISSIONS: PermissionKey[] = ['BROWSE_PROJECT', 'ADMINISTER_TENANT'];

let app: INestApplication;
let base = '';
let cookie = '';
let userId: bigint;
let groupId: bigint;
const grantIds: bigint[] = [];
const real = new Map<string, string>();

interface Route {
  path: string;
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
      if ((Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined) !== RequestMethod.GET) {
        continue;
      }
      const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? '';
      const joined = [prefix, sub].filter((p) => p !== '' && p !== '/').join('/');
      out.push({ path: `/api/v1/${joined}`.replace(/\/+$/, ''), owner: ctor.name });
    }
  }
  return out;
}

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
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  const project = await prismaClient.project.findFirstOrThrow({
    where: { key: 'SD' },
    select: { id: true, key: true, permissionSchemeId: true },
  });
  if (project.permissionSchemeId === null) throw new Error('โปรเจกต์ SD ไม่มี permission scheme');

  userId = (
    await prismaClient.user.create({
      data: {
        tenantId: tenant.id,
        email: EMAIL,
        displayName: `QA สุขภาพเส้นทาง ${STAMP}`,
        passwordHash: await hashPassword(PASSWORD),
      },
      select: { id: true },
    })
  ).id;

  groupId = (
    await prismaClient.userGroup.create({
      data: { tenantId: tenant.id, name: `สุขภาพเส้นทาง ${STAMP}` },
      select: { id: true },
    })
  ).id;
  for (const permission of PERMISSIONS) {
    const g = await prismaClient.permissionGrant.create({
      data: { tenantId: tenant.id, schemeId: project.permissionSchemeId, permission, groupId },
      select: { id: true },
    });
    grantIds.push(g.id);
  }
  await prismaClient.groupMember.create({ data: { tenantId: tenant.id, groupId, userId } });

  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`ล็อกอินไม่สำเร็จ (HTTP ${String(res.status)})`);
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  /*
    ค่าจริงจากฐานข้อมูล — เส้นทางที่ใส่ค่ามั่วจะตอบ 404 ก่อนถึงชั้น serialise
    แล้วเทสต์จะเขียวโดยไม่ได้แปลงข้อมูลจริงสักครั้ง
  */
  const item = await prismaClient.workItem.findFirstOrThrow({
    where: { projectId: project.id },
    select: { itemKey: true },
  });
  real.set('key', project.key);
  real.set('projectKey', project.key);
  real.set('itemKey', item.itemKey);
  /*
    **เส้นทางใต้ `work-items/:key` ใช้คีย์ของ *งาน* ไม่ใช่ของโปรเจกต์**

    ค่าปริยายของ `key` คือคีย์โปรเจกต์ (เส้นทาง `/projects/:key`) · เส้นทาง
    ที่ไม่ได้ระบุไว้ที่นี่จะได้ `SD` แทนคีย์งาน แล้วตอบ 404 — ซึ่งไม่ใช่
    การตรวจอะไรเลย เพราะไม่เคยแปลงข้อมูลจริงเป็น JSON

    รายการนี้จึงอ่านจากเส้นทางที่มีอยู่จริงตอนรัน ไม่ใช่พิมพ์ไว้เอง —
    รายการที่พิมพ์ไว้จะลืมเส้นทางใหม่เสมอ (บทเรียนเดิมของโปรเจกต์นี้)
  */
  for (const r of collectGetRoutes(
    (Reflect.getMetadata('controllers', AppModule) as unknown[] | undefined) ?? [],
  )) {
    if (r.path.startsWith('/api/v1/work-items/:key')) {
      real.set(`${r.path}::key`, item.itemKey);
    }
  }

  const put = (name: string, v: string | null | undefined): void => {
    if (v !== null && v !== undefined) real.set(name, v);
  };
  put('id', (await prismaClient.workflow.findFirst({ select: { id: true } }))?.id.toString());
  const cal = await prismaClient.slaCalendar.findFirst({ select: { id: true } });
  if (cal !== null) {
    put('/api/v1/admin/calendars/:id/years/:year::id', cal.id.toString());
    put('/api/v1/admin/calendars/:id::id', cal.id.toString());
  }
  const anyYear = await prismaClient.slaCalendarYear.findFirst({ select: { year: true } });
  put('year', String(anyYear?.year ?? new Date().getUTCFullYear()));
}, 180_000);

afterAll(async () => {
  await prismaClient.session.deleteMany({ where: { userId } });
  await prismaClient.permissionGrant.deleteMany({ where: { id: { in: grantIds } } });
  await prismaClient.groupMember.deleteMany({ where: { userId } });
  await prismaClient.user.deleteMany({ where: { email: EMAIL } });
  await prismaClient.userGroup.deleteMany({ where: { id: groupId } });
  await app.close();

  const left = await prismaClient.user.count({ where: { email: EMAIL } });
  await prismaClient.$disconnect();
  expect(left, 'เก็บกวาดไม่ครบ — เหลือผู้ใช้ของเทสต์').toBe(0);
});

describe('สุขภาพของเส้นทางอ่านข้อมูล', () => {
  const controllers = (Reflect.getMetadata('controllers', AppModule) as unknown[] | undefined) ?? [];

  it('**ตัวสแกนหาเส้นทางเจอจริง**', () => {
    const routes = collectGetRoutes(controllers);
    expect(routes.length, 'หาเส้นทาง GET ไม่เจอ — ตัวสแกนพัง').toBeGreaterThan(50);
  });

  /**
   * **ด่านหลัก**
   *
   * 5xx แปลว่าโค้ดพัง ไม่ใช่ผู้ใช้ทำผิด · 4xx ยอมได้ทั้งหมดที่นี่ เพราะเรา
   * ไม่ได้ทดสอบสิทธิ์ (ไฟล์อื่นทำแล้ว) แต่ทดสอบว่า **เส้นทางที่คืนข้อมูลจริง
   * แปลงเป็น JSON ได้**
   */
  it('**ไม่มีเส้นทางไหนตอบ 5xx ให้คนที่มีสิทธิ์**', async () => {
    const routes = collectGetRoutes(controllers);
    const broken: string[] = [];
    const uncheckable: string[] = [];
    let ok2xx = 0;

    for (const r of routes) {
      const url = substitute(r.path);
      if (url === null) {
        uncheckable.push(`${r.path}  (${r.owner})`);
        continue;
      }
      const res = await fetch(`${base}${url}`, { headers: { cookie } });
      if (res.status >= 500) {
        const body = await res.text();
        broken.push(`${String(res.status)} ${url}  (${r.owner}) — ${body.slice(0, 120)}`);
      } else if (res.ok) {
        ok2xx += 1;
      }
    }

    /*
      **ต้องมีเส้นทางที่คืน 2xx จริงจำนวนมาก** — ถ้าทุกเส้นตอบ 403/404
      เทสต์นี้จะเขียวโดยไม่เคยแปลงข้อมูลจริงเป็น JSON เลยสักครั้ง
      ซึ่งเป็นการเขียวด้วยเหตุผลผิดแบบเดียวกับที่ CLAUDE.md บันทึกไว้
    */
    expect(ok2xx, 'ไม่มีเส้นทางไหนคืนข้อมูลจริงเลย — ผู้ใช้ของเทสต์ไม่มีสิทธิ์พอ').toBeGreaterThan(
      15,
    );
    expect(broken, ['เส้นทางที่พังเป็น 5xx:', ...broken].join('\n')).toEqual([]);
    expect(
      uncheckable.length,
      `เส้นทางที่ตรวจไม่ได้ (${String(uncheckable.length)}):\n${uncheckable.join('\n')}`,
    ).toBeLessThanOrEqual(0);
  }, 180_000);

  /**
   * **ด่านพิสูจน์ว่าด่านข้างบนจับ BigInt ได้จริง**
   *
   * เขียนเป็นเคสของตัวเอง เพราะการยิงทุกเส้นแล้วเขียว ไม่ได้บอกว่ามันจะจับ
   * บั๊กชนิดนี้ได้ · เคสนี้ยืนยันว่า `JSON.stringify` โยนกับ BigInt จริง
   * ซึ่งเป็นสมมติฐานทั้งหมดที่ด่านข้างบนตั้งอยู่บน
   */
  it('**สมมติฐาน: JSON.stringify โยนกับ BigInt**', () => {
    expect(() => JSON.stringify({ id: 1n })).toThrow(TypeError);
    expect(() => JSON.stringify({ id: '1' })).not.toThrow();
  });
});
