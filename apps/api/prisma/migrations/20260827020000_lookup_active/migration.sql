-- เลิกใช้ระดับความสำคัญ/ผลการแก้ไข โดยไม่ลบทิ้ง
--
-- ลบไม่ได้: work_item.resolution_id และ priority_id เป็น onDelete: SetNull
-- การลบแถวเดียวจึงล้างค่าบนงานที่ปิดไปแล้วทุกใบพร้อมกัน โดยไม่มีอะไรเตือน
-- และกู้คืนไม่ได้เลยเพราะ work_item_history บันทึกเป็นชื่อ ไม่ใช่ id
ALTER TABLE `priority` ADD COLUMN `is_active` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `resolution` ADD COLUMN `is_active` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `resolution` ADD COLUMN `position` INT NOT NULL DEFAULT 0;

-- ลำดับเดิมของผลการแก้ไขมาจาก id เพราะยังไม่มีคอลัมน์ลำดับ
-- ย้ายค่านั้นมาไว้ใน position เพื่อไม่ให้ตัวเลือกบนหน้าจอสลับที่หลัง migrate
SET @row = 0;
UPDATE `resolution` SET `position` = (@row := @row + 1) ORDER BY `tenant_id`, `id`;
