/**
 * OpenSearch mapping สำหรับ work item (ADR-005)
 *
 * ผลการสำรวจจริงบน OpenSearch 2.17 (Spike C) ที่กำหนดการออกแบบนี้:
 *
 *   1. `standard` tokenizer คืน "ลืมรหัสผ่านเข้าระบบไม่ได้" เป็น **1 token**
 *      → ยืนยัน ADR-005: การตัดคำด้วยช่องว่างใช้กับภาษาไทยไม่ได้เลย
 *
 *   2. `thai` tokenizer ตัดได้ถูกต้อง: ลืม|รหัส|ผ่าน|เข้า|ระบบ|ไม่|ได้
 *      → ใช้ตัวนี้เป็นฐาน
 *
 *   3. **`thai` analyzer สำเร็จรูปตัดคำทิ้งมากเกินไป** — 7 token เหลือ 3
 *      เพราะ stopword list ของมันตัด "ผ่าน" "เข้า" "ไม่" "ได้" ทิ้ง
 *      ผลคือค้น "รหัสผ่าน" จะไม่เจอ และ "เข้าระบบไม่ได้" กับ "เข้าระบบได้"
 *      จะกลายเป็นสิ่งเดียวกัน ซึ่งกลับความหมาย
 *      → **ห้ามใช้ analyzer `thai` สำเร็จรูป** ประกอบเองโดยไม่ใส่ stopword
 *
 *   4. คำทับศัพท์ที่ไม่อยู่ใน dictionary ถูกตัดผิด
 *      "โฟลเดอร์ฝ่าย" → "โฟลเด | อร์ฝ่าย"
 *      → แก้ด้วย multi-field: ฟิลด์ ngram สำหรับ recall คู่กับฟิลด์หลักสำหรับ precision
 *
 *   5. plugin `analysis-icu` ไม่ได้ติดตั้งมาใน image มาตรฐาน
 *      → ไม่พึ่ง icu_tokenizer เพื่อให้ on-prem bundle ติดตั้งง่าย
 */

export const INDEX_PREFIX = process.env['OPENSEARCH_INDEX_PREFIX'] ?? 'itsm';

/** ชื่อ index ต่อ tenant — SaaS ใช้ alias ต่อ tenant, on-prem มี tenant เดียว */
export function workItemIndexName(tenantId: bigint): string {
  return `${INDEX_PREFIX}-work-item-${tenantId.toString()}`;
}

export const WORK_ITEM_INDEX_SETTINGS = {
  settings: {
    index: {
      number_of_shards: 1,
      number_of_replicas: 0, // dev/on-prem single node — SaaS ตั้งเป็น 1
      max_ngram_diff: 2,
    },
    analysis: {
      analyzer: {
        /**
         * analyzer หลัก — ตัดคำถูกต้องและ **ไม่ตัด stopword ทิ้ง**
         * ความหมายของ "ไม่" กับ "ได้" สำคัญเกินกว่าจะทิ้งในระบบแจ้งปัญหา
         */
        thai_text: {
          type: 'custom',
          tokenizer: 'thai',
          filter: ['lowercase', 'decimal_digit'],
        },
        /**
         * analyzer สำรองสำหรับ recall — ใช้กับคำทับศัพท์ที่ dictionary ไม่รู้จัก
         * ให้คะแนนต่ำกว่าฟิลด์หลักมาก เพื่อไม่ให้ผลลัพธ์ที่บังเอิญตรงบางส่วนขึ้นก่อน
         */
        thai_ngram: {
          type: 'custom',
          tokenizer: 'thai_ngram_tokenizer',
          filter: ['lowercase'],
        },
      },
      tokenizer: {
        thai_ngram_tokenizer: {
          type: 'ngram',
          // 3-4 ไม่ใช่ 2-3 — 2-gram ของภาษาไทยสร้าง noise มากเกินไป
          // และคำทับศัพท์ที่เป็นปัญหาจริงล้วนยาวกว่า 4 อักขระทั้งหมด
          min_gram: 3,
          max_gram: 4,
          // **ห้ามตั้ง token_chars: ['letter','digit'] กับภาษาไทย**
          //
          // สระและวรรณยุกต์ไทย (ิ ี ่ ้ ็ ...) ถูกจัดเป็น Unicode Mark ไม่ใช่ Letter
          // ngram tokenizer จึงตัดคำขาดตรงทุกสระ ผลจริงที่วัดได้:
          //   "ขอรีเซ็ตรหัสผ่าน" -> ขอร | ตรห | านบ     (ขยะ)
          //   คำค้น "รีเซ็ต"      -> (ว่างเปล่า)          (หาอะไรไม่เจอเลย)
          // ไม่ตั้ง token_chars จะได้ 7 token ที่ทับซ้อนกันพอดี
          //
          // นี่คือความล้มเหลวแบบเงียบ: ไม่มี error ให้เห็น ฟิลด์ ngram แค่ไม่เคยตรงเลย
        },
      },
    },
  },
  mappings: {
    // ไม่ให้ index ฟิลด์ที่ไม่ได้ประกาศ — กัน mapping explosion จาก custom field
    dynamic: 'strict',
    properties: {
      tenantId: { type: 'long' },
      projectId: { type: 'long' },
      projectKey: { type: 'keyword' },
      itemKey: { type: 'keyword' },
      issueTypeId: { type: 'long' },
      issueTypeName: { type: 'keyword' },
      statusId: { type: 'long' },
      statusName: { type: 'keyword' },
      statusCategory: { type: 'keyword' },
      priorityId: { type: 'integer' },
      priorityRank: { type: 'integer' },
      reporterId: { type: 'long' },
      assigneeId: { type: 'long' },
      parentId: { type: 'long' },

      summary: {
        type: 'text',
        analyzer: 'thai_text',
        fields: {
          // search_analyzer ต้องเป็น thai_ngram เหมือนตอน index ไม่ใช่ thai_text
          //
          // ความผิดพลาดที่เจอตอนรันเทสต์: ถ้าใช้ thai_text ตอนค้น คำว่า "โฟลเดอร์"
          // จะถูกตัดเป็น "โฟลเด|อร์" ซึ่งเป็น token ยาว 5 อักขระ ไปเทียบกับ index
          // ที่เก็บเป็น n-gram ยาว 3-4 จึงไม่มีวันตรงกันเลย — ฟิลด์นี้ไม่ทำงานเลยแม้แต่ครั้งเดียว
          //
          // ผลข้างเคียงคือ noise สูงขึ้น จึงต้องคุมด้วย boost ต่ำ (0.2)
          // และชุดทดสอบ "คำค้นที่ต้องไม่เจอ" ที่กัน false positive ไว้
          ngram: { type: 'text', analyzer: 'thai_ngram', search_analyzer: 'thai_ngram' },
          keyword: { type: 'keyword', ignore_above: 512 },
        },
      },
      description: {
        type: 'text',
        analyzer: 'thai_text',
      },
      comments: {
        type: 'text',
        analyzer: 'thai_text',
      },
      labels: { type: 'keyword' },

      storyPoints: { type: 'float' },
      dueDate: { type: 'date' },
      createdAt: { type: 'date' },
      updatedAt: { type: 'date' },
      resolvedAt: { type: 'date' },
    },
  },
} as const;

