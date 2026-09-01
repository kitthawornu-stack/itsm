/**
 * เขียนสเปก OpenAPI ลง `docs/openapi.json`
 *
 * ไฟล์ผลลัพธ์ถูกคอมมิตไว้ เพราะเป็นสิ่งที่คนอ่านและเครื่องมือภายนอกใช้ ·
 * และมีเทสต์ที่ประกอบใหม่จาก metadata จริงแล้วเทียบกับไฟล์นี้ — ไฟล์ที่ค้าง
 * เก่ากว่าโค้ดจะทำให้เทสต์แดง ไม่ใช่ทำให้คนอ่านเชื่อของเก่า
 */
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AppModule } from '../app.module';
import { DOCUMENTED } from '../infrastructure/openapi/documented';
import { buildSpec, collectEndpoints } from '../infrastructure/openapi/spec';

const controllers = (Reflect.getMetadata('controllers', AppModule) as unknown[] | undefined) ?? [];
const endpoints = collectEndpoints(controllers);
const { spec, total, documented } = buildSpec(endpoints, DOCUMENTED, {
  version: '1.0.0',
  basePath: '/api/v1',
});

const out = join(__dirname, '..', '..', '..', '..', 'docs', 'openapi.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
console.log(`เขียน ${out}`);
console.log(`เส้นทาง ${String(total)} เส้น · อธิบายรูปร่างข้อมูลแล้ว ${String(documented)} เส้น`);
