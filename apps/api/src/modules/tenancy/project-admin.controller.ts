/**
 * หน้าตั้งค่าโปรเจกต์ — ประกอบคำตอบจากหลายโมดูล
 *
 * ตัว controller ไม่แตะตารางของโมดูลอื่นเอง แต่ถามผ่าน service ที่แต่ละโมดูล
 * export ไว้ (ADR-004) · นี่คือจุดที่กติกา "ห้าม JOIN ข้ามขอบเขตโมดูล"
 * มีราคาจริง — สามคิวรีแทนหนึ่ง — และก็คุ้ม เพราะการย้าย workflow ออกไปเป็น
 * เซอร์วิสแยกวันหนึ่ง ต้องแก้แค่บรรทัดที่เรียก ไม่ใช่ทุก SQL ที่เคย JOIN มัน
 */
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import type { TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import {
  ALL_PERMISSION_KEYS,
  LastAdminGrantError,
  UnknownGroupError,
  assertTenantAdmin,
  describeGrants,
  schemeUsage,
  setGrant,
} from '../permission';
import { listGroups } from '../identity';
import { describeSlaPolicy } from '../sla';
import { satisfactionSummary } from '../workitem';
import { describeProjectWorkflows } from '../workflow';
import { ProjectNotFoundError, listProjects, projectByKey, projectSchemeId } from './project.service';
import {
  DuplicateProjectKeyError,
  InvalidProjectKeyError,
  ProjectNeedsSchemeError,
  ProjectNeedsWorkflowError,
  UnknownReferenceError,
  createProject,
  projectCreationOptions,
  type ProjectTypeName,
} from './project-create.service';

@Controller('admin/projects')
export class ProjectAdminController {
  @Get()
  async list(@Ctx() ctx: TenantContext): Promise<{ rows: unknown[] }> {
    await assertTenantAdmin(ctx);
    const rows = await listProjects(ctx);
    return { rows: rows.map(({ id, ...rest }) => ({ id: id.toString(), ...rest })) };
  }

  /** ตัวเลือกสำหรับฟอร์มสร้างโปรเจกต์ — ต้องมาก่อน `:key` ไม่งั้นถูกจับเป็นคีย์ */
  @Get('new/options')
  async options(@Ctx() ctx: TenantContext): Promise<unknown> {
    await assertTenantAdmin(ctx);
    return projectCreationOptions(ctx);
  }

  @Post()
  async create(
    @Ctx() ctx: TenantContext,
    @Body()
    body: {
      key?: unknown;
      name?: unknown;
      type?: unknown;
      permissionSchemeId?: unknown;
      workflowId?: unknown;
      issueTypeIds?: unknown;
      notifyGroupId?: unknown;
    },
  ): Promise<unknown> {
    await assertTenantAdmin(ctx);
    const id = (v: unknown): bigint | null =>
      typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : null;
    const schemeId = id(body.permissionSchemeId);
    const workflowId = id(body.workflowId);
    const issueTypeIds = Array.isArray(body.issueTypeIds)
      ? body.issueTypeIds.map(id).filter((v): v is bigint => v !== null)
      : [];

    try {
      if (schemeId === null) throw new ProjectNeedsSchemeError();
      if (workflowId === null) throw new ProjectNeedsWorkflowError();
      const created = await createProject(ctx, {
        key: typeof body.key === 'string' ? body.key : '',
        name: typeof body.name === 'string' ? body.name : '',
        type: body.type as ProjectTypeName,
        permissionSchemeId: schemeId,
        workflowId,
        issueTypeIds,
        notifyGroupId: id(body.notifyGroupId),
      });
      return { ok: true, key: created.key };
    } catch (e) {
      if (
        e instanceof InvalidProjectKeyError ||
        e instanceof DuplicateProjectKeyError ||
        e instanceof ProjectNeedsSchemeError ||
        e instanceof ProjectNeedsWorkflowError ||
        e instanceof UnknownReferenceError
      ) {
        throw new HttpException(
          { error: 'invalid', message: e.message },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw e;
    }
  }

  @Get(':key')
  async detail(@Ctx() ctx: TenantContext, @Param('key') key: string): Promise<unknown> {
    await assertTenantAdmin(ctx);
    try {
      const project = await projectByKey(ctx, key);
      const [workflows, permissions, sla, groups, satisfaction] = await Promise.all([
        describeProjectWorkflows(ctx, project.id),
        describeGrants(ctx, project.id),
        describeSlaPolicy(ctx, project.id),
        listGroups(ctx),
        satisfactionSummary(ctx, { projectId: project.id }),
      ]);
      const scheme = await projectSchemeId(ctx, project.id);
      return {
        project: { ...project, id: project.id.toString() },
        workflows,
        permissions: {
          ...permissions,
          schemeId: scheme === null ? null : scheme.toString(),
          // ชุดสิทธิ์ใบเดียวใช้ร่วมกันหลายโปรเจกต์ได้ — แก้ที่นี่กระทบที่นั่นด้วย
          sharedWith: scheme === null ? [] : await schemeUsage(ctx, scheme),
        },
        groups,
        sla,
        satisfaction,
      };
    } catch (e) {
      if (e instanceof ProjectNotFoundError) {
        throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }

  /**
   * ให้หรือถอนสิทธิ์
   *
   * ⚠️ **แตะระบบสิทธิ์ — ต้องให้ Tech Lead อนุมัติก่อน merge (CLAUDE.md §4)**
   */
  @Post(':key/permissions')
  async setPermission(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { permission?: unknown; groupId?: unknown; granted?: unknown },
  ): Promise<{ ok: true; changed: boolean }> {
    await assertTenantAdmin(ctx);

    const permission = ALL_PERMISSION_KEYS.find((k) => k === body.permission);
    if (permission === undefined) {
      throw new HttpException(
        { error: 'invalid', message: 'ไม่รู้จักสิทธิ์ที่ระบุ' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const groupId = typeof body.groupId === 'string' ? body.groupId : '';
    if (!/^\d+$/.test(groupId)) {
      throw new HttpException({ error: 'invalid', message: 'รหัสกลุ่มไม่ถูกต้อง' }, HttpStatus.BAD_REQUEST);
    }

    try {
      const project = await projectByKey(ctx, key);
      const scheme = await projectSchemeId(ctx, project.id);
      if (scheme === null) {
        throw new HttpException(
          { error: 'no_scheme', message: `โปรเจกต์ ${key} ยังไม่ได้ผูกชุดสิทธิ์ จึงแก้สิทธิ์ไม่ได้` },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const r = await setGrant(ctx, scheme, permission, BigInt(groupId), body.granted === true);
      return { ok: true, changed: r.changed };
    } catch (e) {
      if (e instanceof ProjectNotFoundError) {
        throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
      }
      if (e instanceof LastAdminGrantError) {
        // 409 — คำขอถูกต้องทุกอย่าง แต่สถานะของระบบตอนนี้ทำให้ทำไม่ได้
        throw new HttpException({ error: 'last_admin', message: e.message }, HttpStatus.CONFLICT);
      }
      if (e instanceof UnknownGroupError) {
        throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }
}
