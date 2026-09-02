/**
 * สิทธิเจ้าของข้อมูลตาม PDPA — ต่อฐานข้อมูล
 *
 * `personal-data.ts` ตัดสินกติกา · ไฟล์นี้อ่านของจริงมาให้มันตัดสิน
 * แล้วเขียนลงฐานข้อมูลพร้อมร่องรอย
 *
 * **ผู้ดูแลระบบเท่านั้น** (`ADMINISTER_TENANT`) — ทั้งการขอสำเนาและการลบ ·
 * คำขอตามกฎหมายมาถึงองค์กร ไม่ใช่มาถึงระบบโดยตรง จึงต้องมีคนรับผิดชอบกดเอง
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { auditedTransaction } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertTenantAdmin } from '../permission';
import {
  assertErasable,
  residualRisks,
  tombstoneFor,
  ERASED_DOMAIN,
  type ResidualRisk,
} from './personal-data';

/**
 * ดึงข้อความล้วนออกจาก structured document
 *
 * ซ้ำกับตัวช่วยใน `comment.service.ts` โดยตั้งใจ — โมดูลแชร์ฟังก์ชันภายใน
 * ข้ามกันไม่ได้ (ADR-004) และการ export มันออกจาก `workitem` เพื่อใช้ที่นี่
 * จะเปิดพื้นผิวของโมดูลนั้นเกินจำเป็น
 */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return '';
  const doc = value as Record<string, unknown>;
  return typeof doc['text'] === 'string' ? doc['text'] : '';
}

/**
 * ไม่มีตัวตนในเซสชัน
 *
 * เส้นทางของตัวเองอ่าน `ctx.actorId` อย่างเดียว · session guard กันไว้ก่อนถึง
 * ตรงนี้อยู่แล้ว แต่ค่าปริยายของฟังก์ชันต้องเป็นการปฏิเสธ ไม่ใช่การเดาว่า
 * คนที่ถามคือใคร
 */
export class NoActorError extends Error {
  constructor() {
    super('ต้องเข้าสู่ระบบก่อนขอสำเนาข้อมูลของตัวเอง');
    this.name = 'NoActorError';
  }
}

export class UserNotFoundForPdpaError extends Error {
  constructor(id: bigint) {
    super(`ไม่พบผู้ใช้รหัส ${id.toString()}`);
    this.name = 'UserNotFoundForPdpaError';
  }
}

export interface PersonalDataExport {
  exportedAt: string;
  person: {
    id: string;
    email: string;
    displayName: string;
    isActive: boolean;
    createdAt: string;
  };
  groups: string[];
  /** เรื่องที่เป็นผู้แจ้ง — หัวข้อเท่านั้น ไม่รวมรายละเอียดของคนอื่นที่ตอบมา */
  reportedItems: Array<{ itemKey: string; summary: string; createdAt: string }>;
  assignedItems: Array<{ itemKey: string; summary: string; statusCategory: string }>;
  comments: Array<{ itemKey: string; body: string; createdAt: string; internal: boolean }>;
  workLogs: Array<{ itemKey: string; note: string | null; minutes: number; startedAt: string }>;
  sessions: Array<{ userAgent: string | null; ipAddress: string | null; createdAt: string }>;
  counts: { comments: number; workLogs: number; reportedItems: number; attachments: number };
}

/** จำนวนสูงสุดต่อหมวดในไฟล์ส่งออก — `counts` บอกยอดจริงเสมอ */
export const EXPORT_LIMIT = 1000;

async function personFor(
  ctx: TenantContext,
  userId: bigint,
): Promise<{
  id: bigint;
  email: string;
  displayName: string;
  isActive: boolean;
  createdAt: Date;
}> {
  const u = await tenantScoped(ctx).user.findFirst({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, isActive: true, createdAt: true },
  });
  if (u === null) throw new UserNotFoundForPdpaError(userId);
  return u;
}

