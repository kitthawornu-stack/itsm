/**
 * นโยบายระยะเวลาเก็บข้อมูล (PDPA)
 *
 * PDPA บังคับว่าข้อมูลส่วนบุคคลต้องไม่ถูกเก็บนานเกินความจำเป็น ·
 * แต่**นี่คือฟีเจอร์ที่ลบข้อมูลของคนอื่นทิ้ง** ซึ่งเป็นชนิดที่โปรเจกต์นี้เจ็บมาแล้ว
 * (ตัวเก็บกวาดเซสชันเคยลบเซสชันจริง 187 แถวเพราะเทสต์ปลอมเวลาเข้ามา)
 *
 * ไฟล์นี้จึง **ตัดสินว่าจะลบอะไร โดยไม่ลบเอง** · ฟังก์ชันบริสุทธิ์ทั้งไฟล์
 * ไม่แตะฐานข้อมูล ไม่อ่านนาฬิกา — "ตอนนี้" ถูกส่งเข้ามาเสมอ
 */

export class UnknownRetentionTargetError extends Error {
  constructor(readonly key: string) {
    super(`ไม่รู้จักข้อมูลชนิด "${key}"`);
    this.name = 'UnknownRetentionTargetError';
  }
}

export class InvalidKeepDaysError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidKeepDaysError';
  }
}

