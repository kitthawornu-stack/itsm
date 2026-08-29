/**
 * อีเมลขาเข้ากับข้อมูลจริง — เทสต์เป็นข้อกำหนด
 *
 * `email-intake.spec.ts` (ในโมดูล) พิสูจน์ว่า *ถ้า* จดหมายหน้าตาแบบนี้เข้ามา
 * จะตัดสินถูก · ไฟล์นี้พิสูจน์คนละเรื่อง: **สิ่งที่ตัดสินไว้ ถูกลงมือทำจริงไหม**
 *
 * ห้าข้อที่ต้องถูก:
 *
 *   1. **อ่านฉบับเดิมซ้ำต้องไม่สร้างตั๋วซ้ำ** — ตัวอ่านที่จำในหน่วยความจำ
 *      จะเริ่มนับใหม่ทุกครั้งที่รีสตาร์ต แล้วสร้างตั๋วซ้ำทั้งกล่อง
 *   2. **จดหมายที่ถูกปฏิเสธต้องมีแถวเก็บไว้** — จดหมายที่ทิ้งเงียบ ๆ คือคำขอ
 *      ที่ไม่มีใครรู้ว่าเคยมี
 *   3. **ตั๋วต้องเป็นของผู้ส่ง ไม่ใช่ของระบบ** — ไม่งั้นตอบไม่ได้ว่าใครแจ้ง
 *      และคนที่ไม่มีสิทธิ์จะแจ้งเรื่องได้เงียบ ๆ
 *   4. **ตอบกลับกลายเป็นความเห็นในเรื่องเดิม ไม่ใช่ตั๋วใบใหม่**
 *   5. **ฉบับหนึ่งที่พังต้องไม่ทำให้อีกยี่สิบฉบับไม่ถูกอ่าน**
 */
import { toUtcDate, type TenantContext } from '@itsm/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prismaClient } from '../src/infrastructure/prisma/client';
import {
  REJECT,
  runEmailIntake,
  type IncomingMail,
  type MailSource,
} from '../src/modules/integration';

const STAMP = String(Date.now()).slice(-6);
const PKEY = `EML${STAMP}`;
const SYSTEM = `no-reply-${STAMP}@itsm.local`;
const NOW = toUtcDate('2026-09-15T03:00:00.000Z');

let tenantId: bigint;
let projectId: bigint;
let ctx: TenantContext;
let senderId: bigint | undefined;
let groupId: bigint | undefined;
let schemeId: bigint | undefined;
let workflowId: bigint | undefined;
let issueTypeName = '';
const senderEmail = `somchai-${STAMP}@example.co.th`;

async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`เก็บกวาดขั้น "${what}" ล้ม:`, e instanceof Error ? e.message : e);
  }
}

/** กล่องเมลปลอม — เคสที่สำคัญที่สุดคือเคสที่ไม่สร้างตั๋ว จึงต้องทดสอบได้โดยไม่มีเซิร์ฟเวอร์ */
function boxOf(mails: IncomingMail[]): MailSource {
  return { fetch: async () => Promise.resolve(mails) };
}

function mail(over: Partial<IncomingMail> = {}): IncomingMail {
  return {
    mailboxId: `box-${STAMP}-1`,
    messageId: `<msg-${STAMP}-1@example.co.th>`,
    from: senderEmail,
    subject: `เครื่องพิมพ์ชั้น 3 ใช้ไม่ได้ ${STAMP}`,
    text: 'กดพิมพ์แล้วไฟกะพริบ ไม่มีกระดาษออกมา',
    inReplyTo: [],
    headers: {},
    ...over,
  };
}

function settings(): Parameters<typeof runEmailIntake>[2] {
  return { systemAddress: SYSTEM, projectKey: PKEY, issueTypeName };
}

