/**
 * Seed data ที่สมจริง — 10,000 work item
 *
 * CLAUDE.md กำหนดให้มีตั้งแต่วันแรก ไม่ใช่ตอนทดสอบสมรรถนะ เพราะ
 * ข้อมูลตัวอย่าง 3 แถวทำให้ทุกอย่างดูเร็ว และปัญหาจริงจะไม่ปรากฏจนถึงเดือนที่ 6
 *
 * สิ่งที่ seed นี้สร้าง:
 *   - tenant เดียว (โหมด on-prem) + ผู้ใช้ 14 คน + กลุ่ม 3 กลุ่ม
 *   - โปรเจกต์ SD (service desk) และ PLAT (software) พร้อม scheme ครบชุด
 *   - workflow 2 ตัว: Incident 5 สถานะ (มีสถานะที่หยุด SLA), Software 4 สถานะ
 *   - work item 10,000 ใบ กระจายตามช่วงเวลาจริง พร้อม LexoRank
 *
 * รันด้วย: pnpm db:seed
 */
import type { Prisma} from '@prisma/client';
import { PrismaClient, ProjectType, RuleKind, StatusCategory, FieldType, LinkType } from '@prisma/client';
import { distribute } from '@itsm/lexorank';
import { hashPassword } from '../src/modules/identity/password';
import { applyHierarchy } from '../src/scripts/hierarchy-apply';

const prisma = new PrismaClient();

// ตัวสุ่มแบบกำหนดค่าเริ่มต้นได้ — Math.random() ทำให้ seed ไม่ทำซ้ำได้
// และทำให้เทสต์สมรรถนะเทียบกันข้ามรอบไม่ได้
//
// ใช้ mulberry32 ไม่ใช่ LCG แบบ (s * 1103515245 + 12345)
//
// เหตุผล: ใน JavaScript ตัวเลขเป็น double 53 บิต การคูณ seed ด้วย 1103515245
// ทำให้ผลลัพธ์เกิน 2^53 และ **สูญเสียบิตล่างซึ่งเป็นบิตที่มีความสุ่ม**
// ผลจริงที่วัดได้ตอนแรก: 10,000 แถวมี summary ที่ไม่ซ้ำเพียง 19 แบบ
// และ placeholder {n} ได้ค่า 1 ตลอด
//
// ความล้มเหลวแบบเงียบอีกครั้ง: seed รันผ่าน ไม่มี error แต่ข้อมูลไร้ความหลากหลาย
// ทำให้การทดสอบค้นหาและ relevance ทั้งหมดที่รันบนข้อมูลนี้ไม่มีความหมาย
// mulberry32 ใช้ Math.imul ซึ่งคูณแบบ 32 บิตจึงไม่มีปัญหานี้
let seedState = 20260824;
function rnd(max: number): number {
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) % max;
}
function pick<T>(arr: readonly T[]): T {
  return arr[rnd(arr.length)]!;
}

const NOW = Date.UTC(2026, 7, 24, 9, 0, 0);
const DAY = 86_400_000;

// ============================================================
// เนื้อหาภาษาไทยที่สมจริง — ไม่ใช่ lorem ipsum
// ============================================================

const INCIDENT_SUBJECTS = [
  'ระบบเข้าสู่ระบบ SSO ล่ม พนักงานเข้าใช้งานไม่ได้',
  'เครื่องพิมพ์ชั้น {n} พิมพ์ไม่ออก',
  'VPN หลุดบ่อยตั้งแต่เช้า ทีมที่ทำงานจากบ้านได้รับผลกระทบ',
  'โปรแกรม SAP ค้างเมื่อออกรายงานยอดขายรายเดือน',
  'อีเมลส่งออกไม่ได้ ขึ้น error relay denied',
  'ไฟล์เซิร์ฟเวอร์เข้าถึงช้ามากช่วงบ่าย',
  'ระบบลงเวลาทำงานไม่บันทึกข้อมูลของสาขา {n}',
  'จอคอมพิวเตอร์ห้องประชุม {n} ไม่แสดงภาพ',
  'Wi-Fi ชั้น {n} สัญญาณอ่อนและหลุดเป็นระยะ',
  'โปรแกรมบัญชีเปิดไม่ขึ้นหลังอัปเดตวินโดวส์',
];

const REQUEST_SUBJECTS = [
  'ขอเพิ่มสิทธิ์เข้าถึงโฟลเดอร์ฝ่ายการเงิน',
  'ขอติดตั้งโปรแกรม Microsoft Project',
  'ขอโน้ตบุ๊กสำหรับพนักงานใหม่ {n} ท่าน',
  'ขอรีเซ็ตรหัสผ่านบัญชีผู้ใช้',
  'ขอจอมอนิเตอร์เพิ่มอีก 1 จอ',
  'ขอเปิดสิทธิ์ใช้งานระบบจัดซื้อ',
  'ขอย้ายเครื่องคอมพิวเตอร์ไปโต๊ะใหม่',
  'ขอลิขสิทธิ์ Adobe Acrobat สำหรับฝ่ายการตลาด',
  'ขอสร้างบัญชีอีเมลสำหรับพนักงานเข้าใหม่',
  'ขอเพิ่มพื้นที่จัดเก็บไฟล์ในไดรฟ์ร่วม',
];

const STORY_SUBJECTS = [
  'ตัวแก้ไข Workflow แบบลากวางบนผืนผ้าใบ',
  'เพิ่ม Validator แบบฟิลด์ต้องกรอกก่อนเปลี่ยนสถานะ',
  'Post Function เรียก Webhook ภายนอก',
  'เขียนประวัติทุก transition ลง work_item_history',
  'ปฏิทินวันหยุดราชการไทย พร้อมวันหยุดชดเชย',
  'คำนวณเวลาที่เหลือเมื่อนาฬิกาถูกพักคร่อมวันหยุดยาว',
  'แจ้งเตือนที่ 50% และ 75% ของเป้าหมาย SLA',
  'รองรับ transition แบบมีเงื่อนไขจากกลุ่มผู้ใช้',
  'แคชสถานะ workflow ใน Redis',
  'หน้าคิวที่รองรับ 10,000 แถวด้วย virtualization',
  'ย้ายการ์ดบน Board ด้วยคีย์บอร์ดตาม WCAG',
  'ตัวกรองด่วนที่กำหนดเองด้วย HQL',
];

