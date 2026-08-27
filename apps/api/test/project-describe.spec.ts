/**
 * หน้าตั้งค่าโปรเจกต์ต้องบอกความจริง — เทสต์เป็นข้อกำหนด
 *
 * พฤติกรรมเกือบทั้งหมดของระบบอยู่ในตารางตั้งค่า ไม่ได้อยู่ในโค้ด
 * หน้าจอที่แสดงมันจึงไม่ใช่ของประดับ: ถ้ามันแสดงไม่ครบหรือแสดงผิด
 * ผู้ดูแลจะสรุปเรื่องระบบผิดโดยมั่นใจ ซึ่งแย่กว่าไม่มีหน้าจอเลย
 *
 * เคสที่สำคัญที่สุดคือ **สิ่งที่ไม่มี ต้องแสดงว่าไม่มี** — สิทธิ์ที่ไม่มีใครได้
 * โปรเจกต์ที่ไม่มี permission scheme และกฎที่ระบบไม่รู้จัก ทั้งสามอย่าง
 * เป็นความเงียบที่ตีความผิดได้ง่ายที่สุด
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@itsm/types';

import { prismaClient } from '../src/infrastructure/prisma/client';
import { ALL_PERMISSION_KEYS, describeGrants } from '../src/modules/permission';
import { describeProjectWorkflows } from '../src/modules/workflow';
import { evaluateTransitions, requiredFieldsFor } from '../src/modules/workflow';
import { listProjects, projectByKey } from '../src/modules/tenancy';

let ctx: TenantContext;
let sdId: bigint;

beforeAll(async () => {
  const tenant = await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } });
  ctx = { tenantId: tenant.id, actorId: null };
  sdId = (await projectByKey(ctx, 'SD')).id;
});

afterAll(async () => {
  await prismaClient.$disconnect();
});

describe('รายชื่อโปรเจกต์', () => {
  it('บอกจำนวนงานจริง ไม่ใช่ให้ผู้ดูแลไปนับเอง', async () => {
    const rows = await listProjects(ctx);
    const sd = rows.find((p) => p.key === 'SD');
    const actual = await prismaClient.workItem.count({
      where: { tenantId: ctx.tenantId, projectId: sdId },
    });
    expect(sd?.itemCount).toBe(actual);
  });

  it('กลุ่มรับแจ้งเตือนที่ยังไม่ได้ตั้ง ต้องเป็น null ไม่ใช่ข้อความว่าง', async () => {
    const rows = await listProjects(ctx);
    // null กับ "" ต่างกัน — อย่างหนึ่งคือยังไม่ได้ตั้ง อีกอย่างคือตั้งเป็นชื่อว่าง
    for (const p of rows) {
      expect(p.notifyGroup === null || p.notifyGroup.length > 0).toBe(true);
    }
  });
});

describe('สิทธิ์ของโปรเจกต์', () => {
  it('**แสดงคีย์ครบทุกตัว รวมที่ไม่มีใครได้**', async () => {
    const { rows } = await describeGrants(ctx, sdId);
    expect(rows.map((r) => r.permission)).toEqual([...ALL_PERMISSION_KEYS]);
    // แถวที่ว่างคือคำตอบ ไม่ใช่ข้อมูลที่ขาด — การซ่อนมันทำให้ดูเหมือนไม่มีคีย์นั้น
    expect(rows.some((r) => r.groups.length === 0)).toBe(true);
  });

  it('ตรงกับสิ่งที่อยู่ในตาราง grant จริง ไม่ใช่รายการที่เขียนตายไว้', async () => {
    const { rows } = await describeGrants(ctx, sdId);
    const project = await prismaClient.project.findFirstOrThrow({ where: { id: sdId } });
    const actual = await prismaClient.permissionGrant.findMany({
      where: { schemeId: project.permissionSchemeId ?? BigInt(0) },
      include: { group: { select: { name: true } } },
    });
    const expected = new Map<string, Set<string>>();
    for (const g of actual) {
      if (g.group === null) continue;
      const set = expected.get(g.permission) ?? new Set<string>();
      set.add(g.group.name);
      expected.set(g.permission, set);
    }
    for (const row of rows) {
      expect(new Set(row.groups)).toEqual(expected.get(row.permission) ?? new Set());
    }
  });

  it('**grant ที่ไม่มีกลุ่มไม่ให้สิทธิ์ใคร** — ข้อมูลไม่ครบแปลว่าไม่มีสิทธิ์', async () => {
    // ข้อมูล seed ไม่มี grant แบบนี้เลย ถ้าไม่สร้างเอง กลไกที่กันไว้จะไม่ถูกแตะ
    // และเทสต์จะเขียวต่อไปแม้ลบมันออก
    const project = await prismaClient.project.findFirstOrThrow({ where: { id: sdId } });
    const schemeId = project.permissionSchemeId;
    if (schemeId === null) return;

    // เลือกคีย์ที่ยังไม่มีใครได้ ไม่ใช่เขียนชื่อคีย์ตายไว้ — คีย์ที่เขียนตายอาจ
    // มี grant จริงอยู่แล้ววันหนึ่ง แล้วเทสต์จะล้มด้วยเหตุผลที่ไม่เกี่ยวกับสิ่งที่วัด
    const before = await describeGrants(ctx, sdId);
    const unused = before.rows.find((r) => r.groups.length === 0)?.permission;
    if (unused === undefined) return;

    const orphanGrant = await prismaClient.permissionGrant.create({
      data: { tenantId: ctx.tenantId, schemeId, permission: unused as never, groupId: null },
      select: { id: true },
    });
    try {
      const { rows } = await describeGrants(ctx, sdId);
      expect(rows.find((r) => r.permission === unused)?.groups).toEqual([]);
    } finally {
      await prismaClient.permissionGrant.deleteMany({ where: { id: orphanGrant.id } });
    }
  });

  it('**สิทธิ์ที่ได้มาโดยปริยายต้องแสดงด้วย** ไม่ใช่บอกว่าไม่มีใคร', async () => {
    // `summarize` ให้แนบไฟล์ได้เมื่อมี MANAGE_ATTACHMENT **หรือ** EDIT_ITEM
    // ตารางที่แสดงแต่ grant ตรง ๆ จึงบอกว่า "จัดการไฟล์แนบ — ยังไม่มีใคร"
    // ทั้งที่ทีมที่แก้ไขเรื่องได้แนบไฟล์ได้อยู่แล้ว
    const { rows } = await describeGrants(ctx, sdId);
    const attach = rows.find((r) => r.permission === 'MANAGE_ATTACHMENT');
    const edit = rows.find((r) => r.permission === 'EDIT_ITEM');
    expect(attach?.impliedBy).toBe('EDIT_ITEM');
    expect(attach?.impliedGroups).toEqual(edit?.groups);
  });

  it('**โปรเจกต์ที่ไม่มี scheme = ไม่มีใครทำอะไรได้** ไม่ใช่ทุกคนทำได้', async () => {
    const orphan = await prismaClient.project.create({
      data: {
        tenantId: ctx.tenantId,
        key: `Z${String(Date.now()).slice(-6)}`,
        name: 'โปรเจกต์ที่ยังไม่ได้ผูก scheme',
        type: 'SERVICE_DESK',
      },
      select: { id: true },
    });
    try {
      const { schemeName, rows } = await describeGrants(ctx, orphan.id);
      expect(schemeName).toBeNull();
      expect(rows.every((r) => r.groups.length === 0)).toBe(true);
    } finally {
      await prismaClient.project.deleteMany({ where: { id: orphan.id } });
    }
  });
});

describe('workflow ของโปรเจกต์', () => {
  it('แสดงสถานะครบพร้อมจำนวนงานที่ค้างอยู่ในแต่ละสถานะ', async () => {
    const [wf] = await describeProjectWorkflows(ctx, sdId);
    expect(wf).toBeDefined();
    expect(wf?.statuses.length).toBeGreaterThan(0);
    expect(wf?.statuses.some((st) => st.isInitial)).toBe(true);
  });

  it('**ประเภทงานที่ใช้ workflow เดียวกัน รวมเป็นรายการเดียว** ไม่ใช่แสดงซ้ำ', async () => {
    const list = await describeProjectWorkflows(ctx, sdId);
    // workflow แต่ละเรือนต้องปรากฏครั้งเดียว — การแสดงตารางเดิมซ้ำสี่รอบ
    // กลบข้อเท็จจริงว่าทั้งสี่ประเภททำงานเหมือนกันทุกประการ
    const names = list.map((w) => w.workflowName);
    expect(new Set(names).size).toBe(names.length);

    const schemes = await prismaClient.workflowScheme.findMany({
      where: { projectId: sdId },
      include: { issueType: { select: { name: true } } },
    });
    // แต่ประเภทงานต้องไม่หายไปสักชนิด — การรวมกลุ่มต้องไม่ใช่การทิ้ง
    expect(new Set(list.flatMap((w) => w.issueTypes))).toEqual(
      new Set(schemes.map((s) => s.issueType.name)),
    );
  });

  it('**ฟิลด์ที่ปุ่มจะขอ ต้องตรงกับที่ engine จะขอจริง**', async () => {
    // หน้าจอที่บอกคนละอย่างกับ engine คือหน้าจอที่ทำให้ผู้ดูแลสรุปผิดอย่างมั่นใจ
    const [wf] = await describeProjectWorkflows(ctx, sdId);
    const shown = (wf?.transitions ?? []).find((t) => t.validators.length > 0);
    expect(shown).toBeDefined();

    const scheme = await prismaClient.workflowScheme.findFirstOrThrow({ where: { projectId: sdId } });
    const raw = await prismaClient.workflowTransition.findMany({
      where: { workflowId: scheme.workflowId },
      include: { rules: true },
    });
    const same = raw.find((t) => t.name === shown?.name);
    const fields = requiredFieldsFor({
      id: same?.id ?? BigInt(0),
      name: same?.name ?? '',
      fromStatusId: same?.fromStatusId ?? null,
      toStatusId: same?.toStatusId ?? BigInt(0),
      position: same?.position ?? 0,
      rules: (same?.rules ?? []).map((r) => ({
        kind: r.kind,
        ruleType: r.ruleType,
        config: (r.config ?? {}) as Record<string, unknown>,
        position: r.position,
      })),
    });
    for (const f of fields) {
      expect(shown?.validators.join(' ')).toContain(f);
    }
  });

  it('**transition ที่ทำได้จากทุกสถานะ แสดง from เป็น null** ไม่ใช่ข้อความว่าง', async () => {
    // ข้อมูล seed ไม่มี global transition สักเส้น การวนดูของที่มีอยู่จึงพิสูจน์
    // อะไรไม่ได้เลย — ต้องสร้างเส้นที่ `fromStatusId` เป็น null ขึ้นมาเอง
    const scheme = await prismaClient.workflowScheme.findFirstOrThrow({ where: { projectId: sdId } });
    const anyStatus = await prismaClient.workflowStatus.findFirstOrThrow({
      where: { workflowId: scheme.workflowId },
    });
    const global = await prismaClient.workflowTransition.create({
      data: {
        tenantId: ctx.tenantId,
        workflowId: scheme.workflowId,
        name: 'ทดสอบเส้นที่ทำได้จากทุกสถานะ',
        fromStatusId: null,
        toStatusId: anyStatus.id,
        position: 98,
      },
      select: { id: true, name: true },
    });
    try {
      const shown = (await describeProjectWorkflows(ctx, sdId))
        .flatMap((w) => w.transitions)
        .find((t) => t.name === global.name);
      // null = ทำได้จากทุกสถานะ · '' = ไม่รู้ว่ามาจากไหน · คนละความหมายกันคนละเรื่อง
      expect(shown?.from).toBeNull();
      expect(shown?.to.length).toBeGreaterThan(0);
    } finally {
      await prismaClient.workflowTransition.deleteMany({ where: { id: global.id } });
    }
  });

  it('**กฎที่ระบบไม่รู้จักต้องแสดง ไม่ใช่ซ่อน** — ปุ่มนั้นจะหายไปทั้งปุ่ม', async () => {
    const scheme = await prismaClient.workflowScheme.findFirstOrThrow({ where: { projectId: sdId } });
    const target = await prismaClient.workflowTransition.findFirstOrThrow({
      where: { workflowId: scheme.workflowId },
    });
    const rule = await prismaClient.transitionRule.create({
      data: {
        tenantId: ctx.tenantId,
        transitionId: target.id,
        kind: 'CONDITION',
        ruleType: 'กฎที่ไม่มีอยู่จริง',
        config: {},
        position: 99,
      },
      select: { id: true },
    });
    try {
      const list = await describeProjectWorkflows(ctx, sdId);
      const shown = list.flatMap((w) => w.transitions).find((t) => t.name === target.name);
      expect(shown?.conditions.join(' ')).toContain('ระบบไม่รู้จักกฎนี้');

      // และนี่คือผลจริงของมัน: engine ตัดปุ่มนั้นทิ้งทั้งเส้น
      const visible = evaluateTransitions(
        [
          {
            id: target.id,
            name: target.name,
            fromStatusId: null,
            toStatusId: target.toStatusId,
            position: 1,
            rules: [{ kind: 'CONDITION', ruleType: 'กฎที่ไม่มีอยู่จริง', config: {}, position: 1 }],
          },
        ],
        {
          currentUserId: BigInt(1),
          currentStatusId: target.toStatusId,
          assigneeId: null,
          userGroupIds: [],
          fields: {},
        },
      );
      expect(visible).toHaveLength(0);
    } finally {
      // ต้องอยู่ใน finally — assertion ที่ล้มกลางทางเคยทิ้งข้อมูลพังไว้จริง
      await prismaClient.transitionRule.deleteMany({ where: { id: rule.id } });
    }
  });
});
