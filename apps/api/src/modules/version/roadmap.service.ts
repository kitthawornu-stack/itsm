/**
 * แผนงานบนเส้นเวลา — ต่อฐานข้อมูล
 *
 * รวบรวมสิ่งที่ **มีวันที่จริง** ในโปรเจกต์หนึ่ง (รุ่นและรอบการทำงาน)
 * แล้วส่งให้เอนจินวาง · และหาการขวางข้ามรุ่นจากลิงก์ `BLOCKS` ของงานจริง
 *
 * **งานทั่วไปไม่อยู่บนเส้นเวลา** — ไม่มีใครกรอก `dueDate` เลยสักใบในระบบนี้
 * การวางมันจึงเป็นการแต่งข้อมูลขึ้นมาทั้งหมด · เขียนไว้ตรงนี้เพื่อไม่ให้ใคร
 * เพิ่มเข้ามาโดยคิดว่าลืม
 */
import { systemClock, toUtcDate, type TenantContext, type UtcDate } from '@itsm/types';

import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan } from '../permission';
import {
  UNPLACED_LABEL,
  crossVersionBlocks,
  placeOnTimeline,
  type BlockLink,
  type TimelineEntry,
} from './roadmap';
import { ProjectNotFoundForVersionError } from './version.service';

/** ฟิลด์ของรุ่นที่ต้องใช้ตอนไล่การขวาง — ประกาศครั้งเดียว ใช้ทั้งสองฝั่งของลิงก์ */
const VERSION_PICK = { select: { id: true, name: true, releaseDate: true } } as const;

/** กี่วันย้อนหลังและไปข้างหน้า เมื่อผู้เรียกไม่ได้ระบุกรอบ */
export const DEFAULT_WINDOW_DAYS = 180;
const DAY_MS = 86_400_000;

export interface RoadmapView {
  from: string;
  to: string;
  bars: Array<{
    key: string;
    label: string;
    kind: string;
    done: boolean;
    startRatio: number;
    endRatio: number;
    milestone: boolean;
  }>;
  unplaced: Array<{ key: string; label: string; kind: string; reason: string; reasonLabel: string }>;
  conflicts: Array<{
    blockerKey: string;
    blockerVersionLabel: string;
    blockedKey: string;
    blockedVersionLabel: string;
  }>;
  uncheckable: Array<{ blockerKey: string; blockedKey: string }>;
}

export async function roadmapOf(
  ctx: TenantContext,
  projectKey: string,
  range?: { from?: string | undefined; to?: string | undefined },
  now: UtcDate = systemClock.nowUtc(),
): Promise<RoadmapView> {
  const db = tenantScoped(ctx);
  const project = await db.project.findFirst({ where: { key: projectKey }, select: { id: true } });
  if (project === null) throw new ProjectNotFoundForVersionError(projectKey);
  await assertCan(ctx, project.id, 'BROWSE_PROJECT');

  const parse = (v: string | undefined, fallback: number): UtcDate => {
    if (v === undefined || v.trim() === '') return toUtcDate(new Date(fallback));
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? toUtcDate(new Date(fallback)) : toUtcDate(d);
  };
  const window = {
    from: parse(range?.from, now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS),
    to: parse(range?.to, now.getTime() + DEFAULT_WINDOW_DAYS * DAY_MS),
  };

  const versions = await db.projectVersion.findMany({
    where: { projectId: project.id, archived: false },
    select: { id: true, name: true, startDate: true, releaseDate: true, releasedAt: true },
    orderBy: [{ releaseDate: 'asc' }, { name: 'asc' }],
  });
  const sprints = await db.sprint.findMany({
    where: { projectId: project.id },
    select: { id: true, name: true, plannedStart: true, plannedEnd: true, state: true },
    orderBy: [{ plannedStart: 'asc' }, { name: 'asc' }],
  });

  const entries: TimelineEntry[] = [
    ...versions.map((v) => ({
      key: `v${v.id.toString()}`,
      label: v.name,
      kind: 'version' as const,
      start: v.startDate === null ? null : toUtcDate(v.startDate),
      end: v.releaseDate === null ? null : toUtcDate(v.releaseDate),
      done: v.releasedAt !== null,
    })),
    ...sprints.map((s) => ({
      key: `s${s.id.toString()}`,
      label: s.name,
      kind: 'sprint' as const,
      start: s.plannedStart === null ? null : toUtcDate(s.plannedStart),
      end: s.plannedEnd === null ? null : toUtcDate(s.plannedEnd),
      done: s.state === 'completed',
    })),
  ];

  const placed = placeOnTimeline(entries, window);

  /*
    **หาการขวางจากลิงก์จริง แล้วยกขึ้นไปที่ระดับรุ่น**

    เก็บทิศเดียว (`BLOCKS`) แล้วคำนวณคู่ตรงข้ามตอนอ่าน — เหมือน `linksOf` ·
    การอ่านทั้งสองทิศจะนับคู่เดียวกันสองครั้ง แล้วรายงานจะบอกว่ามีปัญหา
    มากกว่าความจริงเท่าตัว
  */
  const links = await db.workItemLink.findMany({
    where: {
      type: 'BLOCKS',
      OR: [{ source: { projectId: project.id } }, { target: { projectId: project.id } }],
    },
    select: {
      source: { select: { itemKey: true, versions: { select: { version: VERSION_PICK } } } },
      target: { select: { itemKey: true, versions: { select: { version: VERSION_PICK } } } },
    },
  });

  /*
    งานหนึ่งใบอยู่ได้หลายรุ่น · ใช้รุ่นที่ **ปล่อยเร็วที่สุด** เป็นตัวแทน
    เพราะนั่นคือรุ่นแรกที่ของชิ้นนั้นต้องพร้อม — ถ้าใช้รุ่นล่าสุด
    การขวางที่เป็นปัญหาจริงจะถูกกลบ
  */
  const earliest = (
    rows: Array<{ version: { id: bigint; name: string; releaseDate: Date | null } }>,
  ): BlockLink['blockerVersion'] => {
    let best: { id: bigint; name: string; releaseDate: Date | null } | null = null;
    for (const r of rows) {
      if (best === null) best = r.version;
      else if (best.releaseDate === null) best = r.version;
      else if (r.version.releaseDate !== null && r.version.releaseDate < best.releaseDate) {
        best = r.version;
      }
    }
    if (best === null) return null;
    return {
      key: `v${best.id.toString()}`,
      label: best.name,
      releaseDate: best.releaseDate === null ? null : toUtcDate(best.releaseDate),
    };
  };

  const blockLinks: BlockLink[] = links.map((l) => ({
    blockerKey: l.source.itemKey,
    blockerVersion: earliest(l.source.versions),
    blockedKey: l.target.itemKey,
    blockedVersion: earliest(l.target.versions),
  }));
  const blocks = crossVersionBlocks(blockLinks);

  return {
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    bars: placed.bars,
    unplaced: placed.unplaced.map((u) => ({ ...u, reasonLabel: UNPLACED_LABEL[u.reason] })),
    conflicts: blocks.conflicts,
    uncheckable: blocks.uncheckable,
  };
}
