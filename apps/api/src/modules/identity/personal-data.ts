/**
 * สิทธิเจ้าของข้อมูลตาม PDPA — ส่วนที่เป็นกติกาบริสุทธิ์
 *
 * พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล ให้สิทธิสองอย่างที่ระบบนี้ต้องรองรับ:
 * **ขอสำเนาข้อมูลของตัวเอง** และ **ขอให้ลบ**
 *
 * ## "ลบ" ในระบบตั๋วงาน แปลว่าทำให้เป็นนิรนาม ไม่ใช่ลบแถว
 *
 * ประวัติของคนอื่นอ้างถึงคนคนนี้ — ตั๋วที่เขาเคยรับผิดชอบ คอมเมนต์ที่คนอื่น
 * ตอบเขา ร่องรอยการอนุมัติ · ลบแถวผู้ใช้ทิ้งแปลว่าประวัติของคนอื่นตอบไม่ได้
 * ว่าใครทำอะไร ซึ่งเป็นสิ่งที่ INVARIANT 2 มีไว้กันตั้งแต่ต้น · และ FK
 * `onDelete: Restrict` ที่ตั้งใจใส่ไว้ก็จะขวางอยู่ดี
 *
 * ## สิ่งที่ลบไม่ได้ ต้องบอก ไม่ใช่เงียบ
 *
 * ชื่อและเบอร์โทรที่คนพิมพ์ไว้ในคอมเมนต์ ลบด้วยการล้างฟิลด์ไม่ได้ ·
 * การรายงานว่า "ลบแล้ว" เฉย ๆ ทำให้องค์กรเชื่อว่าทำตามกฎหมายแล้ว
 * ซึ่งอันตรายกว่าการรู้ว่ายังไม่ครบ
 */

export class LastAdminError extends Error {
  constructor() {
    super('ลบไม่ได้ — เป็นผู้ดูแลระบบคนสุดท้าย ต้องตั้งผู้ดูแลคนอื่นก่อน');
    this.name = 'LastAdminError';
  }
}

export class StillAssignedError extends Error {
  constructor(readonly count: number) {
    super(
      `ลบไม่ได้ — ยังถือครองงานที่เปิดอยู่ ${String(count)} ใบ ` +
        'ต้องมอบหมายให้คนอื่นก่อน มิฉะนั้นจะไม่มีใครรู้ว่าต้องไปตามใคร',
    );
    this.name = 'StillAssignedError';
  }
}

export class AlreadyErasedError extends Error {
  constructor() {
    super('ผู้ใช้รายนี้ถูกทำให้เป็นนิรนามไปแล้ว');
    this.name = 'AlreadyErasedError';
  }
}

/**
 * โดเมนของอีเมลหลังทำให้เป็นนิรนาม
 *
 * `.invalid` เป็น TLD ที่ RFC 2606 สงวนไว้ให้ใช้แบบนี้โดยเฉพาะ — รับประกันว่า
 * **ส่งถึงใครไม่ได้** · การใช้โดเมนจริงของบริษัทเสี่ยงว่าวันหนึ่งจะมีคน
 * สร้างกล่องนั้นขึ้นมาจริง แล้วอีเมลของระบบจะวิ่งไปหาคนที่ไม่เกี่ยว
 */
export const ERASED_DOMAIN = 'erased.invalid';

export interface Tombstone {
  email: string;
  displayName: string;
}

/**
 * ชื่อและอีเมลที่จะใช้แทนของเดิม
 *
 * ผูกกับ `id` เพื่อให้ **ไม่ซ้ำกันระหว่างคนละคน** — `email` มี unique index
 * ต่อ tenant ถ้าใช้ค่าคงที่ค่าเดียว คนที่สองจะลบไม่ได้เลย
 *
 * ชื่อต้องอ่านออกว่าเป็นคนที่ถูกลบ **ไม่ใช่ช่องว่าง** · ชื่อว่างจะไปโผล่เป็น
 * บรรทัดเปล่าในไทม์ไลน์ แล้วคนอ่านจะคิดว่าข้อมูลหาย ไม่ใช่ว่าถูกลบตามคำขอ
 */