export interface RetentionTarget {
  /** ชื่อตารางจริง — ใช้เป็นคีย์ในฐานข้อมูลและใน API */
  key: string;
  /** ชื่อที่ผู้ดูแลอ่านแล้วรู้ว่าคืออะไร — ไม่ใช่ชื่อตารางดิบ */
  label: string;
  /**
   * จำนวนวันที่น้อยที่สุดที่ยอมให้ตั้ง
   *
   * **ไม่ใช่ตัวเลขสวย ๆ** — แต่ละค่ามีเหตุผลของตัวเองใน `why`
   */
  minKeepDays: number;
  /** ทำไมขั้นต่ำถึงเป็นเท่านี้ — แสดงบนหน้าจอ ไม่ใช่ซ่อนไว้ในโค้ด */
  why: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR = 365;

/**
 * ตารางที่ตั้งนโยบายได้
 *
 * **รายการนี้สั้นโดยตั้งใจ** · ตารางที่ไม่อยู่ในนี้คือตารางที่ยังไม่มีใคร
 * คิดจนจบว่าลบแล้วอะไรพัง — และ "ยังไม่ได้คิด" ต้องแปลว่าลบไม่ได้
 */
export const RETENTION_TARGETS: readonly RetentionTarget[] = [
  {
    key: 'notification',
    label: 'การแจ้งเตือนในแอป',
    minKeepDays: 30,
    why: 'คนที่ลาพักร้อนยาวต้องกลับมาเห็นของเดือนที่แล้วได้ · เก็บสั้นกว่านี้แปลว่าคนหายไปสองสัปดาห์แล้วไม่รู้ว่าเกิดอะไรขึ้น',
  },
  {
    key: 'notification_delivery',
    label: 'ประวัติการส่งอีเมลและ LINE',
    minKeepDays: 30,
    why: 'ใช้ตอบคำถามว่า "ทำไมฉันไม่ได้รับอีเมล" ซึ่งมักถามหลังเหตุการณ์หลายสัปดาห์',
  },
  {
    key: 'audit_log',
    label: 'บันทึกการเปลี่ยนแปลง',
    minKeepDays: 3 * YEAR,
    why: 'เป็นหลักฐานว่าใครทำอะไรเมื่อไร · การตรวจสอบภายในและข้อพิพาทกับลูกค้าเกิดขึ้นเป็นปีหลังเหตุการณ์ และเมื่อลบแล้วไม่มีทางสร้างขึ้นใหม่',
  },
  {
    key: 'work_item_history',
    label: 'ประวัติของงานแต่ละใบ',
    minKeepDays: 3 * YEAR,
    why: 'เป็นที่เดียวที่รู้ว่าค่าเดิมของงานคืออะไร — เคยใช้กู้งาน 64 ใบที่ถูกเปลี่ยนสถานะโดยไม่ตั้งใจกลับมาได้ · ลบแล้วความเสียหายครั้งหน้าจะกู้ไม่ได้เลย',
  },
];

export function targetByKey(key: string): RetentionTarget {
  const found = RETENTION_TARGETS.find((t) => t.key === key);
  if (found === undefined) throw new UnknownRetentionTargetError(key);
  return found;
}

/**
 * เส้นแบ่ง: แถวที่เก่ากว่าเวลานี้ เข้าเงื่อนไขให้ลบ
 *
 * โยนเมื่อค่าที่ตั้งใช้ไม่ได้ — **ไม่ใช่คืน `null` ให้ผู้เรียกเผลอใช้ต่อ**
 */
export function cutoffFor(targetKey: string, keepDays: number, now: Date): Date {
  const target = targetByKey(targetKey);

  /*
    **0 ต้องถูกปฏิเสธ ไม่ใช่แปลว่า "ลบทันที"** — ช่องว่างที่ถูกแปลงเป็นตัวเลข
    ได้ 0 · การยอมรับมันแปลว่าคนที่เผลอกดบันทึกฟอร์มเปล่า สั่งลบทั้งตาราง
    · เศษของวันก็ไม่มีความหมาย นโยบายพูดเป็นวันเสมอ
  */
  if (!Number.isInteger(keepDays) || keepDays <= 0) {
    throw new InvalidKeepDaysError(
      `จำนวนวันต้องเป็นจำนวนเต็มบวก · ${target.label} ตั้งได้ต่ำสุด ${String(target.minKeepDays)} วัน`,
    );
  }
  if (keepDays < target.minKeepDays) {
    throw new InvalidKeepDaysError(
      `${target.label} ตั้งได้ต่ำสุด ${String(target.minKeepDays)} วัน — ${target.why}`,
    );
  }

  return new Date(now.getTime() - keepDays * DAY_MS);
}

export interface RetentionPolicy {
  target: string;
  keepDays: number;
  isEnabled: boolean;
}

export interface RetentionStep {
  target: string;
  label: string;
  keepDays: number;
  /** `null` เมื่อนโยบายนี้ใช้ไม่ได้ — ไม่มีเส้นแบ่งให้ใครเอาไปลบ */
  cutoff: Date | null;
  /**
   * จำนวนแถวที่จะถูกลบ · `null` = **ยังไม่รู้** ไม่ใช่ศูนย์
   *
   * ถ้าปนกัน หน้าจอที่ขึ้นว่า "จะลบ 0 แถว" จะทำให้คนกดยืนยันโดยไม่รู้ว่า
   * กำลังลบอะไรอยู่
   */
  affected: number | null;
  /** เหตุผลที่ใช้ไม่ได้ · `null` = ใช้ได้ */
  problem: string | null;
}

/**
 * แปลงนโยบายที่ตั้งไว้เป็นรายการสิ่งที่จะทำ — **ยังไม่ลบอะไร**
 *
 * **ไม่มีนโยบาย = ไม่มีอะไรถูกลบ** · การไม่กรองคือค่าปริยายของทุกคิวรี
 * ถ้าเผลอตรงนี้ องค์กรที่ไม่เคยตั้งอะไรเลยจะถูกลบข้อมูลทิ้ง
 *
 * @param counts จำนวนแถวที่เข้าเงื่อนไข ถ้าผู้เรียกนับมาแล้ว · ไม่ส่งมาก็ได้
 */
export function planRetention(
  policies: readonly RetentionPolicy[],
  counts: ReadonlyMap<string, number>,
  now: Date,
): RetentionStep[] {
  const steps: RetentionStep[] = [];

  for (const p of policies) {
    // นโยบายที่ปิดอยู่ ไม่ใช่นโยบายที่ตั้งค่าไว้ครึ่งทาง — ข้ามไปเลย
    if (!p.isEnabled) continue;

    let label = p.target;
    try {
      label = targetByKey(p.target).label;
    } catch {
      /*
        ตารางที่ไม่รู้จัก (ถูกถอดออกจากรายการภายหลัง หรือใส่มาทาง SQL ตรง ๆ)
        ต้อง **รายงานเป็นปัญหา ไม่ใช่ทำให้ทั้งแผนพัง** — นโยบายอันอื่น
        ยังต้องทำงานได้ และผู้ดูแลต้องเห็นว่ามีแถวเสียอยู่
      */
      steps.push({
        target: p.target,
        label: p.target,
        keepDays: p.keepDays,
        cutoff: null,
        affected: null,
        problem: `ไม่รู้จักข้อมูลชนิด "${p.target}" — อาจถูกถอดออกจากระบบแล้ว`,
      });
      continue;
    }

    try {
      const cutoff = cutoffFor(p.target, p.keepDays, now);
      steps.push({
        target: p.target,
        label,
        keepDays: p.keepDays,
        cutoff,
        // `?? null` ไม่ใช่ `?? 0` — ไม่รู้จำนวน ต่างจากรู้ว่าไม่มีอะไรจะลบ
        affected: counts.get(p.target) ?? null,
        problem: null,
      });
    } catch (e) {
      /*
        ค่าที่ต่ำกว่าขั้นต่ำ **ต้องรายงาน ไม่ใช่ข้ามเงียบ ๆ** · การข้ามเงียบ
        ทำให้ผู้ดูแลเชื่อว่านโยบายทำงานอยู่ ทั้งที่ไม่ได้ทำอะไรเลย —
        ความเชื่อที่หน้าจอสร้างขึ้นเอง แบบเดียวกับสิทธิ์ที่ให้แล้วไม่มีผล
      */
      steps.push({
        target: p.target,
        label,
        keepDays: p.keepDays,
        cutoff: null,
        affected: null,
        problem: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return steps;
}
