/**
 * วัดขนาดของสิ่งที่กำลังจะคอมมิต
 *
 * CLAUDE.md §4 ตั้งเพดานไว้ที่ 400 บรรทัด และเคยเขียนว่า "บังคับด้วย CI" ·
 * **ไม่มีอะไรบังคับเลย** — ไม่มีโฟลเดอร์ `.github/workflows` และไม่มีสคริปต์
 * ไหนวัดขนาด diff · กฎข้อนี้จึงถูกละเมิดซ้ำหลายครั้งโดยไม่มีอะไรส่งเสียง
 * ซึ่งเป็นบทเรียน "กลไกที่ไม่มีอะไรเรียกใช้ ป้องกันอะไรไม่ได้เลย"
 * ที่เกิดกับกฎในเอกสารนั้นเอง
 *
 * ## วัดอะไร
 *
 * **สิ่งที่ยังไม่ได้คอมมิต** (staged + ยังไม่ stage + **ไฟล์ใหม่ที่ยังไม่ track**)
 * เทียบกับ `HEAD` ·
 * ไม่ใช่คอมมิตล่าสุด เพราะเวลาที่กฎนี้มีประโยชน์คือ **ก่อน** ลงมือคอมมิต
 * ไม่ใช่หลัง · และเข้ากับกติกาเดิมที่ว่า "ต้องรัน `pnpm ci` ให้ผ่านก่อนเสมอ"
 * — คอมมิตแล้วต้นไม้สะอาด ตัวเลขเป็น 0 และผ่านเอง
 *
 * ## นับเทสต์ด้วย
 *
 * เจตนาของกฎคือ "ต้องมีคนรีวิวไหว" · เทสต์ที่ผิดอันตรายกว่าไม่มีเทสต์
 * (เทสต์ที่ผ่านด้วยเหตุผลผิดมีบทเรียนของตัวเองใน CLAUDE.md) จึงต้องถูกอ่าน
 * เหมือนกัน · ถ้าจะเปลี่ยนให้ไม่นับ ให้เพิ่ม `*.spec.ts` เข้า `GENERATED`
 * พร้อมเหตุผล — **ไม่ใช่แก้ตัวเลขเพดาน**
 */

/** หนึ่งบรรทัดจาก `git diff --numstat` */
export interface NumstatRow {
  path: string;
  added: number;
  removed: number;
}

/**
 * ไฟล์ที่ **เครื่องสร้าง** จึงไม่นับ — ไม่มีใครรีวิวทีละบรรทัดอยู่แล้ว
 *
 * ทุกแถวต้องมีเหตุผลกำกับ · รายการนี้คือทางที่กฎจะถูกปิดเงียบ ๆ
 * ถ้าใครเติมของที่คนต้องอ่านลงไป
 */
