import { Controller, Get } from '@nestjs/common';

import { withSystemScope } from '../../infrastructure/prisma/tenant-scope';
import { Public } from '../../infrastructure/http/session.guard';
import { indexHealthOfAll, needsAttention } from '../search-index';

interface ComponentHealth {
  status: 'up' | 'down';
  detail?: string;
}

@Public('ตัวตรวจสุขภาพต้องเรียกได้โดยไม่ต้องล็อกอิน — load balancer และ Docker healthcheck ไม่มีบัญชี')
@Controller('health')
export class HealthController {
  @Get()
  async check(): Promise<{ status: string; components: Record<string, ComponentHealth> }> {
    const components: Record<string, ComponentHealth> = {};

    try {
      // health check ไม่แตะข้อมูลของ tenant ใด แต่ยังต้องประกาศเจตนา
      // เพื่อให้เห็นชัดใน code review ว่าเป็นการข้าม tenant scope โดยตั้งใจ
      await withSystemScope('health check ระดับระบบ ไม่แตะข้อมูลของ tenant ใด', async (db) => {
        await db.$queryRaw`SELECT 1`;
      });
      components['mysql'] = { status: 'up' };
    } catch (e) {
      components['mysql'] = { status: 'down', detail: (e as Error).message };
    }

    /*
      **เช็คดัชนี ไม่ใช่แค่คลัสเตอร์**

      เดิมที่นี่ถาม `_cluster/health` อย่างเดียว · ระหว่าง QA ดัชนีหายไปหลัง
      Docker รีสตาร์ต ทุกการค้นหาตอบ 503 แต่หน้านี้ตอบ `ok` ตลอด เพราะ
      คลัสเตอร์ตอนนั้นปกติดีทุกอย่าง — ตัวตรวจที่เช็คสิ่งที่ไม่พังแล้วบอกว่าปกติ
      อันตรายกว่าไม่มีตัวตรวจ เพราะมันสร้างความมั่นใจที่ไม่มีมูล

      ตอบเป็นรายองค์กร เพราะดัชนีของ tenant หนึ่งหายไม่ได้แปลว่าที่เหลือหายด้วย
      และคนที่มาแก้ต้องรู้ว่าจะ reindex ของใคร
    */
    try {
      const rows = await indexHealthOfAll();
      const bad = rows.filter((r) => needsAttention(r.state));
      components['search-index'] =
        bad.length === 0
          ? { status: 'up', detail: `ดัชนีปกติ ${String(rows.length)} องค์กร` }
          : {
              status: 'down',
              detail: bad.map((r) => `องค์กร ${r.tenantId}: ${r.detail}`).join(' · '),
            };
    } catch (e) {
      components['search-index'] = { status: 'down', detail: (e as Error).message };
    }

    const allUp = Object.values(components).every((c) => c.status === 'up');
    return { status: allUp ? 'ok' : 'degraded', components };
  }
}
