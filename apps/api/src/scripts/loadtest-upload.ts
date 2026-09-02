/**
 * วัดโหลดของ **การอัปโหลดไฟล์แนบ**
 *
 * เอกสารสถานะเขียนไว้เองว่าการวัดโหลด "ยังไม่ได้วัดการอัปโหลด" · เป็นเส้นทาง
 * เดียวในระบบที่แตะระบบเก็บไฟล์ภายนอก (MinIO) พร้อมกับเขียนฐานข้อมูล
 * ซึ่งเป็นจุดที่ความล้มเหลวครึ่งทางเกิดได้จริง
 *
 * ## สามคำถามที่การวัดนี้ตอบ
 *
 *   1. อัปโหลดพร้อมกันหลายคนแล้วล้มไหม และเร็วแค่ไหน
 *   2. **ชื่อไฟล์ภาษาไทยรอดครบไหม** — multipart ถอดชื่อเป็น latin-1
 *      แล้วมีชั้นแปลงกลับ · เส้นทางนี้มีที่ให้พังหลายจุดและพังแบบเงียบ
 *   3. **มีแถวที่ชี้ไปไฟล์ที่ไม่มีอยู่ หรือไฟล์ที่ไม่มีแถวชี้ถึง หลงเหลือไหม**
 *      — แถวถูกจองก่อนเขียนไฟล์ (`storageKey: ''`) ตามกติกา "จองก่อนทำ"
 *      แถวที่ค้างในสภาพนั้นมองไม่เห็นจากหน้าจอ จึงสะสมได้โดยไม่มีใครรู้
 *
 * ## สัญญาเดียวกับ `loadtest-write.ts`
 *
 * ทุกไฟล์ที่อัปโหลดมีลายเซ็นอยู่ในชื่อ · เก็บกวาดถามฐานข้อมูลจากลายเซ็น
 * ไม่ใช่จากรายการที่จำไว้ · เก็บกวาดก่อนเริ่มด้วย · นับก่อน–หลังแล้วบอกผลต่าง
 *
 * ใช้: pnpm --filter @itsm/api loadtest:upload [ผู้ใช้พร้อมกัน] [ไฟล์ต่อคน]
 */
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@itsm/types';

import { deleteObject } from '../infrastructure/storage/object-store';
import { ALLOWED_MIME } from '../modules/workitem/attachment-policy';
import { summarize, type Sample } from '../modules/reporting/latency-stats';

const API = process.env['LOADTEST_API'] ?? 'http://localhost:4400';
const EMAIL = process.env['LOADTEST_EMAIL'] ?? 'agent1@plusdentalclinic.co.th';
const PASSWORD = process.env['LOADTEST_PASSWORD'] ?? 'helix-dev-2569-ปลาทู';
const PROJECT = process.env['LOADTEST_PROJECT'] ?? 'SD';

const STAMP = `loadup-${String(systemClock.nowUtc().getTime()).slice(-8)}`;

/**
 * ชื่อไฟล์ที่ใช้ทดสอบ **เป็นภาษาไทยโดยตั้งใจ**
 *
 * ถ้าใช้ชื่ออังกฤษ การวัดจะผ่านสบาย ๆ และเราจะไม่รู้เลยว่าชั้นถอดรหัสชื่อไฟล์
 * ทำงานถูกหรือไม่ · §9 บันทึกไว้ว่าเคยยืนยันผลผิดเพราะข้อความไทยถูกแปลง
 * ระหว่างทางโดยไม่มีใครเห็น
 */
const THAI_NAME = 'ภาพหน้าจอตอนเครื่องพิมพ์เสีย';

/** ขนาดไฟล์ที่ใช้ทดสอบ — เล็กพอให้วัดค่าโสหุ้ยของเส้นทาง ไม่ใช่ความเร็วเครือข่าย */
const FILE_BYTES = 64 * 1024;

/**
 * ชนิดไฟล์ที่ระบบยอมรับ — **อ่านจากรายการจริง ไม่ใช่เดา**
 *
 * รอบแรกใช้ `application/octet-stream` แล้วล้มทั้ง 20 ครั้งด้วย 422 ·
 * บทเรียนเดียวกับที่เครื่องมือวัดการเขียนเคยเจอ: "อ่านจากระบบจริง" ต้องอ่าน
 * จากที่ที่ระบบใช้ตัดสิน · ที่นี่คือ `ALLOWED_MIME` ใน `attachment-policy`
 */
const MIME = [...ALLOWED_MIME][0] ?? 'text/plain';

const MAX_FILES = 500;

let firstFailure: string | null = null;

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

