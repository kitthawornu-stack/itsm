/**
 * วัดโหลดของ **เส้นทางที่เขียนข้อมูล**
 *
 * เอกสารสถานะเขียนไว้เองว่าการวัดโหลดครั้งแรก "ยังไม่ได้วัดการเขียน" ·
 * ตัวเลขของการอ่านอย่างเดียวตอบไม่ได้ว่าระบบรับตั๋วได้เร็วแค่ไหน ซึ่งเป็น
 * สิ่งที่พังก่อนเสมอ เพราะการเขียนล็อกแถว เขียน audit เขียนประวัติ และ
 * ตั้งนาฬิกา SLA ในทรานแซกชันเดียวกัน
 *
 * ## ทำไมไฟล์นี้แยกจาก `loadtest.ts`
 *
 * `loadtest.ts` **อ่านอย่างเดียว** จึงรันกับฐานข้อมูลพัฒนาได้โดยไม่ต้อง
 * กู้อะไรทีหลัง — นั่นคือเงื่อนไขที่ทำให้มันถูกรันจริง · ไฟล์นี้เขียนข้อมูล
 * จึงต้องมีสัญญาที่ต่างออกไป และคนที่รันต้องรู้ตัวว่ากำลังรันอะไร
 *
 * ## สัญญาของไฟล์นี้: ทุกแถวที่สร้าง มีลายเซ็นและถูกลบคืน
 *
 * หัวข้อของทุกงานที่สร้างขึ้นต่อท้ายด้วย `[loadtest-<stamp>]` ·
 * การเก็บกวาดจึงถามฐานข้อมูลว่า "มีอะไรที่ขึ้นต้นด้วยลายเซ็นนี้บ้าง"
 * ไม่ใช่ไล่จากรายการ id ที่จำไว้ตอนสร้าง — **ตอนที่การรันล้มกลางทาง
 * รายการที่จำไว้จะไม่ครบ แต่ลายเซ็นยังอยู่ครบ** (CLAUDE.md)
 *
 * และเก็บกวาด **ก่อนเริ่มด้วย** เพื่อเก็บของที่ค้างจากรอบที่ล้มไปก่อนหน้า
 *
 * ใช้: pnpm --filter @itsm/api loadtest:write [ผู้ใช้พร้อมกัน] [ตั๋วต่อคน]
 */
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@itsm/types';

import { summarize, type Sample } from '../modules/reporting/latency-stats';

const API = process.env['LOADTEST_API'] ?? 'http://localhost:4400';
const EMAIL = process.env['LOADTEST_EMAIL'] ?? 'agent1@plusdentalclinic.co.th';
const PASSWORD = process.env['LOADTEST_PASSWORD'] ?? 'helix-dev-2569-ปลาทู';
const PROJECT = process.env['LOADTEST_PROJECT'] ?? 'SD';

/**
 * ลายเซ็นที่ทำให้ทุกแถวของรอบนี้หาเจอได้ แม้การรันจะล้มกลางทาง
 *
 * เวลามาจาก `systemClock` ไม่ใช่ `Date.now()` — INVARIANT 6 บังคับด้วย lint
 * และเหตุผลเดียวกันใช้ได้ที่นี่: เวลาทุกค่าในระบบนี้เป็น UTC ทางเดียว
 */
const STAMP = `[loadtest-${String(systemClock.nowUtc().getTime()).slice(-8)}]`;

/**
 * เพดานกันอุบัติเหตุ
 *
 * `loadtest:write 100 500` คือ 50,000 ตั๋วในฐานข้อมูลพัฒนา ซึ่งเกือบแน่ว่า
 * เป็นการพิมพ์ผิด · ปฏิเสธไปเลยดีกว่ารันแล้วค่อยมาเก็บกวาดครึ่งชั่วโมง
 */
const MAX_TICKETS = 2_000;

async function login(): Promise<string> {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`ล็อกอินไม่สำเร็จ (HTTP ${String(res.status)})`);
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  if (cookie === '') throw new Error('ล็อกอินสำเร็จแต่ไม่ได้คุกกี้กลับมา');
  return cookie;
}

