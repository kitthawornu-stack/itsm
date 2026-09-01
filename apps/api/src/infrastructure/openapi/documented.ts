/**
 * คำอธิบายรูปร่างข้อมูลของเส้นทางที่เขียนไว้จริง
 *
 * **ตั้งใจไม่ครบทุกเส้น** · เส้นทางที่ระบบภายนอกจะเรียกจริงมีไม่กี่เส้น
 * ส่วนที่เหลือเป็นหน้าจอของเราเองคุยกับหลังบ้านตัวเอง ซึ่งเปลี่ยนรูปร่าง
 * ไปพร้อมกันทั้งสองฝั่งอยู่แล้ว
 *
 * การไล่เขียน decorator ให้ครบ 159 เส้นจะได้เอกสารที่ใหญ่ ดูสมบูรณ์
 * และไม่มีใครดูแลให้ตรงได้จริง — ซึ่งแย่กว่าเอกสารที่บอกตรง ๆ ว่าครอบแค่ไหน
 *
 * เพิ่มรายการที่นี่เมื่อมีคนต้องใช้จริง ไม่ใช่เพิ่มเพื่อให้ตัวเลขสวย
 */
import type { Documented } from './spec';

const json = (schema: Record<string, unknown>): Record<string, unknown> => ({
  required: true,
  content: { 'application/json': { schema } },
});

const ok = (description: string, schema?: Record<string, unknown>): Record<string, unknown> => ({
  description,
  ...(schema === undefined ? {} : { content: { 'application/json': { schema } } }),
});

const WORK_ITEM = {
  type: 'object',
  properties: {
    itemKey: { type: 'string', examples: ['SD-1024'] },
    summary: { type: 'string' },
    statusName: { type: 'string' },
    statusCategory: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'DONE'] },
    priorityName: { type: 'string', nullable: true },
    assignee: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

export const DOCUMENTED: Documented = {
  'get /health': {
    summary: 'ระบบพร้อมใช้งานไหม — ตรวจฐานข้อมูล ดัชนีค้นหา และคิว',
    responses: {
      200: ok('ทุกอย่างปกติ', {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'] },
          checks: { type: 'object', additionalProperties: true },
        },
      }),
      503: ok('มีบางส่วนใช้งานไม่ได้ — รายละเอียดอยู่ใน `checks`'),
    },
  },

  'post /auth/login': {
    summary: 'เข้าสู่ระบบ — ตอบด้วยคุกกี้เซสชัน `httpOnly` ไม่ใช่โทเคนในเนื้อหา',
    requestBody: json({
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string' },
      },
    }),
    responses: {
      200: ok('เข้าสู่ระบบสำเร็จ — คุกกี้อยู่ในหัว `Set-Cookie`'),
      401: ok('อีเมลหรือรหัสผ่านไม่ถูกต้อง — ข้อความไม่บอกว่าผิดข้อไหน'),
      429: ok('พยายามถี่เกินไป'),
    },
  },

  'get /auth/me': {
    summary: 'ผู้ใช้ที่เซสชันนี้เป็นเจ้าของ',
    responses: { 200: ok('ข้อมูลผู้ใช้'), 401: ok('ยังไม่ได้เข้าสู่ระบบ') },
  },

  'get /work-items': {
    summary: 'ค้นหางาน — รับ HQL ผ่าน `q` และแบ่งหน้าด้วย `page`',
    responses: {
      200: ok('รายการงานตามขอบเขตที่ผู้เรียกมีสิทธิ์เห็น', {
        type: 'object',
        properties: {
          rows: { type: 'array', items: WORK_ITEM },
          total: { type: 'integer' },
        },
      }),
      403: ok('ไม่มีโปรเจกต์ไหนที่เปิดดูได้'),
    },
  },

  'post /work-items': {
    summary: 'แจ้งเรื่องใหม่',
    requestBody: json({
      type: 'object',
      required: ['projectKey', 'summary'],
      properties: {
        projectKey: { type: 'string', examples: ['SD'] },
        summary: { type: 'string', maxLength: 500 },
        description: { type: 'string' },
        issueTypeId: { type: 'string' },
        priorityId: { type: 'string' },
      },
    }),
    responses: {
      201: ok('สร้างแล้ว', WORK_ITEM),
      403: ok('ไม่มีสิทธิ์สร้างงานในโปรเจกต์นี้'),
      422: ok('ข้อมูลไม่ครบหรือใช้ไม่ได้'),
    },
  },

  'get /work-items/{key}': {
    summary: 'รายละเอียดงานหนึ่งใบ',
    responses: {
      200: ok('รายละเอียด', WORK_ITEM),
      403: ok('ไม่มีสิทธิ์เปิดดูโปรเจกต์นี้'),
      404: ok('ไม่พบงาน'),
    },
  },

  'get /work-items/{key}/comments': {
    summary: 'ความเห็นของงาน — บันทึกภายในจะไม่ถูกส่งให้คนที่ไม่มีสิทธิ์เห็น',
    responses: { 200: ok('รายการความเห็น'), 404: ok('ไม่พบงาน') },
  },

  'post /work-items/{key}/comments': {
    summary: 'เพิ่มความเห็น',
    requestBody: json({
      type: 'object',
      required: ['body'],
      properties: {
        body: { type: 'string' },
        isInternal: { type: 'boolean', description: 'บันทึกภายใน — ผู้แจ้งไม่เห็น' },
      },
    }),
    responses: { 201: ok('เพิ่มแล้ว'), 403: ok('ไม่มีสิทธิ์'), 404: ok('ไม่พบงาน') },
  },

  'get /webhooks': {
    summary: 'ปลายทางที่รับเหตุการณ์ออกไป — **ไม่มีความลับในคำตอบ**',
    responses: {
      200: ok('รายการปลายทางและตัวเลือกเหตุการณ์'),
      403: ok('เฉพาะผู้ดูแลองค์กร'),
    },
  },

  'post /webhooks': {
    summary: 'เพิ่มปลายทาง — ความลับอยู่ในคำตอบครั้งนี้ครั้งเดียว อ่านซ้ำไม่ได้',
    requestBody: json({
      type: 'object',
      required: ['name', 'url', 'events'],
      properties: {
        name: { type: 'string' },
        url: { type: 'string', description: 'http หรือ https · ที่อยู่ในวงแลนใช้ได้' },
        events: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['item.created', 'item.transitioned', 'comment.added', 'sla.breached', 'item.idle'],
          },
          description: 'รายการว่าง = ไม่รับอะไรเลย ไม่ใช่ "เอาหมด"',
        },
      },
    }),
    responses: {
      201: ok('สร้างแล้ว', {
        type: 'object',
        properties: { id: { type: 'string' }, secret: { type: 'string' } },
      }),
      403: ok('เฉพาะผู้ดูแลองค์กร'),
      422: ok('ชื่อซ้ำ ที่อยู่ใช้ไม่ได้ หรือเหตุการณ์ที่ไม่รู้จัก'),
    },
  },
};
