/**
 * แถวที่ชี้ไปหาองค์กรที่ไม่มีอยู่แล้ว
 *
 * `notification` เคยรั่วแบบนี้ 170 แถวโดยไม่มีใครเห็น เพราะทุกคิวรีกรองด้วย
 * id ของคนที่ล็อกอินอยู่ แถวกำพร้าจึงไม่โผล่ที่ไหน · CLAUDE.md §8 สรุปไว้ว่า
 * **ทุกคอลัมน์ที่เก็บ id ของตารางอื่น ต้องมี relation ในสคีมา พร้อม `onDelete`
 * ที่ตั้งใจ** และด่านต้องอยู่ที่สคีมา ไม่ใช่ให้ทุกเทสต์จำเอง
 *
 * ตอนไล่ดูว่ากฎนั้นถูกบังคับจริงไหม พบว่ามัน **ไม่ถูกบังคับเลยสักที่** —
 * `sla_calendar` ไม่มี foreign key สักตัว และ 8 จาก 10 ใบชี้ไปหาองค์กร
 * ที่ถูกลบไปแล้ว ลาก `sla_holiday` กำพร้าไปด้วย 64 แถว · ต้นเหตุคือ
 * `seed.ts` ลบตามลำดับเองแต่ไม่เคยแตะตาราง SLA และ `tenant.delete`
 * ก็กวาดไม่ได้เพราะไม่มี FK ให้ cascade
 *
 * ## ด่านนี้ตรวจสองเรื่องที่ไม่เหมือนกัน
 *
 *   1. **ตอนนี้มีแถวกำพร้าไหม** — ต้องเป็นศูนย์ · ข้อนี้จับ "ของที่หลุดแล้ว"
 *   2. **ตารางไหนบ้างที่ยังไม่มี FK ให้ cascade** — ตรึงไว้ที่ค่าที่วัดได้จริง
 *      ในวันที่เขียน ลดได้เสมอ เพิ่มไม่ได้ · ข้อนี้จับ "รูที่ยังเปิดอยู่"
 *
 * ข้อ 2 ไม่ได้บังคับให้แก้ทันที เพราะการเพิ่ม FK ของ `tenant_id` คือการแตะ
 * ขอบเขตองค์กร ซึ่ง §4 กำหนดว่าต้องผ่าน Tech Lead · สิ่งที่ด่านนี้ทำได้
 * โดยไม่ต้องรออนุมัติ คือ **กันไม่ให้ตารางที่ 28 เข้ามาเงียบ ๆ**
 *
 * **ยังไม่ครอบ**: ด่านนี้อ่านสภาพฐานข้อมูล ณ เวลาที่มันรัน · ไฟล์เทสต์ที่รัน
 * *หลัง* มันแล้วทิ้งแถวกำพร้าไว้ จะไม่ถูกจับในรอบเดียวกัน — จะเห็นในรอบถัดไป
 * แทน · และมันตรวจเฉพาะ `tenant_id` ไม่ใช่ id ของตารางอื่นทุกคอลัมน์
 *
 * รายการตารางมาจาก `information_schema` ไม่ใช่จากรายการที่คนพิมพ์ไว้ —
 * รายการที่คนดูแลด้วยมือพังเงียบเสมอในวันที่มีคนเพิ่มตารางใหม่ และรายการ
 * "เจ็ดตารางที่ไม่มีข้อมูลตัวอย่าง" ในเอกสารสถานะก็เคยพลาดแบบนั้นมาแล้ว
 */
import { afterAll, describe, expect, it } from 'vitest';

import { prismaClient as prisma } from '../src/infrastructure/prisma/client';

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * ตารางที่ `tenant_id` ยังไม่มี foreign key — วัดได้จริงเมื่อ 2569-09-11
 *
 * **ตั้งจากค่าที่วัดได้ บวกศูนย์** · ตั้งเผื่อเท่ากับปิดด่านไว้ล่วงหน้า
 * ตามจำนวนที่เผื่อ (บทเรียน `MAX_UNCHECKABLE = 40` ที่ของจริงมีแค่ 1)
 */
const KNOWN_NO_FK: readonly string[] = [
  'field_config',
  'group_member',
  'login_attempt',
  'notification_delivery',
  'permission_grant',
  'project_counter',
  'session',
  'sla_calendar',
  'sla_calendar_year',
  'sla_event',
  'sla_goal',
  'sla_holiday',
  'sla_policy',
  'transition_rule',
  'work_item_article',
  'work_item_attachment',
  'work_item_comment',
  'work_item_field_value',
  'work_item_history',
  'work_item_key_alias',
  'work_item_link',
  'work_item_sla',
  'work_item_vote',
  'work_item_watcher',
  'workflow_scheme',
  'workflow_status',
  'workflow_transition',
];

