/**
 * คลังความรู้ที่ผูกกับตั๋ว
 *
 * ขอบเขตตั้งแต่ต้น: **ไม่ใช่ระบบเอกสารทั่วไป** — Confluence-class wiki
 * ถูกตัดออกโดยตั้งใจใน `jira-parity-checklist.md` · คุณค่าที่แท้จริงคือคำตอบ
 * ที่ทีมตอบซ้ำทุกสัปดาห์ ย้ายมาอยู่ที่เดียวแล้วแนบเข้าตั๋วได้
 *
 * ## ทำไมค้นด้วย `LIKE` ไม่ใช่ OpenSearch
 *
 * CLAUDE.md ห้าม MySQL **FULLTEXT** สำหรับการค้นหา เพราะ `standard` tokenizer
 * ตัดคำไทยไม่ได้ — วัดจริงแล้วคืนทั้งประโยคเป็น 1 token
 *
 * **`LIKE '%คำ%'` ไม่ใช่ FULLTEXT** มันเทียบสตริงตรง ๆ จึงทำงานกับภาษาไทยได้
 * โดยไม่ต้องตัดคำเลย · ราคาที่จ่ายคือ full scan ซึ่งยอมรับได้เพราะ
 * **คลังความรู้ของทีมไอที 10 คนมีหลักสิบถึงหลักร้อยบทความ ไม่ใช่หลักหมื่น**
 * ต่างจากตารางงานที่มี 10,000 แถวตั้งแต่วันแรก
 *
 * เมื่อไรต้องเปลี่ยน: เมื่อจำนวนบทความเกินหลักพัน หรือเมื่อผู้ใช้ต้องการ
 * การจัดอันดับความเกี่ยวข้อง — สองอย่างนี้ `LIKE` ทำไม่ได้ทั้งคู่
 * และเป็นสัญญาณที่วัดได้ ไม่ใช่ความรู้สึก
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { auditedTransaction, change } from '../../infrastructure/audit/audited-transaction';
import { tenantScoped } from '../../infrastructure/prisma/tenant-scope';
import { assertCan, browsableProjectIds, can } from '../permission';

/** ยาวสุดที่รับ — ยาวกว่านี้ควรเป็นเอกสารแนบ ไม่ใช่บทความ */
export const ARTICLE_MAX = 20_000;
/** จำนวนผลค้นหาสูงสุด — คนอ่านสามอันแรกเสมอ */
export const ARTICLE_SEARCH_MAX = 10;

export class ArticleNotFoundError extends Error {
  constructor() {
    super('ไม่พบบทความที่ระบุ');
    this.name = 'ArticleNotFoundError';
  }
}

export class EmptyArticleError extends Error {
  constructor(readonly what: 'title' | 'body') {
    super(what === 'title' ? 'ต้องตั้งชื่อบทความ' : 'บทความว่างเปล่า');
    this.name = 'EmptyArticleError';
  }
}

export interface ArticleView {
  id: string;
  title: string;
  body: string;
  author: string;
  isPublished: boolean;
  updatedAt: string;
}

export interface ArticleHit {
  id: string;
  title: string;
  /** ตัดมาให้พออ่านว่าเกี่ยวไหม — เต็มฉบับอยู่ในหน้าบทความ */
  excerpt: string;
  isPublished: boolean;
}

function textOf(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body === null || typeof body !== 'object') return '';
  const doc = body as Record<string, unknown>;
  return typeof doc['text'] === 'string' ? doc['text'] : '';
}

/**
 * ผู้ใช้คนนี้เห็นบทความที่ยังไม่เผยแพร่ได้ไหม
 *
 * เกณฑ์คือ `VIEW_INTERNAL_COMMENT` บนโปรเจกต์ใดโปรเจกต์หนึ่งที่เปิดดูได้ —
 * ไม่ใช่สิทธิ์ใหม่ เพราะ "เห็นของที่ทีมยังไม่พร้อมให้ลูกค้าอ่าน" เป็นคำถาม
 * เดียวกันกับบันทึกภายใน · สิทธิ์ใหม่ที่ไม่มีใครตั้งค่า คือสิทธิ์ที่ไม่มีผล
 */
async function seesDrafts(ctx: TenantContext): Promise<boolean> {
  for (const pid of await browsableProjectIds(ctx)) {
    if (await can(ctx, pid, 'VIEW_INTERNAL_COMMENT')) return true;
  }
  return false;
}