/**
 * คิวรีค้นหาข้อความ
 *
 * โครงสร้าง: ฟิลด์หลักได้ boost สูง · ngram ได้ boost ต่ำมากเพื่อกู้คำทับศัพท์
 * `tenantId` และ `projectId` อยู่ใน **filter context** ไม่ใช่ query context
 * เพื่อให้ filter cache ทำงานและไม่ไปมีผลต่อคะแนน relevance (CLAUDE.md §3)
 */
export function buildTextQuery(params: {
  tenantId: bigint;
  text: string;
  projectIds?: bigint[];
}): Record<string, unknown> {
  const filter: Array<Record<string, unknown>> = [
    { term: { tenantId: Number(params.tenantId) } },
  ];
  if (params.projectIds !== undefined && params.projectIds.length > 0) {
    filter.push({ terms: { projectId: params.projectIds.map(Number) } });
  }

  return {
    query: {
      bool: {
        filter,
        // ต้องตรงอย่างน้อยหนึ่งสาขา แต่แต่ละสาขามีเกณฑ์ความเข้มของตัวเอง
        minimum_should_match: 1,
        should: [
          {
            // สาขาหลัก — ต้องตรงอย่างน้อย 75% ของคำที่ตัดได้
            multi_match: {
              query: params.text,
              fields: ['itemKey^10', 'summary^5', 'description^2', 'comments'],
              type: 'best_fields',
              minimum_should_match: '75%',
            },
          },
          {
            // สาขากู้คำทับศัพท์ — ต้องตรง 80% ของ n-gram ทั้งหมด
            //
            // ตัวเลข 80% นี้มาจากการวัดบนข้อมูลจริง 10,000 ใบ ไม่ใช่การเดา:
            // ถ้าไม่ใส่ minimum_should_match เลย คำค้นที่ไม่เกี่ยวข้องเลยอย่าง
            // "จักรยานยนต์ไฟฟ้าดัดแปลง" จะคืนผลลัพธ์ 10 รายการ เพราะ n-gram
            // เพียงชิ้นเดียวที่บังเอิญตรงก็นับเป็น hit แล้ว
            //
            // บนคลังทดสอบ 15 เอกสารปัญหานี้มองไม่เห็น — ต้องมีข้อมูลจริงจึงจะเจอ
            match: {
              'summary.ngram': {
                query: params.text,
                minimum_should_match: '80%',
                boost: 0.2,
              },
            },
          },
        ],
      },
    },
  };
}