/** ตารางที่มีคอลัมน์ `tenant_id` ทั้งหมด — ถามจากฐานข้อมูล ไม่ใช่จากรายการที่พิมพ์ไว้ */
async function tablesWithTenantId(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT c.TABLE_NAME AS table_name
    FROM information_schema.COLUMNS c
    WHERE c.TABLE_SCHEMA = DATABASE() AND c.COLUMN_NAME = 'tenant_id'
    ORDER BY c.TABLE_NAME`;
  return rows.map((r) => r.table_name);
}

/** ตารางที่ `tenant_id` **ไม่มี** foreign key */
async function tablesWithoutFk(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT c.TABLE_NAME AS table_name
    FROM information_schema.COLUMNS c
    LEFT JOIN information_schema.KEY_COLUMN_USAGE k
      ON k.TABLE_SCHEMA = c.TABLE_SCHEMA
     AND k.TABLE_NAME = c.TABLE_NAME
     AND k.COLUMN_NAME = c.COLUMN_NAME
     AND k.REFERENCED_TABLE_NAME IS NOT NULL
    WHERE c.TABLE_SCHEMA = DATABASE()
      AND c.COLUMN_NAME = 'tenant_id'
      AND k.COLUMN_NAME IS NULL
    ORDER BY c.TABLE_NAME`;
  return rows.map((r) => r.table_name);
}

describe('แถวกำพร้าที่ชี้ไปหาองค์กรที่ถูกลบแล้ว', () => {
  /*
    **probe ทั้งสองทิศ** — ตัวสแกนที่คืนรายการว่างจะทำให้ทุกเคสข้างล่าง
    ผ่านหมดโดยไม่ได้ตรวจอะไร (เซ็ตว่างเท่ากับเซ็ตว่าง)
  */
  it('probe · หาตารางที่มี tenant_id เจอจริง', async () => {
    const all = await tablesWithTenantId();
    expect(all.length, 'ตัวสแกนหาตารางไม่เจอ').toBeGreaterThan(30);
    expect(all).toContain('work_item');
  });

  it('probe · ตารางที่ไม่มี tenant_id ไม่ถูกนับเข้ามา', async () => {
    expect(await tablesWithTenantId()).not.toContain('tenant');
  });

  it('probe · ตารางที่มี FK จริง ไม่อยู่ในรายการที่ไม่มี FK', async () => {
    // `work_item` ประกาศ relation ของ tenant ไว้ จึงต้องมี FK จริงในฐานข้อมูล
    expect(await tablesWithoutFk()).not.toContain('work_item');
  });

  /**
   * **ไม่มีแถวไหนชี้ไปหาองค์กรที่ไม่มีอยู่แล้ว**
   *
   * ข้อนี้คือด่านจริง · แถวกำพร้าไม่โผล่ในหน้าจอไหนเลย เพราะทุกคิวรีกรอง
   * ด้วยองค์กรของคนที่ล็อกอินอยู่ — ต้อง `LEFT JOIN` แล้วนับเองถึงจะรู้ว่ามี
   */
  it('**ไม่มีแถวกำพร้าสักแถวในทุกตารางที่มี tenant_id**', async () => {
    const tables = await tablesWithTenantId();
    const dirty: string[] = [];
    for (const t of tables) {
      /*
        ชื่อตารางมาจาก `information_schema` ของฐานข้อมูลตัวเอง ไม่ได้มาจาก
        ผู้ใช้ · กรองด้วย regex อีกชั้นก่อนต่อสตริง เพราะตัวต่อสตริงที่
        "ปลอดภัยเพราะแหล่งข้อมูลเชื่อถือได้" คือรูปแบบที่กลายเป็นช่องโหว่
        ในวันที่แหล่งข้อมูลเปลี่ยน
      */
      if (!/^[a-z_]+$/.test(t)) throw new Error(`ชื่อตารางผิดรูป: ${t}`);
      const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*) AS n FROM \`${t}\` x
         LEFT JOIN tenant te ON te.id = x.tenant_id WHERE te.id IS NULL`,
      );
      const n = Number(rows[0]?.n ?? 0);
      if (n > 0) dirty.push(`${t}: ${String(n)} แถว`);
    }
    expect(
      dirty,
      ['แถวที่ชี้ไปหาองค์กรที่ไม่มีอยู่แล้ว:', ...dirty].join('\n'),
    ).toEqual([]);
  }, 120_000);

  /**
   * **รายการตารางที่ยังไม่มี FK ห้ามยาวขึ้น**
   *
   * ลดได้เสมอ (เพิ่ม FK แล้วเอาชื่อออกจากรายการ) แต่เพิ่มไม่ได้ —
   * ตารางใหม่ที่มี `tenant_id` โดยไม่มี relation จะทำให้ข้อนี้แดงทันที
   */
  it('**ไม่มีตารางใหม่ที่ tenant_id ไม่มี FK**', async () => {
    const actual = await tablesWithoutFk();
    const added = actual.filter((t) => !KNOWN_NO_FK.includes(t));
    expect(
      added,
      `ตารางใหม่ที่ \`tenant_id\` ไม่มี foreign key — ประกาศ relation ใน schema.prisma พร้อม onDelete:\n${added.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * รายการที่หดลงแล้วต้องถูกตัดออกจริง — มิฉะนั้นมันกลายเป็นรายการที่
   * ไม่มีใครดูแล แล้ว "เหลืออีก 27" จะค้างอยู่ตลอดแม้แก้ไปหมดแล้ว
   */
  it('รายการที่ตรึงไว้ ต้องไม่มีชื่อที่แก้ไปแล้ว', async () => {
    const actual = await tablesWithoutFk();
    const stale = KNOWN_NO_FK.filter((t) => !actual.includes(t));
    expect(stale, `ตารางที่มี FK แล้ว แต่ยังค้างในรายการ:\n${stale.join('\n')}`).toEqual([]);
  });
});