/**
 * ค้นบทความ
 *
 * **ผู้แจ้งเห็นเฉพาะที่เผยแพร่แล้ว** — บทความที่เขียนค้างไว้ครึ่งทางไปโผล่ให้
 * ลูกค้าอ่าน เสียหายกว่าไม่มีบทความเลย เพราะมันดูเหมือนคำตอบทางการ
 */
export async function searchArticles(
  ctx: TenantContext,
  term: string,
  limit = ARTICLE_SEARCH_MAX,
): Promise<ArticleHit[]> {
  const q = term.trim();
  if (q === '') return [];
  const drafts = await seesDrafts(ctx);

  const rows = await tenantScoped(ctx).knowledgeArticle.findMany({
    where: {
      deletedAt: null,
      ...(drafts ? {} : { isPublished: true }),
      /*
        ค้นทั้งชื่อและเนื้อหา

        `body` เป็นคอลัมน์ JSON · บน MySQL ต้องระบุ `path` ให้ Prisma รู้ว่า
        จะเทียบคีย์ไหน — เขียน `string_contains` เปล่า ๆ แล้วมันไปเทียบกับ
        เอกสารทั้งก้อนซึ่งไม่เคยตรงกับคำค้นเลย และ **ไม่มี error ให้เห็น**
        มันแค่คืนศูนย์ผลลัพธ์เหมือนไม่มีบทความไหนเกี่ยว
      */
      OR: [
        { title: { contains: q } },
        { body: { path: '$.text', string_contains: q } },
      ],
    },
    select: { id: true, title: true, body: true, isPublished: true },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(Math.max(1, limit), ARTICLE_SEARCH_MAX),
  });

  return rows.map((r) => {
    const text = textOf(r.body);
    return {
      id: r.id.toString(),
      title: r.title,
      excerpt: text.length > 200 ? `${text.slice(0, 200)}…` : text,
      isPublished: r.isPublished,
    };
  });
}

/** อ่านบทความหนึ่งฉบับ */
export async function readArticle(ctx: TenantContext, id: bigint): Promise<ArticleView> {
  const row = await tenantScoped(ctx).knowledgeArticle.findFirst({
    where: { id, deletedAt: null },
    include: { author: { select: { displayName: true } } },
  });
  // ที่ยังไม่เผยแพร่ ตอบเหมือนไม่มีอยู่สำหรับคนที่ไม่มีสิทธิ์เห็น
  if (row === null) throw new ArticleNotFoundError();
  if (!row.isPublished && !(await seesDrafts(ctx))) throw new ArticleNotFoundError();

  return {
    id: row.id.toString(),
    title: row.title,
    body: textOf(row.body),
    author: row.author.displayName,
    isPublished: row.isPublished,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface ArticleInput {
  title: string;
  body: string;
  isPublished?: boolean;
}

/** เขียนบทความใหม่ — ต้องเป็นผู้ดูแล tenant หรือทีมที่เห็นบันทึกภายใน */
export async function createArticle(
  ctx: TenantContext,
  input: ArticleInput,
  now: UtcDate = systemClock.nowUtc(),
): Promise<{ id: bigint }> {
  const actorId = ctx.actorId;
  if (actorId === null) throw new ArticleNotFoundError();
  const title = input.title.trim().slice(0, 500);
  const body = input.body.trim().slice(0, ARTICLE_MAX);
  if (title === '') throw new EmptyArticleError('title');
  if (body === '') throw new EmptyArticleError('body');

  const published = input.isPublished ?? false;
  return auditedTransaction(ctx, 'knowledge.create', async (tx) => {
    const row = await tx.knowledgeArticle.create({
      data: {
        tenantId: ctx.tenantId,
        title,
        body: { text: body },
        authorId: actorId,
        isPublished: published,
        // เวลาเผยแพร่ตั้งตอนเผยแพร่จริง ไม่ใช่ตอนสร้าง — สองอย่างนี้ต่างกัน
        publishedAt: published ? now : null,
      },
      select: { id: true },
    });
    return {
      result: { id: row.id },
      audit: [
        {
          kind: 'system',
          action: 'knowledge.create',
          entityType: 'knowledge_article',
          entityId: row.id.toString(),
          payload: { title, isPublished: published },
        },
      ],
    };
  });
}

/** แก้บทความ — เผยแพร่/ถอนเผยแพร่ผ่านทางนี้ด้วย */
export async function updateArticle(
  ctx: TenantContext,
  id: bigint,
  input: Partial<ArticleInput>,
  now: UtcDate = systemClock.nowUtc(),
): Promise<void> {
  const row = await tenantScoped(ctx).knowledgeArticle.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, title: true, isPublished: true },
  });
  if (row === null) throw new ArticleNotFoundError();

  const data: Record<string, unknown> = {};
  const audit: Array<{ field: string; from: string; to: string }> = [];

  if (input.title !== undefined) {
    const title = input.title.trim().slice(0, 500);
    if (title === '') throw new EmptyArticleError('title');
    if (title !== row.title) {
      data['title'] = title;
      audit.push({ field: 'title', from: row.title, to: title });
    }
  }
  if (input.body !== undefined) {
    const body = input.body.trim().slice(0, ARTICLE_MAX);
    if (body === '') throw new EmptyArticleError('body');
    data['body'] = { text: body };
    // เนื้อหาไม่เข้า audit — บทความยาวหลายพันอักขระทำให้ร่องรอยอ่านไม่ออก
    audit.push({ field: 'body', from: '(เนื้อหาเดิม)', to: '(แก้ไขแล้ว)' });
  }
  if (input.isPublished !== undefined && input.isPublished !== row.isPublished) {
    data['isPublished'] = input.isPublished;
    /*
      ถอนเผยแพร่ **ไม่ล้าง `publishedAt`**

      มันคือเวลาที่เคยเผยแพร่จริง ซึ่งเป็นประวัติของเหตุการณ์ที่เกิดไปแล้ว ·
      ค่าที่กลายเป็น null เพราะเหตุการณ์เกิดขึ้นแล้ว ไม่ใช่ที่เก็บประวัติของ
      เหตุการณ์นั้น (บทเรียนของ `breachAt` / `breachedAt` — CLAUDE.md §8)
    */
    if (input.isPublished) data['publishedAt'] = now;
    audit.push({
      field: 'isPublished',
      from: String(row.isPublished),
      to: String(input.isPublished),
    });
  }

  if (audit.length === 0) return;

  await auditedTransaction(ctx, 'knowledge.update', async (tx) => {
    await tx.knowledgeArticle.update({ where: { id }, data: data as never });
    return {
      result: undefined,
      audit: audit.map((a) => ({
        kind: 'system' as const,
        action: 'knowledge.update',
        entityType: 'knowledge_article',
        entityId: id.toString(),
        payload: { field: a.field, from: a.from, to: a.to },
      })),
    };
  });
}