beforeAll(async () => {
  tenantId = (await prismaClient.tenant.findFirstOrThrow({ where: { key: 'default' } })).id;

  const scheme = await prismaClient.permissionScheme.create({
    data: { tenantId, name: `ชุดสิทธิ์อีเมล ${STAMP}` },
    select: { id: true },
  });
  schemeId = scheme.id;
  const project = await prismaClient.project.create({
    data: {
      tenantId,
      key: PKEY,
      name: `โปรเจกต์ทดสอบอีเมล ${STAMP}`,
      type: 'SERVICE_DESK',
      permissionSchemeId: scheme.id,
    },
    select: { id: true },
  });
  projectId = project.id;

  const group = await prismaClient.userGroup.create({
    data: { tenantId, name: `eml ${STAMP}` },
    select: { id: true },
  });
  groupId = group.id;
  senderId = (
    await prismaClient.user.create({
      data: { tenantId, email: senderEmail, displayName: `สมชาย ${STAMP}` },
      select: { id: true },
    })
  ).id;
  await prismaClient.groupMember.create({ data: { tenantId, groupId: group.id, userId: senderId } });
  await prismaClient.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: scheme.id, permission: 'BROWSE_PROJECT', groupId: group.id },
      { tenantId, schemeId: scheme.id, permission: 'CREATE_ITEM', groupId: group.id },
      { tenantId, schemeId: scheme.id, permission: 'ADD_COMMENT', groupId: group.id },
    ] as never,
  });

  const wf = await prismaClient.workflow.create({
    data: { tenantId, name: `wf อีเมล ${STAMP}` },
    select: { id: true },
  });
  workflowId = wf.id;
  await prismaClient.workflowStatus.create({
    data: {
      tenantId,
      workflowId: wf.id,
      name: `รอรับเรื่อง ${STAMP}`,
      category: 'TODO',
      position: 1,
      isInitial: true,
    },
  });
  const tpl = await prismaClient.workItem.findFirstOrThrow({
    select: { issueTypeId: true, issueType: { select: { name: true } } },
  });
  issueTypeName = tpl.issueType.name;
  await prismaClient.workflowScheme.create({
    data: { tenantId, projectId, issueTypeId: tpl.issueTypeId, workflowId: wf.id },
  });
  /*
    ตั๋วจากอีเมลต้องมีฟิลด์ครบตามที่โปรเจกต์บังคับ · โปรเจกต์ของเทสต์ไม่ตั้ง
    ฟิลด์บังคับไว้เลย จึงไม่ต้องเตรียมอะไรเพิ่ม — จดไว้เพราะโปรเจกต์จริงที่
    บังคับฟิลด์ จะทำให้อีเมลสร้างตั๋วไม่ได้ และนั่นเป็นเรื่องที่ต้องออกแบบต่อ
  */

  ctx = { tenantId, actorId: null };
}, 180_000);

afterAll(async () => {
  const items = await prismaClient.workItem.findMany({
    where: { projectId },
    select: { id: true },
  });
  const ids = items.map((i) => i.id);
  await step('จดหมาย', () =>
    prismaClient.inboundMail.deleteMany({ where: { mailboxId: { contains: STAMP } } }),
  );
  await step('ความเห็น', () =>
    prismaClient.workItemComment.deleteMany({ where: { workItemId: { in: ids } } }),
  );
  await step('แจ้งเตือน', () =>
    prismaClient.notification.deleteMany({ where: { workItemId: { in: ids } } }),
  );
  await step('ประวัติ', () =>
    prismaClient.workItemHistory.deleteMany({ where: { workItemId: { in: ids } } }),
  );
  await step('นาฬิกา SLA', () =>
    prismaClient.workItemSla.deleteMany({ where: { workItemId: { in: ids } } }),
  );
  await step('งาน', () => prismaClient.workItem.deleteMany({ where: { id: { in: ids } } }));
  await step('workflow scheme', () =>
    prismaClient.workflowScheme.deleteMany({ where: { projectId } }),
  );
  await step('ตัวนับ', () => prismaClient.projectCounter.deleteMany({ where: { projectId } }));
  await step('โปรเจกต์', () => prismaClient.project.deleteMany({ where: { key: PKEY } }));
  await step('สถานะ', () =>
    prismaClient.workflowStatus.deleteMany({ where: { workflowId: workflowId ?? 0n } }),
  );
  await step('workflow', () => prismaClient.workflow.deleteMany({ where: { id: workflowId ?? 0n } }));
  await step('สมาชิกกลุ่ม', () =>
    prismaClient.groupMember.deleteMany({ where: { groupId: groupId ?? 0n } }),
  );
  await step('grant', () =>
    prismaClient.permissionGrant.deleteMany({ where: { schemeId: schemeId ?? 0n } }),
  );
  await step('กลุ่ม', () => prismaClient.userGroup.deleteMany({ where: { id: groupId ?? 0n } }));
  await step('audit', () =>
    prismaClient.auditLog.deleteMany({ where: { actorId: senderId ?? 0n } }),
  );
  await step('ผู้ใช้', () => prismaClient.user.deleteMany({ where: { email: senderEmail } }));
  await step('ชุดสิทธิ์', () =>
    prismaClient.permissionScheme.deleteMany({ where: { id: schemeId ?? 0n } }),
  );

  const left = await prismaClient.inboundMail.count({ where: { mailboxId: { contains: STAMP } } });
  if (left > 0) console.error(`**เหลือจดหมายของเทสต์ค้างอยู่ ${String(left)} ฉบับ**`);
  await prismaClient.$disconnect();
}, 180_000);

