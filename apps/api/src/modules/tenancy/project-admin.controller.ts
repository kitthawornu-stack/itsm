/**
 * หน้าตั้งค่าโปรเจกต์ — ประกอบคำตอบจากหลายโมดูล
 *
 * ตัว controller ไม่แตะตารางของโมดูลอื่นเอง แต่ถามผ่าน service ที่แต่ละโมดูล
 * export ไว้ (ADR-004) · นี่คือจุดที่กติกา "ห้าม JOIN ข้ามขอบเขตโมดูล"
 * มีราคาจริง — สามคิวรีแทนหนึ่ง — และก็คุ้ม เพราะการย้าย workflow ออกไปเป็น
 * เซอร์วิสแยกวันหนึ่ง ต้องแก้แค่บรรทัดที่เรียก ไม่ใช่ทุก SQL ที่เคย JOIN มัน
 */
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import { systemClock, type TenantContext } from '@itsm/types';

import { Ctx } from '../../infrastructure/http/session.guard';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import {
  ALL_PERMISSION_KEYS,
  DuplicateSchemeNameError,
  LastAdminGrantError,
  SchemeInUseError,
  SchemeNameRequiredError,
  SchemeNotFoundError,
  UnknownGroupError,
  WouldHideProjectError,
  assertTenantAdmin,
  createScheme,
  describeGrants,
  listSchemes,
  removeScheme,
  schemeUsage,
  setGrant,
  setProjectScheme,
} from '../permission';
import { listGroups } from '../identity';
import {
  CatchAllMustBeLastError,
  GoalInUseError,
  GoalNotFoundError,
  InvalidTargetError,
  PolicyAlreadyExistsError,
  PolicyNotFoundError,
  addSlaGoal,
  createSlaPolicy,
  describeSlaPolicy,
  listCalendars,
  moveSlaGoal,
  removeSlaGoal,
  updateSlaGoalTarget,
} from '../sla';
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


/**
 * id ที่หน้าจอแก้ SLA ต้องใช้
 *
 * แยกจาก `describeSlaPolicy` ซึ่งออกแบบไว้ให้คนอ่าน · การยัด id เข้าไปที่นั่น
 * จะทำให้ทุกที่ที่แสดงผลต้องพก id ไปด้วยโดยไม่ได้ใช้
 */
async function slaEditable(
  ctx: TenantContext,
  projectId: bigint,
): Promise<{ policyId: string; goals: Array<{ id: string; isCatchAll: boolean }> } | null> {
  const db = tenantScoped(ctx);
  const policy = await db.slaPolicy.findFirst({
    where: { projectId },
    include: { goals: { orderBy: { position: 'asc' }, select: { id: true, match: true } } },
  });
  if (policy === null) return null;
  return {
    policyId: policy.id.toString(),
    goals: policy.goals.map((g: { id: bigint; match: unknown }) => ({
      id: g.id.toString(),
      isCatchAll: g.match === null,
    })),
  };
}

