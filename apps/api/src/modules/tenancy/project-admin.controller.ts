/**
 * หน้าตั้งค่าโปรเจกต์ — ประกอบคำตอบจากหลายโมดูล
 *
 * ตัว controller ไม่แตะตารางของโมดูลอื่นเอง แต่ถามผ่าน service ที่แต่ละโมดูล
 * export ไว้ (ADR-004) · นี่คือจุดที่กติกา "ห้าม JOIN ข้ามขอบเขตโมดูล"
 * มีราคาจริง — สามคิวรีแทนหนึ่ง — และก็คุ้ม เพราะการย้าย workflow ออกไปเป็น
 * เซอร์วิสแยกวันหนึ่ง ต้องแก้แค่บรรทัดที่เรียก ไม่ใช่ทุก SQL ที่เคย JOIN มัน
 */
import { Controller, Get, HttpException, HttpStatus, Param } from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { assertTenantAdmin, describeGrants } from '../permission';
import { describeSlaPolicy } from '../sla';
import { describeProjectWorkflows } from '../workflow';
import { ProjectNotFoundError, listProjects, projectByKey } from './project.service';

@Controller('admin/projects')
export class ProjectAdminController {
  @Get()
  async list(@Ctx() ctx: TenantContext): Promise<{ rows: unknown[] }> {
    await assertTenantAdmin(ctx);
    const rows = await listProjects(ctx);
    return { rows: rows.map(({ id, ...rest }) => ({ id: id.toString(), ...rest })) };
  }

  @Get(':key')
  async detail(@Ctx() ctx: TenantContext, @Param('key') key: string): Promise<unknown> {
    await assertTenantAdmin(ctx);
    try {
      const project = await projectByKey(ctx, key);
      const [workflows, permissions, sla] = await Promise.all([
        describeProjectWorkflows(ctx, project.id),
        describeGrants(ctx, project.id),
        describeSlaPolicy(ctx, project.id),
      ]);
      return {
        project: { ...project, id: project.id.toString() },
        workflows,
        permissions,
        sla,
      };
    } catch (e) {
      if (e instanceof ProjectNotFoundError) {
        throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }
}
