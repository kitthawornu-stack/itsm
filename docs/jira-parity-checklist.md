# Jira Parity Checklist — เอกสารคุมขอบเขต v1.0

**สถานะ:** 🟡 ร่าง — รอลงนาม · **ต้องลงนามก่อนเริ่ม Phase 0**

| ผู้ลงนาม | บทบาท | วันที่ |
|---|---|---|
| _________ | Product Owner | _______ |
| _________ | Tech Lead | _______ |
| _________ | Sponsor | _______ |

---

## ทำไมต้องมีเอกสารนี้

ความเสี่ยงอันดับหนึ่งของโครงการนี้คือประโยคว่า **"ให้เหมือน Jira"**
Jira สะสมฟีเจอร์มา 20 ปี การไล่เทียบทีละอย่างจะไม่มีวันจบ และทีมจะรู้สึกว่าทำเท่าไรก็ไม่พอ

เอกสารนี้เปลี่ยนคำว่า "เหมือน Jira" ให้เป็นรายการที่ตรวจได้
**อะไรที่ไม่อยู่ในตาราง ✅ ด้านล่าง ถือว่าไม่อยู่ในขอบเขต v1.0**

---

## ✅ อยู่ใน v1.0

### Work Item
- [ ] Issue Type ที่แอดมินสร้างเองได้ + ไอคอนต่อประเภท
- [ ] ลำดับชั้น Epic → Story → Sub-task (ลึกสุด 3 ชั้น)
- [ ] Issue Link 6 ชนิด (relates to, blocks, is blocked by, duplicates, causes, is caused by)
- [ ] Custom Field 14 ชนิด
- [ ] คอมเมนต์ + rich text + mention + ไฟล์แนบ
- [ ] Watcher + Vote
- [ ] ประวัติการแก้ไขทุกฟิลด์
- [ ] Bulk edit (มอบหมาย · เปลี่ยนสถานะ · เปลี่ยนความสำคัญ · ติดป้าย · ย้ายโปรเจกต์)
- [ ] Clone งาน
- [ ] Time tracking (original / spent / remaining) + Worklog

### Board & Plan
- [ ] Scrum Board + Kanban Board
- [ ] Swimlane (Epic / Assignee / Priority / ไม่มี)
- [ ] WIP Limit + การเตือนเมื่อเกิน
- [ ] Quick Filter ที่กำหนดเองได้ด้วย HQL
- [ ] ปรับหน้าการ์ดได้ (เลือกว่าจะแสดงฟิลด์อะไร)
- [ ] Backlog + Sprint + วางแผน Sprint
- [ ] Sprint Goal + ย้ายงานค้างอัตโนมัติตอนปิด Sprint
- [ ] Roadmap / Timeline (Gantt) + Dependency + Milestone
- [ ] Version / Release + Release Note อัตโนมัติ
- [ ] Component + Label

### Search & Report
- [ ] HQL (ภาษาคิวรีแบบ JQL) + Saved Filter + แชร์ filter
- [ ] Dashboard + Gadget 18 ชนิด + Wallboard
- [ ] Agile Report 8 ตัว (Burndown, Burnup, Velocity, CFD, Sprint Report, Control Chart, Epic Report, Release Burndown)
- [ ] Report Builder แบบ pivot
- [ ] Scheduled export (PDF / XLSX / CSV)

### Admin
- [ ] Workflow Editor แบบลากวาง + Condition / Validator / Post Function
- [ ] Field Scheme + Screen Scheme
- [ ] Permission Scheme (ระดับโปรเจกต์และระดับฟิลด์)
- [ ] Notification Scheme
- [ ] Automation Rule Builder แบบ no-code
- [ ] REST API v1 + OpenAPI + Webhook
- [ ] SSO (SAML / OIDC) + LDAP sync
- [ ] Audit Log

