/**
 * ข้อกำหนดของการจัดระดับความเสี่ยงของการเปลี่ยนแปลง — **เขียนก่อนโค้ด**
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 *   1. **ใบที่ยังไม่กรอกอะไรเลย ได้ "เสี่ยงต่ำ"** — นี่คือความล้มเหลวที่ร้ายที่สุด
 *      ของการให้คะแนนความเสี่ยงทุกแบบ · ใบที่ไม่ได้ระบุว่ากระทบอะไร ไม่ได้แปลว่า
 *      ไม่กระทบอะไร แปลว่า **ยังไม่มีใครดู** · ถ้าปล่อยให้ได้คะแนนต่ำ CAB จะเห็น
 *      "ต่ำ" แล้วผ่านเร็ว ซึ่งกลับด้านกับความจริงพอดี — เป็นกติกาเดียวกับ
 *      "ข้อมูลที่ไม่ครบต้องแปลว่าไม่มีสิทธิ์" ใน CLAUDE.md
 *   2. **ระดับที่ไม่มีเหตุผลประกอบ** — ตัวเลขที่โต้แย้งไม่ได้ คือตัวเลขที่คน
 *      จะเลิกอ่านภายในสองสัปดาห์ · ทุกระดับที่สูงกว่าต่ำ ต้องบอกได้ว่าอะไรดันขึ้นมา
 *   3. **ความเสี่ยงเป็นผลรวมแทนที่จะเป็นค่าสูงสุด** — CI สิบตัวที่ไม่มีใครพึ่งพา
 *      ไม่ได้อันตรายเท่า CI ตัวเดียวที่มีสิบระบบพึ่งพาอยู่ · การบวกทำให้สองอย่างนี้
 *      เท่ากันโดยไม่มีใครสังเกต
 */
import { describe, expect, it } from 'vitest';

import {
  DEPENDENTS_FOR_HIGH,
  RISK_ORDER,
  assessRisk,
  type RiskInput,
} from './change-risk';

/** ใบที่กรอกครบแล้วและไม่พบปัจจัยอะไรเลย — เส้นฐานของทุกเคส */
function clean(over: Partial<RiskInput> = {}): RiskInput {
  return {
    cis: [{ key: 'CI-1', name: 'เครื่องพิมพ์ชั้น 3', dependents: 0 }],
    window: { conflicts: 0, freezeOverridden: false, startsInPast: false },
    ...over,
  };
}

// ============================================================

describe('ความเสี่ยงของการเปลี่ยนแปลง · A · ระดับมาจากปัจจัยที่สูงที่สุด', () => {
  it('กรอกครบแล้วไม่พบปัจจัยอะไรเลย ได้ระดับต่ำ', () => {
    const r = assessRisk(clean());
    expect(r.level).toBe('LOW');
    expect(r.reasons).toEqual([]);
  });

  it('ปัจจัยระดับกลางหนึ่งข้อ ได้ระดับกลาง', () => {
    expect(assessRisk(clean({ window: { conflicts: 1, freezeOverridden: false, startsInPast: false } })).level).toBe('MEDIUM');
  });

  /** ค่าสูงสุด ไม่ใช่ผลรวม — สองปัจจัยกลางต้องไม่กลายเป็นสูง */
  it('**ปัจจัยระดับกลางสองข้อ ยังเป็นกลาง ไม่ใช่สูง**', () => {
    const r = assessRisk({
      cis: [{ key: 'CI-1', name: 'ระบบเวลาเข้างาน', dependents: 1 }],
      window: { conflicts: 2, freezeOverridden: false, startsInPast: false },
    });
    expect(r.reasons.length).toBeGreaterThan(1);
    expect(r.level).toBe('MEDIUM');
  });

  it('ปัจจัยกลางกับสูงปนกัน ได้ระดับสูง', () => {
    const r = assessRisk({
      cis: [{ key: 'CI-1', name: 'ระบบเวลาเข้างาน', dependents: 1 }],
      window: { conflicts: 0, freezeOverridden: true, startsInPast: false },
    });
    expect(r.level).toBe('HIGH');
  });

  /**
   * ระดับที่ไม่มีเหตุผลประกอบคือตัวเลขที่โต้แย้งไม่ได้
   *
   * ตรวจกับอินพุตหลายแบบ ไม่ใช่แบบเดียว — เคสที่ตรวจอินพุตเดียวพิสูจน์ได้แค่ว่า
   * อินพุตนั้นมีเหตุผล ไม่ได้พิสูจน์ว่าทุกทางที่ขึ้นระดับได้มีเหตุผล
   */
  it('**ทุกระดับที่สูงกว่าต่ำ ต้องมีเหตุผลอย่างน้อยหนึ่งข้อ**', () => {
    const inputs: RiskInput[] = [
      { cis: [], window: null },
      clean({ cis: [] }),
      clean({ window: null }),
      clean({ window: { conflicts: 3, freezeOverridden: false, startsInPast: false } }),
      clean({ window: { conflicts: 0, freezeOverridden: true, startsInPast: false } }),
      clean({ window: { conflicts: 0, freezeOverridden: false, startsInPast: true } }),
      clean({ cis: [{ key: 'CI-9', name: 'ฐานข้อมูลกลาง', dependents: DEPENDENTS_FOR_HIGH }] }),
    ];
    for (const input of inputs) {
      const r = assessRisk(input);
      expect(r.level, JSON.stringify(input)).not.toBe('LOW');
      expect(r.reasons.length, JSON.stringify(input)).toBeGreaterThan(0);
      // และเหตุผลที่แรงที่สุด ต้องเท่ากับระดับที่ประกาศออกมา
      expect(r.reasons[0]?.level, JSON.stringify(input)).toBe(r.level);
    }
  });
});