/**
 * สำเนาข้อมูลส่วนบุคคลของคนหนึ่ง
 *
 * **จำกัดจำนวนต่อหมวด แต่บอกยอดจริงเสมอ** — ไฟล์ที่ตัดข้อมูลทิ้งเงียบ ๆ
 * อ่านเหมือน "นี่คือทั้งหมดที่มี" ซึ่งเป็นคำตอบที่ผิดต่อคำขอตามกฎหมาย ·
 * `counts` จึงมาจากการนับจริง ไม่ใช่ `rows.length`
 */
async function gatherPersonalData(
  ctx: TenantContext,
  userId: bigint,
  now: UtcDate,
  limit: number,
): Promise<PersonalDataExport> {
  const db = tenantScoped(ctx);
  const person = await personFor(ctx, userId);

  const groups = await db.groupMember.findMany({
    where: { userId },
    select: { group: { select: { name: true } } },
  });
  const reported = await db.workItem.findMany({
    where: { reporterId: userId },
    select: { itemKey: true, summary: true, createdAt: true },
    orderBy: { id: 'desc' },
    take: limit,
  });
  const assigned = await db.workItem.findMany({
    where: { assigneeId: userId },
    select: { itemKey: true, summary: true, status: { select: { category: true } } },
    orderBy: { id: 'desc' },
    take: limit,
  });
  const comments = await db.workItemComment.findMany({
    where: { authorId: userId },
    select: {
      body: true,
      isInternal: true,
      createdAt: true,
      workItem: { select: { itemKey: true } },
    },
    orderBy: { id: 'desc' },
    take: limit,
  });
  const logs = await db.workLog.findMany({
    where: { userId },
    select: {
      note: true,
      spentMinutes: true,
      startedAt: true,
      workItem: { select: { itemKey: true } },
    },
    orderBy: { id: 'desc' },
    take: limit,
  });
  /*
    เซสชันเป็นข้อมูลส่วนบุคคลด้วย (`ipAddress`, `userAgent`) — เจ้าของข้อมูล
    มีสิทธิ์รู้ว่าระบบเก็บอะไรไว้บ้าง · ไม่ส่ง `tokenHash` ออกไป เพราะไม่ใช่
    ข้อมูลของเขา แต่เป็นความลับของระบบ
  */
  const sessions = await db.session.findMany({
    where: { userId },
    select: { userAgent: true, ipAddress: true, createdAt: true },
    orderBy: { id: 'desc' },
    take: limit,
  });

  const counts = {
    comments: await db.workItemComment.count({ where: { authorId: userId } }),
    workLogs: await db.workLog.count({ where: { userId } }),
    reportedItems: await db.workItem.count({ where: { reporterId: userId } }),
    attachments: await db.workItemAttachment.count({ where: { uploaderId: userId } }),
  };

  return {
    exportedAt: now.toISOString(),
    person: {
      id: person.id.toString(),
      email: person.email,
      displayName: person.displayName,
      isActive: person.isActive,
      createdAt: person.createdAt.toISOString(),
    },
    groups: groups.map((g) => g.group.name),
    reportedItems: reported.map((r) => ({
      itemKey: r.itemKey,
      summary: r.summary,
      createdAt: r.createdAt.toISOString(),
    })),
    assignedItems: assigned.map((r) => ({
      itemKey: r.itemKey,
      summary: r.summary,
      statusCategory: r.status.category,
    })),
    comments: comments.map((c) => ({
      itemKey: c.workItem.itemKey,
      // `body` เป็น JSON ที่มีโครงสร้าง — ดึงข้อความล้วนออกมาให้คนอ่านได้
      body: textOf(c.body),
      createdAt: c.createdAt.toISOString(),
      internal: c.isInternal,
    })),
    workLogs: logs.map((l) => ({
      itemKey: l.workItem.itemKey,
      note: l.note,
      minutes: l.spentMinutes,
      startedAt: l.startedAt.toISOString(),
    })),
    sessions: sessions.map((s) => ({
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt.toISOString(),
    })),
    counts,
  };
}

