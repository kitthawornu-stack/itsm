/**
 * การจัดระดับความเสี่ยงของการเปลี่ยนแปลง (ITIL Change Risk)
 *
 * ฟังก์ชันบริสุทธิ์ · ไม่อ่านนาฬิกา ไม่อ่านฐานข้อมูล — ผู้เรียกรวบรวมสัญญาณ
 * มาให้ครบแล้วส่งเข้ามา · **คำนวณสดทุกครั้งที่อ่าน ไม่เก็บผลไว้** ด้วยเหตุผล
 * เดียวกับการตรวจการชนของหน้าต่างเวลา: CI ถูกผูกเพิ่มทีหลังได้ ช่วงห้ามถูก
 * ประกาศทีหลังได้ และใบอื่นเลื่อนมาชนทีหลังได้
 *
 * ## กติกาที่สำคัญที่สุด: ข้อมูลที่ไม่ครบ = เสี่ยงขึ้น ไม่ใช่เสี่ยงลง
 *
 * ใบที่ไม่ได้ระบุว่ากระทบอะไร **ไม่ได้แปลว่าไม่กระทบอะไร** แปลว่ายังไม่มีใครดู ·
 * ถ้าปล่อยให้ได้ระดับต่ำ CAB จะเห็นคำว่า "ต่ำ" แล้วผ่านเร็ว ซึ่งกลับด้านกับ
 * ความจริงพอดี — ระดับต่ำต้องได้มาจาก **การกรอกข้อมูลแล้วไม่พบอะไร**
 * ไม่ใช่จากการไม่กรอก
 *
 * เป็นกติกาเดียวกับ "ข้อมูลที่ไม่ครบต้องแปลว่าไม่มีสิทธิ์" ใน CLAUDE.md
 *
 * ## ระดับคือค่าสูงสุดของปัจจัย ไม่ใช่ผลรวม
 *
 * CI สิบตัวที่ไม่มีใครพึ่งพา ไม่ได้อันตรายเท่า CI ตัวเดียวที่มีสิบระบบพึ่งพาอยู่ ·
 * การบวกทำให้สองอย่างนี้เท่ากันโดยไม่มีใครสังเกต
 *
 * ## ยังไม่กั้นอะไร
 *
 * ระดับนี้ **แสดงอย่างเดียว** ยังไม่มี validator ตัวไหนใช้มันกั้น transition ·
 * เขียนไว้ตรงนี้เพื่อไม่ให้ใครเชื่อว่ามันกั้นแล้ว — กลไกที่ไม่มีอะไรเรียกใช้
 * ป้องกันอะไรไม่ได้เลย และความเชื่อว่ามันป้องกันอยู่ อันตรายกว่าการรู้ว่าไม่มี
 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/** เรียงจากเบาไปหนัก — ใช้เทียบระดับ อย่าเรียงใหม่โดยไม่ดูที่ที่ใช้ `indexOf` */
export const RISK_ORDER: readonly RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];

export const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: 'เสี่ยงต่ำ',
  MEDIUM: 'เสี่ยงปานกลาง',
  HIGH: 'เสี่ยงสูง',
};

/**
 * จำนวนสิ่งที่พึ่งพา CI หนึ่งตัว ที่ทำให้ขึ้นเป็นเสี่ยงสูง
 *
 * ตั้งไว้ที่ 3 เพราะเป็นจุดที่ "แตะแล้วมีคนอื่นเดือดร้อนแน่ ๆ" ·
 * **ค่านี้ควรทบทวนด้วยข้อมูลจริงหลัง pilot** เหมือน `minimum_should_match`
 * ของการค้นหา — ตอนนี้ยังไม่มีการเปลี่ยนแปลงจริงพอให้ปรับจากของจริง
 */
export const DEPENDENTS_FOR_HIGH = 3;

/** รหัสของปัจจัย — หน้าจอใช้เลือกไอคอน/คำอธิบาย ไม่ใช่แปลจากข้อความไทย */
export type RiskCode = 'no-ci' | 'no-window' | 'dependents' | 'conflicts' | 'freeze-override' | 'emergency';

export interface RiskReason {
  code: RiskCode;
  level: RiskLevel;
  /** ข้อความภาษาคน พร้อมตัวเลขและชื่อของจริง ไม่ใช่คำกล่าวลอย ๆ */
  detail: string;
}

export interface RiskCi {
  key: string;
  name: string;
  /** จำนวนสิ่งที่พึ่งพา CI ตัวนี้อยู่ — มาจากกราฟ CMDB ไม่ใช่การเดา */
  dependents: number;
}

