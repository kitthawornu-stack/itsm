/**
 * เทสต์เป็นข้อกำหนดของ LexoRank (ADR-002 · Spike D)
 *
 * เขียนก่อน implementation ตามกติกาใน CLAUDE.md §4 — เอนจินประเภทนี้
 * ความผิดพลาดไม่ทำให้ระบบพัง แต่ทำให้ระบบตอบผิดอย่างเงียบ ๆ
 *
 * เคสที่สำคัญที่สุดคือข้อ "ลาก 2,000 ครั้งที่จุดเดิม" — บั๊กของ LexoRank
 * ไม่โผล่ที่ครั้งที่ 5 แต่โผล่ที่ครั้งที่หลายร้อย
 */
import { describe, expect, it } from 'vitest';

import {
  between,
  compareRank,
  distribute,
  initialRank,
  InvalidRankError,
  needsRebalance,
  nextBucket,
  RankOrderError,
} from './index.js';

describe('LexoRank · พื้นฐาน', () => {
  it('initialRank อยู่กลางช่วง', () => {
    expect(initialRank()).toBe('0|i');
  });

  it('between(null, null) ให้จุดเริ่มต้น', () => {
    expect(between(null, null)).toBe('0|i');
  });

  it('แทรกระหว่างสองค่าได้ค่าที่อยู่กลางจริง', () => {
    const mid = between('0|a', '0|c');
    expect(compareRank('0|a', mid)).toBeLessThan(0);
    expect(compareRank(mid, '0|c')).toBeLessThan(0);
  });

  it('แทรกก่อนค่าแรกได้', () => {
    const r = between(null, '0|i');
    expect(compareRank(r, '0|i')).toBeLessThan(0);
  });

  it('แทรกหลังค่าสุดท้ายได้', () => {
    const r = between('0|i', null);
    expect(compareRank('0|i', r)).toBeLessThan(0);
  });

  it('แทรกระหว่างค่าที่ติดกันสนิทได้ โดยต่อความยาว', () => {
    const mid = between('0|a', '0|b');
    expect(compareRank('0|a', mid)).toBeLessThan(0);
    expect(compareRank(mid, '0|b')).toBeLessThan(0);
    expect(mid.length).toBeGreaterThan('0|a'.length);
  });

  it('ปฏิเสธลำดับที่กลับด้าน', () => {
    expect(() => between('0|c', '0|a')).toThrow(RankOrderError);
    expect(() => between('0|a', '0|a')).toThrow(RankOrderError);
  });

  it('ปฏิเสธรูปแบบที่ไม่ถูกต้อง', () => {
    expect(() => between('abc', null)).toThrow(InvalidRankError);
    expect(() => between('0|', null)).toThrow(InvalidRankError);
    expect(() => between('9|abc', null)).toThrow(InvalidRankError);
    expect(() => between('0|ABC', null)).toThrow(InvalidRankError); // ตัวใหญ่ไม่อยู่ใน alphabet
  });
});

describe('LexoRank · distribute', () => {
  it('สร้าง n ตัวที่เรียงถูกลำดับ', () => {
    const ranks = distribute(1000);
    expect(ranks).toHaveLength(1000);
    for (let i = 1; i < ranks.length; i += 1) {
      expect(compareRank(ranks[i - 1]!, ranks[i]!)).toBeLessThan(0);
    }
  });

  it('ทุกตัวไม่ซ้ำกัน', () => {
    const ranks = distribute(5000);
    expect(new Set(ranks).size).toBe(5000);
  });

  it('ยังแทรกระหว่างสองตัวที่ติดกันได้เสมอ', () => {
    const ranks = distribute(500);
    for (let i = 1; i < ranks.length; i += 50) {
      const mid = between(ranks[i - 1]!, ranks[i]!);
      expect(compareRank(ranks[i - 1]!, mid)).toBeLessThan(0);
      expect(compareRank(mid, ranks[i]!)).toBeLessThan(0);
    }
  });
});

