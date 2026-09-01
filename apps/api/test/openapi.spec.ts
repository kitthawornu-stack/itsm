/**
 * สเปก OpenAPI ต้องตรงกับเส้นทางที่ระบบให้บริการจริง
 *
 * ## ทำไมต้องมีไฟล์นี้
 *
 * เอกสาร API ที่ค้างเก่ากว่าโค้ด **แย่กว่าไม่มีเอกสาร** — คนที่อ่านจะเขียน
 * ตัวเชื่อมตามที่มันบอก แล้วมาเจอว่าเส้นทางไม่มีอยู่จริงตอนรันบน production ·
 * `docs/openapi.json` ถูกคอมมิตไว้เพราะเป็นสิ่งที่คนและเครื่องมือภายนอกอ่าน
 * ไฟล์นี้จึงประกอบใหม่จาก metadata ของ Nest แล้วเทียบ
 *
 * ## และต้องบอกความครอบคลุมของตัวเองให้ตรง
 *
 * สเปกที่มีเส้นทางครบแต่ไม่มีรูปร่างข้อมูล **อ่านเหมือนสมบูรณ์** · ตัวเลข
 * "อธิบายไว้ N จาก M" ในคำอธิบายของสเปกจึงถูกคำนวณจากของจริง ไม่ใช่พิมพ์มือ
 * และเทสต์นี้ยืนยันว่ามันตรงกับจำนวนรายการที่ติดธง `x-documented: true`
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { DOCUMENTED } from '../src/infrastructure/openapi/documented';
import { buildSpec, collectEndpoints } from '../src/infrastructure/openapi/spec';

const REPO = join(__dirname, '..', '..', '..');
const committed = JSON.parse(
  readFileSync(join(REPO, 'docs', 'openapi.json'), 'utf8'),
) as {
  info: { description: string };
  paths: Record<string, Record<string, { 'x-documented': boolean; operationId: string }>>;
};

const controllers = (Reflect.getMetadata('controllers', AppModule) as unknown[] | undefined) ?? [];
const live = collectEndpoints(controllers);

function operations(
  spec: typeof committed,
): Array<[string, { 'x-documented': boolean; operationId: string }]> {
  return Object.entries(spec.paths).flatMap(([path, byMethod]) =>
    Object.entries(byMethod).map(
      ([method, op]) => [`${method} ${path}`, op] as [string, (typeof op)],
    ),
  );
}

describe('OpenAPI · A · ตัวอ่านเส้นทางทำงานจริง', () => {
  /**
   * ด่าน probe — เซ็ตว่างเท่ากับเซ็ตว่าง
   *
   * ถ้าการอ่าน metadata พังแล้วได้รายการว่าง ทุกการเทียบข้างล่างจะผ่านหมด
   * โดยไม่ได้ตรวจอะไรเลย · ต้องหาของที่รู้แน่ว่ามีอยู่ให้เจอก่อน
   * และหาให้เจอจาก **หลายโมดูล** ไม่ใช่โมดูลเดียว
   */
  it('อ่านเส้นทางที่รู้ว่ามีอยู่เจอ จากหลายโมดูล', () => {
    expect(live.length).toBeGreaterThan(100);
    const keys = new Set(live.map((e) => `${e.method} ${e.path}`));
    expect(keys).toContain('get /health');
    expect(keys).toContain('post /auth/login');
    expect(keys).toContain('post /work-items');
    expect(keys).toContain('get /webhooks');
    expect(keys).toContain('get /dashboards/{id}');
  });

  it('พารามิเตอร์ในเส้นทางถูกแปลงเป็นรูปแบบของ OpenAPI', () => {
    const withParam = live.filter((e) => e.path.includes('{'));
    expect(withParam.length).toBeGreaterThan(10);
    // ไม่ควรเหลือรูปแบบของ Nest (`:key`) หลุดไปในสเปก
    expect(live.some((e) => e.path.includes(':'))).toBe(false);
  });
});