export const GENERATED: ReadonlyArray<{ match: RegExp; why: string }> = [
  { match: /^pnpm-lock\.yaml$/, why: 'pnpm เขียนให้' },
  { match: /^docs\/openapi\.json$/, why: 'สร้างด้วย `pnpm --filter @itsm/api openapi`' },
  { match: /^apps\/api\/prisma\/migrations\//, why: 'prisma migrate เขียนให้' },
];

export function isGenerated(path: string): boolean {
  return GENERATED.some((g) => g.match.test(path));
}

/** เพดานตาม CLAUDE.md §4 · เปลี่ยนที่นี่ที่เดียว */
export const MAX_DIFF_LINES = 400;

export interface DiffSize {
  total: number;
  /** ไฟล์ที่นับ เรียงจากใหญ่ไปเล็ก — เพื่อบอกได้ว่าจะแตกตรงไหน */
  files: Array<{ path: string; lines: number }>;
  skipped: string[];
}

/**
 * รวมขนาดจากผลของ `git diff --numstat`
 *
 * นับ **บรรทัดที่เพิ่มบวกบรรทัดที่ลบ** เพราะการลบก็ต้องถูกอ่านเหมือนกัน —
 * การแทนที่ไฟล์ 300 บรรทัดด้วยของใหม่ 300 บรรทัด คือ 600 บรรทัดที่ผู้รีวิว
 * ต้องเทียบ ไม่ใช่ 300
 *
 * ไฟล์ไบนารีที่ git รายงานเป็น `-` ถูกนับเป็น 0 บรรทัด แต่ยังอยู่ในรายการ
 * ที่ข้าม เพื่อไม่ให้หายไปเงียบ ๆ
 */
export function measure(rows: readonly NumstatRow[]): DiffSize {
  const files: Array<{ path: string; lines: number }> = [];
  const skipped: string[] = [];
  for (const r of rows) {
    if (isGenerated(r.path)) {
      skipped.push(r.path);
      continue;
    }
    files.push({ path: r.path, lines: r.added + r.removed });
  }
  files.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
  return { total: files.reduce((n, f) => n + f.lines, 0), files, skipped };
}

/**
 * แปลงผลดิบของ `git diff --numstat` เป็นแถว
 *
 * รูปแบบคือ `เพิ่ม\tลบ\tเส้นทาง` · ไฟล์ไบนารีได้ `-\t-\tเส้นทาง`
 * · เส้นทางที่ถูกเปลี่ยนชื่อมีรูปแบบพิเศษ ซึ่งเก็บทั้งบรรทัดไว้เป็นชื่อ
 * เพราะสิ่งที่เราต้องการคือจำนวนบรรทัด ไม่ใช่ชื่อที่ถูกต้องเป๊ะ
 */
export function parseNumstat(raw: string): NumstatRow[] {
  const out: NumstatRow[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    const parts = t.split('\t');
    if (parts.length < 3) continue;
    const [a, d, ...rest] = parts;
    const path = rest.join('\t');
    out.push({
      path,
      added: a === '-' || a === undefined ? 0 : Number(a),
      removed: d === '-' || d === undefined ? 0 : Number(d),
    });
  }
  return out;
}

/**
 * นับบรรทัดของไฟล์ใหม่ที่ git ยังไม่ track
 *
 * **`git diff HEAD` ไม่เห็นไฟล์ที่ยังไม่ถูก track เลย** · รอบแรกที่เขียน
 * ด่านนี้ ทดลองวางไฟล์ใหม่ 500 บรรทัดแล้วเทสต์ยังเขียว — ซึ่งแปลว่าด่าน
 * จะปล่อยผ่านคอมมิตที่ประกอบด้วยไฟล์ใหม่ทั้งหมด อันเป็นหน้าตาของคอมมิต
 * ที่ใหญ่เกินทุกใบที่ผ่านมา · เจอเพราะพิสูจน์ว่าเทสต์แดงได้ ไม่ใช่เพราะอ่านโค้ด
 */
export function untrackedRows(
  files: readonly string[],
  lineCount: (p: string) => number,
): NumstatRow[] {
  return files.map((path) => ({ path, added: lineCount(path), removed: 0 }));
}

/** ข้อความรายงาน — บอกว่าจะแตกตรงไหนได้ ไม่ใช่บอกแค่ว่าเกิน */
export function report(size: DiffSize): string {
  if (size.total === 0) return 'ไม่มีอะไรรอคอมมิต';
  const head = `${String(size.total)} บรรทัดรอคอมมิต (เพดาน ${String(MAX_DIFF_LINES)})`;
  const top = size.files
    .slice(0, 5)
    .map((f) => `  ${String(f.lines).padStart(5)}  ${f.path}`)
    .join('\n');
  const skip =
    size.skipped.length === 0
      ? ''
      : `\nไม่นับ ${String(size.skipped.length)} ไฟล์ที่เครื่องสร้าง: ${size.skipped.join(' · ')}`;
  return `${head}\n${top}${skip}`;
}
