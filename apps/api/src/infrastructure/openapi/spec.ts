/**
 * สเปก OpenAPI ที่ **บอกความครอบคลุมของตัวเองตรง ๆ**
 *
 * ## ทำไมไม่ต่อ `@nestjs/swagger` ตรง ๆ
 *
 * โค้ดนี้รับ body เป็น `interface` กับ object แบบเขียนตรงที่ signature
 * ไม่ใช่ class ที่มี decorator · เครื่องมือสร้างสเปกอัตโนมัติจึงได้ **เส้นทาง
 * ครบทุกเส้น แต่ไม่มีรูปร่างข้อมูลเลยสักเส้น** — และสเปกแบบนั้นอ่านเหมือน
 * สมบูรณ์ ทั้งที่ตอบคำถามที่คนเปิดมันมาถามไม่ได้สักข้อ
 *
 * นั่นคือรูปแบบเดียวกับที่โครงการนี้เจอซ้ำที่สุด: กลไกที่ดูเหมือนป้องกันแล้ว
 * แต่ไม่ได้ป้องกันอะไร · ทางที่เลือกคือ **บอกจำนวนที่อธิบายไว้จริง**
 * ในตัวสเปกเอง แล้วให้เทสต์คุมตัวเลขนั้น — คนที่เปิดอ่านจะได้รู้ทันทีว่า
 * ตรงไหนเชื่อได้ ตรงไหนยังต้องไปอ่านโค้ด
 *
 * ## เส้นทางอ่านจาก metadata ของ Nest เอง
 *
 * ไม่ได้สแกนซอร์สด้วย regex และไม่ได้ไล่พิมพ์รายการเอง · อ่าน `PATH_METADATA`
 * กับ `METHOD_METADATA` ซึ่งเป็นข้อมูลชุดเดียวกับที่เราเตอร์ใช้จริง —
 * **เส้นทางในสเปกจึงไม่มีทางเพี้ยนจากเส้นทางที่ระบบให้บริการ**
 * และรายชื่อ controller อ่านจาก metadata ของโมดูล ไม่ใช่รายการที่คนดูแลด้วยมือ
 */
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

/** ค่าของ `RequestMethod` ใน Nest — ตัวเลขดิบที่ metadata เก็บไว้ */
const METHODS: Record<number, string> = {
  0: 'get',
  1: 'post',
  2: 'put',
  3: 'delete',
  4: 'patch',
  5: 'all',
  6: 'options',
  7: 'head',
  8: 'search',
};

export interface OperationDoc {
  summary: string;
  /** คำอธิบายเนื้อหาที่ส่งไป — ไม่ใส่แปลว่าไม่รับ body */
  requestBody?: Record<string, unknown>;
  responses?: Record<string, unknown>;
}

/** คีย์คือ `"get /work-items/{key}"` — เมธอดตัวพิมพ์เล็ก เว้นวรรค แล้วเส้นทาง */
export type Documented = Readonly<Record<string, OperationDoc>>;

export interface Endpoint {
  method: string;
  path: string;
  controller: string;
  handler: string;
}

/** `:key` ของ Nest → `{key}` ของ OpenAPI */
function toOpenApiPath(raw: string): string {
  return raw.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function join(base: string, sub: string): string {
  const b = base.replace(/^\/|\/$/g, '');
  const s = sub.replace(/^\/|\/$/g, '');
  if (s === '') return `/${b}`;
  return b === '' ? `/${s}` : `/${b}/${s}`;
}

/**
 * ไล่เส้นทางทั้งหมดจาก metadata ของ controller
 *
 * รับคลาสมาเป็นรายการ เพราะผู้เรียกอ่านจาก metadata ของโมดูลอีกที —
 * ฟังก์ชันนี้จึงทดสอบได้โดยไม่ต้องมีโมดูลจริง
 */
export function collectEndpoints(controllers: readonly unknown[]): Endpoint[] {
  const out: Endpoint[] = [];
  for (const c of controllers) {
    if (typeof c !== 'function') continue;
    const base = (Reflect.getMetadata(PATH_METADATA, c) as string | undefined) ?? '';
    const proto = (c as { prototype?: object }).prototype;
    if (proto === undefined) continue;

    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const fn = (proto as Record<string, unknown>)[name];
      if (typeof fn !== 'function') continue;
      const sub = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
      const verb = Reflect.getMetadata(METHOD_METADATA, fn) as number | undefined;
      if (sub === undefined || verb === undefined) continue;
      const method = METHODS[verb];
      if (method === undefined) continue;

      out.push({
        method,
        path: toOpenApiPath(join(base, sub)),
        controller: (c as { name: string }).name,
        handler: name,
      });
    }
  }
  out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return out;
}