export function tombstoneFor(userId: bigint): Tombstone {
  const id = userId.toString();
  return {
    email: `erased-${id}@${ERASED_DOMAIN}`,
    displayName: `ผู้ใช้ที่ถูกลบตามคำขอ #${id}`,
  };
}

export interface ErasureContext {
  alreadyErased: boolean;
  /** ถอนคนนี้แล้วจะไม่เหลือผู้ดูแลระบบเลยหรือไม่ */
  isLastAdmin: boolean;
  /** งานที่ยังเปิดอยู่และเขาเป็นผู้รับผิดชอบ — งานที่ปิดแล้วไม่นับ */
  openAssignments: number;
}

/**
 * @throws {AlreadyErasedError} ทำไปแล้ว
 * @throws {LastAdminError} เป็นผู้ดูแลคนสุดท้าย
 * @throws {StillAssignedError} ยังถืองานที่เปิดอยู่
 */
export function assertErasable(c: ErasureContext): void {
  if (c.alreadyErased) throw new AlreadyErasedError();
  /*
    ลำดับการตรวจสำคัญ: ผู้ดูแลคนสุดท้ายมาก่อนงานค้าง เพราะเป็นเรื่องที่แก้ยากกว่า
    และเคยเกิดขึ้นจริงกับโปรเจกต์นี้ (เหลือ `ADMINISTER_TENANT` ศูนย์รายการ)
  */
  if (c.isLastAdmin) throw new LastAdminError();
  if (c.openAssignments > 0) throw new StillAssignedError(c.openAssignments);
}

export type ResidualKind = 'comments' | 'workLogs' | 'reportedItems' | 'attachments';

export interface ResidualRisk {
  kind: ResidualKind;
  count: number;
  /** ข้อความภาษาคน — ผู้ดูแลต้องอ่านแล้วตัดสินใจต่อได้เอง */
  detail: string;
}

const RESIDUAL_TEXT: Record<ResidualKind, (n: number) => string> = {
  comments: (n) =>
    `ข้อความที่เขียนไว้ในคอมเมนต์ ${String(n)} ข้อความ — ` +
    'ถ้ามีชื่อ เบอร์โทร หรือข้อมูลส่วนบุคคลปนอยู่ ต้องไล่แก้ทีละข้อความเอง',
  workLogs: (n) =>
    `บันทึกเวลาทำงาน ${String(n)} รายการ — ช่อง "ทำอะไรไป" เป็นข้อความอิสระ ` +
    'ที่อาจมีข้อมูลส่วนบุคคลปนอยู่',
  reportedItems: (n) =>
    `เรื่องที่เป็นผู้แจ้ง ${String(n)} ใบ — หัวข้อและรายละเอียดเป็นข้อความอิสระ ` +
    'และเป็นหลักฐานของงานที่คนอื่นทำต่อ จึงลบทิ้งไม่ได้',
  attachments: (n) =>
    `ไฟล์ที่แนบไว้ ${String(n)} ไฟล์ — ชื่อไฟล์และเนื้อหาข้างในตรวจอัตโนมัติไม่ได้`,
};

export interface ResidualCounts {
  comments: number;
  workLogs: number;
  reportedItems: number;
  attachments: number;
}

/**
 * ที่ที่ข้อมูลส่วนบุคคลอาจยังเหลืออยู่หลังทำให้เป็นนิรนาม
 *
 * เรียงจากมากไปน้อย — ผู้ดูแลควรเริ่มไล่จากกองที่ใหญ่ที่สุด ·
 * ไม่มีของค้าง = รายการว่าง **ไม่ใช่ `null`** ผู้เรียกจึงไม่ต้องแยกสองกรณี
 */
export function residualRisks(counts: ResidualCounts): ResidualRisk[] {
  const kinds: ResidualKind[] = ['comments', 'workLogs', 'reportedItems', 'attachments'];
  return kinds
    .map((kind) => ({ kind, count: counts[kind] }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((r) => ({ ...r, detail: RESIDUAL_TEXT[r.kind](r.count) }));
}