interface Uploaded {
  sample: Sample;
  id: string | null;
  /** ชื่อที่เซิร์ฟเวอร์ตอบกลับมา — ใช้เทียบว่าภาษาไทยรอดหรือไม่ */
  filename: string | null;
}

async function upload(cookie: string, itemKey: string, n: number): Promise<Uploaded> {
  const body = new FormData();
  const bytes = new Uint8Array(FILE_BYTES);
  // เนื้อไฟล์ไม่สำคัญ แต่ไม่ให้เป็นศูนย์ล้วน เพราะระบบเก็บไฟล์บางตัวบีบอัดทิ้ง
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31 + n) % 251;
  body.append(
    'file',
    new Blob([bytes], { type: MIME }),
    `${THAI_NAME} ${String(n)} [${STAMP}].png`,
  );

  const started = performance.now();
  try {
    const res = await fetch(`${API}/api/v1/work-items/${itemKey}/attachments`, {
      method: 'POST',
      headers: { cookie },
      body,
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok && firstFailure === null) {
      firstFailure = `HTTP ${String(res.status)} — ${
        (data as { message?: string } | null)?.message ?? '(ไม่มีข้อความ)'
      }`;
    }
    return {
      sample: { ms: performance.now() - started, ok: res.ok },
      id: res.ok ? ((data as { id?: string }).id ?? null) : null,
      filename: res.ok ? ((data as { filename?: string }).filename ?? null) : null,
    };
  } catch (e) {
    if (firstFailure === null) {
      firstFailure = `เชื่อมต่อไม่ได้ — ${e instanceof Error ? e.message : String(e)}`;
    }
    return { sample: { ms: performance.now() - started, ok: false }, id: null, filename: null };
  }
}

/**
 * ลบทั้งแถวและไฟล์ · คืนจำนวนที่ลบ
 *
 * **ลบไฟล์ใน MinIO ด้วย** — ลบเฉพาะแถวจะทิ้งไบต์ไว้ในระบบเก็บไฟล์ตลอดไป
 * โดยไม่มีอะไรชี้ถึง และไม่มีใครรู้ว่ามันอยู่ที่นั่น
 */