describe('A · สร้างตั๋วจากอีเมล', () => {
  it('**ตั๋วเป็นของผู้ส่ง ไม่ใช่ของระบบ**', async () => {
    /*
      ถ้าใช้สิทธิ์ของระบบ จะตอบไม่ได้ว่าใครแจ้ง และคนที่ไม่มีสิทธิ์ในโปรเจกต์
      จะแจ้งเรื่องได้เงียบ ๆ ผ่านอีเมล ซึ่งเป็นการเดินอ้อมชุดสิทธิ์ทั้งชุด
    */
    const r = await runEmailIntake(ctx, boxOf([mail()]), settings(), 50, NOW);
    expect(r).toMatchObject({ created: 1, rejected: 0 });

    const item = await prismaClient.workItem.findFirstOrThrow({
      where: { projectId },
      select: { summary: true, description: true, reporterId: true },
    });
    expect(item.reporterId).toBe(senderId);
    expect(item.summary).toContain('เครื่องพิมพ์ชั้น 3');
  }, 60_000);

  it('**บันทึกจดหมายไว้ พร้อมโยงกลับไปที่ตั๋ว**', async () => {
    const row = await prismaClient.inboundMail.findFirstOrThrow({
      where: { mailboxId: `box-${STAMP}-1` },
      select: { outcome: true, reason: true, workItemId: true },
    });
    expect(row.outcome).toBe('created');
    // สำเร็จแล้วต้องไม่เหลือเหตุผลค้างว่า "กำลังดำเนินการ"
    expect(row.reason).toBeNull();
    expect(row.workItemId).not.toBeNull();
  }, 60_000);

  it('**อ่านฉบับเดิมซ้ำ ไม่สร้างตั๋วซ้ำ**', async () => {
    /*
      ด่านนี้อยู่ที่ฐานข้อมูล ไม่ใช่ที่ตัวอ่าน · ตัวอ่านที่จำในหน่วยความจำจะ
      เริ่มนับใหม่ทุกครั้งที่รีสตาร์ต แล้วสร้างตั๋วซ้ำทั้งกล่อง
    */
    const before = await prismaClient.workItem.count({ where: { projectId } });
    const r = await runEmailIntake(ctx, boxOf([mail()]), settings(), 50, NOW);
    expect(r).toMatchObject({ skipped: 1, created: 0 });
    expect(await prismaClient.workItem.count({ where: { projectId } })).toBe(before);
  }, 60_000);
});

describe('B · ตอบกลับกลายเป็นความเห็น', () => {
  it('**ตอบกลับเข้าเรื่องเดิม ไม่ใช่ตั๋วใบใหม่**', async () => {
    const before = await prismaClient.workItem.count({ where: { projectId } });
    const r = await runEmailIntake(
      ctx,
      boxOf([
        mail({
          mailboxId: `box-${STAMP}-2`,
          messageId: `<msg-${STAMP}-2@example.co.th>`,
          subject: `Re: เครื่องพิมพ์ชั้น 3 ใช้ไม่ได้ ${STAMP}`,
          text: 'ยังไม่หายเลยครับ\n\nOn Tue, 15 Sep 2026, Helix wrote:\n> รับเรื่องแล้ว',
          inReplyTo: [`<msg-${STAMP}-1@example.co.th>`],
        }),
      ]),
      settings(),
      50,
      NOW,
    );
    expect(r).toMatchObject({ commented: 1, created: 0 });
    // ไม่มีตั๋วใบใหม่
    expect(await prismaClient.workItem.count({ where: { projectId } })).toBe(before);

    const comment = await prismaClient.workItemComment.findFirstOrThrow({
      where: { workItem: { projectId } },
      select: { body: true },
    });
    // ข้อความที่ยกมาถูกตัดออกแล้ว
    expect(JSON.stringify(comment.body)).toContain('ยังไม่หายเลยครับ');
    expect(JSON.stringify(comment.body)).not.toContain('รับเรื่องแล้ว');
  }, 60_000);
});