/**
 * บันทึกว่ามีการดึงสำเนาข้อมูลส่วนบุคคลออกไป
 *
 * **การดึงสำเนาไม่ใช่การแก้ข้อมูล แต่ต้องมีร่องรอย** — เอกสารสถานะเคยเขียนไว้เอง
 * ว่าเส้นทางนี้ "ยังไม่ถูกบันทึกใน `audit_log` เพราะกลไก audit ผูกกับทรานแซกชัน
 * ที่เขียนข้อมูล" · ซึ่งเป็นข้อจำกัดที่เราสร้างขึ้นเอง ไม่ใช่ข้อเท็จจริง —
 * `auditedTransaction` รับงานที่ไม่เขียนอะไรได้อยู่แล้ว
 *
 * ข้อมูลส่วนบุคคลของคนหนึ่งถูกดึงออกไปเป็นไฟล์ คือเหตุการณ์ที่ต้องตอบได้ว่า
 * ใครดึง ของใคร เมื่อไร · ถ้าไม่บันทึก จะไม่มีทางรู้เลยว่าเคยเกิดขึ้น
 *
 * **payload ไม่มีเนื้อข้อมูลและไม่มีอีเมล** — บันทึกว่าใครดึงของใคร ไม่ใช่
 * ทำสำเนาที่สองไว้ในตารางที่ลบยากกว่าเดิม
 */
async function recordExport(
  ctx: TenantContext,
  subjectId: bigint,
  bySelf: boolean,
  counts: PersonalDataExport['counts'],
): Promise<void> {
  await auditedTransaction(ctx, 'identity.personal-data.export', () =>
    Promise.resolve({
      result: undefined,
      audit: [
        {
          kind: 'system' as const,
          action: 'identity.personal-data.export',
          entityType: 'user',
          entityId: subjectId.toString(),
          payload: { bySelf, counts },
        },
      ],
    }),
  );
}

/**
 * สำเนาข้อมูลส่วนบุคคลของคนอื่น — สำหรับผู้ดูแลที่รับคำขอมาจากช่องทางอื่น
 */
export async function exportPersonalData(
  ctx: TenantContext,
  userId: bigint,
  now: UtcDate = systemClock.nowUtc(),
  /** ฉีดเข้ามาได้เพื่อให้เทสต์พิสูจน์ได้ว่า `counts` ไม่ใช่ `rows.length` */
  limit: number = EXPORT_LIMIT,
): Promise<PersonalDataExport> {
  await assertTenantAdmin(ctx);
  const out = await gatherPersonalData(ctx, userId, now, limit);
  await recordExport(ctx, userId, false, out.counts);
  return out;
}

/**
 * สำเนาข้อมูลส่วนบุคคล **ของตัวเอง**
 *
 * PDPA ให้สิทธิ์เจ้าของข้อมูลขอสำเนาได้เอง · การบังคับให้ต้องผ่านผู้ดูแล
 * ทำให้สิทธิ์นั้นขึ้นกับว่ามีคนว่างมาทำให้หรือไม่ ซึ่งไม่ใช่สิทธิ์
 *
 * **ไม่รับ `userId` เลย** — ไม่ใช่รับแล้วตรวจว่าตรงกับตัวเอง · พารามิเตอร์ที่
 * ไม่มี คือพารามิเตอร์ที่ปลอมไม่ได้ · เป็นรูปแบบเดียวกับ `changeOwnPassword`
 * และเป็นเหตุผลที่ฟังก์ชันนี้ไม่ต้องมีด่านสิทธิ์ของตัวเอง
 */
export async function exportMyPersonalData(
  ctx: TenantContext,
  now: UtcDate = systemClock.nowUtc(),
  limit: number = EXPORT_LIMIT,
): Promise<PersonalDataExport> {
  if (ctx.actorId === null) throw new NoActorError();
  const out = await gatherPersonalData(ctx, ctx.actorId, now, limit);
  await recordExport(ctx, ctx.actorId, true, out.counts);
  return out;
}

export interface ErasureResult {
  displayName: string;
  /** ที่ที่ข้อมูลส่วนบุคคลอาจยังเหลืออยู่ — **ต้องแสดงเสมอ** */
  residual: ResidualRisk[];
}

