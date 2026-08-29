/**
 * สายอนุมัติหลายขั้น
 *
 * ITIL เรียกร้องให้การเปลี่ยนแปลงที่กระทบผู้ใช้ ผ่านการอนุมัติมากกว่าหนึ่งชั้น
 * (หัวหน้าทีม → เจ้าของระบบ → CAB) · ตรรกะการเดินสายเป็นฟังก์ชันบริสุทธิ์
 * เพราะเคสที่สำคัญที่สุดคือ **เคสที่สายหยุดกลางทาง** และต้องทดสอบได้ครบ
 * โดยไม่ต้องมีฐานข้อมูล
 *
 * ## ทุกขั้นถูกสร้างตั้งแต่ต้น
 *
 * ขั้นที่ยังไม่ถึงมีสถานะ `WAITING` ไม่ใช่ยังไม่มีแถว · เพราะผู้ขอและผู้อนุมัติ
 * ต้องเห็นตั้งแต่แรกว่า **มีกี่ขั้น และตอนนี้อยู่ขั้นไหน** · ถ้าสร้างทีละขั้น
 * ไม่มีใครรู้ว่าเหลืออีกกี่ด่าน และถ้านิยามกระบวนการถูกแก้ระหว่างทาง
 * สายจะเปลี่ยนรูปเงียบ ๆ กลางคัน
 *
 * ## ปฏิเสธหนึ่งขั้น = จบทั้งสาย
 *
 * ขั้นที่เหลือต้องกลายเป็น `CANCELLED` ไม่ใช่ค้างเป็น `WAITING` ตลอดกาล ·
 * แถว `WAITING` ที่ค้างอยู่ทำให้ตอบไม่ได้ว่าสายนี้จบหรือยัง และคำขอใบใหม่
 * จะถูกกันไว้ด้วยเหตุผลที่ไม่มีใครเข้าใจ
 */

export type StepStatus = 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface ChainStep {
  stepNumber: number;
  status: StepStatus;
  /** คนที่ตัดสินขั้นนี้ — `null` เมื่อยังไม่มีใครตัดสิน */
  decidedById: string | null;
}

/** สถานะของทั้งสาย — คำตอบเดียวที่หน้าจอและ workflow ต้องการ */
export type ChainState = 'none' | 'pending' | 'approved' | 'rejected';

export class NotYourTurnError extends Error {
  constructor(
    readonly current: number,
    readonly asked: number,
  ) {
    super(`ยังไม่ถึงขั้นที่ ${String(asked)} — ตอนนี้รออนุมัติขั้นที่ ${String(current)} อยู่`);
    this.name = 'NotYourTurnError';
  }
}

export class AlreadyDecidedInChainError extends Error {
  constructor() {
    super(
      'คุณตัดสินขั้นก่อนหน้าของสายนี้ไปแล้ว — อนุมัติสองขั้นในสายเดียวกันไม่ได้',
    );
    this.name = 'AlreadyDecidedInChainError';
  }
}

/** เรียงขั้นตามลำดับจริง ไม่ใช่ตามเวลาที่สร้าง */
function ordered(steps: readonly ChainStep[]): ChainStep[] {
  return [...steps].sort((a, b) => a.stepNumber - b.stepNumber);
}

/**
 * ขั้นที่รอการตัดสินอยู่ตอนนี้ — `null` เมื่อสายจบแล้ว
 *
 * **เรียงด้วย `stepNumber` ไม่ใช่เวลาที่สร้าง** — ทุกขั้นถูกสร้างในทรานแซกชัน
 * เดียวกัน เวลาที่บันทึกจึงเท่ากันได้ทั้งสาย · การเรียงด้วยเวลาจะให้ลำดับที่
 * ไม่แน่นอน แล้วผู้อนุมัติขั้นที่สามอาจได้ตัดสินก่อนขั้นที่หนึ่ง
 */
export function currentStep(steps: readonly ChainStep[]): ChainStep | null {
  return ordered(steps).find((s) => s.status === 'PENDING') ?? null;
}

/** สถานะของทั้งสาย */
export function chainState(steps: readonly ChainStep[]): ChainState {
  if (steps.length === 0) return 'none';
  const list = ordered(steps);
  if (list.some((s) => s.status === 'REJECTED')) return 'rejected';
  if (list.some((s) => s.status === 'PENDING')) return 'pending';
  /*
    ทุกขั้นต้องอนุมัติครบจึงจะถือว่าอนุมัติ · สายที่มีขั้นถูกยกเลิกปนอยู่
    **ไม่ใช่สายที่อนุมัติแล้ว** — มันคือสายที่จบไปด้วยเหตุอื่น
  */
  if (list.every((s) => s.status === 'APPROVED')) return 'approved';
  return 'none';
}

export interface DecisionPlan {
  /** ขั้นที่กำลังตัดสิน */
  step: number;
  /** ขั้นถัดไปที่จะเปิดให้ตัดสิน — `null` เมื่อไม่มี */
  opensNext: number | null;
  /** ขั้นที่ต้องถูกยกเลิกเพราะสายจบแล้ว */
  cancels: number[];
  /** ทั้งสายจบหรือยัง หลังการตัดสินครั้งนี้ */
  finishes: boolean;
}

/**
 * วางแผนว่าการตัดสินครั้งนี้ทำให้อะไรเปลี่ยนบ้าง
 *
 * @throws {NotYourTurnError} เมื่อขั้นที่ขอตัดสินยังไม่ถึงคิว
 * @throws {AlreadyDecidedInChainError} เมื่อคนเดิมเคยตัดสินขั้นก่อนหน้าแล้ว
 */
export function planDecision(
  steps: readonly ChainStep[],
  stepNumber: number,
  deciderId: string,
  approve: boolean,
): DecisionPlan {
  const list = ordered(steps);
  const current = currentStep(list);
  if (current === null || current.stepNumber !== stepNumber) {
    throw new NotYourTurnError(current?.stepNumber ?? 0, stepNumber);
  }

  /*
    **คนเดียวกันตัดสินสองขั้นในสายเดียวกันไม่ได้**

    สายอนุมัติมีไว้ให้หลายสายตาดู · คนที่อยู่ทั้งกลุ่มหัวหน้าทีมและกลุ่ม CAB
    ถ้าตัดสินได้ทั้งสองขั้น สายสามขั้นจะกลายเป็นสายขั้นเดียวโดยที่หน้าจอยัง
    แสดงว่าสามขั้น — ซึ่งเป็นการแยกหน้าที่ที่หายไปโดยไม่มีใครเห็น
  */
  if (list.some((s) => s.stepNumber < stepNumber && s.decidedById === deciderId)) {
    throw new AlreadyDecidedInChainError();
  }

  if (!approve) {
    // ปฏิเสธหนึ่งขั้น = จบทั้งสาย · ขั้นที่เหลือถูกยกเลิก ไม่ใช่ค้างเป็น WAITING
    return {
      step: stepNumber,
      opensNext: null,
      cancels: list.filter((s) => s.stepNumber > stepNumber).map((s) => s.stepNumber),
      finishes: true,
    };
  }

  const next = list.find((s) => s.stepNumber > stepNumber && s.status === 'WAITING');
  return {
    step: stepNumber,
    opensNext: next?.stepNumber ?? null,
    cancels: [],
    finishes: next === undefined,
  };
}