describe('C · สิ่งที่ต้องปฏิเสธ และต้องไม่เงียบ', () => {
  it('**จดหมายจากที่อยู่ของระบบเอง ถูกปฏิเสธและมีแถวเก็บไว้**', async () => {
    const r = await runEmailIntake(
      ctx,
      boxOf([mail({ mailboxId: `box-${STAMP}-3`, from: SYSTEM })]),
      settings(),
      50,
      NOW,
    );
    expect(r).toMatchObject({ rejected: 1, created: 0 });
    const row = await prismaClient.inboundMail.findFirstOrThrow({
      where: { mailboxId: `box-${STAMP}-3` },
      select: { outcome: true, reason: true },
    });
    expect(row.outcome).toBe('rejected');
    expect(row.reason).toBe(REJECT.loop);
  }, 60_000);

  it('**ผู้ส่งที่ไม่มีบัญชี ถูกปฏิเสธพร้อมเหตุผลที่บอกทางแก้**', async () => {
    const r = await runEmailIntake(
      ctx,
      boxOf([mail({ mailboxId: `box-${STAMP}-4`, from: `ไม่รู้จัก-${STAMP}@example.com` })]),
      settings(),
      50,
      NOW,
    );
    expect(r).toMatchObject({ rejected: 1 });
    const row = await prismaClient.inboundMail.findFirstOrThrow({
      where: { mailboxId: `box-${STAMP}-4` },
      select: { reason: true, fromAddress: true },
    });
    expect(row.reason).toBe(REJECT.unknown);
    // เก็บที่อยู่ผู้ส่งไว้ด้วย ไม่งั้นผู้ดูแลไม่รู้ว่าจะเพิ่มบัญชีให้ใคร
    expect(row.fromAddress).toContain(STAMP);
  }, 60_000);

  it('การตอบอัตโนมัติถูกปฏิเสธ', async () => {
    const r = await runEmailIntake(
      ctx,
      boxOf([
        mail({ mailboxId: `box-${STAMP}-5`, headers: { 'auto-submitted': 'auto-replied' } }),
      ]),
      settings(),
      50,
      NOW,
    );
    expect(r).toMatchObject({ rejected: 1 });
  }, 60_000);
});

describe('D · ล้มทีละฉบับ', () => {
  it('**ฉบับที่พังไม่ทำให้ฉบับอื่นไม่ถูกอ่าน**', async () => {
    /*
      จดหมายที่อ้างถึงเรื่องที่ไม่มีอยู่ จะทำให้ `addComment` โยน · ถ้าปล่อยให้
      หลุดออกไป จดหมายที่เหลือในรอบนั้นจะไม่ถูกอ่านเลย และรอบถัดไปก็จะพัง
      ที่ฉบับเดิมอีก — กล่องจะค้างตลอดกาลเพราะจดหมายเสียฉบับเดียว
    */
    const r = await runEmailIntake(
      ctx,
      boxOf([
        mail({
          mailboxId: `box-${STAMP}-6`,
          subject: `[${PKEY}-9999] เรื่องที่ไม่มีอยู่`,
          text: 'ตอบกลับเรื่องที่ถูกลบไปแล้ว',
        }),
        mail({
          mailboxId: `box-${STAMP}-7`,
          messageId: `<msg-${STAMP}-7@example.co.th>`,
          subject: `ขอติดตั้งโปรแกรม ${STAMP}`,
          text: 'ขอ Microsoft Project ครับ',
        }),
      ]),
      settings(),
      50,
      NOW,
    );
    expect(r.rejected).toBe(1);
    // ฉบับหลังยังถูกอ่านและสร้างตั๋วได้
    expect(r.created).toBe(1);

    const bad = await prismaClient.inboundMail.findFirstOrThrow({
      where: { mailboxId: `box-${STAMP}-6` },
      select: { outcome: true, reason: true },
    });
    expect(bad.outcome).toBe('rejected');
    // เหตุผลต้องเป็นข้อความจริง ไม่ใช่ค้างเป็น "กำลังดำเนินการ"
    expect(bad.reason).not.toBe('กำลังดำเนินการ');
    expect((bad.reason ?? '').length).toBeGreaterThan(5);
  }, 60_000);
});
