# Architecture Decision Records

บันทึกการตัดสินใจเชิงสถาปัตยกรรมที่ **แก้ทีหลังแพงมากหรือแก้ไม่ได้เลย**
ทุกฉบับต้องได้รับการเซ็นรับจาก Tech Lead + PO ก่อนเริ่ม Phase 0

| ADR | หัวข้อ | สถานะ | เจ้าของ |
|---|---|---|---|
| [001](ADR-001-custom-field-storage.md) | วิธีเก็บ Custom Field | 🟢 ยอมรับ (Spike B · snapshot เร็วกว่า 7.4x) | Tech Lead |
| [002](ADR-002-lexorank.md) | การจัดลำดับงานด้วย LexoRank | 🟢 ยอมรับ (Spike D · 19 เคสผ่าน) | Tech Lead |
| [003](ADR-003-identity.md) | Keycloak หรือ In-house Auth | 🔴 ต้องตัดสิน | Tech Lead |
| [004](ADR-004-modular-monolith.md) | Modular Monolith ไม่ใช่ Microservices | 🟡 ร่าง | Tech Lead |
| [005](ADR-005-search.md) | OpenSearch เป็นแหล่งค้นหาเดียว | 🟢 ยอมรับ (Spike C · 69 เคสผ่าน) | BE Lead |

**สถานะ:** 🔴 ต้องตัดสิน · 🟡 ร่าง (รอเซ็นรับ) · 🟢 ยอมรับแล้ว · ⚫ ถูกแทนที่

## รูปแบบ

แต่ละฉบับใช้โครง: บริบท → ทางเลือกที่พิจารณา → การตัดสินใจ → ผลที่ตามมา (ทั้งดีและร้าย)
ADR ที่ไม่บอกข้อเสียของทางเลือกที่เลือก คือ ADR ที่ยังเขียนไม่เสร็จ
