/**
 * เปลี่ยนสถานะหลายเรื่องพร้อมกัน
 *
 * **ทำไมไม่เขียน `statusId` ทับเป็นชุดเหมือน `bulkEditWorkItems`**
 *
 * ผู้รับผิดชอบและระดับความสำคัญเป็นค่าที่เขียนทับได้ตรง ๆ · สถานะไม่ใช่ค่าแบบนั้น
 * มันเป็นผลของ state machine ที่มีเงื่อนไข ตัวตรวจ และ post function อยู่ข้างหลัง
 * การอัปเดตคอลัมน์เป็นชุดคือการเดินอ้อมทุกอย่างที่ workflow มีไว้ปฏิเสธ —
 * งานจะถูกปิดโดยไม่มีผลการแก้ไข นาฬิกา SLA ไม่หยุด ผู้แจ้งไม่ถูกชวนให้คะแนน
 * และไม่มี error สักบรรทัด
 *
 * ที่นี่จึงเรียก `applyTransition` รายใบ ซึ่งเป็นเส้นทางเดียวกับปุ่มบนหน้างาน
 * ทุกประการ · ราคาที่จ่ายคือช้ากว่า (หนึ่งทรานแซกชันต่อใบ) ซึ่งยอมรับได้
 * ที่เพดาน 50 ใบ และเป็นราคาที่ถูกกว่าการมีทางลับที่ข้ามกฎได้
 *
 * **ทำไมเลือกด้วยชื่อปุ่ม ไม่ใช่ id**
 *
 * ชุดหนึ่งข้ามโปรเจกต์และประเภทงานได้ (คิว HQL เลือกแบบนั้นได้อยู่แล้ว)
 * ปุ่ม "ปิดงาน" ของ Incident กับของ Service Request เป็นคนละแถวใน
 * `workflow_transition` · id เดียวใช้ทั้งชุดไม่ได้ตั้งแต่ต้น
 */
import type { RiskLevel, TenantContext } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan, browsableProjectIds } from '../permission';
import { indexWorkItem } from '../search-index';
import { applyTransition, availableTransitions } from '../workflow';
import { BULK_MAX, BulkTooManyItemsError, NothingSelectedError } from './bulk-edit.service';
import { riskOf } from './change-risk.service';

/**
 * ประเมินความเสี่ยงให้ transition — คืน `undefined` เมื่อประเมินไม่ได้
 *
 * `workflow` ประเมินเองไม่ได้ (ข้อมูลอยู่คนละโมดูล และการเรียกกลับจะเป็นวง)
 * ผู้เรียกทุกทางจึงต้องประเมินมาเอง · ทางที่ไม่ส่งจะถูก validator
 * `max-change-risk` ปฏิเสธพร้อมบอกเหตุ ไม่ใช่ปล่อยผ่านเงียบ ๆ
 */
async function riskFor(
  ctx: TenantContext,
  itemKey: string,
): Promise<{ level: RiskLevel; reasons: readonly string[] } | undefined> {
  try {
    const r = await riskOf(ctx, itemKey);
    return { level: r.level, reasons: r.reasons.map((x) => x.detail) };
  } catch {
    return undefined;
  }
}


export interface BulkTransitionInput {
  /** ชื่อปุ่มบนหน้าจอ — ไม่ใช่ id เพราะปุ่มเดียวกันคนละ workflow คนละแถว */
  transitionName: string;
  /** ผลการแก้ไขที่ใช้กับทั้งชุด — ปุ่มปิดงานส่วนใหญ่ขอค่านี้ */
  resolutionName?: string | null;
}

export interface BulkTransitionItemResult {
  itemKey: string;
  outcome: 'changed' | 'not-found' | 'failed';
  from?: string;
  to?: string;
  /** เหตุผลที่ทำไม่ได้ — ต้องอ่านแล้วรู้ว่าต้องทำอะไรต่อ */
  reason?: string;
}

export interface BulkTransitionResult {
  requested: number;
  changed: number;
  failed: number;
  items: BulkTransitionItemResult[];
}

export interface BulkTransitionOption {
  name: string;
  /** จำนวนใบในชุดที่กดปุ่มนี้ได้จริง — ต้องมากกว่า 0 เสมอจึงจะอยู่ในรายการ */
  eligible: number;
  /** ฟิลด์ที่ต้องกรอกก่อนกด — รวมของทุกใบที่กดได้ */
  requiredFields: string[];
}

/**
 * อ่านงานในชุด พร้อมตรวจสิทธิ์ทุกโปรเจกต์ที่ชุดนี้แตะ
 *
 * แยกออกมาเพราะทั้งการเสนอปุ่มและการกดปุ่มต้องใช้ชุดเดียวกัน —
 * ถ้าสองทางอ่านคนละแบบ หน้าจอจะเสนอปุ่มที่กดแล้วได้ผลอีกอย่าง
 */