export interface SpecOptions {
  version: string;
  /** เส้นทางฐานที่เซิร์ฟเวอร์ให้บริการจริง */
  basePath: string;
}

export interface BuildResult {
  spec: Record<string, unknown>;
  total: number;
  documented: number;
}

/**
 * ประกอบเอกสาร OpenAPI
 *
 * `info.description` เขียนความครอบคลุมไว้เป็นภาษาคน — **ตัวเลขนั้นคำนวณจาก
 * ของจริง ไม่ได้พิมพ์มือ** จึงไม่มีทางที่เอกสารจะอ้างว่าอธิบายครบ
 * ในวันที่มีคนเพิ่มเส้นทางใหม่โดยไม่เขียนคำอธิบาย
 */
export function buildSpec(
  endpoints: readonly Endpoint[],
  documented: Documented,
  options: SpecOptions,
): BuildResult {
  const paths: Record<string, Record<string, unknown>> = {};
  let described = 0;

  for (const e of endpoints) {
    const key = `${e.method} ${e.path}`;
    const doc = documented[key];
    if (doc !== undefined) described += 1;

    const params = [...e.path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    const op: Record<string, unknown> = {
      operationId: `${e.controller}_${e.handler}`,
      tags: [e.path.split('/')[1] ?? 'root'],
      summary: doc?.summary ?? 'ยังไม่ได้เขียนคำอธิบาย — ดูโค้ดของ handler นี้',
      ...(params.length === 0 ? {} : { parameters: params }),
      ...(doc?.requestBody === undefined ? {} : { requestBody: doc.requestBody }),
      responses: doc?.responses ?? {
        // ไม่ใช่การเดา — บอกตรง ๆ ว่ายังไม่มีใครอธิบายรูปร่างของคำตอบ
        default: { description: 'ยังไม่ได้อธิบายรูปร่างของคำตอบ' },
      },
      ...(doc === undefined ? { 'x-documented': false } : { 'x-documented': true }),
    };

    (paths[e.path] ??= {})[e.method] = op;
  }

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Helix — ศูนย์บริการไอที · REST API v1',
      version: options.version,
      description: [
        `เส้นทางทั้งหมด ${String(endpoints.length)} เส้น อ่านจาก metadata ของ Nest โดยตรง`,
        'จึงตรงกับเส้นทางที่ระบบให้บริการจริงเสมอ',
        '',
        `**อธิบายรูปร่างข้อมูลไว้ ${String(described)} จาก ${String(endpoints.length)} เส้นทาง**`,
        'ที่เหลือมีแค่เส้นทางกับเมธอด — ดูได้จากธง `x-documented: false` ในแต่ละรายการ',
        'สเปกที่บอกความครอบคลุมของตัวเองไม่ได้ ทำให้คนอ่านเชื่อในสิ่งที่มันไม่ได้บอก',
        '',
        'ยืนยันตัวตนด้วยคุกกี้เซสชัน `httpOnly` (ADR-003) — ไม่มี API key',
      ].join('\n'),
    },
    servers: [{ url: options.basePath }],
    paths,
  };

  return { spec, total: endpoints.length, documented: described };
}
