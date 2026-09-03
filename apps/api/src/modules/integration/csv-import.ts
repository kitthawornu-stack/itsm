/**
 * นำเข้าข้อมูลจาก Excel/CSV
 *
 * องค์กรนี้ทำงานอยู่บน LINE กับ Excel · วันแรกที่เปิดใช้ระบบ ของเก่าต้อง
 * ตามมาด้วย มิฉะนั้นทุกคนจะเปิด Excel ควบคู่ไปอีกปี
 *
 * ทั้งไฟล์เป็นฟังก์ชันบริสุทธิ์ · ไม่แตะฐานข้อมูล ไม่อ่านนาฬิกา
 *
 * ## ทำไมเป็น CSV ไม่ใช่ `.xlsx`
 *
 * `.xlsx` เป็นไฟล์บีบอัดที่ต้องใช้ไลบรารีอ่าน · CSV เป็นสิ่งที่ Excel
 * บันทึกออกมาได้ทุกรุ่นและอ่านได้ด้วยตาเปล่าเมื่อมีปัญหา — ซึ่งสำคัญมาก
 * ตอนที่ต้องบอกคนว่า "แถวที่ 47 ผิดตรงไหน"
 *
 * ## ปฏิเสธทั้งไฟล์ ไม่ใช่ข้ามแถวที่ผิด
 *
 * การนำเข้าครึ่งไฟล์ทำให้องค์กรอยู่ในสภาพครึ่ง ๆ กลาง ๆ โดยไม่มีใครบอกได้
 * ว่าแถวไหนเข้าไปแล้ว · ให้แก้ไฟล์แล้วนำเข้าใหม่ทั้งไฟล์ดีกว่า
 */

import { CSV_COLUMNS } from '@itsm/types';

/**
 * อักขระแทนที่ของ Unicode (U+FFFD)
 *
 * ตัวถอดรหัสใส่ตัวนี้ให้เมื่อเจอไบต์ที่ไม่ใช่ UTF-8 · ไฟล์ที่ Excel ไทย
 * บันทึกเป็น TIS-620 จะเต็มไปด้วยมัน — **เจอแม้ตัวเดียวต้องปฏิเสธทั้งไฟล์**
 * เพราะข้อความที่เสียแล้วนำเข้าไป จะไม่มีใครรู้จนกว่าจะค้นหาไม่เจอ
 * (กับดักเดียวกับ §9 ของ CLAUDE.md ที่ `curl` แปลงภาษาไทยเป็นเครื่องหมายคำถาม)
 */
export const BROKEN_TEXT_MARKER = '�';

/** คอลัมน์ที่ต้องมีในหัวตาราง — ขาดอันไหนคือไฟล์ผิดรูปแบบ ไม่ใช่แถวผิด */
/* ชุดเดียวกับขาออก — ดู `CSV_COLUMNS` ใน @itsm/types */
export const REQUIRED_COLUMNS = CSV_COLUMNS;

export interface CsvRow {
  /** เลขบรรทัดจริงในไฟล์ เริ่มที่ 1 — ใช้บอกคนว่าไปแก้ตรงไหน */
  line: number;
  values: string[];
}

export interface CsvFile {
  header: string[];
  /** บรรทัดของหัวตาราง — เกือบเสมอคือ 1 แต่เก็บไว้ให้รายงานอ้างอิงได้ */
  headerLine: number;
  rows: CsvRow[];
}

/**
 * อ่าน CSV ตามแบบที่ Excel เขียนออกมา
 *
 * รองรับ: เครื่องหมายคำพูดครอบฟิลด์ · จุลภาคและขึ้นบรรทัดใหม่ข้างในคำพูด ·
 * คำพูดซ้อนสองตัวแทนคำพูดหนึ่งตัว · ท้ายบรรทัดแบบ Windows · BOM ของ Excel
 *
 * **นับบรรทัดจริง ไม่ใช่นับแถว** — ฟิลด์ที่มีขึ้นบรรทัดใหม่ข้างในทำให้
 * แถวหนึ่งกินหลายบรรทัด · รายงานที่ชี้ผิดบรรทัดแย่กว่าไม่ชี้เลย
 * เพราะคนจะไปแก้แถวที่ไม่ผิด
 */
