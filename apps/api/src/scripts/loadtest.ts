/**
 * วัดโหลดจริงกับเซิร์ฟเวอร์ที่รันอยู่
 *
 * เอกสารสถานะเขียนไว้เองว่า **"ยังไม่เคยวัดโหลดจริงเลยสักครั้ง"** ·
 * ตัวเลขที่มีอยู่เป็นการวัดเฉพาะจุด (ค้นหา · snapshot กับ EAV) ไม่ใช่
 * การจำลองผู้ใช้พร้อมกัน
 *
 * ## อ่านอย่างเดียว — ไม่เขียนอะไรเลย
 *
 * รันกับฐานข้อมูลพัฒนาได้โดยไม่ต้องกู้อะไรทีหลัง · **นี่คือเงื่อนไขที่ทำให้
 * มันถูกรันจริง** เครื่องมือวัดที่ต้องเตรียมฐานข้อมูลแยกก่อน จะไม่มีใครรัน
 *
 * ## อุ่นเครื่องก่อน แล้วรายงานทั้งสองช่วง
 *
 * คำขอแรก ๆ รวมเวลาต่อ TCP, TLS, และการคอมไพล์ครั้งแรกของ Next/Nest ·
 * การนับรวมทำให้ p99 สูงเกินจริง ส่วนการทิ้งเงียบ ๆ ก็ซ่อนต้นทุนที่ผู้ใช้
 * คนแรกของวันเจอจริง — จึงรายงานแยกทั้งคู่
 *
 * ใช้: pnpm --filter @itsm/api loadtest [ผู้ใช้พร้อมกัน] [รอบต่อคน]
 */
import { summarize, type Sample } from '../modules/reporting/latency-stats';

const API = process.env['LOADTEST_API'] ?? 'http://localhost:4400';
const EMAIL = process.env['LOADTEST_EMAIL'] ?? 'agent1@plusdentalclinic.co.th';
const PASSWORD = process.env['LOADTEST_PASSWORD'] ?? 'helix-dev-2569-ปลาทู';

/** เส้นทางที่คนเปิดบ่อยที่สุดในวันทำงานปกติ — อ่านล้วนทุกเส้น */
const ROUTES: Array<{ name: string; path: string }> = [
  { name: 'คิวงาน', path: '/api/v1/work-items?limit=50' },
  { name: 'รายละเอียดงาน', path: '/api/v1/work-items/SD-1' },
  /*
    คำค้นเป็นภาษาไทย **เข้ารหัสเป็น URL ก่อนเสมอ** — §9 บันทึกไว้ว่าเคยยืนยัน
    ผลการค้นหาผิดเพราะข้อความไทยถูกแปลงระหว่างทางโดยไม่มีใครเห็น
  */
  { name: 'ค้นหา', path: `/api/v1/work-items?q=${encodeURIComponent('รหัสผ่าน')}` },
  { name: 'กระดาน', path: '/api/v1/boards/SD' },
  { name: 'สรุปรายงาน', path: '/api/v1/reports/summary' },
];

/** จำนวนรอบอุ่นเครื่องต่อคน — ไม่นับในผลหลัก แต่รายงานแยก */
const WARMUP = 2;

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

async function hit(cookie: string, path: string): Promise<Sample> {
  const started = performance.now();
  try {
    const res = await fetch(`${API}${path}`, { headers: { cookie } });
    // อ่าน body ให้จบ — ไม่งั้นเวลาที่วัดได้คือเวลาถึง header เท่านั้น
    await res.arrayBuffer();
    return { ms: performance.now() - started, ok: res.ok };
  } catch {
    return { ms: performance.now() - started, ok: false };
  }
}

function fmt(v: number | null): string {
  return v === null ? '—' : `${String(Math.round(v))} ms`;
}

