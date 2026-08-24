# CLAUDE.md — กติกาสำหรับการเขียนโค้ดในโปรเจกต์นี้

> โปรเจกต์นี้เขียนโค้ดแบบ **AI-first** เอกสารนี้คือกรอบที่ AI ต้องทำงานอยู่ภายใน
> อ่านให้จบก่อนแก้โค้ดใด ๆ · ถ้าพบว่า AI ทำผิดกฎข้อไหนซ้ำ **ให้เพิ่มกฎข้อนั้นที่นี่ทันที**
> แผนหลักฉบับเต็ม: [docs/master-plan.html](docs/master-plan.html)

---

## 1. Invariant — ห้ามละเมิดเด็ดขาด

กฎหกข้อนี้ถูกบังคับด้วยเครื่องมือ ไม่ใช่ด้วยความจำ **ถ้าเขียนผิด CI ต้องแดง**

| # | Invariant | ผลถ้าหลุด |
|---|---|---|
| 1 | ทุกคิวรีต้องมี `tenant_id` scope | **ข้อมูลรั่วข้ามองค์กร** |
| 2 | ทุก mutation ต้องเขียน `work_item_history` / `audit_log` ในทรานแซกชันเดียวกัน | ตรวจสอบย้อนหลังไม่ได้ |
| 3 | สิทธิ์ระดับฟิลด์ต้องตรวจก่อน serialize | ฟิลด์ลับหลุดผ่าน API แม้ UI ซ่อน |
| 4 | ห้ามค่าสีดิบใน `packages/ui` — ใช้ semantic token เท่านั้น | ธีมมืดพังเป็นจุด ๆ ที่หาไม่เจอ |
| 5 | ห้าม import ข้ามขอบเขตโมดูล นอกทาง `index.ts` | modular monolith กลายเป็น big ball of mud |
| 6 | เวลาทุกค่าเก็บและส่งเป็น **UTC** เสมอ | SLA คำนวณผิดทั้งระบบ |

### 1.1 tenant scope

- **ห้าม** export Prisma client ดิบออกจาก repository layer
- ทุก repository รับ `TenantContext` และส่งต่อให้ Prisma extension ที่ inject `where: { tenantId }` ให้อัตโนมัติ
- ถ้าต้องเขียนคิวรีที่ข้าม tenant จริง (มีแค่งาน admin ระดับระบบ) ต้องเรียกผ่าน
  `withSystemScope()` ที่ประกาศเจตนาชัดเจน และต้องมีคอมเมนต์อธิบายเหตุผล
- มีชุดทดสอบที่ **พยายามอ่านข้าม tenant แล้วต้องล้มเหลว** — รันทุก PR ห้ามข้าม

### 1.2 เวลา

- เก็บเป็น `DATETIME(3)` UTC — **ไม่ใช่** `TIMESTAMP` (จำกัดถึงปี 2038)
- ในโค้ดใช้ branded type `UtcDate` จาก `@itsm/types` ไม่ใช่ `Date` ดิบ
- แปลง timezone **ที่ชั้นแสดงผลเท่านั้น**

---

## 2. สถาปัตยกรรม

```
apps/api      NestJS 11 · modular monolith · 16 โมดูล
apps/web      Next.js 15 App Router · Agent Console + Service Portal + Admin
apps/worker   BullMQ consumers · SLA timer, automation, indexer, email
packages/ui   Design System + Storybook (48 components)
packages/hql  Lexer/Parser/Compiler ของภาษาคิวรี HQL → OpenSearch DSL
packages/types Shared types + Zod schemas + branded types
infra/compose  Docker Compose สำหรับ dev และ on-prem bundle
```

### ขอบเขตโมดูล (ADR-004)

- แต่ละโมดูลมี `index.ts` ที่ export **เฉพาะ Application Service**
- ห้าม export repository, Prisma entity, หรือ Prisma client
- โมดูลคุยกันผ่าน method call หรือ domain event เท่านั้น
- **ห้าม JOIN ข้ามขอบเขตโมดูลใน SQL** — ต้องการข้อมูลจากอีกโมดูลให้เรียก service ของมัน
- บังคับด้วย ESLint `import/no-restricted-paths`

### กลุ่มโมดูล

| กลุ่ม | โมดูล |
|---|---|
| Platform | `identity` `tenancy` `permission` `audit` |
| Core | `workitem` `workflow` `field` `link` |
| Service | `sla` `catalog` `approval` `cmdb` |
| Delivery | `board` `sprint` `version` |
| Edge | `search-index` `automation` `notification` `integration` |
| Insight | `reporting` |

---

## 3. โมเดลข้อมูล