async function loadScope(
  ctx: TenantContext,
  itemKeys: readonly string[],
): Promise<{ keys: string[]; items: Array<{ id: bigint; itemKey: string }> }> {
  const keys = [...new Set(itemKeys.map((k) => k.trim()).filter((k) => k !== ''))];
  if (keys.length === 0) throw new NothingSelectedError();
  // ปฏิเสธทั้งชุด ไม่ตัดเงียบ ๆ — ตัดเงียบแปลว่าผู้ใช้เชื่อว่าทำครบแล้ว
  if (keys.length > BULK_MAX) throw new BulkTooManyItemsError(keys.length);

  /*
    อ่านเฉพาะงานของโปรเจกต์ที่เปิดดูได้ **ที่ระดับคิวรี** · ใบที่ไม่อยู่ในผลนี้
    ได้ผลเป็น `not-found` เหมือนใบที่ไม่มีอยู่จริง — การแยกสองอย่างนี้ออกจากกัน
    คือการยืนยันว่าเลขที่เรื่องนั้นมีอยู่
  */
  const allowed = await browsableProjectIds(ctx);
  const items =
    allowed.length === 0
      ? []
      : await tenantScoped(ctx).workItem.findMany({
          where: { itemKey: { in: keys }, projectId: { in: allowed } },
          select: { id: true, itemKey: true, projectId: true },
        });

  /*
    ตรวจสิทธิ์ก่อนแตะใบไหน และตรวจทุกโปรเจกต์ที่ชุดนี้แตะ — คนที่เปลี่ยนสถานะ
    ใน SD ได้ ไม่ได้แปลว่าทำใน PLAT ได้ด้วย
  */
  const projectIds = [...new Set(items.map((i) => i.projectId.toString()))].map((s) => BigInt(s));
  for (const pid of projectIds) {
    await assertCan(ctx, pid, 'BULK_EDIT');
    await assertCan(ctx, pid, 'TRANSITION_ITEM');
  }

  return { keys, items: items.map((i) => ({ id: i.id, itemKey: i.itemKey })) };
}

/**
 * ปุ่มที่ชุดนี้กดได้จริง
 *
 * **ปุ่มที่กดแล้วล้มทุกใบคือปุ่มที่ไม่ควรอยู่บนหน้าจอ** · และจำนวนใบที่กดได้
 * ต้องรู้ก่อนกด ไม่ใช่รู้ตอนอ่านผล — การกดปุ่มที่ขยับได้ใบเดียวจาก 20 ใบ
 * คือการเสียเวลาที่ระบบรู้ล่วงหน้าอยู่แล้ว
 *
 * ถามจาก `availableTransitions` รายใบ ซึ่งเป็นตัวเดียวกับที่หน้างานเดี่ยวใช้
 * จึงเป็นไปไม่ได้ที่หน้าจอเป็นชุดจะเสนอปุ่มที่หน้างานเดี่ยวไม่มี
 */
export async function bulkTransitionOptions(
  ctx: TenantContext,
  itemKeys: readonly string[],
): Promise<BulkTransitionOption[]> {
  const { items } = await loadScope(ctx, itemKeys);
  if (ctx.actorId === null) return [];

  const byName = new Map<string, { eligible: number; fields: Set<string> }>();
  for (const item of items) {
    /*
      ใบที่โปรเจกต์ยังไม่ได้ผูก workflow โยน `NoWorkflowError` — ไม่ควรทำให้
      ทั้งรายการว่างเปล่า เพราะใบอื่นในชุดยังมีปุ่มให้กดตามปกติ
    */
    let list: Awaited<ReturnType<typeof availableTransitions>>;
    try {
      list = await availableTransitions(ctx, item.id, ctx.actorId);
    } catch {
      continue;
    }
    for (const t of list) {
      const entry = byName.get(t.name) ?? { eligible: 0, fields: new Set<string>() };
      entry.eligible += 1;
      for (const f of t.requiredFields) entry.fields.add(f);
      byName.set(t.name, entry);
    }
  }

  return [...byName.entries()]
    .map(([name, v]) => ({ name, eligible: v.eligible, requiredFields: [...v.fields].sort() }))
    .sort((a, b) => b.eligible - a.eligible || a.name.localeCompare(b.name, 'th'));
}

/**
 * กดปุ่มเดียวกันกับงานหลายใบ
 *
 * **ล้มทีละใบ ไม่ล้มทั้งรอบ** — ใบที่ตัวตรวจปฏิเสธไม่ควรทำให้อีก 49 ใบไม่ขยับ
 * ข้อยกเว้นคือความผิดพลาดที่เป็นของ **คำขอ** (ไม่มีสิทธิ์ · เกินเพดาน ·
 * ผลการแก้ไขที่ไม่มีอยู่จริง) ซึ่งโยนทั้งชุดก่อนแตะใบไหน เพราะผลลัพธ์ที่อ่านว่า
 * "ทุกใบล้ม" จะชี้ไปที่งาน ทั้งที่ปัญหาอยู่ที่ช่องที่กรอก
 */
