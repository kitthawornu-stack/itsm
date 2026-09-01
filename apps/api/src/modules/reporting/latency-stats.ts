/**
 * สถิติเวลาตอบสนอง
 *
 * เอกสารสถานะเขียนไว้เองว่า **"ยังไม่เคยวัดโหลดจริงเลยสักครั้ง"** ·
 * ก่อนจะวัดได้ ต้องมีตัวคิดเลขที่เชื่อได้ก่อน — **p95 คำนวณผิดง่ายมาก
 * และผิดแบบเงียบ** เพราะตัวเลขที่ได้ยังดูเหมือนตัวเลขที่ถูก
 *
 * ฟังก์ชันบริสุทธิ์ทั้งไฟล์ · ไม่ยิงคำขอเอง ไม่อ่านนาฬิกา
 */

export interface Sample {
  ms: number;
  /** คำขอสำเร็จหรือไม่ — ล้มแล้วเวลาไม่มีความหมาย */
  ok: boolean;
}

/**
 * เปอร์เซ็นไทล์แบบ nearest-rank
 *
 * **คืนค่าที่วัดได้จริงเสมอ** ไม่ใช่ค่าที่ประมาณขึ้นมาระหว่างสองตัว ·
 * ตัวเลขที่ไม่เคยเกิดขึ้นจริงอธิบายให้คนที่กำลังไล่ปัญหาไม่ได้ ·
 * ถ้าบอกว่า p95 = 240 ms ต้องมีคำขอจริงที่ใช้เวลา 240 ms อยู่ในชุดนั้น
 *
 * ไม่มีตัวอย่างเลย คืน `null` — **ไม่ใช่ 0** ซึ่งอ่านเหมือน "เร็วมาก"
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  /*
    **ด่านละเรื่อง ไม่ซ้อนกัน**

    ขอบบนบีบที่ `p` เพราะ `Math.min(rank, N)` ตรงที่คำนวณดัชนีไปไม่ถึงเลย
    เมื่อ p ≤ 100 (ceil(100/100 × N) = N พอดี) — ลบทิ้งแล้วเทสต์ยังเขียว

    ขอบล่างบีบที่ **อันดับ** ไม่ใช่ที่ `p` · เคยเขียน `Math.max(p, 0)` ไว้ด้วย
    แต่มันซ้ำซ้อน: p ติดลบทำให้ rank เป็น 0 หรือติดลบ ซึ่ง `Math.max(rank, 1)`
    ข้างล่างรับไว้อยู่แล้ว · สองด่านสำหรับเรื่องเดียวทำให้ลบอันไหนออก
    เทสต์ก็ยังเขียว แล้วไม่มีใครรู้ว่าอันไหนคือด่านจริง (CLAUDE.md)
  */
  const pct = Math.min(p, 100);
  const sorted = [...values].sort((a, b) => a - b);
  /*
    nearest-rank: อันดับ = ceil(p/100 × N) · **`ceil` ไม่ใช่ `floor`** —
    ทั้งสองให้ผลเหมือนกันเมื่อ p/100 × N ลงตัวพอดี ซึ่งเป็นกรณีที่คนมักทดสอบ
    แต่ต่างกันทันทีเมื่อไม่ลงตัว: p50 ของสามค่าได้ค่ากลางกับได้ค่าต่ำสุด
  */
  const rank = Math.ceil((pct / 100) * sorted.length);
  const index = Math.max(rank, 1) - 1;
  return sorted[index] as number;
}

export interface LatencySummary {
  /** จำนวนคำขอทั้งหมด รวมที่ล้ม */
  total: number;
  /** จำนวนที่สำเร็จ — **ต้องดูคู่กับ p95 เสมอ** p95 จากสามตัวอย่างไม่มีความหมาย */
  ok: number;
  failed: number;
  /** 0 ถึง 1 · คิดให้แล้ว ไม่ต้องให้คนไปหารเอง */
  failureRate: number;
  min: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}

/**
 * สรุปผลของคำขอชุดหนึ่ง
 *
 * **คำขอที่ล้มไม่ถูกนับรวมในเวลา** — 500 ที่ตอบกลับใน 2 มิลลิวินาที
 * จะดึง p95 ลงจนระบบดูเร็วขึ้นตอนที่มันกำลังพัง · แต่ยังถูกนับจำนวน
 * เพราะอัตราความล้มเหลวคือตัวเลขที่สำคัญกว่าเวลาเสียอีก
 */
export function summarize(samples: readonly Sample[]): LatencySummary {
  const good = samples.filter((s) => s.ok).map((s) => s.ms);
  const failed = samples.length - good.length;
  return {
    total: samples.length,
    ok: good.length,
    failed,
    failureRate: samples.length === 0 ? 0 : failed / samples.length,
    min: percentile(good, 0),
    p50: percentile(good, 50),
    p95: percentile(good, 95),
    p99: percentile(good, 99),
    max: percentile(good, 100),
  };
}