interface Created {
  sample: Sample;
  itemKey: string | null;
}

/**
 * เหตุผลของความล้มเหลวครั้งแรก
 *
 * **"ล้ม 30 ครั้ง" โดยไม่บอกว่าทำไม เอาไปทำอะไรต่อไม่ได้** · รอบแรกที่รันจริง
 * ล้มทั้ง 30 ครั้ง และต้องไปยิง `curl` เองถึงจะรู้ว่าเพราะฟิลด์บังคับยังไม่ได้กรอก
 * — ซึ่งเป็นเวลาที่เสียไปเปล่า ๆ เพราะเซิร์ฟเวอร์บอกไว้ตั้งแต่แรกแล้ว
 */
let firstFailure: string | null = null;

function noteFailure(status: number, body: unknown): void {
  if (firstFailure !== null) return;
  const msg = (body as { message?: string } | null)?.message ?? '(ไม่มีข้อความ)';
  firstFailure = `HTTP ${String(status)} — ${msg}`;
}

async function createTicket(
  cookie: string,
  issueType: string,
  fields: Record<string, string>,
  n: number,
): Promise<Created> {
  const started = performance.now();
  try {
    const res = await fetch(`${API}/api/v1/work-items`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        project: PROJECT,
        issueType,
        // ข้อความไทยเดินทางผ่าน JSON เสมอ ไม่ผ่านบรรทัดคำสั่ง (§9)
        summary: `ทดสอบโหลดการเขียน ครั้งที่ ${String(n)} ${STAMP}`,
        description: 'สร้างโดยเครื่องมือวัดโหลด — ถูกลบคืนเมื่อจบการวัด',
        fields,
      }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) noteFailure(res.status, body);
    return {
      sample: { ms: performance.now() - started, ok: res.ok },
      itemKey: res.ok ? ((body as { itemKey?: string }).itemKey ?? null) : null,
    };
  } catch (e) {
    if (firstFailure === null) {
      firstFailure = `เชื่อมต่อไม่ได้ — ${e instanceof Error ? e.message : String(e)}`;
    }
    return { sample: { ms: performance.now() - started, ok: false }, itemKey: null };
  }
}

async function comment(cookie: string, itemKey: string): Promise<Sample> {
  const started = performance.now();
  try {
    const res = await fetch(`${API}/api/v1/work-items/${itemKey}/comments`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ body: `ความเห็นจากการวัดโหลด ${STAMP}`, isInternal: false }),
    });
    await res.arrayBuffer();
    return { ms: performance.now() - started, ok: res.ok };
  } catch {
    return { ms: performance.now() - started, ok: false };
  }
}

/**
 * ลบทุกอย่างที่มีลายเซ็นออก แล้ว **นับยืนยัน** ว่าไม่เหลือจริง
 *
 * ลบตามลำดับที่ foreign key ยอมให้ — ประวัติและ audit ก่อน แล้วค่อยถึงตัวงาน
 * · คืนจำนวนที่ลบไป เพื่อให้คนที่รันเห็นว่าเก็บกวาดทำงานจริง ไม่ใช่เชื่อว่าทำ
 */