export function parseCsv(text: string): CsvFile {
  // Excel ใส่ BOM ให้ทุกครั้งที่บันทึกเป็น "CSV UTF-8"
  const src = text.startsWith('﻿') ? text.slice(1) : text;

  const records: Array<{ line: number; values: string[] }> = [];
  let field = '';
  let values: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let started = false;

  const endField = (): void => {
    values.push(field);
    field = '';
  };
  const endRecord = (): void => {
    endField();
    records.push({ line: recordLine, values });
    values = [];
    started = false;
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] as string;
    if (!started && !inQuotes) {
      recordLine = line;
      started = true;
    }

    if (inQuotes) {
      if (ch === '"') {
        // คำพูดซ้อนสองตัว = คำพูดหนึ่งตัว ไม่ใช่จบฟิลด์
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\r') {
      // ท้ายบรรทัดแบบ Windows — ตัวจริงคือ `\n` ที่ตามมา
    } else if (ch === '\n') {
      endRecord();
      line += 1;
    } else {
      field += ch;
    }
  }
  // บรรทัดสุดท้ายที่ไม่มี `\n` ปิดท้าย
  if (started || field !== '' || values.length > 0) endRecord();

  const head = records[0];
  if (head === undefined) return { header: [], headerLine: 1, rows: [] };
  return {
    header: head.values,
    headerLine: head.line,
    // แถวว่างล้วนที่ Excel ชอบทิ้งไว้ท้ายไฟล์ ไม่ใช่ข้อมูล
    rows: records.slice(1).filter((r) => r.values.some((v) => v.trim() !== '')),
  };
}

export interface ImportCatalog {
  /** ชื่อสถานะที่ระบบรู้จัก — มาจาก workflow จริง ไม่ใช่รายการที่พิมพ์ไว้ */
  statuses: readonly string[];
  priorities: readonly string[];
  emails: readonly string[];
}

export interface ImportProblem {
  line: number;
  /** ชื่อคอลัมน์ · `null` เมื่อเป็นปัญหาของทั้งแถวหรือทั้งไฟล์ */
  column: string | null;
  message: string;
}

export interface ImportRow {
  line: number;
  externalKey: string;
  summary: string;
  status: string;
  /** `null` = ไม่ได้กรอก — ไม่ใช่ทุกองค์กรใช้ช่องนี้ */
  priority: string | null;
  reporterEmail: string;
}

export interface ImportPlan {
  /** ว่างเสมอเมื่อมีปัญหา — ทั้งไฟล์หรือไม่เอาเลย */
  ready: ImportRow[];
  problems: ImportProblem[];
  /** ถ้าแก้ปัญหาหมดแล้วจะได้กี่แถว — ให้คนประเมินขนาดงานได้ */
  wouldImport: number;
}

/** ข้อความที่มีอักขระแทนที่ = ไฟล์ถูกถอดรหัสผิด */
function broken(v: string): boolean {
  return v.includes(BROKEN_TEXT_MARKER);
}