**Single Work Item Model** — Incident, Service Request, Story, Change, Task
ทั้งหมดอยู่ในตาราง `work_item` ตารางเดียว ความต่างมาจาก `issueTypeId` + Workflow + Field Config
ที่ผูกกับ **project** ไม่ใช่จากตารางคนละใบ

### MySQL — ข้อจำกัดที่ต้องจำ

- **ไม่มี partial index** → ใช้ generated column แล้ว index บนคอลัมน์นั้น
- **ไม่มี array type** → custom field หลายค่าเก็บใน bridge table ไม่ใช่ JSON ที่ query ไม่ลง index
- `utf8mb4` = 4 ไบต์/อักขระ · index prefix ยาวสุด 3072 ไบต์ → ระวัง composite index ที่มี VARCHAR ยาว
- DDL บนตารางใหญ่ล็อกนาน → migration ที่แตะ `work_item` บน production ใช้ **gh-ost**
- `rank` ใช้ collation `utf8mb4_bin` เท่านั้น (LexoRank ต้องเทียบแบบ binary)
- **`rank` เป็น reserved word ใน MySQL 8** (window function) — raw SQL และคำสั่ง gh-ost
  ต้องครอบด้วย backtick เสมอ (``ORDER BY `rank` ``) มิฉะนั้นได้ syntax error · Prisma ใส่ให้เองอยู่แล้ว
- ก่อนเพิ่มคิวรีใหม่ที่หน้าจอเรียกบ่อย **ต้องรัน EXPLAIN บน seed data 10,000 แถว**
  และดูค่า `filtered` — ถ้าต่ำกว่า 50% แปลว่า index ไม่ครอบ predicate + ORDER BY
  (ตัวอย่างจริง: คิวรีหน้า Agent Queue เริ่มที่ filtered 7% ต้องเพิ่ม
  `@@index([tenantId, projectId, resolvedAt, updatedAt])` จึงขึ้นเป็น 100%)

### Custom field (ADR-001)

- แหล่งความจริง = `work_item_field_value` (EAV, แยกคอลัมน์ตามชนิด)
- `work_item.fieldSnapshot` (JSON) = สำเนา **อ่านอย่างเดียว** สำหรับเรนเดอร์ลิสต์
- **ห้ามอ่าน snapshot ไปเขียนต่อ** — เขียนต้องผ่าน EAV เสมอ
- snapshot ไม่ expose ออกจาก repository layer

### การค้นหา (ADR-005)

- **OpenSearch เป็นแหล่งค้นหาเดียว ไม่มี MySQL fallback**
- MySQL FULLTEXT ตัดคำไทยไม่ได้ ("ลืมรหัสผ่านเข้าระบบ" หาคำว่า "รหัสผ่าน" ไม่เจอ)
  วัดจริงแล้ว: `standard` tokenizer คืนทั้งประโยคเป็น **1 token**
- กรอง `tenantId` และ `projectId` ใน **filter context** ไม่ใช่ query context

#### กับดักการตัดคำไทยที่วัดมาแล้ว — ทั้งหมดเป็นความล้มเหลวแบบเงียบ

- **ห้ามใช้ analyzer `thai` สำเร็จรูป** — stopword list ของมันตัด "ผ่าน" "เข้า"
  "ไม่" "ได้" ทิ้ง (7 token เหลือ 3) ทำให้ "เข้าระบบไม่ได้" กับ "เข้าระบบได้"
  กลายเป็นสิ่งเดียวกัน ซึ่งกลับความหมาย · ใช้ `thai_text` ที่ประกอบเองใน `index-mapping.ts`
- **ห้ามตั้ง `token_chars: ['letter','digit']` บน ngram tokenizer** — สระและ
  วรรณยุกต์ไทยเป็น Unicode Mark ไม่ใช่ Letter ผลคือคำค้น "รีเซ็ต" ให้ token **ว่างเปล่า**
  และฟิลด์ ngram ไม่เคยตรงเลยแม้แต่ครั้งเดียว โดยไม่มี error ให้เห็น
- **ต้องมี `minimum_should_match`** — ถ้าไม่ใส่ คำค้นที่ไม่เกี่ยวข้องเลยจะคืนผลลัพธ์
  เพราะ n-gram เพียงชิ้นเดียวที่บังเอิญตรงก็นับเป็น hit · ค่าปัจจุบัน 75% (หลัก) / 80% (ngram)
  วัดบนข้อมูลจริง 10,000 ใบ **ต้องทบทวนด้วย log คำค้นจริงหลัง pilot**
- `analysis-icu` ไม่ได้ติดตั้งใน image มาตรฐาน — อย่าพึ่ง `icu_tokenizer`