describe('OpenAPI · B · ไฟล์ที่คอมมิตไว้ตรงกับของจริง', () => {
  it('**เส้นทางในไฟล์ตรงกับเส้นทางที่เราเตอร์ให้บริการ ทุกเส้น**', () => {
    const fromFile = new Set(operations(committed).map(([k]) => k));
    const fromCode = new Set(live.map((e) => `${e.method} ${e.path}`));

    const missing = [...fromCode].filter((k) => !fromFile.has(k));
    const stale = [...fromFile].filter((k) => !fromCode.has(k));
    expect(missing, 'มีเส้นทางในโค้ดที่ยังไม่อยู่ในไฟล์ — รัน pnpm --filter @itsm/api openapi').toEqual(
      [],
    );
    expect(stale, 'มีเส้นทางในไฟล์ที่ไม่มีในโค้ดแล้ว — รัน pnpm --filter @itsm/api openapi').toEqual(
      [],
    );
  });

  it('ประกอบใหม่แล้วได้ไฟล์เดิมเป๊ะ — ไฟล์ไม่ค้างเก่ากว่าโค้ด', () => {
    const { spec } = buildSpec(live, DOCUMENTED, { version: '1.0.0', basePath: '/api/v1' });
    expect(JSON.parse(JSON.stringify(spec))).toEqual(committed);
  });
});

describe('OpenAPI · C · บอกความครอบคลุมของตัวเองตรง', () => {
  it('ตัวเลขในคำอธิบายตรงกับจำนวนที่ติดธงว่าอธิบายแล้ว', () => {
    const ops = operations(committed);
    const described = ops.filter(([, op]) => op['x-documented']).length;

    const m = /อธิบายรูปร่างข้อมูลไว้ (\d+) จาก (\d+) เส้นทาง/.exec(committed.info.description);
    expect(m, 'คำอธิบายของสเปกต้องบอกความครอบคลุม').not.toBeNull();
    const [, saidDone, saidTotal] = m as RegExpExecArray;
    expect(Number(saidDone)).toBe(described);
    expect(Number(saidTotal)).toBe(ops.length);
  });

  /**
   * ด่านที่จับ "ธงที่จริงเสมอ"
   *
   * ถ้าทุกรายการติดธงว่าอธิบายแล้ว การตรวจข้างบนจะผ่านโดยไม่พิสูจน์อะไร
   * · สเปกนี้ตั้งใจไม่ครบ จึงต้องมีทั้งที่อธิบายแล้วและที่ยังไม่อธิบาย
   */
  it('มีทั้งเส้นทางที่อธิบายแล้วและที่ยังไม่อธิบาย', () => {
    const flags = operations(committed).map(([, op]) => op['x-documented']);
    expect(flags).toContain(true);
    expect(flags).toContain(false);
  });

  it('ทุกคีย์ในรายการคำอธิบาย ต้องเป็นเส้นทางที่มีอยู่จริง', () => {
    const fromCode = new Set(live.map((e) => `${e.method} ${e.path}`));
    const ghosts = Object.keys(DOCUMENTED).filter((k) => !fromCode.has(k));
    expect(ghosts, 'เขียนคำอธิบายให้เส้นทางที่ไม่มีอยู่').toEqual([]);
  });

  it('รายการที่ติดธงว่าอธิบายแล้ว ต้องมีคำอธิบายจริง ไม่ใช่ข้อความค่าปริยาย', () => {
    for (const [key, op] of operations(committed)) {
      if (!op['x-documented']) continue;
      const summary = (committed.paths[key.split(' ')[1] ?? '']?.[key.split(' ')[0] ?? ''] as
        | { summary?: string }
        | undefined)?.summary;
      expect(summary, key).toBeTruthy();
      expect(summary, key).not.toContain('ยังไม่ได้เขียนคำอธิบาย');
    }
  });
});