/** error ของชุดสิทธิ์ → รหัส HTTP ที่ตรงความหมาย */
function schemeError(e: unknown): never {
  if (e instanceof SchemeNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof SchemeInUseError) {
    // 409 — คำขอถูกต้อง แต่สถานะของข้อมูลตอนนี้ทำให้ทำไม่ได้
    throw new HttpException({ error: 'in_use', message: e.message }, HttpStatus.CONFLICT);
  }
  if (
    e instanceof SchemeNameRequiredError ||
    e instanceof DuplicateSchemeNameError ||
    // การสลับที่จะทำให้โปรเจกต์หายจากทุกคน ไม่ใช่ระบบพัง แต่เป็นคำขอที่รับไม่ได้
    e instanceof WouldHideProjectError
  ) {
    throw new HttpException(
      { error: 'invalid_input', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw e;
}

/** error ของ SLA → รหัส HTTP ที่ตรงความหมาย */
function slaError(e: unknown): never {
  if (e instanceof PolicyNotFoundError || e instanceof GoalNotFoundError) {
    throw new HttpException({ error: 'not_found', message: e.message }, HttpStatus.NOT_FOUND);
  }
  if (e instanceof GoalInUseError) {
    // 409 — คำขอถูกต้อง แต่สถานะของข้อมูลตอนนี้ทำให้ทำไม่ได้
    throw new HttpException({ error: 'in_use', message: e.message }, HttpStatus.CONFLICT);
  }
  if (
    e instanceof PolicyAlreadyExistsError ||
    e instanceof InvalidTargetError ||
    e instanceof CatchAllMustBeLastError
  ) {
    throw new HttpException(
      { error: 'invalid_input', message: e.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw e;
}

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
      // clock.nowUtc() ไม่ใช่ new Date() — INVARIANT 6 (lint จับให้แล้วรอบนี้)
      const thisYear = systemClock.nowUtc().getUTCFullYear();
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
        /*
          ส่ง id ของนโยบายและเป้า พร้อมรายการปฏิทิน มาให้หน้าจอด้วย
          `describeSlaPolicy` ออกแบบไว้ให้คนอ่าน ไม่มี id — หน้าจอที่ต้องแก้
          ต้องมี id จริง ไม่ใช่เดาจากชื่อ ซึ่งซ้ำกันได้
        */
        slaEditable: await slaEditable(ctx, project.id),
        /*
          ปฏิทินพร้อมสถานะการยืนยันของปีนี้และปีหน้า — ผู้ดูแลต้องเห็นก่อนเลือก
          ว่าปฏิทินนั้นยังไม่มีใครยืนยัน ไม่ใช่เลือกไปแล้วค่อยรู้ว่าตัวเลขเชื่อไม่ได้
        */
        calendars: await listCalendars(ctx, [thisYear, thisYear + 1]),
        /*
          ชุดสิทธิ์ทั้งหมด พร้อมบอกว่าใบไหนเปิดดูโปรเจกต์ไม่ได้เลย —
          ผู้ดูแลต้องเห็นก่อนสลับ ไม่ใช่สลับไปแล้วโปรเจกต์หายจากทุกคน
        */
        schemes: await listSchemes(ctx),
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

  @Post(':key/sla')
  async createPolicy(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { name?: unknown; calendarId?: unknown },
  ): Promise<{ id: string }> {
    await assertTenantAdmin(ctx);
    const project = await projectByKey(ctx, key);
    const calendarId =
      typeof body.calendarId === 'string' && body.calendarId !== '' ? BigInt(body.calendarId) : null;
    if (calendarId === null) {
      throw new HttpException(
        { error: 'invalid_input', message: 'ต้องเลือกปฏิทินเวลาทำการ' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      const r = await createSlaPolicy(
        ctx,
        project.id,
        typeof body.name === 'string' ? body.name : '',
        calendarId,
      );
      return { id: r.id.toString() };
    } catch (e) {
      return slaError(e);
    }
  }

  @Post(':key/sla/goals')
  async addGoal(
    @Ctx() ctx: TenantContext,
    @Body()
    body: {
      policyId?: unknown;
      key?: unknown;
      name?: unknown;
      targetMinutes?: unknown;
      priorityRanks?: unknown;
    },
  ): Promise<{ id: string }> {
    await assertTenantAdmin(ctx);
    const policyId =
      typeof body.policyId === 'string' && body.policyId !== '' ? BigInt(body.policyId) : null;
    if (policyId === null) {
      throw new HttpException(
        { error: 'invalid_input', message: 'ไม่พบนโยบาย' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const ranks = Array.isArray(body.priorityRanks)
      ? body.priorityRanks.map((r) => Number(r)).filter((r) => Number.isInteger(r))
      : [];
    try {
      const r = await addSlaGoal(ctx, policyId, {
        key: typeof body.key === 'string' && body.key !== '' ? body.key : 'time-to-resolve',
        name: typeof body.name === 'string' ? body.name : '',
        targetMinutes: Number(body.targetMinutes),
        priorityRanks: ranks,
      });
      return { id: r.id.toString() };
    } catch (e) {
      return slaError(e);
    }
  }

  @Post(':key/sla/goals/:goalId/target')
  async setGoalTarget(
    @Ctx() ctx: TenantContext,
    @Param('goalId') goalId: string,
    @Body() body: { targetMinutes?: unknown },
  ): Promise<{ affectedOpenItems: number }> {
    await assertTenantAdmin(ctx);
    try {
      return await updateSlaGoalTarget(ctx, BigInt(goalId), Number(body.targetMinutes));
    } catch (e) {
      return slaError(e);
    }
  }

  @Post(':key/sla/goals/:goalId/move')
  async moveGoal(
    @Ctx() ctx: TenantContext,
    @Param('goalId') goalId: string,
    @Body() body: { direction?: unknown },
  ): Promise<{ ok: true }> {
    await assertTenantAdmin(ctx);
    try {
      await moveSlaGoal(ctx, BigInt(goalId), body.direction === 'up' ? 'up' : 'down');
      return { ok: true };
    } catch (e) {
      return slaError(e);
    }
  }

  @Post(':key/sla/goals/:goalId/remove')
  async dropGoal(@Ctx() ctx: TenantContext, @Param('goalId') goalId: string): Promise<{ ok: true }> {
    await assertTenantAdmin(ctx);
    try {
      await removeSlaGoal(ctx, BigInt(goalId));
      return { ok: true };
    } catch (e) {
      return slaError(e);
    }
  }

  @Post('schemes')
  async addScheme(
    @Ctx() ctx: TenantContext,
    @Body() body: { name?: unknown; copyFromId?: unknown },
  ): Promise<{ id: string; copiedGrants: number }> {
    await assertTenantAdmin(ctx);
    const copyFrom =
      typeof body.copyFromId === 'string' && body.copyFromId !== ''
        ? BigInt(body.copyFromId)
        : undefined;
    try {
      const r = await createScheme(
        ctx,
        typeof body.name === 'string' ? body.name : '',
        copyFrom,
      );
      return { id: r.id.toString(), copiedGrants: r.copiedGrants };
    } catch (e) {
      return schemeError(e);
    }
  }

  @Post(':key/scheme')
  async assignScheme(
    @Ctx() ctx: TenantContext,
    @Param('key') key: string,
    @Body() body: { schemeId?: unknown },
  ): Promise<{ ok: true }> {
    await assertTenantAdmin(ctx);
    const project = await projectByKey(ctx, key);
    const schemeId =
      typeof body.schemeId === 'string' && body.schemeId !== '' ? BigInt(body.schemeId) : null;
    if (schemeId === null) {
      throw new HttpException(
        { error: 'invalid_input', message: 'ต้องเลือกชุดสิทธิ์' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      await setProjectScheme(ctx, project.id, schemeId);
      return { ok: true };
    } catch (e) {
      return schemeError(e);
    }
  }

  @Post('schemes/:schemeId/remove')
  async dropScheme(
    @Ctx() ctx: TenantContext,
    @Param('schemeId') schemeId: string,
  ): Promise<{ ok: true }> {
    await assertTenantAdmin(ctx);
    try {
      await removeScheme(ctx, BigInt(schemeId));
      return { ok: true };
    } catch (e) {
      return schemeError(e);
    }
  }
}