describe('LexoRank · การลากซ้ำ ๆ ที่จุดเดิม (เคสที่บั๊กโผล่จริง)', () => {
  it('ลาก 2,000 ครั้งที่ช่องเดิม ลำดับยังถูกต้องทุกครั้ง', () => {
    let lo = '0|a';
    const hi = '0|b';
    for (let i = 0; i < 2000; i += 1) {
      const mid = between(lo, hi);
      expect(compareRank(lo, mid), `รอบที่ ${i}: lo=${lo} mid=${mid}`).toBeLessThan(0);
      expect(compareRank(mid, hi), `รอบที่ ${i}: mid=${mid} hi=${hi}`).toBeLessThan(0);
      lo = mid;
    }
  });

  it('ลากขึ้นบนสุดซ้ำ 1,000 ครั้ง ยังได้ค่าที่น้อยลงเรื่อย ๆ', () => {
    let top = initialRank();
    for (let i = 0; i < 1000; i += 1) {
      const above = between(null, top);
      expect(compareRank(above, top), `รอบที่ ${i}`).toBeLessThan(0);
      top = above;
    }
  });

  it('ลากลงล่างสุดซ้ำ 1,000 ครั้ง ยังได้ค่าที่มากขึ้นเรื่อย ๆ', () => {
    let bottom = initialRank();
    for (let i = 0; i < 1000; i += 1) {
      const below = between(bottom, null);
      expect(compareRank(bottom, below), `รอบที่ ${i}`).toBeLessThan(0);
      bottom = below;
    }
  });
});

describe('LexoRank · จำลอง backlog จริง', () => {
  it('backlog 5,000 ใบ สลับตำแหน่ง 500 ครั้ง ลำดับยังสอดคล้องตลอด', () => {
    const items = distribute(5000).map((rank, i) => ({ id: i, rank }));

    // ตัวสุ่มแบบกำหนดค่าเริ่มต้นได้ — Math.random() ห้ามใช้ เพราะเทสต์ต้องทำซ้ำได้
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };

    for (let move = 0; move < 500; move += 1) {
      items.sort((a, b) => compareRank(a.rank, b.rank));
      const from = rnd(items.length);
      const to = rnd(items.length);
      if (from === to) continue;

      const moved = items[from]!;
      const prev = to > 0 ? items[to - 1] : null;
      const next = items[to] ?? null;
      // ข้ามเมื่อปลายทางคือตัวเอง
      if (prev?.id === moved.id || next?.id === moved.id) continue;

      const prevRank = prev?.rank ?? null;
      const nextRank = next?.rank ?? null;
      if (prevRank !== null && nextRank !== null && compareRank(prevRank, nextRank) >= 0) continue;

      moved.rank = between(prevRank, nextRank);
    }

    // ยืนยันว่าไม่มี rank ซ้ำ และเรียงได้สมบูรณ์
    const ranks = items.map((i) => i.rank);
    expect(new Set(ranks).size).toBe(ranks.length);

    const sorted = [...ranks].sort(compareRank);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(compareRank(sorted[i - 1]!, sorted[i]!)).toBeLessThan(0);
    }
  });
});

describe('LexoRank · rebalance', () => {
  it('รายการที่กระจายดีไม่ต้อง rebalance', () => {
    expect(needsRebalance(distribute(1000))).toBe(false);
  });

  it('รายการที่สตริงบานต้อง rebalance', () => {
    // ความยาวโตแบบลอการิทึม — แต่ละหลักที่เพิ่มรองรับการแทรกได้ราว log2(36) ≈ 5 ครั้ง
    // จึงต้องแทรกหลายร้อยครั้งกว่าความยาวเฉลี่ยจะทะลุ REBALANCE_THRESHOLD (12)
    // 40 ครั้งไม่พอ — นี่คือเหตุผลที่บั๊กของ LexoRank ไม่โผล่ในการทดสอบด้วยมือ
    let lo = '0|a';
    const hi = '0|b';
    const ranks: string[] = [];
    for (let i = 0; i < 400; i += 1) {
      lo = between(lo, hi);
      ranks.push(lo);
    }
    expect(needsRebalance(ranks)).toBe(true);
    // ลำดับต้องยังถูกต้องแม้สตริงบานแล้ว
    expect(compareRank(ranks.at(-1)!, hi)).toBeLessThan(0);
  });

  it('ความยาวโตแบบลอการิทึม ไม่ใช่เชิงเส้น', () => {
    let lo = '0|a';
    const hi = '0|b';
    for (let i = 0; i < 100; i += 1) lo = between(lo, hi);
    // ถ้าโตเชิงเส้นจะได้ราว 100 ตัวอักษร — ต้องน้อยกว่านั้นมาก
    expect(lo.length - 2).toBeLessThan(30);
  });

  it('bucket หมุนเวียน 0 → 1 → 2 → 0', () => {
    expect(nextBucket('0')).toBe('1');
    expect(nextBucket('1')).toBe('2');
    expect(nextBucket('2')).toBe('0');
  });
});
