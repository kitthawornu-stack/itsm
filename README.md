# Helix — ITSM + Project Management Platform

ระบบ ITSM ตามมาตรฐาน ITIL 4 ผสานกับ Project Management ระดับเดียวกับ Jira
บนโมเดลข้อมูล Work Item เดียวกัน

| | |
|---|---|
| **Stack** | Next.js 15 · NestJS 11 · MySQL 8 · OpenSearch · Redis · MinIO |
| **Deployment** | Hybrid — On-Premise (single-tenant) ก่อน แล้วขยายเป็น SaaS multi-tenant |
| **ระยะเวลา** | 10 เดือน · 6 เฟส · Pilot go-live เดือนที่ 4 |
| **ทีม** | 6 FTE · เขียนโค้ดแบบ AI-first (ไม่มีตำแหน่ง junior) |

## เอกสาร

| เอกสาร | ใช้เมื่อ |
|---|---|
| [master-plan.html](docs/master-plan.html) | **แผนหลักฉบับเต็ม** — สถาปัตยกรรม โครงสร้างข้อมูล เอนจิน 4 ตัว โรดแมป UX/UI ทุกหน้าจอ ความเสี่ยง (เปิดในเบราว์เซอร์) |
| [docs/adr/](docs/adr/) | บันทึกการตัดสินใจเชิงสถาปัตยกรรม — ต้องเซ็นรับก่อนเริ่ม Phase 0 |
| [docs/jira-parity-checklist.md](docs/jira-parity-checklist.md) | **เครื่องมือคุมขอบเขต** — อะไรอยู่ใน v1.0 อะไรไม่อยู่ |

## หลักคิด 6 ข้อ

1. **Single Work Item Model** — Incident, Task, Story, Change คือของสิ่งเดียวกัน ต่างกันที่ Issue Type + Workflow + Field Config
2. **Scheme over Hardcode** — ทุกพฤติกรรมมาจากคอนฟิกในฐานข้อมูล ไม่ใช่ if-else ในโค้ด
3. **Queue-first** — คนทำงานอยู่กับรายการ 90% ของเวลา ออกแบบรายการก่อนฟอร์มเสมอ
4. **Audit by Default** — ทุกการเปลี่ยนแปลงตอบได้ว่าใคร ทำอะไร เมื่อไหร่
5. **API-first** — หน้าเว็บของเราคือลูกค้ารายแรกของ API ตัวเอง ไม่มี endpoint ลับ
6. **Multi-tenant ตั้งแต่ตารางแรก** — `tenant_id` ทุกตาราง แม้เฟสแรกจะ deploy tenant เดียว

## โครงสร้าง Monorepo (เป้าหมาย)

```
apps/
  web/          Next.js 15 — Agent Console + Service Portal + Admin
  api/          NestJS 11 — 16 โมดูล (modular monolith)
  worker/       BullMQ consumers — SLA timer, automation, indexer, email
packages/
  ui/           Design System + Storybook (48 components)
  hql/          Lexer/Parser/Compiler ของภาษาคิวรี HQL
  types/        Shared TypeScript types + Zod schemas
  config/       eslint / tsconfig / tailwind preset
infra/
  compose/      Docker Compose สำหรับ dev และ on-prem bundle
  helm/         Helm chart สำหรับ SaaS
  migrations/   Prisma migrations + gh-ost runbook
docs/
```

## เริ่มต้น

โปรเจกต์ยังอยู่ในขั้นวางแผน ยังไม่มีโค้ด — งานสองสัปดาห์แรกอยู่ในส่วน
"Part 11 · เริ่มได้เลยสัปดาห์นี้" ของ [master-plan.html](docs/master-plan.html)

**สิ่งที่ต้องเสร็จก่อนเขียนฟีเจอร์แรก:**

- [ ] ADR-001 ถึง ADR-005 ได้รับการเซ็นรับ
- [ ] ERD ของ 15 ตารางแกน ผ่านการรีวิวทั้งทีม
- [ ] Jira Parity Checklist ลงนามร่วมกันระหว่าง PO และ Tech Lead
- [ ] Spike A–D ผ่านครบทั้ง 4 ตัว (Workflow Engine, Custom Field EAV, Thai search, LexoRank)
- [ ] Seed data 10,000 work item ที่สมจริง พร้อมใช้ตลอดโครงการ
- [ ] `CLAUDE.md` ที่มีขอบเขตโมดูล invariant ทั้ง 6 ข้อ และตัวอย่างโค้ดที่ถูกต้อง
- [ ] Lint rules ครบชุด (import boundary, สีดิบ, เทสต์ข้าม tenant, เพดานขนาด PR)
- [ ] `packages/ui` 48 คอมโพเนนต์เสร็จ **ก่อน** หน้าจอแรก
- [ ] สัมภาษณ์ผู้ใช้จริง 5 คน บันทึกงานที่เขาทำจริงในหนึ่งวัน

## ⚠ ก่อนอนุมัติงบ

[master-plan.html](docs/master-plan.html) **Part 12 · Business Case** สรุปว่าที่ขนาด
ผู้ใช้ < 100 คน / ทีม IT < 10 คน และยังไม่ตัดสินเรื่องการนำไปขาย:

| | 3 ปี | 5 ปี |
|---|---|---|
| ซื้อของสำเร็จ | 0.6–1.3 ล้านบาท | 1.6–2.2 ล้านบาท |
| สร้างเอง · AI-first (แผนนี้) | 13.2 ล้านบาท | 16.6 ล้านบาท |
| สร้างเอง · แบบเดิม | 22.1 ล้านบาท | 28.1 ล้านบาท |

**Helix เต็มรูปแบบยังไม่คุ้มสำหรับใช้ภายในอย่างเดียว** — AI ลดต้นทุนเกือบครึ่ง
แต่ยังแพงกว่าการซื้อราว 9 เท่าที่ 5 ปี ความคุ้มค่ายังต้องมาจากการนำไปขาย
จุดคุ้มทุน ~28 ลูกค้าที่ 300,000 บาท/ปี (เดิม 42)

**แต่ AI เปลี่ยนข้อสรุปหนึ่งข้อ** — [**Helix Lite**](docs/master-plan.html) ที่ **1.4 ล้านบาท / 3 เดือน / 2.8 FTE**
ตอนนี้อยู่ในช่วงเดียวกับค่า license 3–5 ปีแล้ว จึงเป็นการสร้างที่ป้องกันตัวเองได้ในการรีวิวงบ
โดยไม่ต้องรอคำตอบเรื่องตลาด

> **Part 13 · AI-First Delivery** อธิบายว่าอะไรเร่งได้แค่ไหน — ค่าเฉลี่ยถ่วงน้ำหนักของโครงการนี้
> คือ **2.2–2.6×** ไม่ใช่ 5× และ **เอนจินทั้ง 4 ตัวซึ่งเป็นแกนกลางของระบบ คือจุดที่ AI ช่วยได้น้อยที่สุด (1.2–1.5×)**
