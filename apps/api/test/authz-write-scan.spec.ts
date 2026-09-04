/**
 * ทุกเส้นทางที่ **เขียนข้อมูล** ต้องเดินไปถึงการตัดสินใจเรื่องสิทธิ์
 *
 * ## ทำไมต้องมีไฟล์นี้ ทั้งที่มี `authz-smoke.spec.ts` แล้ว
 *
 * `authz-smoke.spec.ts` ยิงของจริง แต่ยิงได้เฉพาะ `GET` เพราะการยิง `POST`
 * ใส่ฐานข้อมูลพัฒนาคือการแก้ข้อมูลจริง · ครึ่งที่เขียนจึงไม่เคยมีด่านอะไรเลย
 * ทั้งที่มันอันตรายกว่า — `GET` ที่พลาดคือข้อมูลรั่ว ส่วน `POST` ที่พลาด
 * คือข้อมูลของคนอื่นถูกแก้
 *
 * ไฟล์นี้ตรวจจากซอร์สแทน: เดินจาก handler ของทุกเส้นทางที่ไม่ใช่ `GET`
 * ตามการเรียกฟังก์ชันเข้าไปลึกสุดสามชั้น แล้วถามว่าเจอการตัดสินใจเรื่องสิทธิ์
 * หรือไม่ · เส้นทางที่ไม่เจอ ต้องอยู่ในรายการยกเว้นที่เขียนเหตุผลไว้
 *
 * ## "ด่าน" ไม่ได้แปลว่า `assertCan` เท่านั้น
 *
 * ตอนสำรวจครั้งแรกใช้เกณฑ์ว่ามี `assertCan` ไหม แล้วได้ผลว่าโมดูล
 * `search-index` ไม่มีด่านเลย · **ซึ่งผิด** — ตัวกรองที่บันทึกไว้เป็นของ
 * เจ้าของ ด่านของมันคือ `ownerId !== ctx.actorId` ไม่ใช่คีย์สิทธิ์ ·
 * เช่นเดียวกับการให้คะแนน (ผู้แจ้งเท่านั้น) และการอนุมัติ (ต้องอยู่ในกลุ่ม
 * ผู้อนุมัติ) · เกณฑ์จึงต้องเป็น "ตัดสินใจเรื่องสิทธิ์แล้วหรือยัง"
 * ไม่ใช่ "เรียกฟังก์ชันชื่อนี้แล้วหรือยัง"
 *
 * ## ตัวสแกนตัวนี้เคยโกหกสามครั้ง — เคสท้ายไฟล์คือสิ่งที่กันไม่ให้เกิดอีก
 *
 *   1. `@Body() body: { name: string }` มีปีกกาในชนิดของพารามิเตอร์ ·
 *      `indexOf('{')` ตรง ๆ ได้ "เนื้อ handler" ที่เป็นชนิดของพารามิเตอร์
 *      → รายงานว่า **115 จาก 120** เส้นทางไม่มีด่าน
 *   2. `Promise<{ id: bigint }>` มีปีกกาในชนิดที่คืนค่า → เหลือ 95
 *   3. ตามการเรียกแค่ชั้นเดียว ทั้งที่ `saveReview` เรียก helper ที่มีด่าน
 *      → ยังเหลือ 23
 *
 * ผลจริงหลังแก้ครบ: **9 เส้นทาง** ซึ่งอ่านทีละเส้นแล้วถูกต้องทั้งหมด
 *
 * ตัวเลขทั้งสามชุดดู "น่าเชื่อ" พอ ๆ กัน · สิ่งเดียวที่แยกออกคือ **probe
 * ที่หาของซึ่งรู้แน่ว่ามีอยู่ให้เจอก่อน** (CLAUDE.md)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'src';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** ตัดคอมเมนต์ทิ้งก่อนเสมอ — ตัวนับที่นับคำในคอมเมนต์เคยหลอกเรามาแล้วสองครั้ง */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/**
 * เนื้อของฟังก์ชัน โดยเริ่มนับจากวงเล็บเปิดของพารามิเตอร์ที่ตำแหน่ง `open`
 *
 * ต้องข้ามสองอย่างก่อนถึงปีกกาจริง: **รายการพารามิเตอร์** (นับวงเล็บ)
 * และ **ชนิดที่คืนค่า** (นับวงเล็บแหลม) · ทั้งสองอย่างมีปีกกาอยู่ข้างในได้
 */