### สิ่งที่ Jira **ไม่มี** แต่เราจะมี
- [ ] ITSM ครบตาม ITIL 4 ในผลิตภัณฑ์เดียวกัน ไม่ต้องซื้อแยก
- [ ] CMDB + Impact Analysis ที่ผูกกับ Incident โดยตรง
- [ ] SLA Engine ที่รู้จักวันหยุดราชการไทยและวันหยุดชดเชย
- [ ] แจ้งเตือนผ่าน LINE Messaging API
- [ ] ส่วนติดต่อผู้ใช้และเอกสารภาษาไทยเต็มรูปแบบ ค้นหาภาษาไทยได้แม่นจริง
- [ ] รองรับปีพุทธศักราช

---

## ❌ ไม่อยู่ใน v1.0 — พิจารณาใหม่หลัง GA

| สิ่งที่ไม่ทำ | เหตุผล | พิจารณาเมื่อ |
|---|---|---|
| Marketplace / Plugin SDK สำหรับบุคคลที่สาม | ต้องมี security sandbox, versioning, และ ecosystem ที่ใช้เวลาสร้างเป็นปี | มีลูกค้า 20 รายขึ้นไป |
| Script Runner (รันโค้ดที่ผู้ใช้เขียน) | ความเสี่ยงด้านความปลอดภัยสูงมาก · Automation Rule Builder ครอบคลุม 90% ของความต้องการจริง | มีคำขอชัดเจนจากลูกค้าที่จ่ายได้ |
| Confluence-class wiki | เราทำ Knowledge Base ที่ผูกกับตั๋วเท่านั้น ไม่ทำระบบเอกสารทั่วไป | ไม่วางแผนทำ |
| Advanced Roadmaps / Portfolio ข้ามหลายโปรเจกต์ | ซับซ้อนมากและมีผู้ใช้จริงน้อยกว่าที่คิด | หลัง GA อย่างน้อย 6 เดือน |
| Mobile native app (iOS / Android) | ใช้ PWA ก่อน ซึ่งครอบคลุมงานที่คนทำบนมือถือจริง (ดูตั๋ว · คอมเมนต์ · เปลี่ยนสถานะ) | มีข้อมูลการใช้งานบนมือถือจริงมาสนับสนุน |
| Issue Security Level (ซ่อนตั๋วบางใบจากบางคนในโปรเจกต์เดียวกัน) | ซับซ้อนสูงและกระทบทุกคิวรี · Permission Scheme ระดับโปรเจกต์เพียงพอสำหรับลูกค้าเป้าหมาย | มีลูกค้าที่ต้องการจริงและยอมจ่ายเพิ่ม |
| Custom Field แบบคำนวณ / สูตร | ต้องมี expression engine และการจัดการ dependency ที่ซับซ้อน | หลัง GA |
| Localization นอกจากไทย/อังกฤษ | ไม่มีตลาดในแผน 2 ปีแรก | มีลูกค้าต่างประเทศจริง |

---

## กติกาการเปลี่ยนขอบเขต

1. คำขอใหม่ทุกข้อเข้า backlog พร้อมการประมาณการ — **ไม่มีการ "เพิ่มนิดเดียว"**
2. การเพิ่มสิ่งใดเข้า v1.0 ต้อง **แลกออก** สิ่งที่มีขนาดใกล้เคียงกันเสมอ
   ผู้อนุมัติการแลกคือ PO และต้องบันทึกไว้ท้ายเอกสารนี้
3. ทบทวนขอบเขตอย่างเป็นทางการ **ทุกสิ้นเฟสเท่านั้น** ไม่ใช่ทุกสัปดาห์
4. ถ้าสิ้นเฟสไหนไม่ผ่าน Exit Criteria ต้องตัดสินใจอย่างเป็นทางการว่า
   **ยืดเวลา หรือ ตัดขอบเขต** — ห้ามเริ่มเฟสถัดไปโดยปล่อยเฟสเดิมค้าง

## บันทึกการเปลี่ยนขอบเขต

| วันที่ | เพิ่มเข้า | แลกออก | ผู้อนุมัติ |
|---|---|---|---|
| | | | |