// ============================================================

describe('ความเสี่ยงของการเปลี่ยนแปลง · B · ข้อมูลที่ไม่ครบ = เสี่ยงขึ้น', () => {
  /**
   * **หัวใจของทั้งไฟล์**
   *
   * ใบที่ไม่ได้ระบุว่ากระทบอะไร ไม่ได้แปลว่าไม่กระทบอะไร แปลว่ายังไม่มีใครดู ·
   * ถ้าได้ระดับต่ำ CAB จะเห็น "ต่ำ" แล้วผ่านเร็ว ซึ่งกลับด้านกับความจริงพอดี
   */
  it('**ไม่ได้ผูก CI ไว้เลย ต้องไม่ได้ระดับต่ำ**', () => {
    const r = assessRisk(clean({ cis: [] }));
    expect(r.level).not.toBe('LOW');
    expect(r.reasons.some((x) => x.code === 'no-ci')).toBe(true);
  });

  it('**ยังไม่ได้กำหนดช่วงเวลาดำเนินการ ต้องไม่ได้ระดับต่ำ**', () => {
    const r = assessRisk(clean({ window: null }));
    expect(r.level).not.toBe('LOW');
    expect(r.reasons.some((x) => x.code === 'no-window')).toBe(true);
  });

  it('**ใบที่ไม่กรอกอะไรเลย เสี่ยงกว่าใบที่กรอกครบแล้วไม่พบอะไร**', () => {
    const blank = assessRisk({ cis: [], window: null });
    const filled = assessRisk(clean());
    expect(RISK_ORDER.indexOf(blank.level)).toBeGreaterThan(RISK_ORDER.indexOf(filled.level));
  });
});

// ============================================================

describe('ความเสี่ยงของการเปลี่ยนแปลง · C · ปัจจัยจากหน้าต่างเวลา', () => {
  it('ข้ามช่วงห้ามเปลี่ยนแปลง ได้ระดับสูง', () => {
    const r = assessRisk(clean({ window: { conflicts: 0, freezeOverridden: true, startsInPast: false } }));
    expect(r.level).toBe('HIGH');
    expect(r.reasons.some((x) => x.code === 'freeze-override')).toBe(true);
  });

  /** เริ่มไปแล้วก่อนบันทึก = ทำก่อนขอ ซึ่งคือ emergency change ตามนิยาม ITIL */
  it('เริ่มไปแล้วก่อนบันทึก ได้ระดับสูง', () => {
    const r = assessRisk(clean({ window: { conflicts: 0, freezeOverridden: false, startsInPast: true } }));
    expect(r.level).toBe('HIGH');
    expect(r.reasons.some((x) => x.code === 'emergency')).toBe(true);
  });

  it('ชนกับการเปลี่ยนแปลงใบอื่น ได้ระดับกลาง', () => {
    const r = assessRisk(clean({ window: { conflicts: 1, freezeOverridden: false, startsInPast: false } }));
    expect(r.level).toBe('MEDIUM');
    expect(r.reasons.some((x) => x.code === 'conflicts')).toBe(true);
  });

  it('เหตุผลบอกจำนวนใบที่ชน ไม่ใช่บอกแค่ว่าชน', () => {
    const r = assessRisk(clean({ window: { conflicts: 3, freezeOverridden: false, startsInPast: false } }));
    expect(r.reasons.find((x) => x.code === 'conflicts')?.detail).toContain('3');
  });
});