export function bodyAfter(t: string, open: number): string {
  let pd = 0;
  let i = open;
  for (; i < t.length; i += 1) {
    if (t[i] === '(') pd += 1;
    else if (t[i] === ')') {
      pd -= 1;
      if (pd === 0) {
        i += 1;
        break;
      }
    }
  }
  let ad = 0;
  let start = -1;
  for (; i < t.length; i += 1) {
    const c = t[i];
    if (c === '<') ad += 1;
    else if (c === '>') ad -= 1;
    else if (c === '{' && ad <= 0) {
      start = i;
      break;
    }
  }
  if (start === -1) return '';
  let d = 0;
  for (let j = start; j < t.length; j += 1) {
    if (t[j] === '{') d += 1;
    else if (t[j] === '}') {
      d -= 1;
      if (d === 0) return t.slice(start, j + 1);
    }
  }
  return '';
}

/**
 * รูปแบบที่นับว่า "ตัดสินใจเรื่องสิทธิ์แล้ว"
 *
 * แต่ละบรรทัดคือ *วิธีหนึ่ง* ที่โปรเจกต์นี้ใช้ตัดสิน ไม่ใช่ชื่อฟังก์ชัน
 * ที่บังเอิญมีอยู่ · เพิ่มบรรทัดใหม่ได้เมื่อมีวิธีใหม่จริง ๆ และต้องเขียนไว้
 * ว่าวิธีนั้นคืออะไร มิฉะนั้นรายการนี้จะกลายเป็นตะแกรงที่ยอมทุกอย่าง
 */
