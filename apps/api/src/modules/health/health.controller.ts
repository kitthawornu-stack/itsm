import { Controller, Get } from '@nestjs/common';

import { withSystemScope } from '../../infrastructure/prisma/tenant-scope';
import { Public } from '../../infrastructure/http/session.guard';

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

    try {
      const url = process.env['OPENSEARCH_URL'] ?? 'http://localhost:4200';
      const res = await fetch(`${url}/_cluster/health`, { signal: AbortSignal.timeout(3000) });
      components['opensearch'] = res.ok ? { status: 'up' } : { status: 'down', detail: `HTTP ${res.status}` };
    } catch (e) {
      components['opensearch'] = { status: 'down', detail: (e as Error).message };
    }

    const allUp = Object.values(components).every((c) => c.status === 'up');
    return { status: allUp ? 'ok' : 'degraded', components };
  }
}
