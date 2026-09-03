/**
 * คัดลอกเรื่อง — ตัดสินว่าอะไรติดไปด้วย
 *
 * งานที่ต้องแจ้งซ้ำ ๆ มีจริงในศูนย์บริการ (รับพนักงานใหม่ · ขอสิทธิ์ชุดเดิม ·
 * ตรวจเครื่องประจำเดือน) · การพิมพ์ใหม่ทุกครั้งทำให้ฟิลด์บังคับถูกกรอกไม่ตรงกัน
 *
 * **สิ่งที่ไม่คัดลอก สำคัญกว่าสิ่งที่คัดลอก** — ดูรายการเหตุผลข้างล่าง
 *
 * ฟังก์ชันบริสุทธิ์ · ไม่แตะฐานข้อมูล ไม่อ่านนาฬิกา
 */

import { SUMMARY_MAX } from './workitem.service';

/** คำนำหน้าที่บอกว่าใบนี้เป็นสำเนา — อยู่ข้างหน้าเพราะคิวตัดข้อความท้ายทิ้ง */
export const CLONE_PREFIX = '[สำเนา] ';

export interface CloneSource {
  summary: string;
  description: string | null;
  issueTypeName: string;
  projectKey: string;
  priorityRank: number | null;
  /**
   * ค่าฟิลด์กำหนดเองของใบต้นทาง ในรูปที่ `prepareFieldValues` รับได้ตรง ๆ
   *
   * **เดินผ่านตัวตรวจตัวเดียวกับฟอร์ม** — สำเนาจึงสร้างสิ่งที่ฟอร์มสร้างไม่ได้
   * ไม่ได้ · ถ้าตัวเลือกเดิมถูกปิดไปแล้ว สำเนาจะถูกปฏิเสธเหมือนกับที่คนกรอกเอง
   * ถูกปฏิเสธ ซึ่งเป็นคำตอบที่ถูก ไม่ใช่ข้อจำกัด
   */
  fields: Readonly<Record<string, unknown>>;
}

export interface ClonePlan {
  summary: string;
  description: string;
  issueTypeName: string;
  projectKey: string;
  priorityRank: number | null;
  fields: Record<string, unknown>;
}

/**
 * สิ่งที่ **ไม่** ติดไปกับสำเนา และเหตุผล
 *
 * เขียนไว้เป็นค่าคงที่เพื่อให้หน้าจอบอกผู้ใช้ได้ตรงกับที่โค้ดทำจริง —
 * รายการที่อยู่ในคอมเมนต์อย่างเดียวจะเพี้ยนจากพฤติกรรมในวันที่มีคนแก้โค้ด
 */
export const NOT_COPIED: ReadonlyArray<{ what: string; why: string }> = [
  {
    what: 'สถานะ',
    why: 'สำเนาเริ่มที่สถานะแรกของ workflow เสมอ — ถ้าคัดลอกมา จะได้ตั๋วที่ "ปิดแล้ว" ตั้งแต่วินาทีแรก ไม่มีใครทำ ไม่โผล่ในคิว และ SLA ไม่เดิน',
  },
  {
    what: 'ผลการแก้ไข',
    why: 'เรื่องที่ยังไม่มีใครแตะ ต้องไม่มีคำตอบอยู่แล้ว',
  },
  {
    what: 'ผู้รับผิดชอบ',
    why: 'การมอบงานให้คนที่ไม่รู้ตัวไม่ใช่การคัดลอก — และคนนั้นอาจไม่ได้อยู่แล้ว',
  },
  {
    what: 'วันครบกำหนด',
    why: 'กำหนดที่ผ่านไปแล้วทำให้สำเนาหลุด SLA ตั้งแต่ยังไม่เริ่ม',
  },
  {
    what: 'ความเห็น ไฟล์แนบ และประวัติ',
    why: 'เป็นเรื่องราวของใบเดิม ไม่ใช่ของใบใหม่ — การคัดลอกมาทำให้ประวัติของสองใบเล่าเรื่องเดียวกันคนละที่',
  },
];

/**
 * แผนการสร้างสำเนา
 *
 * คำนำหน้าไม่ซ้อนกัน — คัดลอกสำเนาอีกทีต้องไม่ได้ `[สำเนา] [สำเนา] …`
 * ซึ่งกินที่หัวข้อจนอ่านไม่ออก
 */
export function planClone(source: CloneSource): ClonePlan {
  const base = source.summary.startsWith(CLONE_PREFIX)
    ? source.summary
    : `${CLONE_PREFIX}${source.summary}`;

  return {
    // ตัด **หลัง** ใส่คำนำหน้า — ตัดก่อนแล้วต่อคำนำหน้าจะยาวเกินเพดาน
    summary: base.slice(0, SUMMARY_MAX),
    description: source.description ?? '',
    issueTypeName: source.issueTypeName,
    projectKey: source.projectKey,
    priorityRank: source.priorityRank,
    fields: { ...source.fields },
  };
}