### Seed data และการสุ่ม

- **ห้ามใช้ LCG แบบ `(s * 1103515245 + 12345)` ใน JavaScript** — ตัวเลขเป็น double
  53 บิต ผลคูณจึงเกินและสูญเสียบิตล่างที่มีความสุ่ม
  ผลจริงที่เกิดขึ้น: 10,000 แถวมี summary ที่ไม่ซ้ำเพียง **19 แบบ** และ placeholder
  ได้ค่าเดิมตลอด ทำให้การทดสอบค้นหาทั้งหมดที่รันบนข้อมูลนั้นไม่มีความหมาย
  ใช้ **mulberry32** ที่ใช้ `Math.imul` แทน
- ตรวจความหลากหลายของ seed ทุกครั้งที่แก้:
  `SELECT COUNT(DISTINCT summary), COUNT(*) FROM work_item`
- **ห้ามพึ่ง cascade ของ `tenant` ในการล้างข้อมูล** — `workflow_scheme → workflow`
  เป็น `onDelete: Restrict` โดยตั้งใจ ลำดับ cascade ของ MySQL จึงชนกันและได้ P2003
  ต้องลบตามลำดับเองใน `seed.ts`

---

## 4. กติกาการส่งงาน

### ขนาด PR

**ไม่เกิน 400 บรรทัด** — บังคับด้วย CI
AI ผลิต PR 2,000 บรรทัดได้ง่ายมาก แต่ไม่มีใครรีวิวได้จริง คนจะกด approve ทั้งที่ไม่ได้อ่าน
ถ้างานใหญ่กว่านั้น ให้แตกเป็นหลาย PR ที่แต่ละใบสมบูรณ์ในตัว

### Definition of Done

- [ ] ผู้รีวิว **อธิบายได้** ว่าโค้ดทำงานอย่างไรและทำไมถึงถูก — ไม่ใช่แค่ "เทสต์ผ่าน"
- [ ] ผู้รีวิว **ไม่ใช่คนที่สั่ง AI เขียนโค้ดชิ้นนั้น**
- [ ] มี unit + integration test · E2E ถ้าเป็น critical path
- [ ] ผ่าน lint invariant ทั้งหมด (tenant scope, audit, สีดิบ, module boundary)
- [ ] มีสถานะ empty / loading / error / no-permission ครบ (ถ้าเป็น UI)
- [ ] a11y ผ่าน — keyboard navigation + contrast **ทั้งธีมสว่างและมืด**
- [ ] ถ้าแตะ auth / permission / tenant → **Tech Lead อนุมัติ**

### เอนจิน 4 ตัว — กลับลำดับการทำงาน

`workflow` · `sla` · `hql` · LexoRank เป็นงานที่ AI ช่วยได้น้อยที่สุด (1.2–1.5×)
เพราะความผิดพลาด **ไม่ทำให้ระบบพัง แต่ทำให้ระบบตอบผิดอย่างเงียบ ๆ**

> **เขียนชุดทดสอบเป็นข้อกำหนดก่อน แล้วจึงให้ AI เขียนโค้ดให้ผ่าน**
> ไม่ใช่ให้ AI เขียนโค้ดแล้วค่อยให้มันเขียนเทสต์ตาม —
> เทสต์ที่เขียนหลังโค้ดจะสะท้อนสิ่งที่โค้ดทำ ไม่ใช่สิ่งที่โค้ดควรทำ

120 เคสของ SLA Engine ต้องเสร็จ **ก่อน** โค้ด SLA บรรทัดแรก

---

## 5. ภาษาไทย

- `line-height` ขั้นต่ำ **1.6** ทุกที่ที่มีข้อความไทย (สระบน+วรรณยุกต์ซ้อนสองชั้น)
- ตั้ง `word-break: break-word` + `overflow-wrap: anywhere` ในเซลล์ตาราง
  — ภาษาไทยไม่มีช่องว่างระหว่างคำ ข้อความจะดันตารางล้น
- **ห้าม** `text-transform: uppercase` กับข้อความไทย
- ป้ายกำกับไทยยาวกว่าอังกฤษเฉลี่ย 1.3 เท่า — ออกแบบปุ่มและคอลัมน์เผื่อไว้
- ข้อความที่ผู้ใช้เห็นเป็น **ภาษาคน** ไม่ใช่ศัพท์ระบบ:
  "แจ้งปัญหา" ไม่ใช่ "Create Incident" · "กำลังดำเนินการ" ไม่ใช่ "In Progress"

---

## 6. UI