const GUARDS: ReadonlyArray<{ pattern: RegExp; means: string }> = [
  { pattern: /assertCan\s*\(/, means: 'คีย์สิทธิ์ระดับโปรเจกต์' },
  { pattern: /assertTenantAdmin\s*\(/, means: 'ผู้ดูแลระดับองค์กร' },
  { pattern: /assertBrowsable\s*\(/, means: 'ต้องเปิดดูโปรเจกต์ของงานใบนั้นได้' },
  { pattern: /browsableProjectIds\s*\(/, means: 'จำกัดด้วยรายการโปรเจกต์ที่เปิดดูได้' },
  { pattern: /inboxAudience\s*\(/, means: 'ขอบเขตกล่องแจ้งเตือนของผู้ใช้' },
  { pattern: /ownerId !== ctx\.actorId/, means: 'เจ้าของเท่านั้น' },
  /*
    **กรองด้วยเจ้าของในคิวรี ก็เป็นด่านเหมือนกัน** — `where: { ownerId: ctx.actorId }`
    ทำให้แถวของคนอื่นหาไม่เจอตั้งแต่ต้น แล้วโค้ดโยน "ไม่พบ" · เป็นการ
    *ตัดสิน* ไม่ใช่การ *เอ่ยถึง* เพราะมันจำกัดผลของคิวรีจริง ·
    รูปแบบนี้เจาะจงพอ: ต้องมี `ctx.actorId` อยู่ในค่าของ `ownerId` เท่านั้น
  */
  { pattern: /ownerId:\s*ctx\.actorId/, means: 'กรองเฉพาะแถวของเจ้าของ' },
  { pattern: /reporterId !== ctx\.actorId/, means: 'ผู้แจ้งเท่านั้น' },
  { pattern: /uploaderId === ctx\.actorId/, means: 'ผู้อัปโหลด หรือคนที่มีสิทธิ์จัดการไฟล์แนบ' },
  { pattern: /groupMember\.findFirst/, means: 'ต้องอยู่ในกลุ่มที่กำหนด' },
  { pattern: /isTenantAdmin\s*\(/, means: 'ถามว่าเป็นผู้ดูแลองค์กรไหม' },
  /*
    `can()` คืน boolean แทนการโยน — ใช้เมื่อมีทางผ่านมากกว่าหนึ่งทาง
    เช่นลบไฟล์แนบ ซึ่งผู้อัปโหลดเองก็ลบได้

    **ต้องเป็น `throw new` เท่านั้น** · เขียนแค่ `PermissionDeniedError`
    เฉย ๆ จะไปตรงกับตัวแปลง error ของ controller ที่เขียนว่า
    `if (e instanceof PermissionDeniedError) return 403` ซึ่งเป็นการ
    *แปลผล* ไม่ใช่การ *ตัดสิน* · ตอนลองครั้งแรกเป็นแบบนั้นจริง:
    `POST /filters` กับ `POST /notification-settings/me/preferences`
    ถูกนับว่ามีด่านทันที ทั้งที่ทางเดินไปไม่เคยผ่านการตัดสินใจอะไรเลย
    — และนี่คือทิศที่อันตราย เพราะมันทำให้เส้นทางที่ไม่มีด่าน "ผ่าน"
  */
  { pattern: /throw new PermissionDeniedError/, means: 'ถามด้วย can() แล้วปฏิเสธเอง' },
];

function guardIn(body: string): string | null {
  for (const g of GUARDS) if (g.pattern.test(body)) return g.means;
  return null;
}

/**
 * เส้นทางที่ **ตั้งใจ** ไม่มีด่านสิทธิ์ — ต้องมีเหตุผลกำกับทุกบรรทัด
 *
 * รายการนี้ต้องเล็ก · เส้นทางเขียนข้อมูลใหม่ที่ไม่มีด่านและไม่อยู่ในนี้
 * จะทำให้ CI แดง ซึ่งคือคุณสมบัติทั้งหมดที่ไฟล์นี้มีไว้ให้
 */
const NO_GUARD_BY_DESIGN: ReadonlyMap<string, string> = new Map([
  ['POST /auth/login', 'ทางเข้าระบบ — ยังไม่มีตัวตนให้ตรวจสิทธิ์'],
  ['POST /auth/logout', 'ออกจากระบบของตัวเอง อ่าน actorId จากเซสชันเท่านั้น'],
  ['POST /auth/logout-all', 'ปิดทุกเซสชันของตัวเอง อ่าน actorId จากเซสชันเท่านั้น'],
  [
    'POST /admin/users/password',
    'เปลี่ยนรหัสผ่านของตัวเอง — changeOwnPassword ใช้ ctx.actorId อย่างเดียว ไม่รับ id จากคำขอ จึงเล็งคนอื่นไม่ได้',
  ],
  [
    'POST /notification-settings/me/preferences',
    'ตั้งค่าการแจ้งเตือนของตัวเอง — setMyPreference อ่านและเขียนเฉพาะแถวที่ userId เป็น ctx.actorId',
  ],
]);

interface Route {
  key: string;
  file: string;
  handler: string;
  guard: string | null;
}

function collectWriteRoutes(): Route[] {
  const files = walk(ROOT);
  const src = new Map(files.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));

  function bodyOf(name: string): string | null {
    for (const [, t] of src) {
      const re = new RegExp(`(export )?(async )?function ${name}\\s*\\(`);
      const m = re.exec(t);
      if (m === null) continue;
      const body = bodyAfter(t, m.index + m[0].length - 1);
      if (body !== '') return body;
    }
    return null;
  }

  const routes: Route[] = [];
  for (const f of files.filter((x) => x.endsWith('.controller.ts'))) {
    const t = src.get(f) as string;
    const ctrl = /@Controller\(['"]([^'"]*)['"]\)/.exec(t)?.[1] ?? '';
    const re = /@(Post|Put|Patch|Delete)\(([^)]*)\)\s*(?:@[\w]+\([^)]*\)\s*)*async\s+(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const method = (m[1] as string).toUpperCase();
      const sub = /['"]([^'"]*)['"]/.exec(m[2] as string)?.[1] ?? '';
      const handler = m[3] as string;
      const body = bodyAfter(t, re.lastIndex - 1);

      let guard = guardIn(body);
      if (guard === null) {
        /*
          ตามการเรียกฟังก์ชันเข้าไป — **หลายชั้น ไม่ใช่ชั้นเดียว** ·
          `saveReview` ไม่มีด่านในตัวเอง แต่เรียก helper ที่มี ·
          การตามชั้นเดียวจึงรายงานว่ามันไม่มีด่าน ซึ่งผิด
        */
        const seen = new Set<string>();
        const queue: Array<{ b: string; depth: number }> = [{ b: body, depth: 0 }];
        while (queue.length > 0 && guard === null) {
          const cur = queue.shift() as { b: string; depth: number };
          if (cur.depth >= 3) continue;
          const called = new Set(
            [...cur.b.matchAll(/([a-z][A-Za-z0-9]{3,})\s*\(/g)].map((x) => x[1] as string),
          );
          for (const c of called) {
            if (seen.has(c)) continue;
            seen.add(c);
            const b = bodyOf(c);
            if (b === null) continue;
            const g = guardIn(b);
            if (g !== null) {
              guard = g;
              break;
            }
            queue.push({ b, depth: cur.depth + 1 });
          }
        }
      }
      routes.push({
        key: `${method} /${ctrl}${sub === '' ? '' : `/${sub}`}`,
        file: f,
        handler,
        guard,
      });
    }
  }
  return routes;
}

// ============================================================

describe('ด่านสิทธิ์ของทุกเส้นทางที่เขียนข้อมูล', () => {
  const routes = collectWriteRoutes();

  it('**ตัวสแกนหาเส้นทางเจอจริง** — ไม่ใช่ผ่านเพราะรายการว่าง', () => {
    expect(routes.length, 'หาเส้นทางที่เขียนข้อมูลไม่เจอ — ตัวสแกนพัง').toBeGreaterThan(80);
    const keys = routes.map((r) => r.key);
    // เส้นทางที่รู้แน่ว่ามีอยู่ ครอบคนละโมดูลกัน
    expect(keys).toContain('POST /work-items/:key/approvals');
    expect(keys).toContain('POST /auth/login');
    expect(keys).toContain('DELETE /config-items/:id');
  });

  /**
   * **probe ของด่าน** — ต้องพิสูจน์ว่าตัวสแกนหา *ด่าน* เจอ ไม่ใช่แค่หาเส้นทางเจอ
   *
   * สามเส้นนี้ใช้กลไกคนละแบบกัน: คีย์สิทธิ์ · เจ้าของ · กลุ่ม ·
   * ถ้าตัวสแกนตาบอดกับแบบใดแบบหนึ่ง เคสนี้จับได้ทันที
   */
  it('**ตัวสแกนหาด่านเจอจริง ทั้งสามแบบ**', () => {
    const byKey = new Map(routes.map((r) => [r.key, r]));
    expect(byKey.get('POST /work-items/:key/approvals')?.guard).not.toBeNull();
    expect(byKey.get('POST /work-items/:key/rating')?.guard).toBe('ผู้แจ้งเท่านั้น');
    expect(byKey.get('POST /work-items/:key/approvals/decision')?.guard).toBe(
      'ต้องอยู่ในกลุ่มที่กำหนด',
    );
    // แบบที่สี่: กรองด้วยเจ้าของในคิวรี
    expect(byKey.get('POST /reports/schedules/:id/delete')?.guard).toBe(
      'กรองเฉพาะแถวของเจ้าของ',
    );
  });

  /**
   * **ด่านหลักของไฟล์นี้**
   *
   * เส้นทางเขียนข้อมูลที่เดินไปไม่ถึงการตัดสินใจเรื่องสิทธิ์ ต้องอยู่ใน
   * รายการยกเว้นที่เขียนเหตุผลไว้ · เส้นทางใหม่ที่ลืมตรวจสิทธิ์โผล่ที่นี่ทันที
   */
  it('**ทุกเส้นทางที่เขียนข้อมูล ต้องเดินถึงด่าน หรืออยู่ในรายการยกเว้นที่มีเหตุผล**', () => {
    const naked = routes
      .filter((r) => r.guard === null && !NO_GUARD_BY_DESIGN.has(r.key))
      .map((r) => `${r.key}  (${r.handler} · ${r.file})`);
    expect(naked, ['เส้นทางที่เขียนข้อมูลโดยไม่ตรวจสิทธิ์:', ...naked].join('\n')).toEqual([]);
  });

  /**
   * **การแปล error ไม่ใช่การตัดสินใจ**
   *
   * controller หลายตัวมีตัวแปลงที่เขียนว่า
   * `if (e instanceof PermissionDeniedError) return 403` · ถ้ารูปแบบที่ใช้
   * ตรวจกว้างเกินไปจนไปตรงกับบรรทัดนั้น เส้นทางที่ **ไม่มีด่านเลย**
   * จะถูกนับว่ามีด่าน — ซึ่งเป็นทิศที่อันตราย เพราะไฟล์นี้จะเขียวขณะที่
   * รูรั่วเปิดอยู่ · เกิดขึ้นจริงกับสองเส้นทางตอนเขียนไฟล์นี้
   */
  it('**การดัก error เพื่อแปลงเป็น 403 ต้องไม่ถูกนับว่าเป็นด่าน**', () => {
    const mapper = '{ if (e instanceof PermissionDeniedError) return http(403); }';
    expect(guardIn(mapper), 'ตัวแปลง error ถูกนับเป็นด่าน — รูปแบบกว้างเกินไป').toBeNull();
    // แต่การปฏิเสธจริงต้องนับ
    expect(guardIn('{ if (!ok) throw new PermissionDeniedError("X"); }')).not.toBeNull();
  });

  /** รายการยกเว้นต้องไม่มีบรรทัดที่ตายแล้ว — เส้นทางที่หายไปหรือได้ด่านไปแล้ว */
  it('**รายการยกเว้นต้องไม่มีบรรทัดที่ไม่จำเป็นแล้ว**', () => {
    const byKey = new Map(routes.map((r) => [r.key, r]));
    const stale: string[] = [];
    for (const [key] of NO_GUARD_BY_DESIGN) {
      const r = byKey.get(key);
      if (r === undefined) stale.push(`${key} — ไม่มีเส้นทางนี้แล้ว`);
      else if (r.guard !== null) stale.push(`${key} — มีด่านแล้ว (${r.guard})`);
    }
    expect(stale, ['รายการยกเว้นที่ควรลบออก:', ...stale].join('\n')).toEqual([]);
  });
});

// ============================================================

/**
 * ตัวแกะเนื้อฟังก์ชัน — สามเคสนี้คือสามบั๊กที่ตัวสแกนตัวนี้เคยมีจริง
 *
 * ทุกครั้งที่มันพัง มันไม่ได้ error · มันรายงานตัวเลขที่ดูน่าเชื่อ
 * (115 · 95 · 23 จาก 120) แล้วชวนให้เชื่อว่าระบบเต็มไปด้วยรูรั่ว
 */
describe('ตัวแกะเนื้อฟังก์ชัน · กับดักที่เคยทำให้ตัวสแกนโกหก', () => {
  function bodyOfSample(sample: string): string {
    const m = /function \w+\s*\(/.exec(sample) as RegExpExecArray;
    return bodyAfter(sample, m.index + m[0].length - 1);
  }

  it('**ปีกกาในชนิดของพารามิเตอร์ ไม่ใช่ปีกกาของเนื้อฟังก์ชัน**', () => {
    const body = bodyOfSample('async function h(body: { name: string }) { return CANARY; }');
    expect(body).toContain('CANARY');
    expect(body).not.toContain('name: string');
  });

  it('**ปีกกาในชนิดที่คืนค่า ไม่ใช่ปีกกาของเนื้อฟังก์ชัน**', () => {
    const body = bodyOfSample(
      'async function h(x: string): Promise<{ id: bigint }> { return CANARY; }',
    );
    expect(body).toContain('CANARY');
    expect(body).not.toContain('id: bigint');
  });

  it('ทั้งสองอย่างพร้อมกัน', () => {
    const body = bodyOfSample(
      'async function h(b: { a: number }, c: string): Promise<{ ok: true }> { return CANARY; }',
    );
    expect(body).toContain('CANARY');
    expect(body).not.toContain('a: number');
    expect(body).not.toContain('ok: true');
  });

  /**
   * **ด่านพิสูจน์ว่าเคสข้างบนแดงได้จริง**
   *
   * ถ้าตัวแกะกลับไปใช้ `indexOf('{')` ตรง ๆ มันจะคืนชนิดของพารามิเตอร์
   * แทนเนื้อฟังก์ชัน · เคสนี้จำลองพฤติกรรมนั้นแล้วยืนยันว่าผลต่างกันจริง —
   * ถ้าไม่ต่าง แปลว่าตัวอย่างข้างบนอ่อนเกินกว่าจะจับอะไรได้
   */
  it('**ตัวอย่างข้างบนแยกของถูกกับของผิดออกจากกันได้จริง**', () => {
    /*
      จำลองตัวแกะรุ่นที่พัง: หาปีกกาตัวแรกแล้ว **นับปีกกาให้สมดุล** —
      ต้องนับ ไม่ใช่ตัดถึงท้ายสตริง มิฉะนั้นผลจะรวม CANARY ติดมาด้วย
      แล้วเคสนี้จะเขียวโดยไม่ได้พิสูจน์อะไร (รอบแรกเป็นแบบนั้นจริง)
    */
    const naiveBody = (s: string): string => {
      const st = s.indexOf('{');
      let d = 0;
      for (let i = st; i < s.length; i += 1) {
        if (s[i] === '{') d += 1;
        else if (s[i] === '}') {
          d -= 1;
          if (d === 0) return s.slice(st, i + 1);
        }
      }
      return '';
    };
    const sample = 'async function h(body: { name: string }) { return CANARY; }';
    expect(naiveBody(sample), 'ตัวแกะรุ่นที่พังต้องพลาด CANARY').not.toContain('CANARY');
    expect(bodyOfSample(sample)).toContain('CANARY');
  });
});
