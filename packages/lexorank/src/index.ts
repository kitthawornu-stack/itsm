/**
 * LexoRank — สตริงเรียงลำดับได้ที่แทรกค่าตรงกลางได้เสมอ (ADR-002)
 *
 * ปัญหาที่แก้: ถ้าใช้ `position INT` เรียงต่อเนื่อง การลากการ์ดขึ้นบนสุดของ backlog
 * 5,000 ใบ = UPDATE 5,000 แถว · LexoRank ทำให้เป็น UPDATE แถวเดียวเสมอ
 *
 * รูปแบบ: `<bucket>|<base36>` เช่น `0|hzzzzz`
 *   - bucket 0/1/2 ใช้หมุนเวียนตอน rebalance โดยไม่ต้องล็อกทั้งคอลัมน์
 *   - ส่วน base36 ใช้อักขระ 0-9a-z เรียงตามรหัส ASCII
 *
 * ข้อควรระวังที่ทำให้พังจริง (ดู master-plan Part 13.2):
 *   1. คอลัมน์ในฐานข้อมูล **ต้องใช้ collation utf8mb4_bin** ไม่ใช่ _ci
 *      เพราะ _ci ทำให้ 'A' = 'a' ซึ่งผิดสำหรับ base-36
 *      (ดู apps/api/prisma/manual/001_rank_binary_collation.sql)
 *   2. บั๊กไม่โผล่ที่การลากครั้งที่ 5 แต่โผล่ที่ครั้งที่ 500 เมื่อสตริงยาวจน
 *      แทรกตรงกลางไม่ได้ — จึงต้องมีเทสต์ที่จำลองการลากหลายพันครั้ง
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length; // 36
const MIN_CHAR = ALPHABET[0]!; // '0'
const MAX_CHAR = ALPHABET[BASE - 1]!; // 'z'

export const BUCKETS = ['0', '1', '2'] as const;
export type Bucket = (typeof BUCKETS)[number];

/** ความยาวของส่วน base36 ที่ถือว่าควร rebalance แล้ว */
export const REBALANCE_THRESHOLD = 12;

export class InvalidRankError extends Error {
  constructor(value: string) {
    super(`rank ไม่ถูกรูปแบบ: ${JSON.stringify(value)} — ต้องเป็น "<bucket>|<base36>"`);
    this.name = 'InvalidRankError';
  }
}

export class RankOrderError extends Error {
  constructor(prev: string, next: string) {
    super(`ลำดับผิด: prev (${prev}) ต้องน้อยกว่า next (${next})`);
    this.name = 'RankOrderError';
  }
}

interface ParsedRank {
  bucket: Bucket;
  body: string;
}

function parse(rank: string): ParsedRank {
  const idx = rank.indexOf('|');
  if (idx !== 1) throw new InvalidRankError(rank);
  const bucket = rank.slice(0, 1);
  const body = rank.slice(2);
  if (!BUCKETS.includes(bucket as Bucket)) throw new InvalidRankError(rank);
  if (body.length === 0) throw new InvalidRankError(rank);
  for (const ch of body) {
    if (!ALPHABET.includes(ch)) throw new InvalidRankError(rank);
  }
  return { bucket: bucket as Bucket, body };
}

function digit(ch: string): number {
  return ALPHABET.indexOf(ch);
}

/**
 * เทียบสองรายการแบบเดียวกับที่ MySQL ทำเมื่อใช้ collation utf8mb4_bin
 * ใช้ในเทสต์เพื่อยืนยันว่าลำดับฝั่ง application ตรงกับฝั่งฐานข้อมูล
 */