- ใช้คอมโพเนนต์จาก `packages/ui` เท่านั้น — **ห้ามประดิษฐ์คอมโพเนนต์ใหม่**
  ถ้าไม่มีที่ต้องการ ให้เพิ่มเข้า `packages/ui` พร้อม story ก่อน แล้วจึงใช้
- สีอ้างได้เฉพาะ **semantic token** (`--surface`, `--text-muted`, `--status-critical`)
  ห้าม hex, `rgb()`, ชื่อสี Tailwind (`bg-red-500`)
- ธีมมี **สามสถานะ**: `light` / `dark` / ตามระบบ (ไม่ใส่ attribute)
  — สีทุกตัวต้องนิยามใน `:root` เปล่าก่อน แล้วจึง override ใน media query และ `[data-theme]`
- ทุก action ที่ทำวันละเกิน 20 ครั้งต้องมีคีย์ลัด
- Board ต้องย้ายการ์ดด้วยคีย์บอร์ดได้ (WCAG — drag-and-drop อย่างเดียวไม่ผ่าน)

### กลไกที่บังคับข้อข้างบน

- **Stylelint** (`.stylelintrc.json`) ห้ามค่าสีดิบในทุกไฟล์ CSS
  ยกเว้นไฟล์เดียวคือ `packages/ui/src/styles/tokens.css` ซึ่งเป็นชั้น primitive ตามนิยาม
- **`packages/ui/src/styles/tokens.spec.ts`** ตรวจอัตโนมัติ 39 เคส:
  - ทุก semantic token นิยามใน `:root` เปล่าก่อน — จับบั๊กที่สีถูกนิยามเฉพาะใน
    media query ซึ่งทำให้ผู้ใช้สถานะ "ตามระบบ" (คนส่วนใหญ่) ได้สีผิดธีม
  - บล็อก `[data-theme="dark"]` มีค่าตรงกับบล็อก media query ทุกตัว
  - **contrast ผ่าน WCAG AA ทั้งสองธีม** — จุดที่ทีมส่วนใหญ่ตรวจแค่ธีมสว่างแล้วปล่อยผ่าน
  - `line-height` ไม่ต่ำกว่า 1.6 และ `body` ตั้ง `overflow-wrap: anywhere`

เพิ่ม token ใหม่ต้องเพิ่มครบ **สามที่**: `:root`, media query, `[data-theme="dark"]`
มิฉะนั้นเทสต์จะแดง

---

## 7. คำสั่งที่ใช้บ่อย

```bash
pnpm dev                      # รัน web + api + worker พร้อมกัน
pnpm --filter @itsm/api dev   # รันเฉพาะ api
pnpm db:up                    # docker compose up -d (MySQL/Redis/OpenSearch/MinIO/Mailpit)
pnpm db:down                  # หยุด containers
pnpm db:migrate               # prisma migrate dev
pnpm db:studio                # prisma studio
pnpm --filter @itsm/api seed  # seed data 10,000 work item (~3 วินาที)
pnpm lint                     # eslint + stylelint ทุก workspace
pnpm typecheck                # tsc --noEmit ทุก workspace
pnpm test                     # unit + integration
```

ฐานข้อมูลชื่อ **`itsm`** · MySQL 8 ในคอนเทนเนอร์ที่ **`localhost:3307`** · user `itsm` / `itsm_dev` (dev เท่านั้น)

> พอร์ต 3307 ไม่ใช่ 3306 เพราะเครื่องพัฒนามี MySQL ของระบบ (service `MySQL80`) ครอง 3306 อยู่
> ต้องเปิด Docker Desktop ก่อนรัน `pnpm db:up`

---

## 8. สิ่งที่ห้ามทำ

- ❌ เขียนค่าสีดิบในคอมโพเนนต์
- ❌ คิวรีที่ไม่มี tenant scope
- ❌ mutation ที่ไม่เขียน audit
- ❌ `import` ข้ามโมดูลนอกทาง `index.ts`
- ❌ ใช้ `Date` ดิบแทน `UtcDate`
- ❌ `as any` / `@ts-ignore` — ถ้าจำเป็นจริงต้องมีคอมเมนต์อธิบายและ Tech Lead อนุมัติ
- ❌ `TIMESTAMP` ใน schema (ใช้ `DATETIME(3)`)
- ❌ ประดิษฐ์คอมโพเนนต์ UI ใหม่นอก `packages/ui`
- ❌ MySQL FULLTEXT สำหรับการค้นหา
- ❌ PR เกิน 400 บรรทัด
- ❌ เพิ่มฟีเจอร์ที่ไม่อยู่ใน [Jira Parity Checklist](docs/jira-parity-checklist.md)