async function main(): Promise<void> {
  const users = Number(process.argv[2] ?? '10');
  const rounds = Number(process.argv[3] ?? '20');
  if (!Number.isFinite(users) || !Number.isFinite(rounds) || users < 1 || rounds < 1) {
    throw new Error('ใช้: loadtest [ผู้ใช้พร้อมกัน] [รอบต่อคน] — ต้องเป็นจำนวนเต็มบวก');
  }

  process.stdout.write(`ล็อกอิน ${String(users)} คน…\n`);
  const cookies = await Promise.all(Array.from({ length: users }, () => login()));

  const warm: Sample[] = [];
  const main_: Map<string, Sample[]> = new Map(ROUTES.map((r) => [r.name, []]));

  process.stdout.write(`อุ่นเครื่อง ${String(WARMUP)} รอบ…\n`);
  for (let i = 0; i < WARMUP; i += 1) {
    const batch = await Promise.all(
      cookies.flatMap((c) => ROUTES.map((r) => hit(c, r.path))),
    );
    warm.push(...batch);
  }

  process.stdout.write(`วัดจริง ${String(users)} คน × ${String(rounds)} รอบ…\n`);
  const startedAt = performance.now();
  for (let i = 0; i < rounds; i += 1) {
    /*
      ทุกคนยิงพร้อมกันในรอบเดียวกัน — นี่คือสิ่งที่ทำให้มันเป็นการวัดโหลด
      ไม่ใช่การวัดเวลาตอบทีละคำขอ · การยิงเรียงกันจะได้ตัวเลขที่สวยกว่า
      ความจริงเสมอ เพราะไม่มีการแย่งทรัพยากรกันเลย
    */
    const batch = await Promise.all(
      cookies.flatMap((c) => ROUTES.map(async (r) => ({ name: r.name, s: await hit(c, r.path) }))),
    );
    for (const b of batch) (main_.get(b.name) as Sample[]).push(b.s);
  }
  const elapsedMs = performance.now() - startedAt;

  const all = [...main_.values()].flat();
  const total = summarize(all);

  process.stdout.write(`\n${'='.repeat(72)}\n`);
  process.stdout.write(
    `ผู้ใช้พร้อมกัน ${String(users)} คน · ${String(rounds)} รอบ · ` +
      `${String(all.length)} คำขอ · ใช้เวลา ${String(Math.round(elapsedMs / 1000))} วินาที\n`,
  );
  process.stdout.write(
    `ปริมาณงาน ${String(Math.round((all.length / elapsedMs) * 1000))} คำขอ/วินาที\n`,
  );
  process.stdout.write(`${'='.repeat(72)}\n`);
  process.stdout.write('เส้นทาง'.padEnd(22) + 'สำเร็จ  ล้ม   p50      p95      p99      สูงสุด\n');

  for (const r of ROUTES) {
    const s = summarize(main_.get(r.name) as Sample[]);
    process.stdout.write(
      r.name.padEnd(22) +
        String(s.ok).padEnd(8) +
        String(s.failed).padEnd(6) +
        fmt(s.p50).padEnd(9) +
        fmt(s.p95).padEnd(9) +
        fmt(s.p99).padEnd(9) +
        fmt(s.max) +
        '\n',
    );
  }

  process.stdout.write(`${'-'.repeat(72)}\n`);
  process.stdout.write(
    'รวมทุกเส้นทาง'.padEnd(22) +
      String(total.ok).padEnd(8) +
      String(total.failed).padEnd(6) +
      fmt(total.p50).padEnd(9) +
      fmt(total.p95).padEnd(9) +
      fmt(total.p99).padEnd(9) +
      fmt(total.max) +
      '\n',
  );

  /*
    **รายงานช่วงอุ่นเครื่องแยก ไม่ทิ้งเงียบ ๆ** — มันคือต้นทุนที่ผู้ใช้คนแรก
    ของวันเจอจริง · การไม่พูดถึงเลยทำให้ตัวเลขหลักดูดีกว่าประสบการณ์จริง
  */
  const w = summarize(warm);
  process.stdout.write(
    `\nช่วงอุ่นเครื่อง (ไม่นับในผลหลัก): ${String(w.ok)} คำขอ · ` +
      `p50 ${fmt(w.p50)} · p95 ${fmt(w.p95)} · สูงสุด ${fmt(w.max)}\n`,
  );

  if (total.failed > 0) {
    process.stdout.write(
      `\n**มีคำขอล้ม ${String(total.failed)} จาก ${String(total.total)} ` +
        `(${String(Math.round(total.failureRate * 1000) / 10)}%)** — ` +
        'เวลาข้างบนนับเฉพาะที่สำเร็จ ตัวเลขจึงดูดีกว่าความจริง\n',
    );
  }
  // ตัวเลขที่ไม่บอกจำนวนตัวอย่าง คือตัวเลขที่ไม่มีใครตัดสินได้ว่าเชื่อได้แค่ไหน
  if (total.ok < 100) {
    process.stdout.write(
      `\nหมายเหตุ: มีตัวอย่างที่สำเร็จเพียง ${String(total.ok)} ครั้ง — ` +
        'p95 และ p99 จากชุดเล็กแบบนี้ยังเชื่อไม่ได้ ให้เพิ่มรอบ\n',
    );
  }
  process.stdout.write(`\nเปอร์เซ็นไทล์คิดแบบ nearest-rank — ทุกค่าเป็นเวลาที่วัดได้จริง\n`);
}

void main().catch((e: unknown) => {
  process.stderr.write(`วัดโหลดล้ม: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