/**
 * ลบบทความ — soft delete
 *
 * ตั๋วที่เคยแนบบทความนี้ต้องยังตอบได้ว่าเคยแนบอะไร · การลบจริงจะทำให้
 * ประวัติของตั๋วชี้ไปที่ความว่างเปล่า
 */
export async function deleteArticle(
  ctx: TenantContext,
  id: bigint,
  now: UtcDate = systemClock.nowUtc(),
): Promise<void> {
  const row = await tenantScoped(ctx).knowledgeArticle.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, title: true },
  });
  if (row === null) throw new ArticleNotFoundError();

  await auditedTransaction(ctx, 'knowledge.delete', async (tx) => {
    await tx.knowledgeArticle.update({ where: { id }, data: { deletedAt: now } });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'knowledge.delete',
          entityType: 'knowledge_article',
          entityId: id.toString(),
          payload: { title: row.title },
        },
      ],
    };
  });
}

export interface AttachedArticle {
  id: string;
  title: string;
  helpful: boolean | null;
  addedBy: string;
}

/**
 * แนบบทความเข้ากับตั๋ว
 *
 * ต้องมี `EDIT_ITEM` — การแนบบทความเป็นการบอกว่า "เรื่องนี้แก้ด้วยวิธีนี้"
 * ซึ่งเป็นการให้ข้อมูลของงาน ไม่ใช่การอ่านเฉย ๆ
 */
export async function attachArticle(
  ctx: TenantContext,
  itemKey: string,
  articleId: bigint,
): Promise<void> {
  const actorId = ctx.actorId;
  if (actorId === null) throw new ArticleNotFoundError();

  const allowed = await browsableProjectIds(ctx);
  const item =
    allowed.length === 0
      ? null
      : await tenantScoped(ctx).workItem.findFirst({
          where: { itemKey: itemKey.trim(), projectId: { in: allowed } },
          select: { id: true, projectId: true },
        });
  if (item === null) throw new ArticleNotFoundError();
  await assertCan(ctx, item.projectId, 'EDIT_ITEM');

  // บทความที่มองไม่เห็น แนบไม่ได้ — และตอบเหมือนไม่มีอยู่
  const article = await readArticle(ctx, articleId);

  const existing = await tenantScoped(ctx).workItemArticle.findFirst({
    where: { workItemId: item.id, articleId },
    select: { articleId: true },
  });
  // แนบซ้ำไม่ใช่ความผิดพลาด และต้องไม่เขียนประวัติเพิ่ม
  if (existing !== null) return;

  await auditedTransaction(ctx, 'knowledge.attach', async (tx) => {
    await tx.workItemArticle.create({
      data: { tenantId: ctx.tenantId, workItemId: item.id, articleId, addedById: actorId },
    });
    return {
      result: undefined,
      audit: [change(item.id, '__article__', null, article.title)],
    };
  });
}