async function cleanup(db: PrismaClient, signature: string): Promise<number> {
  const items = await db.workItem.findMany({
    where: { summary: { contains: signature } },
    select: { id: true },
  });
  const ids = items.map((i) => i.id);
  if (ids.length === 0) return 0;

  await db.notification.deleteMany({ where: { workItemId: { in: ids } } });
  /*
    `sla_event` ชี้ไป `work_item_sla` ไม่ใช่ไป `work_item` ตรง ๆ · ต้องหาไอดี
    ของนาฬิกาก่อน แล้วค่อยลบเหตุการณ์ของมัน — ลำดับที่ foreign key ยอมให้
  */
  const clocks = await db.workItemSla.findMany({
    where: { workItemId: { in: ids } },
    select: { id: true },
  });
  const clockIds = clocks.map((c) => c.id);
  if (clockIds.length > 0) {
    await db.slaEvent.deleteMany({ where: { workItemSlaId: { in: clockIds } } });
  }
  await db.workItemSla.deleteMany({ where: { workItemId: { in: ids } } });
  await db.workItemComment.deleteMany({ where: { workItemId: { in: ids } } });
  await db.workItemHistory.deleteMany({ where: { workItemId: { in: ids } } });
  await db.workItemFieldValue.deleteMany({ where: { workItemId: { in: ids } } });
  await db.auditLog.deleteMany({
    where: { entityType: 'work_item', entityId: { in: ids.map((i) => i.toString()) } },
  });
  const gone = await db.workItem.deleteMany({ where: { id: { in: ids } } });

  const left = await db.workItem.count({ where: { summary: { contains: signature } } });
  if (left > 0) throw new Error(`เก็บกวาดไม่ครบ — เหลืองาน ${String(left)} ใบที่มีลายเซ็นนี้`);
  return gone.count;
}

function fmt(v: number | null): string {
  return v === null ? '—' : `${String(Math.round(v))} ms`;
}