export function compareRank(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * หาค่ากึ่งกลางระหว่าง prev กับ next
 *
 * - `between(null, null)` → จุดเริ่มต้นกลางช่วง
 * - `between(null, x)`    → ก่อน x (ลากขึ้นบนสุด)
 * - `between(x, null)`    → หลัง x (ลากลงล่างสุด)
 */
export function between(prev: string | null, next: string | null): string {
  if (prev === null && next === null) return `0|${MID_SEED}`;
  if (prev === null) {
    const { bucket, body } = parse(next!);
    return `${bucket}|${bodyBefore(body)}`;
  }
  if (next === null) {
    const { bucket, body } = parse(prev);
    return `${bucket}|${bodyAfter(body)}`;
  }

  const p = parse(prev);
  const n = parse(next);
  if (p.bucket !== n.bucket) {
    // ข้าม bucket เกิดได้เฉพาะช่วง rebalance — วางไว้ท้าย bucket ของ prev
    return `${p.bucket}|${bodyAfter(p.body)}`;
  }
  if (compareRank(prev, next) >= 0) throw new RankOrderError(prev, next);

  return `${p.bucket}|${bodyBetween(p.body, n.body)}`;
}

/** 'i' คือกลางของ 0-z พอดี (index 18 จาก 36) */
const MID_SEED = ALPHABET[Math.floor(BASE / 2)]!; // 'i'

/** ค่าที่อยู่ก่อน body — ถ้าหลักแรกยังลดได้ให้ลด ถ้าไม่ได้ให้ต่อท้าย */
function bodyBefore(body: string): string {
  return bodyBetween(MIN_CHAR, body);
}

/** ค่าที่อยู่หลัง body */
function bodyAfter(body: string): string {
  return bodyBetween(body, MAX_CHAR.repeat(body.length + 1));
}

/**
 * แกนกลางของอัลกอริทึม — เดินทีละหลัก
 *
 * ถ้าสองหลักติดกันมีช่องว่าง ใช้ค่ากลาง · ถ้าไม่มี ต่อความยาวออกไปอีกหลัก
 * ความยาวจึงโตขึ้นเฉพาะเมื่อจำเป็น ซึ่งเป็นเหตุผลที่ต้องมี rebalance job
 */
function bodyBetween(lo: string, hi: string): string {
  let result = '';
  let i = 0;

  for (;;) {
    const a = i < lo.length ? digit(lo[i]!) : 0;
    const b = i < hi.length ? digit(hi[i]!) : BASE;

    if (b - a > 1) {
      const mid = a + Math.floor((b - a) / 2);
      return result + ALPHABET[mid]!;
    }

    // ไม่มีช่องว่างที่หลักนี้ — คงหลักของ lo ไว้แล้วเดินต่อ
    result += i < lo.length ? lo[i]! : MIN_CHAR;
    i += 1;

    // กันวนไม่จบเมื่อ lo กับ hi ติดกันสนิท: ต่อหลักกลางท้ายสุด
    if (i > lo.length + hi.length + 2) {
      return result + MID_SEED;
    }
  }
}

/** จุดเริ่มต้นของรายการว่าง */
export function initialRank(): string {
  return `0|${MID_SEED}`;
}

/**
 * สร้าง rank n ตัวที่กระจายตัวสม่ำเสมอ — ใช้ตอน seed หรือ rebalance
 * เร็วกว่าการเรียก between() ต่อกันเป็นลูกโซ่ และได้สตริงที่สั้นกว่ามาก
 */
export function distribute(count: number, bucket: Bucket = '0'): string[] {
  if (count <= 0) return [];
  const width = Math.max(2, Math.ceil(Math.log(count + 2) / Math.log(BASE)) + 1);
  const span = BASE ** width;
  const step = Math.floor(span / (count + 1));
  if (step < 1) throw new Error(`count มากเกินกว่าที่ width ${width} รองรับได้`);

  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    out.push(`${bucket}|${encode(i * step, width)}`);
  }
  return out;
}

function encode(value: number, width: number): string {
  let v = value;
  let s = '';
  for (let i = 0; i < width; i += 1) {
    s = ALPHABET[v % BASE]! + s;
    v = Math.floor(v / BASE);
  }
  return s;
}

/** true เมื่อความยาวเฉลี่ยบานถึงจุดที่ควร rebalance bucket */
export function needsRebalance(ranks: readonly string[]): boolean {
  if (ranks.length === 0) return false;
  const total = ranks.reduce((sum, r) => sum + parse(r).body.length, 0);
  return total / ranks.length > REBALANCE_THRESHOLD;
}

export function nextBucket(current: Bucket): Bucket {
  const i = BUCKETS.indexOf(current);
  return BUCKETS[(i + 1) % BUCKETS.length]!;
}