export async function bulkTransitionWorkItems(
  ctx: TenantContext,
  itemKeys: readonly string[],
  input: BulkTransitionInput,
): Promise<BulkTransitionResult> {
  const wanted = input.transitionName.trim();
  if (wanted === '') throw new NothingSelectedError('ยังไม่ได้เลือกว่าจะกดปุ่มไหน');

  const { keys, items } = await loadScope(ctx, itemKeys);
  const actorId = ctx.actorId;
  if (actorId === null) throw new NothingSelectedError('ไม่ทราบว่าใครเป็นผู้กด');

  /*
    ตรวจว่าผลการแก้ไขที่กรอกมามีอยู่จริง **ก่อนแตะใบไหน**

    `applyTransition` โยน `UnknownResolutionError` อยู่แล้ว แต่ถ้าปล่อยให้โยน
    รายใบ ใบแรก ๆ ที่ไม่ต้องใช้ค่านี้จะขยับไปก่อน แล้วผู้ใช้ได้ผลปนกันที่
    อ่านไม่ออกว่าตกลงค่าที่กรอกผิดหรืองานมีปัญหา
  */
  const resolutionName = input.resolutionName ?? null;
  if (resolutionName !== null && resolutionName.trim() !== '') {
    const found = await tenantScoped(ctx).resolution.findFirst({
      where: { name: resolutionName.trim() },
      select: { id: true },
    });
    if (found === null) {
      throw new NothingSelectedError(`ไม่รู้จักผลการแก้ไข "${resolutionName.trim()}"`);
    }
  }

  const byKey = new Map(items.map((i) => [i.itemKey, i]));
  const results: BulkTransitionItemResult[] = [];

  for (const key of keys) {
    const item = byKey.get(key);
    if (item === undefined) {
      results.push({ itemKey: key, outcome: 'not-found' });
      continue;
    }

    try {
      /*
        หา transition ที่ชื่อตรงกัน **จากรายการที่ใบนี้กดได้จริง**

        ไม่ใช่ค้นจากตาราง `workflow_transition` ตรง ๆ เพราะรายการที่กดได้
        ผ่านเงื่อนไขของ engine มาแล้ว (ผู้กดอยู่กลุ่มไหน · งานมีผู้รับหรือยัง)
        ใบที่หาไม่เจอจึงได้เหตุผลที่ถูกต้อง แทนที่จะเจอ 422 ตอนกด
      */
      const list = await availableTransitions(ctx, item.id, actorId);
      const target = list.find((t) => t.name === wanted);
      if (target === undefined) {
        const names = list.map((t) => t.name);
        results.push({
          itemKey: key,
          outcome: 'failed',
          /*
            ไม่ใส่คีย์ไว้ในเหตุผล — ผู้เรียกรู้อยู่แล้วว่านี่คือผลของใบไหน
            และหน้าจอแสดงคีย์ไว้ข้าง ๆ · การใส่ซ้ำทำให้อ่านเป็น
            "SD-13 — SD-13 ไม่มีปุ่ม…" และทำให้เหตุผลของใบที่ล้มด้วย
            เรื่องเดียวกันกลายเป็นข้อความคนละแบบ จนรวมกลุ่มไม่ได้
          */
          reason:
            names.length === 0
              ? 'ตอนนี้ยังกดปุ่มอะไรกับเรื่องนี้ไม่ได้เลย'
              : `ไม่มีปุ่ม "${wanted}" จากสถานะปัจจุบัน — ที่กดได้คือ ${names.join(' · ')}`,
        });
        continue;
      }

      const before = await tenantScoped(ctx).workItem.findUnique({
        where: { id: item.id },
        select: { status: { select: { name: true } } },
      });

      const applied = await applyTransition(ctx, item.id, target.id, actorId, {
        resolutionName,
        changeRisk: await riskFor(ctx, item.itemKey),
      });

      const after = await tenantScoped(ctx).workflowStatus.findUnique({
        where: { id: applied.toStatusId },
        select: { name: true },
      });

      // ดัชนีค้นหาตามหลังได้ · ล้มที่นี่ไม่ควรทำให้การเปลี่ยนที่สำเร็จแล้วดูเหมือนล้ม
      await indexWorkItem(ctx, item.id).catch(() => undefined);

      results.push({
        itemKey: key,
        outcome: 'changed',
        ...(before?.status.name === undefined ? {} : { from: before.status.name }),
        ...(after?.name === undefined ? {} : { to: after.name }),
      });
    } catch (e) {
      results.push({
        itemKey: key,
        outcome: 'failed',
        reason: e instanceof Error ? e.message : 'เปลี่ยนสถานะไม่สำเร็จ',
      });
    }
  }

  return {
    requested: keys.length,
    changed: results.filter((r) => r.outcome === 'changed').length,
    failed: results.filter((r) => r.outcome !== 'changed').length,
    items: results,
  };
}