async function main(): Promise<void> {
  const users = Number(process.argv[2] ?? '5');
  const each = Number(process.argv[3] ?? '10');
  if (!Number.isInteger(users) || !Number.isInteger(each) || users < 1 || each < 1) {
    throw new Error('ใช้: loadtest:write [ผู้ใช้พร้อมกัน] [ตั๋วต่อคน] — ต้องเป็นจำนวนเต็มบวก');
  }
  const total = users * each;
  if (total > MAX_TICKETS) {
    throw new Error(
      `${String(users)} × ${String(each)} = ${String(total)} ตั๋ว ซึ่งเกินเพดาน ` +
        `${String(MAX_TICKETS)} · ถ้าตั้งใจจริงให้แก้ MAX_TICKETS พร้อมเหตุผล`,
    );
  }

  const db = new PrismaClient();
  try {
    /*
      **เก็บกวาดของเก่าก่อนเริ่ม** — รอบที่ล้มกลางทางทิ้งแถวไว้ และรอบถัดไป
      จะวัดบนฐานข้อมูลที่มีขยะจากรอบก่อน โดยไม่มีใครรู้
    */
    const stale = await cleanup(db, '[loadtest-');
    if (stale > 0) {
      process.stdout.write(`เก็บของค้างจากรอบก่อน ${String(stale)} ใบ\n`);
    }

    const before = await db.workItem.count();
    process.stdout.write(`งานในระบบก่อนเริ่ม ${before.toLocaleString('th-TH')} ใบ\n`);

    /*
      **ชนิดของงานต้องอ่านจาก workflow scheme ของโปรเจกต์นั้น**

      รอบแรกอ่านจากตาราง `issue_type` เฉย ๆ แล้วได้ "Bug" ซึ่งโปรเจกต์ SD
      ไม่ได้ตั้งค่าไว้ — **ทั้ง 30 คำขอตอบ 422 และตัวเลขที่วัดได้คือศูนย์**
      · `/work-items/options` ก็ไม่พอ เพราะมันรวมชนิดงานของทุกโปรเจกต์
      ที่ผู้ใช้เปิดดูได้ ไม่ได้บอกว่าโปรเจกต์ไหนรับชนิดไหน

      ความจริงอยู่ที่ `workflow_scheme` ซึ่งจับคู่ (โปรเจกต์ · ชนิดงาน) →
      workflow · ชนิดที่ไม่มีแถวที่นั่น คือชนิดที่โปรเจกต์นั้นรับไม่ได้ ·
      เป็นตัวอย่างของกติกาที่เขียนไว้ในคอมเมนต์เดิมเป๊ะ ๆ แต่ทำผิดเอง:
      "อ่านจากระบบจริง" ต้องอ่านจาก *ที่ที่ระบบใช้ตัดสิน* ไม่ใช่ที่ไหนก็ได้
    */
    const project = await db.project.findFirstOrThrow({
      where: { key: PROJECT },
      select: { id: true, name: true },
    });
    const scheme = await db.workflowScheme.findFirst({
      where: { projectId: project.id },
      select: { issueType: { select: { name: true } } },
    });
    if (scheme === null) {
      throw new Error(
        `โปรเจกต์ ${PROJECT} ยังไม่ได้ตั้งค่า workflow ให้ชนิดงานใดเลย — สร้างตั๋วไม่ได้`,
      );
    }
    const issueType = scheme.issueType;
    process.stdout.write(
      `โปรเจกต์ ${PROJECT} (${project.name}) · ชนิดของงาน: ${issueType.name}\n`,
    );

    /*
      **ฟิลด์บังคับต้องกรอก ไม่งั้นเซิร์ฟเวอร์ปฏิเสธก่อนแตะฐานข้อมูลเลย**

      รอบที่สองล้มทั้ง 30 ครั้งด้วย `validation_failed` เพราะ Incident ของ
      โปรเจกต์นี้บังคับ "ผลกระทบ" และ "ความเร่งด่วน" · ที่สำคัญกว่านั้น:
      ตัวเลขที่ได้จะไม่ใช่ความเร็วของการเขียน แต่เป็นความเร็วของการถูกปฏิเสธ
      ซึ่งเร็วกว่ามากและอ่านเหมือนผลที่ดี

      ค่าที่กรอกอ่านจาก `options` ของฟิลด์นั้นเอง — เลือกตัวแรกเสมอ ·
      อ่านผ่าน Prisma ไม่ใช่ผ่าน console เพราะเป็นข้อความไทย (§9)
    */
    const configs = await db.fieldConfig.findMany({
      where: { projectId: project.id, issueTypeId: (await db.issueType.findFirstOrThrow({
        where: { name: issueType.name }, select: { id: true },
      })).id, isRequired: true },
      select: { field: { select: { key: true, name: true, type: true, options: true } } },
    });
    const fields: Record<string, string> = {};
    for (const c of configs) {
      // `options` เป็น JSON — ประกาศชนิดที่แคบไว้ก่อน แล้วค่อยตรวจ ไม่ปล่อยเป็น any
      const opts: unknown = (c.field.options as { values?: unknown } | null)?.values;
      const first: unknown = Array.isArray(opts) ? (opts as unknown[])[0] : undefined;
      if (typeof first !== 'string') {
        throw new Error(
          `ฟิลด์บังคับ "${c.field.name}" (${c.field.type}) ไม่มีตัวเลือกให้เลือก — ` +
            'เครื่องมือนี้กรอกให้เองไม่ได้',
        );
      }
      fields[c.field.key] = first;
    }
    process.stdout.write(
      configs.length === 0
        ? 'ไม่มีฟิลด์บังคับ\n'
        : `ฟิลด์บังคับที่กรอกให้: ${Object.entries(fields)
            .map(([k, v]) => `${k}=${v}`)
            .join(' · ')}\n`,
    );

    process.stdout.write(`ล็อกอิน ${String(users)} คน…\n`);
    const cookies = await Promise.all(Array.from({ length: users }, () => login()));

    process.stdout.write(`สร้างตั๋ว ${String(users)} คน × ${String(each)} ใบ…\n`);
    const createSamples: Sample[] = [];
    const keys: string[] = [];
    const startedAt = performance.now();
    for (let i = 0; i < each; i += 1) {
      // ทุกคนยิงพร้อมกันในรอบเดียวกัน — นี่คือสิ่งที่ทำให้มันเป็นการวัดโหลด
      const batch = await Promise.all(cookies.map((c, u) => createTicket(c, issueType.name, fields, i * users + u)));
      for (const b of batch) {
        createSamples.push(b.sample);
        if (b.itemKey !== null) keys.push(b.itemKey);
      }
    }
    const createMs = performance.now() - startedAt;

    process.stdout.write(`เขียนความเห็นบนตั๋วที่เพิ่งสร้าง…\n`);
    const commentSamples: Sample[] = [];
    const commentStart = performance.now();
    for (let i = 0; i < keys.length; i += users) {
      const slice = keys.slice(i, i + users);
      const batch = await Promise.all(
        slice.map((k, u) => comment(cookies[u % cookies.length] as string, k)),
      );
      commentSamples.push(...batch);
    }
    const commentMs = performance.now() - commentStart;

    const c = summarize(createSamples);
    const m = summarize(commentSamples);

    process.stdout.write(`\n${'='.repeat(72)}\n`);
    process.stdout.write(
      `เขียนพร้อมกัน ${String(users)} คน · สร้าง ${String(createSamples.length)} ใบ · ` +
        `ความเห็น ${String(commentSamples.length)} ฉบับ\n`,
    );
    process.stdout.write(
      `ปริมาณงาน สร้าง ${String(Math.round((c.ok / createMs) * 1000))} ใบ/วินาที · ` +
        `ความเห็น ${String(Math.round((m.ok / Math.max(commentMs, 1)) * 1000))} ฉบับ/วินาที\n`,
    );
    process.stdout.write(`${'='.repeat(72)}\n`);
    process.stdout.write('การกระทำ'.padEnd(22) + 'สำเร็จ  ล้ม   p50      p95      p99      สูงสุด\n');
    for (const [name, s] of [
      ['สร้างตั๋ว', c],
      ['เขียนความเห็น', m],
    ] as const) {
      process.stdout.write(
        name.padEnd(22) +
          String(s.ok).padEnd(8) +
          String(s.failed).padEnd(6) +
          fmt(s.p50).padEnd(9) +
          fmt(s.p95).padEnd(9) +
          fmt(s.p99).padEnd(9) +
          fmt(s.max) +
          '\n',
      );
    }

    if (c.failed > 0 || m.failed > 0) {
      process.stdout.write(
        `\n**มีคำขอล้ม ${String(c.failed + m.failed)}** — เวลาข้างบนนับเฉพาะที่สำเร็จ ` +
          'ตัวเลขจึงดูดีกว่าความจริง\n',
      );
      if (firstFailure !== null) {
        process.stdout.write(`เหตุผลของครั้งแรก: ${firstFailure}\n`);
      }
    }
    if (c.ok < 100) {
      process.stdout.write(
        `\nหมายเหตุ: ตัวอย่างที่สำเร็จมีเพียง ${String(c.ok)} ครั้ง — ` +
          'p95 และ p99 จากชุดเล็กแบบนี้ยังเชื่อไม่ได้ ให้เพิ่มจำนวน\n',
      );
    }

    const removed = await cleanup(db, STAMP);
    const after = await db.workItem.count();
    process.stdout.write(
      `\nเก็บกวาด ${String(removed)} ใบ · งานในระบบหลังจบ ${after.toLocaleString('th-TH')} ใบ`,
    );
    /*
      **นับก่อน–หลังแล้วบอกผลต่าง** ไม่ใช่แค่บอกว่า "ลบแล้ว" · ตัวเลขที่ไม่ตรง
      คือสัญญาณเดียวที่บอกว่าการเก็บกวาดครอบไม่ครบ และต้องเห็นทันทีตอนรัน
      ไม่ใช่ตอนที่มีคนบังเอิญไปนับ
    */
    process.stdout.write(
      after === before
        ? ' — ตรงกับก่อนเริ่มพอดี\n'
        : ` — **ไม่ตรงกับก่อนเริ่ม (ต่างกัน ${String(after - before)} ใบ)**\n`,
    );
  } finally {
    await db.$disconnect();
  }
}

void main().catch((e: unknown) => {
  process.stderr.write(`วัดโหลดการเขียนล้ม: ${e instanceof Error ? e.message : String(e)}\n`);
  process.stderr.write(
    `หากล้มกลางทาง แถวที่ค้างมีลายเซ็น "${STAMP}" อยู่ในหัวข้อ — ` +
      'รันคำสั่งนี้อีกครั้งจะเก็บกวาดให้เองก่อนเริ่ม\n',
  );
  process.exitCode = 1;
});