export interface RiskInput {
  /** CI ที่ผูกกับการเปลี่ยนแปลงนี้ · รายการว่าง = ยังไม่มีใครระบุ ไม่ใช่ "ไม่กระทบ" */
  cis: readonly RiskCi[];
  /** `null` = ยังไม่ได้กำหนดช่วงเวลาดำเนินการ */
  window: {
    /** จำนวนการเปลี่ยนแปลงใบอื่นที่ชนกับช่วงนี้ */
    conflicts: number;
    /** ชนช่วงห้ามแล้วขอข้ามพร้อมเหตุผล */
    freezeOverridden: boolean;
    /** เริ่มไปแล้วก่อนบันทึก — emergency change ตามนิยาม */
    startsInPast: boolean;
  } | null;
}

export interface RiskAssessment {
  level: RiskLevel;
  /** เรียงจากปัจจัยที่แรงที่สุดก่อน — คนอ่านบรรทัดแรกแล้วต้องรู้ว่าทำไม */
  reasons: RiskReason[];
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const reasons: RiskReason[] = [];

  /*
    ดูจากใบที่มีคนพึ่งพามากที่สุด **ไม่ใช่ผลรวม** — ดู doc ข้างบน ·
    หา CI ตัวนั้นก่อนแล้วค่อยอ่านค่า เพื่อให้เหตุผลบอกชื่อได้ ไม่ใช่บอกแค่ตัวเลข

    `reduce` ที่เริ่มจาก `null` ทำให้ **`worst === null` คือคำถาม "ผูก CI ไว้หรือยัง"
    ในตัวมันเอง** — ไม่ต้องถาม `cis.length === 0` แยกอีกด่าน และไม่ต้อง
    ยืนยันชนิดด้วย `as` ที่ `noUncheckedIndexedAccess` บังคับให้เขียน ·
    ด่านที่ชนิดข้อมูลบังคับให้เขียน จะบังด่านจริงไว้ (CLAUDE.md)
  */
  const worst = input.cis.reduce<RiskCi | null>(
    (best, ci) => (best === null || ci.dependents > best.dependents ? ci : best),
    null,
  );

  if (worst === null) {
    reasons.push({
      code: 'no-ci',
      level: 'MEDIUM',
      detail: 'ยังไม่ได้ระบุว่าการเปลี่ยนแปลงนี้กระทบอะไรบ้าง',
    });
  } else {
    if (worst.dependents >= DEPENDENTS_FOR_HIGH) {
      reasons.push({
        code: 'dependents',
        level: 'HIGH',
        detail: `${worst.name} (${worst.key}) มีอีก ${String(worst.dependents)} รายการพึ่งพาอยู่`,
      });
    } else if (worst.dependents > 0) {
      reasons.push({
        code: 'dependents',
        level: 'MEDIUM',
        detail: `${worst.name} (${worst.key}) มีอีก ${String(worst.dependents)} รายการพึ่งพาอยู่`,
      });
    }
  }

  const w = input.window;
  if (w === null) {
    reasons.push({
      code: 'no-window',
      level: 'MEDIUM',
      detail: 'ยังไม่ได้กำหนดช่วงเวลาดำเนินการ',
    });
  } else {
    if (w.startsInPast) {
      reasons.push({
        code: 'emergency',
        level: 'HIGH',
        detail: 'ช่วงเวลาเริ่มไปแล้ว — ทำก่อนขอ (emergency change)',
      });
    }
    if (w.freezeOverridden) {
      reasons.push({
        code: 'freeze-override',
        level: 'HIGH',
        detail: 'ขอข้ามช่วงห้ามเปลี่ยนแปลง',
      });
    }
    if (w.conflicts > 0) {
      reasons.push({
        code: 'conflicts',
        level: 'MEDIUM',
        detail: `ชนกับการเปลี่ยนแปลงอีก ${String(w.conflicts)} ใบในช่วงเวลาเดียวกัน`,
      });
    }
  }

  /*
    เรียงตามระดับจากแรงไปเบา · `sort` ของ JS เป็น stable ตั้งแต่ ES2019
    ปัจจัยที่ระดับเท่ากันจึงคงลำดับที่ตรวจไว้ข้างบน ไม่สลับไปมาระหว่างรีเฟรช
  */
  reasons.sort((a, b) => RISK_ORDER.indexOf(b.level) - RISK_ORDER.indexOf(a.level));

  return {
    level: reasons[0]?.level ?? 'LOW',
    reasons,
  };
}