function subject(pool: readonly string[]): string {
  return pick(pool).replace('{n}', String(rnd(8) + 1));
}

// ============================================================
/**
 * รหัสผ่านของผู้ใช้ทุกคนในข้อมูลทดสอบ (ADR-003)
 * ใช้ได้เฉพาะ dev — production ต้องตั้งรหัสผ่านรายคนผ่านหน้าจอผู้ดูแลระบบ
 */
const DEV_PASSWORD = 'helix-dev-2569-ปลาทู';

async function main(): Promise<void> {
  const started = Date.now();
  console.log('เริ่ม seed…');

  // ---------- ล้างข้อมูลเดิมของ tenant นี้ ----------
  //
  // ต้องลบตามลำดับเอง ไม่พึ่ง cascade ของ tenant เพราะ
  // workflow_scheme -> workflow เป็น onDelete: Restrict (ตั้งใจ: กันลบ workflow
  // ที่ยังมีโปรเจกต์ใช้อยู่) เมื่อ MySQL ไล่ cascade จาก tenant ลำดับการลบ
  // ไม่รับประกัน จึงชนกับ Restrict และได้ error P2003
  const existing = await prisma.tenant.findFirst({ where: { key: 'default' } });
  if (existing !== null) {
    const t = existing.id;
    await prisma.workItemHistory.deleteMany({ where: { tenantId: t } });
    await prisma.workItem.deleteMany({ where: { tenantId: t } });
    await prisma.workflowScheme.deleteMany({ where: { tenantId: t } });
    await prisma.fieldConfig.deleteMany({ where: { tenantId: t } });
    await prisma.transitionRule.deleteMany({ where: { tenantId: t } });
    await prisma.workflowTransition.deleteMany({ where: { tenantId: t } });
    await prisma.workflowStatus.deleteMany({ where: { tenantId: t } });
    await prisma.workflow.deleteMany({ where: { tenantId: t } });
    await prisma.projectCounter.deleteMany({ where: { tenantId: t } });
    await prisma.project.deleteMany({ where: { tenantId: t } });
    await prisma.tenant.delete({ where: { id: t } });
  }

  const tenant = await prisma.tenant.create({
    data: { key: 'default', name: 'Plus Dental Clinic Group', locale: 'th', timezone: 'Asia/Bangkok' },
  });
  const tenantId = tenant.id;
  console.log(`  tenant #${tenantId} สร้างแล้ว`);

  // ---------- ผู้ใช้ ----------
  const agentNames = ['ปวีณา สุขสวัสดิ์', 'สมชาย กิตติพงศ์', 'อนุชา ประเสริฐ', 'พรทิพย์ ลีลาวดี'];
  const devNames = ['ณัฐพล ธนกิจ', 'ศิริพร วงศ์ไทย', 'ธนกร วัฒนา', 'กมลชนก แสงทอง'];
  const userNames = [
    'วิชัย ตั้งใจ', 'มาลี ใจดี', 'สุรศักดิ์ พัฒนา', 'อรพิน ศรีสุข',
    'เอกชัย มั่นคง', 'ชนิดา รุ่งเรือง',
  ];

  const systemUser = await prisma.user.create({
    data: {
      tenantId,
      email: 'automation@itsm.local',
      displayName: 'Automation',
      isSystem: true,
    },
  });

  /**
   * รหัสผ่านสำหรับ dev เท่านั้น
   *
   * แฮชครั้งเดียวแล้วใช้ซ้ำทุกคน เพราะ scrypt ที่ N=65536 ใช้เวลาราวหนึ่งวินาที
   * ต่อครั้ง — แฮชแยกให้ผู้ใช้ 22 คนทำให้ seed ช้าขึ้นเกือบครึ่งนาทีโดยไม่ได้อะไร
   * ในข้อมูลทดสอบ · **ห้ามทำแบบนี้กับข้อมูลจริง** เกลือที่ต่างกันคือเหตุผล
   * ที่ตารางรหัสผ่านที่รั่วไม่บอกว่าใครใช้รหัสเดียวกัน
   */
  const devPasswordHash = await hashPassword(DEV_PASSWORD);

  const mkUsers = (names: string[], prefix: string) =>
    names.map((displayName, i) => ({
      tenantId,
      email: `${prefix}${i + 1}@plusdentalclinic.co.th`,
      displayName,
      passwordHash: devPasswordHash,
    }));

  await prisma.user.createMany({
    data: [...mkUsers(agentNames, 'agent'), ...mkUsers(devNames, 'dev'), ...mkUsers(userNames, 'user')],
  });
  const allUsers = await prisma.user.findMany({ where: { tenantId, isSystem: false } });
  const agents = allUsers.filter((u) => u.email.startsWith('agent'));
  const devs = allUsers.filter((u) => u.email.startsWith('dev'));
  const endUsers = allUsers.filter((u) => u.email.startsWith('user'));
  console.log(`  ผู้ใช้ ${allUsers.length + 1} คน (agent ${agents.length} · dev ${devs.length} · ผู้ใช้ทั่วไป ${endUsers.length} · system 1)`);

  // ---------- กลุ่ม ----------
  const groupIt = await prisma.userGroup.create({ data: { tenantId, name: 'IT Support' } });
  const groupDev = await prisma.userGroup.create({ data: { tenantId, name: 'Engineering' } });
  const groupAll = await prisma.userGroup.create({ data: { tenantId, name: 'พนักงานทั้งหมด' } });
  /**
   * กลุ่มผู้ดูแลระบบแยกจาก IT Support โดยตั้งใจ
   *
   * การเพิ่มคน ตั้งรหัสผ่านให้คนอื่น และปิดบัญชี เป็นคนละอำนาจกับการรับแจ้งงาน
   * ทีมไอทีทุกคนไม่จำเป็นต้องรีเซ็ตรหัสผ่านของใครก็ได้
   */
  const groupAdmin = await prisma.userGroup.create({ data: { tenantId, name: 'ผู้ดูแลระบบ' } });
  await prisma.groupMember.createMany({
    data: [
      ...agents.map((u) => ({ tenantId, groupId: groupIt.id, userId: u.id })),
      // หัวหน้าทีมไอทีเป็นผู้ดูแลระบบคนแรก — ต้องมีอย่างน้อยหนึ่งคน
      // ไม่งั้นไม่มีใครเพิ่มผู้ใช้ได้เลยหลังติดตั้ง
      { tenantId, groupId: groupAdmin.id, userId: agents[0]!.id },
      ...devs.map((u) => ({ tenantId, groupId: groupDev.id, userId: u.id })),
      ...allUsers.map((u) => ({ tenantId, groupId: groupAll.id, userId: u.id })),
    ],
  });

  // ---------- Priority / Resolution ----------
  await prisma.priority.createMany({
    data: [
      { tenantId, name: 'P1 Critical', rank: 1, colorToken: 'status-critical' },
      { tenantId, name: 'P2 High', rank: 2, colorToken: 'status-warning' },
      { tenantId, name: 'P3 Medium', rank: 3, colorToken: 'status-info' },
      { tenantId, name: 'P4 Low', rank: 4, colorToken: 'text-faint' },
      { tenantId, name: 'P5 Trivial', rank: 5, colorToken: 'border-strong' },
    ],
  });
  const priorities = await prisma.priority.findMany({ where: { tenantId }, orderBy: { rank: 'asc' } });

  await prisma.resolution.createMany({
    data: [
      { tenantId, name: 'แก้ไขเรียบร้อย' },
      { tenantId, name: 'ดำเนินการให้แล้ว' },
      { tenantId, name: 'ไม่พบปัญหา' },
      { tenantId, name: 'ซ้ำกับรายการอื่น' },
      { tenantId, name: 'ยกเลิกโดยผู้แจ้ง' },
    ],
  });
  const resolutions = await prisma.resolution.findMany({ where: { tenantId } });

  // ---------- Permission scheme ----------
  const schemeSd = await prisma.permissionScheme.create({
    data: { tenantId, name: 'Service Desk — สิทธิ์มาตรฐาน' },
  });
  const schemeSw = await prisma.permissionScheme.create({
    data: { tenantId, name: 'Software — สิทธิ์มาตรฐาน' },
  });
  await prisma.permissionGrant.createMany({
    data: [
      { tenantId, schemeId: schemeSd.id, permission: 'BROWSE_PROJECT', groupId: groupAll.id },
      { tenantId, schemeId: schemeSd.id, permission: 'CREATE_ITEM', groupId: groupAll.id },
      { tenantId, schemeId: schemeSd.id, permission: 'ADD_COMMENT', groupId: groupAll.id },
      { tenantId, schemeId: schemeSd.id, permission: 'EDIT_ITEM', groupId: groupIt.id },
      { tenantId, schemeId: schemeSd.id, permission: 'ASSIGN_ITEM', groupId: groupIt.id },
      { tenantId, schemeId: schemeSd.id, permission: 'TRANSITION_ITEM', groupId: groupIt.id },
      { tenantId, schemeId: schemeSd.id, permission: 'BULK_EDIT', groupId: groupIt.id },
      /*
        เชื่อมโยงเรื่อง — ให้ทีมไอที ไม่ให้ "พนักงานทั้งหมด"

        ต้องให้จริงตั้งแต่ seed · ฟีเจอร์ที่ไม่มีกลุ่มไหนได้สิทธิ์ ก็ไม่ต่างจาก
        ฟีเจอร์ที่ยังไม่ได้เขียน — ต่างกันแค่ว่าอันนี้หน้าตั้งค่าแสดงชื่อไว้ด้วย
      */
      { tenantId, schemeId: schemeSd.id, permission: 'LINK_ITEM', groupId: groupIt.id },
      // ดูรายงาน — ให้ทีมไอที เหตุผลเดียวกับ LINK_ITEM ข้างบน
      { tenantId, schemeId: schemeSd.id, permission: 'VIEW_REPORT', groupId: groupIt.id },
      // เห็นบันทึกภายใน — ให้เฉพาะทีมไอที ไม่ให้ "พนักงานทั้งหมด"
      { tenantId, schemeId: schemeSd.id, permission: 'VIEW_INTERNAL_COMMENT', groupId: groupIt.id },
      // ADMINISTER_TENANT ผูกกับ scheme หนึ่ง แต่มีผลทั้ง tenant — ดู isTenantAdmin()
      { tenantId, schemeId: schemeSd.id, permission: 'ADMINISTER_TENANT', groupId: groupAdmin.id },
      { tenantId, schemeId: schemeSd.id, permission: 'BROWSE_PROJECT', groupId: groupAdmin.id },
      { tenantId, schemeId: schemeSw.id, permission: 'BROWSE_PROJECT', groupId: groupDev.id },
      { tenantId, schemeId: schemeSw.id, permission: 'CREATE_ITEM', groupId: groupDev.id },
      /*
        คอมเมนต์ในโปรเจกต์ของตัวเอง

        กลุ่ม "พนักงานทั้งหมด" ไม่มีสิทธิ์อะไรบน PLAT เลย · Engineering
        จึงเป็นแหล่งเดียว และเดิมไม่มี `ADD_COMMENT` — ผลคือนักพัฒนา
        คอมเมนต์งานของตัวเองไม่ได้ (เจอตอน QA: `/mentionable` ตอบ 403)
      */
      { tenantId, schemeId: schemeSw.id, permission: 'ADD_COMMENT', groupId: groupDev.id },
      { tenantId, schemeId: schemeSw.id, permission: 'EDIT_ITEM', groupId: groupDev.id },
      { tenantId, schemeId: schemeSw.id, permission: 'TRANSITION_ITEM', groupId: groupDev.id },
      { tenantId, schemeId: schemeSw.id, permission: 'MANAGE_SPRINT', groupId: groupDev.id },
      /*
        จัดการรุ่นของโปรเจกต์ (สร้าง แก้ ปล่อย) — ให้ทีมพัฒนา

        `MANAGE_PROJECT` เพิ่งถูกบังคับใช้จริงพร้อมกับฟีเจอร์รุ่น · ก่อนหน้านี้
        มันอยู่ใน `UNENFORCED_PERMISSIONS` และไม่มีใครถืออยู่เลย · **สิทธิ์ที่
        ไม่มีใครถือ = ฟีเจอร์ที่ไม่มีใครใช้ได้** ซึ่งเป็นด้านกลับของบทเรียน
        "สิทธิ์ที่ให้แล้วไม่มีผล" — ทั้งสองอย่างทำให้หน้าตั้งค่ากับความจริงไม่ตรงกัน
      */
      { tenantId, schemeId: schemeSw.id, permission: 'MANAGE_PROJECT', groupId: groupDev.id },
      { tenantId, schemeId: schemeSd.id, permission: 'MANAGE_PROJECT', groupId: groupIt.id },
      { tenantId, schemeId: schemeSw.id, permission: 'LINK_ITEM', groupId: groupDev.id },
      { tenantId, schemeId: schemeSw.id, permission: 'VIEW_REPORT', groupId: groupDev.id },
      { tenantId, schemeId: schemeSw.id, permission: 'VIEW_INTERNAL_COMMENT', groupId: groupDev.id },
    ],
  });

  // ---------- Issue types ----------
  const issueTypeSpec = [
    { name: 'Incident', iconKey: 'alert-triangle', hierarchyLevel: 0, isSubtask: false },
    { name: 'Service Request', iconKey: 'inbox', hierarchyLevel: 0, isSubtask: false },
    { name: 'Problem', iconKey: 'search', hierarchyLevel: 0, isSubtask: false },
    { name: 'Change', iconKey: 'git-branch', hierarchyLevel: 0, isSubtask: false },
    { name: 'Epic', iconKey: 'layers', hierarchyLevel: 1, isSubtask: false },
    { name: 'Story', iconKey: 'bookmark', hierarchyLevel: 0, isSubtask: false },
    { name: 'Task', iconKey: 'check-square', hierarchyLevel: 0, isSubtask: false },
    { name: 'Bug', iconKey: 'bug', hierarchyLevel: 0, isSubtask: false },
    { name: 'Sub-task', iconKey: 'corner-down-right', hierarchyLevel: -1, isSubtask: true },
  ];
  await prisma.issueType.createMany({ data: issueTypeSpec.map((t) => ({ tenantId, ...t })) });
  const issueTypes = await prisma.issueType.findMany({ where: { tenantId } });
  const it = (name: string) => issueTypes.find((t) => t.name === name)!;

  // ---------- Workflows ----------
  const wfIncident = await prisma.workflow.create({
    data: { tenantId, name: 'ITSM: Incident Management' },
  });
  const incidentStatuses = [
    { name: 'New', category: StatusCategory.TODO, position: 1, isInitial: true, pausesSla: false },
    { name: 'Investigating', category: StatusCategory.IN_PROGRESS, position: 2, isInitial: false, pausesSla: false },
    { name: 'Pending Customer', category: StatusCategory.IN_PROGRESS, position: 3, isInitial: false, pausesSla: true },
    { name: 'Resolved', category: StatusCategory.DONE, position: 4, isInitial: false, pausesSla: false },
    { name: 'Closed', category: StatusCategory.DONE, position: 5, isInitial: false, pausesSla: false },
  ];
  await prisma.workflowStatus.createMany({
    data: incidentStatuses.map((s) => ({ tenantId, workflowId: wfIncident.id, ...s })),
  });
  const incStatuses = await prisma.workflowStatus.findMany({
    where: { workflowId: wfIncident.id },
    orderBy: { position: 'asc' },
  });
  const incBy = (n: string) => incStatuses.find((s) => s.name === n)!;

  const trResolve = await prisma.workflowTransition.create({
    data: {
      tenantId,
      workflowId: wfIncident.id,
      name: 'แก้ไขเสร็จแล้ว',
      fromStatusId: incBy('Investigating').id,
      toStatusId: incBy('Resolved').id,
      position: 1,
    },
  });
  await prisma.workflowTransition.createMany({
    data: [
      { tenantId, workflowId: wfIncident.id, name: 'เริ่มตรวจสอบ', fromStatusId: incBy('New').id, toStatusId: incBy('Investigating').id, position: 1 },
      { tenantId, workflowId: wfIncident.id, name: 'พักรอลูกค้า', fromStatusId: incBy('Investigating').id, toStatusId: incBy('Pending Customer').id, position: 2 },
      { tenantId, workflowId: wfIncident.id, name: 'ลูกค้าตอบแล้ว', fromStatusId: incBy('Pending Customer').id, toStatusId: incBy('Investigating').id, position: 1 },
      { tenantId, workflowId: wfIncident.id, name: 'ปิดงาน', fromStatusId: incBy('Resolved').id, toStatusId: incBy('Closed').id, position: 1 },
      { tenantId, workflowId: wfIncident.id, name: 'เปิดใหม่', fromStatusId: incBy('Closed').id, toStatusId: incBy('Investigating').id, position: 2 },
    ],
  });
  // สามชั้นของ transition "แก้ไขเสร็จแล้ว" — เป็นตัวอย่างจริงที่ engine ต้องอ่านได้
  await prisma.transitionRule.createMany({
    data: [
      { tenantId, transitionId: trResolve.id, kind: RuleKind.CONDITION, ruleType: 'assignee-is-current-user', config: {}, position: 1 },
      { tenantId, transitionId: trResolve.id, kind: RuleKind.VALIDATOR, ruleType: 'required-fields', config: { fields: ['resolution'] }, position: 1 },
      { tenantId, transitionId: trResolve.id, kind: RuleKind.POST_FUNCTION, ruleType: 'stop-sla', config: { goal: 'time-to-resolve' }, position: 1 },
      { tenantId, transitionId: trResolve.id, kind: RuleKind.POST_FUNCTION, ruleType: 'notify', config: { audience: 'reporter' }, position: 2 },
    ],
  });

  /*
    ---------- ITSM: Change Management ----------

    **นี่คือที่เดียวที่ `require-approval` ถูกใช้จริง** · ก่อนหน้านี้ validator
    ตัวนั้นมีอยู่ในเอนจิน มีเทสต์ และตั้งจากหน้าจอได้ **แต่ไม่มี workflow ไหน
    ในข้อมูลตั้งต้นใช้มันเลย** — สายอนุมัติหลายขั้นทั้งชุดจึงไม่ได้กั้นอะไร
    ซึ่งเป็นรูปแบบเดียวกับ `BULK_EDIT` ที่ให้สิทธิ์แล้วไม่มีผล

    Change ใช้ workflow ของตัวเอง ไม่ใช่ของ Incident เพราะกระบวนการต่างกัน
    ตรงจุดสำคัญ: **ต้องมีคนอนุมัติก่อนถึงจะลงมือได้**
  */
  const wfChange = await prisma.workflow.create({
    data: { tenantId, name: 'ITSM: Change Management' },
  });
  await prisma.workflowStatus.createMany({
    data: [
      { tenantId, workflowId: wfChange.id, name: 'ร่างคำขอ', category: StatusCategory.TODO, position: 1, isInitial: true },
      { tenantId, workflowId: wfChange.id, name: 'รออนุมัติ', category: StatusCategory.TODO, position: 2, pausesSla: true },
      { tenantId, workflowId: wfChange.id, name: 'รอถึงกำหนด', category: StatusCategory.TODO, position: 3, pausesSla: true },
      { tenantId, workflowId: wfChange.id, name: 'กำลังดำเนินการ', category: StatusCategory.IN_PROGRESS, position: 4 },
      { tenantId, workflowId: wfChange.id, name: 'เสร็จแล้ว', category: StatusCategory.DONE, position: 5 },
      { tenantId, workflowId: wfChange.id, name: 'ยกเลิก', category: StatusCategory.DONE, position: 6 },
    ],
  });
  const chStatuses = await prisma.workflowStatus.findMany({ where: { workflowId: wfChange.id } });
  const chBy = (n: string) => chStatuses.find((x) => x.name === n)!;

  await prisma.workflowTransition.createMany({
    data: [
      { tenantId, workflowId: wfChange.id, name: 'ส่งขออนุมัติ', fromStatusId: chBy('ร่างคำขอ').id, toStatusId: chBy('รออนุมัติ').id, position: 1 },
      { tenantId, workflowId: wfChange.id, name: 'ถอนคำขอ', fromStatusId: chBy('รออนุมัติ').id, toStatusId: chBy('ร่างคำขอ').id, position: 2 },
      { tenantId, workflowId: wfChange.id, name: 'เริ่มดำเนินการ', fromStatusId: chBy('รอถึงกำหนด').id, toStatusId: chBy('กำลังดำเนินการ').id, position: 1 },
      { tenantId, workflowId: wfChange.id, name: 'ทำเสร็จแล้ว', fromStatusId: chBy('กำลังดำเนินการ').id, toStatusId: chBy('เสร็จแล้ว').id, position: 1 },
      { tenantId, workflowId: wfChange.id, name: 'ยกเลิกคำขอ', fromStatusId: chBy('ร่างคำขอ').id, toStatusId: chBy('ยกเลิก').id, position: 3 },
    ],
  });

  /*
    ปุ่มที่ **ต้องได้รับอนุมัติก่อน** — สร้างแยกเพราะต้องผูกกฎเข้าไป

    เป็น VALIDATOR ไม่ใช่ CONDITION โดยตั้งใจ: ปุ่มต้องยังเห็นอยู่ ผู้ขอจึงรู้ว่า
    ทำต่อได้แต่ต้องรออนุมัติก่อน · ถ้าเป็น CONDITION ปุ่มจะหายไปเฉย ๆ
    แล้วไม่มีใครรู้ว่าต้องทำอะไร (ดูหัวไฟล์ workflow-engine.ts)
  */
  const trApproved = await prisma.workflowTransition.create({
    data: {
      tenantId,
      workflowId: wfChange.id,
      name: 'อนุมัติแล้ว รอถึงกำหนด',
      fromStatusId: chBy('รออนุมัติ').id,
      toStatusId: chBy('รอถึงกำหนด').id,
      position: 1,
    },
  });
  await prisma.transitionRule.create({
    data: {
      tenantId,
      transitionId: trApproved.id,
      kind: RuleKind.VALIDATOR,
      ruleType: 'require-approval',
      config: {},
      position: 1,
    },
  });

  /*
    ---------- ITSM: Problem Management ----------

    แยกจาก Incident เพราะปัญหาจบคนละแบบ: **"รู้สาเหตุแล้ว" เป็นสถานะจริง**
    ไม่ใช่ขั้นระหว่างทาง · known error ที่ยังไม่มีทางแก้ถาวรอยู่ตรงนั้นได้เป็นปี
    และต้องแยกออกจาก "แก้ที่ต้นเหตุแล้ว" ให้ชัด — ไม่งั้นรายงานจะนับปัญหาที่
    ยังกวนอยู่ว่าแก้แล้ว
  */
  const wfProblem = await prisma.workflow.create({
    data: { tenantId, name: 'ITSM: Problem Management' },
  });
  await prisma.workflowStatus.createMany({
    data: [
      { tenantId, workflowId: wfProblem.id, name: 'ตั้งเรื่องไว้', category: StatusCategory.TODO, position: 1, isInitial: true },
      { tenantId, workflowId: wfProblem.id, name: 'กำลังหาสาเหตุ', category: StatusCategory.IN_PROGRESS, position: 2 },
      { tenantId, workflowId: wfProblem.id, name: 'รู้สาเหตุแล้ว', category: StatusCategory.IN_PROGRESS, position: 3 },
      { tenantId, workflowId: wfProblem.id, name: 'แก้ที่ต้นเหตุแล้ว', category: StatusCategory.DONE, position: 4 },
      { tenantId, workflowId: wfProblem.id, name: 'ไม่แก้', category: StatusCategory.DONE, position: 5 },
    ],
  });
  const prStatuses = await prisma.workflowStatus.findMany({ where: { workflowId: wfProblem.id } });
  const prBy = (n: string) => prStatuses.find((x) => x.name === n)!;
  await prisma.workflowTransition.createMany({
    data: [
      { tenantId, workflowId: wfProblem.id, name: 'เริ่มหาสาเหตุ', fromStatusId: prBy('ตั้งเรื่องไว้').id, toStatusId: prBy('กำลังหาสาเหตุ').id, position: 1 },
      { tenantId, workflowId: wfProblem.id, name: 'บันทึกสาเหตุ', fromStatusId: prBy('กำลังหาสาเหตุ').id, toStatusId: prBy('รู้สาเหตุแล้ว').id, position: 1 },
      { tenantId, workflowId: wfProblem.id, name: 'แก้ที่ต้นเหตุแล้ว', fromStatusId: prBy('รู้สาเหตุแล้ว').id, toStatusId: prBy('แก้ที่ต้นเหตุแล้ว').id, position: 1 },
      { tenantId, workflowId: wfProblem.id, name: 'ตัดสินใจไม่แก้', fromStatusId: prBy('รู้สาเหตุแล้ว').id, toStatusId: prBy('ไม่แก้').id, position: 2 },
      { tenantId, workflowId: wfProblem.id, name: 'กลับไปหาสาเหตุใหม่', fromStatusId: prBy('รู้สาเหตุแล้ว').id, toStatusId: prBy('กำลังหาสาเหตุ').id, position: 3 },
    ],
  });

  const wfSoftware = await prisma.workflow.create({
    data: { tenantId, name: 'Software: Simplified' },
  });
  await prisma.workflowStatus.createMany({
    data: [
      { tenantId, workflowId: wfSoftware.id, name: 'To Do', category: StatusCategory.TODO, position: 1, isInitial: true },
      { tenantId, workflowId: wfSoftware.id, name: 'In Progress', category: StatusCategory.IN_PROGRESS, position: 2 },
      { tenantId, workflowId: wfSoftware.id, name: 'In Review', category: StatusCategory.IN_PROGRESS, position: 3 },
      { tenantId, workflowId: wfSoftware.id, name: 'Done', category: StatusCategory.DONE, position: 4 },
    ],
  });
  const swStatuses = await prisma.workflowStatus.findMany({
    where: { workflowId: wfSoftware.id },
    orderBy: { position: 'asc' },
  });

  // ---------- Projects ----------
  const projectSd = await prisma.project.create({
    data: {
      tenantId,
      key: 'SD',
      name: 'IT Service Desk',
      type: ProjectType.SERVICE_DESK,
      leadId: agents[0]!.id,
      permissionSchemeId: schemeSd.id,
      // ปลายทางของงานที่ยังไม่มีผู้รับผิดชอบ — ถ้าไม่ตั้ง การแจ้งเตือนจะไปไม่ถึงใคร
      notifyGroupId: groupIt.id,
    },
  });
  const projectPlat = await prisma.project.create({
    data: {
      tenantId,
      key: 'PLAT',
      name: 'Helix Platform',
      type: ProjectType.SOFTWARE,
      leadId: devs[0]!.id,
      permissionSchemeId: schemeSw.id,
      notifyGroupId: groupDev.id,
    },
  });

  /*
    Problem กับ Change ใช้ workflow ของตัวเอง ไม่ใช่ของ Incident

    ก่อนหน้านี้ทั้งสี่ชนิดชี้ไปที่ `ITSM: Incident Management` เหมือนกันหมด ·
    ผลคือ Change ไม่มีสถานะ "รออนุมัติ" และ **ไม่มีที่ไหนใช้ validator
    `require-approval` เลย** — สายอนุมัติหลายขั้นทั้งชุดจึงไม่ได้กั้นอะไร
  */
  const incidentTypes = ['Incident', 'Service Request'];
  /** ทุกชนิดใน SD — ใช้ตั้งค่าฟิลด์ ซึ่งถามเหมือนกันทุกชนิด */
  const sdTypes = [...incidentTypes, 'Problem', 'Change'];
  const platTypes = ['Epic', 'Story', 'Task', 'Bug', 'Sub-task'];
  await prisma.workflowScheme.createMany({
    data: [
      ...incidentTypes.map((n) => ({ tenantId, projectId: projectSd.id, issueTypeId: it(n).id, workflowId: wfIncident.id })),
      { tenantId, projectId: projectSd.id, issueTypeId: it('Problem').id, workflowId: wfProblem.id },
      { tenantId, projectId: projectSd.id, issueTypeId: it('Change').id, workflowId: wfChange.id },
      ...platTypes.map((n) => ({ tenantId, projectId: projectPlat.id, issueTypeId: it(n).id, workflowId: wfSoftware.id })),
    ],
  });

  // ---------- Field definitions ----------
  await prisma.fieldDefinition.createMany({
    data: [
      { tenantId, key: 'impact', name: 'ผลกระทบ', type: FieldType.SELECT, options: { values: ['ทั้งองค์กร', 'ทั้งแผนก', 'หลายคน', 'คนเดียว'] } },
      { tenantId, key: 'urgency', name: 'ความเร่งด่วน', type: FieldType.SELECT, options: { values: ['สูง', 'กลาง', 'ต่ำ'] } },
      { tenantId, key: 'service', name: 'บริการ', type: FieldType.SELECT, options: { values: ['Identity & Access', 'Network', 'Endpoint', 'Business Application', 'Printing'] } },
      { tenantId, key: 'root_cause', name: 'สาเหตุที่แท้จริง', type: FieldType.TEXTAREA },
      { tenantId, key: 'component', name: 'ส่วนประกอบ', type: FieldType.LABELS },
    ],
  });
  const fields = await prisma.fieldDefinition.findMany({ where: { tenantId } });
  await prisma.fieldConfig.createMany({
    data: sdTypes.flatMap((tn) =>
      fields
        .filter((f) => f.key !== 'component')
        .map((f, i) => ({
          tenantId,
          projectId: projectSd.id,
          issueTypeId: it(tn).id,
          fieldId: f.id,
          isRequired: f.key === 'impact' || f.key === 'urgency',
          position: i,
        })),
    ),
  });

  await prisma.projectCounter.createMany({
    data: [
      { tenantId, projectId: projectSd.id, lastValue: 0 },
      { tenantId, projectId: projectPlat.id, lastValue: 0 },
    ],
  });

  // ---------- Work items · 10,000 ใบ ----------
  const TOTAL = 10_000;
  const SD_COUNT = 7_000; // service desk มีปริมาณมากกว่าตามความเป็นจริง
  const ranksSd = distribute(SD_COUNT);
  const ranksPlat = distribute(TOTAL - SD_COUNT);

  // ใช้ชนิดที่ Prisma สร้างให้ ไม่ต้องคำนวณเอง — เวอร์ชันแรกผมเขียนเป็น
  // conditional type ที่ TypeScript resolve ไม่ออก ทำให้ทั้งบล็อกกลายเป็น any เงียบ ๆ
  // และ type safety ทั้งก้อนหายไปโดยไม่มี error ให้เห็น
  const rows: Prisma.WorkItemCreateManyInput[] = [];

  for (let i = 0; i < TOTAL; i += 1) {
    const isSd = i < SD_COUNT;
    const project = isSd ? projectSd : projectPlat;
    const seq = isSd ? i + 1 : i - SD_COUNT + 1;
    const rank = (isSd ? ranksSd[seq - 1] : ranksPlat[seq - 1])!;

    /*
      **สุ่มเฉพาะชนิดที่ใช้ workflow ของ Incident** — สถานะที่สุ่มมาจาก
      `incStatuses` ซึ่งเป็นของ workflow นั้น · ถ้าสุ่มชนิด Problem หรือ Change
      เข้ามาด้วย งานจะได้สถานะที่ไม่ได้อยู่ใน workflow ของตัวเอง ซึ่งเป็นข้อมูล
      ที่ขัดกันเองโดยไม่มีอะไรฟ้อง — หน้าจอจะไม่มีปุ่มให้กดเลยสักปุ่ม

      (ก่อนหน้านี้ทุกชนิดใน SD ใช้ workflow เดียวกัน การสุ่มทั้งสี่ชนิดจึงถูกต้อง
       ในตอนนั้น · พอแยก workflow แล้วเงื่อนไขนั้นหายไป)
    */
    const typeName = isSd ? pick(incidentTypes) : pick(platTypes);
    const statusPool = isSd ? incStatuses : swStatuses;
    // 62% ปิดแล้ว · ที่เหลือกระจายตามสถานะที่ยังเปิด — สัดส่วนใกล้เคียงงานจริง
    const closed = rnd(100) < 62;
    const status = closed
      ? statusPool.filter((s) => s.category === StatusCategory.DONE)[rnd(2) % statusPool.filter((s) => s.category === StatusCategory.DONE).length]!
      : pick(statusPool.filter((s) => s.category !== StatusCategory.DONE));

    // อายุของตั๋วต้องสะท้อนความจริง: **งานที่ยังเปิดอยู่กระจุกตัวช่วงล่าสุด**
    // ไม่ใช่กระจายทั้งปีเท่า ๆ กับงานที่ปิดไปแล้ว
    //
    // เวอร์ชันแรกสุ่มอายุแบบเดียวกันทั้งคู่ ผลคือเมื่อต่อ SLA Engine เข้ามา
    // 477 จาก 500 ใบขึ้นว่าหลุด SLA — ถูกตามนาฬิกา แต่เป็นข้อมูลที่เป็นไปไม่ได้จริง
    // และทำให้หน้าคิวไม่บอกอะไรเลยเพราะทุกแถวเป็นสีแดง
    const ageMs = closed
      ? rnd(365) * DAY + rnd(DAY) // ปิดแล้ว — กระจายทั้งปี
      : rnd(6) * DAY + rnd(DAY); // ยังเปิด — ไม่เกิน 6 วัน
    const createdAt = new Date(NOW - ageMs);
    const resolvedAt = closed ? new Date(createdAt.getTime() + (rnd(72) + 1) * 3_600_000) : null;

    const pool =
      typeName === 'Incident' ? INCIDENT_SUBJECTS
      : typeName === 'Service Request' ? REQUEST_SUBJECTS
      : STORY_SUBJECTS;

    rows.push({
      tenantId,
      itemKey: `${project.key}-${seq}`,
      projectId: project.id,
      issueTypeId: it(typeName).id,
      summary: subject(pool),
      statusId: status.id,
      priorityId: priorities[rnd(5)]!.id,
      resolutionId: closed ? resolutions[rnd(resolutions.length)]!.id : null,
      reporterId: isSd ? pick(endUsers).id : pick(devs).id,
      assigneeId: rnd(100) < 78 ? (isSd ? pick(agents).id : pick(devs).id) : null,
      rank,
      storyPoints: isSd ? null : [1, 2, 3, 5, 8, 13][rnd(6)]!,
      createdAt,
      updatedAt: resolvedAt ?? createdAt,
      resolvedAt,
    });
  }

  const BATCH = 1_000;
  for (let i = 0; i < rows.length; i += BATCH) {
    await prisma.workItem.createMany({ data: rows.slice(i, i + BATCH) });
    process.stdout.write(`\r  work item ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');

  /*
    ---------- งาน ITIL ตัวอย่าง ----------

    **จำเป็นต้องมี** ไม่ใช่ของประดับ · Problem กับ Change มี workflow ของตัวเอง
    แล้ว แต่ถ้าไม่มีงานสักใบ คนที่เปิดโปรเจกต์ดูจะสรุปว่าฟีเจอร์ยังไม่มี —
    ซึ่งเป็นความเชื่อที่หน้าจอสร้างขึ้นเอง แบบเดียวกับที่หน้าตั้งค่าเคยบอกว่า
    IT Support "แก้ไขหลายเรื่องพร้อมกัน" ได้

    สร้างหลังก้อนหลักเพราะต้องใช้สถานะจาก workflow ของตัวเอง ไม่ใช่ของ Incident
    และผูกกับเรื่องที่มีอยู่แล้ว เพื่อให้แผงผลกระทบมีของจริงให้แสดง
  */
  const itilStart = SD_COUNT + 1;
  const changeSpecs = [
    ['อัปเกรดเซิร์ฟเวอร์ฐานข้อมูลหลักเป็นรุ่นใหม่', 'ร่างคำขอ'],
    ['เปลี่ยนสวิตช์เครือข่ายชั้น 3', 'รออนุมัติ'],
    ['ย้ายระบบสำรองข้อมูลไปเครื่องใหม่', 'รออนุมัติ'],
    ['ติดตั้งแพตช์ความปลอดภัยประจำไตรมาส', 'รอถึงกำหนด'],
    ['ขยายพื้นที่จัดเก็บของระบบบัญชี', 'กำลังดำเนินการ'],
    ['เปลี่ยนใบรับรอง SSL ของเว็บภายใน', 'เสร็จแล้ว'],
  ] as const;
  const problemSpecs = [
    ['ผู้ใช้เข้าระบบไม่ได้เป็นช่วง ๆ ตอนเช้า', 'กำลังหาสาเหตุ'],
    ['เครื่องพิมพ์ชั้น 2 หลุดจากเครือข่ายซ้ำ ๆ', 'รู้สาเหตุแล้ว'],
    ['ระบบบัญชีช้าผิดปกติทุกสิ้นเดือน', 'รู้สาเหตุแล้ว'],
    ['อีเมลขาออกถูกตีกลับจากปลายทางบางแห่ง', 'แก้ที่ต้นเหตุแล้ว'],
  ] as const;

  const itilRows: Prisma.WorkItemCreateManyInput[] = [];
  let itilSeq = itilStart;
  for (const [summary, statusName] of changeSpecs) {
    const st = chBy(statusName);
    const created = new Date(NOW - rnd(60) * DAY);
    itilRows.push({
      tenantId,
      itemKey: `SD-${itilSeq}`,
      projectId: projectSd.id,
      issueTypeId: it('Change').id,
      summary,
      statusId: st.id,
      priorityId: priorities[rnd(5)]!.id,
      // ผลการแก้ไขผูกกับการปิดงาน — สถานะหมวด DONE เท่านั้นที่มีค่านี้
      resolutionId: st.category === StatusCategory.DONE ? resolutions[0]!.id : null,
      reporterId: pick(agents).id,
      assigneeId: pick(agents).id,
      rank: `zzz${String(itilSeq)}`,
      createdAt: created,
      updatedAt: created,
      resolvedAt: st.category === StatusCategory.DONE ? created : null,
    });
    itilSeq += 1;
  }
  for (const [summary, statusName] of problemSpecs) {
    const st = prBy(statusName);
    const created = new Date(NOW - rnd(120) * DAY);
    itilRows.push({
      tenantId,
      itemKey: `SD-${itilSeq}`,
      projectId: projectSd.id,
      issueTypeId: it('Problem').id,
      summary,
      statusId: st.id,
      priorityId: priorities[rnd(5)]!.id,
      resolutionId: st.category === StatusCategory.DONE ? resolutions[0]!.id : null,
      reporterId: pick(agents).id,
      assigneeId: pick(agents).id,
      rank: `zzz${String(itilSeq)}`,
      createdAt: created,
      updatedAt: created,
      resolvedAt: st.category === StatusCategory.DONE ? created : null,
    });
    itilSeq += 1;
  }
  await prisma.workItem.createMany({ data: itilRows });

  /*
    ผูกเรื่องที่มีอยู่เข้ากับปัญหาใบแรก — **แผงผลกระทบต้องมีของจริงให้แสดง**
    ไม่งั้นมันจะไม่ขึ้นเลยสักใบ แล้วไม่มีใครรู้ว่ามันมีอยู่

    เลือกจากเรื่องที่ยังเปิดอยู่ เพื่อให้ตัวเลข "ยังค้างอยู่" ไม่เป็นศูนย์
  */
  const firstProblem = await prisma.workItem.findFirstOrThrow({
    where: { tenantId, itemKey: `SD-${String(itilStart + changeSpecs.length)}` },
    select: { id: true },
  });
  const victims = await prisma.workItem.findMany({
    where: { tenantId, projectId: projectSd.id, resolvedAt: null, issueTypeId: it('Incident').id },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 5,
  });
  await prisma.workItemLink.createMany({
    data: victims.map((v) => ({
      tenantId,
      sourceId: firstProblem.id,
      targetId: v.id,
      type: LinkType.CAUSES,
    })),
  });

  await prisma.projectCounter.update({ where: { projectId: projectSd.id }, data: { lastValue: itilSeq - 1 } });
  await prisma.projectCounter.update({ where: { projectId: projectPlat.id }, data: { lastValue: TOTAL - SD_COUNT } });

  /*
    ---------- ผูกลำดับชั้น Epic → เรื่องหลัก → งานย่อย ----------

    ทำ **หลังสุด** เพื่อไม่ขยับสายตัวสุ่มหลัก — ข้อมูลทุกแถวข้างบนจึงยังเล่นซ้ำ
    ได้ค่าเดิมเป๊ะ ซึ่งเป็นทางเดียวที่ใช้กู้ค่าที่ถูกแก้ผิดกลับมาได้ (ดู CLAUDE.md §9)

    เดิมไม่มีขั้นนี้เลย ผลคือ 0 จาก 10,000 แถวมีแม่ ทั้งที่มี Epic 616 ใบ
    และ Sub-task 647 ใบอยู่จริง — ฟีเจอร์ที่อ่านสายแม่-ลูกจึงดูว่างเปล่าเสมอ
  */
  await applyHierarchy(prisma);

  // ---------- ยืนยันสิ่งที่ ADR-002 เตือน ----------
  // ลำดับที่ MySQL คืนด้วย ORDER BY rank ต้องตรงกับลำดับฝั่ง application เป๊ะ
  // ถ้า collation ไม่ใช่ utf8mb4_bin ข้อนี้จะพัง — และจะพังแบบเงียบ ๆ
  const fromDb = await prisma.workItem.findMany({
    where: { tenantId, projectId: projectSd.id },
    select: { rank: true },
    orderBy: { rank: 'asc' },
    take: 3_000,
  });
  const appSorted = [...fromDb].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  const mismatch = fromDb.findIndex((r, i) => r.rank !== appSorted[i]!.rank);
  if (mismatch !== -1) {
    throw new Error(
      `ADR-002 ถูกละเมิด: ลำดับจาก MySQL ไม่ตรงกับฝั่ง application ที่ตำแหน่ง ${mismatch} — ` +
        `ตรวจ collation ของ work_item.rank ว่าเป็น utf8mb4_bin หรือไม่`,
    );
  }

  const counts = {
    work_item: await prisma.workItem.count({ where: { tenantId } }),
    open: await prisma.workItem.count({ where: { tenantId, resolvedAt: null } }),
    users: await prisma.user.count({ where: { tenantId } }),
  };
  console.log(`  ✓ ADR-002 ยืนยันแล้ว: ลำดับ rank จาก MySQL ตรงกับฝั่ง application (${fromDb.length} แถว)`);
  console.log(
    `เสร็จใน ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
      `work item ${counts.work_item} (เปิดอยู่ ${counts.open}) · ผู้ใช้ ${counts.users}`,
  );
  void systemUser;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