export function planImport(file: CsvFile, catalog: ImportCatalog): ImportPlan {
  const problems: ImportProblem[] = [];

  for (const h of file.header) {
    if (broken(h)) {
      problems.push({
        line: file.headerLine,
        column: null,
        message:
          'หัวตารางมีอักขระที่อ่านไม่ออก — ไฟล์น่าจะบันทึกด้วยรหัสอักขระอื่นที่ไม่ใช่ UTF-8 ' +
          '(ใน Excel เลือก "CSV UTF-8" ตอนบันทึก)',
      });
      break;
    }
  }

  const index = new Map(file.header.map((h, i) => [h.trim(), i]));
  const missing = REQUIRED_COLUMNS.filter((c) => !index.has(c));
  if (missing.length > 0) {
    problems.push({
      line: file.headerLine,
      column: null,
      message: `หัวตารางขาดคอลัมน์: ${missing.join(', ')}`,
    });
    // อ่านแถวต่อไม่ได้ถ้าไม่รู้ว่าคอลัมน์ไหนคืออะไร
    return { ready: [], problems, wouldImport: file.rows.length };
  }

  const at = (r: CsvRow, col: string): string => (r.values[index.get(col) ?? -1] ?? '').trim();
  const seen = new Map<string, number>();
  const ready: ImportRow[] = [];

  for (const r of file.rows) {
    const before = problems.length;

    if (r.values.some(broken)) {
      problems.push({
        line: r.line,
        column: null,
        message:
          'มีอักขระที่อ่านไม่ออก — ไฟล์น่าจะบันทึกด้วยรหัสอักขระอื่นที่ไม่ใช่ UTF-8 ' +
          '(ใน Excel เลือก "CSV UTF-8" ตอนบันทึก)',
      });
    }

    const externalKey = at(r, 'externalKey');
    if (externalKey === '') {
      problems.push({ line: r.line, column: 'externalKey', message: 'ต้องมีรหัสอ้างอิงของเดิม' });
    } else {
      const first = seen.get(externalKey);
      if (first !== undefined) {
        problems.push({
          line: r.line,
          column: 'externalKey',
          message: `รหัส "${externalKey}" ซ้ำกับบรรทัดที่ ${String(first)}`,
        });
      } else {
        seen.set(externalKey, r.line);
      }
    }

    const summary = at(r, 'summary');
    if (summary === '') {
      problems.push({ line: r.line, column: 'summary', message: 'หัวข้อว่าง' });
    }

    /*
      **ค่าที่แมปไม่ได้ ปฏิเสธ ไม่ใช่ใส่ค่าเริ่มต้นให้เงียบ ๆ** — ตั๋วที่ไฟล์
      บอกว่า "ปิดแล้ว" กลายเป็น "ใหม่" คือประวัติที่เสียหายตั้งแต่วินาทีแรก
    */
    const status = at(r, 'status');
    if (!catalog.statuses.includes(status)) {
      problems.push({
        line: r.line,
        column: 'status',
        message: `ไม่รู้จักสถานะ "${status}" — ที่ระบบมีคือ ${catalog.statuses.join(' · ')}`,
      });
    }

    const priorityRaw = at(r, 'priority');
    const priority = priorityRaw === '' ? null : priorityRaw;
    if (priority !== null && !catalog.priorities.includes(priority)) {
      problems.push({
        line: r.line,
        column: 'priority',
        message: `ไม่รู้จักความสำคัญ "${priority}" — ที่ระบบมีคือ ${catalog.priorities.join(' · ')}`,
      });
    }

    const reporterEmail = at(r, 'reporterEmail');
    if (!catalog.emails.includes(reporterEmail)) {
      problems.push({
        line: r.line,
        column: 'reporterEmail',
        message: `ไม่มีผู้ใช้อีเมล "${reporterEmail}" ในระบบ — สร้างผู้ใช้ก่อนนำเข้า`,
      });
    }

    if (problems.length === before) {
      ready.push({ line: r.line, externalKey, summary, status, priority, reporterEmail });
    }
  }

  /*
    **มีปัญหาแม้ข้อเดียว ก็ไม่นำเข้าอะไรเลย** — แต่ยังบอกว่าถ้าแก้หมดแล้ว
    จะได้กี่แถว เพื่อให้คนประเมินขนาดงานได้
  */
  return {
    ready: problems.length === 0 ? ready : [],
    problems,
    wouldImport: file.rows.length,
  };
}
