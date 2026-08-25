-- เปลี่ยนชื่อคอลัมน์ให้เป็น snake_case เหมือนที่เหลือทั้งสคีมา
-- RENAME ไม่ใช่ DROP+ADD เพราะแถวที่มีอยู่ต้องอยู่ต่อ
ALTER TABLE `notification` RENAME COLUMN `dedupeKey` TO `dedupe_key`;

-- เวลาที่หลุดไปแล้วจริง
-- แยกจาก breach_at ซึ่งเป็นกำหนดในอนาคตและกลายเป็น NULL ทันทีที่หลุด
-- ถ้าไม่เก็บค่านี้ ระบบรู้ว่าหลุดแต่ตอบไม่ได้ว่าหลุดตอนไหน
ALTER TABLE `work_item_sla` ADD COLUMN `breached_at` DATETIME(3) NULL;

-- ดัชนีสำหรับตัวกวาดหาการแจ้งเตือนที่ตกหล่น
CREATE INDEX `work_item_sla_state_breached_at_idx` ON `work_item_sla`(`state`, `breached_at`);