/**
 * ทำให้เป็นนิรนามตามคำขอ
 *
 * **ไม่ลบแถว** — ประวัติของคนอื่นอ้างถึงคนคนนี้ · ดู doc ของ `personal-data.ts`
 *
 * @throws {LastAdminError} เป็นผู้ดูแลระบบคนสุดท้าย
 * @throws {StillAssignedError} ยังถือครองงานที่เปิดอยู่
 * @throws {AlreadyErasedError} ทำไปแล้ว
 */
export async function erasePersonalData(
  ctx: TenantContext,
  userId: bigint,
): Promise<ErasureResult> {
  await assertTenantAdmin(ctx);
  const db = tenantScoped(ctx);
  const person = await personFor(ctx, userId);

  /*
    "ผู้ดูแลคนสุดท้าย" ตรวจ **ทั้ง tenant** ไม่ใช่แค่ชุดสิทธิ์ใบเดียว
    เพราะ `isTenantAdmin` ถือว่ามีคีย์นี้ในชุดไหนก็ได้ = เป็นผู้ดูแล
  */
  const adminGroupIds = (
    await db.permissionGrant.findMany({
      where: { permission: 'ADMINISTER_TENANT', groupId: { not: null } },
      select: { groupId: true },
    })
  ).map((g) => g.groupId as bigint);
  const admins = await db.groupMember.findMany({
    where: { groupId: { in: adminGroupIds } },
    select: { userId: true },
    distinct: ['userId'],
  });
  const isAdmin = admins.some((a) => a.userId === userId);
  const otherAdmins = admins.filter((a) => a.userId !== userId).length;

  const openAssignments = await db.workItem.count({
    where: { assigneeId: userId, status: { category: { not: 'DONE' } } },
  });

  assertErasable({
    alreadyErased: person.email.endsWith(`@${ERASED_DOMAIN}`),
    isLastAdmin: isAdmin && otherAdmins === 0,
    openAssignments,
  });

  const counts = {
    comments: await db.workItemComment.count({ where: { authorId: userId } }),
    workLogs: await db.workLog.count({ where: { userId } }),
    reportedItems: await db.workItem.count({ where: { reporterId: userId } }),
    attachments: await db.workItemAttachment.count({ where: { uploaderId: userId } }),
  };
  const stone = tombstoneFor(userId);

  return auditedTransaction(ctx, 'pdpa.erase', async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        email: stone.email,
        displayName: stone.displayName,
        // ล็อกอินไม่ได้อีก · `null` ไม่ใช่สตริงว่าง เพราะสตริงว่างยังเป็นแฮชที่เทียบได้
        passwordHash: null,
        isActive: false,
      },
    });
    /*
      เซสชันลบทิ้ง **ไม่ใช่แค่เพิกถอน** — `ipAddress` กับ `userAgent`
      เป็นข้อมูลส่วนบุคคลที่คำขอครอบถึง · ต่างจากตัวเก็บกวาดปกติที่เก็บไว้
      เป็นร่องรอยความปลอดภัย เพราะที่นี่เจ้าของข้อมูลขอให้ลบเอง
    */
    await tx.session.deleteMany({ where: { userId } });

    return {
      result: { displayName: stone.displayName, residual: residualRisks(counts) },
      audit: [
        {
          kind: 'system' as const,
          action: 'pdpa.erase',
          entityType: 'user',
          entityId: userId.toString(),
          /*
            **ไม่บันทึกอีเมลเดิมลง audit** — นั่นคือข้อมูลส่วนบุคคลที่เพิ่งลบไป ·
            การเก็บไว้ในร่องรอยเท่ากับไม่ได้ลบ · บันทึกเฉพาะว่าเกิดขึ้นแล้ว
            และเหลืออะไรให้ตามต่อ
          */
          payload: { residual: residualRisks(counts).map((r) => `${r.kind}:${String(r.count)}`) },
        },
      ],
    };
  });
}