// ============================================================

describe('ความเสี่ยงของการเปลี่ยนแปลง · D · ปัจจัยจากสิ่งที่กระทบ', () => {
  it('CI ที่ไม่มีอะไรพึ่งพาอยู่ ไม่เพิ่มความเสี่ยง', () => {
    const r = assessRisk(clean({ cis: [{ key: 'CI-1', name: 'จอในห้องประชุม', dependents: 0 }] }));
    expect(r.reasons.some((x) => x.code === 'dependents')).toBe(false);
  });

  it('CI ที่มีสิ่งพึ่งพาอยู่บ้าง ได้ระดับกลาง', () => {
    const r = assessRisk(clean({ cis: [{ key: 'CI-2', name: 'เซิร์ฟเวอร์ไฟล์', dependents: 1 }] }));
    expect(r.level).toBe('MEDIUM');
  });

  it('CI ที่มีสิ่งพึ่งพามาก ได้ระดับสูง', () => {
    const r = assessRisk(
      clean({ cis: [{ key: 'CI-3', name: 'ฐานข้อมูลกลาง', dependents: DEPENDENTS_FOR_HIGH }] }),
    );
    expect(r.level).toBe('HIGH');
  });

  /**
   * **ค่าสูงสุด ไม่ใช่ผลรวม**
   *
   * CI สิบตัวที่ไม่มีใครพึ่งพา ไม่ได้อันตรายเท่า CI ตัวเดียวที่มีสิบระบบพึ่งพาอยู่ ·
   * การบวกทำให้สองอย่างนี้เท่ากันโดยไม่มีใครสังเกต
   */
  it('**ดูจากใบที่มีคนพึ่งพามากที่สุด ไม่ใช่ผลรวมของทุกใบ**', () => {
    const many = assessRisk(
      clean({
        cis: Array.from({ length: DEPENDENTS_FOR_HIGH + 5 }, (_, i) => ({
          key: `CI-${String(i)}`,
          name: `จอที่ ${String(i)}`,
          dependents: 0,
        })),
      }),
    );
    expect(many.level).toBe('LOW');
  });

  it('เหตุผลบอกชื่อ CI ที่ทำให้ระดับขึ้น ไม่ใช่แค่ตัวเลข', () => {
    const r = assessRisk(
      clean({
        cis: [
          { key: 'CI-4', name: 'จอในห้องประชุม', dependents: 0 },
          { key: 'CI-5', name: 'ฐานข้อมูลกลาง', dependents: DEPENDENTS_FOR_HIGH },
        ],
      }),
    );
    const reason = r.reasons.find((x) => x.code === 'dependents');
    expect(reason?.detail).toContain('ฐานข้อมูลกลาง');
    expect(reason?.detail).not.toContain('จอในห้องประชุม');
  });
});

// ============================================================

describe('ความเสี่ยงของการเปลี่ยนแปลง · E · รายการเหตุผล', () => {
  it('**เรียงจากปัจจัยที่แรงที่สุดก่อน** — คนอ่านบรรทัดแรกแล้วต้องรู้ว่าทำไม', () => {
    const r = assessRisk({
      cis: [{ key: 'CI-6', name: 'ระบบเวลาเข้างาน', dependents: 1 }],
      window: { conflicts: 2, freezeOverridden: true, startsInPast: false },
    });
    const levels = r.reasons.map((x) => RISK_ORDER.indexOf(x.level));
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
  });

  it('ไม่แก้ข้อมูลที่รับเข้ามา', () => {
    const input = clean({
      cis: [
        { key: 'CI-7', name: 'ก', dependents: 9 },
        { key: 'CI-8', name: 'ข', dependents: 0 },
      ],
    });
    const snapshot = JSON.stringify(input);
    assessRisk(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
