/**
 * คำศัพท์ของไอคอนประเภทงาน — แหล่งความจริงเดียว
 *
 * `issue_type.icon_key` เป็นคอลัมน์สตริงที่ **ไม่มีใครนิยามค่าที่ยอมรับ** และ
 * ทุกทางเข้าเขียนคนละแบบ: `seed.ts` เขียนชื่อแบบ lucide (`alert-triangle`),
 * `issue-type.service` เขียน `generic`, `bootstrap.ts` เขียน `incident`,
 * เทสต์เขียน `x` · ค่าเหล่านั้นเดินทางไปถึง prop ของคอมโพเนนต์แล้วหยุดอยู่ตรงนั้น
 * มาหลายเดือน — ไม่มีอะไรเรนเดอร์ จึงไม่มีใครเห็นว่ามันขัดกันเอง
 *
 * ที่นี่จึงนิยามชุดค่าที่แสดงผลได้จริง แล้ว `normalizeIconKey` แปลค่าเดิม
 * ทุกแบบเข้ามา · **ค่าที่แปลไม่ได้ต้องได้ `generic` ไม่ใช่โยน error** —
 * ค่าที่มีอยู่แล้วในฐานข้อมูลไม่ควรทำให้หน้าจอพัง
 */

/** เรียงตามที่ผู้ดูแลจะเห็นในรายการเลือก — ทั่วไปอยู่ท้ายสุด */
export const ISSUE_TYPE_ICONS = [
  'incident',
  'request',
  'problem',
  'change',
  'epic',
  'story',
  'task',
  'bug',
  'subtask',
  'generic',
] as const;

export type IssueTypeIconKey = (typeof ISSUE_TYPE_ICONS)[number];

/** ชื่อไทยสำหรับรายการเลือกและ screen reader */
export const ISSUE_TYPE_ICON_LABEL: Readonly<Record<IssueTypeIconKey, string>> = {
  incident: 'เหตุขัดข้อง',
  request: 'คำขอบริการ',
  problem: 'ปัญหา',
  change: 'การเปลี่ยนแปลง',
  epic: 'งานใหญ่',
  story: 'เรื่อง',
  task: 'งาน',
  bug: 'ข้อบกพร่อง',
  subtask: 'งานย่อย',
  generic: 'ทั่วไป',
};

/**
 * ค่าเดิมที่มีอยู่จริงในฐานข้อมูล → คำศัพท์
 *
 * ตารางนี้ **ห้ามลบรายการ** แม้จะเลิกเขียนค่านั้นแล้ว เพราะแถวเก่ายังถืออยู่
 */
const ALIAS: Readonly<Record<string, IssueTypeIconKey>> = {
  'alert-triangle': 'incident',
  inbox: 'request',
  search: 'problem',
  'git-branch': 'change',
  layers: 'epic',
  bookmark: 'story',
  'check-square': 'task',
  'corner-down-right': 'subtask',
  // ชื่ออังกฤษของประเภทงานที่ `bootstrap.ts` เขียนไว้ตรง ๆ
  'service request': 'request',
  'sub-task': 'subtask',
};

const KNOWN = new Set<string>(ISSUE_TYPE_ICONS);

export function normalizeIconKey(raw: string | null | undefined): IssueTypeIconKey {
  if (raw === null || raw === undefined) return 'generic';
  const k = raw.trim().toLowerCase();
  if (KNOWN.has(k)) return k as IssueTypeIconKey;
  return ALIAS[k] ?? 'generic';
}
