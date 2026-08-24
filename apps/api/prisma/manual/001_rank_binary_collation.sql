-- ADR-002 · LexoRank ต้องเปรียบเทียบแบบ binary
--
-- ปัญหา: Prisma schema ยังไม่รองรับการกำหนด collation ต่อคอลัมน์
-- ถ้าปล่อยให้ `rank` ใช้ utf8mb4_0900_ai_ci (ค่าเริ่มต้นของ schema)
-- การเรียงลำดับใน MySQL จะไม่ตรงกับ logic ฝั่ง application เพราะ:
--   - _ai = accent insensitive
--   - _ci = case insensitive  →  'A' กับ 'a' เท่ากัน ซึ่งผิดสำหรับ base-36 LexoRank
--
-- ผลถ้าไม่รัน migration นี้: การลากการ์ดจะได้ลำดับที่ถูกในหน่วยความจำ
-- แต่ ORDER BY rank จาก MySQL จะคืนลำดับที่ต่างออกไป — บั๊กประเภทที่หาไม่เจอ
--
-- รันหลัง `prisma migrate dev` ทุกครั้งที่ตาราง work_item ถูกสร้างใหม่
-- และรวมไว้ใน migration ที่ deploy จริง (ดู runbook ใน infra/migrations)

ALTER TABLE `work_item`
  MODIFY `rank` VARCHAR(255)
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_bin
  NOT NULL;

-- ตรวจสอบผล:
--   SELECT COLUMN_NAME, COLLATION_NAME FROM information_schema.COLUMNS
--   WHERE TABLE_SCHEMA = 'itsm' AND TABLE_NAME = 'work_item' AND COLUMN_NAME = 'rank';
--   -> ต้องได้ utf8mb4_bin

-- หมายเหตุสำหรับ production:
-- ตาราง work_item ที่มีมากกว่า 1 ล้านแถวต้องรัน ALTER นี้ด้วย gh-ost ไม่ใช่ ALTER ตรง ๆ
--   gh-ost --database=itsm --table=work_item \
--          --alter="MODIFY \`rank\` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL" \
--          --execute