async function cleanup(db: PrismaClient, signature: string): Promise<number> {
  const rows = await db.workItemAttachment.findMany({
    where: { filename: { contains: signature } },
    select: { id: true, storageKey: true },
  });
  if (rows.length === 0) return 0;

  for (const r of rows) {
    if (r.storageKey === '') continue; // แถวที่ค้างก่อนเขียนไฟล์ ไม่มีไฟล์ให้ลบ
    try {
      await deleteObject(r.storageKey);
    } catch (e) {
      process.stderr.write(
        `ลบไฟล์ ${r.storageKey} ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }
  const gone = await db.workItemAttachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });

  const left = await db.workItemAttachment.count({ where: { filename: { contains: signature } } });
  if (left > 0) throw new Error(`เก็บกวาดไม่ครบ — เหลือไฟล์แนบ ${String(left)} รายการ`);
  return gone.count;
}

function fmt(v: number | null): string {
  return v === null ? '—' : `${String(Math.round(v))} ms`;
}

async function main(): Promise<void> {
  const users = Number(process.argv[2] ?? '5');
  const each = Number(process.argv[3] ?? '4');
  if (!Number.isInteger(users) || !Number.isInteger(each) || users < 1 || each < 1) {
    throw new Error('ใช้: loadtest:upload [ผู้ใช้พร้อมกัน] [ไฟล์ต่อคน] — ต้องเป็นจำนวนเต็มบวก');
  }
  const total = users * each;
  if (total > MAX_FILES) {
    throw new Error(
      `${String(users)} × ${String(each)} = ${String(total)} ไฟล์ ซึ่งเกินเพดาน ${String(MAX_FILES)}`,
    );
  }

  const db = new PrismaClient();
  try {
    const stale = await cleanup(db, 'loadup-');
    if (stale > 0) process.stdout.write(`เก็บของค้างจากรอบก่อน ${String(stale)} รายการ\n`);

    const before = await db.workItemAttachment.count();
    const orphanBefore = await db.workItemAttachment.count({ where: { storageKey: '' } });
    process.stdout.write(
      `ไฟล์แนบในระบบก่อนเริ่ม ${String(before)} รายการ · ` +
        `แถวที่ยังไม่มีไฟล์ ${String(orphanBefore)}\n`,
    );

    /*
      ใช้งานใบที่มีอยู่จริงใบหนึ่ง — **ไม่สร้างงานใหม่** เพราะเราวัดการอัปโหลด
      ไม่ใช่การสร้างงาน · การผสมสองอย่างทำให้แยกไม่ออกว่าเวลาที่วัดได้เป็นของอะไร
    */
    const project = await db.project.findFirstOrThrow({ where: { key: PROJECT } });
    const item = await db.workItem.findFirstOrThrow({
      where: { projectId: project.id },
      select: { itemKey: true },
      orderBy: { id: 'asc' },
    });
    process.stdout.write(`แนบเข้ากับ ${item.itemKey}\n`);

    process.stdout.write(`ล็อกอิน ${String(users)} คน…\n`);
    const cookies = await Promise.all(Array.from({ length: users }, () => login()));

    process.stdout.write(
      `อัปโหลด ${String(users)} คน × ${String(each)} ไฟล์ (${String(FILE_BYTES / 1024)} KB ต่อไฟล์)…\n`,
    );
    const samples: Sample[] = [];
    const names: string[] = [];
    const startedAt = performance.now();
    for (let i = 0; i < each; i += 1) {
      const batch = await Promise.all(
        cookies.map((c, u) => upload(c, item.itemKey, i * users + u)),
      );
      for (const b of batch) {
        samples.push(b.sample);
        if (b.filename !== null) names.push(b.filename);
      }
    }
    const elapsed = performance.now() - startedAt;

    const s = summarize(samples);
    process.stdout.write(`\n${'='.repeat(72)}\n`);
    process.stdout.write(
      `อัปโหลดพร้อมกัน ${String(users)} คน · ${String(samples.length)} ไฟล์ · ` +
        `${String(Math.round((s.ok / Math.max(elapsed, 1)) * 1000))} ไฟล์/วินาที\n`,
    );
    process.stdout.write(`${'='.repeat(72)}\n`);
    process.stdout.write('การกระทำ'.padEnd(22) + 'สำเร็จ  ล้ม   p50      p95      p99      สูงสุด\n');
    process.stdout.write(
      'อัปโหลดไฟล์แนบ'.padEnd(22) +
        String(s.ok).padEnd(8) +
        String(s.failed).padEnd(6) +
        fmt(s.p50).padEnd(9) +
        fmt(s.p95).padEnd(9) +
        fmt(s.p99).padEnd(9) +
        fmt(s.max) +
        '\n',
    );
    if (s.failed > 0 && firstFailure !== null) {
      process.stdout.write(`\nเหตุผลของครั้งแรก: ${firstFailure}\n`);
    }

    /*
      **ชื่อไฟล์ภาษาไทยต้องรอดครบ** — เทียบกับต้นฉบับตรง ๆ · ถ้าเพี้ยน
      การวัดความเร็วก็ไม่มีความหมาย เพราะเรากำลังวัดเส้นทางที่ทำงานผิด
    */
    const intact = names.filter((n) => n.includes(THAI_NAME)).length;
    process.stdout.write(
      `\nชื่อไฟล์ภาษาไทยที่รอดครบ ${String(intact)} จาก ${String(names.length)}` +
        (intact === names.length ? '\n' : ' — **มีชื่อเพี้ยน**\n'),
    );
    if (names.length > 0) process.stdout.write(`ตัวอย่างชื่อที่ได้กลับมา: ${names[0] ?? ''}\n`);

    const orphanAfter = await db.workItemAttachment.count({ where: { storageKey: '' } });
    if (orphanAfter !== orphanBefore) {
      process.stdout.write(
        `\n**มีแถวที่ค้างโดยไม่มีไฟล์เพิ่มขึ้น ${String(orphanAfter - orphanBefore)} แถว** — ` +
          'แถวแบบนี้มองไม่เห็นจากหน้าจอ จึงสะสมได้โดยไม่มีใครรู้\n',
      );
    }

    const removed = await cleanup(db, STAMP);
    const after = await db.workItemAttachment.count();
    process.stdout.write(
      `\nเก็บกวาด ${String(removed)} รายการ · ไฟล์แนบในระบบหลังจบ ${String(after)}` +
        (after === before ? ' — ตรงกับก่อนเริ่มพอดี\n' : ` — **ไม่ตรง (ต่าง ${String(after - before)})**\n`),
    );
  } finally {
    await db.$disconnect();
  }
}

void main().catch((e: unknown) => {
  process.stderr.write(`วัดโหลดการอัปโหลดล้ม: ${e instanceof Error ? e.message : String(e)}\n`);
  process.stderr.write(
    `หากล้มกลางทาง แถวที่ค้างมีลายเซ็น "${STAMP}" อยู่ในชื่อไฟล์ — ` +
      'รันคำสั่งนี้อีกครั้งจะเก็บกวาดให้เองก่อนเริ่ม\n',
  );
  process.exitCode = 1;
});