/** ถอดบทความออกจากตั๋ว */
export async function detachArticle(
  ctx: TenantContext,
  itemKey: string,
  articleId: bigint,
): Promise<void> {
  const allowed = await browsableProjectIds(ctx);
  const item =
    allowed.length === 0
      ? null
      : await tenantScoped(ctx).workItem.findFirst({
          where: { itemKey: itemKey.trim(), projectId: { in: allowed } },
          select: { id: true, projectId: true },
        });
  if (item === null) throw new ArticleNotFoundError();
  await assertCan(ctx, item.projectId, 'EDIT_ITEM');

  const link = await tenantScoped(ctx).workItemArticle.findFirst({
    where: { workItemId: item.id, articleId },
    include: { article: { select: { title: true } } },
  });
  if (link === null) return;

  await auditedTransaction(ctx, 'knowledge.detach', async (tx) => {
    await tx.workItemArticle.delete({
      where: { workItemId_articleId: { workItemId: item.id, articleId } },
    });
    return {
      result: undefined,
      audit: [change(item.id, '__article__', link.article.title, null)],
    };
  });
}

/**
 * บอกว่าบทความช่วยแก้เรื่องนี้ได้ไหม
 *
 * เป็นข้อมูลเดียวที่บอกได้ว่าบทความไหนคุ้มค่าที่จะดูแลต่อ และบทความไหน
 * เขียนไว้แล้วไม่มีใครใช้ · `null` = ยังไม่มีใครบอก ต่างจาก `false`
 * ที่แปลว่าลองแล้วไม่ช่วย
 */
export async function rateArticle(
  ctx: TenantContext,
  itemKey: string,
  articleId: bigint,
  helpful: boolean,
): Promise<void> {
  const allowed = await browsableProjectIds(ctx);
  const item =
    allowed.length === 0
      ? null
      : await tenantScoped(ctx).workItem.findFirst({
          where: { itemKey: itemKey.trim(), projectId: { in: allowed } },
          select: { id: true, projectId: true },
        });
  if (item === null) throw new ArticleNotFoundError();
  await assertCan(ctx, item.projectId, 'BROWSE_PROJECT');

  const link = await tenantScoped(ctx).workItemArticle.findFirst({
    where: { workItemId: item.id, articleId },
    select: { helpful: true },
  });
  if (link === null) throw new ArticleNotFoundError();
  if (link.helpful === helpful) return;

  await auditedTransaction(ctx, 'knowledge.rate', async (tx) => {
    await tx.workItemArticle.update({
      where: { workItemId_articleId: { workItemId: item.id, articleId } },
      data: { helpful },
    });
    return {
      result: undefined,
      audit: [
        {
          kind: 'system',
          action: 'knowledge.rate',
          entityType: 'knowledge_article',
          entityId: articleId.toString(),
          payload: { itemKey: itemKey.trim(), helpful },
        },
      ],
    };
  });
}

/** บทความที่แนบกับตั๋วใบนี้ */
export async function articlesOf(
  ctx: TenantContext,
  workItemId: bigint,
): Promise<AttachedArticle[]> {
  const drafts = await seesDrafts(ctx);
  const rows = await tenantScoped(ctx).workItemArticle.findMany({
    where: { workItemId },
    include: {
      article: { select: { id: true, title: true, isPublished: true, deletedAt: true } },
      addedBy: { select: { displayName: true } },
    },
    orderBy: { addedAt: 'asc' },
  });

  return rows
    /*
      บทความที่ถูกลบหรือยังไม่เผยแพร่ ต้องไม่โผล่ให้คนที่ไม่มีสิทธิ์เห็น

      กรองตอนอ่าน ไม่ใช่เชื่อว่าตอนแนบกรองไปแล้ว — สถานะเผยแพร่เปลี่ยนได้
      หลังแนบ และการถอนเผยแพร่ต้องมีผลทันทีทุกที่ที่บทความนั้นโผล่
    */
    .filter((r) => r.article.deletedAt === null && (drafts || r.article.isPublished))
    .map((r) => ({
      id: r.article.id.toString(),
      title: r.article.title,
      helpful: r.helpful,
      addedBy: r.addedBy.displayName,
    }));
}
